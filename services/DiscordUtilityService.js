
import { DateTime } from "luxon";
import utilities from "#root/utilities.js";
const { consoleLog } = utilities;
import config from "#root/config.js";
import { Collection, ChannelType, Events, ActivityType } from "discord.js";
import { MS_PER_DAY, MONGO_DB_NAME } from "#root/constants.js";
import ScraperService from "#root/services/ScraperService.js";
import LightsService from "#root/services/LightsService.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import MediaArchivalService from "#root/services/MediaArchivalService.js";

async function fetchMessagesWithOptionalLastId(
  client,
  channelId,
  maxMessages = 10,
  lastId = null,
) {
  const channel = client.channels.cache.find(
    (channel) => channel.id == channelId,
  );

  if (channel) {
    let allMessages = new Collection();

    // Initial fetch
    let messages = await channel.messages.fetch({
      limit: Math.min(100, maxMessages),
      before: lastId,
    });
    allMessages = allMessages.concat(messages);

    // Continue fetching if we need more messages
    while (allMessages.size < maxMessages && messages.size !== 0) {
      lastId = messages.last()?.id;
      if (!lastId) break;

      const additionalMessagesNeeded = maxMessages - allMessages.size;
      messages = await channel.messages.fetch({
        limit: Math.min(100, additionalMessagesNeeded),
        before: lastId,
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
  tag: userPrimaryGuild?.tag,
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
      username: user.username,
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
  url: role.url,
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
      width: attachment.width,
    };
  }
};

const transformTextChannel = (channel, _concise = false) => {
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
  return embeds.map((embed) => ({
    author: transformUser(embed.author, true),
    color: embed.color,
    data: embed.data,
    description: embed.description,
    fields: embed.fields,
    footer: embed.footer,
    hexColor: embed.hexColor,
    image: embed.image,
    length: embed.length,
    provider: embed.provider,
    thumbnail: embed.thumbnail,
    timestamp: embed.timestamp,
    title: embed.title,
    url: embed.url,
    video: embed.video,
  }));
};

const transformGuild = (guild, _concise = false) => {
  if (guild) {
    return {
      id: guild.id,
      name: guild.name,
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
      answers: poll.answers.map((answer) => ({
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
      resultsFinalized: poll.resultsFinalized,
    };
  }
};

const transformMessageMentions = (mentions) => {
  if (mentions) {
    // MessageMentions<InGuild>
    return {
      channels: mentions.channels.size
        ? mentions.channels.map((channel) =>
            transformTextChannel(channel, true),
          )
        : [],
      // client: transformClient(mentions.client),
      // boolean
      everyone: mentions.everyone,
      guild: transformGuild(mentions.guild, true),
      members: mentions.members?.size
        ? mentions.members.map((member) => transformMember(member, true))
        : [],
      parsedUsers: mentions.parsedUsers.size
        ? mentions.parsedUsers.map((user) => transformUser(user, true))
        : [],
      roles: mentions.roles.size
        ? mentions.roles.map((role) => transformRole(role))
        : [],
      users: mentions.users.size
        ? mentions.users.map((user) => transformUser(user, true))
        : [],
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
      mentions: transformMessageMentions(messageSnapshot.mentions),
    };
  }
};

const transformActivity = (activity) => {
  if (activity) {
    return {
      name: activity.name,
      state: activity.state,
      type: activity.type,
      url: activity.url,
    };
  }
};

const transformPresence = (presence) => {
  if (presence) {
    return {
      activities: presence.activities.map((activity) =>
        transformActivity(activity),
      ),
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
        displayHexColor: member.displayHexColor,
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
      communicationDisabledUntilTimestamp:
        member.communicationDisabledUntilTimestamp,
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
      roles: member.roles.cache.map((role) => transformRole(role)),
      user: transformUser(member.user, true),
      voice: transformVoice(member.voice),
    };
  }
};

const transformEmoji = (emoji, _concise = false) => {
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
        normal: reaction.countDetails.normal,
      },
      emoji: transformEmoji(reaction.emoji, true),
      // me: reaction.me,
      // meBurst: reaction.meBurst,
      // message: reaction.message // circular reference
      // partial: reaction.partial,
      users: reaction.users.cache.map((user) => transformUser(user, true)),
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
    attachments: message.attachments.map((attachment) =>
      transformAttachment(attachment),
    ),
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
    messageSnapshots: message.messageSnapshots?.map((snapshot) =>
      transformMessageSnapshot(snapshot),
    ),
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
    reactions: message.reactions.cache.map((reaction) =>
      transformReaction(reaction),
    ),
    // MessageReference | null
    reference: message.reference,
    // CommandInteractionResolvedData | null
    // resolved: message.resolved, // circular reference
    roleSubscriptionData: message.roleSubscriptionData
      ? {
          id: message.roleSubscriptionData.id,
        }
      : null,
    stickers: message.stickers?.map((sticker) => transformSticker(sticker)),
    system: message.system,
    // thread: message.thread, // circular reference
    tts: message.tts,
    type: message.type,
    url: message.url,
    webhookId: message.webhookId,
  };
};

const DiscordUtilityService = {
  // Fetches and saves all messages from a Discord server to MongoDB.
  // Supports category filtering, date limits, auto-resume via checkpoints,
  // and concurrent channel processing with bulk upserts.
  async fetchAndSaveAllServerMessages(client, mongo, guildId, options = {}) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 10,
      resumePoints = null, // Array of { channelId, lastMessageId } — explicit overrides
      batchSize = 100, // Messages per Discord API call (max 100)
      dateLimit = "2025-11-01", // Stop when messages are older than this date
      categoryIds = null, // Array of category (parent) IDs to limit which channels are processed
      autoResume = true, // Persist per-channel checkpoints for crash recovery
    } = options;

    const startTime = Date.now();
    const limitDate = dateLimit ? new Date(dateLimit) : null;

    console.log(`[START] Beginning message fetch for guild: ${guildId}`);
    if (limitDate) {
      console.log(`[CONFIG] Date limit: ${limitDate.toISOString().split("T")[0]}`);
    }

    // Get the guild
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`[ERROR] Guild with ID ${guildId} not found`);
      return;
    }

    console.log(`[GUILD] Found guild: ${guild.name}`);

    // ── Database setup ──────────────────────────────────────────────
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const checkpointCollection = db.collection("MessageScrapeCheckpoints");

    // Ensure unique index on `id` — turns upsert lookups from O(n) → O(log n)
    // If duplicates exist from previous runs, clean them first then retry.
    try {
      await collection.createIndex({ id: 1 }, { unique: true, background: true });
      console.log(`[INDEX] Ensured unique index on "${collectionName}.id"`);
    } catch (indexError) {
      if (indexError.code === 11000) {
        console.log(`[INDEX] Duplicate keys found — deduplicating before indexing...`);
        await DiscordUtilityService.deleteDuplicateMessagesByID(mongo, collectionName);
        await collection.createIndex({ id: 1 }, { unique: true, background: true });
        console.log(`[INDEX] Unique index created after deduplication`);
      } else {
        throw indexError;
      }
    }

    // ── Resume logic ────────────────────────────────────────────────
    const resumeMap = new Map();
    const completedChannelIds = new Set();

    if (resumePoints && Array.isArray(resumePoints)) {
      // Explicit resume points take priority
      resumePoints.forEach((point) => {
        if (point.channelId && point.lastMessageId) {
          resumeMap.set(point.channelId, point.lastMessageId);
        }
      });
      console.log(
        `[RESUME] Using ${resumeMap.size} explicit checkpoint(s)`,
      );
    } else if (autoResume) {
      // Load checkpoints from previous runs
      const checkpoints = await checkpointCollection.find({ guildId }).toArray();
      for (const cp of checkpoints) {
        if (cp.completed) {
          completedChannelIds.add(cp.channelId);
        } else if (cp.lastMessageId) {
          resumeMap.set(cp.channelId, cp.lastMessageId);
        }
      }
      if (completedChannelIds.size > 0) {
        console.log(
          `[AUTO-RESUME] Skipping ${completedChannelIds.size} already-completed channel(s)`,
        );
      }
      if (resumeMap.size > 0) {
        console.log(
          `[AUTO-RESUME] Resuming ${resumeMap.size} in-progress channel(s)`,
        );
      }
    }

    // ── Channel filtering ───────────────────────────────────────────
    let textChannels = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildText,
    );

    // Filter by category IDs if provided
    if (categoryIds && Array.isArray(categoryIds) && categoryIds.length > 0) {
      textChannels = textChannels.filter(
        (channel) => channel.parentId && categoryIds.includes(channel.parentId),
      );
      console.log(
        `[CATEGORIES] Filtering to ${categoryIds.length} category/ies — ${textChannels.size} channel(s) matched`,
      );
    }

    // If explicit resumePoints provided, only process those channels
    if (resumePoints && resumeMap.size > 0) {
      textChannels = textChannels.filter((channel) =>
        resumeMap.has(channel.id),
      );
      console.log(
        `[CHANNELS] Will resume ${resumeMap.size} channel(s) from their last position`,
      );
    }

    // Skip channels completed in a previous run
    if (completedChannelIds.size > 0) {
      textChannels = textChannels.filter(
        (channel) => !completedChannelIds.has(channel.id),
      );
    }

    console.log(
      `[CHANNELS] ${textChannels.size} text channel(s) to process`,
    );

    // ── Statistics ──────────────────────────────────────────────────
    let totalMessagesSaved = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;
    let channelsProcessed = 0;

    // ── Bulk save helper (no pre-check — let bulkWrite + index handle dedup) ──
    const bulkSaveNewMessages = async (messages) => {
      if (!messages || messages.length === 0) {
        return { saved: 0, duplicates: 0, errors: 0 };
      }

      const documents = [];
      let transformErrorCount = 0;

      for (const message of messages) {
        try {
          const doc = transformMessageRoot(message);

          // Archive media to MinIO (content-addressable, deduped by SHA-256)
          if (MediaArchivalService.isAvailable()) {
            try {
              const archiveMap = await MediaArchivalService.archiveMessageMedia(message);
              if (Object.keys(archiveMap).length > 0) {
                doc.mediaArchive = archiveMap;
                MediaArchivalService.rewriteDocumentUrls(doc, archiveMap);
              }
            } catch (archiveErr) {
              console.warn(`  [ARCHIVE] Media archival failed for ${message.id}: ${archiveErr.message}`);
            }
          }

          documents.push(doc);
        } catch (transformError) {
          console.error(
            `  [ERROR] Failed to transform message ${message.id}: ${transformError.message}`,
          );
          transformErrorCount++;
        }
      }

      if (documents.length === 0) {
        return { saved: 0, duplicates: 0, errors: transformErrorCount };
      }

      try {
        const bulkOps = documents.map((doc) => {
          // Fields we always want to update (even on existing documents)
          const backfill = {
            "member.displayHexColor": doc.member?.displayHexColor || null,
            "member.displayName": doc.member?.displayName || null,
          };

          // Clone for $setOnInsert and strip backfill paths to avoid conflict
          const insertDoc = { ...doc };
          if (insertDoc.member) {
            const { displayHexColor: _dhc, displayName: _dn, ...restMember } = insertDoc.member;
            insertDoc.member = restMember;
          }

          return {
            updateOne: {
              filter: { id: doc.id },
              update: {
                $setOnInsert: insertDoc,
                $set: backfill,
              },
              upsert: true,
            },
          };
        });

        const result = await collection.bulkWrite(bulkOps, { ordered: false });

        return {
          saved: result.upsertedCount,
          duplicates: result.matchedCount || 0,
          errors: transformErrorCount,
        };
      } catch (error) {
        if (error.writeErrors) {
          const savedCount = error.result?.nUpserted || 0;
          console.error(
            `  [ERROR] Bulk write partial failure: ${savedCount} saved, ${error.writeErrors.length} errors`,
          );
          return {
            saved: savedCount,
            duplicates: 0,
            errors: error.writeErrors.length + transformErrorCount,
          };
        }

        console.error(`  [ERROR] Bulk save failed: ${error.message}`);
        return { saved: 0, duplicates: 0, errors: messages.length };
      }
    };

    // ── Concurrency limiter ─────────────────────────────────────────
    const createConcurrencyLimiter = (limit) => {
      let activeCount = 0;
      const queue = [];

      const run = async (fn) => {
        while (activeCount >= limit) {
          await new Promise((resolve) => queue.push(resolve));
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

    const limiter = createConcurrencyLimiter(concurrencyLimit);    // ── User IDs for deleted message cleanup ────────────────────────
    // After scraping each channel, remove messages from these users
    // that exist in MongoDB but were deleted from Discord.
    const CLEANUP_USER_IDS = [
      "166745313258897409",   // Rodrigo
      "1198099566088699904",  // Lupos (bot)
    ];

    // ── Process a single channel ────────────────────────────────────
    const processChannel = async (channel) => {
      const channelStartTime = Date.now();
      let channelMessageCount = 0;
      let channelDuplicates = 0;
      let channelErrors = 0;

      // Track message IDs from the target users found on Discord
      const discordUserMessageIds = new Set();

      // Use checkpoint (auto or explicit) if available
      let lastId = resumeMap.get(channel.id) || null;

      if (lastId) {
        console.log(
          `[CHANNEL] Resuming: #${channel.name} (${channel.id}) from message ${lastId}`,
        );
      } else {
        console.log(`[CHANNEL] Processing: #${channel.name} (${channel.id})`);
      }

      let hasMoreMessages = true;
      let lastMessageDate = null;

      // Pending write promise from previous iteration (pipelined)
      let pendingWrite = null;

      while (hasMoreMessages) {
        try {
          // Direct Discord.js fetch — simpler than the general-purpose wrapper
          const fetchOptions = { limit: batchSize, cache: false };
          if (lastId) fetchOptions.before = lastId;

          const messages = await channel.messages.fetch(fetchOptions);

          // Wait for previous batch's write to complete before accumulating stats
          if (pendingWrite) {
            const result = await pendingWrite;
            channelMessageCount += result.saved;
            channelDuplicates += result.duplicates;
            channelErrors += result.errors;
            totalMessagesSaved += result.saved;
            totalDuplicates += result.duplicates;
            totalErrors += result.errors;

            // Log progress for previously written batch
            if (result.saved > 0) {
              console.log(
                `  [PROGRESS] #${channel.name}: +${result.saved} saved (${result.duplicates} skipped) | Date: ${result._lastDate}`,
              );
            } else if (result.duplicates > 0) {
              console.log(
                `  [SKIP] #${channel.name}: ${result.duplicates} messages already exist | Date: ${result._lastDate}`,
              );
            }
            pendingWrite = null;
          }

          if (!messages || messages.size === 0) {
            hasMoreMessages = false;
            break;
          }

          // Track message IDs from the target users
          for (const msg of messages.values()) {
            if (CLEANUP_USER_IDS.includes(msg.author?.id)) {
              discordUserMessageIds.add(msg.id);
            }
          }

          // Update pagination cursor immediately (sync — no waiting)
          const lastMessage = messages.last();
          if (lastMessage) {
            lastId = lastMessage.id;
            lastMessageDate = lastMessage.createdAt;
          }

          // Check date limit
          if (limitDate && lastMessageDate && lastMessageDate < limitDate) {
            console.log(
              `  [DATE LIMIT] #${channel.name}: Reached date limit (${limitDate.toISOString().split("T")[0]}), stopping | Last message: ${lastMessageDate.toISOString()}`,
            );
            hasMoreMessages = false;
          }

          // End of channel history
          if (messages.size < batchSize) {
            hasMoreMessages = false;
          }

          // Fire bulkWrite + checkpoint as a pipeline — next fetch starts immediately
          const messageBatch = Array.from(messages.values());
          const batchDate = lastMessageDate;
          pendingWrite = (async () => {
            const result = await bulkSaveNewMessages(messageBatch);

            // Persist checkpoint for crash recovery
            if (autoResume && lastId) {
              await checkpointCollection.updateOne(
                { guildId, channelId: channel.id },
                {
                  $set: {
                    lastMessageId: lastId,
                    lastMessageDate: batchDate,
                    channelName: channel.name,
                    updatedAt: new Date(),
                  },
                },
                { upsert: true },
              );
            }

            // Attach date for logging
            result._lastDate = batchDate
              ? batchDate.toISOString().split("T")[0]
              : "unknown";
            return result;
          })();

          // discord.js handles rate limiting internally — no artificial delay needed
        } catch (fetchError) {
          console.error(
            `  [ERROR] Failed to fetch messages from #${channel.name}: ${fetchError.message}`,
          );
          channelErrors++;
          totalErrors++;
          hasMoreMessages = false;
        }
      }

      // Drain the final pipelined write
      if (pendingWrite) {
        try {
          const result = await pendingWrite;
          channelMessageCount += result.saved;
          channelDuplicates += result.duplicates;
          channelErrors += result.errors;
          totalMessagesSaved += result.saved;
          totalDuplicates += result.duplicates;
          totalErrors += result.errors;
          if (result.saved > 0) {
            console.log(
              `  [PROGRESS] #${channel.name}: +${result.saved} saved (${result.duplicates} skipped) | Date: ${result._lastDate}`,
            );
          }
        } catch (writeError) {
          console.error(
            `  [ERROR] Final batch write failed for #${channel.name}: ${writeError.message}`,
          );
          channelErrors++;
          totalErrors++;
        }
      }

      // ── Cleanup: purge deleted messages from target users ─────────
      // Compare MongoDB messages by these users in this channel against
      // what was found on Discord — delete any orphans.
      if (discordUserMessageIds.size > 0 || !limitDate) {
        try {
          const mongoUserMessages = await collection
            .find(
              { channelId: channel.id, "author.id": { $in: CLEANUP_USER_IDS } },
              { projection: { id: 1 } },
            )
            .toArray();

          const orphanIds = mongoUserMessages
            .filter((doc) => !discordUserMessageIds.has(doc.id))
            .map((doc) => doc.id);

          if (orphanIds.length > 0) {
            const deleteResult = await collection.deleteMany({
              id: { $in: orphanIds },
            });
            console.log(
              `  [CLEANUP] #${channel.name}: Removed ${deleteResult.deletedCount} orphaned message(s) from tracked users`,
            );
          }
        } catch (cleanupErr) {
          console.warn(
            `  [CLEANUP] #${channel.name}: cleanup failed: ${cleanupErr.message}`,
          );
        }
      }

      // Mark channel as completed so future runs skip it
      if (autoResume) {
        await checkpointCollection.updateOne(
          { guildId, channelId: channel.id },
          {
            $set: {
              completed: true,
              channelName: channel.name,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
      }

      channelsProcessed++;
      const duration = ((Date.now() - channelStartTime) / 1000).toFixed(2);
      console.log(
        `  [COMPLETE] #${channel.name}: ${channelMessageCount} saved, ${channelDuplicates} duplicates, ${channelErrors} errors (${duration}s)`,
      );

      return {
        saved: channelMessageCount,
        duplicates: channelDuplicates,
        errors: channelErrors,
      };
    };

    // ── Dispatch all channels ───────────────────────────────────────
    const channelPromises = [];
    for (const channel of textChannels.values()) {
      channelPromises.push(limiter.run(() => processChannel(channel)));
    }

    await Promise.all(channelPromises);

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n[FINISHED] Message fetch complete for guild: ${guild.name}`);
    console.log(`  - Channels processed: ${channelsProcessed}`);
    console.log(`  - Messages saved: ${totalMessagesSaved}`);
    console.log(`  - Duplicates skipped: ${totalDuplicates}`);
    console.log(`  - Errors: ${totalErrors}`);
    console.log(`  - Duration: ${totalDuration}s`);

    return {
      guildId,
      guildName: guild.name,
      channelsProcessed,
      totalMessagesSaved,
      totalDuplicates,
      totalErrors,
      totalDuration: parseFloat(totalDuration),
    };
  },

  /**
   * Purge deleted messages for specific users.
   * Queries MongoDB for all messages by the given user IDs, then verifies
   * each one against Discord. Messages that no longer exist (404/10008)
   * are deleted from MongoDB.
   *
   * @param {import('discord.js').Client} client
   * @param {import('mongodb').MongoClient} mongo
   * @param {string} guildId
   * @param {string[]} userIds - Discord user IDs to reconcile
   * @param {object} [options]
   * @param {string} [options.collectionName='Messages']
   * @param {number} [options.concurrencyLimit=5] - Parallel Discord API checks
   */
  async purgeDeletedMessagesForUsers(client, mongo, guildId, userIds, options = {}) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 5,
    } = options;

    const startTime = Date.now();
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      console.error(`[CLEANUP] Guild ${guildId} not found`);
      return { verified: 0, deleted: 0, errors: 0 };
    }

    // Find all messages in MongoDB by these users in this guild
    const mongoMessages = await collection
      .find(
        { guildId, "author.id": { $in: userIds } },
        { projection: { id: 1, channelId: 1, "author.id": 1 } },
      )
      .toArray();

    console.log(`[CLEANUP] Found ${mongoMessages.length} message(s) from ${userIds.length} tracked user(s) to verify`);
    if (mongoMessages.length === 0) return { verified: 0, deleted: 0, errors: 0 };

    // Group by channel for efficient processing
    const byChannel = new Map();
    for (const doc of mongoMessages) {
      if (!byChannel.has(doc.channelId)) byChannel.set(doc.channelId, []);
      byChannel.get(doc.channelId).push(doc.id);
    }

    let totalVerified = 0;
    let totalDeleted = 0;
    let totalErrors = 0;

    for (const [channelId, messageIds] of byChannel) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.warn(`  [CLEANUP] Channel ${channelId} not in cache — skipping ${messageIds.length} message(s)`);
        totalErrors += messageIds.length;
        continue;
      }

      const orphanIds = [];

      // Process in concurrency-limited chunks
      for (let i = 0; i < messageIds.length; i += concurrencyLimit) {
        const chunk = messageIds.slice(i, i + concurrencyLimit);
        const results = await Promise.allSettled(
          chunk.map(async (msgId) => {
            try {
              await channel.messages.fetch(msgId);
              return { exists: true, id: msgId };
            } catch (err) {
              // 10008 = Unknown Message (deleted)
              if (err.code === 10008) {
                return { exists: false, id: msgId };
              }
              // Other errors (permissions, rate limit) — don't assume deleted
              throw err;
            }
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            if (result.value.exists) {
              totalVerified++;
            } else {
              orphanIds.push(result.value.id);
            }
          } else {
            totalErrors++;
            console.warn(`  [CLEANUP] Error checking message in #${channel.name}: ${result.reason?.message}`);
          }
        }
      }

      if (orphanIds.length > 0) {
        const deleteResult = await collection.deleteMany({ id: { $in: orphanIds } });
        totalDeleted += deleteResult.deletedCount;
        console.log(
          `  [CLEANUP] #${channel.name}: Removed ${deleteResult.deletedCount} deleted message(s)`,
        );
      } else {
        console.log(
          `  [CLEANUP] #${channel.name}: All ${messageIds.length} message(s) still exist`,
        );
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[CLEANUP] Complete — verified: ${totalVerified}, deleted: ${totalDeleted}, errors: ${totalErrors} (${duration}s)`);

    return { verified: totalVerified, deleted: totalDeleted, errors: totalErrors };
  },

  /**
   * Backfill media archive for messages that still have Discord CDN URLs.
   * Finds messages missing `mediaArchive` that have attachments, downloads
   * the media to MinIO, and updates the document with permanent URLs.
   *
   * @param {import('discord.js').Client} client - Discord client for fetching fresh URLs
   * @param {import('mongodb').MongoClient} mongo
   * @param {object} [options]
   * @param {string} [options.collectionName='Messages']
   * @param {string[]} [options.authorIds] - Limit to specific author IDs (null = all)
   * @param {string} [options.guildId] - Limit to specific guild
   * @param {number} [options.batchSize=50] - Documents per processing batch
   */
  async backfillMediaArchive(client, mongo, options = {}) {
    const {
      collectionName = "Messages",
      authorIds = null,
      guildId = null,
      batchSize = 50,
    } = options;

    if (!MediaArchivalService.isAvailable()) {
      console.error("[BACKFILL] MinIO not available — cannot backfill media");
      return { processed: 0, archived: 0, errors: 0 };
    }

    const startTime = Date.now();
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);

    // Build query: messages with media but no/empty mediaArchive
    const query = {
      $and: [
        {
          $or: [
            { mediaArchive: { $exists: false } },
            { mediaArchive: { $eq: {} } },
          ],
        },
        {
          $or: [
            { "attachments.0": { $exists: true } },
            { "stickers.0": { $exists: true } },
            { "embeds.0": { $exists: true } },
          ],
        },
      ],
    };
    if (authorIds) query["author.id"] = { $in: authorIds };
    if (guildId) query.guildId = guildId;

    const totalCount = await collection.countDocuments(query);
    console.log(`[BACKFILL] Found ${totalCount} message(s) needing media archival`);
    if (totalCount === 0) return { processed: 0, archived: 0, errors: 0 };

    // Load all docs, group by channel
    const docs = await collection.find(query).batchSize(batchSize).toArray();
    const byChannel = new Map();
    for (const doc of docs) {
      if (!byChannel.has(doc.channelId)) byChannel.set(doc.channelId, []);
      byChannel.get(doc.channelId).push(doc);
    }

    const guild = guildId ? client.guilds.cache.get(guildId) : null;
    let processed = 0;
    let archived = 0;
    let errors = 0;

    for (const [channelId, channelDocs] of byChannel) {
      // Resolve channel from guild cache or client channels
      const channel = guild
        ? guild.channels.cache.get(channelId)
        : client.channels.cache.get(channelId);

      if (!channel) {
        console.warn(`  [BACKFILL] Channel ${channelId} not in cache — skipping ${channelDocs.length} message(s)`);
        // Mark as empty mediaArchive so we don't retry endlessly
        for (const doc of channelDocs) {
          await collection.updateOne({ _id: doc._id }, { $set: { mediaArchive: {} } });
          processed++;
        }
        continue;
      }

      for (const doc of channelDocs) {
        processed++;

        try {
          // Fetch the live message from Discord to get fresh CDN URLs
          let liveMessage;
          try {
            liveMessage = await channel.messages.fetch(doc.id);
          } catch (fetchErr) {
            if (fetchErr.code === 10008) {
              // Message was deleted — mark and skip
              console.log(`  [BACKFILL] Message ${doc.id} deleted from Discord — marking empty`);
              await collection.updateOne({ _id: doc._id }, { $set: { mediaArchive: {} } });
              continue;
            }
            throw fetchErr;
          }

          // Use the standard archival pipeline on the live message
          const archiveMap = await MediaArchivalService.archiveMessageMedia(liveMessage);

          if (Object.keys(archiveMap).length > 0) {
            // Transform fresh doc and rewrite URLs
            const freshDoc = transformMessageRoot(liveMessage);
            MediaArchivalService.rewriteDocumentUrls(freshDoc, archiveMap);

            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  mediaArchive: archiveMap,
                  attachments: freshDoc.attachments,
                  stickers: freshDoc.stickers,
                  embeds: freshDoc.embeds,
                },
              },
            );
            archived++;
          } else {
            // No media found on live message — mark as processed
            await collection.updateOne({ _id: doc._id }, { $set: { mediaArchive: {} } });
          }

          if (processed % 25 === 0) {
            console.log(`  [BACKFILL] Progress: ${processed}/${totalCount} processed, ${archived} archived`);
          }
        } catch (err) {
          errors++;
          console.error(`  [BACKFILL] Error processing message ${doc.id}: ${err.message}`);
          // Mark failed so we don't retry on next run (can be cleared manually)
          await collection.updateOne({ _id: doc._id }, { $set: { mediaArchive: {} } });
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[BACKFILL] Complete — processed: ${processed}, archived: ${archived}, errors: ${errors} (${duration}s)`);

    return { processed, archived, errors };
  },
  async deleteDuplicateMessagesByID(mongo, collectionName = "Messages") {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);

    console.log("[START] Finding and deleting duplicate messages...");

    // Find all duplicate IDs using aggregation
    const duplicates = await collection
      .aggregate([
        {
          $group: {
            _id: "$id",
            count: { $sum: 1 },
            docs: { $push: "$_id" },
          },
        },
        {
          $match: {
            count: { $gt: 1 },
          },
        },
      ])
      .toArray();

    console.log(
      `[INFO] Found ${duplicates.length} message IDs with duplicates`,
    );

    let totalDeleted = 0;

    for (const duplicate of duplicates) {
      // Keep the first document, delete the rest
      const docsToDelete = duplicate.docs.slice(1);

      if (docsToDelete.length > 0) {
        const result = await collection.deleteMany({
          _id: { $in: docsToDelete },
        });
        totalDeleted += result.deletedCount;
        console.log(
          `[DELETE] Deleted ${result.deletedCount} duplicate(s) for message ID: ${duplicate._id}`,
        );
      }
    }

    console.log(`[COMPLETE] Total duplicates deleted: ${totalDeleted}`);

    return {
      duplicateIdsFound: duplicates.length,
      totalDeleted: totalDeleted,
    };
  },
  /**
   * Shared username sanitization: replaces spaces with underscores,
   * removes non-word characters.
   * @param {string} name
   * @returns {string}
   */
  _sanitizeUsername(name) {
    if (!name) return "default";
    return name.replace(/\s+/g, "_").replace(/[^\w]/gi, "") || "default";
  },
  getUsernameNoSpaces(message) {
    const name =
      message?.author?.displayName ||
      message?.author?.username ||
      message?.user?.username;
    return DiscordUtilityService._sanitizeUsername(name);
  },
  // async saveMessageToMongo(message, mongo, collectionName='msgs') {
  //     const db = mongo.db("lupos");
  //     const collection = db.collection(collectionName);
  //     const messageObject = transformMessageRoot(message);
  //     await collection.insertOne(messageObject);
  // },
  async saveMessageToMongo(message, mongo, collectionName = "Messages") {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const messageObject = transformMessageRoot(message);

    // Archive media to MinIO (content-addressable, deduped by SHA-256)
    if (MediaArchivalService.isAvailable()) {
      try {
        const archiveMap = await MediaArchivalService.archiveMessageMedia(message);
        if (Object.keys(archiveMap).length > 0) {
          messageObject.mediaArchive = archiveMap;
          MediaArchivalService.rewriteDocumentUrls(messageObject, archiveMap);
        }
      } catch (err) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${err.message}`);
      }
    }

    await collection.updateOne(
      { id: messageObject.id },
      { $setOnInsert: messageObject },
      { upsert: true },
    );
  },
  async updateMessageInMongo(message, mongo, collectionName = "Messages") {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const messageObject = transformMessageRoot(message);

    // Archive media to MinIO (content-addressable, deduped by SHA-256)
    if (MediaArchivalService.isAvailable()) {
      try {
        const archiveMap = await MediaArchivalService.archiveMessageMedia(message);
        if (Object.keys(archiveMap).length > 0) {
          messageObject.mediaArchive = archiveMap;
          MediaArchivalService.rewriteDocumentUrls(messageObject, archiveMap);
        }
      } catch (err) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${err.message}`);
      }
    }

    await collection.updateOne(
      { id: messageObject.id },
      { $set: messageObject },
      { upsert: false },
    );
  },

  async extractAudioUrlsFromMessage(message) {
    const audioUrls = [];
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isAudio = attachment.contentType.includes("audio/ogg");
        if (isAudio) {
          audioUrls.push(attachment.url);
        }
      }
    }
    return audioUrls;
  },
  async extractImageUrlsFromMessage(message) {
    const imageUrls = [];
    // Attachments
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isImage = attachment.contentType.includes("image/");
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
          if (!url.includes("https://tenor.com/view/")) {
            const isImage = await utilities.isImageUrl(url);
            if (isImage) {
              imageUrls.push(url);
            }
          } else {
            const tenorImage = await ScraperService.scrapeTenor(url);
            if (tenorImage?.image) {
              imageUrls.push(tenorImage.image);
            } else {
              console.warn(
                `⚠️ [extractImageUrlsFromMessage] Could not extract image from Tenor URL: ${url}`,
              );
            }
          }
        }
      }
    }

    return imageUrls;
  },
  async retrieveMessageReferenceFromMessage(message) {
    let messageReference;
    if (message?.reference && message.reference.messageId) {
      messageReference = message.channel.messages.cache.get(
        message.reference.messageId,
      );
      if (!messageReference) {
        try {
          messageReference = await message.channel.messages.fetch(
            message.reference.messageId,
          );
        } catch (error) {
          console.error("Error fetching message reference:", error);
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
  getCleanUsernameFromUser(user) {
    // Replaces periods/hashes with underscores first, then delegates to shared sanitizer
    const raw = user?.username?.replace(/[.#]/g, "_");
    return DiscordUtilityService._sanitizeUsername(raw);
  },
  async getDisplayName(message, userId) {
    let displayName;
    if (message && message.guild && userId) {
      const member = await DiscordUtilityService.retrieveMemberFromGuildById(
        message.guild,
        userId,
      );
      if (member) {
        displayName = member.displayName;
      } else {
        const user =
          await DiscordUtilityService.retrieveUserFromClientAndUserId(
            message.client,
            userId,
          );
        if (user) {
          displayName = user.displayName;
        }
      }
    }
    return displayName;
  },
  /**
   * Resolve display name from a user object.
   * Priority: displayName → globalName → username.
   */
  getNameFromUser(user) {
    return user?.displayName || user?.globalName || user?.username || undefined;
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
    consoleLog("<");
    const roles = client.guilds.cache.get(config.GUILD_ID_PRIMARY).roles.cache;
    const orderedRoles = roles
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .reverse();
    consoleLog(
      "=",
      `Printing out all roles in the order that they are in the server`,
    );
    for (const role of orderedRoles.values()) {
      console.log(`${role.name} - ${role.id}`);
    }
    consoleLog(">", "printOutAllRoles");
  },
  async printOutAllEmojis(client) {
    consoleLog("<");
    const emojis = client.guilds.cache.get(config.GUILD_ID_PRIMARY).emojis
      .cache;
    consoleLog("=", `Printing out all emojis in the server`);
    for (const emoji of emojis.values()) {
      console.log(`${emoji.name} - ${emoji.id}`);
    }
    consoleLog(">", "printOutAllEmojis");
  },
  async retrieveMemberFromGuildById(guild, userId) {
    if (guild && userId) {
      let member = guild.members.cache.get(userId);
      if (!member) {
        try {
          member = await guild.members.fetch(userId);
        } catch {
          // console.warn(...LogFormatter.memberNotFound('getMemberFromMessageAndId', userId, message.guild));
          return null;
        }
      }
      return member;
    }
  },
  // Canonical user-fetch: cache → fetch with optional force
  async getUserFromClientAndId(client, userId, force = false) {
    let user = client.users.cache.get(userId);
    if (!user) {
      try {
        user = await client.users.fetch(userId, { force });
      } catch (error) {
        consoleLog(
          "!",
          `Could not fetch user with ID ${userId}. Error: ${error.message}`,
        );
        return null;
      }
    }
    return user;
  },
  // Deprecated: Use getUserFromClientAndId directly.
  // Kept as alias for existing call sites (PermanentTimeOutJob, getDisplayName).
  async retrieveUserFromClientAndUserId(client, userId) {
    return DiscordUtilityService.getUserFromClientAndId(client, userId);
  },
  // Sync cache-only lookup (no fetch)
  getUserByClientAndId(client, userId) {
    return client.users.cache.get(userId);
  },
  // Convenience wrapper for message context
  async getUserFromMessage(message, force = false) {
    return DiscordUtilityService.getUserFromClientAndId(
      message.client,
      message.author.id,
      force,
    );
  },
  // Event Handlers
  onEventClientReady(client, { mongo, localMongo }, customFunction) {
    return client.on(Events.ClientReady, async () => {
      customFunction(client, { mongo, localMongo });
    });
  },
  onEventMessageCreate(client, { mongo, localMongo }, customFunction) {
    return client.on(Events.MessageCreate, async (message) => {
      customFunction(client, { mongo, localMongo }, message);
    });
  },
  onEventMessageUpdate(client, { mongo, localMongo }, customFunction) {
    return client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
      customFunction(client, { mongo, localMongo }, oldMessage, newMessage);
    });
  },
  onEventMessageDelete(client, mongo, customFunction) {
    return client.on(Events.MessageDelete, async (message) => {
      customFunction(client, mongo, message);
    });
  },
  onEventMessageReactionAdd(client, mongo, customFunction) {
    return client.on(Events.MessageReactionAdd, async (reaction, user) => {
      customFunction(client, mongo, reaction, user);
    });
  },
  onEventGuildMemberAdd(client, mongo, customFunction) {
    return client.on(Events.GuildMemberAdd, async (member) => {
      customFunction(client, mongo, member);
    });
  },
  onEventGuildMemberAvailable(client, mongo, customFunction) {
    return client.on(Events.GuildMemberAvailable, async (member) => {
      customFunction(client, mongo, member);
    });
  },
  onEventInteractionCreate(client, mongo, customFunction) {
    return client.on(Events.InteractionCreate, async (interaction) => {
      customFunction(client, mongo, interaction);
    });
  },
  onEventPresenceUpdate(client, customFunction) {
    return client.on(
      Events.PresenceUpdate,
      async (oldPresence, newPresence) => {
        customFunction(client, oldPresence, newPresence);
      },
    );
  },
  onEventVoiceStateUpdate(client, mongo, customFunction) {
    return client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      customFunction(client, mongo, oldState, newState);
    });
  },
  onEventGuildMemberRemove(client, mongo, customFunction) {
    return client.on(Events.GuildMemberRemove, async (member) => {
      customFunction(client, mongo, member);
    });
  },
  onEventGuildMemberUpdate(client, mongo, customFunction) {
    return client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
      customFunction(client, mongo, oldMember, newMember);
    });
  },
  async getAllServerEmojisFromMessage(message, format = "string") {
    // format can be: array, string
    if (message.guild.emojis.cache.size) {
      const emojis = message.guild.emojis.cache.map((emoji) => {
        return {
          id: emoji.id,
          name: emoji.name,
          url: emoji.url,
        };
      });
      if (format === "array") {
        return emojis;
      } else if (format === "string") {
        return emojis.map((emoji) => `<${emoji.name}:${emoji.id}>`).join(", ");
      }
    } else {
      return [];
    }
  },
  // Special functions
  async fetchMessages(client, channelId, options = {}) {
    const channel = client.channels.cache.find(
      (channel) => channel.id == channelId,
    );

    if (!channel) return null;

    const {
      limit = 10,
      before = null,
      after = null,
      around = null,
      cache = true,
    } = options;

    let allMessages = new Collection();

    // Metrics tracking
    let _apiCallCount = 0;
    const _startTime = Date.now();

    // If 'around' is specified, fetch once and return (Discord API behavior)
    if (around) {
      _apiCallCount++;
      const messages = await channel.messages.fetch({
        limit: Math.min(100, limit),
        around,
        cache,
      });
      return messages;
    }

    // Determine pagination direction and cursor
    const isAfterMode = after && !before;
    let cursor = before || after;

    // Initial fetch
    _apiCallCount++;
    const initialFetchOptions = {
      limit: Math.min(100, limit),
      cache,
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
      _apiCallCount++;

      const fetchOptions = {
        limit: Math.min(100, additionalMessagesNeeded),
        cache,
      };

      // Set the appropriate cursor
      if (isAfterMode) {
        fetchOptions.after = cursor;
      } else {
        fetchOptions.before = cursor;
      }

      messages = await channel.messages.fetch(fetchOptions);

      // Avoid duplicates (Discord API might return overlapping messages)
      const uniqueMessages = messages.filter((msg) => !allMessages.has(msg.id));
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
        consoleLog(
          "!",
          `Could not fetch channel with ID ${channelId}. Error: ${error.message}`,
        );
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
    return (
      item?.author?.displayName ||
      item?.author?.username ||
      item?.user?.globalName ||
      item?.user?.username
    );
  },
  // REST functions
  async patchBanner(client, imageUrl) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," + Buffer.from(imageUrl).toString("base64"),
      },
    });
  },
  async patchBannerFromImageUrl(client, imageUrl) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," +
          Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString(
            "base64",
          ),
      },
    });
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
        channel.sendTyping().catch((_error) => {
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
  async sendMessageInChunks(
    sendOrReply,
    message,
    generatedTextResponse,
    encodedImageDataBase64,
    imagePrompt,
  ) {
    const messageChunkSizeLimit = 2000;
    let fileName = "lupos.png";
    let imageDescription = "";
    let returnedFirstMessage;

    if (imagePrompt) {
      fileName = `${imagePrompt.substring(0, 240)}.png`;
      imageDescription = imagePrompt.substring(0, 1000);
    }

    for (
      let i = 0;
      i < generatedTextResponse.length;
      i += messageChunkSizeLimit
    ) {
      const chunk = generatedTextResponse.substring(
        i,
        i + messageChunkSizeLimit,
      );
      let messageReplyOptions = { content: chunk };
      const files = [];

      // if (generatedAudioFile && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
      //     files.push({ attachment: await fs.promises.readFile(`${BARK_VOICE_FOLDER}/${generatedAudioFile}`), name: `${generatedAudioFile}` });
      // }
      // if (generatedAudioBuffer && (i + messageChunkSizeLimit >= generatedTextResponse.length)) {
      //     files.push({ attachment: Buffer.from(generatedAudioBuffer, 'base64'), name: 'lupos.mp3' });
      // }
      if (
        encodedImageDataBase64 &&
        i + messageChunkSizeLimit >= generatedTextResponse.length
      ) {
        files.push({
          attachment: Buffer.from(encodedImageDataBase64, "base64"),
          name: fileName,
          description: imageDescription,
        });
      }
      messageReplyOptions = { ...messageReplyOptions, files: files };
      if (sendOrReply === "send") {
        const sentMessage = await message.channel.send(messageReplyOptions);
        if (!returnedFirstMessage) {
          returnedFirstMessage = sentMessage;
        }
      } else if (sendOrReply === "reply") {
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
    const periodText =
      MONTHS_TO_ANALYZE === 1 ? "1 month" : `${MONTHS_TO_ANALYZE} months`;

    const startTime = Date.now();
    consoleLog(">", `Displaying all channel activity (past ${periodText})`);
    console.log("[START] Beginning channel activity analysis...");
    console.log(`[START] Started at: ${new Date(startTime).toISOString()}`);
    console.log(
      `[CONFIG] Processing ${CONCURRENT_CHANNELS} channels concurrently`,
    );

    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);
    console.log(
      `[GUILD] Found guild: ${guild.name} with ${guild.channels.cache.size} total channels`,
    );

    const excludedCategories = [
      // 'Archived',
      // 'Archived02',
      // 'Archived: First Purge',
      // 'Archived: SOD',
      // 'Archived: Alliance',
      // 'Archived: WoW Classes',
      "⚒ Administration",
      "Info",
      "Welcome",
      "commands",
    ];

    const excludedChannels = [
      "609498307626008576",
      "762734438375096380", // politics
      "844637988159356968", // sportsmane
    ];

    console.log(
      `[FILTER] Excluding categories: ${excludedCategories.join(", ")}`,
    );
    console.log(
      `[FILTER] Excluding ${excludedChannels.length} specific channels`,
    );

    const channelStats = [];
    const globalUserStats = {};
    const now = DateTime.local();
    const cutoffDate = now.minus({ months: MONTHS_TO_ANALYZE });
    console.log(`[TIME] Current time: ${now.toISO()}`);
    console.log(
      `[TIME] Cutoff date (${periodText} ago): ${cutoffDate.toISO()}`,
    );

    let processedChannelCount = 0;
    let totalFetchCount = 0;

    // Collect all eligible channels first
    const eligibleChannels = [];
    for (const channel of guild.channels.cache.values()) {
      if (
        channel.type === ChannelType.GuildText &&
        channel.parent &&
        !excludedCategories.includes(channel.parent.name) &&
        !excludedChannels.includes(channel.id)
      ) {
        eligibleChannels.push(channel);
      }
    }

    const eligibleChannelCount = eligibleChannels.length;
    console.log(
      `[CHANNELS] Found ${eligibleChannelCount} eligible text channels to process`,
    );
    console.log("----------------------------------------");

    // Function to process a single channel
    const processChannel = async (channel, channelIndex) => {
      const logPrefix = `[CH ${channelIndex}/${eligibleChannelCount}]`;
      console.log(
        `\n${logPrefix} Processing: #${channel.name} (Category: ${channel.parent.name})`,
      );

      try {
        let allMessages = [];
        let lastMessageId = null;
        let fetchMore = true;
        let fetchCount = 0;
        let channelFetchCount = 0;
        let consecutiveDuplicates = 0;
        let previousOldestId = null;

        console.log(
          `  ${logPrefix} [FETCH] Starting message fetch for #${channel.name}...`,
        );

        while (fetchMore) {
          fetchCount++;
          channelFetchCount++;
          totalFetchCount++;

          console.log(`  ${logPrefix} [FETCH] Fetching batch ${fetchCount}...`);

          const messages = await fetchMessagesWithOptionalLastId(
            client,
            channel.id,
            100,
            lastMessageId ? lastMessageId : undefined,
          );

          const messagesArray = Array.from(messages.values());

          if (messagesArray.length === 0) {
            console.log(
              `  ${logPrefix} [FETCH] No messages found, stopping fetch`,
            );
            fetchMore = false;
            break;
          }

          const oldestMessage = messagesArray[messagesArray.length - 1];
          const oldestMessageDateTime = DateTime.fromMillis(
            oldestMessage.createdTimestamp,
          );
          const newestMessage = messagesArray[0];
          const newestMessageDateTime = DateTime.fromMillis(
            newestMessage.createdTimestamp,
          );

          if (previousOldestId === oldestMessage.id) {
            consecutiveDuplicates++;
            console.log(
              `  ${logPrefix} [FETCH] WARNING: Got same oldest message ID as previous batch (duplicate #${consecutiveDuplicates})`,
            );
            if (consecutiveDuplicates >= 3) {
              console.log(
                `  ${logPrefix} [FETCH] ERROR: Too many duplicate batches, stopping to prevent infinite loop`,
              );
              fetchMore = false;
              break;
            }
          } else {
            consecutiveDuplicates = 0;
            previousOldestId = oldestMessage.id;
          }

          const newMessages = messagesArray.filter(
            (msg) =>
              !allMessages.some((existingMsg) => existingMsg.id === msg.id),
          );

          if (newMessages.length === 0) {
            console.log(
              `  ${logPrefix} [FETCH] All messages in this batch are duplicates, stopping`,
            );
            fetchMore = false;
            break;
          }

          allMessages = allMessages.concat(newMessages);

          console.log(
            `  ${logPrefix} [FETCH] Batch ${fetchCount}: ${messagesArray.length} messages (${newMessages.length} new)`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Date range: ${newestMessageDateTime.toFormat("yyyy-MM-dd HH:mm:ss")} to ${oldestMessageDateTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Oldest message ID: ${oldestMessage.id}`,
          );

          if (oldestMessageDateTime < cutoffDate) {
            console.log(
              `  ${logPrefix} [FETCH] Reached messages older than ${periodText} (${oldestMessageDateTime.toFormat("yyyy-MM-dd")} < ${cutoffDate.toFormat("yyyy-MM-dd")})`,
            );
            fetchMore = false;
            break;
          }

          if (messagesArray.length < 100) {
            console.log(
              `  ${logPrefix} [FETCH] Retrieved only ${messagesArray.length} messages, channel history exhausted`,
            );
            fetchMore = false;
            break;
          }

          lastMessageId = oldestMessage.id;

          console.log(
            `  ${logPrefix} [FETCH] Total unique messages collected: ${allMessages.length}`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Next fetch will use before: ${lastMessageId}`,
          );

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log(
          `  ${logPrefix} [FETCH] Total fetches for this channel: ${channelFetchCount}`,
        );
        console.log(
          `  ${logPrefix} [PROCESS] Filtering messages from the last ${periodText}...`,
        );

        const messagesInPeriod = allMessages.filter(
          (message) =>
            DateTime.fromMillis(message.createdTimestamp) > cutoffDate,
        );
        console.log(
          `  ${logPrefix} [PROCESS] Found ${messagesInPeriod.length} messages in the last ${periodText} (out of ${allMessages.length} total fetched)`,
        );

        const userMessageCount = {};
        const localUserStats = {}; // Collect locally first to avoid race conditions

        messagesInPeriod.forEach((message) => {
          const userId = message.author.id;
          const username = message.author.username;
          if (!userMessageCount[userId]) {
            userMessageCount[userId] = {
              username: username,
              count: 0,
            };
          }
          userMessageCount[userId].count++;

          if (!localUserStats[userId]) {
            localUserStats[userId] = {
              username: username,
              totalMessages: 0,
              channels: new Set(),
            };
          }
          localUserStats[userId].totalMessages++;
          localUserStats[userId].channels.add(channel.name);
        });

        const uniqueUserCount = Object.keys(userMessageCount).length;
        console.log(
          `  ${logPrefix} [USERS] Found ${uniqueUserCount} unique users in the last ${periodText}`,
        );

        const sortedUsers = Object.entries(userMessageCount)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 20)
          .map(([_userId, data]) => ({
            username: data.username,
            count: data.count,
          }));

        if (sortedUsers.length > 0) {
          console.log(`  ${logPrefix} [TOP USERS] Top contributors:`);
          sortedUsers.forEach((user, index) => {
            console.log(
              `    ${index + 1}. ${user.username}: ${user.count} messages`,
            );
          });
        }

        let averageMessagesPerDay = 0;
        let lastMessageDate = null;

        if (messagesInPeriod.length > 0) {
          const oldestRecentMessage =
            messagesInPeriod[messagesInPeriod.length - 1];
          const newestMessage = messagesInPeriod[0];
          const oldestDateTime = DateTime.fromMillis(
            oldestRecentMessage.createdTimestamp,
          );
          const newestDateTime = DateTime.fromMillis(
            newestMessage.createdTimestamp,
          );
          const daySpan = Math.max(
            1,
            newestDateTime.diff(oldestDateTime, "days").days,
          );

          averageMessagesPerDay = messagesInPeriod.length / daySpan;
          lastMessageDate = newestDateTime;

          console.log(
            `  ${logPrefix} [METRICS] Message span: ${daySpan.toFixed(1)} days`,
          );
          console.log(
            `  ${logPrefix} [METRICS] Average messages/day: ${averageMessagesPerDay.toFixed(2)}`,
          );
          console.log(
            `  ${logPrefix} [METRICS] Last message: ${lastMessageDate.toFormat("yyyy-MM-dd HH:mm")}`,
          );
        } else {
          console.log(
            `  ${logPrefix} [METRICS] No messages in the last ${periodText}`,
          );
        }

        processedChannelCount++;
        console.log(
          `  ${logPrefix} [COMPLETE] Successfully processed #${channel.name} (${processedChannelCount}/${eligibleChannelCount} done)`,
        );

        return {
          channelStat: {
            channel: channel,
            messageCount: messagesInPeriod.length,
            uniqueUsers: uniqueUserCount,
            topUsers: sortedUsers,
            averageMessagesPerDay: averageMessagesPerDay,
            lastMessageDate: lastMessageDate,
            categoryName: channel.parent ? channel.parent.name : "No Category",
          },
          localUserStats: localUserStats,
        };
      } catch (error) {
        console.error(
          `  ${logPrefix} [ERROR] Failed to fetch messages for channel ${channel.name}:`,
          error.message,
        );
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
      const totalBatches = Math.ceil(
        eligibleChannels.length / CONCURRENT_CHANNELS,
      );

      console.log(`\n========================================`);
      console.log(
        `[BATCH ${batchNumber}/${totalBatches}] Processing ${batch.length} channels concurrently...`,
      );
      console.log(`========================================`);

      const batchPromises = batch.map((channel, batchIndex) =>
        processChannel(channel, i + batchIndex + 1),
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
              channels: new Set(),
            };
          }
          globalUserStats[userId].totalMessages += data.totalMessages;
          for (const channelName of data.channels) {
            globalUserStats[userId].channels.add(channelName);
          }
        }
      }
    }

    console.log("\n----------------------------------------");
    console.log("[SORT] Sorting channels by average messages per day...");
    channelStats.sort(
      (a, b) => b.averageMessagesPerDay - a.averageMessagesPerDay,
    );
    console.log("[SORT] Sorting complete (by average messages/day)");

    console.log(`\n=== Channel Activity Report (Past ${periodText}) ===`);
    console.log("=== Sorted by Average Messages Per Day ===\n");
    console.log(
      "Rank | Avg/Day | Messages | Users | Days Ago | Category            | Channel Name         | Top 3 Users",
    );
    console.log(
      "-----|---------|----------|-------|----------|---------------------|----------------------|-------------",
    );

    channelStats.forEach((stat, index) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const avgPerDay = stat.averageMessagesPerDay.toFixed(2).padStart(7, " ");
      const messageCount = stat.messageCount.toString().padStart(8, " ");
      const uniqueUsers = stat.uniqueUsers.toString().padStart(5, " ");

      let daysSinceLastMessage = "N/A";
      if (stat.lastMessageDate) {
        const daysDiff = now.diff(stat.lastMessageDate, "days").days;
        daysSinceLastMessage = daysDiff.toFixed(0).padStart(8, " ");
      } else {
        daysSinceLastMessage = daysSinceLastMessage.padStart(8, " ");
      }

      const category = stat.categoryName.substring(0, 20).padEnd(20, " ");
      const channelName = stat.channel.name.substring(0, 20).padEnd(20, " ");

      let topUsersStr = "";
      if (stat.topUsers.length > 0) {
        topUsersStr = stat.topUsers
          .slice(0, 3)
          .map((user, idx) => `${idx + 1}. ${user.username} (${user.count})`)
          .join(", ");
      } else {
        topUsersStr = "No activity";
      }

      console.log(
        `${rank} | ${avgPerDay} | ${messageCount} | ${uniqueUsers} | ${daysSinceLastMessage} | ${category} | ${channelName} | ${topUsersStr}`,
      );
    });

    const totalMessages = channelStats.reduce(
      (sum, stat) => sum + stat.messageCount,
      0,
    );
    const activeChannels = channelStats.filter(
      (stat) => stat.messageCount > 0,
    ).length;
    const inactiveChannels = channelStats.filter(
      (stat) => stat.messageCount === 0,
    ).length;
    const totalUniqueUsers = Object.keys(globalUserStats).length;

    const mostActiveByAverage = channelStats[0];

    const topTenUsers = Object.entries(globalUserStats)
      .sort((a, b) => b[1].totalMessages - a[1].totalMessages)
      .slice(0, 10)
      .map(([_userId, data]) => ({
        username: data.username,
        totalMessages: data.totalMessages,
        channelCount: data.channels.size,
      }));

    const endTime = Date.now();
    const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const totalTimeMinutes = (totalTimeSeconds / 60).toFixed(2);

    console.log("\n=== Summary ===");
    console.log(`[SUMMARY] Total messages (${periodText}): ${totalMessages}`);
    console.log(`[SUMMARY] Active channels: ${activeChannels}`);
    console.log(`[SUMMARY] Inactive channels: ${inactiveChannels}`);
    console.log(
      `[SUMMARY] Most active channel (by avg/day): ${mostActiveByAverage?.channel.name || "N/A"} (${mostActiveByAverage?.averageMessagesPerDay.toFixed(2) || 0} messages/day)`,
    );
    console.log(`[SUMMARY] Total channels processed: ${processedChannelCount}`);
    console.log(`[SUMMARY] Total API fetches made: ${totalFetchCount}`);
    console.log(
      `[SUMMARY] Average fetches per channel: ${(totalFetchCount / processedChannelCount).toFixed(2)}`,
    );
    console.log(
      `[SUMMARY] Total unique users across all channels: ${totalUniqueUsers}`,
    );
    console.log(
      `[SUMMARY] Concurrent channels setting: ${CONCURRENT_CHANNELS}`,
    );
    console.log(
      `[SUMMARY] Total execution time: ${totalTimeSeconds} seconds (${totalTimeMinutes} minutes)`,
    );
    console.log(`[SUMMARY] Completed at: ${new Date(endTime).toISOString()}`);

    console.log(`\n=== Top 10 Most Active Users (Past ${periodText}) ===`);
    console.log(
      "Rank | Username                | Total Messages | Active Channels",
    );
    console.log(
      "-----|-------------------------|----------------|----------------",
    );

    topTenUsers.forEach((user, index) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const username = user.username.substring(0, 23).padEnd(23, " ");
      const totalMessages = user.totalMessages.toString().padStart(14, " ");
      const channelCount = user.channelCount.toString().padStart(15, " ");

      console.log(`${rank} | ${username} | ${totalMessages} | ${channelCount}`);
    });

    console.log("\n[END] Channel activity analysis complete!");
    consoleLog(">");
  },
  async calculateMessagesSentOnAveragePerDayInChannel(client, channelId) {
    console.log(
      `Calculating average messages sent in channel ${channelId} over the date range in the messages...`,
    );
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      console.log(
        `Channel with ID ${channelId} not found or is not a text channel.`,
      );
      return;
    }

    const now = Date.now();

    let messageCount = 0;
    let lastMessageDate = null;

    try {
      const recentMessages = (
        await DiscordUtilityService.fetchMessages(client, channel.id, {
          limit: 100,
        })
      ).reverse();
      for (const recentMsg of recentMessages.values()) {
        messageCount++;
        if (
          !lastMessageDate ||
          recentMsg.createdTimestamp > lastMessageDate.getTime()
        ) {
          lastMessageDate = new Date(recentMsg.createdTimestamp);
        }
      }
    } catch (error) {
      console.log(
        `Error fetching messages from channel ${channel.name}: ${error.message}`,
      );
      return;
    }

    const daysSinceStart = Math.max(
      1,
      Math.ceil((now - lastMessageDate.getTime()) / MS_PER_DAY),
    );
    const averageMessagesPerHour = (
      messageCount /
      (daysSinceStart * 24)
    ).toFixed(2);

    console.log(`Channel: ${channel.name}`);
    console.log(
      `Messages sent in the last ${daysSinceStart} days: ${messageCount}`,
    );
    console.log(`Average messages sent per hour: ${averageMessagesPerHour}`);
    if (lastMessageDate) {
      console.log(`Last message date: ${lastMessageDate.toISOString()}`);
    } else {
      console.log("No messages found in the specified period.");
    }
  },
  async addRoleToMember(member, roleId) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        !member.roles.cache.some((role) => role.id === roleId)
      ) {
        await member.roles.add(role);
        LightsService.cycleColor(config.PRIMARY_LIGHT_ID);
        console.log(...LogFormatter.roleAdded(member, role));
      }
    } catch (error) {
      console.error(
        ...LogFormatter.roleFailedToAdd(member.user.id, role, error.message),
      );
    }
  },
  async removeRoleFromMember(member, roleId) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        member.roles.cache.some((role) => role.id === roleId)
      ) {
        await member.roles.remove(role);
        LightsService.cycleColor(config.PRIMARY_LIGHT_ID);
        console.log(...LogFormatter.roleRemoved(member, role));
      }
    } catch (error) {
      console.error(
        ...LogFormatter.roleFailedToRemove(member.user.id, role, error.message),
      );
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
