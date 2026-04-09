// Packages

import path from "path";

// import { DateTime } from 'luxon';
// Config
import config from "#root/secrets.js";
// Formatters
import LogFormatter from "#root/formatters/LogFormatter.js";
// Wrappers
import ComfyUIService from "#root/services/ComfyUIService.js";
// Libraries
import utilities from "#root/utilities.js";
// Services
import PrismService from "#root/services/PrismService.js";
import CurrentService from "#root/services/CurrentService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";

// Image processing - prefer sharp, fallback to Jimp
let sharp;
let Jimp;

try {
  sharp = (await import("sharp")).default;
  console.log("Using sharp for image processing");
} catch {
  const jimp = await import("jimp");
  Jimp = jimp.Jimp;
  console.log("sharp unavailable, using Jimp for image processing");
}

async function convertGifToPng(imageBuffer) {
  if (sharp) {
    const pngBuffer = await sharp(imageBuffer, { animated: false })
      .png()
      .toBuffer();
    return pngBuffer;
  } else {
    const image = await Jimp.read(imageBuffer);
    const pngBuffer = await image.getBuffer("image/png");
    return pngBuffer;
  }
}

function assembleConversation(systemMessage, userMessage, message) {
  const conversation = [
    {
      role: "system",
      content: systemMessage,
    },
    {
      role: "user",
      name: DiscordUtilityService.getUsernameNoSpaces(message) || "Default",
      content: userMessage,
    },
  ];
  return conversation;
}

const AIService = {
  /**
   * Returns session params for PrismService calls.
   * First call in a message cycle: { createSession: true }
   * Subsequent calls: { sessionId: "<existing-id>" }
   */
  _getSessionParams() {
    const existingSessionId = CurrentService.getSessionId();
    if (existingSessionId) {
      return { sessionId: existingSessionId };
    }
    return { createSession: true };
  },
  /**
   * Capture sessionId from a Prism response into CurrentService.
   */
  _captureSessionId(prismResult) {
    if (prismResult?.sessionId && !CurrentService.getSessionId()) {
      CurrentService.setSessionId(prismResult.sessionId);
    }
  },
  /**
   * Get the current Discord username from CurrentService, with "lupos" fallback.
   * @returns {string}
   */
  _getDiscordUsername() {
    return CurrentService.getMessage()?.author?.username || "lupos";
  },
  /**
   * Convert image URLs to { imageData, mimeType } objects for Prism.
   * Optionally converts GIFs to PNG (first frame) for providers that don't support GIFs.
   * @param {string[]} urls
   * @param {{ convertGifs?: boolean }} [options]
   * @returns {Promise<Array<{ imageData: string, mimeType: string }>>}
   */
  async _convertImageUrlsToBase64(urls, { convertGifs = false } = {}) {
    const imageObjects = [];
    for (const url of urls) {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const mimeType = response.headers.get("content-type");

      if (convertGifs && mimeType === "image/gif") {
        const pngBuffer = await convertGifToPng(Buffer.from(buffer));
        imageObjects.push({
          imageData: pngBuffer.toString("base64"),
          mimeType: "image/png",
        });
      } else {
        imageObjects.push({
          imageData: Buffer.from(buffer).toString("base64"),
          mimeType,
        });
      }
    }
    return imageObjects;
  },
  // Base Text-to-Text Generation (Completion)
  async generateText({
    conversation,
    type = config.LANGUAGE_MODEL_TYPE,
    modelPerformance = config.LANGUAGE_MODEL_PERFORMANCE,
    temperature = config.LANGUAGE_MODEL_TEMPERATURE,
    tokens = config.LANGUAGE_MODEL_MAX_TOKENS,
    model = null,
    _label = null,
  }) {
    let textResponse;
    let generateTextModel;

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
    } else if (type === "LOCAL") {
      generateTextModel =
        modelPerformance === "FAST"
          ? config.FAST_LANGUAGE_MODEL_LOCAL
          : config.LANGUAGE_MODEL_LOCAL;
    }

    // Route through Prism API gateway
    let usedModel = model || generateTextModel;
    const discordUsername = AIService._getDiscordUsername();

    try {
      const prismResult = await PrismService.generateText({
        messages: conversation,
        type,
        model: usedModel,
        maxTokens: tokens,
        temperature,
        username: discordUsername,
        ...AIService._getSessionParams(),
      });

      AIService._captureSessionId(prismResult);
      textResponse = prismResult.text;

      if (prismResult.model) {
        usedModel = prismResult.model;
      }

    } catch (prismError) {
      console.error(
        `Prism API error for ${type}/${usedModel}:`,
        prismError.message,
      );
      return null;
    }

    return textResponse;
  },
  // Base Text-to-Image Generation (Diffusion)
  async generateImage(type, prompt, client, imageUrls = [], username = null) {
    let generatedImage;
    let usedModel;



    if (type === "LOCAL") {
      try {
        console.log(...LogFormatter.generateImageStart({ prompt }));
        await ComfyUIService.checkComfyUIWebsocketStatus();
        if (prompt) {
          usedModel = "FLUX.1-dev";
          generatedImage = await ComfyUIService.generateComfyUIImage(
            prompt,
            client,
          );
        }
      } catch (error) {
        console.error(...LogFormatter.error("generateImage", error));
      }
    } else if (type === "GOOGLE") {
      let hasError = false;
      try {
        const imageObjects = imageUrls.length
          ? await AIService._convertImageUrlsToBase64(imageUrls, { convertGifs: true })
          : [];

        usedModel = "gemini-3.1-flash-image-preview";
        const discordUsername = AIService._getDiscordUsername();

        const prismResult = await PrismService.generateImage({
          prompt,
          provider: "google",
          model: usedModel,
          images: imageObjects,
          username: discordUsername,
          ...AIService._getSessionParams(),
        });

        AIService._captureSessionId(prismResult);

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
      } catch (error) {
        console.error(...LogFormatter.error("generateImage", error));
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
          ...AIService._getSessionParams(),
        });

        AIService._captureSessionId(prismResult);

        generatedImage = prismResult.imageData;

      } catch (error) {
        console.error(...LogFormatter.error("generateImage", error));
      }
    }


    return generatedImage;
  },
  // Base Image-to-Text Generation (Captioning) — via Prism
  async generateVision(imageUrl, text, { model, provider } = {}) {
    try {
      const discordUsername = AIService._getDiscordUsername();

      const result = await PrismService.captionImage({
        images: imageUrl,
        prompt: text || "What's in this image?",
        provider: provider || "google",
        model: model || "gemini-3-flash-preview",
        username: discordUsername,
        ...AIService._getSessionParams(),
      });

      AIService._captureSessionId(result);

      return {
        response: { choices: [{ message: { content: result.text } }] },
        model: result.model || model || "gemini-3-flash-preview",
        provider: result.provider || provider || "google",
        error: null,
      };
    } catch (error) {
      return { response: null, error };
    }
  },
  // Base Speech-to-Text Generation (Transcription) — via Prism
  async transcribeSpeech(audioUrl, _messageId, _index) {
    // Parse the URL to get just the filename without query parameters
    const url = new URL(audioUrl);
    const filename = path.basename(url.pathname);

    // Download the audio file into memory (no disk write needed)
    const audioFile = await fetch(audioUrl);
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

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
    const mimeType = mimeMap[ext] || "audio/wav";

    // Get Discord context for tracking
    const discordUsername = AIService._getDiscordUsername();

    // Transcribe via Prism
    const result = await PrismService.transcribeAudio({
      audio: audioBuffer,
      mimeType,
      provider: "openai",
      username: discordUsername,
      ...AIService._getSessionParams(),
    });

    AIService._captureSessionId(result);

    const transcription = (result.text || "").trim().replace(/\n+/g, " ");
    return transcription;
  },
  // Caption images and store data in MongoDB
  async captionImages(imageUrls, localMongo, type) {
    // type = ['image', 'emoji', 'sticker', video']
    const images = [];
    const imagesMap = new Map();
    if (
      type === "IMAGE" ||
      type === "EMOJI" ||
      type === "STICKER" ||
      type === "VIDEO" ||
      type === "AVATAR" ||
      type === "BANNER" ||
      type === "SMALL"
    ) {
      const db = localMongo.db("lupos");
      let collection;
      let prompt = `Describe this ${type.toLowerCase()}. Make no mention about the quality, resolution, or pixelation.`;

      if (type === "IMAGE") {
        collection = db.collection("ImageCaptions");
      } else if (type === "EMOJI") {
        collection = db.collection("EmojiCaptions");
      } else if (type === "STICKER") {
        collection = db.collection("StickerCaptions");
      } else if (type === "VIDEO") {
        collection = db.collection("VideoCaptions");
      } else if (type === "AVATAR") {
        collection = db.collection("AvatarCaptions");
      } else if (type === "BANNER") {
        collection = db.collection("BannerCaptions");
      } else if (type === "SMALL") {
        collection = db.collection("SmallCaptions");
        prompt = `Describe this image in a short sentence, 10 words or less. Make no mention about the quality, resolution, or pixelation.`;
      }

      if (imageUrls?.length) {
        const isObject = imageUrls[0]?.url;

        // Process all images in parallel — each checks cache first,
        // then fires vision call only for uncached images
        const captionPromises = imageUrls.map(async (imageUrl) => {
          const realImageUrl = isObject ? imageUrl.url : imageUrl;
          const userId = isObject ? imageUrl.userId : null;

          const hashResult =
            await utilities.generateFileHash(realImageUrl);
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
            return { caption: existingImage.caption, mapObject, hash };
          }

          // Uncached — fire vision call
          const { response, model: usedModel, provider: usedProvider } =
            await AIService.generateVision(realImageUrl, prompt);
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
  async transcribeAudioUrls(audioUrls, messageId, localMongo) {
    const transcriptionsMap = new Map();
    const db = localMongo.db("lupos");
    const collection = db.collection("AudioTranscriptions");
    let existingAudio;
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
  async generateTextSummaryFromMessage(message, messageContent) {
    let summary = "";
    const systemContent = `You are an expert at summarizing the text that is given to you in two to three words. Start with an emoji. Do not use any other formatting, just give the emoji and the two to three words.`;
    const conversation = assembleConversation(
      systemContent,
      messageContent,
      message,
    );
    const generatedText = await AIService.generateText({
      conversation: conversation,
      type: config.LANGUAGE_MODEL_TYPE,
      modelPerformance: "POWERFUL",
      tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
      temperature: config.LANGUAGE_MODEL_TEMPERATURE,
      label: "🧠 Summary",
      // model,
      // localMongo,
      // replyMessageStartTime,
      // guildId,
      // userId,
      // userName,
    });
    if (!generatedText) return "";
    // trim generatedText to 128 characters
    summary = generatedText.substring(0, 128);
    return summary;
  },
  async generateTextCustomEmojiReactFromMessage(message, localMongo) {
    const client = message.client;
    const guild = message.guild;
    const bot = client.user;
    const content = message.content;
    const modifiedMessageContent = content.replace(`<@${bot.id}>`, "");

    let guildEmojiList;
    let serverEmojisArray = [];

    if (guild) {
      const serverEmojis = client.guilds.cache.get(guild.id).emojis.cache;
      serverEmojisArray = Array.from(serverEmojis.values());
      if (serverEmojisArray.length) {
        guildEmojiList = `# CUSTOM EMOJIS AVAILABLE:\n`;
        guildEmojiList += serverEmojisArray
          .map((emoji) => emoji.name)
          .join(", ");
        guildEmojiList += `\n\n`;
      }
    }

    const systemContent = `You are an expert at generating emoji reactions to text messages. 

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
- No explanations, no punctuation, no extra text`;

    const conversation = assembleConversation(
      systemContent,
      modifiedMessageContent,
      message,
    );

    const generatedText = await AIService.generateText({
      localMongo: localMongo,
      conversation: conversation,
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
        (emoji) => emoji.name === cleanedResponse,
      );
      if (isCustomEmoji) {
        // <:blobreach:123456789012345678>
        // if its custom, wrap it in <:
        cleanedResponse = `${serverEmojisArray.find((emoji) => emoji.name === cleanedResponse).id}`;
      }
    }

    return cleanedResponse;
  },
  async generateTextDetermineHowManyMessagesToFetch(
    content,
    _message,
    _messageCountText,
  ) {
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
      return 50;
    }

    // MODERATE: image with context, follow-ups, questions about recent topics
    if (isImageRequest) {
      return 20; // Image with some context reference
    }

    // DEFAULT: moderate fetch for general messages
    return 20;
  },
  async generateTextFromUserConversation(
    userName,
    cleanUserName,
    userMessagesAsText,
  ) {
    const conversation = [
      {
        role: "system",
        content: `You are an expert at providing concise, accurate descriptions of messages. Analyze the content sent to you and create a detailed summary of what ${userName} is discussing. Focus on being precise and direct while capturing all key points and context from their message.
                
As the output, I want you to provide the descriptions in dash list form, without using any bold, italics, or any other formatting. You can have nested lists, but no more than 3 levels deep. Do not announce that you are generating a response, just provide the descriptions. Seperate each line with a new line, not two new lines.`,
      },
      {
        role: "user",
        name: cleanUserName,
        content: `Recent messages from ${userName}: ${userMessagesAsText}`,
      },
    ];
    const generatedText = await AIService.generateText({
      conversation: conversation,
      type: "OPENAI",
      model: config.OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,
      label: "🧠 User Analysis",
    });
    return generatedText;
  },
};

export default AIService;

