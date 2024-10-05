require('dotenv/config');
const luxon = require('luxon');
const moment = require('moment');
const AlcoholService = require('../services/AlcoholService.js');
const UtilityLibrary = require('../libraries/UtilityLibrary.js');
const MessageService = require('../services/MessageService.js');
const MoodService = require('../services/MoodService.js');
const ComfyUIWrapper = require('../wrappers/ComfyUIWrapper.js');
const DiscordWrapper = require('../wrappers/DiscordWrapper.js');
const OpenAIWrapper = require('../wrappers/OpenAIWrapper.js');
const LocalAIWrapper = require('../wrappers/LocalAIWrapper.js');
const BarkAIWrapper = require('../wrappers/BarkAIWrapper.js');
const AnthrophicWrapper = require('../wrappers/AnthropicWrapper.js');
const PuppeteerWrapper = require('../wrappers/PuppeteerWrapper.js');
const MessageConstant = require('../constants/MessageConstants.js');

const {
    LANGUAGE_MODEL_TYPE,
    RECENT_MESSAGES_LIMIT,
    IMAGE_PROMPT_LANGUAGE_MODEL_TYPE,
    IMAGE_PROMPT_LANGUAGE_MODEL_MAX_TOKENS,
    IMAGE_PROMPT_LANGUAGE_MODEL_PERFORMANCE,
    VOICE_MODEL_TYPE,
    DEBUG_MODE
} = require('../config.json');

async function generateText({ conversation, type=LANGUAGE_MODEL_TYPE, performance='FAST', tokens=240 }) {
    let text;
    let currentTime = new Date().getTime();
    if (type === 'OPENAI') {
        text = await OpenAIWrapper.generateText(conversation, tokens, performance);
    } else if (type === 'ANTHROPIC') {
        text = await AnthrophicWrapper.generateText(conversation, tokens, performance);
    } else if (type === 'LOCAL') {
        text = await LocalAIWrapper.generateText(conversation, tokens);
    }
    let timeTakenInSeconds = (new Date().getTime() - currentTime) / 1000;
    UtilityLibrary.consoleInfo([[`🤖 [generateText] Type:${type}, Performance: ${performance}, Time: ${timeTakenInSeconds}`, { color: 'magenta' }, 'middle']]);
    return text;
}

async function generateImage(text, type='FLUX') {
    let image;
    let currentTime = new Date().getTime();
    if (text) {
        image = await ComfyUIWrapper.generateImage(text);
    }
    let timeTakenInSeconds = (new Date().getTime() - currentTime) / 1000;
    UtilityLibrary.consoleInfo([[`🤖 [generateImage] Type:${type}, Time: ${timeTakenInSeconds}`, { color: 'magenta' }, 'middle']]);
    return image;
}

async function generateVoice(text) {
    let filename;
    let buffer;
    if (text) {
        if (VOICE_MODEL_TYPE === 'OPENAI') {
            buffer = await OpenAIWrapper.generateVoiceResponse(text);
        } else if (VOICE_MODEL_TYPE === 'BARKAI') {
            const voice = await BarkAIWrapper.generateVoice(text);
            if (voice.file_name) {
                filename = voice.file_name;
            }
        }
    }

    return { filename, buffer };
}

async function generateNewsSummary(message, text) {
    let conversation = [
        {
            role: 'system',
            content: `Summarize the following news articles.
            For any repeated or related news, combine them, while keeping sources.
            
            Output format:
            ## {article title}
            - Description: {article name}
            ### Sources:
            - {article source1}
            -  {article source2}
            - ...`
        },
        {
            role: 'user',
            name: UtilityLibrary.getUsernameNoSpaces(message),
            content: text,
        }
    ]
    
    const response = await generateText({ conversation, type: 'OPENAI', performance: 'FAST', tokens: 1200 })
    // UtilityLibrary.consoleInfo([[`💡 News: `, { }], [response, { }, 'middle']]);
    return response;
}

async function generateTopicAtHand(message, text) {
    let conversation = [
        {
            role: 'system',
            content: `
            # Role
            Return the topic that is being talked about.
            Do not explain, just return the topic that is mentioned as concisely as possible, while being accurate.
            `
        },
        {
            role: 'user',
            name: UtilityLibrary.getUsernameNoSpaces(message),
            content: text,
        }
    ]
    
    const response = await generateText({ conversation, type: 'OPENAI', performance: 'FAST', tokens: 256 })
    UtilityLibrary.consoleInfo([[`💡 Topic: `, { }], [response, { }, 'middle']]);
    return response;
}

async function generateNotCapableResponseCheck(message, text) {
    let yesOrNo;
    let conversation = [
        {
            role: 'system',
            content: `You will only answer with a yes or no.
            Do not type anything else besides yes or no.
            If the message contains text indicating that it cannot assist, answer with no.
            If you can assist, answer with yes.`
        },
        {
            role: 'user',
            name: UtilityLibrary.getUsernameNoSpaces(message),
            content: `Does this message indicate that you can't assist?: ${text}`,
        }
    ]
    
    const response = await generateText({ conversation, type: 'OPENAI', performance: 'POWERFUL', tokens: 256 })
    if (response.toLowerCase().includes('yes')) {
        yesOrNo = 'yes';
    } else {
        yesOrNo = 'no';
    }
    return yesOrNo;
}


function assembleConversation(systemMessage, userMessage, message) {
    let conversation = [
        {
            role: 'system',
            content: systemMessage
        },
        {
            role: 'user',
            name: UtilityLibrary.getUsernameNoSpaces(message),
            content: userMessage,
        }
    ]
    return conversation;
}

// async function generateResponseFromCustomConversation(conversation, type = LANGUAGE_MODEL_TYPE, performance = 'POWERFUL', tokens = 360) {
//     return await generateText({ conversation, type, performance, tokens });
// }

// async function generateImageRaw(text) {
//     DiscordWrapper.setActivity(`🎨 Drawing for ${DiscordWrapper.getNameFromItem(message)}...`);
//     UtilityLibrary.consoleInfo([[`📝 Image: `, { }], [{ prompt: text }, { }, 'middle']]);
//     return await ComfyUIWrapper.generateImage(text);
// }

const AIService = {
    async generateText({ conversation, type, performance, tokens }) {
        return await generateText({ conversation, type, performance, tokens });
    },
    async generateTextFromSystemUserMessages(systemMessage, userMessage, message) {
        const conversation = assembleConversation(systemMessage, userMessage, message);
        return await generateText({ conversation, type: 'OPENAI', performance: 'FAST', tokens: 600 });
    },
    async generateNewTextResponse(client, message, recentMessages) {
        function removeMentions(text) {
            return text
            .replace(/@here/g, '꩜here')
            .replace(/@everyone/g, '꩜everyone')
            .replace(/@horde/g, '꩜horde')
            .replace(/@alliance/g, '꩜alliance')
            .replace(/@alliance/g, '꩜alliance')
            .replace(/@Guild Leader - Horde/g, '꩜Guild Leader - Horde')
            .replace(/@Guild Leader - Alliance/g, '꩜Guild Leader - Alliance')
            .replace(/@Guild Officer - Horde/g, '꩜Guild Officer - Horde')
            .replace(/@Guild Officer - Alliance/g, '꩜Guild Officer - Alliance')
        }
        async function generateNewConversation(client, message, systemPrompt, recentMessages) {
            let conversation = [];
            conversation.push({
                role: 'system',
                content: systemPrompt
            });

            recentMessages.forEach((recentMessage, index) => {
                if (recentMessage.author.id === client.user.id) {
                    conversation.push({
                        role: 'assistant',
                        name: UtilityLibrary.getUsernameNoSpaces(recentMessage),
                        content: recentMessage.content,
                    });
                } else {
                    const authorName = `${recentMessage.author.displayName ? UtilityLibrary.capitalize(recentMessage.author.displayName) : UtilityLibrary.capitalize(recentMessage.author.username)}`;

                    // Replace mentions with names
                    recentMessage.content = recentMessage.content.replace(/<@!?\d+>/g, (match) => {
                        const id = match.replace(/<@!?/, '').replace('>', '');
                        return UtilityLibrary.findUserById(client, id);
                    });


                    const modifiedMessage = `${index === recentMessages.length - 1 ? message.content : recentMessage.content}`;
                    const modifiedContent = `${authorName}: ${modifiedMessage}`
                    conversation.push({
                        role: 'user',
                        name: UtilityLibrary.getUsernameNoSpaces(recentMessage),
                        content: modifiedContent
                    })
                }
            })
            
            return conversation;
        }
        async function generateImageDescription(imageUrl) {
            let imageDescription;
            if (imageUrl) {
                const eyes = await AIService.generateVision(imageUrl, 'Describe this image');
                imageDescription = eyes?.choices[0].message.content;
            }
            return imageDescription;
        }
        async function extractImagesFromAttachmentsAndUrls(message) {
            let images = [];
            if (message) {
                const urls = message.content.match(/(https?:\/\/[^\s]+)/g);
                if (message.attachments.size) {
                    for (const attachment of message.attachments.values()) {
                        const isImage = attachment.contentType.includes('image');
                        if (isImage) {
                            images.push(attachment.url);
                        }
                    }
                }
                if (urls?.length) {
                    for (const url of urls) {
                        if (!url.includes('https://tenor.com/view/')) {
                            const isImage = await UtilityLibrary.isImageUrl(url);
                            if (isImage) {
                                images.push(url);
                            }
                        } else {
                            const tenorImage = await PuppeteerWrapper.scrapeTenor(url);
                            images.push(tenorImage.image);
                        }
                    }
                }
            }
            return images;
        }
        async function generateUserConversation(message, recentMessages, recentMessage) {
            const userMessages = recentMessages.filter(message => message.author.id === recentMessage.author.id);
            const userMessagesAsText = userMessages.map(message => message.content).join('\n\n');
            const conversation = [
                {
                    role: 'system',
                    content: `You are an expert at giving detailed summaries of what is said to you.\nYou will go through the messages that are sent to you, and give a detailed summary of what is said to you.\nYou will describe the messages that are sent to you as detailed and creative as possible.\nThe messages that are sent are what ${DiscordWrapper.getNameFromItem(recentMessage)} has been talking about.
                    `
                },
                {
                    role: 'user',
                    name: UtilityLibrary.getUsernameNoSpaces(message),
                    content: `Here are the last recent messages by ${DiscordWrapper.getNameFromItem(recentMessage)} in this channel, and is what they have been talking about:\n${userMessagesAsText}`,
                }
            ];
            const generateText = await AIService.generateText({ conversation, type: LANGUAGE_MODEL_TYPE, performance: 'FAST' });
            return generateText;
        }
        async function checkCurrentMessage(client, message) {
            const customDescriptions = MessageConstant.serverSpecificArray;
            const mentionedNameDescriptions = [];
            const mentionedUsers = [];
            const imagesAttached = [];
            const emojisAttached = [];
            let userIdsInMessage = [];
            const replies = [];
        
            const messageHasMentions = message.content.match(/<@!?\d+>/g) || [];
            const messageHasSelfMention = message.content.match(/(\bme\b|\bi\b)/gi) && message.author;
            const messageHasYourMention = message.content.match(/(\byourself\b)/gi) && message.author;
            const messageHasAndYou = message.content.match(/(\band you\b)/gi) && message.author;
            const messageHasWithYou = message.content.match(/(\bwith you\b)/gi) && message.author;
            const messageHasUs = message.content.match(/(\bus\b)/gi) && message.author;
        
            const repliedMessage = message.reference ? await message.channel.messages.fetch(message.reference.messageId) : null;
            const repliedMessageHasMentions = repliedMessage?.content.match(/<@!?\d+>/g) || [];
            const repliedMessageHasSelfMention = repliedMessage?.content.match(/(\bme\b)/g) && repliedMessage.author;
        
            const mentions = [...messageHasMentions, ...repliedMessageHasMentions];

            const clientMentionedOnce = mentions.filter(mention => mention === `<@${client.user.id}>`).length === 1;

            const commonWords = ["the", "be", "to", "of", "and", "a", "in", "that", "have", "I", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time", "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could", "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new", "want", "because", "any", "these", "give", "day", "most", "us", "is", "am", "are", "has", "was", "were", "being", "been", "have", "do", "does", "did", "doing", "a", "an", "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", "at", "by", "for", "with", "about", "against", "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should", "now", "as", "that", "this", "these", "those", "myself", "ourselves", "you", "yourself", "yourselves", "himself", "herself", "itself", "themselves", "what", "which", "who", "whom", "this", "that", "these", "those", "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing", "will", "would", "should", "can", "could", "ought", "i", "you", "he", "she", "it", "we", "they", "me", "you", "him", "her", "it", "us", "them", "my", "your", "his", "her", "its", "our", "their", "mine", "yours", "his", "hers", "ours", "theirs", "my", "your", "his", "her", "its", "our", "their", "and", "because", "but", "or", "for", "so", "like"];
        
            if (repliedMessage) {
                const reply = {
                    userId: repliedMessage.author.id,
                    name: UtilityLibrary.discordUsername(repliedMessage.author),
                    content: repliedMessage.content
                }
                replies.push(reply);
            }
        
            if (mentions?.length) {
                userIdsInMessage.push(...mentions.map(user => user.replace(/<@!?/, '').replace('>', '')));
            }
        
            if (messageHasSelfMention) {
                userIdsInMessage.push(message.author.id);
            }
        
            if (repliedMessageHasSelfMention) {
                userIdsInMessage.push(repliedMessage.author.id);
            }

            if (clientMentionedOnce) {
                userIdsInMessage = userIdsInMessage.filter(userId => userId !== client.user.id);
            }

            if (messageHasYourMention || messageHasAndYou || messageHasWithYou) {
                userIdsInMessage.push(client.user.id);
            }

            if (messageHasUs) {
                userIdsInMessage.push(client.user.id);
                userIdsInMessage.push(message.author.id);
            }
            
            // User descriptions
            if (userIdsInMessage.length) {
                for (const userId of userIdsInMessage) {
                    const user = client.users.cache.get(userId);
                    if (user) {
                        const discordUsername = UtilityLibrary.discordUsername(user);
                        const member = message.guild.members.cache.get(user.id);
                        const roles = member ? member.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') : 'No roles';
                        const banner = await DiscordWrapper.getBannerFromUserId(user.id);
                        const bannerUrl = banner ? `https://cdn.discordapp.com/banners/${user.id}/${banner}.jpg?size=512` : '';
                        const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.jpg?size=512` : '';
        
                        const mentionedUserExists = mentionedUsers?.find(mentionedUser => mentionedUser.id === `<@${user.id}>`);
        
                        if (!mentionedUserExists) {
                            const mentionedUser = {
                                id: user.id,
                                name: discordUsername,
                                roles: roles,
                                description: mentionedNameDescriptions.find(mentionedName => mentionedName.word.toLowerCase() === discordUsername.toLowerCase())?.description,
                                avatarDescription: await generateImageDescription(avatarUrl),
                                bannerDescription: await generateImageDescription(bannerUrl)
                            };
                            mentionedUsers.push(mentionedUser)
                        }
                    }
                }
            }

            const individualWords = message.content.toLowerCase().split(' ');
            for (const word of individualWords) {
                // if word starts with '<@' and ends with '>' remove, and check if it is a user
                if (word.startsWith('<@') && word.endsWith('>')) {
                    let discordUsername;
                    if (word !== `<@${client.user.id}>`) {
                        discordUsername = UtilityLibrary.discordUsername(client.users.cache.get(word.replace(/<@!?/, '').replace('>', '')));
                    }
                    if (discordUsername) {
                        const pattern = new RegExp(`\\b${discordUsername}\\b`, 'i');
                        const filteredDescriptions = customDescriptions.filter(description => pattern.test(description.keywords));
                        if (filteredDescriptions.length >= 1) {
                            filteredDescriptions.forEach((description) => {
                                mentionedNameDescriptions.push( {word: discordUsername, description: description.description} );
                            });
                        }
                    }
                } else {
                    // remove all special characters from word
                    const cleanedWord = word.replace(/[^a-zA-Z0-9]/g, '');
                    if (cleanedWord && !commonWords.includes(cleanedWord)) {
                        const pattern = new RegExp('\\b' + cleanedWord + '\\b', 'i');
                        const filteredDescriptions = customDescriptions.filter(description => pattern.test(description.keywords));
                        if (filteredDescriptions.length >= 1) {
                            filteredDescriptions.forEach((description) => {
                                mentionedNameDescriptions.push( {word: cleanedWord, description: description.description} );
                            });
                        }
                    }
                }
            }

            async function createImagesAttached(images, message) {
                if (images.length > 0) {
                    for (const image of images) {
                        const eyes = await AIService.generateVision(image, 'Describe this image');
                        
                        const imageAttached = {
                            url: image,
                            description: eyes.choices[0].message.content,
                            username: UtilityLibrary.discordUsername(message.author)
                        };
            
                        imagesAttached.push(imageAttached);
                    }
                }
            }
        
            // Images and image urls
            const messageImages = await extractImagesFromAttachmentsAndUrls(message);
            const repliedMessageImages = await extractImagesFromAttachmentsAndUrls(repliedMessage);
            await createImagesAttached(messageImages, message);
            await createImagesAttached(repliedMessageImages, repliedMessage);

            // Stickers
            const messageStickers = message.content.match(/<:.+:\d+>/g) || [];
        
            // Emojis
            const messageEmojis = message.content.split(' ').filter(part => /<(a)?:.+:\d+>/g.test(part)) || [];
            const repliedMessageEmojis = repliedMessage?.content.split(' ').filter(part => /<(a)?:.+:\d+>/g.test(part)) || [];
            const emojis = [...messageEmojis, ...repliedMessageEmojis];
            if (emojis) {
                let currentEmoji = 0;
                for (const emoji of emojis) {
                    const parsedEmoji = emoji.replace(/[\n#]/g, '');
                    currentEmoji++;
                    const emojiId = parsedEmoji.split(":").pop().slice(0, -1);
                    const emojiName = parsedEmoji.match(/:.+:/g)[0].replace(/:/g, '');
                    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.png`;
                    const eyes = await AIService.generateVision(emojiUrl, `Describe this image named ${emojiId}. Do not mention that it is low quality, resolution, or pixelated.`);
                    
                    const emojiAttached = {
                        id: emojiId,
                        tag: parsedEmoji,
                        name: emojiName,
                        url: emojiUrl,
                        description: eyes.choices[0].message.content
                    };
        
                    emojisAttached.push(emojiAttached);
                }
            }
        
            return { mentionedUsers, imagesAttached, emojisAttached, replies, mentionedNameDescriptions };
        }
        async function checkAllMessages(client, message, recentMessages) {
            const participantUsers = [];
            if (message.guild) {
                for (const recentMessage of recentMessages) {
                    // if (UtilityLibrary.discordUserId(message) === UtilityLibrary.discordUserId(recentMessage)) return;
        
                    const botMention = UtilityLibrary.discordUserMention(client);
                    const userMention = UtilityLibrary.discordUserMention(recentMessage);
                    const discordUsername = UtilityLibrary.discordUsername(recentMessage.author);
        
                    if (recentMessage.author.id && userMention !== botMention) {

                        let userExists = participantUsers.find(participantUser => participantUser.id === recentMessage.author.id);
                        if (!userExists) {
                            let member = message.guild.members.cache.get(recentMessage.author.id);
                            let roles = member ? member.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') : 'No roles';
                            const user = {
                                id: recentMessage.author.id,
                                name: discordUsername,
                                roles: roles,
                                conversation: await generateUserConversation(message, recentMessages, recentMessage),
                                time: recentMessage.createdTimestamp
                            }
                            participantUsers.push(user);
                        } else if (userExists.time < recentMessage.createdTimestamp) {
                            userExists.time = recentMessage.createdTimestamp;
                        }
                    }
                }
            }
            return { participantUsers };
        }

        let systemPrompt;
        let modifiedMessage;
        let imagePrompt;
        let generatedText;

        try {
            if (DEBUG_MODE) {
                UtilityLibrary.consoleInfo([[`🎨 generateTextResponse input:\n${message.content}`, { color: 'blue' }, 'middle']]);
            }

            const { 
                mentionedUsers, 
                imagesAttached, 
                emojisAttached,
                replies,
                mentionedNameDescriptions
            } = await checkCurrentMessage(client, message);

            const { participantUsers } = await checkAllMessages(client, message, recentMessages);

            imagePrompt = String(message.content);
            modifiedMessage = String(message.content);

            ['draw', 'paint', 'sketch', 'design', 'illustrate', 'show'].forEach(substring => { 
                imagePrompt = imagePrompt.replace(new RegExp(substring, 'g'), 'describe');
                modifiedMessage = modifiedMessage.replace(new RegExp(substring, 'g'), 'describe');
            });

            // remove 'can you ' from the message, in any capitalization
            imagePrompt = imagePrompt.replace(/can you /gi, '');
            modifiedMessage = modifiedMessage.replace(/can you /gi, '');


            systemPrompt = '';
            systemPrompt += `${MessageService.assembleAssistantMessage()}`;
            systemPrompt += `\n\n# Your Information`;
            systemPrompt += `\nYour Name: ${client.user.displayName}`;
            systemPrompt += `\nYour Discord user ID tag: <@${client.user.id}>`;
            systemPrompt += `\n\n# Date and Time`;
            systemPrompt += `\nThe current date is ${moment().format('MMMM Do YYYY')}, day is ${moment().format('dddd')}, and time is ${moment().format('h:mm A')} in PST.`;
            
            if (imagesAttached.length) {
                // systemPrompt += '\n\n# Description of Images Attached';
                modifiedMessage += `\n`;
                imagesAttached.forEach((image, index) => {
                    // systemPrompt += `\nImage ${index + 1}: ${image.url}`;
                    // systemPrompt += `\nImage ${index + 1} description: ${image.description}`;

                    modifiedMessage += `\nThe description of an image attached by ${image.username}:`;
                    modifiedMessage += '\n```';
                    modifiedMessage += `\n${image.description}`;
                    modifiedMessage += '\n```';

                    imagePrompt += `\n\n${image.description}.`;
                });
            }

            if (message.guild) {
                systemPrompt += `\n\n# Server Information`
                systemPrompt += `\nYou are in the discord server called ${message.guild.name}, with ${message.guild.memberCount} total members, and ${UtilityLibrary.discordBotsAmount(message)} bots.`
            }

            if (message.channel.name) {
                systemPrompt += `\n\n# Channel Information`
                systemPrompt += `\nYou are in the channel called: ${message.channel.name}.`;
            }
            if (message.channel.topic) {
                systemPrompt += `\nThe channel topic is: ${message.channel.topic}`
            }

            systemPrompt += `\n\n# How to tag someone`;
            systemPrompt += `\nTo mention, tag or reply to someone, you do it by mentioning their Discord user ID tag. For example, to mention me, you would type <@${client.user.id}>.`;

            if (replies.length) {
                systemPrompt += '\n\n# Primary participant is responding to another user while mentioning you in their reply';
                systemPrompt += `\nQuoted user: ${replies[0].name}`
                systemPrompt += `\n${replies[0].name}'s Discord user ID tag: <@${replies[0].userId}>`
                systemPrompt += `\n${replies[0].name}'s message: ${replies[0].content}`

                modifiedMessage += `\n\nI am replying to this message by ${replies[0].name}:`
                modifiedMessage += '\n```';
                modifiedMessage += `\n${replies[0].content}`
                modifiedMessage += '\n```';

                imagePrompt += `\n\n ${replies[0].content}`
            }
            if (mentionedUsers.length) {
                systemPrompt += '\n\n# Mentioned Users';
                mentionedUsers.forEach((mentionedUser, index) => {
                    systemPrompt += `\nMentioned User ${index + 1}: ${mentionedUser.name}`;
                    systemPrompt += `\n${mentionedUser.name}'s Discord user ID tag: <@${mentionedUser.id}>`;

                    systemPrompt += `\n${mentionedUser.name}'s roles: ${mentionedUser.roles}`;
                    systemPrompt += `\n${mentionedUser.name}'s description: ${mentionedUser.description}`;
                    systemPrompt += `\n${mentionedUser.name}'s avatar description: ${mentionedUser.avatarDescription}`;
                    systemPrompt += `\n${mentionedUser.name}'s banner description: ${mentionedUser.bannerDescription}`;

                    let userVisualDescription = ``;
                    if (mentionedUser.avatarDescription && mentionedUser.bannerDescription) {
                        userVisualDescription = `(Subject: ${mentionedUser.avatarDescription} + In front of: ${mentionedUser.bannerDescription})`;
                    } else if (mentionedUser.avatarDescription) {
                        userVisualDescription = `(Subject: ${mentionedUser.avatarDescription})`;
                    } else if (mentionedUser.bannerDescription) {
                        userVisualDescription = `(In front of: ${mentionedUser.bannerDescription})`;
                    }

                    imagePrompt = imagePrompt.replace(`<@${mentionedUser.id}>`, `${mentionedUser.name} ${userVisualDescription}`);
                    imagePrompt = imagePrompt.replace(/\bme\b/gi, `me ${userVisualDescription}`);
                    imagePrompt = imagePrompt.replace(/\bI\b/gi, `I ${userVisualDescription}`);

                    modifiedMessage = modifiedMessage.replace(`<@${mentionedUser.id}>`, mentionedUser.name);
                });
            }
            if (mentionedNameDescriptions.length) {
                modifiedMessage += '\n\n# Relevant to this response';
                mentionedNameDescriptions.forEach((mentionedNameDescription, index) => {
                    systemPrompt += `\n${mentionedNameDescription.description}`;
                    imagePrompt += `\n\n${mentionedNameDescription.description}.`;
                });
            }
            if (emojisAttached.length) {
                emojisAttached.forEach((emoji) => {
                    systemPrompt += `\n\n# Emojis Attached`;
                    systemPrompt += `\nEmoji name: ${emoji.name}`;
                    systemPrompt += `\nEmoji Discord tag: ${emoji.tag}`;
                    systemPrompt += `\nEmoji description: ${emoji.description}`;

                    modifiedMessage = modifiedMessage.replace(emoji.tag, `${emoji.name}`);

                    imagePrompt = imagePrompt.replace(emoji.tag, `${emoji.name} (${emoji.description}).`);
                });
            }

            if (participantUsers.length) {
                systemPrompt += '\n\n# Participants';

                const primaryParticipant = participantUsers.find(participant => participant.id === message.author.id);

                if (primaryParticipant) {
                    systemPrompt += '\n## Primary participant and the person who you are replying to';
                    systemPrompt += `\n${primaryParticipant.name}'s Discord user ID tag: <@${primaryParticipant.id}>`;
                    systemPrompt += `\n${primaryParticipant.name}'s roles: ${primaryParticipant.roles}`;
                    systemPrompt += `\n${primaryParticipant.name}'s conversation: ${primaryParticipant.conversation}`;
                    systemPrompt += `\n${primaryParticipant.name}'s last message sent at: ${luxon.DateTime.fromMillis(primaryParticipant.time).setZone('local').toFormat('LLLL dd, yyyy \'at\' hh:mm:ss a')}`;
                }

                if (participantUsers.length > 2) {
                    systemPrompt += '\n## Secondary participants and the people who are also in the chat';
                    participantUsers.forEach((participant, index) => {
                        if (participant.id === message.author.id) return;
                        systemPrompt += `\nParticipant ${index + 1}: ${participant.name}`;
                        systemPrompt += `\n${participant.name}'s Discord user ID tag: <@${participant.id}>`;
                        systemPrompt += `\n${participant.name}'s roles: ${participant.roles}`;
                        systemPrompt += `\n${participant.name}'s conversation: ${participant.conversation}`;
                        systemPrompt += `\n${participant.name}'s last message sent at: ${luxon.DateTime.fromMillis(participant.time).setZone('local').toFormat('LLLL dd, yyyy \'at\' hh:mm:ss a')}`;
                    });
                }
            }
            if (imagePrompt.includes(`<@${client.user.id}`)) {
                imagePrompt = imagePrompt.replace(`<@${client.user.id}>`, '');
                modifiedMessage = modifiedMessage.replace(`<@${client.user.id}>`, '');
                // if sentence starts with a white space, remove it
                if (modifiedMessage.startsWith(' ')) {
                    modifiedMessage = modifiedMessage.slice(1);
                }
            }

            // if (imagePrompt) {
            //     systemPrompt += `\n\n# Image generated and attached to your reply`;
            //     systemPrompt += `\nThis is an image that has been generated by you based off the message you're replying to:`;
            //     systemPrompt += '\n```';
            //     systemPrompt += `${imagePrompt}`;
            //     systemPrompt += '\n```';
            // }

            systemPrompt += `\n\n${MessageService.assembleBackstoryMessage(message.guild?.id)}`;
            systemPrompt += `\n\n${MessageService.assemblePersonalityMessage()}`;
            
            if (DEBUG_MODE) {
                UtilityLibrary.consoleInfo([[`🧠 System Prompt:\n${systemPrompt}`, { color: 'blue' }, 'middle']]);
                UtilityLibrary.consoleInfo([[`🏞️ Image Prompt:\n${imagePrompt}`, { color: 'cyan' }, 'middle']]);
                UtilityLibrary.consoleInfo([[`💬 Modified Message:\n${modifiedMessage}`, { color: 'blue' }, 'middle']]);
            }

            message.content = modifiedMessage;
            
            const conversation = await generateNewConversation(client, message, systemPrompt, recentMessages);
            generatedText = await generateText({ conversation });

            // let notCapable = await generateNotCapableResponseCheck(message, generatedText);
            // if (notCapable === 'no' && imagePrompt) {
            //     UtilityLibrary.consoleInfo([[`🎨 generateTextResponse not capable: ${generatedText}`, { color: 'red' }, 'middle']]);
            //     generatedText = imagePrompt;
            // }

            // Clean response
            generatedText = removeMentions(generatedText);
                
            if (DEBUG_MODE) {
                UtilityLibrary.consoleInfo([[`🎨 generateTextResponse output:\n${generatedText}`, { color: 'green' }, 'middle']]);
            }
        } catch (error) {
            UtilityLibrary.consoleInfo([[`📝 generateTextResponse failed:\n${error}`, { color: 'red' }, 'middle']]);
        }

        return { generatedText, imagePrompt };

    },
    async createImagePromptFromImageAndText(message, imagePrompt, textResponse, imageToGenerate) {
        // DiscordWrapper.setActivity(`🎨 Drawing for ${DiscordWrapper.getNameFromItem(message)}...`);
        // const username = UtilityLibrary.discordUsername(message.author || message.member);
        // const randomText = [
        //     `Always include written text that fits the theme of the image that says: "${username}".`,
            
        // ]
        // const pickRandomText = randomText[Math.floor(Math.random() * randomText.length)];
        // UtilityLibrary.consoleInfo([[`🎨 Image message content:\n${message.content}`, { color: 'blue' }, 'middle']]);
        let conversation = [
            {
                role: 'system',
                content: `You are given two prompts; an image and text prompt. Always combine both prompts into a single cohesive image description, while keeping the all details of both. Do not omit any details from either prompt, as this is the answer to the user's question. You will also make sure to answer any questions that are asked in the text prompt.

                The description should be detailed, creative, and a museum-quality art label description.

                The description should include concise text in quotes that fits the theme of the image, and the text prompt. The text should be in quotes and should be a part of the image description.

                Do not make self-referential comments or break the fourth wall.
                Do not answer with a question.`
            },
            {
                role: 'user',
                name: UtilityLibrary.getUsernameNoSpaces(message),
                content: `Combine these the image and text prompts into a cohesive visual description, while keeping the all details.

                Image prompt: ${imagePrompt}
                
                Text prompt: ${textResponse}`,
            }
        ]

        if (DEBUG_MODE) {
            UtilityLibrary.consoleInfo([[`🎨 Image prompt 1:\n${imagePrompt}`, { color: 'cyan' }, 'middle']]);
            UtilityLibrary.consoleInfo([[`🎨 Image prompt 2:\n${textResponse}`, { color: 'blue' }, 'middle']]);
        }

        let generatedImagePrompt = await generateText({ conversation })
        // let notCapable = await generateNotCapableResponseCheck(message, generatedImagePrompt);
        // if (notCapable === 'no') {
        //     UtilityLibrary.consoleInfo([[`🎨 Image not capable 2: ${generatedImagePrompt}`, { color: 'red' }, 'middle']]);
        //     generatedImagePrompt = imageToGenerate ? imageToGenerate : message.content;
        // }
        if (DEBUG_MODE) {
            UtilityLibrary.consoleInfo([[`🎨 Image prompt 2 output:\n${generatedImagePrompt}`, { color: 'green' }, 'middle']]);
        }
        return generatedImagePrompt;
    },
    async generateImage(imagePrompt) {
        try {
            await ComfyUIWrapper.checkWebsocketStatus();
            UtilityLibrary.consoleInfo([[`🎨 Image: generation started`, { color: 'yellow' }, 'middle']]);
            const generatedImage = await generateImage(imagePrompt);
            UtilityLibrary.consoleInfo([[`🎨 Image: generation successful`, { color: 'green' }, 'middle']]);
            return generatedImage;
        } catch (error) {
            UtilityLibrary.consoleInfo([[`🎨 Image: generation failed`, { color: 'red' }, 'middle']]);
            return;
        }
    },
    async generateVoice(message, text) {
        DiscordWrapper.setActivity(`🗣️ Recording for ${DiscordWrapper.getNameFromItem(message)}...`);
        UtilityLibrary.consoleInfo([[`🔊 Audio: `, { }], [{ prompt: text }, { }, 'middle']]);
        const { filename, buffer } = await generateVoice(text);
        return { filename, buffer };
    },
    async generateVision(imageUrl, text) {
        return await OpenAIWrapper.generateVisionResponse(imageUrl, text);
    },
    async generateMoodTemperature(message) {
        await message.channel.sendTyping();
        let conversation = [
            {
                role: 'system',
                content: `
                    ${MessageService.assembleBackstoryMessage(message.guild?.id)}
                    ${MessageService.assemblePersonalityMessage()}
                    You are an expert at telling if a conversation is positive, neutral or negative, but taking into account how your character would perceive it and react to it. You will only answer with a between from -10 to 10. -10 Being the most negative, 0 being mostly neutral, and 12 being as positive as possible. The number you pick between -10 to 10 will depend on the tone of the conversation, and nothing else. You do not type anything else besides the number that indicates the tone of the conversation. Only a number between -10 to 10, nothing else. You only output a number, an integer, nothing else.
                `
            },
            {
                role: 'user',
                name: UtilityLibrary.getUsernameNoSpaces(message),
                content: message.content,
            }
        ]
        
        let response = await generateText({ conversation, type: 'OPENAI', performance: 'FAST', tokens: 3 });
        return response;
    },
    async generateGoogleNews(message) {
        const url = 'https://news.google.com/rss?gl=US&hl=en-US&ceid=US:en';
        const items = await PuppeteerWrapper.scrapeRSS(url);
    
        let userMessage = "# Latest News\n";
        items.forEach((item) => {
            const title = item.title;
            const pubDate = UtilityLibrary.getCurrentDateAndTime(item.pubDate);
            const minutesAgo = UtilityLibrary.getMinutesAgo(item.pubDate);
            const link = item.link;
            const description = item.description || '';
    
            userMessage += `## Title: ${title}\n`;
            userMessage += `- Date: ${pubDate}\n`;
            userMessage += `- Minutes ago: ${minutesAgo}\n`;
            userMessage += `- Link: ${link}\n\n`

            // if (description.a?._ && description.a?.href) {
            //     userMessage += `- Description: ${description.a._}\n`;
            //     userMessage += `- Link: ${description.a.href}\n`;
            // }

            // description.ol?.li?.forEach((each => {
            //     userMessage += `- Description: ${each.a._}\n`;
            //     userMessage += `- Link: ${each.a.href}\n`;
            // }))

        });
        userMessage += `If any, return the most related news to this: ${message.content}`;

        const systemMessage = `#Task:\n-You return the most related news, and summarize the description without adding more information.\n-If there is no related news, return an empty string.\n\n#Output Format:
        -## Title: [Title]
        -Date: [Date]
        -Minutes ago: [Minutes]
        -Link: [Link]
        -Description: [Description]
        
        #Output:`;

        const conversation = assembleConversation(systemMessage, userMessage, message)
        return await generateText({conversation, type: 'OPENAI', performance: 'FAST'})
    },
};

module.exports = AIService;
