import path from "path";
import crypto from "crypto";

import config from "#root/config.js";
import { MONGO_DB_NAME } from "#root/constants.js";

import LogFormatter from "#root/formatters/LogFormatter.js";

import utilities from "#root/utilities.js";

import PrismService from "#root/services/PrismService.js";
import CurrentService from "#root/services/CurrentService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";

import sharp from "sharp";
import { Message, Client } from "discord.js";
import { MongoClient } from "mongodb";

async function convertGifToPng(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer, { animated: false }).png().toBuffer();
}

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

export interface GenerateTextOptions {
  conversation: ChatMessage[];
  systemPrompt?: string;
  type?: string;
  modelPerformance?: string;
  temperature?: number;
  tokens?: number;
  model?: string | null;
  _label?: string | null;
  localMongo?: MongoClient | null;
  label?: string;
}

export interface GenerateVisionOptions {
  model?: string;
  provider?: string;
}

/**
 * Maps caption type → MongoDB collection name.
 * Adding a new type is a single-line addition.
 */
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
  /**
   * Convert image URLs to { imageData, mimeType } objects for Prism.
   * Optionally converts GIFs to PNG (first frame) for providers that don't support GIFs.
   */
  async _convertImageUrlsToBase64(
    urls: string[],
    { convertGifs = false }: { convertGifs?: boolean } = {},
  ): Promise<Array<{ imageData: string; mimeType: string }>> {
    const imageObjects: Array<{ imageData: string; mimeType: string }> = [];
    for (const url of urls) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        console.warn(
          `⚠️ [AIService] Skipping image ${url}: HTTP ${response.status}`,
        );
        continue;
      }
      const bytes = await response.bytes();
      const buffer = Buffer.from(bytes);
      const mimeType = response.headers.get("content-type") || "image/png";

      if (convertGifs && mimeType === "image/gif") {
        const pngBuffer = await convertGifToPng(buffer);
        imageObjects.push({
          imageData: pngBuffer.toString("base64"),
          mimeType: "image/png",
        });
      } else {
        imageObjects.push({
          imageData: buffer.toString("base64"),
          mimeType,
        });
      }
    }
    return imageObjects;
  },
  // Base Text-to-Text Generation (Completion)
  async generateText({
    conversation,
    systemPrompt,
    type = config.LANGUAGE_MODEL_TYPE || "OPENAI",
    modelPerformance = config.LANGUAGE_MODEL_PERFORMANCE,
    temperature,
    tokens,
    model = null,
  }: GenerateTextOptions): Promise<string | null> {
    let textResponse: string | null;
    let generateTextModel: string | undefined;

    const finalTemperature =
      temperature !== undefined
        ? temperature
        : config.LANGUAGE_MODEL_TEMPERATURE
          ? parseFloat(config.LANGUAGE_MODEL_TEMPERATURE)
          : undefined;
    const finalTokens =
      tokens !== undefined
        ? tokens
        : config.LANGUAGE_MODEL_MAX_TOKENS
          ? parseInt(config.LANGUAGE_MODEL_MAX_TOKENS, 10)
          : undefined;

    // Determine initial model based on type and performance
    if (type === "OPENAI") {
      if (model) {
        generateTextModel = model;
      } else if (modelPerformance === "LOW") {
        generateTextModel = config.LANGUAGE_MODEL_OPENAI_LOW;
      } else {
        generateTextModel =
          modelPerformance === "POWERFUL"
            ? config.LANGUAGE_MODEL_OPENAI
            : modelPerformance === "FAST"
              ? config.FAST_LANGUAGE_MODEL_OPENAI
              : config.LANGUAGE_MODEL_OPENAI;
      }
    } else if (type === "ANTHROPIC") {
      generateTextModel =
        modelPerformance === "FAST"
          ? config.ANTHROPIC_LANGUAGE_MODEL_FAST
          : config.ANTHROPIC_LANGUAGE_MODEL_SMART;

      // Handle empty content for Anthropic
      if (conversation[conversation.length - 1].content === "") {
        conversation[conversation.length - 1].content = "hey";
      }
    } else if (type === "GOOGLE") {
      generateTextModel =
        modelPerformance === "FAST"
          ? config.GOOGLE_LANGUAGE_MODEL_FAST
          : config.GOOGLE_LANGUAGE_MODEL_SMART;
    } else if (type === "LOCAL") {
      generateTextModel =
        modelPerformance === "FAST"
          ? config.FAST_LANGUAGE_MODEL_LOCAL
          : config.LANGUAGE_MODEL_LOCAL;
    }

    // Route through Prism API gateway
    let usedModel = model || generateTextModel || "";
    const discordUsername = AIService._getDiscordUsername();

    // Extract any system messages from the conversation array and pass
    // as a separate systemPrompt field — messages should only contain
    // user/assistant turns.
    let resolvedSystemPrompt = systemPrompt;
    const userAndAssistantMessages = conversation.filter((message) => {
      if (message.role === "system") {
        if (!resolvedSystemPrompt) resolvedSystemPrompt = message.content;
        return false;
      }
      return true;
    });

    try {
      const prismResult = await PrismService.generateText({
        messages: userAndAssistantMessages,
        systemPrompt: resolvedSystemPrompt,
        type: type!,
        model: usedModel,
        maxTokens: finalTokens,
        temperature: finalTemperature,
        username: discordUsername,
        ...AIService._getTraceParams(),
      });

      textResponse = prismResult.text ?? null;

      if (prismResult.model) {
        usedModel = prismResult.model;
      }
    } catch (prismError: unknown) {
      const wrappedError =
        prismError instanceof Error
          ? prismError
          : new Error(String(prismError));
      console.error(
        `Prism API error for ${type}/${usedModel}:`,
        wrappedError.message,
      );
      return null;
    }

    return textResponse;
  },
  // Base Text-to-Image Generation (Diffusion)
  async generateImage(
    type: string,
    prompt: string,
    client: Client,
    imageUrls: string[] = [],
    username: string | null = null,
  ): Promise<string | null> {
    let generatedImage: string | null = null;
    let usedModel: string;

    if (type === "GOOGLE") {
      let hasError = false;
      try {
        const imageObjects = imageUrls.length
          ? await AIService._convertImageUrlsToBase64(imageUrls, {
              convertGifs: true,
            })
          : [];

        usedModel = "gemini-3.1-flash-image-preview";
        const discordUsername = AIService._getDiscordUsername();

        const prismResult = await PrismService.generateImage({
          prompt,
          provider: "google",
          model: usedModel,
          images: imageObjects,
          username: discordUsername,
          ...AIService._getTraceParams(),
        });

        if (prismResult.imageData) {
          generatedImage = prismResult.imageData;
        } else {
          // No image in response, fall back to LOCAL
          console.log(
            "Google AI Image Generation returned no image, falling back to LOCAL.",
          );
          usedModel = "FLUX.1-dev";
          const generatedImageResponseLocal = await AIService.generateImage(
            "LOCAL",
            prompt,
            client,
            imageUrls,
            username,
          );
          generatedImage = generatedImageResponseLocal;
        }
      } catch (error: unknown) {
        const wrappedError =
          error instanceof Error ? error : new Error(String(error));
        console.error(...LogFormatter.error("generateImage", wrappedError));
        hasError = true;
      }
      if (hasError) {
        console.error("Falling back to LOCAL image generation.");
        const generatedImageResponseLocal = await AIService.generateImage(
          "LOCAL",
          prompt,
          client,
          imageUrls,
          username,
        );
        generatedImage = generatedImageResponseLocal;
      }
    } else if (type === "OPENAI") {
      // Route OpenAI image generation through Prism
      try {
        const discordUsername = AIService._getDiscordUsername();
        const imageObjects = imageUrls.length
          ? await AIService._convertImageUrlsToBase64(imageUrls)
          : [];

        usedModel = "gpt-image-1.5";
        const prismResult = await PrismService.generateImage({
          prompt,
          provider: "openai",
          model: usedModel,
          images: imageObjects,
          username: discordUsername,
          ...AIService._getTraceParams(),
        });

        generatedImage = prismResult.imageData;
      } catch (error: unknown) {
        const wrappedError =
          error instanceof Error ? error : new Error(String(error));
        console.error(...LogFormatter.error("generateImage", wrappedError));
      }
    }

    return generatedImage;
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
        model: model || "gemini-3-flash-preview",
        username: discordUsername,
        ...AIService._getTraceParams(),
      })) as { text?: string; model?: string; provider?: string };

      return {
        response: { choices: [{ message: { content: result.text || "" } }] },
        model: result.model || model || "gemini-3-flash-preview",
        provider: result.provider || provider || "google",
        error: null,
      };
    } catch (error: unknown) {
      const wrappedError =
        error instanceof Error ? error : new Error(String(error));
      return {
        response: null,
        model: model || "gemini-3-flash-preview",
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
  // Caption images and store data in MongoDB
  async captionImages(
    imageUrls: Array<string | { url: string; userId: string | null }>,
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
    if (collectionName) {
      const db = localMongo.db(MONGO_DB_NAME);
      const collection = db.collection(collectionName);
      const prompt =
        type === "SMALL"
          ? `Describe this image in a short sentence, 10 words or less. Make no mention about the quality, resolution, or pixelation.`
          : `Describe this ${type.toLowerCase()}. Make no mention about the quality, resolution, or pixelation.`;

      if (imageUrls?.length) {
        const first = imageUrls[0];
        const isObject =
          typeof first === "object" && first !== null && "url" in first;

        // Process all images in parallel — each checks cache first,
        // then fires vision call only for uncached images
        const captionPromises = imageUrls.map(async (imageUrl) => {
          const realImageUrl = isObject
            ? (imageUrl as { url: string }).url
            : (imageUrl as string);
          const userId = isObject
            ? (imageUrl as { userId: string | null }).userId
            : null;

          const hashResult = await utilities.generateFileHash(realImageUrl);
          if (!hashResult) return null;
          const { hash, fileType } = hashResult;
          const existingImage = await collection.findOne({ hash });

          if (existingImage) {
            const mapObject = {
              hash,
              url: realImageUrl,
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
          } = await AIService.generateVision(realImageUrl, prompt);
          if (response?.choices[0]?.message?.content) {
            const caption = response.choices[0].message.content;
            const mapObject = {
              hash,
              url: realImageUrl,
              caption,
              fileType,
              userId,
              model: usedModel,
              provider: usedProvider,
              cached: false,
            };
            await collection.insertOne({
              hash,
              type,
              url: realImageUrl,
              caption,
              fileType,
              userId,
              model: usedModel,
              provider: usedProvider,
              createdAt: new Date(),
            });
            return { caption, mapObject, hash };
          }
          return null;
        });

        const results = await Promise.all(captionPromises);
        for (const result of results) {
          if (result) {
            images.push(result.caption);
            imagesMap.set(result.hash, result.mapObject);
          }
        }
      }
    }
    return { images, imagesMap };
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

  // "mini-brains" for specific tasks
  async generateTextSummaryFromMessage(
    message: Message,
    messageContent: string,
  ): Promise<string> {
    const generatedText = await AIService.generateText({
      systemPrompt: `You are an expert at summarizing the text that is given to you in two to three words. Start with an emoji. Do not use any other formatting, just give the emoji and the two to three words.`,
      conversation: [
        {
          role: "user",
          name: DiscordUtilityService.getUsernameNoSpaces(message) || "Default",
          content: messageContent,
        },
      ],
      modelPerformance: "POWERFUL",
    });
    if (!generatedText) return "";
    return generatedText.substring(0, 128);
  },
  async generateTextCustomEmojiReactFromMessage(
    message: Message,
    localMongo: MongoClient,
  ): Promise<string | null> {
    const client = message.client;
    const guild = message.guild;
    const bot = client.user;
    const content = message.content;
    if (!bot) return null;
    const modifiedMessageContent = content.replace(`<@${bot.id}>`, "");

    let guildEmojiList = "";
    let serverEmojisArray: unknown[] = [];

    if (guild) {
      const serverEmojis = client.guilds.cache.get(guild.id)?.emojis.cache;
      if (serverEmojis) {
        serverEmojisArray = Array.from(serverEmojis.values());
        if (serverEmojisArray.length) {
          guildEmojiList = `# CUSTOM EMOJIS AVAILABLE:\n`;
          guildEmojiList += serverEmojisArray
            .map((emoji) => (emoji as { name: string }).name)
            .join(", ");
          guildEmojiList += `\n\n`;
        }
      }
    }

    const generatedText = await AIService.generateText({
      systemPrompt: `You are an expert at generating emoji reactions to text messages. 

# INSTRUCTIONS:
- Analyze the message and respond with a single, relevant emoji reaction
- You can use either:
1. A standard Unicode emoji (like 😂, ❤️, 👍, etc.)
2. A custom server emoji name from the list below (return just the name, no colons or formatting)

${guildEmojiList}
# RESPONSE FORMAT:
- For Unicode emojis: Return just the emoji character
- For custom emojis: Return just the emoji name (e.g., "pogchamp", "kekw")
- Return ONLY the emoji or emoji name, nothing else
- No explanations, no punctuation, no extra text`,
      conversation: [
        {
          role: "user",
          name:
            DiscordUtilityService.getUsernameNoSpaces(message as Message) ||
            "Default",
          content: modifiedMessageContent,
        },
      ],
      localMongo: localMongo,
      type: "ANTHROPIC",
      model: config.ANTHROPIC_LANGUAGE_MODEL_FAST,
      label: "🧠 Emoji React",
    });

    if (!generatedText) return null;

    // Clean up the response - remove any extra whitespace, newlines, or formatting
    let cleanedResponse = generatedText.trim().replace(/[\n\r]/g, "");

    if (serverEmojisArray.length) {
      // check if its emoji or custom emoji
      const isCustomEmoji = serverEmojisArray.some(
        (emoji) => (emoji as { name: string }).name === cleanedResponse,
      );
      if (isCustomEmoji) {
        // <:blobreach:123456789012345678>
        // if its custom, wrap it in <:
        const found = serverEmojisArray.find(
          (emoji) => (emoji as { name: string }).name === cleanedResponse,
        ) as { id: string } | undefined;
        if (found) {
          cleanedResponse = found.id;
        }
      }
    }

    return cleanedResponse;
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
  async generateTextFromUserConversation(
    userName: string,
    cleanUserName: string,
    userMessagesAsText: string,
  ): Promise<string | null> {
    const generatedText = await AIService.generateText({
      systemPrompt: `You are an expert at providing concise, accurate descriptions of messages. Analyze the content sent to you and create a detailed summary of what ${userName} is discussing. Focus on being precise and direct while capturing all key points and context from their message.
                
As the output, I want you to provide the descriptions in dash list form, without using any bold, italics, or any other formatting. You can have nested lists, but no more than 3 levels deep. Do not announce that you are generating a response, just provide the descriptions. Seperate each line with a new line, not two new lines.`,
      conversation: [
        {
          role: "user",
          name: cleanUserName,
          content: `Recent messages from ${userName}: ${userMessagesAsText}`,
        },
      ],
      type: "OPENAI",
      model: config.OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,
    });
    return generatedText;
  },
};

export default AIService;
