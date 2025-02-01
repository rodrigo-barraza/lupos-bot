const client = require('../wrappers/DiscordWrapperNew.js');
const { Collection, Events, ChannelType, EmbedBuilder } = require('discord.js');
const {
    DISCORD_TOKEN
} = require('../config.json');

const MessageService = {
    client: client,
    // Special functions
    async fetchMessages(channelId, maxMessages = 10) {
        const channel = client.channels.cache.find(channel => channel.id == channelId);
        if (channel) {
            let messages = await channel.messages.fetch({ limit: Math.min(100, maxMessages) });
            let fetchedMessages = [...messages.values()];
        
            while (fetchedMessages.length < maxMessages && messages.size !== 0) {
                const lastMessage = fetchedMessages[fetchedMessages.length - 1];
                const additionalMessagesNeeded = maxMessages - fetchedMessages.length;
                if (additionalMessagesNeeded <= 0) break;
                messages = await channel.messages.fetch({ limit: Math.min(100, additionalMessagesNeeded), before: lastMessage.id });
                fetchedMessages = fetchedMessages.concat([...messages.values()]);
            } 
            return fetchedMessages;
        }
    },
    login() {
      return client.login(DISCORD_TOKEN);
    },
    // Event functions
    onEventClientReady(onReady) {
      return client.on(Events.ClientReady, onReady);
    },
    onEventMessageCreate(onMessageCreateQueue) {
      client.on(Events.MessageCreate, async message => { onMessageCreateQueue(client, message) });
    },
    onEventMessageReactionAdd(onReactionCreateQueue) {
      return client.on(Events.MessageReactionAdd, async messageReaction => { onReactionCreateQueue(client, messageReaction) });
    },
    // User functions
    getUserById(userId) {
      return client.users.cache.get(userId);
    },
    getBotName() {
      return client.user.tag;
    },
    setUserActivity(message) {
      return client.user.setActivity(message, { type: 4 });
    },
    // Channel functions
    getChannelById(channelId) {
        return client.channels.cache.get(channelId);
    },
    getChannelName(channelId) {
      return client.channels.cache.get(channelId)?.name;
    },
    // Guilds functions
    getGuildById(guildId) {
      return client.guilds.cache.get(guildId);
    },
    getAllGuilds() {
        let guilds = [];
        client.guilds.cache.forEach(guild => { guilds.push(guild) });
        return guilds;
    },
    getNameFromItem(item) {
      return item?.author?.displayName || item?.author?.username || item?.user?.globalName || item?.user?.username;
    },
    // REST functions
    async patchBanner(imageUrl) {
      return await client.rest.patch("/users/@me", { body: { banner: "data:image/gif;base64," + Buffer.from(imageUrl).toString('base64') } });
    },
    async patchBannerFromImageUrl(imageUrl) {
      return await client.rest.patch("/users/@me", { body: { banner: "data:image/gif;base64," + Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } });
    },
    async getBannerFromUserId(userId) {
      const getUser = await client.rest.get(`/users/${userId}`);
      return getUser.banner;
    },
};

module.exports = MessageService;
