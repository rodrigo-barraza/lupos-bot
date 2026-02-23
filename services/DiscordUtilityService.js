import 'dotenv/config';
import { DateTime } from 'luxon';
import UtilityLibrary from '../libraries/UtilityLibrary.js';
const { consoleLog } = UtilityLibrary;
import config from '../config.json' with { type: 'json' };
import { Collection, ChannelType, Events, ActivityType } from 'discord.js';
import PuppeteerWrapper from '../wrappers/PuppeteerWrapper.js';
import LightWrapper from '../wrappers/LightWrapper.js';
import LogFormatter from '../formatters/LogFormatter.js';

async function fetchMessagesWithOptionalLastId(client, channelId, maxMessages = 10, lastId = null) {
    const channel = client.channels.cache.find(channel => channel.id == channelId);

    if (channel) {
        let allMessages = new Collection();

        // Initial fetch
        let messages = await channel.messages.fetch({ limit: Math.min(100, maxMessages), before: lastId });
        allMessages = allMessages.concat(messages);

        // Continue fetching if we need more messages
        while (allMessages.size < maxMessages && messages.size !== 0) {
            lastId = messages.last()?.id;
            if (!lastId) break;

            const additionalMessagesNeeded = maxMessages - allMessages.size;
            messages = await channel.messages.fetch({
                limit: Math.min(100, additionalMessagesNeeded),
                before: lastId
            });

            allMessages = allMessages.concat(messages);
        }
        // If we fetched more than needed, trim the collection
        if (allMessages.size > maxMessages) {
            const trimmedCollection = new Collection();
            let count = 0;
            for (const [id, message] of allMessages) {
                if (count >= maxMessages) break;
                trimmedCollection.set(id, message);
                count++;
            }
            return trimmedCollection;
        }

        return allMessages;
    }
}

const transformUserPrimaryGuild = (userPrimaryGuild) => ({
    badge: userPrimaryGuild?.badge,
    identityEnabled: userPrimaryGuild?.identityEnabled,
    identityGuildId: userPrimaryGuild?.identityGuildId,
    tag: userPrimaryGuild?.tag
});

const transformUser = (user, concise = false) => {
    if (user) {
        const userObject = {
            // number | null | undefined
            accentColor: user.accentColor,
            // string | null
            avatar: user.avatar,
            // AvatarDecorationData | null
            avatarDecorationData: user.avatarDecorationData,
            // string | null | undefined
            banner: user.banner,
            // boolean
            bot: user.bot,
            // Date
            createdAt: user.createdAt,
            // number
            createdTimestamp: user.createdTimestamp,
            // string
            defaultAvatarURL: user.defaultAvatarURL,
            // string
            discriminator: user.discriminator,
            // string
            displayName: user.displayName,
            // DMChannel | null
            dmChannel: user.dmChannel,
            // UserFlagsBitField
            flags: user.flags,
            // string | null
            globalName: user.globalName,
            // HexColorString | null | undefined
            hexAccentColor: user.hexAccentColor,
            // Snowflake
            id: user.id,
            // false
            partial: user.partial,
            // UserPrimaryGuild | null
            primaryGuild: transformUserPrimaryGuild(user.primaryGuild),
            // boolean
            system: user.system,
            // string
            tag: user.tag,
            // string
            username: user.username
        };
        if (concise) {
            return {
                displayName: userObject.displayName,
                globalName: userObject.globalName,
                id: userObject.id,
                tag: userObject.tag,
                username: userObject.username,
            };
        } else {
            return userObject;
        }
    }
};

const transformRole = (role) => ({
    // ColorResolvable
    color: role.color,
    // Date
    createdAt: role.createdAt,
    // number
    createdTimestamp: role.createdTimestamp,
    // boolean
    deletable: role.deletable,
    // Guild
    // guild: role.guild,
    // Snowflake
    guildId: role.guildId,
    // boolean
    hoist: role.hoist,
    // Snowflake
    id: role.id,
    // boolean
    managed: role.managed,
    // string
    name: role.name,
    // number
    position: role.position,
    // RoleFlagsBitField
    flags: role.flags,
    // PermissionsBitField
    permissions: role.permissions,
    // boolean
    mentionable: role.mentionable,
    // string
    mention: role.mention,
    // string
    hexColor: role.hexColor,
    // string
    iconURL: role.iconURL(),
    // string
    url: role.url
});

const transformAttachment = (attachment) => {
    if (attachment) {
        return {
            // string | null
            contentType: attachment.contentType,
            // string | null
            description: attachment.description,
            // number | null
            duration: attachment.duration,
            // boolean
            ephemeral: attachment.ephemeral,
            // AttachmentFlagsBitField
            flags: attachment.flags,
            // number | null
            height: attachment.height,
            // Snowflake
            id: attachment.id,
            // string
            name: attachment.name,
            // string
            proxyURL: attachment.proxyURL,
            // number
            size: attachment.size,
            // boolean
            spoiler: attachment.spoiler,
            // string | null
            title: attachment.title,
            // string
            url: attachment.url,
            // string | null (base64 encoded)
            waveform: attachment.waveform,
            // number | null
            width: attachment.width
        };
    }
};

const transformTextChannel = (channel, concise = false) => {
    if (channel) {
        const textChannel = {
            // Client<true>
            // client: channel.client,
            // Date
            createdAt: channel.createdAt,
            // number
            createdTimestamp: channel.createdTimestamp,
            // ThreadAutoArchiveDuration (optional)
            defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration,
            // number | null
            defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser,
            // boolean
            deletable: channel.deletable,
            // ChannelFlagsBitField
            flags: channel.flags,
            // Guild
            guild: transformGuild(channel.guild, true),
            // Snowflake
            guildId: channel.guildId,
            // Snowflake
            id: channel.id,
            // Message (optional)
            // lastMessage: channel.lastMessage,
            // Snowflake (optional)
            lastMessageId: channel.lastMessageId,
            // Date (optional)
            lastPinAt: channel.lastPinAt,
            // number (optional)
            lastPinTimestamp: channel.lastPinTimestamp,
            // boolean
            manageable: channel.manageable,
            // Collection<Snowflake, GuildMember>
            // members: channel.members,
            // GuildMessageManager
            // messages: channel.messages,
            // string
            name: channel.name,
            // boolean
            nsfw: channel.nsfw,
            // CategoryChannel | null
            // parent: channel.parent,
            // Snowflake | null
            parentId: channel.parentId,
            // false
            partial: channel.partial,
            // PermissionOverwriteManager
            // permissionOverwrites: channel.permissionOverwrites,
            // boolean | null
            permissionsLocked: channel.permissionsLocked,
            // number
            position: channel.position,
            // number
            rateLimitPerUser: channel.rateLimitPerUser,
            // number
            rawPosition: channel.rawPosition,
            // GuildTextThreadManager<AllowedThreadTypeForTextChannel>
            // threads: channel.threads,
            // string | null
            topic: channel.topic,
            // boolean
            type: channel.type,
            // string
            url: channel.url,
            // boolean
            viewable: channel.viewable,
        };
        return textChannel;
    }
};

const transformEmbeds = (embeds) => {
    return embeds.map(embed => ({
        author: transformUser(embed.author, true),
        color: embed.color,
        // data: embed.data,
        description: embed.description,
        // fields: embed.fields,
        // footer: embed.footer,
        hexColor: embed.hexColor,
        // image: embed.image,
        length: embed.length,
        // provider: embed.provider,
        timestamp: embed.timestamp,
        title: embed.title,
        url: embed.url,
        // video: embed.video,
    }));
};

const transformGuild = (guild, concise = false) => {
    if (guild) {
        return {
            id: guild.id,
            name: guild.name
        };
    }
};

// const transformClient = (client) => ({
//     application
//     channels
//     guilds
//     lastPingTimestamps
//     options
//     ping
//     pings
//     readyAt
//     readyTimestamp
//     rest
//     shard
//     status
//     sweepers
//     token
//     uptime
//     user
//     users
//     voice
//     ws
// });

const transformPoll = (poll) => {
    if (poll) {
        return {
            // boolean
            allowMultiselect: poll.allowMultiselect,
            // Collection<number, PartialPollAnswer | PollAnswer>
            answers: poll.answers.map(answer => ({
                // client: answer.client,
                emoji: transformEmoji(answer.emoji, true),
                // number
                id: answer.id,
                // false
                partial: answer.partial,
                // PartialPoll | Poll (the poll this answer is part of)
                // poll: answer.poll,
                // string | null
                text: answer.text,
                // number
                voteCount: answer.voteCount,
                // PollAnswerVoterManager
                // fetchVoters: await answer.fetchVoters(),
            })),
            // channel: poll.channel,
            // channelId: poll.channelId,
            // client: poll.client,
            expiresAt: poll.expiresAt,
            expiresTimestamp: poll.expiresTimestamp,
            layoutType: poll.layoutType,
            // message: poll.message,
            // messageId: poll.messageId,
            // partial: poll.partial,
            question: poll.question,
            resultsFinalized: poll.resultsFinalized
        };
    }
}

const transformMessageMentions = (mentions) => {
    if (mentions) {
        // MessageMentions<InGuild>
        return {
            channels: mentions.channels.size ? mentions.channels.map(channel => transformTextChannel(channel, true)) : [],
            // client: transformClient(mentions.client),
            // boolean
            everyone: mentions.everyone,
            guild: transformGuild(mentions.guild, true),
            members: mentions.members?.size ? mentions.members.map(member => transformMember(member, true)) : [],
            parsedUsers: mentions.parsedUsers.size ? mentions.parsedUsers.map(user => transformUser(user, true)) : [],
            roles: mentions.roles.size ? mentions.roles.map(role => transformRole(role)) : [],
            users: mentions.users.size ? mentions.users.map(user => transformUser(user, true)) : [],
        };
    }
};

const transformMessageSnapshot = (messageSnapshot) => {
    if (messageSnapshot) {
        return {
            id: messageSnapshot.id,
            channelId: messageSnapshot.channelId,
            author: transformUser(messageSnapshot.author, true),
            content: messageSnapshot.content,
            createdAt: messageSnapshot.createdAt,
            editedAt: messageSnapshot.editedAt,
            flags: messageSnapshot.flags,
            mentions: transformMessageMentions(messageSnapshot.mentions)
        };
    }
};

const transformActivity = (activity) => {
    if (activity) {
        return {
            name: activity.name,
            state: activity.state,
            type: activity.type,
            url: activity.url
        };
    }
};

const transformPresence = (presence) => {
    if (presence) {
        return {
            activities: presence.activities.map(activity => transformActivity(activity)),
            clientStatus: presence.clientStatus,
            guild: transformGuild(presence.guild, true),
            member: transformMember(presence.member, true),
            status: presence.status,
            user: transformUser(presence.user, true),
            userId: presence.userId,
        };
    }
};

const transformVoice = (voice) => {
    if (voice) {
        return {
            channel: transformTextChannel(voice.channel, true),
            channelId: voice.channelId,
            deaf: voice.deaf,
            guild: transformGuild(voice.guild, true),
            mute: voice.mute,
            requestToSpeakTimestamp: voice.requestToSpeakTimestamp,
            selfDeaf: voice.selfDeaf,
            selfMute: voice.selfMute,
            selfVideo: voice.selfVideo,
            serverDeaf: voice.serverDeaf,
            serverMute: voice.serverMute,
            sessionId: voice.sessionId,
            streaming: voice.streaming,
            suppress: voice.suppress,
        };
    }
};

const transformMember = (member, concise = false) => {
    if (member) {
        if (concise) {
            return {
                id: member.id,
                displayName: member.displayName,
                nickname: member.nickname,
                joinedAt: member.joinedAt,
                joinedTimestamp: member.joinedTimestamp,
            };
        }
        return {
            avatar: member.avatar,
            avatarDecorationData: member.avatarDecorationData,
            bannable: member.bannable,
            banner: member.banner,
            communicationDisabledUntil: member.communicationDisabledUntil,
            communicationDisabledUntilTimestamp: member.communicationDisabledUntilTimestamp,
            displayColor: member.displayColor,
            displayHexColor: member.displayHexColor,
            displayName: member.displayName,
            flags: member.flags,
            guild: transformGuild(member.guild, true),
            id: member.id,
            joinedAt: member.joinedAt,
            joinedTimestamp: member.joinedTimestamp,
            kickable: member.kickable,
            manageable: member.manageable,
            moderatable: member.moderatable,
            nickname: member.nickname,
            partial: member.partial,
            pending: member.pending,
            permissions: member.permissions.toArray(),
            premiumSince: member.premiumSince,
            premiumSinceTimestamp: member.premiumSinceTimestamp,
            presence: transformPresence(member.presence),
            roles: member.roles.cache.map(role => transformRole(role)),
            user: transformUser(member.user, true),
            voice: transformVoice(member.voice),
        };
    }
};

const transformEmoji = (emoji, concise = false) => {
    if (emoji) {
        return {
            animated: emoji.animated,
            createdAt: emoji.createdAt,
            createdTimestamp: emoji.createdTimestamp,
            id: emoji.id,
            identifier: emoji.identifier,
            name: emoji.name,
            // reaction: emoji.reaction // circular reference
            imageUrl: emoji.imageUrl ? emoji.imageUrl() : null,
        };
    }
};

const transformReaction = (reaction) => {
    if (reaction) {
        return {
            // burstColors: reaction.burstColors,
            // clientId: reaction.clientId,
            count: reaction.count,
            countDetails: {
                burst: reaction.countDetails.burst,
                normal: reaction.countDetails.normal
            },
            emoji: transformEmoji(reaction.emoji, true),
            // me: reaction.me,
            // meBurst: reaction.meBurst,
            // message: reaction.message // circular reference
            // partial: reaction.partial,
            users: reaction.users.cache.map(user => transformUser(user, true)),
        };
    }
};

const transformSticker = (sticker) => ({
    available: sticker.available,
    createdAt: sticker.createdAt,
    // client: sticker.client,
    createdTimestamp: sticker.createdTimestamp,
    description: sticker.description,
    format: sticker.format,
    guild: transformGuild(sticker.guild, true),
    guildId: sticker.guildId,
    id: sticker.id,
    name: sticker.name,
    packId: sticker.packId,
    partial: sticker.partial,
    sortValue: sticker.sortValue,
    tags: sticker.tags,
    type: sticker.type,
    url: sticker.url,
    user: transformUser(sticker.user, true),
});

const transformMessageRoot = (message) => {
    return {
        // MessageActivity | null
        activity: message.activity,
        // Snowflake | null
        applicationId: message.applicationId,
        attachments: message.attachments.map(attachment => transformAttachment(attachment)),
        author: transformUser(message.author),
        // boolean
        bulkDeletable: message.bulkDeletable,
        // MessageCall | null
        call: message.call,
        channel: transformTextChannel(message.channel, true),
        // Snowflake
        channelId: message.channelId,
        // string
        cleanContent: message.cleanContent,
        // TopLevelComponent[]
        components: message.components,
        // string
        content: message.content,
        // Date
        createdAt: message.createdAt,
        // number
        createdTimestamp: message.createdTimestamp,
        // boolean
        crosspostable: message.crosspostable,
        // boolean
        deletable: message.deletable,
        // boolean
        editable: message.editable,
        // Date | null
        editedAt: message.editedAt,
        // number | null
        editedTimestamp: message.editedTimestamp,
        embeds: transformEmbeds(message.embeds),
        // Readonly<MessageFlagsBitField>
        flags: message.flags,
        // ClientApplication | null
        // groupActivityApplication: message.groupActivityApplication, // circular reference
        guild: transformGuild(message.guild, true),
        // If<InGuild, Snowflake>
        guildId: message.guildId,
        // boolean
        hasThread: message.hasThread,
        // Snowflake
        id: message.id,
        // ! MISSING FROM DOCUMENTATION
        interaction: message.interaction,
        // MessageInteractionMetadata | null
        interactionMetadata: message.interactionMetadata,
        member: transformMember(message.member, true),
        mentions: transformMessageMentions(message.mentions),
        // Collection<Snowflake, MessageSnapshot>
        messageSnapshots: message.messageSnapshots?.map(snapshot => transformMessageSnapshot(snapshot)),
        // number | string | null
        nonce: message.nonce,
        // false
        partial: message.partial,
        // boolean
        pinnable: message.pinnable,
        // boolean
        pinned: message.pinned,
        // Poll | null
        poll: transformPoll(message.poll),
        // number | null
        position: message.position,
        // ReactionManager
        reactions: message.reactions.cache.map(reaction => transformReaction(reaction)),
        // MessageReference | null
        reference: message.reference,
        // CommandInteractionResolvedData | null
        // resolved: message.resolved, // circular reference
        roleSubscriptionData: message.roleSubscriptionData ? {
            id: message.roleSubscriptionData.id,
        } : null,
        stickers: message.stickers?.map(sticker => transformSticker(sticker)),
        system: message.system,
        // thread: message.thread, // circular reference
        tts: message.tts,
        type: message.type,
        url: message.url,
        webhookId: message.webhookId,
    };
};

const DiscordUtilityService = {
    // This function fetches and saves all messages from a server to MongoDB.
    // If the message already exists in the database, it will be skipped.
    // It does bulk operations to save messages to MongoDB.
    // It also supports resuming from a checkpoint.
    async fetchAndSaveAllServerMessages(client, mongo, guildId, options = {}) {
        const {
            collectionName = 'Messages',
            concurrencyLimit = 10,
            resumePoints = null, // Array of { channelId, lastMessageId }
            batchSize = 100, // Number of messages to process in each bulk operation
            dateLimit = '2025-11-01' // e.g., '2020-06-15' or new Date(2020, 5, 15) - stops fetching when messages are older than this date
        } = options;

        console.log(`[START] Beginning message fetch for guild: ${guildId}`);

        // Get the guild
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.error(`[ERROR] Guild with ID ${guildId} not found`);
            return;
        }

        console.log(`[GUILD] Found guild: ${guild.name}`);

        // Create a map of channel IDs to their last message IDs for quick lookup
        const resumeMap = new Map();
        if (resumePoints && Array.isArray(resumePoints)) {
            resumePoints.forEach(point => {
                if (point.channelId && point.lastMessageId) {
                    resumeMap.set(point.channelId, point.lastMessageId);
                }
            });
            console.log(`[RESUME] Resuming from ${resumeMap.size} channel checkpoint(s)`);
        }

        // Get all text channels
        let textChannels = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildText
        );

        // If resumePoints provided, optionally filter to only those channels
        if (resumeMap.size > 0) {
            textChannels = textChannels.filter(channel => resumeMap.has(channel.id));
            console.log(`[CHANNELS] Will resume ${resumeMap.size} channel(s) from their last position`);
        }

        console.log(`[CHANNELS] Found ${textChannels.size} text channels to process`);

        // Statistics tracking
        let totalMessagesSaved = 0;
        let totalDuplicates = 0;
        let totalErrors = 0;
        let channelsProcessed = 0;

        // Get the collection reference
        const db = mongo.db("lupos");
        const collection = db.collection(collectionName);

        // Helper function to bulk save messages that don't exist
        const bulkSaveNewMessages = async (messages) => {
            if (!messages || messages.length === 0) {
                return { saved: 0, duplicates: 0, errors: 0 };
            }

            const messageIds = messages.map(m => m.id);

            try {
                // First, check which messages already exist
                const existingDocs = await collection
                    .find(
                        { id: { $in: messageIds } },
                        { projection: { id: 1, _id: 0 } }
                    )
                    .toArray();

                const existingIds = new Set(existingDocs.map(doc => doc.id));

                // Filter out messages that already exist
                const newMessages = messages.filter(m => !existingIds.has(m.id));
                const duplicateCount = messages.length - newMessages.length;

                if (newMessages.length === 0) {
                    return { saved: 0, duplicates: duplicateCount, errors: 0 };
                }

                // Transform messages to documents
                const documents = [];
                const transformErrors = [];

                for (const message of newMessages) {
                    try {
                        const doc = transformMessageRoot(message);
                        documents.push(doc);
                    } catch (transformError) {
                        console.error(`  [ERROR] Failed to transform message ${message.id}: ${transformError.message}`);
                        transformErrors.push(message.id);
                    }
                }

                if (documents.length === 0) {
                    return { saved: 0, duplicates: duplicateCount, errors: transformErrors.length };
                }

                // Use bulkWrite with upsert for safety against race conditions
                const bulkOps = documents.map(doc => ({
                    updateOne: {
                        filter: { id: doc.id },
                        update: { $setOnInsert: doc },
                        upsert: true
                    }
                }));

                const result = await collection.bulkWrite(bulkOps, { ordered: false });

                return {
                    saved: result.upsertedCount,
                    duplicates: duplicateCount + (result.matchedCount || 0),
                    errors: transformErrors.length
                };

            } catch (error) {
                // Handle bulk write errors
                if (error.writeErrors) {
                    const savedCount = error.result?.nUpserted || 0;
                    const errorCount = error.writeErrors.length;
                    console.error(`  [ERROR] Bulk write partial failure: ${savedCount} saved, ${errorCount} errors`);
                    return { saved: savedCount, duplicates: 0, errors: errorCount };
                }

                console.error(`  [ERROR] Bulk save failed: ${error.message}`);
                return { saved: 0, duplicates: 0, errors: messages.length };
            }
        };

        // Create a simple concurrency limiter
        const createConcurrencyLimiter = (limit) => {
            let activeCount = 0;
            const queue = [];

            const run = async (fn) => {
                while (activeCount >= limit) {
                    await new Promise(resolve => queue.push(resolve));
                }

                activeCount++;
                try {
                    return await fn();
                } finally {
                    activeCount--;
                    const resolve = queue.shift();
                    if (resolve) resolve();
                }
            };

            return { run };
        };

        const limiter = createConcurrencyLimiter(concurrencyLimit);

        // Process a single channel
        const processChannel = async (channel) => {
            const channelStartTime = Date.now();
            let channelMessageCount = 0;
            let channelDuplicates = 0;
            let channelErrors = 0;

            // Check if we should resume from a specific message
            let lastId = resumeMap.get(channel.id) || null;

            if (lastId) {
                console.log(`[CHANNEL] Resuming: #${channel.name} (${channel.id}) from message ${lastId}`);
            } else {
                console.log(`[CHANNEL] Processing: #${channel.name} (${channel.id})`);
            }

            let hasMoreMessages = true;
            let lastMessageDate = null;

            while (hasMoreMessages) {
                try {
                    // Fetch messages using the existing fetchMessages function
                    const messages = await DiscordUtilityService.fetchMessages(
                        client,
                        channel.id,
                        {
                            limit: batchSize,
                            before: lastId,
                            cache: false // Don't cache to save memory
                        }
                    );

                    if (!messages || messages.size === 0) {
                        hasMoreMessages = false;
                        break;
                    }

                    // Convert to array for bulk processing
                    const messageBatch = Array.from(messages.values());

                    // Bulk save the messages
                    const result = await bulkSaveNewMessages(messageBatch);

                    channelMessageCount += result.saved;
                    channelDuplicates += result.duplicates;
                    channelErrors += result.errors;
                    totalMessagesSaved += result.saved;
                    totalDuplicates += result.duplicates;
                    totalErrors += result.errors;

                    // Update lastId for pagination
                    const lastMessage = messages.last();
                    if (lastMessage) {
                        lastId = lastMessage.id;
                        lastMessageDate = lastMessage.createdAt;
                    }

                    // Check if we've reached the date limit
                    if (dateLimit && lastMessageDate) {
                        const limitDate = new Date(dateLimit);
                        if (lastMessageDate < limitDate) {
                            console.log(`  [DATE LIMIT] #${channel.name}: Reached date limit (${limitDate.toISOString().split('T')[0]}), stopping | Last message: ${lastMessageDate.toISOString()}`);
                            hasMoreMessages = false;
                        }
                    }

                    // Log progress
                    if (result.saved > 0) {
                        console.log(`  [PROGRESS] #${channel.name}: +${result.saved} saved (${result.duplicates} skipped) | Date: ${lastMessageDate}`);
                    } else if (result.duplicates > 0) {
                        console.log(`  [SKIP] #${channel.name}: ${result.duplicates} messages already exist | Date: ${lastMessageDate}`);
                    }

                    // If we got less than batchSize messages, we've reached the end
                    if (messages.size < batchSize) {
                        hasMoreMessages = false;
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (fetchError) {
                    console.error(`  [ERROR] Failed to fetch messages from #${channel.name}: ${fetchError.message}`);
                    channelErrors++;
                    totalErrors++;
                    hasMoreMessages = false; // Stop trying this channel
                }
            }

            channelsProcessed++;
            const duration = ((Date.now() - channelStartTime) / 1000).toFixed(2);
            console.log(`  [COMPLETE] #${channel.name}: ${channelMessageCount} saved, ${channelDuplicates} duplicates, ${channelErrors} errors (${duration}s)`);

            return { saved: channelMessageCount, duplicates: channelDuplicates, errors: channelErrors };
        };

        // Process all channels with concurrency limit
        const channelPromises = [];

        for (const channel of textChannels.values()) {
            const promise = limiter.run(() => processChannel(channel));
            channelPromises.push(promise);
        }

        // Wait for all channels to complete
        await Promise.all(channelPromises);

        const totalDuration = ((Date.now() - Date.now()) / 1000).toFixed(2);

        console.log(`\n[FINISHED] Message fetch complete for guild: ${guild.name}`);
        console.log(`  - Channels processed: ${channelsProcessed}`);
        console.log(`  - Messages saved: ${totalMessagesSaved}`);
        console.log(`  - Duplicates skipped: ${totalDuplicates}`);
        console.log(`  - Errors: ${totalErrors}`);

        return {
            guildId,
            guildName: guild.name,
            channelsProcessed,
            totalMessagesSaved,
            totalDuplicates,
            totalErrors,
        };
    },
    async deleteDuplicateMessagesByID(mongo, collectionName = "Messages") {
        const db = mongo.db("lupos");
        const collection = db.collection(collectionName);

        console.log('[START] Finding and deleting duplicate messages...');

        // Find all duplicate IDs using aggregation
        const duplicates = await collection.aggregate([
            {
                $group: {
                    _id: "$id",
                    count: { $sum: 1 },
                    docs: { $push: "$_id" }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]).toArray();

        console.log(`[INFO] Found ${duplicates.length} message IDs with duplicates`);

        let totalDeleted = 0;

        for (const duplicate of duplicates) {
            // Keep the first document, delete the rest
            const docsToDelete = duplicate.docs.slice(1);

            if (docsToDelete.length > 0) {
                const result = await collection.deleteMany({
                    _id: { $in: docsToDelete }
                });
                totalDeleted += result.deletedCount;
                console.log(`[DELETE] Deleted ${result.deletedCount} duplicate(s) for message ID: ${duplicate._id}`);
            }
        }

        console.log(`[COMPLETE] Total duplicates deleted: ${totalDeleted}`);

        return {
            duplicateIdsFound: duplicates.length,
            totalDeleted: totalDeleted
        };
    },
    getUsernameNoSpaces(message) {
        let name = message?.author?.displayName || message?.author?.username || message?.user?.username;
        let username = 'default';
        if (name) {
            username = name ? name.replace(/\s+/g, '_').replace(/[^\w\s]/gi, '') : message?.author?.username || message?.user?.username;
            if (!username) {
                username = message?.author?.username || message?.user?.username || 'default';
            }
        }
        return username;
    },
    // async saveMessageToMongo(message, mongo, collectionName='msgs') {
    //     const db = mongo.db("lupos");
    //     const collection = db.collection(collectionName);
    //     const messageObject = transformMessageRoot(message);
    //     await collection.insertOne(messageObject);
    // },
    async saveMessageToMongo(message, mongo, collectionName = "Messages") {
        const db = mongo.db("lupos");
        const collection = db.collection(collectionName);
        const messageObject = transformMessageRoot(message);

        await collection.updateOne(
            { id: messageObject.id },
            { $setOnInsert: messageObject },
            { upsert: true }
        );
    },
    async updateMessageInMongo(message, mongo, collectionName = "Messages") {
        const db = mongo.db("lupos");
        const collection = db.collection(collectionName);
        const messageObject = transformMessageRoot(message);

        await collection.updateOne(
            { id: messageObject.id },
            { $set: messageObject },
            { upsert: false }
        );
    },
    // UNUSED FUNCTION
    // async extractAllAttachmentTypesFromMessage(message) {
    //     const audioCollection = new Collection();
    //     const imageCollection = new Collection();
    //     const videoCollection = new Collection();
    //     const applicationCollection = new Collection();
    //     const textCollection = new Collection();
    //     const fontCollection = new Collection();
    //     const otherCollection = new Collection();
    //     if (message?.attachments?.size) {
    //         for (const attachment of message.attachments.values()) {
    //             const isAudio = attachment.contentType.includes('audio/');
    //             const isImage = attachment.contentType.includes('image/');
    //             const isVideo = attachment.contentType.includes('video/');
    //             const isApplication = attachment.contentType.includes('application/');
    //             const isText = attachment.contentType.includes('text/');
    //             const isFont = attachment.contentType.includes('font/');
    //             const isOther = !isAudio && !isImage && !isVideo && !isApplication && !isText && !isFont;
    //             if (isAudio) {
    //                 audioCollection.set(attachment.id, attachment);
    //             } else if (isImage) {
    //                 imageCollection.set(attachment.id, attachment);
    //             } else if (isVideo) {
    //                 videoCollection.set(attachment.id, attachment);
    //             } else if (isApplication) {
    //                 applicationCollection.set(attachment.id, attachment);
    //             } else if (isText) {
    //                 textCollection.set(attachment.id, attachment);
    //             } else if (isFont) {
    //                 fontCollection.set(attachment.id, attachment);
    //             } else if (isOther) {
    //                 otherCollection.set(attachment.id, attachment);
    //             }
    //         }
    //     }
    //     return {
    //         audioCollection,
    //         imageCollection,
    //         videoCollection,
    //         applicationCollection,
    //         textCollection,
    //         fontCollection,
    //         otherCollection,
    //     };
    // },
    async extractAudioUrlsFromMessage(message) {
        let audioUrls = [];
        if (message?.attachments?.size) {
            for (const attachment of message.attachments.values()) {
                const isAudio = attachment.contentType.includes('audio/ogg');
                if (isAudio) {
                    audioUrls.push(attachment.url);
                }
            }
        }
        return audioUrls;
    },
    async extractImageUrlsFromMessage(message) {
        let imageUrls = [];
        // Attachments
        if (message?.attachments?.size) {
            for (const attachment of message.attachments.values()) {
                const isImage = attachment.contentType.includes('image/');
                if (isImage) {
                    imageUrls.push(attachment.url);
                }
            }
        }
        // Content
        if (message?.content) {
            // Process URLs in message content
            const urls = message.content.match(/(https?:\/\/[^\s]+)/g);
            if (urls?.length) {
                for (const url of urls) {
                    if (!url.includes('https://tenor.com/view/')) {
                        const isImage = await UtilityLibrary.isImageUrl(url);
                        if (isImage) {
                            imageUrls.push(url);
                        }
                    } else {
                        const tenorImage = await PuppeteerWrapper.scrapeTenor(url);
                        imageUrls.push(tenorImage.image);
                    }
                }
            }
        }

        return imageUrls;
    },
    async retrieveMessageReferenceFromMessage(message) {
        let messageReference;
        if (message?.reference && message.reference.messageId) {
            messageReference = message.channel.messages.cache.get(message.reference.messageId);
            if (!messageReference) {
                try {
                    messageReference = await message.channel.messages.fetch(message.reference.messageId);
                } catch (error) {
                    console.error('Error fetching message reference:', error);
                }
            }
        }
        return messageReference;
    },
    getDisplayNameFromUserOrMember({ user, member }) {
        let displayName;
        if (user || member) {
            displayName = user?.displayName || member?.displayName;
        }
        return displayName;
    },
    getUsernameFromUser(user) {
        let username;
        if (user?.username) {
            username = user.username;
        }
        return username;
    },
    getCleanUsernameFromUser(user) {
        // Removes periods and hashes with underscores and removes any non-alphanumeric characters
        let username = DiscordUtilityService.getUsernameFromUser(user);
        if (username) {
            username = username.replace(/[.#]/g, '_').replace(/[^\w]/gi, '');
        }
        return username;
    },
    async getDisplayName(message, userId) {
        let displayName;
        if (message && message.guild && userId) {
            const member = await DiscordUtilityService.retrieveMemberFromGuildById(message.guild, userId);
            if (member) {
                displayName = member.displayName;
            } else {
                const user = await DiscordUtilityService.retrieveUserFromClientAndUserId(message.client, userId);
                if (user) {
                    displayName = user.displayName;
                }
            }
        }
        return displayName;
    },
    getNameFromUser(user) {
        if (user) {
            const username = user?.displayName || user?.username || user?.globalName;
            return username;
        }
    },
    getUserMentionFromMessage(message) {
        if (message) {
            // Find out why author and why user are different
            const userId = message?.author?.id || message?.user?.id;
            return `<@${userId}>`;
        }
    },
    getDiscordTagFromMessage(message) {
        if (message) {
            const userTag = message?.author?.tag || message?.user?.tag;
            return userTag;
        }
    },
    async printOutAllRoles(client) {
        // print out all roles in the order that they are in the server
        consoleLog('<');
        const roles = client.guilds.cache.get(config.GUILD_ID_PRIMARY).roles.cache;
        const orderedRoles = roles.sort((a, b) => a.rawPosition - b.rawPosition).reverse();
        consoleLog('=', `Printing out all roles in the order that they are in the server`);
        for (const role of orderedRoles.values()) {
            console.log(`${role.name} - ${role.id}`);
        }
        consoleLog('>', 'printOutAllRoles');
    },
    async printOutAllEmojis(client) {
        consoleLog('<');
        const emojis = client.guilds.cache.get(config.GUILD_ID_PRIMARY).emojis.cache;
        consoleLog('=', `Printing out all emojis in the server`);
        for (const emoji of emojis.values()) {
            console.log(`${emoji.name} - ${emoji.id}`);
        }
        consoleLog('>', 'printOutAllEmojis');
    },
    async retrieveMemberFromGuildById(guild, userId) {
        if (guild && userId) {
            let member = guild.members.cache.get(userId);
            if (!member) {
                try {
                    member = await guild.members.fetch(userId);
                } catch (error) {
                    // console.warn(...LogFormatter.memberNotFound('getMemberFromMessageAndId', userId, message.guild));
                    return null;
                }
            }
            return member;
        }
    },
    async retrieveUserFromClientAndUserId(client, userId) {
        let user = client.users.cache.get(userId);
        if (!user) {
            try {
                user = await client.users.fetch(userId);
            } catch (error) {
                // console.warn(...LogFormatter.userNotFound('getMemberFromMessageAndId', userId));
                return null;
            }
        }
        return user;
    },
    getUserByClientAndId(client, userId) {
        return client.users.cache.get(userId);
    },
    async getUserFromMessage(message, force = false) {
        const client = message.client;
        const usersId = message.author.id;
        let user = client.users.cache.get(usersId);
        if (!user) {
            try {
                user = await client.users.fetch(usersId, { force: force });
            } catch (error) {
                consoleLog('!', `Could not fetch user with ID ${usersId}. Error: ${error.message}`);
                return null;
            }
        }
        return user;
    },
    async getUserFromClientAndId(client, userId, force = false) {
        let user = client.users.cache.get(userId);
        if (!user) {
            try {
                user = await client.users.fetch(userId, { force: force });
            } catch (error) {
                consoleLog('!', `Could not fetch user with ID ${userId}. Error: ${error.message}`);
                return null;
            }
        }
        return user;
    },
    // Event Handlers
    onEventClientReady(client, { mongo, localMongo }, customFunction) {
        return client.on(Events.ClientReady, async () => { customFunction(client, { mongo, localMongo }) });
    },
    onEventMessageCreate(client, { mongo, localMongo }, customFunction) {
        return client.on(Events.MessageCreate, async message => { customFunction(client, { mongo, localMongo }, message) });
    },
    onEventMessageUpdate(client, { mongo, localMongo }, customFunction) {
        return client.on(Events.MessageUpdate, async (oldMessage, newMessage) => { customFunction(client, { mongo, localMongo }, oldMessage, newMessage) });
    },
    onEventMessageDelete(client, mongo, customFunction) {
        return client.on(Events.MessageDelete, async message => { customFunction(client, mongo, message) });
    },
    onEventMessageReactionAdd(client, mongo, customFunction) {
        return client.on(Events.MessageReactionAdd, async (reaction, user) => { customFunction(client, mongo, reaction, user) });
    },
    onEventGuildMemberAdd(client, mongo, customFunction) {
        return client.on(Events.GuildMemberAdd, async member => { customFunction(client, mongo, member) });
    },
    onEventGuildMemberAvailable(client, mongo, customFunction) {
        return client.on(Events.GuildMemberAvailable, async member => { customFunction(client, mongo, member) });
    },
    onEventInteractionCreate(client, mongo, customFunction) {
        return client.on(Events.InteractionCreate, async interaction => { customFunction(client, mongo, interaction) });
    },
    onEventPresenceUpdate(client, customFunction) {
        return client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
            customFunction(client, oldPresence, newPresence)
        });
    },
    onEventVoiceStateUpdate(client, mongo, customFunction) {
        return client.on(Events.VoiceStateUpdate, async (oldState, newState) => { customFunction(client, mongo, oldState, newState) });
    },
    onEventGuildMemberRemove(client, mongo, customFunction) {
        return client.on(Events.GuildMemberRemove, async member => { customFunction(client, mongo, member) });
    },
    onEventGuildMemberUpdate(client, mongo, customFunction) {
        return client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => { customFunction(client, mongo, oldMember, newMember) });
    },
    async getAllServerEmojisFromMessage(message, format = 'string') {
        // format can be: array, string
        if (message.guild.emojis.cache.size) {
            const emojis = message.guild.emojis.cache.map(emoji => {
                return {
                    id: emoji.id,
                    name: emoji.name,
                    url: emoji.url
                };
            });
            if (format === 'array') {
                return emojis;
            } else if (format === 'string') {
                return emojis.map(emoji => `<${emoji.name}:${emoji.id}>`).join(', ');
            }
        } else {
            return [];
        }
    },
    // Special functions
    async fetchMessages(client, channelId, options = {}) {
        const channel = client.channels.cache.find(channel => channel.id == channelId);

        if (!channel) return null;

        const {
            limit = 10,
            before = null,
            after = null,
            around = null,
            cache = true
        } = options;

        let allMessages = new Collection();

        // Metrics tracking
        let apiCallCount = 0;
        const startTime = Date.now();

        // If 'around' is specified, fetch once and return (Discord API behavior)
        if (around) {
            apiCallCount++;
            const messages = await channel.messages.fetch({
                limit: Math.min(100, limit),
                around,
                cache
            });
            return messages;
        }

        // Determine pagination direction and cursor
        const isAfterMode = after && !before;
        let cursor = before || after;

        // Initial fetch
        apiCallCount++;
        const initialFetchOptions = {
            limit: Math.min(100, limit),
            cache
        };

        if (before) initialFetchOptions.before = before;
        if (after) initialFetchOptions.after = after;

        let messages = await channel.messages.fetch(initialFetchOptions);
        allMessages = allMessages.concat(messages);

        // Continue fetching if we need more messages
        while (allMessages.size < limit && messages.size !== 0) {
            // Update cursor based on direction
            if (isAfterMode) {
                // When using 'after', get the newest message ID for next fetch
                cursor = messages.first()?.id;
            } else {
                // When using 'before' or default, get the oldest message ID
                cursor = messages.last()?.id;
            }

            if (!cursor) break;

            const additionalMessagesNeeded = limit - allMessages.size;
            apiCallCount++;

            const fetchOptions = {
                limit: Math.min(100, additionalMessagesNeeded),
                cache
            };

            // Set the appropriate cursor
            if (isAfterMode) {
                fetchOptions.after = cursor;
            } else {
                fetchOptions.before = cursor;
            }

            messages = await channel.messages.fetch(fetchOptions);

            // Avoid duplicates (Discord API might return overlapping messages)
            const uniqueMessages = messages.filter(msg => !allMessages.has(msg.id));
            allMessages = allMessages.concat(uniqueMessages);

            // Break if no new messages were added (to prevent infinite loops)
            if (uniqueMessages.size === 0) break;
        }

        // Log metrics (uncomment if needed)
        // const totalTime = Date.now() - startTime;
        // console.log(`API calls made: ${apiCallCount}`);
        // console.log(`Total time: ${totalTime}ms`);
        // console.log(`Average time per call: ${(totalTime / apiCallCount).toFixed(2)}ms`);
        // console.log(`Messages fetched: ${allMessages.size}`);

        // Trim collection if we fetched more than needed
        if (allMessages.size > limit) {
            const trimmedCollection = new Collection();
            let count = 0;

            // Maintain message order based on fetch direction
            const messageArray = Array.from(allMessages.values());
            if (isAfterMode) {
                // For 'after' mode, keep the oldest messages first
                messageArray.reverse();
            }

            for (const message of messageArray) {
                if (count >= limit) break;
                trimmedCollection.set(message.id, message);
                count++;
            }

            return trimmedCollection;
        }

        return allMessages;
    },
    async getOrFetchChannelByChannelId(client, channelId) {
        let channel = client.channels.cache.get(channelId);
        if (!channel) {
            try {
                channel = await client.channels.fetch(channelId);
            } catch (error) {
                consoleLog('!', `Could not fetch channel with ID ${channelId}. Error: ${error.message}`);
                return null;
            }
        }
        return channel;
    },
    // User functions
    getBotName(client) {
        return client.user.tag;
    },
    setUserActivity(client, message) {
        return client.user.setActivity(message, { type: ActivityType.Custom });
    },
    // Channel functions
    getChannelById(client, channelId) {
        return client.channels.cache.get(channelId);
    },
    getChannelName(client, channelId) {
        return client.channels.cache.get(channelId)?.name;
    },
    // Guilds functions
    getGuildById(client, guildId) {
        return client.guilds.cache.get(guildId);
    },
    getAllGuilds(client) {
        let guildsCollection;
        if (client) {
            guildsCollection = client.guilds.cache;
        }
        return guildsCollection;
    },
    getNameFromItem(item) {
        return item?.author?.displayName || item?.author?.username || item?.user?.globalName || item?.user?.username;
    },
    // REST functions
    async patchBanner(client, imageUrl) {
        return await client.rest.patch("/users/@me", { body: { banner: "data:image/gif;base64," + Buffer.from(imageUrl).toString('base64') } });
    },
    async patchBannerFromImageUrl(client, imageUrl) {
        return await client.rest.patch("/users/@me", { body: { banner: "data:image/gif;base64," + Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } });
    },
    async getBannerFromUserId(client, userId) {
        const getUser = await client.rest.get(`/users/${userId}`);
        return getUser.banner;
    },
    // Typing functions
    async startTypingInterval(channel) {
        let sendTypingInterval;
        const startTyping = async () => {
            await channel.sendTyping();
            sendTypingInterval = setInterval(() => {
                channel.sendTyping().catch(error => {
                    if (sendTypingInterval) {
                        clearInterval(sendTypingInterval);
                    }
                });
            }, 5000);
        };
        await startTyping();
        return sendTypingInterval;
    },
    clearTypingInterval(sendTypingInterval) {
        if (sendTypingInterval) clearInterval(sendTypingInterval);
        return null;
    },
    // Message functions
    async sendMessageInChunks(sendOrReply, message, generatedTextResponse, encodedImageDataBase64, imagePrompt) {
        const messageChunkSizeLimit = 2000;
        let fileName = 'lupos.png';
        let imageDescription = '';
        let returnedFirstMessage;

        if (imagePrompt) {
            fileName = `${imagePrompt.substring(0, 240)}.png`;
            imageDescription = imagePrompt.substring(0, 1000);
        }

        for (let i = 0; i < generatedTextResponse.length; i += messageChunkSizeLimit) {
            const chunk = generatedTextResponse.substring(i, i + messageChunkSizeLimit);
            let messageReplyOptions = { content: chunk };
            let files = [];

            // if (generatedAudioFile && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
            //     files.push({ attachment: await fs.promises.readFile(`${BARK_VOICE_FOLDER}/${generatedAudioFile}`), name: `${generatedAudioFile}` });
            // }
            // if (generatedAudioBuffer && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
            //     files.push({ attachment: Buffer.from(generatedAudioBuffer, 'base64'), name: 'lupos.mp3' });
            // }
            if (encodedImageDataBase64 && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
                files.push({ attachment: Buffer.from(encodedImageDataBase64, 'base64'), name: fileName, description: imageDescription });
            }
            messageReplyOptions = { ...messageReplyOptions, files: files };
            if (sendOrReply === 'send') {
                const sentMessage = await message.channel.send(messageReplyOptions);
                if (!returnedFirstMessage) {
                    returnedFirstMessage = sentMessage;
                }
            } else if (sendOrReply === 'reply') {
                const repliedMessage = await message.reply(messageReplyOptions);
                if (!returnedFirstMessage) {
                    returnedFirstMessage = repliedMessage;
                }
            }
        }
        return returnedFirstMessage;
    },
    // Utility functions
    async displayAllChannelActivity(client) {
        const MONTHS_TO_ANALYZE = 36;
        const CONCURRENT_CHANNELS = 10; // Number of channels to process simultaneously
        const periodText = MONTHS_TO_ANALYZE === 1 ? '1 month' : `${MONTHS_TO_ANALYZE} months`;

        const startTime = Date.now();
        consoleLog('>', `Displaying all channel activity (past ${periodText})`);
        console.log('[START] Beginning channel activity analysis...');
        console.log(`[START] Started at: ${new Date(startTime).toISOString()}`);
        console.log(`[CONFIG] Processing ${CONCURRENT_CHANNELS} channels concurrently`);

        const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);
        console.log(`[GUILD] Found guild: ${guild.name} with ${guild.channels.cache.size} total channels`);

        const excludedCategories = [
            // 'Archived',
            // 'Archived02',
            // 'Archived: First Purge',
            // 'Archived: SOD',
            // 'Archived: Alliance',
            // 'Archived: WoW Classes',
            '⚒ Administration',
            'Info',
            'Welcome',
            'commands',
        ];

        const excludedChannels = [
            '609498307626008576',
            '762734438375096380', // politics
            '844637988159356968' // sportsmane
        ];

        console.log(`[FILTER] Excluding categories: ${excludedCategories.join(', ')}`);
        console.log(`[FILTER] Excluding ${excludedChannels.length} specific channels`);

        const channelStats = [];
        const globalUserStats = {};
        const now = DateTime.local();
        const cutoffDate = now.minus({ months: MONTHS_TO_ANALYZE });
        console.log(`[TIME] Current time: ${now.toISO()}`);
        console.log(`[TIME] Cutoff date (${periodText} ago): ${cutoffDate.toISO()}`);

        let processedChannelCount = 0;
        let totalFetchCount = 0;

        // Collect all eligible channels first
        const eligibleChannels = [];
        for (const channel of guild.channels.cache.values()) {
            if (channel.type === ChannelType.GuildText &&
                channel.parent &&
                !excludedCategories.includes(channel.parent.name) &&
                !excludedChannels.includes(channel.id)) {
                eligibleChannels.push(channel);
            }
        }

        const eligibleChannelCount = eligibleChannels.length;
        console.log(`[CHANNELS] Found ${eligibleChannelCount} eligible text channels to process`);
        console.log('----------------------------------------');

        // Function to process a single channel
        const processChannel = async (channel, channelIndex) => {
            const logPrefix = `[CH ${channelIndex}/${eligibleChannelCount}]`;
            console.log(`\n${logPrefix} Processing: #${channel.name} (Category: ${channel.parent.name})`);

            try {
                let allMessages = [];
                let lastMessageId = null;
                let fetchMore = true;
                let fetchCount = 0;
                let channelFetchCount = 0;
                let consecutiveDuplicates = 0;
                let previousOldestId = null;

                console.log(`  ${logPrefix} [FETCH] Starting message fetch for #${channel.name}...`);

                while (fetchMore) {
                    fetchCount++;
                    channelFetchCount++;
                    totalFetchCount++;

                    console.log(`  ${logPrefix} [FETCH] Fetching batch ${fetchCount}...`);

                    const messages = await fetchMessagesWithOptionalLastId(
                        client,
                        channel.id,
                        100,
                        lastMessageId ? lastMessageId : undefined
                    );

                    const messagesArray = Array.from(messages.values());

                    if (messagesArray.length === 0) {
                        console.log(`  ${logPrefix} [FETCH] No messages found, stopping fetch`);
                        fetchMore = false;
                        break;
                    }

                    const oldestMessage = messagesArray[messagesArray.length - 1];
                    const oldestMessageDateTime = DateTime.fromMillis(oldestMessage.createdTimestamp);
                    const newestMessage = messagesArray[0];
                    const newestMessageDateTime = DateTime.fromMillis(newestMessage.createdTimestamp);

                    if (previousOldestId === oldestMessage.id) {
                        consecutiveDuplicates++;
                        console.log(`  ${logPrefix} [FETCH] WARNING: Got same oldest message ID as previous batch (duplicate #${consecutiveDuplicates})`);
                        if (consecutiveDuplicates >= 3) {
                            console.log(`  ${logPrefix} [FETCH] ERROR: Too many duplicate batches, stopping to prevent infinite loop`);
                            fetchMore = false;
                            break;
                        }
                    } else {
                        consecutiveDuplicates = 0;
                        previousOldestId = oldestMessage.id;
                    }

                    const newMessages = messagesArray.filter(msg =>
                        !allMessages.some(existingMsg => existingMsg.id === msg.id)
                    );

                    if (newMessages.length === 0) {
                        console.log(`  ${logPrefix} [FETCH] All messages in this batch are duplicates, stopping`);
                        fetchMore = false;
                        break;
                    }

                    allMessages = allMessages.concat(newMessages);

                    console.log(`  ${logPrefix} [FETCH] Batch ${fetchCount}: ${messagesArray.length} messages (${newMessages.length} new)`);
                    console.log(`  ${logPrefix} [FETCH] Date range: ${newestMessageDateTime.toFormat('yyyy-MM-dd HH:mm:ss')} to ${oldestMessageDateTime.toFormat('yyyy-MM-dd HH:mm:ss')}`);
                    console.log(`  ${logPrefix} [FETCH] Oldest message ID: ${oldestMessage.id}`);

                    if (oldestMessageDateTime < cutoffDate) {
                        console.log(`  ${logPrefix} [FETCH] Reached messages older than ${periodText} (${oldestMessageDateTime.toFormat('yyyy-MM-dd')} < ${cutoffDate.toFormat('yyyy-MM-dd')})`);
                        fetchMore = false;
                        break;
                    }

                    if (messagesArray.length < 100) {
                        console.log(`  ${logPrefix} [FETCH] Retrieved only ${messagesArray.length} messages, channel history exhausted`);
                        fetchMore = false;
                        break;
                    }

                    lastMessageId = oldestMessage.id;

                    console.log(`  ${logPrefix} [FETCH] Total unique messages collected: ${allMessages.length}`);
                    console.log(`  ${logPrefix} [FETCH] Next fetch will use before: ${lastMessageId}`);

                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                console.log(`  ${logPrefix} [FETCH] Total fetches for this channel: ${channelFetchCount}`);
                console.log(`  ${logPrefix} [PROCESS] Filtering messages from the last ${periodText}...`);

                const messagesInPeriod = allMessages.filter(
                    message => DateTime.fromMillis(message.createdTimestamp) > cutoffDate
                );
                console.log(`  ${logPrefix} [PROCESS] Found ${messagesInPeriod.length} messages in the last ${periodText} (out of ${allMessages.length} total fetched)`);

                const userMessageCount = {};
                const localUserStats = {}; // Collect locally first to avoid race conditions

                messagesInPeriod.forEach(message => {
                    const userId = message.author.id;
                    const username = message.author.username;
                    if (!userMessageCount[userId]) {
                        userMessageCount[userId] = {
                            username: username,
                            count: 0
                        };
                    }
                    userMessageCount[userId].count++;

                    if (!localUserStats[userId]) {
                        localUserStats[userId] = {
                            username: username,
                            totalMessages: 0,
                            channels: new Set()
                        };
                    }
                    localUserStats[userId].totalMessages++;
                    localUserStats[userId].channels.add(channel.name);
                });

                const uniqueUserCount = Object.keys(userMessageCount).length;
                console.log(`  ${logPrefix} [USERS] Found ${uniqueUserCount} unique users in the last ${periodText}`);

                const sortedUsers = Object.entries(userMessageCount)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 20)
                    .map(([userId, data]) => ({
                        username: data.username,
                        count: data.count
                    }));

                if (sortedUsers.length > 0) {
                    console.log(`  ${logPrefix} [TOP USERS] Top contributors:`);
                    sortedUsers.forEach((user, index) => {
                        console.log(`    ${index + 1}. ${user.username}: ${user.count} messages`);
                    });
                }

                let averageMessagesPerDay = 0;
                let lastMessageDate = null;

                if (messagesInPeriod.length > 0) {
                    const oldestRecentMessage = messagesInPeriod[messagesInPeriod.length - 1];
                    const newestMessage = messagesInPeriod[0];
                    const oldestDateTime = DateTime.fromMillis(oldestRecentMessage.createdTimestamp);
                    const newestDateTime = DateTime.fromMillis(newestMessage.createdTimestamp);
                    const daySpan = Math.max(1, newestDateTime.diff(oldestDateTime, 'days').days);

                    averageMessagesPerDay = messagesInPeriod.length / daySpan;
                    lastMessageDate = newestDateTime;

                    console.log(`  ${logPrefix} [METRICS] Message span: ${daySpan.toFixed(1)} days`);
                    console.log(`  ${logPrefix} [METRICS] Average messages/day: ${averageMessagesPerDay.toFixed(2)}`);
                    console.log(`  ${logPrefix} [METRICS] Last message: ${lastMessageDate.toFormat('yyyy-MM-dd HH:mm')}`);
                } else {
                    console.log(`  ${logPrefix} [METRICS] No messages in the last ${periodText}`);
                }

                processedChannelCount++;
                console.log(`  ${logPrefix} [COMPLETE] Successfully processed #${channel.name} (${processedChannelCount}/${eligibleChannelCount} done)`);

                return {
                    channelStat: {
                        channel: channel,
                        messageCount: messagesInPeriod.length,
                        uniqueUsers: uniqueUserCount,
                        topUsers: sortedUsers,
                        averageMessagesPerDay: averageMessagesPerDay,
                        lastMessageDate: lastMessageDate,
                        categoryName: channel.parent ? channel.parent.name : 'No Category'
                    },
                    localUserStats: localUserStats
                };

            } catch (error) {
                console.error(`  ${logPrefix} [ERROR] Failed to fetch messages for channel ${channel.name}:`, error.message);
                console.error(`  ${logPrefix} [ERROR] Stack trace:`, error.stack);
                processedChannelCount++;
                return null;
            }
        };

        // Process channels in batches with concurrency limit
        const results = [];
        for (let i = 0; i < eligibleChannels.length; i += CONCURRENT_CHANNELS) {
            const batch = eligibleChannels.slice(i, i + CONCURRENT_CHANNELS);
            const batchNumber = Math.floor(i / CONCURRENT_CHANNELS) + 1;
            const totalBatches = Math.ceil(eligibleChannels.length / CONCURRENT_CHANNELS);

            console.log(`\n========================================`);
            console.log(`[BATCH ${batchNumber}/${totalBatches}] Processing ${batch.length} channels concurrently...`);
            console.log(`========================================`);

            const batchPromises = batch.map((channel, batchIndex) =>
                processChannel(channel, i + batchIndex + 1)
            );

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            console.log(`\n[BATCH ${batchNumber}/${totalBatches}] Completed`);
        }

        // Merge results
        for (const result of results) {
            if (result) {
                channelStats.push(result.channelStat);

                // Merge local user stats into global
                for (const [userId, data] of Object.entries(result.localUserStats)) {
                    if (!globalUserStats[userId]) {
                        globalUserStats[userId] = {
                            username: data.username,
                            totalMessages: 0,
                            channels: new Set()
                        };
                    }
                    globalUserStats[userId].totalMessages += data.totalMessages;
                    for (const channelName of data.channels) {
                        globalUserStats[userId].channels.add(channelName);
                    }
                }
            }
        }

        console.log('\n----------------------------------------');
        console.log('[SORT] Sorting channels by average messages per day...');
        channelStats.sort((a, b) => b.averageMessagesPerDay - a.averageMessagesPerDay);
        console.log('[SORT] Sorting complete (by average messages/day)');

        console.log(`\n=== Channel Activity Report (Past ${periodText}) ===`);
        console.log('=== Sorted by Average Messages Per Day ===\n');
        console.log('Rank | Avg/Day | Messages | Users | Days Ago | Category            | Channel Name         | Top 3 Users');
        console.log('-----|---------|----------|-------|----------|---------------------|----------------------|-------------');

        channelStats.forEach((stat, index) => {
            const rank = (index + 1).toString().padStart(4, ' ');
            const avgPerDay = stat.averageMessagesPerDay.toFixed(2).padStart(7, ' ');
            const messageCount = stat.messageCount.toString().padStart(8, ' ');
            const uniqueUsers = stat.uniqueUsers.toString().padStart(5, ' ');

            let daysSinceLastMessage = 'N/A';
            if (stat.lastMessageDate) {
                const daysDiff = now.diff(stat.lastMessageDate, 'days').days;
                daysSinceLastMessage = daysDiff.toFixed(0).padStart(8, ' ');
            } else {
                daysSinceLastMessage = daysSinceLastMessage.padStart(8, ' ');
            }

            const category = stat.categoryName.substring(0, 20).padEnd(20, ' ');
            const channelName = stat.channel.name.substring(0, 20).padEnd(20, ' ');

            let topUsersStr = '';
            if (stat.topUsers.length > 0) {
                topUsersStr = stat.topUsers
                    .slice(0, 3)
                    .map((user, idx) => `${idx + 1}. ${user.username} (${user.count})`)
                    .join(', ');
            } else {
                topUsersStr = 'No activity';
            }

            console.log(`${rank} | ${avgPerDay} | ${messageCount} | ${uniqueUsers} | ${daysSinceLastMessage} | ${category} | ${channelName} | ${topUsersStr}`);
        });

        const totalMessages = channelStats.reduce((sum, stat) => sum + stat.messageCount, 0);
        const activeChannels = channelStats.filter(stat => stat.messageCount > 0).length;
        const inactiveChannels = channelStats.filter(stat => stat.messageCount === 0).length;
        const totalUniqueUsers = Object.keys(globalUserStats).length;

        const mostActiveByAverage = channelStats[0];

        const topTenUsers = Object.entries(globalUserStats)
            .sort((a, b) => b[1].totalMessages - a[1].totalMessages)
            .slice(0, 10)
            .map(([userId, data]) => ({
                username: data.username,
                totalMessages: data.totalMessages,
                channelCount: data.channels.size
            }));

        const endTime = Date.now();
        const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
        const totalTimeMinutes = (totalTimeSeconds / 60).toFixed(2);

        console.log('\n=== Summary ===');
        console.log(`[SUMMARY] Total messages (${periodText}): ${totalMessages}`);
        console.log(`[SUMMARY] Active channels: ${activeChannels}`);
        console.log(`[SUMMARY] Inactive channels: ${inactiveChannels}`);
        console.log(`[SUMMARY] Most active channel (by avg/day): ${mostActiveByAverage?.channel.name || 'N/A'} (${mostActiveByAverage?.averageMessagesPerDay.toFixed(2) || 0} messages/day)`);
        console.log(`[SUMMARY] Total channels processed: ${processedChannelCount}`);
        console.log(`[SUMMARY] Total API fetches made: ${totalFetchCount}`);
        console.log(`[SUMMARY] Average fetches per channel: ${(totalFetchCount / processedChannelCount).toFixed(2)}`);
        console.log(`[SUMMARY] Total unique users across all channels: ${totalUniqueUsers}`);
        console.log(`[SUMMARY] Concurrent channels setting: ${CONCURRENT_CHANNELS}`);
        console.log(`[SUMMARY] Total execution time: ${totalTimeSeconds} seconds (${totalTimeMinutes} minutes)`);
        console.log(`[SUMMARY] Completed at: ${new Date(endTime).toISOString()}`);

        console.log(`\n=== Top 10 Most Active Users (Past ${periodText}) ===`);
        console.log('Rank | Username                | Total Messages | Active Channels');
        console.log('-----|-------------------------|----------------|----------------');

        topTenUsers.forEach((user, index) => {
            const rank = (index + 1).toString().padStart(4, ' ');
            const username = user.username.substring(0, 23).padEnd(23, ' ');
            const totalMessages = user.totalMessages.toString().padStart(14, ' ');
            const channelCount = user.channelCount.toString().padStart(15, ' ');

            console.log(`${rank} | ${username} | ${totalMessages} | ${channelCount}`);
        });

        console.log('\n[END] Channel activity analysis complete!');
        consoleLog('>');
    },
    async calculateMessagesSentOnAveragePerDayInChannel(client, channelId) {
        console.log(`Calculating average messages sent in channel ${channelId} over the date range in the messages...`);
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.log(`Channel with ID ${channelId} not found or is not a text channel.`);
            return;
        }

        const now = Date.now();

        let messageCount = 0;
        let lastMessageDate = null;

        try {
            let recentMessages = (await DiscordUtilityService.fetchMessages(
                client,
                message.channel.id,
                { limit: 100 }
            )).reverse();
            for (const message of recentMessages.values()) {
                messageCount++;
                if (!lastMessageDate || message.createdTimestamp > lastMessageDate.getTime()) {
                    lastMessageDate = new Date(message.createdTimestamp);
                }
            }
        } catch (error) {
            console.log(`Error fetching messages from channel ${channel.name}: ${error.message}`);
            return;
        }

        const daysSinceStart = Math.max(1, Math.ceil((now - lastMessageDate.getTime()) / (24 * 60 * 60 * 1000)));
        const averageMessagesPerHour = (messageCount / (daysSinceStart * 24)).toFixed(2);

        console.log(`Channel: ${channel.name}`);
        console.log(`Messages sent in the last ${daysSinceStart} days: ${messageCount}`);
        console.log(`Average messages sent per hour: ${averageMessagesPerHour}`);
        if (lastMessageDate) {
            console.log(`Last message date: ${lastMessageDate.toISOString()}`);
        } else {
            console.log('No messages found in the specified period.');
        }
    },
    async addRoleToMember(member, roleId) {
        const guild = member.guild;
        const role = guild.roles.cache.find(role => role.id === roleId);

        try {
            if (!member.user.bot && !member.roles.cache.some(role => role.id === roleId)) {
                await member.roles.add(role);
                LightWrapper.cycleColor(config.PRIMARY_LIGHT_ID);
                console.log(...LogFormatter.roleAdded(member, role));
            }
        } catch (error) {
            console.error(...LogFormatter.roleFailedToAdd(userId, role, error.message));
        }
    },
    async removeRoleFromMember(member, roleId) {
        const guild = member.guild;
        const role = guild.roles.cache.find(role => role.id === roleId);

        try {
            if (!member.user.bot && member.roles.cache.some(role => role.id === roleId)) {
                await member.roles.remove(role);
                LightWrapper.cycleColor(config.PRIMARY_LIGHT_ID);
                console.log(...LogFormatter.roleRemoved(member, role));
            }
        } catch (error) {
            console.error(...LogFormatter.roleFailedToRemove(userId, role, error.message));
        }
    },
    async setUserStatus(client, status) {
        try {
            await client.user.setStatus(status);
            console.log(`Set bot status to ${status}`);
        } catch (error) {
            console.error(`Failed to set bot status to ${status}:`, error.message);
        }
    },
};

export default DiscordUtilityService;