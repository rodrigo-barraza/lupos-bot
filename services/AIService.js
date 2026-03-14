// Packages
import fs from "fs";
import path from "path";

// import { DateTime } from 'luxon';
// Config
import config from "#root/config.json" with { type: "json" };
// Formatters
import LogFormatter from "#root/formatters/LogFormatter.js";
// Wrappers
import ComfyUIService from "#root/services/ComfyUIService.js";
import MongoService from "#root/services/MongoService.js";
// Libraries
import UtilityLibrary from "#root/libraries/UtilityLibrary.js";
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
    // Base Text-to-Text Generation (Completion)
    async generateText({
        conversation,
        type = config.LANGUAGE_MODEL_TYPE,
        modelPerformance = config.LANGUAGE_MODEL_PERFORMANCE,
        temperature = config.LANGUAGE_MODEL_TEMPERATURE,
        tokens = config.LANGUAGE_MODEL_MAX_TOKENS,
        model = null,
        label = null,
    }) {
        const functionName = "generateText";
        let textResponse;
        let generateTextModel;
        let prismUsage = null;
        let prismEstimatedCost = null;
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

        // Pre-create conversation for server-side accumulation
        const discordMessage = CurrentService.getMessage();
        const discordUsername = discordMessage?.author?.username || "lupos";
        const channelName = discordMessage?.channel?.name || "direct-message";
        const convGuildName = discordMessage?.guild?.name || "DM";
        const convLabel = label || "Text Generation";
        const convTitle = `${convLabel} · ${convGuildName} / #${channelName}`;
        const systemMsg = conversation.find((m) => m.role === "system");
        const systemPrompt = systemMsg?.content || "";
        const nonSystemMessages = conversation.filter((m) => m.role !== "system");

        let conversationId = null;
        try {
            const conv = await PrismService.startConversation({
                title: convTitle,
                systemPrompt,
                settings: { model: usedModel, provider: type?.toLowerCase() },
                username: discordUsername,
            });
            conversationId = conv.id;
        } catch (startErr) {
            console.error("Start conversation failed:", startErr.message);
        }

        // Build user message for auto-append
        const lastUserMsg = nonSystemMessages.findLast((m) => m.role === "user");
        const userMessage = lastUserMsg
            ? {
                role: "user",
                content: lastUserMsg.content,
                name: lastUserMsg.name || discordUsername,
                timestamp: new Date().toISOString(),
            }
            : null;

        try {
            const prismResult = await PrismService.generateText({
                messages: conversation,
                type,
                model: usedModel,
                maxTokens: tokens,
                temperature,
                username: discordUsername,
                conversationId,
                userMessage,
            });

            textResponse = prismResult.text;
            prismUsage = prismResult.usage || null;
            prismEstimatedCost = prismResult.estimatedCost || null;
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
        CurrentService.addStep({
            model: usedModel,
            type,
            label: label || "Text Generation",
            duration: parseFloat(duration.toFixed(3)),
            inputType: "text",
            outputType: "text",
            systemPrompt: systemPrompt?.substring(0, 1000) || null,
            input: lastUserMsg?.content?.substring(0, 1000) || null,
            output: textResponse?.substring(0, 1000) || null,
        });

        if (localMongo) {
            const message = CurrentService.getMessage();
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
                guildName: convGuildName || "DM",
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

        // Finalize conversation metadata (messages already saved server-side via auto-append)
        if (conversationId) {
            PrismService.finalizeConversation({
                id: conversationId,
                title: convTitle,
                systemPrompt,
                settings: { model: usedModel, provider: type?.toLowerCase() },
                username: discordUsername,
            }).catch((err) =>
                console.error(
                    `Failed to finalize conversation for ${usedModel}:`,
                    err.message,
                ),
            );
        }

        return textResponse;
    },
    // Base Text-to-Image Generation (Diffusion)
    async generateImage(type, prompt, client, imageUrls = [], username = null) {
        let generatedImage;
        const localMongo = MongoService.getClient("local");
        let usedModel;
        let generatedText;
        let imageEstimatedCost = null;
        let userInputImageDataUrls = [];
        const start = performance.now();

        // Pre-create conversation for server-side accumulation
        const imgDiscordMessage = CurrentService.getMessage();
        const imgDiscordUsername = imgDiscordMessage?.author?.username || username || "lupos";
        const imgGuildName = imgDiscordMessage?.guild?.name || "DM";
        const imgChannelName = imgDiscordMessage?.channel?.name || "direct-message";

        const imgProviderName =
            type === "LOCAL" ? "local"
                : type === "GOOGLE" ? "google"
                    : type === "OPENAI" ? "openai"
                        : type?.toLowerCase() || "unknown";
        const imgTitle = `🖼️ Image Generation · ${imgGuildName} / #${imgChannelName}`;

        let conversationId = null;
        try {
            const conv = await PrismService.startConversation({
                title: imgTitle,
                systemPrompt: "",
                settings: { provider: imgProviderName },
                username: imgDiscordUsername,
            });
            conversationId = conv.id;
        } catch (startErr) {
            console.error("Start image conversation failed:", startErr.message);
        }

        // Build user message for auto-append
        const imgUserMsg = {
            role: "user",
            content: prompt,
            name: imgDiscordUsername,
            timestamp: new Date(start).toISOString(),
        };

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
                userInputImageDataUrls = imageObjects.map(
                    (img) => `data:${img.mimeType};base64,${img.imageData}`,
                );

                // Include user input images in the user message for conversation display
                if (userInputImageDataUrls.length > 0) {
                    imgUserMsg.images = userInputImageDataUrls;
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
                    conversationId,
                    userMessage: imgUserMsg,
                });

                if (prismResult.imageData) {
                    generatedImage = prismResult.imageData;
                    generatedText = prismResult.text;
                    imageEstimatedCost = prismResult.estimatedCost || null;
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
                userInputImageDataUrls = imageObjects.map(
                    (img) => `data:${img.mimeType};base64,${img.imageData}`,
                );

                // Include user input images in the user message for conversation display
                if (userInputImageDataUrls.length > 0) {
                    imgUserMsg.images = userInputImageDataUrls;
                }

                usedModel = "gpt-image-1.5";
                const prismResult = await PrismService.generateImage({
                    prompt,
                    provider: "openai",
                    model: usedModel,
                    images: imageObjects,
                    username: discordUsername,
                    conversationId,
                    userMessage: imgUserMsg,
                });

                generatedImage = prismResult.imageData;
                generatedText = prismResult.text;
                imageEstimatedCost = prismResult.estimatedCost || null;
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
            const imgDuration = parseFloat(duration.toFixed(3));
            CurrentService.addModel(usedModel);
            CurrentService.addModelType(type);
            CurrentService.addStep({
                model: usedModel,
                type,
                label: "Image Generation",
                duration: imgDuration,
                inputType: imageUrls.length > 0 ? "text+image" : "text",
                outputType: "image",
                input: prompt?.substring(0, 1000) || null,
                output: generatedText?.substring(0, 1000) || "[image]",
            });
        }

        // Image is now stored in MinIO via Prism's text-to-image route

        console.log(
            ...LogFormatter.generateImageSuccess({
                duration,
                prompt,
            }),
        );

        // Finalize conversation metadata (messages already saved server-side via auto-append)
        if (conversationId && generatedImage) {
            PrismService.finalizeConversation({
                id: conversationId,
                title: imgTitle,
                systemPrompt: "",
                settings: { model: usedModel, provider: imgProviderName },
                username: imgDiscordUsername,
            }).catch((err) =>
                console.error(`Failed to finalize image conversation: ${err.message}`),
            );
        }

        return generatedImage;
    },
    // Base Image-to-Text Generation (Captioning) — via Prism
    async generateVision(imageUrl, text) {
        const start = performance.now();
        try {
            const discordMessage = CurrentService.getMessage();
            const discordUsername = discordMessage?.author?.username || "lupos";

            const guildName = discordMessage?.guild?.name || "DM";
            const channelName = discordMessage?.channel?.name || "direct-message";
            const captionTitle = `👁️ Image Captioning · ${guildName} / #${channelName}`;

            // Pre-create conversation for server-side accumulation
            let visionConvId = null;
            try {
                const conv = await PrismService.startConversation({
                    title: captionTitle,
                    systemPrompt: "",
                    settings: { provider: "openai" },
                    username: discordUsername,
                });
                visionConvId = conv.id;
            } catch (startErr) {
                console.error("Start caption conversation failed:", startErr.message);
            }

            // Build user message for auto-append
            const captionUserMsg = {
                role: "user",
                content: text || "What's in this image?",
                images: [imageUrl],
                name: discordUsername,
                timestamp: new Date(start).toISOString(),
            };

            const result = await PrismService.captionImage({
                images: imageUrl,
                prompt: text || "What's in this image?",
                provider: "openai",
                username: discordUsername,
                conversationId: visionConvId,
                userMessage: captionUserMsg,
            });

            // Finalize conversation metadata
            if (visionConvId) {
                PrismService.finalizeConversation({
                    id: visionConvId,
                    title: captionTitle,
                    systemPrompt: "",
                    settings: { model: result.model || "gpt-4.1-mini", provider: "openai" },
                    username: discordUsername,
                }).catch((err) =>
                    console.error(`Failed to finalize caption conversation: ${err.message}`),
                );
            }

            return {
                response: { choices: [{ message: { content: result.text } }] },
                error: null,
            };
        } catch (error) {
            return { response: null, error };
        }
    },
    // Base Speech-to-Text Generation (Transcription) — via Prism
    async transcribeSpeech(audioUrl, messageId, index) {
        // Parse the URL to get just the filename without query parameters
        const url = new URL(audioUrl);
        const filename = path.basename(url.pathname);
        const voicesDir = path.join(import.meta.dirname, "../voices");
        // Create the voices directory if it doesn't exist
        if (!fs.existsSync(voicesDir)) {
            fs.mkdirSync(voicesDir, { recursive: true });
        }
        let audioFilePath;
        // Download the audio file
        if (messageId && index) {
            audioFilePath = path.join(voicesDir, `${messageId}-${index}-${filename}`);
        } else {
            function generateRandomId() {
                return Math.random().toString(36).substring(2, 10);
            }
            audioFilePath = path.join(voicesDir, `${generateRandomId()}-${filename}`);
        }
        const audioFile = await fetch(audioUrl);
        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        fs.writeFileSync(audioFilePath, audioBuffer);

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

        // Get Discord username for tracking
        const discordMessage = CurrentService.getMessage();
        const discordUsername = discordMessage?.author?.username || "lupos";

        // Transcribe via Prism
        const result = await PrismService.transcribeAudio({
            audioBuffer,
            mimeType,
            provider: "openai",
            username: discordUsername,
        });
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
                        await UtilityLibrary.generateFileHash(realImageUrl);
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
                const { hash, fileType } =
                    await UtilityLibrary.generateFileHash(audioUrl);
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
            model: config.ANTHROPIC_LANGUAGE_MODEL_CLAUDE_SONNET_4,
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
        const strippedContent = content.replace(/<@\d+>/g, "").trim().toLowerCase();
        const isImageRequest = /\b(draw|paint|sketch|create|generate|make|illustrate)\b/i.test(strippedContent);
        const refersToConversation = /\b(conversation|we talked|earlier|before|what was|what did|summarize|recap|context|going on|been discussing|you said|he said|she said|they said)\b/i.test(strippedContent);

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
    async generateTextIsAskingToGenerateImage(content, message) {
        const conversation = [
            {
                role: "system",
                content: `You are an expert at detecting image generation/editing requests. Output ONLY "yes" or "no".

Output "yes" if the message:
- Asks to draw, create, generate, or illustrate something
- Asks to edit, modify, redraw, or change an existing image
- Is replying to a Lupos message containing an image AND uses phrases like "make it", "change this", "turn into", etc.

Output "no" for all other messages.

CRITICAL: Pay special attention to replies to Lupos' image messages - these often contain implicit editing requests. Sometimes the message is long and the request is subtle, so analyze carefully.

Example requests that should return "yes":

Creation requests:
- "Draw a sunset over mountains"
- "Generate a cat wearing a hat"
- "Create a futuristic cityscape"
- "Make an image of a robot"
- "Redraw in the style of"

Editing requests:
- "Redraw with blue background"
- "Add a rainbow to this"
- "Make it look like a painting"
- "Change the background to a beach"
- "Turn this into an animal"
- "Do it in pixel art style"
- "Add more trees to the scene"

Implicit editing (common in replies):
- "Make it red"
- "Change this"
- "Add text saying hello"
- "Show me this image"`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            },
        ];

        let response = await AIService.generateText({
            conversation,
            type: "OPENAI",
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO,
            label: "🧠 Image Detection",
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === "yes") return true;
        if (response === "no") return false;

        console.error("Unexpected response from AI:", response);
        return false;
    },
    async generateTextIsAskingToDrawThemselves(content, message) {
        const conversation = [
            {
                role: "system",
                content: `You are an expert at detecting if a message is asking to draw, create, generate, or illustrate the user themselves. You will answer with a yes if the message is asking to draw, create, generate, or illustrate the user themselves. You will answer with a no if the message is not asking to draw, create, generate, or illustrate the user themselves. You will only output a yes or no, nothing else.

Examples that should return "yes":
"Draw me as a superhero"
"Can you create an image of me?"
"Make an image of myself"
"Make me as a cartoon character"
"What would I look like as a pirate?"

Examples that should return "no":
"Draw me a banana"
"Can you create an image of a cat?"
"Make an image of a landscape"
"Make me a logo"`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            },
        ];

        let response = await AIService.generateText({
            conversation,
            type: "OPENAI",
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO,
            label: "🧠 Self-Portrait Detection",
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === "yes") return true;
        if (response === "no") return false;

        console.error("Unexpected response from AI:", response);
        return false;
    },
    async generateTextIsAskingLewdOrNSFW(content, message) {
        const conversation = [
            {
                role: "system",
                content: `You are an expert at detecting if a message is lewd, NSFW, or inappropriate for image generation. You will answer with a yes if the message is lewd, NSFW, or inappropriate for image generation. You will answer with a no if the message is not lewd, NSFW, or inappropriate for image generation. You will only output a yes or no, nothing else.

Examples that should return "yes":
"Draw me a naked person"
"Can you create an image of two people fucking?"`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            },
        ];

        let response = await AIService.generateText({
            conversation,
            type: "OPENAI",
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO,
            label: "🧠 NSFW Detection",
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === "yes") return true;
        if (response === "no") return false;

        console.error("Unexpected response from AI:", response);
        return false;
    },
    /**
     * Extract person names from a message and match them to known participants.
     * Returns an array of matched user IDs.
     * @param {string} messageContent - The message text (e.g. "draw Rodrigo and Alex fighting")
     * @param {Array<{id: string, username: string, displayName: string}>} participants - Known participants
     * @param {object} message - Discord message object
     * @returns {Promise<string[]>} - Array of matched user IDs
     */
    async generateTextExtractMentionedNames(messageContent, participants, message) {
        if (!participants || participants.length === 0) return [];

        const participantList = participants
            .map((p) => `  {"id":"${p.id}","username":"${p.username}","displayName":"${p.displayName}"}`)
            .join(",\n");

        const conversation = [
            {
                role: "system",
                content: `You identify people mentioned BY NAME in a message and match them to a list of known users.

# RULES:
1. Only match names that clearly refer to a SPECIFIC PERSON the user wants drawn/depicted
2. "draw me" or "draw myself" = the message author, NOT a match (return empty)
3. Match by username OR displayName (case-insensitive, partial matches OK if unambiguous)
4. Do NOT match generic words that happen to be names (e.g. "draw me a rose" — Rose is not a person here)
5. Return ONLY a JSON array of matched user IDs, e.g. ["123","456"]
6. If no names match, return []

# KNOWN USERS:
[
${participantList}
]`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: messageContent,
            },
        ];

        const response = await AIService.generateText({
            conversation,
            type: "OPENAI",
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO,
            label: "🧠 Extract Mentioned Names",
        });

        if (!response) return [];

        try {
            // Extract JSON array from response (handle markdown code blocks)
            const jsonMatch = response.match(/\[.*\]/s);
            if (!jsonMatch) return [];
            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) return [];
            // Filter to only valid participant IDs
            const validIds = new Set(participants.map((p) => p.id));
            return parsed.filter((id) => validIds.has(String(id))).map(String);
        } catch {
            console.error("Failed to parse mentioned names response:", response);
            return [];
        }
    },
    /**
     * Detect if a draw request references a GROUP of people without naming them.
     * e.g. "draw the top 5 people here", "draw everyone", "draw the boys"
     * Returns the number of people to include (0 = not a group reference).
     * @param {string} messageContent - The message text
     * @param {object} message - Discord message object
     * @returns {Promise<number>} - Number of people to include (0 if not a group ref)
     */
    async generateTextDetectGroupReference(messageContent, message) {
        const conversation = [
            {
                role: "system",
                content: `You determine if a message is asking to draw/depict a GROUP of people from the chat.

# RULES:
1. If the message references a generic group (e.g. "the top 5 people here", "everyone", "all of us", "the boys", "the squad", "the chat", "everyone else"), return the NUMBER of people implied.
2. If a specific number is mentioned (e.g. "top 5", "the 3 of us"), return that number.
3. If it says "everyone" or "all" or "everyone else", return 99 (the caller will cap it).
4. If the message ALSO names specific people alongside a group reference (e.g. "draw @someone fighting everyone else"), STILL return the group number. The specific people are handled separately.
5. If the message ONLY names specific people with NO group reference at all, return 0.
6. If the message does NOT reference any people at all, return 0.
7. Return ONLY a single integer, nothing else.

# EXAMPLES:
- "draw the top 5 people here as captain planet" → 5
- "draw everyone in the chat as avengers" → 99
- "make us all into a group photo" → 99
- "draw the boys as superheroes" → 99
- "draw @AnimeClock and @BlueHippo fighting everyone else" → 99 (group reference "everyone else")
- "draw @Rodrigo surrounded by the boys" → 99 (group reference "the boys")
- "draw me and @someone" → 0 (specific people only, no group reference)
- "draw a sunset" → 0 (no people referenced)
- "draw kvz as a knight" → 0 (specific person named, no group reference)`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: messageContent,
            },
        ];

        const response = await AIService.generateText({
            conversation,
            type: "ANTHROPIC",
            model: config.ANTHROPIC_LANGUAGE_MODEL_FAST,
            label: "🧠 Detect Group Reference",
        });

        if (!response) return 0;

        const num = parseInt(response.trim(), 10);
        return isNaN(num) ? 0 : num;
    },
    async sanitizeImagePrompt(prompt, message) {
        const conversation = [
            {
                role: "system",
                content: `You are an expert at rephrasing prompts for image generation APIs (like Google Gemini) that have strict content policies. Your job is to rephrase prompts that would be REJECTED by these APIs.

# CONTENT THAT IMAGE APIs WILL REJECT (you MUST rephrase these):
1. **Historical atrocity figures**: Hitler, Stalin, Mussolini, Bin Laden, serial killers, dictators associated with genocide/mass murder
   - Replace with: a fictional absurd caricature (e.g. "a silly man with a tiny mustache" or "a cartoonish villain")
2. **Real-world violence**: shootings, bombings, stabbings, torture, gore, assault, terrorism
   - Replace with: cartoon/slapstick or exaggerated comic-book action (e.g. "a dramatic cartoon action scene with silly spray effects")
3. **Sexual/nude content**: nudity, sexual acts, seductive poses, explicit body parts
   - Replace with: artistic/clothed/abstract alternatives (e.g. "person wrapped in flowing silk fabrics")
4. **Hate symbols**: swastikas, confederate flags, KKK imagery, slurs
   - Replace with: absurd/harmless alternatives
5. **Real political figures in demeaning/violent scenarios**
   - Replace with: generic fictional characters or satirical caricatures
6. **Self-harm, suicide, drug use**
   - Replace with: harmless/humorous alternatives

# CONTENT THAT IS FINE (do NOT change):
- Fantasy violence (dragons fighting, sword battles, action heroes)
- Fictional characters (anime, cartoons, games, movies)
- Normal people in normal scenarios
- Animals, landscapes, food, objects, abstract art

# RULES:
- ALWAYS keep the core scene/concept (setting, other people, activity) but replace ONLY the problematic elements
- Make replacements FUNNY and ABSURD rather than just removing content
- Return ONLY the rephrased prompt text as a single paragraph
- NO explanations, commentary, prefixes, or meta-text
- If the prompt has NO problematic content, return it EXACTLY as-is with zero changes`,
            },
            {
                role: "user",
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: prompt,
            },
        ];

        const response = await AIService.generateText({
            conversation,
            type: "OPENAI",
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_MINI,
            label: "🧠 Prompt Sanitization",
        });

        if (!response) return prompt;
        return response.trim();
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
    async generateTextReplyNoImageGenerated(
        conversationForTextGeneration,
        assistantMessage,
        systemPrompt,
    ) {
        const conversation = [
            {
                role: "system",
                content: `# Image Generation Status
No image was generated for this message. You did NOT draw, paint, create, or produce any image.
CRITICAL: Do NOT claim or imply that you drew, created, or generated any image. You did not. No image is attached.
If the user asked you to draw something, you should detect that intent and respond conversationally, but an image WILL be generated separately by the system — do NOT describe what the image looks like or pretend you already made it.

${assistantMessage}

${systemPrompt}`,
            },
        ];

        conversation.push(...conversationForTextGeneration);

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: "POWERFUL",
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE,
            label: "💬 Reply",
        });
        return generatedText;
    },
    async generateTextReplyImageFailed(
        conversationForTextGeneration,
        assistantMessage,
        systemPrompt,
    ) {
        const conversation = [
            {
                role: "system",
                content: `# Image Generation Status
The user asked you to generate/draw an image, but it didn't work this time. No image was produced or attached.
## Your Task
Respond as if you're perfectly CAPABLE of drawing it, but get distracted roasting or bantering with the user first. Do NOT say "image generation failed" or anything technical.
RULES:
- Do NOT claim you already drew or created the image — you haven't.
- Do NOT describe what the image looks like — it doesn't exist yet.
- Respond with ONE punchy sentence that acknowledges their request but pivots into a roast, joke, or snarky remark about the person or situation.
- Examples of good tone: "Yeah I can draw that, but first tell me why you're so obsessed with [person]" or "I would but my artistic standards have limits" or "Sure but you're not ready for what I'm about to create"
- Keep it short (1-2 sentences max), in-character, and funny.

${assistantMessage}

${systemPrompt}`,
            },
        ];

        conversation.push(...conversationForTextGeneration);

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: "POWERFUL",
            tokens: 150,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE,
            label: "💬 Reply (Image Failed)",
        });
        return generatedText;
    },
    async generateTextReplyImageGenerated(
        conversationForTextGeneration,
        assistantMessage,
        systemPrompt,
        promptForImagePromptGeneration,
        drawnUserMentions = [],
    ) {
        const mentionsList = drawnUserMentions.length > 0
            ? `\n## MANDATORY: Tag these users in your response\nYou MUST start your response by tagging these users: ${drawnUserMentions.join(" ")}\nExample: "${drawnUserMentions.join(" ")} [your one-sentence remark]"`
            : "";

        const conversation = [
            {
                role: "system",
                content: `# Generated Image Context
An image was generated and attached to this message based on the following prompt: "${promptForImagePromptGeneration}"
## Your Task
The image is already attached — DO NOT describe what's in it. The user can see it.
Instead, write ONE short sentence (max 15-20 words) as a casual remark, roast, or quip about the image or the request.
Keep it punchy, sarcastic, and in-character. The image speaks for itself.
Do NOT mention the image generation process, the prompt, or technical details.
${mentionsList}

${assistantMessage}

${systemPrompt}`,
            },
        ];

        conversation.push(...conversationForTextGeneration);

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: "POWERFUL",
            tokens: 100,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE,
            label: "💬 Reply (Image)",
        });
        return generatedText;
    },
    async generateTextPromptForImagePromptGeneration(
        conversationForTextGeneration,
        systemPrompt,
        shouldRedrawImage,
        edittedMessageCleanContent,
    ) {
        const systemPromptForImagePromptGeneration = `# Image Prompt Generation
- You are part of a multi-modal AI bot that can generate and edit images.
- Your job is to generate an image from a text prompt only.
- Your specific task here is to create detailed prompts for image generation or editing.
- Use the conversation context and user requests to inform your prompt creation.
- Generate a detailed image prompt based on the conversation context and user request.
- Always try to aim for a highly detailed and realistic image prompt style, unless specifically asked for a different style.

## Priority Rules:
- If generating an image of a person: 
  1. Use their avatar and banner descriptions as the PRIMARY reference (if available)
  2. Then incorporate any other details relevant to the conversation context
  3. Maintain parentheses after the person's name to identify the image subject
- Address the specific user request
- Incorporate relevant conversation context

# Output Requirements:
- A single continuous paragraph
- No line breaks, formatting, or markup
- No explanations, commentary, or additional text
- Only the image prompt itself
- Detailed and descriptive language that captures all essential elements
- Do not talk in the third person, just provide the prompt

Generate the editing prompt now.

${systemPrompt}`;

        const systemPromptForImageToImagePromptGeneration = `# Image Edit Prompt Generator
- You are part of a multi-modal AI bot that can generate and edit images.
- Your job is to generate an image edit prompt from a text prompt and an existing image.
- You have at least 1 existing image to reference and edit.
- Your specific task here is to create detailed prompts for image editing based on an existing image and user modification requests.
- Use the conversation context, user requests, and details from the existing image to inform your prompt creation.
- Generate a detailed image editing prompt based on the existing image, conversation context, and user's modification request.
- Always try to aim for a highly detailed and realistic image prompt style, unless specifically asked for a different style.

## Priority Rules:
- If redrawing an image with a person: 
  1. Use their avatar and banner descriptions as the PRIMARY reference (if available)
  2. Then incorporate any other details relevant to the conversation context
  3. Maintain parentheses after the person's name to identify the image subject
- Preserve all existing image elements EXCEPT those explicitly requested to be changed
- If editing a person: Use their avatar and banner descriptions as the PRIMARY reference for any modifications (if available)
- Clearly specify what elements to modify and how
- Incorporate relevant conversation context for the edits
- Make sure you mention to keep unchanged elements intact

## Output Requirements:
- Single continuous paragraph
- No line breaks, formatting, or markup
- No explanations, commentary, or additional text
- Only the image editing prompt itself
- Explicitly state what to change and what to keep
- Use precise descriptive language for modifications
- Do not talk in the third person, just provide the prompt

Generate the editing prompt now.

${systemPrompt}`;

        const conversation = [
            {
                role: "system",
                content: "",
            },
        ];

        if (shouldRedrawImage) {
            conversation[0].content = systemPromptForImageToImagePromptGeneration;
        } else {
            conversation[0].content = systemPromptForImagePromptGeneration;
        }
        // conversation.push(conversationForTextGeneration[conversationForTextGeneration.length - 1]);
        // Instead of pushing the reference directly
        // This creates a shallow copy of the object
        conversation.push({
            ...conversationForTextGeneration[
            conversationForTextGeneration.length - 1
            ],
        });

        if (edittedMessageCleanContent) {
            conversation[1].content = `${edittedMessageCleanContent}`;
        }

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: "POWERFUL",
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE,
            label: "🧠 Image Prompt",
        });

        return generatedText;
    },
};

export default AIService;
