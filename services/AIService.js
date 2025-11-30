// Packages
const fs = require('fs');
const path = require('path');
const BigNumber = require('bignumber.js');
const { DateTime } = require('luxon');
// Config
const config = require('../config.json');
// Formatters
const LogFormatter = require('../formatters/LogFormatter.js');
// Wrappers
const ComfyUIWrapper = require('../wrappers/ComfyUIWrapper.js');
const OpenAIWrapper = require('../wrappers/OpenAIWrapper.js');
const LocalAIWrapper = require('../wrappers/LocalAIWrapper.js');
const AnthrophicWrapper = require('../wrappers/AnthropicWrapper.js');
const GoogleAIWrapper = require('../wrappers/GoogleAIWrapper.js');
const MongoWrapper = require('../wrappers/MongoWrapper.js');
// Libraries
const UtilityLibrary = require('../libraries/UtilityLibrary.js');
// Services
const CurrentService = require('./CurrentService.js');
const DiscordUtilityService = require('./DiscordUtilityService.js');
// Maps
const ModelsMap = require('../maps/ModelsMap.js');

function calculateImageTokens(width, height) {
    // If both dimensions are <= 384, use 258 tokens
    if (width <= 384 && height <= 384) {
        return 258;
    }

    // Calculate tile size
    const smallerDimension = Math.min(width, height);
    let tileSize = smallerDimension / 1.5;

    // Adjust tile size to be between 256 and 768 pixels
    tileSize = Math.max(256, Math.min(768, tileSize));

    // Calculate number of tiles in each dimension
    const tilesX = Math.ceil(width / tileSize);
    const tilesY = Math.ceil(height / tileSize);

    // Total tiles (crop tiles)
    const cropTiles = tilesX * tilesY;

    // When tiling is needed, include 1 base image tile plus the crop tiles
    const totalTiles = 1 + cropTiles;

    // Each tile uses 258 tokens
    return totalTiles * 258;
}

function saveBinaryFile(fileName, content) {
    fs.writeFile(fileName, content, (err) => {
        if (err) {
            console.error(`Error writing file ${fileName}:`, err);
            return;
        }
        console.log(`File ${fileName} saved to file system.`);
    });
}

function saveFile(encodedImageDataBase64, usedModel, username = null) {
    const timestamp = DateTime.now().toFormat('yyyy-MM-dd--HH-mm-ss');
    const modelName = usedModel || 'unknown-model';
    const fileName = `${timestamp}-${modelName}`;
    const fileExtension = 'png';
    const buffer = Buffer.from(encodedImageDataBase64, 'base64');

    // Create the images directory structure
    const imagesDir = path.join(__dirname, '../images');
    let fullPath;

    if (username) {
        const userDir = path.join(imagesDir, username);
        // Create user directory if it doesn't exist
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        fullPath = path.join(userDir, `${fileName}.${fileExtension}`);
    } else {
        // Create images directory if it doesn't exist
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        fullPath = path.join(imagesDir, `${fileName}.${fileExtension}`);
    }

    saveBinaryFile(fullPath, buffer);
    console.log(`Image saved to: ${fullPath}`);
}


function assembleConversation(systemMessage, userMessage, message) {
    let conversation = [
        {
            role: 'system',
            content: systemMessage
        },
        {
            role: 'user',
            name: DiscordUtilityService.getUsernameNoSpaces(message) || 'Default',
            content: userMessage,
        }
    ]
    return conversation;
}

async function tryModelsWithSameIntelligence({
    type,
    initialModel,
    conversation,
    tokens,
    temperature,
    wrapperFunction
}) {
    // Track which models we've tried
    const triedModels = new Set();
    let success = false;
    let textResponse = null;
    let finalModel = initialModel;

    // Get the model type map for the provider
    const modelTypeMap = ModelsMap.get(type);
    if (!modelTypeMap) {
        console.error('Model type not found in ModelsMap:', type);
        return { text: null, model: null, error: `Model type ${type} not found` };
    }

    // Get the initial model's details
    const initialModelDetails = modelTypeMap.get(initialModel);
    if (!initialModelDetails) {
        console.error('Model not found in ModelsMap:', initialModel);
        return { text: null, model: null, error: `Model ${initialModel} not found` };
    }

    // Get all models with the same intelligence rank
    const sameIntelligenceModels = [];
    for (const [modelName, modelDetails] of modelTypeMap.entries()) {
        if (modelDetails.intelligenceRank === initialModelDetails.intelligenceRank) {
            sameIntelligenceModels.push(modelName);
        }
    }

    // Ensure the initial model is tried first
    const orderedModels = [
        initialModel,
        ...sameIntelligenceModels.filter(m => m !== initialModel)
    ];

    // Try each model until one succeeds
    for (const modelToTry of orderedModels) {
        if (triedModels.has(modelToTry)) {
            continue; // Skip already tried models
        }

        triedModels.add(modelToTry);
        finalModel = modelToTry;

        try {
            const result = await wrapperFunction(conversation, modelToTry, tokens, temperature);

            // Handle different response formats
            if (type === 'ANTHROPIC') {
                const { text, error } = result;
                if (!error && text) {
                    textResponse = text;
                    success = true;
                    break;
                } else {
                    console.warn(`Error with model ${modelToTry}:`, error);
                }
            } else {
                // For OpenAI and LOCAL, they typically return the text directly or throw
                if (result) {
                    textResponse = result;
                    success = true;
                    break;
                }
            }
        } catch (error) {
            console.warn(`Error with model ${modelToTry}:`, error);
            // Continue to next model
        }
    }

    if (!success) {
        console.error('All models failed for intelligence rank:', initialModelDetails.intelligenceRank);
        console.error('Tried models:', Array.from(triedModels));
        return {
            text: null,
            model: null,
            error: `All models failed. Tried: ${Array.from(triedModels).join(', ')}`
        };
    }

    return { text: textResponse, model: finalModel, error: null };
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
    }) {
        const functionName = 'generateText';
        let textResponse;
        let generateTextModel;
        let inputTokenCount = 0;
        let outputTokenCount = 0;
        const start = performance.now();
        const localMongo = MongoWrapper.getClient('local');

        // Determine initial model based on type and performance
        if (type === 'OPENAI') {
            if (model) {
                generateTextModel = model;
            } else if (modelPerformance === 'LOW') {
                generateTextModel = config.LANGUAGE_MODEL_OPENAI_LOW;
            } else {
                generateTextModel = modelPerformance === 'POWERFUL' ?
                    config.LANGUAGE_MODEL_OPENAI :
                    modelPerformance === 'FAST' ?
                        config.FAST_LANGUAGE_MODEL_OPENAI :
                        config.LANGUAGE_MODEL_OPENAI;
            }
        } else if (type === 'ANTHROPIC') {
            generateTextModel = modelPerformance === 'FAST' ?
                config.ANTHROPIC_LANGUAGE_MODEL_FAST :
                config.ANTHROPIC_LANGUAGE_MODEL_SMART;

            // Handle empty content for Anthropic
            if (conversation[conversation.length - 1].content === "") {
                conversation[conversation.length - 1].content = "hey";
            }
        } else if (type === 'LOCAL') {
            generateTextModel = modelPerformance === 'FAST' ?
                config.FAST_LANGUAGE_MODEL_LOCAL :
                config.LANGUAGE_MODEL_LOCAL;
        }

        // Map wrapper functions for each type
        const wrapperFunctions = {
            'OPENAI': OpenAIWrapper.generateOpenAITextResponse,
            'ANTHROPIC': AnthrophicWrapper.generateAnthropicTextResponse,
            'LOCAL': LocalAIWrapper.generateLocalAITextResponse
        };

        const wrapperFunction = wrapperFunctions[type];
        if (!wrapperFunction) {
            console.error('Unknown model type:', type);
            return null;
        }

        // Try models with automatic fallback
        const { text, model: usedModel, error } = await tryModelsWithSameIntelligence({
            type,
            initialModel: generateTextModel,
            conversation,
            tokens,
            temperature,
            wrapperFunction
        });

        if (error) {
            console.error(`Failed to generate text with ${type}:`, error);
            return null;
        }

        textResponse = text;
        generateTextModel = usedModel; // Update to the model that actually worked

        // Log successful model if different from initial
        if (usedModel !== generateTextModel) {
            console.log(`Fallback successful: Used ${usedModel} instead of ${generateTextModel}`);
        }

        // count characters in conversation
        let inputCharacterCount = 0;
        for (let i = 0; i < conversation.length; i++) {
            inputCharacterCount += conversation[i].content.length;
        }

        const outputCharacterCount = textResponse.length;

        const end = performance.now();
        const duration = end - start;

        inputTokenCount = inputCharacterCount / 4;
        outputTokenCount = outputCharacterCount / 4;

        if (inputTokenCount > 0 && inputTokenCount < 1) {
            inputTokenCount = 1;
        }
        if (outputTokenCount > 0 && outputTokenCount < 1) {
            outputTokenCount = 1;
        }

        let inputTokenCost = new BigNumber(0);
        let outputTokenCost = new BigNumber(0);
        let totalCost = new BigNumber(0);
        const modelTypeMap = ModelsMap.get(type);
        const modelDetails = modelTypeMap?.get(usedModel);
        if (modelDetails) {
            let pricingInput = new BigNumber(modelDetails.pricing.input);
            let pricingOutput = new BigNumber(modelDetails.pricing.output);
            pricingInput = pricingInput.dividedBy(1000000).multipliedBy(inputTokenCount);
            pricingOutput = pricingOutput.dividedBy(1000000).multipliedBy(outputTokenCount);
            inputTokenCost = pricingInput.toFixed(10);
            outputTokenCost = pricingOutput.toFixed(10);
            const rawTotalCost = pricingInput.plus(pricingOutput);
            totalCost = rawTotalCost.toFixed(10);

            CurrentService.addToTextTotalCost(rawTotalCost);
            CurrentService.addToTextTotalInputTokens(inputTokenCount);
            CurrentService.addToTextTotalInputCost(inputTokenCost);
            CurrentService.addToTextTotalOutputTokens(outputTokenCount);
            CurrentService.addToTextTotalOutputCost(outputTokenCost);
            CurrentService.addModel(usedModel);
            CurrentService.addModelType(type);
        }

        if (localMongo) {
            const message = CurrentService.getMessage();
            const messageId = message?.id;
            const user = message.author;
            const userId = user.id;
            const userName = user.username;
            const guildId = message.guild?.id;
            const guildName = message.guild?.name;

            // Save the generated text and its metadata to the database
            const db = localMongo.db("lupos");
            const collection = db.collection('MetricsTextGeneration');
            await collection.insertOne({
                inputTokens: inputTokenCount,
                outputTokens: outputTokenCount,
                inputCost: inputTokenCost,
                outputCost: outputTokenCost,
                totalCost: totalCost,
                model: usedModel,
                modelType: type,
                promptType: 'TEXT',
                input: conversation,
                output: textResponse,
                guildId: guildId || 'DM',
                guildName: guildName || 'DM',
                userId: userId,
                userName: userName,
                messageId: messageId || null,
            });
        }

        console.log(...LogFormatter.generateTextSuccess({
            functionName,
            duration,
            inputCharacterCount,
            inputTokenCost,
            inputTokenCount,
            modelName: usedModel,
            modelType: type,
            outputCharacterCount,
            outputTokenCost: outputTokenCost,
            outputTokenCount: outputTokenCount,
            totalCost: totalCost,
        }));

        return textResponse;
    },
    // Base Text-to-Image Generation (Diffusion)
    async generateImage(type, prompt, client, imageUrls = [], username = null) {
        let inputTokenCount = 0;
        let generatedImage;
        let totalInputCost = 0;
        let totalOutputCost = 0;
        let totalCost = 0;
        let localMongo = MongoWrapper.getClient('local');
        let usedModel;
        let generatedText;
        const start = performance.now();

        if (type === 'LOCAL') {
            try {
                console.log(...LogFormatter.generateImageStart({ prompt }));
                await ComfyUIWrapper.checkComfyUIWebsocketStatus();
                if (prompt) {
                    usedModel = 'FLUX.1-dev';
                    generatedImage = await ComfyUIWrapper.generateComfyUIImage(prompt, client);
                }
            } catch (error) {
                console.error(...LogFormatter.error('generateImage', error));
            }
        } else if (type === 'GOOGLE') {
            let hasError = false;
            try {
                let images = [];
                if (imageUrls.length) {
                    for (const url of imageUrls) {
                        const fetchImageUrlResponse = await fetch(url);
                        const imageAsBuffer = await fetchImageUrlResponse.arrayBuffer();
                        const imageAsBase64 = Buffer.from(imageAsBuffer).toString('base64');
                        const imageType = fetchImageUrlResponse.headers.get('content-type');
                        images.push({ data: imageAsBase64, type: imageType });
                    }
                }
                usedModel = 'gemini-3-pro-image-preview';
                const { response, error } = await GoogleAIWrapper.generateGoogleAIImage(prompt, images);

                if (error) {
                    console.log('Google AI Image Generation failed, falling back to LOCAL.');
                    usedModel = 'FLUX.1-dev';
                    const generatedImageResponseLocal = await AIService.generateImage('LOCAL', prompt, client, imageUrls, username);
                    generatedImage = generatedImageResponseLocal;
                } else {
                    const modelTypeMap = ModelsMap.get('GOOGLE');
                    const modelDetails = modelTypeMap?.get('gemini-3-pro-image-preview');
                    let rawAllPricingInput = new BigNumber(modelDetails.pricing.input);
                    rawAllPricingInput = rawAllPricingInput.dividedBy(1000000).multipliedBy(response.allInputTokenCount);
                    let rawTextPricingOutput = new BigNumber(modelDetails.pricing.output);
                    rawTextPricingOutput = rawTextPricingOutput.dividedBy(1000000).multipliedBy(response.textOutputTokenCount);

                    let rawImagePricingOutput = new BigNumber(modelDetails.imagePricing.output);
                    rawImagePricingOutput = rawImagePricingOutput.dividedBy(1000000).multipliedBy(calculateImageTokens(1024, 1024)); // Assuming 1024x1024 image for pricing
                    let rawAllPricingOutput = rawTextPricingOutput.plus(rawImagePricingOutput);
                    let rawTotalCost = rawAllPricingInput.plus(rawAllPricingOutput);

                    totalInputCost = rawAllPricingInput.toFixed(10);
                    totalOutputCost = rawAllPricingOutput.toFixed(10);
                    totalCost = rawTotalCost.toFixed(10);

                    generatedImage = response.imageData;
                    inputTokenCount = response.allInputTokenCount;
                    generatedText = response.text;
                }
            } catch (error) {
                console.error(...LogFormatter.error('generateImage', error));
                hasError = true;
            }
            if (hasError) {
                console.error('Falling back to LOCAL image generation.');
                const generatedImageResponseLocal = await AIService.generateImage('LOCAL', prompt, client, imageUrls, username);
                generatedImage = generatedImageResponseLocal;
            }
        }

        if (localMongo && generatedImage) {
            const message = CurrentService.getMessage();
            const messageId = message?.id;
            const user = message.author;
            const userId = user.id;
            const userName = user.username;
            const guildId = message.guild?.id;
            const guildName = message.guild?.name;

            const end = performance.now();
            const duration = end - start;

            // Save the generated image and its metadata to the database
            const db = localMongo.db("lupos");
            const collection = db.collection('MetricsImageGeneration');
            await collection.insertOne({
                model: usedModel,
                inputText: prompt,
                outputText: generatedText,
                inputImages: imageUrls.length,
                guildId: guildId || 'DM',
                guildName: guildName || 'DM',
                userId: userId,
                userName: userName,
                messageId: messageId || null,
                duration,
                inputTokenCount,
                totalInputCost,
                totalOutputCost,
                totalCost
            });
        }

        saveFile(generatedImage, usedModel, username);

        const end = performance.now();
        const duration = end - start;

        console.log(...LogFormatter.generateImageSuccess({
            duration,
            prompt,
            inputTokenCount,
            totalCost,
        }));

        return generatedImage;
    },
    // Base Image-to-Text Generation (Captioning)
    async generateVision(imageUrl, text) {
        const { response, error } = await OpenAIWrapper.generateVisionResponse(imageUrl, text);
        return { response, error };
    },
    // Base Speech-to-Text Generation (Transcription)
    async transcribeSpeech(audioUrl, messageId, index) {
        // Parse the URL to get just the filename without query parameters
        const url = new URL(audioUrl);
        const filename = path.basename(url.pathname);
        const voicesDir = path.join(__dirname, '../voices');
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
        const audioBuffer = await audioFile.arrayBuffer();
        fs.writeFileSync(audioFilePath, Buffer.from(audioBuffer));
        const audioFileObject = fs.createReadStream(audioFilePath);

        // Create a read stream for the transcription
        let transcription = await OpenAIWrapper.speechToText(audioFileObject);
        transcription = transcription.trim().replace(/\n+/g, ' ');
        return transcription;
    },
    // Caption images and store data in MongoDB
    async captionImages(imageUrls, localMongo, type) {
        // type = ['image', 'emoji', 'sticker', video']
        let images = [];
        let imagesMap = new Map();
        if (
            type === 'IMAGE' ||
            type === 'EMOJI' ||
            type === 'STICKER' ||
            type === 'VIDEO' ||
            type === 'AVATAR' ||
            type === 'BANNER' ||
            type === 'SMALL'
        ) {
            const db = localMongo.db("lupos");
            let collection;
            let prompt = `Describe this ${type.toLowerCase()}. Make no mention about the quality, resolution, or pixelation.`;

            if (type === 'IMAGE') {
                collection = db.collection('ImageCaptions');
            } else if (type === 'EMOJI') {
                collection = db.collection('EmojiCaptions');
            } else if (type === 'STICKER') {
                collection = db.collection('StickerCaptions');
            } else if (type === 'VIDEO') {
                collection = db.collection('VideoCaptions');
            } else if (type === 'AVATAR') {
                collection = db.collection('AvatarCaptions');
            } else if (type === 'BANNER') {
                collection = db.collection('BannerCaptions');
            } else if (type === 'SMALL') {
                collection = db.collection('SmallCaptions');
                prompt = `Describe this image in a short sentence, 10 words or less. Make no mention about the quality, resolution, or pixelation.`;
            }


            if (imageUrls?.length) {
                const isObject = imageUrls[0]?.url;
                for (const imageUrl of imageUrls) {
                    let realImageUrl = isObject ? imageUrl.url : imageUrl;
                    const userId = isObject ? imageUrl.userId : null;


                    const { hash, fileType } = await UtilityLibrary.generateFileHash(realImageUrl);
                    const existingImage = await collection.findOne({ hash });
                    if (!existingImage) {
                        const { response } = await AIService.generateVision(realImageUrl, prompt);
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
        let transcriptionsMap = new Map();
        const db = localMongo.db("lupos");
        const collection = db.collection('AudioTranscriptions');
        let existingAudio;
        if (audioUrls?.length) {
            let index = 0;
            for (const audioUrl of audioUrls) {
                index++;
                const { hash, fileType } = await UtilityLibrary.generateFileHash(audioUrl);
                existingAudio = await collection.findOne({ hash });

                if (!existingAudio) {
                    const transcription = await AIService.transcribeSpeech(audioUrl, messageId, index);
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
    //         await ComfyUIWrapper.checkComfyUIWebsocketStatus();
    //         let currentTime = new Date().getTime();
    //         if (text) {
    //             generatedImage = await ComfyUIWrapper.generateComfyUIImageToImage(text, imageUrl, denoisingStrength);
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
        let summary = '';
        const systemContent = `You are an expert at summarizing the text that is given to you in two to three words. Start with an emoji. Do not use any other formatting, just give the emoji and the two to three words.`;
        const conversation = assembleConversation(systemContent, messageContent, message);
        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: 'POWERFUL',
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE,
            // model,
            // localMongo,
            // replyMessageStartTime,
            // guildId,
            // userId,
            // userName,
        });
        // trim generatedText to 128 characters
        summary = generatedText.substring(0, 128);
        return summary;
    },
    async generateTextCustomEmojiReactFromMessage(message, localMongo) {
        const client = message.client;
        const guild = message.guild;
        const bot = client.user;
        const content = message.content;
        const modifiedMessageContent = content.replace(`<@${bot.id}>`, '');

        let guildEmojiList;
        let serverEmojisArray = [];

        if (guild) {
            const serverEmojis = client.guilds.cache.get(guild.id).emojis.cache;
            serverEmojisArray = Array.from(serverEmojis.values());
            if (serverEmojisArray.length) {
                guildEmojiList = `# CUSTOM EMOJIS AVAILABLE:\n`;
                guildEmojiList += serverEmojisArray.map(emoji => emoji.name).join(', ');
                guildEmojiList += `\n\n`;
            }
        }

        const systemContent =
            `You are an expert at generating emoji reactions to text messages. 

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

        const conversation = assembleConversation(systemContent, modifiedMessageContent, message);

        const generatedText = await AIService.generateText({
            localMongo: localMongo,
            conversation: conversation,
            type: 'ANTHROPIC',
            model: config.ANTHROPIC_LANGUAGE_MODEL_CLAUDE_SONNET_4,
        });

        // Clean up the response - remove any extra whitespace, newlines, or formatting
        let cleanedResponse = generatedText.trim().replace(/[\n\r]/g, '');

        if (serverEmojisArray.length) {
            // check if its emoji or custom emoji
            const isCustomEmoji = serverEmojisArray.some(emoji => emoji.name === cleanedResponse);
            if (isCustomEmoji) {
                // <:blobreach:123456789012345678>
                // if its custom, wrap it in <:
                cleanedResponse = `${serverEmojisArray.find(emoji => emoji.name === cleanedResponse).id}`;
            }
        }


        return cleanedResponse;
    },
    async generateTextDetermineHowManyMessagesToFetch(content, message, messageCountText) {
        let conversation = [
            {
                role: 'system',
                content:
                    `You are a message fetch optimizer for a multi-modal Discord AI bot. Your role is to determine the optimal number of historical messages to fetch based on the user's request.

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
Only output the number, nothing else. No explanations. No punctuation. No extra text.`
            },
            {
                role: 'user',
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            }
        ]
        let response = await AIService.generateText({
            conversation,
            type: 'ANTHROPIC',
            model: config.ANTHROPIC_LANGUAGE_MODEL_CLAUDE_SONNET_4
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
                console.log('Extracted number from response:', fetchCount);
            }
        }

        // Validate and return
        if (isValidFetchCount(fetchCount)) {
            return fetchCount;
        }

        console.error('Invalid response from AI for message fetch count:', response);
        return 20; // default to moderate fetch
    },
    async generateTextIsAskingToGenerateImage(content, message) {
        let conversation = [
            {
                role: 'system',
                content:
                    `You are an expert at detecting image generation/editing requests. Output ONLY "yes" or "no".

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
- "Show me this image"`
            },
            {
                role: 'user',
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            }
        ]

        let response = await AIService.generateText({
            conversation,
            type: 'OPENAI',
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === 'yes') return true;
        if (response === 'no') return false;

        console.error('Unexpected response from AI:', response);
        return false;
    },
    async generateTextIsAskingToDrawThemselves(content, message) {
        let conversation = [
            {
                role: 'system',
                content:
                    `You are an expert at detecting if a message is asking to draw, create, generate, or illustrate the user themselves. You will answer with a yes if the message is asking to draw, create, generate, or illustrate the user themselves. You will answer with a no if the message is not asking to draw, create, generate, or illustrate the user themselves. You will only output a yes or no, nothing else.

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
"Make me a logo"`
            },
            {
                role: 'user',
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            }
        ]

        let response = await AIService.generateText({
            conversation,
            type: 'OPENAI',
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === 'yes') return true;
        if (response === 'no') return false;

        console.error('Unexpected response from AI:', response);
        return false;
    },
    async generateTextIsAskingLewdOrNSFW(content, message) {
        let conversation = [
            {
                role: 'system',
                content:
                    `You are an expert at detecting if a message is lewd, NSFW, or inappropriate for image generation. You will answer with a yes if the message is lewd, NSFW, or inappropriate for image generation. You will answer with a no if the message is not lewd, NSFW, or inappropriate for image generation. You will only output a yes or no, nothing else.

Examples that should return "yes":
"Draw me a naked person"
"Can you create an image of two people fucking?"`
            },
            {
                role: 'user',
                name: DiscordUtilityService.getUsernameNoSpaces(message),
                content: content,
            }
        ]

        let response = await AIService.generateText({
            conversation,
            type: 'OPENAI',
            model: config.OPENAI_LANGUAGE_MODEL_GPT5_NANO
        });

        if (!response) return false;

        response = response.trim().toLowerCase();

        if (response === 'yes') return true;
        if (response === 'no') return false;

        console.error('Unexpected response from AI:', response);
        return false;
    },
    async generateTextFromUserConversation(userName, cleanUserName, userMessagesAsText) {
        const conversation = [
            {
                role: 'system',
                content:
                    `You are an expert at providing concise, accurate descriptions of messages. Analyze the content sent to you and create a detailed summary of what ${userName} is discussing. Focus on being precise and direct while capturing all key points and context from their message.
                
As the output, I want you to provide the descriptions in dash list form, without using any bold, italics, or any other formatting. You can have nested lists, but no more than 3 levels deep. Do not announce that you are generating a response, just provide the descriptions. Seperate each line with a new line, not two new lines.`
            },
            {
                role: 'user',
                name: cleanUserName,
                content: `Recent messages from ${userName}: ${userMessagesAsText}`,
            }
        ];
        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: 'OPENAI',
            model: config.OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,
        });
        return generatedText;
    },
    async generateTextReplyNoImageGenerated(conversationForTextGeneration, assistantMessage, systemPrompt) {
        const conversation = [
            {
                role: 'system',
                content:
                    `# Generated Image Context
You did not generate any images for this message, as they were not requested nor required.
You might have generated images in previous messages, but not for this one.

${assistantMessage}

${systemPrompt}`
            },
        ];

        conversation.push(...conversationForTextGeneration);

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: 'POWERFUL',
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE
        });
        return generatedText;
    },
    async generateTextReplyImageGenerated(conversationForTextGeneration, assistantMessage, systemPrompt, promptForImagePromptGeneration) {
        const conversation = [
            {
                role: 'system',
                content:
                    `# Generated Image Context
An image was generated and attached to this message based on the following prompt: "${promptForImagePromptGeneration}"
## Your Task
Incorporate visual details from the generated image into your response to enhance the description and provide a richer experience for the user. But do not make a mention about the imgage generation process itself, nor the image prompt.

${assistantMessage}

${systemPrompt}`
            },
        ];

        conversation.push(...conversationForTextGeneration);

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: 'POWERFUL',
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE
        });
        return generatedText;
    },
    async generateTextPromptForImagePromptGeneration(
        conversationForTextGeneration,
        systemPrompt,
        shouldRedrawImage,
        edittedMessageCleanContent,
    ) {
        const systemPromptForImagePromptGeneration =
            `# Image Prompt Generation
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

        const systemPromptForImageToImagePromptGeneration =
            `# Image Edit Prompt Generator
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
                role: 'system',
                content: ''
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
        conversation.push({ ...conversationForTextGeneration[conversationForTextGeneration.length - 1] });

        if (edittedMessageCleanContent) {
            conversation[1].content = `${edittedMessageCleanContent}`;
        }

        const generatedText = await AIService.generateText({
            conversation: conversation,
            type: config.LANGUAGE_MODEL_TYPE,
            modelPerformance: 'POWERFUL',
            tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
            temperature: config.LANGUAGE_MODEL_TEMPERATURE
        });

        return generatedText;
    },

};

module.exports = AIService;
