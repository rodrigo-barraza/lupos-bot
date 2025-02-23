process.env.NODE_NO_WARNINGS = 'stream/web';
require('dotenv/config');
const {
    WHITEMANE_YAPPER_ROLE_ID, WHITEMANE_OVERREACTOR_ROLE_ID, WHITEMANE_POLITICS_CHANNEL_ID, GUILD_ID_WHITEMANE,
    GENERATE_VOICE, BLABBERMOUTH, DETECT_AND_REACT, BARK_VOICE_FOLDER, GENERATE_IMAGE,
    CHANNEL_ID_WHITEMANE_HIGHLIGHTS, CHANNEL_ID_THE_CLAM_HIGHLIGHTS, CHANNEL_ID_WHITEMANE_BOOTY_BAE,
    PRIMARY_LIGHT_ID
} = require('./config.json');
const fs = require('node:fs');
const { Collection, Events, ChannelType, EmbedBuilder } = require('discord.js');
const UtilityLibrary = require('./libraries/UtilityLibrary.js');
const MoodService = require('./services/MoodService.js');
const DiscordService = require('./services/DiscordService.js');
const AIService = require('./services/AIService.js');
const YapperService = require('./services/YapperService.js');
const luxon = require('luxon');
const PuppeteerWrapper = require('./wrappers/PuppeteerWrapper.js');
const LightWrapper = require('./wrappers/LightWrapper.js');

const IGNORE_PREFIX = "!";
let previousTopAuthorId;
let previousOverReactorId;
let lastMessageSentTime = luxon.DateTime.now().toISO()

const client = DiscordService.client;

async function generateOverReactors(combinedMessages, guild) {
    const overReactorRoleId = WHITEMANE_OVERREACTOR_ROLE_ID;

    const userIds = [];
    let mostCommonOverReactor;
  
    try {
        const results = await Promise.all(
            combinedMessages.map(message => 
                Promise.all(
                        Array.from(message.reactions.cache.values()).map(reaction => 
                        reaction.users.fetch()
                    )
                )
            )
        );
    
        results.forEach(reactions => {
            reactions.forEach(users => {
                users.forEach(user => {
                    const existingUser = userIds.find(u => u.id === user.id);
                    if (existingUser) {
                        existingUser.count++;
                    } else {
                        userIds.push({ id: user.id, count: 1 });
                    }
                });
            });
        });
        
        mostCommonOverReactor = userIds.reduce((acc, user) => (user.count > acc.count ? user : acc), userIds[0]);

        if (mostCommonOverReactor?.count > 4) {
            const overReactorRole = guild.roles.cache.find(role => role.id === overReactorRoleId);
            const currentOverReactor = await guild.members.fetch(mostCommonOverReactor.id);
    
            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.some(role => role.id === overReactorRoleId));
            if (previousOverReactorId !== currentOverReactor.id) {
                await membersWithRole.forEach(member => member.roles.remove(overReactorRole));
                currentOverReactor.roles.add(overReactorRole);
                previousOverReactorId = currentOverReactor.id;
                // UtilityLibrary.consoleInfo([[`🤯 ${currentOverReactor.displayName} has been given the role ${overReactorRole.name}`, { color: 'red' }]]);
            }
        } else {
            const overreactorRole = guild.roles.cache.find(role => role.id === overReactorRoleId);
            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.some(role => role.id === overReactorRoleId));
            await membersWithRole.forEach(member => member.roles.remove(overreactorRole));
        }
    } catch (err) {
      console.error('Error in processing:', err);
    }
}

async function generateYappers(combinedMessages, guild) {
    const yapperRoleId = WHITEMANE_YAPPER_ROLE_ID;
    const yapperRole = guild.roles.cache.find(role => role.id === yapperRoleId);

    const authorCounts = combinedMessages.reduce((counts, message) => {
        const authorId = message.author.id;
        let authorObj = counts.find(obj => obj.authorId === authorId);
        if (!authorObj) {
            authorObj = { 
                authorId: authorId,
                displayName: message.author.globalName || 'Unknown',
                count: 0,
                earliestTimestamp: message.createdTimestamp
            };
            counts.push(authorObj);
        }
        authorObj.count++;
        authorObj.earliestTimestamp = Math.min(authorObj.earliestTimestamp, message.createdTimestamp);
    
        return counts;
    }, []);

    const topAuthorCounts = authorCounts
    .sort((a, b) => a.count - b.count)
    .slice(0, 5);

    const topAuthorId = topAuthorCounts.reduce((a, b) => a.count > b.count ? a : b).authorId;

    try {
        const topAuthor = await guild.members.fetch(topAuthorId);
        const membersWithYapperRole = guild.members.cache.filter(member => member.roles.cache.some(role => role.id === yapperRoleId));
    
        if (previousTopAuthorId !== topAuthor.id) {
            await membersWithYapperRole.forEach(member => member.roles.remove(yapperRole));
            topAuthor.roles.add(yapperRole);
            previousTopAuthorId = topAuthor.id;
            // UtilityLibrary.consoleInfo([[`🤌 ${topAuthor.displayName} has been given the role ${yapperRole.name}`, { color: 'red' }]]);
        }
    
        const currentYappers = YapperService.getYappers();
    
        if (!UtilityLibrary.areArraysEqual(currentYappers, topAuthorCounts)) {
            YapperService.setYappers(topAuthorCounts);
            // console.log('🗣 Current yappers:', mappedYappers);
        }
    } catch (error) {
        // console.error(error);
    }
}

async function autoAssignRoles() {
    const channel1 = DiscordService.getChannelById(WHITEMANE_POLITICS_CHANNEL_ID);
    const guild = DiscordService.getGuildById(GUILD_ID_WHITEMANE);

    try {
        const allMessages = await Promise.all([
            channel1.messages.fetch({ limit: 100 })
        ]);
    
        if (!allMessages[0]) return;
    
        const combinedMessages = allMessages[0];
    
        await generateOverReactors(combinedMessages, guild);
        await generateYappers(combinedMessages, guild);
    } catch (error) {
        console.error(error);
    }
}

async function autoAssignRoleToUser(userId, roleId) {
    async function assignRoleToUser(userId, roleId) {
        const guild = DiscordService.getGuildById(GUILD_ID_WHITEMANE);
        const role = guild.roles.cache.find(role => role.id === roleId);
        const member = await guild.members.fetch(userId);
        // if user doesn't have the role already
        if (!member.roles.cache.some(role => role.id === roleId)) {
            member.roles.add(role);
        }
    }
    setInterval(() => {
        assignRoleToUser(userId, roleId);
    }, 10 * 1000);
}

function displayAllGuilds() {
    const guilds = DiscordService.getAllGuilds();
    let connectedGuildsText = `🌎 Connected Guilds (Servers): ${guilds.length }`
    UtilityLibrary.consoleInfo([[connectedGuildsText, {}]]);
}

async function onReady() {
    UtilityLibrary.consoleInfo([[`👌 Logged in as ${DiscordService.getBotName()}`, { bold: true }]]);
    // AlcoholService.instantiate();
    MoodService.instantiate();
    displayAllGuilds()
    if (BLABBERMOUTH) {
        autoAssignRoles(client)
        setInterval(() => {
            autoAssignRoles(client)
        }, 10 * 1000);
    }
    const guild = client.guilds.cache.find(guild => guild.name === 'Classic Whitemane');
    console.log('Channels for Classic Whitemane:');
    for (const channel of guild.channels.cache.values()) {
        if (channel.type === ChannelType.GuildText &&
            // channel.parent.name !== 'Archived' &&
            // channel.parent.name !== 'Archived: First Purge' &&
            // channel.parent.name !== 'Archived: SOD' &&
            // channel.parent.name !== 'Archived: Alliance' &&
            // channel.parent.name !== 'Archived: WoW Classes' &&
            // channel.parent.name !== '⚒ Administration' &&
            // channel.parent.name !== 'Info' &&
            // channel.parent.name !== 'Welcome'
            (channel.parent.name === 'Classic WoW' ||
            channel.parent.name === 'Classic Cataclysm')
        ) {
            const messages = await DiscordService.fetchMessages(channel.id, 1);
            const lastMessageSentOn = luxon.DateTime.fromMillis(messages[0].createdTimestamp);
            const now = luxon.DateTime.local();
            const daysDifference = lastMessageSentOn.until(now).toDuration(['days']).toObject().days.toFixed(0);
            const paddedDaysDifference = daysDifference.padStart(6, '0');
            console.log(`${paddedDaysDifference} days`, channel.name);
        }
    }
    // Griev keeps removing vesper's black role
    autoAssignRoleToUser('215629443371106306', '1339285975217471551');
    console.log('-------------------');
}

UtilityLibrary.consoleInfo([[`---`, { bold: true, color: 'green' }]]);
UtilityLibrary.consoleInfo([[`🤖 Lupos v1.0 starting`, { bold: true, color: 'red' }]]);

// ========================================
// whenever a user sends a message
let isProcessingOnMessageQueue = false;
const messageQueue = [];
async function onMessageCreateQueue(client, message) {
    const isDirectMessageByBot = message.channel.type === ChannelType.DM && message.author.id === client.user.id;
    const isMessageWithoutBotMention = message.channel.type != ChannelType.DM && !message.mentions.has(client.user);
    if (message.content.startsWith(IGNORE_PREFIX)) { return }
    if (isDirectMessageByBot) { return }
    if (isMessageWithoutBotMention) { return }

    messageQueue.push(message);

    if (!isProcessingOnMessageQueue) {
        isProcessingOnMessageQueue = true;
        while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            await replyMessage(client, queuedMessage);
        }
        isProcessingOnMessageQueue = false;
        return
    } 
}
// ========================================

// ========================================
// whenever a user reacts to a message
let isProcessingOnReactionQueue = false;
const reactionQueue = [];
async function onReactionCreateQueue(client, reaction) {
    const isHighlightChannel = reaction.message.channelId === CHANNEL_ID_WHITEMANE_HIGHLIGHTS;
    const isNSFWChannel = reaction.message.channelId === CHANNEL_ID_WHITEMANE_BOOTY_BAE;
    if (isHighlightChannel) return;
    if (isNSFWChannel) return;

    reactionQueue.push(reaction);

    if (!isProcessingOnReactionQueue) {
        isProcessingOnReactionQueue = true;
        while (reactionQueue.length > 0) {
            const queuedReaction = reactionQueue.shift();
            await processHighlights(client, queuedReaction);
        }
        isProcessingOnReactionQueue = false;
        return
    }
}
// ========================================


const allUniqueUsers = {};
const reactionMessages = {};
async function processHighlights(client, queuedReaction) {
    const messageId = queuedReaction.message.id;
    const userId = queuedReaction.message.author?.id;
    const guildId = queuedReaction.message.guildId;
    const channelId = queuedReaction.message.channelId;
    const channelName = DiscordService.getChannelName(channelId);
    const uniqueUserLengthTrigger = 5;
    const highlightsChannel = CHANNEL_ID_WHITEMANE_HIGHLIGHTS;
    const content = queuedReaction.message.content;

    if (channelId === CHANNEL_ID_WHITEMANE_HIGHLIGHTS || channelId === CHANNEL_ID_WHITEMANE_BOOTY_BAE) return;


    if (!allUniqueUsers[messageId]) {
        allUniqueUsers[messageId] = new Set();
    } else {
        allUniqueUsers[messageId].add(userId);
    }
    
    const users = await queuedReaction.users.fetch();
    users.map(user => allUniqueUsers[messageId].add(user.id));
    UtilityLibrary.consoleInfo([[`❤️ React: ${content}, Users: ${[...allUniqueUsers[messageId]].length}, Total: ${queuedReaction.message.reactions.cache.size}`, { color: 'yellow' }, 'middle']]);
    if ([...allUniqueUsers[messageId]].length >= uniqueUserLengthTrigger) {
        const attachments = queuedReaction.message.attachments;
        const stickers = queuedReaction.message.stickers;
        const name = queuedReaction.message.author?.globalName || queuedReaction.message.author?.username;
        const avatar = queuedReaction.message.author?.avatar;
        const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.jpg?size=512` : '';

        const emojiId = queuedReaction._emoji.id
        const emojiName = queuedReaction._emoji.name;
        const isEmojiAnimated = queuedReaction._emoji.animated;
        let emojiUrl;

        const doesContentContainTenorText = content?.includes('https://tenor.com/view/')

        if (!name) return;

        if (emojiId && isEmojiAnimated) {
            emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.gif`;
        } else if (emojiId && !isEmojiAnimated) {
            emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.png`;
        }


        const banner = queuedReaction.message.author?.banner;
        const reference = queuedReaction.message.reference;
        const referenceChannelId = reference?.channelId;
        const referenceGuildId = reference?.guildId;
        const referenceMessageId = reference?.messageId;
        let referenceMessage;


        const currentReferenceChannel = DiscordService.getChannelById(referenceChannelId);

        if (currentReferenceChannel?.messages) {
            referenceMessage = await currentReferenceChannel.messages.fetch(referenceMessageId)
        }

        const targetChannel = DiscordService.getChannelById(highlightsChannel);

        const messageURL = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

        const embed = new EmbedBuilder()
            .setTitle(`#${channelName}`)
            .setURL(messageURL)
            // .addFields(
            //     { name: 'Regular field title', value: 'Some value here' },
            //     { name: '\u200B', value: '\u200B' },
            //     { name: 'Inline field title', value: 'Some value here', inline: true },
            //     { name: 'Inline field title', value: 'Some value here', inline: true },
            // )
            // .addFields({ name: 'Inline field title', value: 'Some value here', inline: true })

        if (referenceMessage) {
            const referenceAttachments = referenceMessage.attachments;
            const referenceStickers = referenceMessage.stickers;
            if (referenceMessage.content) {
                embed.addFields({ name: 'Replying To', value: referenceMessage.content });
            }
            if (referenceAttachments) {
                for (const attachment of referenceAttachments.values()) {
                    embed.setImage(attachment.url);
                }
            }
            if (referenceStickers) {
                for (const sticker of referenceStickers.values()) {
                    embed.setImage(sticker.url);
                }
            }
        }

        const totalReactions = [...allUniqueUsers[messageId]].length > queuedReaction.message.reactions.cache.size ? [...allUniqueUsers[messageId]].length : queuedReaction.message.reactions.cache.size;

        const emojiResponse = '<:emoji:1111811553491169280>';
        
        embed.addFields({ name: 'Reactions', value: `${emojiId ? '❤️' : emojiName } ${totalReactions}` });

        if (emojiUrl) {
            embed.setThumbnail(emojiUrl);
        }

        if (avatarUrl) {
            embed.setAuthor({ name: name, iconURL: avatarUrl, url: messageURL })
        } else {
            embed.setAuthor({ name: name, url: messageURL })
        }

        if (content) {
            embed.setDescription(content);
        }

        if (doesContentContainTenorText) {
            let regex = /(https:\/\/tenor\.com\/view\/\S*)/;
            let match = content.match(regex);
            let url = match ? match[0] : '';
            const tenorImage = await PuppeteerWrapper.scrapeTenor(url);
            embed.setImage(tenorImage.image);
        }

        if (attachments) {
            for (const attachment of attachments.values()) {
                embed.setImage(attachment.url);
            }
        }

        if (stickers) {
            for (const sticker of stickers.values()) {
                embed.setImage(sticker.url);
            }
        }

        embed.setTimestamp(new Date(queuedReaction.message.createdTimestamp));
        embed.setFooter({ text: messageId, iconURL: 'https://cdn.discordapp.com/icons/609471635308937237/cfeccc9c5372c8ae8130b184fd1c5346.png?size=256' })

        if (!reactionMessages[messageId]) {
            const message = await targetChannel.send({ embeds: [embed] });
            reactionMessages[messageId] = message.id;
        } else {
            const message = await targetChannel.messages.fetch(reactionMessages[messageId]);
            await message.edit({ embeds: [embed] });
        }
    }

}

async function replyMessage(client, queuedMessage) {
    LightWrapper.setState({ color: 'purple' }, PRIMARY_LIGHT_ID);
    await DiscordService.fetchMessages(1302506119813660692, 300);
    await queuedMessage.channel.sendTyping();
    let fetchRecentMessages = (await queuedMessage.channel.messages.fetch({ limit: 100 })).reverse();
    let recentMessages = fetchRecentMessages.map((msg) => msg);
    const sendTypingInterval = setInterval(() => { queuedMessage.channel.sendTyping() }, 5000);
    const discordUserTag = UtilityLibrary.discordUserTag(queuedMessage);
    let timer = 0;
    const timerInterval = setInterval(() => { timer++ }, 1000);
    
    UtilityLibrary.consoleInfo([[`═══════════════░▒▓ +MESSAGE+ ▓▒░════════════════════════════════════`, { color: 'yellow' }, 'start']]);

    if (queuedMessage.guild) {
        UtilityLibrary.consoleInfo([[`💬 Replying to: ${discordUserTag} in ${queuedMessage.guild.name} #${queuedMessage.channel.name}`, { color: 'cyan' }, 'middle']]);
    } else {
        UtilityLibrary.consoleInfo([[`💬 Replying to: ${discordUserTag} in a private message`, { color: 'cyan' }, 'middle']]);
    }
    let imageToGenerate = queuedMessage.content;
    let generatedTextResponse;
    let generatedImage;

    // Summary of the message in 5 words
    const messageContent = queuedMessage.content.replace(`<@${client.user.id}>`, '');
    const summary = await AIService.generateSummaryFromMessage(queuedMessage, messageContent);
    console.log('Summary:', summary);
    DiscordService.setUserActivity(summary);
    LightWrapper.setState({ color: 'red' }, PRIMARY_LIGHT_ID);
    
    const { 
        generatedText, 
        imagePrompt, 
        modifiedMessage, 
        systemPrompt 
    } = await AIService.generateNewTextResponse(
        client,
        queuedMessage,
        recentMessages
    );
    LightWrapper.setState({ color: 'yellow' }, PRIMARY_LIGHT_ID);

    generatedTextResponse = generatedText;

    // Summary of the message in 5 words
    const summary2 = await AIService.generateSummaryFromMessage(queuedMessage, generatedTextResponse);
    console.log('Summary 2:', summary2);
    DiscordService.setUserActivity(summary2);
    LightWrapper.setState({ color: 'blue' }, PRIMARY_LIGHT_ID);

    if (GENERATE_IMAGE) {
        const imageGenerationStatusIsUp = await AIService.checkImageGenerationStatus();
        if (true) {
            let newImagePrompt = await AIService.createImagePromptFromImageAndText(
                queuedMessage,
                imagePrompt,
                generatedText,
                imageToGenerate
            );
            
            LightWrapper.setState({ color: 'purple' }, PRIMARY_LIGHT_ID);
    
            if (newImagePrompt) {
                generatedImage = await AIService.generateImage(newImagePrompt);
                
                LightWrapper.setState({ color: 'yellow' }, PRIMARY_LIGHT_ID);
                if (generatedImage) {
                    const {
                        generatedText: generatedText2
                    } = await AIService.generateNewTextResponsePart2(
                        client,
                        queuedMessage,
                        recentMessages,
                        modifiedMessage,
                        systemPrompt,
                        newImagePrompt
                    );
                    generatedTextResponse = generatedText2;
                    LightWrapper.setState({ color: 'purple' }, PRIMARY_LIGHT_ID);
                }
            }
        }
    }

    if (!generatedTextResponse) {
        UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
        timerInterval.unref();
        UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'red' }, 'end']]);
        queuedMessage.reply("...");
        clearInterval(sendTypingInterval);
        lastMessageSentTime = luxon.DateTime.now().toISO();
        return;
    }

    //  replace <@!1234567890> with the user's display name
    // const voicePrompt = responseMessage.replace(/<@!?\d+>/g, (match) => {
    //     const id = match.replace(/<@!?/, '').replace('>', '');
    //     return UtilityLibrary.findUserById(client, id);
    // }).substring(0, 220);

    
    let generatedAudioFile, generatedAudioBuffer;

    // if (GENERATE_VOICE) { 
    //     UtilityLibrary.consoleInfo([[`🎤 Generating voice...`, { color: 'yellow' }, 'middle']]);
    //     ({ filename: generatedAudioFile, buffer: generatedAudioBuffer } = await AIService.generateVoice(message, voicePrompt))
    //     UtilityLibrary.consoleInfo([[`🎤 ... voice generated.`, { color: 'green' }, 'middle']]);
    // }

    const messageChunkSizeLimit = 2000;
    for (let i = 0; i < generatedTextResponse.length; i += messageChunkSizeLimit) {
        const chunk = generatedTextResponse.substring(i, i + messageChunkSizeLimit);
        let messageReplyOptions = { content: chunk };
        let files = [];

        if (generatedAudioFile && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
            files.push({ attachment: await fs.promises.readFile(`${BARK_VOICE_FOLDER}/${generatedAudioFile}`), name: `${generatedAudioFile}` });
        }
        if (generatedAudioBuffer && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
            files.push({ attachment: Buffer.from(generatedAudioBuffer, 'base64'), name: 'lupos.mp3' });
        }
        if (generatedImage && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
            files.push({ attachment: Buffer.from(generatedImage, 'base64'), name: 'lupos.png' });
        }
        messageReplyOptions = { ...messageReplyOptions, files: files};
        await queuedMessage.reply(messageReplyOptions);
    }

    lastMessageSentTime = luxon.DateTime.now().toISO();
    
    clearInterval(sendTypingInterval);
    LightWrapper.setState({ color: 'white' }, PRIMARY_LIGHT_ID);
    UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
    timerInterval.unref();
    
    if (queuedMessage.guild) {
        console.log('channel id:', queuedMessage.channel.id);
        UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in ${queuedMessage.guild.name} #${queuedMessage.channel.name}`, { color: 'cyan' }, 'middle']]);
    } else {
        console.log('channel id:', queuedMessage.channel.id);
        UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in a private message`, { color: 'cyan' }, 'middle']]);
    }
    UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'green' }, 'end']]);
}

DiscordService.login();
DiscordService.onEventClientReady(onReady);
DiscordService.onEventMessageCreate(onMessageCreateQueue);
DiscordService.onEventMessageReactionAdd(onReactionCreateQueue);

setInterval(() => {     
    let currentTime = luxon.DateTime.now();
    let lastMessageSentTimeObject = luxon.DateTime.fromISO(lastMessageSentTime);
    let difference = currentTime.diff(lastMessageSentTimeObject, ['seconds']).toObject();
    if (difference.seconds >= 30) {
        lastMessageSentTime = currentTime.toISO();
    }
}, 1000);
