process.env.NODE_NO_WARNINGS = 'stream/web';
require('dotenv/config');
const {
    WHITEMANE_YAPPER_ROLE_ID, WHITEMANE_OVERREACTOR_ROLE_ID, WHITEMANE_POLITICS_CHANNEL_ID, GUILD_ID_WHITEMANE,
    GENERATE_VOICE, BLABBERMOUTH, DETECT_AND_REACT, DISCORD_TOKEN, BARK_VOICE_FOLDER, GENERATE_IMAGE
} = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, Events, ChannelType } = require('discord.js');
const UtilityLibrary = require('./libraries/UtilityLibrary.js');
const AlcoholService = require('./services/AlcoholService.js');
const MoodService = require('./services/MoodService.js');
const DiscordWrapper = require('./wrappers/DiscordWrapper.js');
const AIService = require('./services/AIService.js');
const YapperService = require('./services/YapperService.js');
const luxon = require('luxon');
const PuppeteerWrapper = require('./wrappers/PuppeteerWrapper.js');

let isResponding = false
const IGNORE_PREFIX = "!";
let previousTopAuthorId;
let previousOverReactorId;
let lastMessageSentTime = luxon.DateTime.now().toISO()
let processingMessageQueue = false;
const queue = []

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

async function onMessageCreate(message) {
    if (DETECT_AND_REACT) {
        UtilityLibrary.detectHowlAndRespond(message)
        await UtilityLibrary.detectMessageAndReact(message)
    }
    const isDirectMessageByBot = message.channel.type === ChannelType.DM && message.author.id === client.user.id;
    const isMessageWithoutBotMention = message.channel.type != ChannelType.DM && !message.mentions.has(client.user);

    if (message.content.startsWith(IGNORE_PREFIX)) { return }
    if (isDirectMessageByBot) { return }
    if (isMessageWithoutBotMention) { return }

    queue.push(message);
    if (!processingMessageQueue) {
        isResponding = true
        await messageQueue()
        isResponding = false
        return
    }
}

UtilityLibrary.consoleInfo([[`---`, { bold: true, color: 'green' }]]);
UtilityLibrary.consoleInfo([[`🤖 Lupos v1.0 starting`, { bold: true, color: 'red' }]]);
    
async function messageQueue() {
    if (processingMessageQueue || queue.length === 0) {
        console.log('Message Queue is currently processing or empty');
        return;
    }
    processingMessageQueue = true;
    while (queue.length > 0) {
        const message = queue.shift();
        await message.channel.sendTyping();
        
        let fetchRecentMessages = (await message.channel.messages.fetch({ limit: 100 })).reverse();
        let recentMessages = fetchRecentMessages.map((msg) => msg);

        const sendTypingInterval = setInterval(() => { message.channel.sendTyping() }, 5000);

        const discordUserTag = UtilityLibrary.discordUserTag(message);
        
        let timer = 0;

        const timerInterval = setInterval(() => {
            timer++;
        }, 1000);
        
        UtilityLibrary.consoleInfo([[`═══════════════░▒▓ +MESSAGE+ ▓▒░════════════════════════════════════`, { color: 'yellow' }, 'start']]);

        if (message.guild) {
            UtilityLibrary.consoleInfo([[`💬 Replying to: ${discordUserTag} in ${message.guild.name} #${message.channel.name}`, { color: 'cyan' }, 'middle']]);
        } else {
            UtilityLibrary.consoleInfo([[`💬 Replying to: ${discordUserTag} in a private message`, { color: 'cyan' }, 'middle']]);
        }
        let imageToGenerate = message.content;
        let generatedTextResponse;
        let generatedImage;

        // Summary of the message in 5 words
        const messageContent = message.content.replace(`<@${client.user.id}>`, '');
        const summary = await AIService.generateSummaryFromMessage(message, messageContent);
        client.user.setActivity(summary, { type: 4 });

        if (GENERATE_IMAGE) {
            const { generatedText, imagePrompt, modifiedMessage, systemPrompt } = await AIService.generateNewTextResponse(
                client, message, recentMessages);
            generatedTextResponse = generatedText;
            
            let newImagePrompt = await AIService.createImagePromptFromImageAndText(
                message, imagePrompt, generatedText, imageToGenerate);
            generatedImage = await AIService.generateImage(newImagePrompt);

            const { generatedText: generatedText2 } = await AIService.generateNewTextResponsePart2(
                client, message, recentMessages, modifiedMessage, systemPrompt, newImagePrompt);
            generatedTextResponse = generatedText2;

        } else {
            const { generatedText } = await AIService.generateNewTextResponse(client, message, recentMessages);
            generatedTextResponse = generatedText;
        }
    
        if (!generatedTextResponse) {
            UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
            timerInterval.unref();
            UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'red' }, 'end']]);
            message.reply("...");
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
            await message.reply(messageReplyOptions);
        }
        lastMessageSentTime = luxon.DateTime.now().toISO();
        
        clearInterval(sendTypingInterval);
        UtilityLibrary.consoleInfo([[`⏱️ Duration: ${timer} seconds`, { color: 'cyan' }, 'middle']]);
        timerInterval.unref();
        
        if (message.guild) {
            UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in ${message.guild.name} #${message.channel.name}`, { color: 'cyan' }, 'middle']]);
        } else {
            UtilityLibrary.consoleInfo([[`💬 Replied to: ${discordUserTag} in a private message`, { color: 'cyan' }, 'middle']]);
        }
        UtilityLibrary.consoleInfo([[`═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`, { color: 'green' }, 'end']]);
    }
    // MoodService.instantiate();
    processingMessageQueue = false;    
}

client.on(Events.ClientReady, onReady);
client.on(Events.MessageCreate, onMessageCreate);
client.on(Events.MessageReactionAdd, async message => {
    // console.log('Reaction added:', message);
    // if reaction is detected, add a reaction to the message
});

setInterval(() => {
    let currentTime = luxon.DateTime.now();
    let lastMessageSentTimeObject = luxon.DateTime.fromISO(lastMessageSentTime);
    let difference = currentTime.diff(lastMessageSentTimeObject, ['seconds']).toObject();
    if (difference.seconds >= 30) {
        lastMessageSentTime = currentTime.toISO();
    }
}, 1000);

client.login(DISCORD_TOKEN);
