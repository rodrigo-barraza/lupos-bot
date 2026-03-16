/* eslint-disable no-undef, no-constant-condition */
process.env.NODE_NO_WARNINGS = "stream/web";
import "dotenv/config";
import config from "./config.js";
const {
  VENDOR_TOKEN,
  _WHITEMANE_OVERREACTOR_ROLE_ID,
  _WHITEMANE_POLITICS_CHANNEL_ID,
  _GUILD_ID_WHITEMANE,
  _GENERATE_VOICE,
  BLABBERMOUTH,
  _DETECT_AND_REACT,
  BARK_VOICE_FOLDER,
  GENERATE_IMAGE,
  _CHANNEL_ID_WHITEMANE_HIGHLIGHTS,
  _CHANNEL_ID_THE_CLAM_HIGHLIGHTS,
  _CHANNEL_ID_WHITEMANE_BOOTY_BAE,
  PRIMARY_LIGHT_ID,
} = config;
import fs from "node:fs";
import { _Collection, _Events, ChannelType, _EmbedBuilder } from "discord.js";
import utilities from "./libraries/utilities.js";
import MoodService from "./services/MoodService.js";
import DiscordService from "./services/DiscordService.js";
import luxon from "luxon";
import _ScraperService from "./services/ScraperService.js";
import LightService from "./services/LightService.js";
const app = express();

// SERVER

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  );
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", true);
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
app.use("/", services());

// ========================================

const _IGNORE_PREFIX = "!";
let lastMessageSentTime = luxon.DateTime.now().toISO();

const client = DiscordService.client;

function displayAllGuilds() {
  const guilds = DiscordService.getAllGuilds();
  const connectedGuildsText = `🌎 Connected Guilds (Servers): ${guilds.length}`;
  utilities.consoleInfo([[connectedGuildsText, {}]]);
}

async function onReady() {
  utilities.consoleInfo([
    [`👌 Logged in as ${DiscordService.getBotName()}`, { bold: true }],
  ]);
  // AlcoholService.instantiate();
  MoodService.instantiate();
  displayAllGuilds();
  if (BLABBERMOUTH) {
    autoAssignRoles(client);
    setInterval(() => {
      autoAssignRoles(client);
    }, 10 * 1000);
  }
  const guild = client.guilds.cache.find(
    (guild) => guild.name === "Classic Whitemane",
  );
  console.log("Channels for Classic Whitemane:");
  for (const channel of guild.channels.cache.values()) {
    if (
      channel.type === ChannelType.GuildText &&
      // channel.parent.name !== 'Archived' &&
      // channel.parent.name !== 'Archived: First Purge' &&
      // channel.parent.name !== 'Archived: SOD' &&
      // channel.parent.name !== 'Archived: Alliance' &&
      // channel.parent.name !== 'Archived: WoW Classes' &&
      // channel.parent.name !== '⚒ Administration' &&
      // channel.parent.name !== 'Info' &&
      // channel.parent.name !== 'Welcome'
      (channel.parent.name === "Classic WoW" ||
        channel.parent.name === "Classic Cataclysm")
    ) {
      const messages = await DiscordService.fetchMessages(channel.id, 1);
      const lastMessageSentOn = luxon.DateTime.fromMillis(
        messages[0].createdTimestamp,
      );
      const now = luxon.DateTime.local();
      const daysDifference = lastMessageSentOn
        .until(now)
        .toDuration(["days"])
        .toObject()
        .days.toFixed(0);
      const paddedDaysDifference = daysDifference.padStart(6, "0");
      console.log(`${paddedDaysDifference} days`, channel.name);
    }
  }
  console.log("-------------------");
}

utilities.consoleInfo([[`---`, { bold: true, color: "green" }]]);
utilities.consoleInfo([
  [`🤖 Vendor the Vending Bot v1.0 starting`, { bold: true, color: "red" }],
]);

async function replyMessage(client, queuedMessage) {
  LightService.setState({ color: "purple" }, PRIMARY_LIGHT_ID);
  // await DiscordService.fetchMessages(1302506119813660692, 300);
  await queuedMessage.channel.sendTyping();
  const fetchRecentMessages = (
    await queuedMessage.channel.messages.fetch({ limit: 100 })
  ).reverse();
  const recentMessages = fetchRecentMessages.map((msg) => msg);
  const sendTypingInterval = setInterval(() => {
    queuedMessage.channel.sendTyping();
  }, 5000);
  const discordUserTag = utilities.discordUserTag(queuedMessage);
  let timer = 0;
  const timerInterval = setInterval(() => {
    timer++;
  }, 1000);

  utilities.consoleInfo([
    [
      `═══════════════░▒▓ +MESSAGE+ ▓▒░════════════════════════════════════`,
      { color: "yellow" },
      "start",
    ],
  ]);

  if (queuedMessage.guild) {
    utilities.consoleInfo([
      [
        `💬 Replying to: ${discordUserTag} in ${queuedMessage.guild.name} #${queuedMessage.channel.name}`,
        { color: "cyan" },
        "middle",
      ],
    ]);
  } else {
    utilities.consoleInfo([
      [
        `💬 Replying to: ${discordUserTag} in a private message`,
        { color: "cyan" },
        "middle",
      ],
    ]);
  }
  const imageToGenerate = queuedMessage.content;
  let generatedTextResponse;
  let generatedImage;

  // Summary of the message in 5 words
  const messageContent = queuedMessage.content.replace(
    `<@${client.user.id}>`,
    "",
  );
  const summary = await DiscordService.generateSummaryFromMessage(
    queuedMessage,
    messageContent,
  );
  console.log("Summary:", summary);
  DiscordService.setUserActivity(summary);
  LightService.setState({ color: "red" }, PRIMARY_LIGHT_ID);

  const { generatedText, imagePrompt, modifiedMessage, systemPrompt } =
    await DiscordService.generateNewTextResponse(
      client,
      queuedMessage,
      recentMessages,
    );
  LightService.setState({ color: "yellow" }, PRIMARY_LIGHT_ID);

  generatedTextResponse = generatedText;

  if (GENERATE_IMAGE) {
    const _imageGenerationStatusIsUp =
      await DiscordService.checkImageGenerationStatus();
    if (true) {
      const newImagePrompt =
        await DiscordService.createImagePromptFromImageAndText(
          queuedMessage,
          imagePrompt,
          generatedText,
          imageToGenerate,
        );

      LightService.setState({ color: "purple" }, PRIMARY_LIGHT_ID);

      if (newImagePrompt) {
        generatedImage = await DiscordService.generateImage(newImagePrompt);

        LightService.setState({ color: "yellow" }, PRIMARY_LIGHT_ID);
        if (generatedImage) {
          const { generatedText: generatedText2 } =
            await DiscordService.generateNewTextResponsePart2(
              client,
              queuedMessage,
              recentMessages,
              modifiedMessage,
              systemPrompt,
              newImagePrompt,
            );
          generatedTextResponse = generatedText2;
          LightService.setState({ color: "purple" }, PRIMARY_LIGHT_ID);
        }
      }
    }
  }

  if (!generatedTextResponse) {
    utilities.consoleInfo([
      [`⏱️ Duration: ${timer} seconds`, { color: "cyan" }, "middle"],
    ]);
    timerInterval.unref();
    utilities.consoleInfo([
      [
        `═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`,
        { color: "red" },
        "end",
      ],
    ]);
    queuedMessage.reply("...");
    clearInterval(sendTypingInterval);
    lastMessageSentTime = luxon.DateTime.now().toISO();
    return;
  }

  //  replace <@!1234567890> with the user's display name
  // const voicePrompt = responseMessage.replace(/<@!?\d+>/g, (match) => {
  //     const id = match.replace(/<@!?/, '').replace('>', '');
  //     return utilities.findUserById(client, id);
  // }).substring(0, 220);

  let generatedAudioFile, generatedAudioBuffer;

  // if (GENERATE_VOICE) {
  //     utilities.consoleInfo([[`🎤 Generating voice...`, { color: 'yellow' }, 'middle']]);
  //     ({ filename: generatedAudioFile, buffer: generatedAudioBuffer } = await DiscordService.generateVoice(message, voicePrompt))
  //     utilities.consoleInfo([[`🎤 ... voice generated.`, { color: 'green' }, 'middle']]);
  // }

  const messageChunkSizeLimit = 2000;
  for (
    let i = 0;
    i < generatedTextResponse.length;
    i += messageChunkSizeLimit
  ) {
    const chunk = generatedTextResponse.substring(i, i + messageChunkSizeLimit);
    let messageReplyOptions = { content: chunk };
    const files = [];

    if (
      generatedAudioFile &&
      i + messageChunkSizeLimit >= generatedTextResponse.length
    ) {
      files.push({
        attachment: await fs.promises.readFile(
          `${BARK_VOICE_FOLDER}/${generatedAudioFile}`,
        ),
        name: `${generatedAudioFile}`,
      });
    }
    if (
      generatedAudioBuffer &&
      i + messageChunkSizeLimit >= generatedTextResponse.length
    ) {
      files.push({
        attachment: Buffer.from(generatedAudioBuffer, "base64"),
        name: "lupos.mp3",
      });
    }
    if (
      generatedImage &&
      i + messageChunkSizeLimit >= generatedTextResponse.length
    ) {
      files.push({
        attachment: Buffer.from(generatedImage, "base64"),
        name: "lupos.png",
      });
    }
    messageReplyOptions = { ...messageReplyOptions, files: files };
    await queuedMessage.reply(messageReplyOptions);
  }

  lastMessageSentTime = luxon.DateTime.now().toISO();

  clearInterval(sendTypingInterval);
  LightService.setState({ color: "white" }, PRIMARY_LIGHT_ID);
  utilities.consoleInfo([
    [`⏱️ Duration: ${timer} seconds`, { color: "cyan" }, "middle"],
  ]);
  timerInterval.unref();

  if (queuedMessage.guild) {
    console.log("channel id:", queuedMessage.channel.id);
    utilities.consoleInfo([
      [
        `💬 Replied to: ${discordUserTag} in ${queuedMessage.guild.name} #${queuedMessage.channel.name}`,
        { color: "cyan" },
        "middle",
      ],
    ]);
  } else {
    console.log("channel id:", queuedMessage.channel.id);
    utilities.consoleInfo([
      [
        `💬 Replied to: ${discordUserTag} in a private message`,
        { color: "cyan" },
        "middle",
      ],
    ]);
  }
  utilities.consoleInfo([
    [
      `═══════════════░▒▓ -MESSAGE- ▓▒░════════════════════════════════════`,
      { color: "green" },
      "end",
    ],
  ]);
}

DiscordService.login(VENDOR_TOKEN);
DiscordService.onEventClientReady(onReady);
DiscordService.onEventMessageCreate(DiscordService.onMessageCreateQueue);
DiscordService.onEventMessageReactionAdd(onReactionCreateQueue);

// On Webhook Message
const webhookMessageQueue = [];
let isProcessingWebhookMessageQueue = false;
async function _onWebhookMessageCreateQueue(client, message) {
  webhookMessageQueue.push(message);

  if (!isProcessingWebhookMessageQueue) {
    isProcessingWebhookMessageQueue = true;
    while (webhookMessageQueue.length > 0) {
      const queuedMessage = webhookMessageQueue.shift();
      await replyMessage(client, queuedMessage);
    }
    isProcessingWebhookMessageQueue = false;
    return;
  }
}

setInterval(() => {
  const currentTime = luxon.DateTime.now();
  const lastMessageSentTimeObject = luxon.DateTime.fromISO(lastMessageSentTime);
  const difference = currentTime
    .diff(lastMessageSentTimeObject, ["seconds"])
    .toObject();
  if (difference.seconds >= 30) {
    lastMessageSentTime = currentTime.toISO();
  }
}, 1000);
