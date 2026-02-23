process.env.NODE_NO_WARNINGS = 'stream/web';
import 'dotenv/config';
import config from './config.json' with { type: 'json' };
const {
    VENDOR_TOKEN, WHITEMANE_OVERREACTOR_ROLE_ID, WHITEMANE_POLITICS_CHANNEL_ID, GUILD_ID_WHITEMANE,
    GENERATE_VOICE, BLABBERMOUTH, DETECT_AND_REACT, BARK_VOICE_FOLDER, GENERATE_IMAGE,
    CHANNEL_ID_WHITEMANE_HIGHLIGHTS, CHANNEL_ID_THE_CLAM_HIGHLIGHTS, CHANNEL_ID_WHITEMANE_BOOTY_BAE,
    PRIMARY_LIGHT_ID
} = config;
import fs from 'node:fs';
import { Collection, Events, ChannelType, EmbedBuilder } from 'discord.js';
import UtilityLibrary from './libraries/UtilityLibrary.js';
import MoodService from './services/MoodService.js';
import DiscordService from './services/DiscordService.js';
import luxon from 'luxon';
import PuppeteerWrapper from './wrappers/PuppeteerWrapper.js';
import LightWrapper from './wrappers/LightWrapper.js';
const app = express();


// SERVER

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});
// console.log(`connecting to: mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_TABLE}?retryWrites=true&w=majority`);
app.listen(process.env.SERVER_PORT, () => {
    // mongoose.connect(`mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_TABLE}?retryWrites=true&w=majority`);
    // mongoose.connection.on('error', console.error.bind(console, 'connection error:'));
    // mongoose.connection.once('open', function(callback) {
    //     console.log(`connected to: mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER}/${process.env.MONGO_TABLE}?retryWrites=true&w=majority`);
    //     console.log(process.env.SERVER_PORT);
    // });
    console.log(process.env.SERVER_PORT);
});
app.use('/', services());

// ========================================

const IGNORE_PREFIX = "!";
let lastMessageSentTime = luxon.DateTime.now().toISO()

const client = DiscordService.client;

function displayAllGuilds() {
    const guilds = DiscordService.getAllGuilds();
    let connectedGuildsText = `🌎 Connected Guilds (Servers): ${guilds.length}`
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
    console.log('-------------------');
}

UtilityLibrary.consoleInfo([[`---`, { bold: true, color: 'green' }]]);
UtilityLibrary.consoleInfo([[`🤖 Vendor the Vending Bot v1.0 starting`, { bold: true, color: 'red' }]]);

async function replyMessage(client, queuedMessage) {
    LightWrapper.setState({ color: 'purple' }, PRIMARY_LIGHT_ID);
    // await DiscordService.fetchMessages(1302506119813660692, 300);
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
    const summary = await DiscordService.generateSummaryFromMessage(queuedMessage, messageContent);
    console.log('Summary:', summary);
    DiscordService.setUserActivity(summary);
    LightWrapper.setState({ color: 'red' }, PRIMARY_LIGHT_ID);

    const {
        generatedText,
        imagePrompt,
        modifiedMessage,
        systemPrompt
    } = await DiscordService.generateNewTextResponse(
        client,
        queuedMessage,
        recentMessages
    );
    LightWrapper.setState({ color: 'yellow' }, PRIMARY_LIGHT_ID);

    generatedTextResponse = generatedText;

    if (GENERATE_IMAGE) {
        const imageGenerationStatusIsUp = await DiscordService.checkImageGenerationStatus();
        if (true) {
            let newImagePrompt = await DiscordService.createImagePromptFromImageAndText(
                queuedMessage,
                imagePrompt,
                generatedText,
                imageToGenerate
            );

            LightWrapper.setState({ color: 'purple' }, PRIMARY_LIGHT_ID);

            if (newImagePrompt) {
                generatedImage = await DiscordService.generateImage(newImagePrompt);

                LightWrapper.setState({ color: 'yellow' }, PRIMARY_LIGHT_ID);
                if (generatedImage) {
                    const {
                        generatedText: generatedText2
                    } = await DiscordService.generateNewTextResponsePart2(
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
    //     ({ filename: generatedAudioFile, buffer: generatedAudioBuffer } = await DiscordService.generateVoice(message, voicePrompt))
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
        messageReplyOptions = { ...messageReplyOptions, files: files };
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

DiscordService.login(VENDOR_TOKEN);
DiscordService.onEventClientReady(onReady);
DiscordService.onEventMessageCreate(DiscordService.onMessageCreateQueue);
DiscordService.onEventMessageReactionAdd(onReactionCreateQueue);

// On Webhook Message
const webhookMessageQueue = [];
let isProcessingWebhookMessageQueue = false;
async function onWebhookMessageCreateQueue(client, message) {
    webhookMessageQueue.push(message);

    if (!isProcessingWebhookMessageQueue) {
        isProcessingWebhookMessageQueue = true;
        while (webhookMessageQueue.length > 0) {
            const queuedMessage = webhookMessageQueue.shift();
            await replyMessage(client, queuedMessage);
        }
        isProcessingWebhookMessageQueue = false;
        return
    }
}


setInterval(() => {
    let currentTime = luxon.DateTime.now();
    let lastMessageSentTimeObject = luxon.DateTime.fromISO(lastMessageSentTime);
    let difference = currentTime.diff(lastMessageSentTimeObject, ['seconds']).toObject();
    if (difference.seconds >= 30) {
        lastMessageSentTime = currentTime.toISO();
    }
}, 1000);
