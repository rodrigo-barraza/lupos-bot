import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

let clients = [];

const DiscordWrapper = {
  clients: clients,
  createClient (name, token) {
    let client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
      ],
      retryLimit: 3,
      restRequestTimeout: 60000,
    });

    client.login(token);
    client.options.failIfNotExists = false;

    clients.push({
      name: name,
      client: client,
    });

    return client;
  },
  getClient (name) {
    return clients.find(client => client.name === name).client;
  },
};

export default DiscordWrapper;