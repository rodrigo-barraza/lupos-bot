import "dotenv/config";
import {
  Client,
  _Collection,
  _Events,
  GatewayIntentBits,
  Partials,
  _ChannelType,
  _Message,
} from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

export default client;
