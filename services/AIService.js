// Packages

import path from "path";

// import { DateTime } from 'luxon';
// Config
import config from "#root/secrets.js";
// Formatters
import LogFormatter from "#root/formatters/LogFormatter.js";
// Wrappers
import ComfyUIService from "#root/services/ComfyUIService.js";
import MongoService from "#root/services/MongoService.js";
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
    const functionName = "generateText";
    let textResponse;
    let generateTextModel;

    const start = performance.now();
    const localMongo = MongoService.getClient("local");

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

    const discordMessage = CurrentService.getMessage();
    const discordUsername = discordMessage?.author?.username || "lupos";

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

    const end = performance.now();
    const duration = end - start;

    CurrentService.addModel(usedModel);
    CurrentService.addModelType(type);


    if (localMongo) {
      const message = CurrentService.getMessage();
      if (!message) {
        // No Discord message context (e.g. scheduled jobs) — skip metrics
        return textResponse;
      }
      const messageId = message?.id;
      const user = message.author;
      const userId = user.id;
      const userName = user.username;
      const guildId = message.guild?.id;

      // Save the generated text and its metadata to the database
      const db = localMongo.db("lupos");
      const collection = db.collection("MetricsTextGeneration");
      await collection.insertOne({
        model: usedModel,
        modelType: type,
        promptType: "TEXT",
        input: conversation,
        output: textResponse,
        guildId: guildId || "DM",
        guildName: discordMessage?.guild?.name || "DM",
        userId: userId,
        userName: userName,
        messageId: messageId || null,
      });
    }

    console.log(
      ...LogFormatter.generateTextSuccess({
        functionName,
        duration,
        modelName: usedModel,
        modelType: type,
      }),
    );

    return textResponse;
  },
  // Base Text-to-Image Generation (Diffusion)
  async generateImage(type, prompt, client, imageUrls = [], username = null) {
    let generatedImage;
    const localMongo = MongoService.getClient("local");
    let usedModel;
    let generatedText;

    const start = performance.now();


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
        // Convert image URLs to { imageData, mimeType } objects for Prism's Google provider
        const imageObjects = [];
        if (imageUrls.length) {
          for (const url of imageUrls) {
            const fetchImageUrlResponse = await fetch(url);
            const imageAsBuffer = await fetchImageUrlResponse.arrayBuffer();
            const imageType = fetchImageUrlResponse.headers.get("content-type");

            // Convert GIF to PNG (first frame) since Gemini doesn't support GIFs
            if (imageType === "image/gif") {
              const pngBuffer = await convertGifToPng(
                Buffer.from(imageAsBuffer),
              );
              const imageAsBase64 = pngBuffer.toString("base64");
              imageObjects.push({
                imageData: imageAsBase64,
                mimeType: "image/png",
              });
            } else {
              const imageAsBase64 =
                Buffer.from(imageAsBuffer).toString("base64");
              imageObjects.push({
                imageData: imageAsBase64,
                mimeType: imageType,
              });
            }
          }
        }

        usedModel = "gemini-3.1-flash-image-preview";
        const discordMessage = CurrentService.getMessage();
        const discordUsername = discordMessage?.author?.username || "lupos";

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
          generatedText = prismResult.text;

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
        const discordMessage = CurrentService.getMessage();
        const discordUsername = discordMessage?.author?.username || "lupos";

        // Convert image URLs to { imageData, mimeType } objects for Prism
        const imageObjects = [];
        if (imageUrls.length) {
          for (const url of imageUrls) {
            const fetchImageUrlResponse = await fetch(url);
            const imageAsBuffer = await fetchImageUrlResponse.arrayBuffer();
            const imageType = fetchImageUrlResponse.headers.get("content-type");
            const imageAsBase64 = Buffer.from(imageAsBuffer).toString("base64");
            imageObjects.push({
              imageData: imageAsBase64,
              mimeType: imageType,
            });
          }
        }

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
        generatedText = prismResult.text;

      } catch (error) {
        console.error(...LogFormatter.error("generateImage", error));
      }
    }

    const end = performance.now();
    const duration = end - start;

    if (localMongo && generatedImage) {
      const message = CurrentService.getMessage();
      const messageId = message?.id;
      const user = message.author;
      const userId = user.id;
      const userName = user.username;
      const guildId = message.guild?.id;
      const guildName = message.guild?.name;

      // Save the generated image and its metadata to the database
      const db = localMongo.db("lupos");
      const collection = db.collection("MetricsImageGeneration");
      await collection.insertOne({
        model: usedModel,
        inputText: prompt,
        outputText: generatedText,
        inputImages: imageUrls.length,
        guildId: guildId || "DM",
        guildName: guildName || "DM",
        userId: userId,
        userName: userName,
        messageId: messageId || null,
        duration: parseFloat(duration.toFixed(3)),
      });
    }

    if (generatedImage) {
      CurrentService.addModel(usedModel);
      CurrentService.addModelType(type);
    }

    // Image is now stored in MinIO via Prism's text-to-image route

    console.log(
      ...LogFormatter.generateImageSuccess({
        duration,
        prompt,
      }),
    );

    return generatedImage;
  },
  // Base Image-to-Text Generation (Captioning) — via Prism
  async generateVision(imageUrl, text) {
    try {
      const discordMessage = CurrentService.getMessage();
      const discordUsername = discordMessage?.author?.username || "lupos";

      const result = await PrismService.captionImage({
        images: imageUrl,
        prompt: text || "What's in this image?",
        provider: "openai",
        username: discordUsername,
        ...AIService._getSessionParams(),
      });

      AIService._captureSessionId(result);

      return {
        response: { choices: [{ message: { content: result.text } }] },
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
    const discordMessage = CurrentService.getMessage();
    const discordUsername = discordMessage?.author?.username || "lupos";

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
        for (const imageUrl of imageUrls) {
          const realImageUrl = isObject ? imageUrl.url : imageUrl;
          const userId = isObject ? imageUrl.userId : null;

          const { hash, fileType } =
            await utilities.generateFileHash(realImageUrl);
          const existingImage = await collection.findOne({ hash });
          if (!existingImage) {
            const { response } = await AIService.generateVision(
              realImageUrl,
              prompt,
            );
            if (response?.choices[0]?.message?.content) {
              const caption = response.choices[0].message.content;
              const mapObject = {
                hash,
                url: realImageUrl,
                caption,
                fileType,
                userId,
                cached: false,
              };
              images.push(caption);
              imagesMap.set(hash, mapObject);
              await collection.insertOne({
                hash,
                type,
                url: realImageUrl,
                caption,
                fileType,
                userId,
                createdAt: new Date(),
              });
            }
          } else {
            images.push(existingImage.caption);
            const mapObject = {
              hash,
              url: realImageUrl,
              caption: existingImage.caption,
              fileType,
              userId: existingImage.userId,
              cached: true,
            };
            imagesMap.set(hash, mapObject);
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
        const { hash, fileType } = await utilities.generateFileHash(audioUrl);
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
  // async generateImageToImage(text, imageUrl, denoisingStrength) {
  //     consoleLog('<');
  //     consoleLog('=', `PROMPT:\n\n${text}`);
  //     let generatedImage;
  //     try {
  //         await ComfyUIService.checkComfyUIWebsocketStatus();
  //         let currentTime = new Date().getTime();
  //         if (text) {
  //             generatedImage = await ComfyUIService.generateComfyUIImageToImage(text, imageUrl, denoisingStrength);
  //             let timeTakenInSeconds = (new Date().getTime() - currentTime) / 1000;
  //             consoleLog('=', `Type: FLUX`);
  //             consoleLog('=', `Time: ${timeTakenInSeconds}`);
  //             consoleLog('=', `RESPONSE:\n\n🖼️`);
  //             consoleLog('>');
  //         }
  //     } catch (error) {
  //         consoleLog('=', `RESPONSE:\n\n${error}`);
  //         consoleLog('>!');
  //     }
  //     return generatedImage;
  // },
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
    message,
    messageCountText,
  ) {
    // Rule-based fast-path: standalone image requests need minimal context
    const strippedContent = content
      .replace(/<@\d+>/g, "")
      .trim()
      .toLowerCase();
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

    const conversation = [
      {
        role: "system",
        content: `You are a message fetch optimizer for a multi-modal Discord AI bot. Your role is to determine the optimal number of historical messages to fetch based on the user's request.

The following shows how far back each message count reaches (oldest message in range):
${messageCountText}

# DECISION RULES:

## MICRO FETCH (5 messages):
- Simple, direct questions
- Requests for definitions or single facts
- Basic image generation requests with no context

## MINIMAL FETCH (5-15 messages):
- Image generation with very basic context
- Random questions unrelated to chat history
- Standalone requests (jokes, facts, simple calculations)
- Requests that explicitly don't need context

## MODERATE FETCH (20-50 messages):
- Questions about recent topics
- Follow-up questions to recent discussion
- Image generation with minor context clues ("that thing we discussed")
- Requests mentioning "earlier" or "before" without specific timeframe

## LARGE FETCH (55-95 messages):
- Explicit requests to summarize conversation
- Image generation based on conversation context
- Questions about specific time ranges (look at message timing data)
- Requests containing: "our conversation", "what we talked about", "everything", "all"
- Complex context-dependent requests
- When user mentions timeframes that span multiple hours based on the timing data

## MAXIMAL FETCH (100 messages):
- Requests for full conversation summaries
- Image generation requiring full context
- Requests mentioning "everything we've discussed", "the whole conversation"
- Complex requests needing deep context

# TIME-BASED GUIDANCE:
- If request mentions "last hour": Check timing data, fetch messages within that timeframe
- If request mentions "today" or similar: Lean toward higher counts (70-100)
- If timing shows very sparse messages (>30 min gaps): Consider fetching more to get meaningful context

# OUTPUT:
Return ONLY a number between 5-100 in increments of 5.
Analyze the user's intent, not just keywords.
Take into account the timing data provided as closely as possible.
Only output the number, nothing else. No explanations. No punctuation. No extra text.`,
      },
      {
        role: "user",
        name: DiscordUtilityService.getUsernameNoSpaces(message),
        content: content,
      },
    ];
    const response = await AIService.generateText({
      conversation,
      type: "ANTHROPIC",
      model: config.ANTHROPIC_LANGUAGE_MODEL_CLAUDE_SONNET_4,
      label: "🧠 Fetch Count",
    });

    if (!response) return 20; // default to moderate fetch on API failure

    // Helper function to validate the number
    const isValidFetchCount = (num) =>
      !isNaN(num) && num >= 5 && num <= 100 && num % 5 === 0;

    // Try direct parse first
    let fetchCount = parseInt(response);

    // If direct parse fails, try extracting a number from the string
    if (!isValidFetchCount(fetchCount)) {
      // More specific regex: looks for numbers between 5-100
      const numberMatch = response.match(/\b(\d{1,2}|100)\b/);
      if (numberMatch) {
        fetchCount = parseInt(numberMatch[1]);
        console.log("Extracted number from response:", fetchCount);
      }
    }

    // Validate and return
    if (isValidFetchCount(fetchCount)) {
      return fetchCount;
    }

    console.error(
      "Invalid response from AI for message fetch count:",
      response,
    );
    return 20; // default to moderate fetch
  },
  /**
   * Shared helper for boolean detection via AI. Sends a system prompt + user content
   * to a lightweight model and parses a JSON {result: true/false} response.
   */
  async generateBooleanDetection({ systemPrompt, content, message, label }) {
    const conversation = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        name: DiscordUtilityService.getUsernameNoSpaces(message),
        content,
      },
    ];

    const response = await AIService.generateText({
      conversation,
      type: "OPENAI",
      model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO,
      label,
    });

    if (!response) return false;

    try {
      const parsed = JSON.parse(response.trim());
      return parsed.result === true;
    } catch {
      console.error("Unexpected response from AI (expected JSON):", response);
      return false;
    }
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

