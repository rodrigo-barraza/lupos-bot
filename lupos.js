process.env.NODE_NO_WARNINGS = 'stream/web';
require('dotenv/config');
const {
    WHITEMANE_YAPPER_ROLE_ID, WHITEMANE_OVERREACTOR_ROLE_ID, WHITEMANE_POLITICS_CHANNEL_ID, GUILD_ID_WHITEMANE,
    GENERATE_VOICE, BLABBERMOUTH, DETECT_AND_REACT, DISCORD_TOKEN, BARK_VOICE_FOLDER, GENERATE_IMAGE,
    CHANNEL_ID_WHITEMANE_HIGHLIGHTS, CHANNEL_ID_THE_CLAM_HIGHLIGHTS, CHANNEL_ID_WHITEMANE_BOOTY_BAE
} = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, Events, ChannelType, EmbedBuilder } = require('discord.js');
const UtilityLibrary = require('./libraries/UtilityLibrary.js');
const AlcoholService = require('./services/AlcoholService.js');
const MoodService = require('./services/MoodService.js');
const DiscordWrapper = require('./wrappers/DiscordWrapper.js');
const AIService = require('./services/AIService.js');
const YapperService = require('./services/YapperService.js');
const luxon = require('luxon');
const PuppeteerWrapper = require('./wrappers/PuppeteerWrapper.js');
const LightWrapper = require('./wrappers/LightWrapper.js');

const IGNORE_PREFIX = "!";
let previousTopAuthorId;
let previousOverReactorId;
let lastMessageSentTime = luxon.DateTime.now().toISO()






const client = DiscordWrapper.instantiate();

// client.commands = new Collection();
// const foldersPath = path.join(__dirname, 'commands');
// const commandFolders = fs.readdirSync(foldersPath);

// for (const folder of commandFolders) {
// 	const commandsPath = path.join(foldersPath, folder);
// 	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
// 	for (const file of commandFiles) {
// 		const filePath = path.join(commandsPath, file);
// 		const command = require(filePath);
// 		// Set a new item in the Collection with the key as the command name and the value as the exported module
// 		if ('data' in command && 'execute' in command) {
// 			client.commands.set(command.data.name, command);
// 		} else {
// 			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
// 		}
// 	}
// }

// client.on(Events.InteractionCreate, async interaction => {
// 	if (!interaction.isChatInputCommand()) return;

// 	const command = interaction.client.commands.get(interaction.commandName);

// 	if (!command) {
// 		console.error(`No command matching ${interaction.commandName} was found.`);
// 		return;
// 	}

// 	try {
// 		await command.execute(interaction);
// 	} catch (error) {
// 		console.error(error);
// 		if (interaction.replied || interaction.deferred) {
// 			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
// 		} else {
// 			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
// 		}
// 	}
// });

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
}

async function autoAssignRoles(client) {
    const channel1 = client.channels.cache.get(WHITEMANE_POLITICS_CHANNEL_ID);
    const guild = client.guilds.cache.get(GUILD_ID_WHITEMANE);

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

function displayAllGuilds() {
    const guildArray = []
    client.guilds.cache.forEach(guild => {
        guildArray.push(guild);
    });
    let connectedGuildsText = `🌎 Connected Guilds (Servers): ${guildArray.length }`
    UtilityLibrary.consoleInfo([[connectedGuildsText, {}]]);
}

function onReady() {
    UtilityLibrary.consoleInfo([[`👌 Logged in as ${client.user.tag}`, { bold: true }]]);
    // AlcoholService.instantiate();
    MoodService.instantiate();
    displayAllGuilds()
    if (BLABBERMOUTH) {
        autoAssignRoles(client)
        setInterval(() => {
            autoAssignRoles(client)
        }, 10 * 1000);
    }
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
            await processMessage(client, queuedMessage);
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
    const channelName = client.channels.cache.get(channelId).name;
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
    UtilityLibrary.consoleInfo([[`💬 Message: ${content}, Users: ${[...allUniqueUsers[messageId]].length}, Total: ${queuedReaction.message.reactions.cache.size}`, { color: 'yellow' }, 'middle']]);
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


        const currentReferenceChannel = client.channels.cache.get(referenceChannelId);

        if (currentReferenceChannel?.messages) {
            referenceMessage = await currentReferenceChannel.messages.fetch(referenceMessageId)
        }

        const targetChannel = client.channels.cache.get(highlightsChannel);

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

async function processMessage(client, queuedMessage) {
    await queuedMessage.channel.sendTyping();
    LightWrapper.setState({ color: 'purple' }, 'd073d523f763');
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
    client.user.setActivity(summary, { type: 4 });

    if (GENERATE_IMAGE) {
        const { generatedText, imagePrompt, modifiedMessage, systemPrompt } = await AIService.generateNewTextResponse(
            client, queuedMessage, recentMessages);
        generatedTextResponse = generatedText;
        
        let newImagePrompt = await AIService.createImagePromptFromImageAndText(
            queuedMessage, imagePrompt, generatedText, imageToGenerate);

        if (newImagePrompt) {
            generatedImage = await AIService.generateImage(newImagePrompt);
            if (generatedImage) {
                const { generatedText: generatedText2 } = await AIService.generateNewTextResponsePart2(
                    client, queuedMessage, recentMessages, modifiedMessage, systemPrompt, newImagePrompt);
                generatedTextResponse = generatedText2;
            }
        }


    } else {
        const { generatedText } = await AIService.generateNewTextResponse(client, queuedMessage, recentMessages);
        generatedTextResponse = generatedText;
    }

    if (!generatedTextResponse) {
        UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
        timerInterval.unref();
        UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'red' }, 'end']]);
        queuedMessage.reply("...");
        clearInterval(sendTypingInterval);
        timerInterval.unref();
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
    LightWrapper.setState({ color: 'white' }, 'd073d523f763');
    UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
    timerInterval.unref();
    
    if (queuedMessage.guild) {
        UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in ${queuedMessage.guild.name} #${queuedMessage.channel.name}`, { color: 'cyan' }, 'middle']]);
    } else {
        UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in a private message`, { color: 'cyan' }, 'middle']]);
    }
    UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'green' }, 'end']]);
}

client.on(Events.ClientReady, onReady);
client.on(Events.MessageCreate, async message => { onMessageCreateQueue(client, message) });
client.on(Events.MessageReactionAdd, async messageReaction => { onReactionCreateQueue(client, messageReaction) });

setInterval(() => {     
    let currentTime = luxon.DateTime.now();
    let lastMessageSentTimeObject = luxon.DateTime.fromISO(lastMessageSentTime);
    let difference = currentTime.diff(lastMessageSentTimeObject, ['seconds']).toObject();
    if (difference.seconds >= 30) {
        lastMessageSentTime = currentTime.toISO();
    }
}, 1000);

client.login(DISCORD_TOKEN);
