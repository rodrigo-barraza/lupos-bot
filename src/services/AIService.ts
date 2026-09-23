import path from "path";
import crypto from "crypto";

import { MONGO_DB_NAME } from "#root/constants.ts";
import { MODEL_IDS } from "@rodrigo-barraza/utilities-library/taxonomy";

import utilities from "#root/utilities.ts";
import PromiseMemo from "#root/utilities/PromiseMemo.ts";

import PrismService from "#root/services/PrismService.ts";
import CurrentService from "#root/services/CurrentService.ts";

import { Message } from "discord.js";
import { MongoClient } from "mongodb";

export interface CaptionMapObject {
  hash: string;
  url: string;
  caption: string;
  fileType: string | null;
  userId: string | null;
  model: string | null;
  provider: string | null;
  cached: boolean;
}

export interface TranscriptionMapObject {
  hash: string;
  url: string;
  transcription: string;
  type: string | null;
  cached: boolean;
}

export interface ChatMessage {
  role: string;
  name?: string;
  content: string;
  images?: string[];
}

export interface GenerateVisionOptions {
  model?: string;
  provider?: string;
}

/**
 * Maps caption type → MongoDB collection name.
 * Adding a new type is a single-line addition.
 */
interface CaptionResult {
  caption: string;
  mapObject: CaptionMapObject;
  hash: string;
}

// In-flight and just-finished captions per (type, url). A caption is
// already persisted by content hash in Mongo; this only saves the second
// download + lookup, and lets a prefetch and its real call share one
// vision request. Failures are never kept (PromiseMemo).
const captionMemo = new PromiseMemo<CaptionResult>(500, 5 * 60 * 1000);

const CAPTION_COLLECTION_MAP = {
  IMAGE: "ImageCaptions",
  EMOJI: "EmojiCaptions",
  STICKER: "StickerCaptions",
  VIDEO: "VideoCaptions",
  AVATAR: "AvatarCaptions",
  BANNER: "BannerCaptions",
  SMALL: "SmallCaptions",
};

const AIService = {
  /**
   * Returns trace params for PrismService calls.
   * Generates a traceId locally on the first call per message cycle
   * and reuses it for subsequent calls (CurrentService.clearTraceId()
   * resets at the start of each cycle).
   */
  _getTraceParams(): { traceId: string } {
    let traceId = CurrentService.getTraceId();
    if (!traceId) {
      traceId = crypto.randomUUID();
      CurrentService.setTraceId(traceId);
    }
    return { traceId };
  },
  /**
   * Get the current Discord username from CurrentService, with "lupos" fallback.
   */
  _getDiscordUsername(): string {
    const discordMessage = CurrentService.getMessage() as
      | Message
      | null
      | undefined;
    return discordMessage?.author?.username || "lupos";
  },
  // Base Image-to-Text Generation (Captioning) — via Prism
  async generateVision(
    imageUrl: string,
    text: string,
    { model, provider }: GenerateVisionOptions = {},
  ): Promise<{
    response: { choices: Array<{ message: { content: string } }> } | null;
    model: string;
    provider: string;
    error: Error | null;
  }> {
    try {
      const discordUsername = AIService._getDiscordUsername();

      const result = (await PrismService.captionImage({
        images: imageUrl,
        prompt: text || "What's in this image?",
        provider: provider || "google",
        model: model || MODEL_IDS.geminiFlash,
        username: discordUsername,
        ...AIService._getTraceParams(),
      })) as { text?: string; model?: string; provider?: string };

      return {
        response: { choices: [{ message: { content: result.text || "" } }] },
        model: result.model || model || MODEL_IDS.geminiFlash,
        provider: result.provider || provider || "google",
        error: null,
      };
    } catch (error: unknown) {
      const wrappedError =
        error instanceof Error ? error : new Error(String(error));
      return {
        response: null,
        model: model || MODEL_IDS.geminiFlash,
        provider: provider || "google",
        error: wrappedError,
      };
    }
  },
  // Base Speech-to-Text Generation (Transcription) — via Prism
  async transcribeSpeech(
    audioUrl: string,
    _messageId: string,
    _index: number,
  ): Promise<string> {
    // Parse the URL to get just the filename without query parameters
    const url = new URL(audioUrl);
    const filename = path.basename(url.pathname);

    // Download the audio file into memory (no disk write needed)
    const audioFile = await fetch(audioUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!audioFile.ok) {
      throw new Error(
        `Failed to download audio ${audioUrl}: HTTP ${audioFile.status}`,
      );
    }
    const audioBuffer = Buffer.from(await audioFile.bytes());

    // Determine MIME type from file extension
    const ext = path.extname(filename).toLowerCase().replace(".", "");
    const mimeMap = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      webm: "audio/webm",
      m4a: "audio/mp4",
      flac: "audio/flac",
    };
    const mimeType = mimeMap[ext as keyof typeof mimeMap] || "audio/wav";

    // Get Discord context for tracking
    const discordUsername = AIService._getDiscordUsername();

    // Transcribe via Prism
    const result = (await PrismService.transcribeAudio({
      audio: audioBuffer,
      mimeType,
      provider: "openai",
      username: discordUsername,
      ...AIService._getTraceParams(),
    })) as { text?: string };

    const transcription = (result.text || "").trim().replace(/\n+/g, " ");
    return transcription;
  },
  // Caption images and store data in MongoDB. Each (type, url) is
  // captioned once at a time and its caption reused for a few minutes
  // (captionMemo): the reference-image step prefetches the trigger's
  // SMALL captions while the history is still being read, and joins
  // that request here instead of starting its own.
  async captionImages(
    imageUrls: string[],
    localMongo: MongoClient,
    type: string,
  ): Promise<{
    images: string[];
    imagesMap: Map<string, CaptionMapObject>;
  }> {
    const images: string[] = [];
    const imagesMap = new Map<string, CaptionMapObject>();
    const collectionName =
      CAPTION_COLLECTION_MAP[type as keyof typeof CAPTION_COLLECTION_MAP];
    if (collectionName && imageUrls?.length) {
      const collection = localMongo
        .db(MONGO_DB_NAME)
        .collection(collectionName);
      const prompt =
        type === "SMALL"
          ? `Describe this image in a short sentence, 10 words or less. Make no mention about the quality, resolution, or pixelation.`
          : `Describe this ${type.toLowerCase()}. Make no mention about the quality, resolution, or pixelation.`;

      // Process all images in parallel — each checks cache first,
      // then fires vision call only for uncached images
      const results = await Promise.all(
        imageUrls.map((imageUrl) =>
          captionMemo.get(`${type}\u0000${imageUrl}`, () =>
            AIService._captionOneImage(imageUrl, collection, type, prompt),
          ),
        ),
      );
      for (const result of results) {
        if (result) {
          images.push(result.caption);
          imagesMap.set(result.hash, result.mapObject);
        }
      }
    }
    return { images, imagesMap };
  },
  /** One image's caption: the Mongo cache by content hash, else a vision call. */
  async _captionOneImage(
    imageUrl: string,
    collection: import("mongodb").Collection,
    type: string,
    prompt: string,
  ): Promise<CaptionResult | null> {
    const hashResult = await utilities.generateFileHash(imageUrl);
    if (!hashResult) return null;
    const { hash, fileType } = hashResult;
    const existingImage = await collection.findOne({ hash });

    if (existingImage) {
      const mapObject = {
        hash,
        url: imageUrl,
        caption: existingImage.caption,
        fileType,
        userId: existingImage.userId,
        model: existingImage.model || null,
        provider: existingImage.provider || null,
        cached: true,
      };
      return {
        caption: existingImage.caption as string,
        mapObject,
        hash,
      };
    }

    // Uncached — fire vision call
    const {
      response,
      model: usedModel,
      provider: usedProvider,
    } = await AIService.generateVision(imageUrl, prompt);
    if (response?.choices[0]?.message?.content) {
      const caption = response.choices[0].message.content;
      const mapObject = {
        hash,
        url: imageUrl,
        caption,
        fileType,
        userId: null,
        model: usedModel,
        provider: usedProvider,
        cached: false,
      };
      await collection.insertOne({
        hash,
        type,
        url: imageUrl,
        caption,
        fileType,
        userId: null,
        model: usedModel,
        provider: usedProvider,
        createdAt: new Date(),
      });
      return { caption, mapObject, hash };
    }
    return null;
  },
  // Transcribe audio files from URLs and store data in MongoDB
  async transcribeAudioUrls(
    audioUrls: string[],
    messageId: string,
    localMongo: MongoClient,
  ): Promise<{
    transcriptionsMap: Map<string, TranscriptionMapObject>;
  }> {
    const transcriptionsMap = new Map<string, TranscriptionMapObject>();
    const db = localMongo.db(MONGO_DB_NAME);
    const collection = db.collection("AudioTranscriptions");
    let existingAudio:
      | import("mongodb").WithId<import("mongodb").Document>
      | null;
    if (audioUrls?.length) {
      let index = 0;
      for (const audioUrl of audioUrls) {
        index++;
        const hashResult = await utilities.generateFileHash(audioUrl);
        if (!hashResult) continue;
        const { hash, fileType } = hashResult;
        existingAudio = await collection.findOne({ hash });

        if (!existingAudio) {
          const transcription = await AIService.transcribeSpeech(
            audioUrl,
            messageId,
            index,
          );
          await collection.insertOne({
            hash,
            url: audioUrl,
            transcription: transcription,
            type: fileType,
            createdAt: new Date(),
          });
          const mapObject = {
            hash,
            url: audioUrl,
            transcription: transcription,
            type: fileType,
            cached: false,
          };
          transcriptionsMap.set(hash, mapObject);
        } else {
          const mapObject = {
            hash,
            url: audioUrl,
            transcription: existingAudio.transcription,
            type: fileType,
            cached: true,
          };
          transcriptionsMap.set(hash, mapObject);
        }
      }
    }
    return { transcriptionsMap };
  },

  async generateTextDetermineHowManyMessagesToFetch(
    content: string,
    _message: Message,
    _messageCountText: string,
  ): Promise<number> {
    // Fully deterministic — the old AI prompt's decision rules were keyword-based,
    // so we replicate them exactly without an LLM call.
    const strippedContent = content
      .replace(/<@\d+>/g, "")
      .trim()
      .toLowerCase();

    // MICRO/MINIMAL: standalone image requests need minimal context
    const isImageRequest =
      /\b(draw|paint|sketch|create|generate|make|illustrate)\b/i.test(
        strippedContent,
      );
    const refersToConversation =
      /\b(conversation|we talked|earlier|before|what was|what did|summarize|recap|context|going on|been discussing|you said|he said|she said|they said)\b/i.test(
        strippedContent,
      );

    if (isImageRequest && !refersToConversation) {
      return 5;
    }

    // MAXIMAL: explicit full-context requests
    if (
      /\b(everything we.*discussed|the whole conversation|full conversation|everything|entire chat|all messages)\b/i.test(
        strippedContent,
      )
    ) {
      return 100;
    }

    // LARGE: summary, "all", "our conversation", specific time ranges
    if (
      /\b(summarize|recap|our conversation|what we talked about|what.* been (saying|discussing|talking)|today|this morning|this afternoon|this evening|last few hours)\b/i.test(
        strippedContent,
      )
    ) {
      return 75;
    }

    // LARGE: mentions earlier/before with conversation reference
    if (refersToConversation) {
      return 75;
    }

    // MODERATE: image with context, follow-ups, questions about recent topics
    if (isImageRequest) {
      return 20; // Image with some context reference
    }

    // DEFAULT: enough ambient channel context to read the room — who's
    // talking, running bits, the current topic — not just the trigger.
    return 50;
  },
};

export default AIService;
