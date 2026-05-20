import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import utilities from "#root/utilities.js";
const { consoleLog } = utilities;
import config from "#root/config.js";
import { Collection, ChannelType, Events, ActivityType } from "discord.js";
import { MS_PER_DAY, MONGO_DB_NAME } from "#root/constants.js";
import ScraperService from "#root/services/ScraperService.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import MediaArchivalService from "#root/services/MediaArchivalService.js";

async function fetchMessagesWithOptionalLastId(
  client: any,
  channelId: any,
  maxMessages: any = 10,
  lastId: any = null,
) {
  const channel = client.channels.cache.find(
    (channel: any) => channel.id == channelId,
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

const transformUserPrimaryGuild = (userPrimaryGuild: any) => ({
  badge: userPrimaryGuild?.badge,
  identityEnabled: userPrimaryGuild?.identityEnabled,
  identityGuildId: userPrimaryGuild?.identityGuildId,
  tag: userPrimaryGuild?.tag,
});

const transformUser = (user: any, concise: any = false) => {
  if (user) {
    const userObject = {
      accentColor: user.accentColor,             // number | null | undefined
      avatar: user.avatar,                       // string | null
      avatarDecorationData: user.avatarDecorationData, // AvatarDecorationData | null
      banner: user.banner,                       // string | null | undefined
      bot: user.bot,                             // boolean
      createdAt: user.createdAt,                 // Date
      createdTimestamp: user.createdTimestamp,    // number
      defaultAvatarURL: user.defaultAvatarURL,   // string
      discriminator: user.discriminator,         // string
      displayName: user.displayName,             // string
      dmChannel: user.dmChannel,                 // DMChannel | null
      flags: user.flags,                         // UserFlagsBitField
      globalName: user.globalName,               // string | null
      hexAccentColor: user.hexAccentColor,       // HexColorString | null | undefined
      id: user.id,                               // Snowflake
      partial: user.partial,                     // false
      primaryGuild: transformUserPrimaryGuild(user.primaryGuild), // UserPrimaryGuild | null
      system: user.system,                       // boolean
      tag: user.tag,                             // string
      username: user.username,                   // string
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

const transformRole = (role: any) => ({
  color: role.color,                             // ColorResolvable
  // Enhanced Role Styles (gradient/holographic) — Discord ENHANCED_ROLE_COLORS feature
  ...(role.colors && {
    colors: {
      primaryColor: role.colors.primaryColor,
      secondaryColor: role.colors.secondaryColor ?? null,
      tertiaryColor: role.colors.tertiaryColor ?? null,
    },
  }),
  createdAt: role.createdAt,                     // Date
  createdTimestamp: role.createdTimestamp,        // number
  deletable: role.deletable,                     // boolean
  // guild: role.guild,                          // Guild
  guildId: role.guildId,                         // Snowflake
  hoist: role.hoist,                             // boolean
  id: role.id,                                   // Snowflake
  managed: role.managed,                         // boolean
  name: role.name,                               // string
  position: role.position,                       // number
  flags: role.flags,                             // RoleFlagsBitField
  permissions: role.permissions,                 // PermissionsBitField
  mentionable: role.mentionable,                 // boolean
  mention: role.mention,                         // string
  hexColor: role.hexColor,                       // string
  iconURL: role.iconURL(),                       // string
  url: role.url,                                 // string
});

const transformAttachment = (attachment: any) => {
  if (attachment) {
    return {
      contentType: attachment.contentType,       // string | null
      description: attachment.description,       // string | null
      duration: attachment.duration,             // number | null
      ephemeral: attachment.ephemeral,           // boolean
      flags: attachment.flags,                   // AttachmentFlagsBitField
      height: attachment.height,                 // number | null
      id: attachment.id,                         // Snowflake
      name: attachment.name,                     // string
      proxyURL: attachment.proxyURL,             // string
      size: attachment.size,                     // number
      spoiler: attachment.spoiler,               // boolean
      title: attachment.title,                   // string | null
      url: attachment.url,                       // string
      waveform: attachment.waveform,             // string | null (base64)
      width: attachment.width,                   // number | null
    };
  }
};

const transformTextChannel = (channel: any, _concise: any = false) => {
  if (channel) {
    const textChannel = {
      // client: channel.client,                  // Client<true>
      createdAt: channel.createdAt,               // Date
      createdTimestamp: channel.createdTimestamp,  // number
      defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration, // ThreadAutoArchiveDuration?
      defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser, // number | null
      deletable: channel.deletable,               // boolean
      flags: channel.flags,                       // ChannelFlagsBitField
      guild: transformGuild(channel.guild, true), // Guild
      guildId: channel.guildId,                   // Snowflake
      id: channel.id,                             // Snowflake
      // lastMessage: channel.lastMessage,        // Message?
      lastMessageId: channel.lastMessageId,       // Snowflake?
      lastPinAt: channel.lastPinAt,               // Date?
      lastPinTimestamp: channel.lastPinTimestamp,  // number?
      manageable: channel.manageable,             // boolean
      // members: channel.members,                // Collection<Snowflake, GuildMember>
      // messages: channel.messages,              // GuildMessageManager
      name: channel.name,                         // string
      nsfw: channel.nsfw,                         // boolean
      // parent: channel.parent,                  // CategoryChannel | null
      parentId: channel.parentId,                 // Snowflake | null
      parentName: channel.parent?.name || null,   // Category name (resolved)
      partial: channel.partial,                   // false
      // permissionOverwrites: channel.permissionOverwrites, // PermissionOverwriteManager
      permissionsLocked: channel.permissionsLocked, // boolean | null
      position: channel.position,                 // number
      rateLimitPerUser: channel.rateLimitPerUser,  // number
      rawPosition: channel.rawPosition,           // number
      // threads: channel.threads,                // GuildTextThreadManager
      topic: channel.topic,                       // string | null
      type: channel.type,                         // boolean
      url: channel.url,                           // string
      viewable: channel.viewable,                 // boolean
    };
    return textChannel;
  }
};

const transformEmbeds = (embeds: any) => {
  return embeds.map((embed: any) => ({
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

const transformGuild = (guild: any, _concise: any = false) => {
  if (guild) {
    return {
      id: guild.id,
      name: guild.name,
      // Persist icon/banner/splash hashes so downstream consumers can
      // reconstruct CDN URLs without the live Discord.js client.
      ...(guild.icon && { icon: guild.icon }),
      ...(guild.banner && { banner: guild.banner }),
      ...(guild.splash && { splash: guild.splash }),
    };
  }
};


const transformPoll = (poll: any) => {
  if (poll) {
    return {
      allowMultiselect: poll.allowMultiselect,    // boolean
      answers: poll.answers.map((answer: any) => ({    // Collection<number, PollAnswer>
        // client: answer.client,
        emoji: transformEmoji(answer.emoji, true),
        id: answer.id,                            // number
        partial: answer.partial,                  // false
        // poll: answer.poll,                     // Poll (parent)
        text: answer.text,                        // string | null
        voteCount: answer.voteCount,              // number
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

const transformMessageMentions = (mentions: any) => {
  if (mentions) {
    // MessageMentions<InGuild>
    return {
      channels: mentions.channels.size
        ? mentions.channels.map((channel: any) =>
            transformTextChannel(channel, true),
          )
        : [],
      // client: transformClient(mentions.client),
      everyone: mentions.everyone,                // boolean
      guild: transformGuild(mentions.guild, true),
      members: mentions.members?.size
        ? mentions.members.map((member: any) => transformMember(member, true))
        : [],
      parsedUsers: mentions.parsedUsers.size
        ? mentions.parsedUsers.map((user: any) => transformUser(user, true))
        : [],
      roles: mentions.roles.size
        ? mentions.roles.map((role: any) => transformRole(role))
        : [],
      users: mentions.users.size
        ? mentions.users.map((user: any) => transformUser(user, true))
        : [],
    };
  }
};

const transformMessageSnapshot = (messageSnapshot: any) => {
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

const transformActivity = (activity: any) => {
  if (activity) {
    return {
      name: activity.name,
      state: activity.state,
      type: activity.type,
      url: activity.url,
    };
  }
};

const transformPresence = (presence: any): Record<string, any> | undefined => {
  if (presence) {
    return {
      activities: presence.activities.map((activity: any) =>
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

const transformVoice = (voice: any) => {
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

const transformMember = (member: any, concise: any = false): Record<string, any> | undefined => {
  if (member) {
    // Build Enhanced Role Colors for gradient/holographic support.
    // member.roles.color is the highest role with a non-zero color.
    const colorRole = member.roles?.color;
    let roleColorsData = null;
    if (colorRole?.colors?.primaryColor) {
      const { primaryColor, secondaryColor, tertiaryColor } = colorRole.colors;
      // Only include the object when there's actually a gradient/holographic style
      if (secondaryColor || tertiaryColor) {
        roleColorsData = {
          primary: `#${primaryColor.toString(16).padStart(6, "0")}`,
          secondary: secondaryColor
            ? `#${secondaryColor.toString(16).padStart(6, "0")}`
            : null,
          tertiary: tertiaryColor
            ? `#${tertiaryColor.toString(16).padStart(6, "0")}`
            : null,
        };
      }
    }

    if (concise) {
      return {
        id: member.id,
        displayName: member.displayName,
        displayHexColor: member.displayHexColor,
        nickname: member.nickname,
        joinedAt: member.joinedAt,
        joinedTimestamp: member.joinedTimestamp,
        avatar: member.avatar || null,
        // Enhanced Role Styles — gradient (secondary) / holographic (tertiary)
        ...(roleColorsData && { roleColors: roleColorsData }),
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
      roles: member.roles.cache.map((role: any) => transformRole(role)),
      user: transformUser(member.user, true),
      voice: transformVoice(member.voice),
    };
  }
};

const transformEmoji = (emoji: any, _concise: any = false) => {
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

const transformReaction = (reaction: any) => {
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
      users: reaction.users.cache.map((user: any) => transformUser(user, true)),
    };
  }
};

const transformSticker = (sticker: any) => ({
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

const transformMessageRoot = (message: any): Record<string, any> => {
  return {
    // MessageActivity | null
    activity: message.activity,
    // Snowflake | null
    applicationId: message.applicationId,
    attachments: message.attachments.map((attachment: any) =>
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
    messageSnapshots: message.messageSnapshots?.map((snapshot: any) =>
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
    reactions: message.reactions.cache.map((reaction: any) =>
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
    stickers: message.stickers?.map((sticker: any) => transformSticker(sticker)),
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
  async fetchAndSaveAllServerMessages(client: any, mongo: any, guildId: any, options: Record<string, any> = {}) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 10,
      resumePoints = null, // Array of { channelId, lastMessageId } — explicit overrides
      batchSize = 100, // Messages per Discord API call (max 100)
      dateLimit = "2025-11-01", // Stop when messages are older than this date
      categoryIds = null, // Array of category (parent) IDs to limit which channels are processed
      channelIds = null, // Array of specific channel IDs to process (takes precedence over categoryIds)
      forceUpdate = false, // When true, overwrite existing documents entirely (for rescraping)
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
    } catch (indexError: any) {
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
      resumePoints.forEach((point: any) => {
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
      (channel: any) => channel.type === ChannelType.GuildText,
    );

    // Filter by specific channel IDs if provided (takes precedence)
    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      textChannels = textChannels.filter(
        (channel: any) => channelIds.includes(channel.id),
      );
      console.log(
        `[CHANNELS] Filtering to ${channelIds.length} specific channel(s) — ${textChannels.size} matched`,
      );
    }
    // Otherwise filter by category IDs if provided
    else if (categoryIds && Array.isArray(categoryIds) && categoryIds.length > 0) {
      textChannels = textChannels.filter(
        (channel: any) => channel.parentId && categoryIds.includes(channel.parentId),
      );
      console.log(
        `[CATEGORIES] Filtering to ${categoryIds.length} category/ies — ${textChannels.size} channel(s) matched`,
      );
    }

    // If explicit resumePoints provided, only process those channels
    if (resumePoints && resumeMap.size > 0) {
      textChannels = textChannels.filter((channel: any) =>
        resumeMap.has(channel.id),
      );
      console.log(
        `[CHANNELS] Will resume ${resumeMap.size} channel(s) from their last position`,
      );
    }

    // Skip channels completed in a previous run
    if (completedChannelIds.size > 0) {
      textChannels = textChannels.filter(
        (channel: any) => !completedChannelIds.has(channel.id),
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
    const bulkSaveNewMessages = async (messages: any) => {
      if (!messages || messages.length === 0) {
        return { saved: 0, duplicates: 0, errors: 0 } as Record<string, any>;
      }

      const documents: any[] = [];
      let transformErrorCount = 0;

      for (const message of messages) {
        try {
          const document = transformMessageRoot(message);

          // Archive media to MinIO (content-addressable, deduped by SHA-256)
          if (MediaArchivalService.isAvailable()) {
            try {
              const archiveMap = await MediaArchivalService.archiveMessageMedia(message);
              if (Object.keys(archiveMap).length > 0) {
                document.mediaArchive = archiveMap;
                MediaArchivalService.rewriteDocumentUrls(document, archiveMap);
              }
            } catch (archiveErr: any) {
              console.warn(`  [ARCHIVE] Media archival failed for ${message.id}: ${archiveErr.message}`);
            }
          }

          documents.push(document);
        } catch (transformError: any) {
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
        const bulkOps = documents.map((document: any) => {
          // Force update mode: overwrite entire document (for rescraping)
          if (forceUpdate) {
            return {
              updateOne: {
                filter: { id: document.id },
                update: { $set: document },
                upsert: true,
              },
            };
          }

          // Normal mode: only insert new, backfill dynamic fields on existing
          const backfill = {
            // Reactions, embeds, attachments, and content can all change
            // after initial scrape — always update to latest values.
            reactions: document.reactions,
            embeds: document.embeds,
            attachments: document.attachments,
            content: document.content,
            cleanContent: document.cleanContent,
            editedAt: document.editedAt,
            editedTimestamp: document.editedTimestamp,
            pinned: document.pinned,
            "member.displayHexColor": document.member?.displayHexColor || null,
            "member.displayName": document.member?.displayName || null,
            "member.avatar": document.member?.avatar || null,
            // Enhanced Role Styles (gradient/holographic) — always update to latest
            ...(document.member?.roleColors
              ? { "member.roleColors": document.member.roleColors }
              : { "member.roleColors": null }),
          };

          // Clone for $setOnInsert and strip backfill paths to avoid conflict
          const insertDoc = { ...document };
          delete insertDoc.reactions;
          delete insertDoc.embeds;
          delete insertDoc.attachments;
          delete insertDoc.content;
          delete insertDoc.cleanContent;
          delete insertDoc.editedAt;
          delete insertDoc.editedTimestamp;
          delete insertDoc.pinned;
          if (insertDoc.member) {
            const { displayHexColor: _dhc, displayName: _dn, avatar: _av, roleColors: _rc, ...restMember } = insertDoc.member;
            insertDoc.member = restMember;
          }

          return {
            updateOne: {
              filter: { id: document.id },
              update: {
                $setOnInsert: insertDoc,
                $set: backfill,
              },
              upsert: true,
            },
          };
        });

        const result = await collection.bulkWrite(bulkOps, { ordered: false });

        // When forceUpdate is true, matchedCount = docs that existed and were
        // updated via $set. modifiedCount = subset that actually changed.
        // Report modified docs as "saved" so the progress log is accurate.
        const updated = forceUpdate ? (result.modifiedCount || 0) : 0;

        return {
          saved: result.upsertedCount + updated,
          duplicates: (result.matchedCount || 0) - updated,
          errors: transformErrorCount,
        };
      } catch (error: any) {
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
    const createConcurrencyLimiter = (limit: any) => {
      let activeCount = 0;
      const queue: any[] = [];

      const run = async (fn: any) => {
        while (activeCount >= limit) {
          await new Promise((resolve: any) => queue.push(resolve));
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
    const processChannel = async (channel: any) => {
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
          const fetchOptions: Record<string, any> = { limit: batchSize, cache: false };
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
          for (const message of messages.values()) {
            if (CLEANUP_USER_IDS.includes(message.author?.id)) {
              discordUserMessageIds.add(message.id);
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
        } catch (fetchError: any) {
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
        } catch (writeError: any) {
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
            .filter((document: any) => !discordUserMessageIds.has(document.id))
            .map((document: any) => document.id);

          if (orphanIds.length > 0) {
            const deleteResult = await collection.deleteMany({
              id: { $in: orphanIds },
            });
            console.log(
              `  [CLEANUP] #${channel.name}: Removed ${deleteResult.deletedCount} orphaned message(s) from tracked users`,
            );
          }
        } catch (cleanupErr: any) {
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
    const channelPromises: any[] = [];
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
   */
  async purgeDeletedMessagesForUsers(client: any, mongo: any, guildId: any, userIds: any, options: Record<string, any> = {}) {
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
    for (const document of mongoMessages) {
      byChannel.getOrInsert(document.channelId, []).push(document.id);
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

      const orphanIds: any[] = [];

      // Process in concurrency-limited chunks
      for (let i = 0; i < messageIds.length; i += concurrencyLimit) {
        const chunk = messageIds.slice(i, i + concurrencyLimit);
        const results = await Promise.allSettled(
          chunk.map(async (msgId: any) => {
            try {
              await channel.messages.fetch(msgId);
              return { exists: true, id: msgId };
            } catch (error: any) {
              // 10008 = Unknown Message (deleted)
              if (error.code === 10008) {
                return { exists: false, id: msgId };
              }
              // Other errors (permissions, rate limit) — don't assume deleted
              throw error;
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
   */
  async backfillMediaArchive(client: any, mongo: any, options: Record<string, any> = {}) {
    const {
      collectionName = "Messages",
      authorIds = null,
      guildId = null,
      channelId = null,
      forceRetry = false,
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
    const archiveConditions: Record<string, any>[] = [
      { mediaArchive: { $exists: false } },
    ];
    // forceRetry: also re-process messages that were previously marked
    // with empty mediaArchive (e.g. URLs were expired during prior attempts)
    if (forceRetry) {
      archiveConditions.push({ mediaArchive: { $eq: {} } });
    }

    const query: Record<string, any> = {
      $and: [
        { $or: archiveConditions },
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
    if (channelId) query.channelId = channelId;

    const totalCount = await collection.countDocuments(query);
    console.log(`[BACKFILL] Found ${totalCount} message(s) needing media archival`);
    if (totalCount === 0) return { processed: 0, archived: 0, errors: 0 };

    // Load all docs, group by channel
    const docs = await collection.find(query).batchSize(batchSize).toArray();
    const byChannel = new Map();
    for (const document of docs) {
      byChannel.getOrInsert(document.channelId, []).push(document);
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
        for (const document of channelDocs) {
          await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
          processed++;
        }
        continue;
      }

      for (const document of channelDocs) {
        processed++;

        try {
          // Fetch the live message from Discord to get fresh CDN URLs
          let liveMessage: any;
          try {
            liveMessage = await channel.messages.fetch(document.id);
          } catch (fetchErr: any) {
            if (fetchErr.code === 10008) {
              // Message was deleted — mark and skip
              console.log(`  [BACKFILL] Message ${document.id} deleted from Discord — marking empty`);
              await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
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
              { _id: document._id },
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
            await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
          }

          if (processed % 25 === 0) {
            console.log(`  [BACKFILL] Progress: ${processed}/${totalCount} processed, ${archived} archived`);
          }
        } catch (error: any) {
          errors++;
          console.error(`  [BACKFILL] Error processing message ${document.id}: ${error.message}`);
          // Mark failed so we don't retry on next run (can be cleared manually)
          await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[BACKFILL] Complete — processed: ${processed}, archived: ${archived}, errors: ${errors} (${duration}s)`);

    return { processed, archived, errors };
  },
  async deleteDuplicateMessagesByID(mongo: any, collectionName: any = "Messages") {
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


   */
  _sanitizeUsername(name: any) {
    if (!name) return "default";
    return name.replace(/\s+/g, "_").replace(/[^\w]/gi, "") || "default";
  },
  getUsernameNoSpaces(message: any) {
    const name =
      message?.author?.displayName ||
      message?.author?.username ||
      message?.user?.username;
    return DiscordUtilityService._sanitizeUsername(name);
  },

  async saveMessageToMongo(message: any, mongo: any, collectionName: any = "Messages") {
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
      } catch (error: any) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${error.message}`);
      }
    }

    // Dynamic fields that can change over a message's lifetime.
    // These use $set so they stay current even if the document already exists.
    const dynamicFields = {
      reactions: messageObject.reactions,
      embeds: messageObject.embeds,
      attachments: messageObject.attachments,
      content: messageObject.content,
      cleanContent: messageObject.cleanContent,
      editedAt: messageObject.editedAt,
      editedTimestamp: messageObject.editedTimestamp,
      pinned: messageObject.pinned,
      member: messageObject.member,
    };

    // Clone for $setOnInsert and strip dynamic paths to avoid conflict
    const insertDoc = { ...messageObject };
    for (const key of Object.keys(dynamicFields)) {
      delete insertDoc[key];
    }

    await collection.updateOne(
      { id: messageObject.id },
      {
        $setOnInsert: insertDoc,
        $set: dynamicFields,
      },
      { upsert: true },
    );
  },
  async updateMessageInMongo(message: any, mongo: any, collectionName: any = "Messages") {
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
      } catch (error: any) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${error.message}`);
      }
    }

    await collection.updateOne(
      { id: messageObject.id },
      { $set: messageObject },
      { upsert: false },
    );
  },
  /**
   * Sync only the reactions field for a message to MongoDB.
   * Called from Discord reaction add/remove event handlers.
   */
  async syncReactionsToMongo(reactionMessage: any, mongo: any, collectionName: any = "Messages") {
    try {
      const db = mongo.db(MONGO_DB_NAME);
      const collection = db.collection(collectionName);
      const transformedReactions = reactionMessage.reactions.cache.map((r: any) =>
        transformReaction(r),
      );
      await collection.updateOne(
        { id: reactionMessage.id },
        { $set: { reactions: transformedReactions } },
      );
    } catch (error: any) {
      console.warn(`[syncReactionsToMongo] Failed for message ${reactionMessage.id}: ${error.message}`);
    }
  },

  async extractAudioUrlsFromMessage(message: any) {
    const audioUrls: any[] = [];
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
  async extractImageUrlsFromMessage(message: any) {
    const imageUrls: any[] = [];
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
  async retrieveMessageReferenceFromMessage(message: any) {
    let messageReference: any;
    if (message?.reference && message.reference.messageId) {
      messageReference = message.channel.messages.cache.get(
        message.reference.messageId,
      );
      if (!messageReference) {
        try {
          messageReference = await message.channel.messages.fetch(
            message.reference.messageId,
          );
        } catch (error: any) {
          console.error("Error fetching message reference:", error);
        }
      }
    }
    return messageReference;
  },
  getDisplayNameFromUserOrMember({ user, member }: any) {
    let displayName: any;
    if (user || member) {
      displayName = user?.displayName || member?.displayName;
    }
    return displayName;
  },
  getCleanUsernameFromUser(user: any) {
    // Replaces periods/hashes with underscores first, then delegates to shared sanitizer
    const raw = user?.username?.replace(/[.#]/g, "_");
    return DiscordUtilityService._sanitizeUsername(raw);
  },
  async getDisplayName(message: any, userId: any) {
    let displayName: any;
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
  getNameFromUser(user: any) {
    return user?.displayName || user?.globalName || user?.username || undefined;
  },
  getUserMentionFromMessage(message: any) {
    if (message) {
      // Find out why author and why user are different
      const userId = message?.author?.id || message?.user?.id;
      return `<@${userId}>`;
    }
  },
  getDiscordTagFromMessage(message: any) {
    if (message) {
      const userTag = message?.author?.tag || message?.user?.tag;
      return userTag;
    }
  },
  async printOutAllRoles(client: any) {
    // print out all roles in the order that they are in the server
    consoleLog("<", "printOutAllRoles");
    const roles = client.guilds.cache.get(config.GUILD_ID_PRIMARY).roles.cache;
    const orderedRoles = roles
      .sort((a: any, b: any) => a.rawPosition - b.rawPosition)
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
  async printOutAllEmojis(client: any) {
    consoleLog("<", "printOutAllEmojis");
    const emojis = client.guilds.cache.get(config.GUILD_ID_PRIMARY).emojis
      .cache;
    consoleLog("=", `Printing out all emojis in the server`);
    for (const emoji of emojis.values()) {
      console.log(`${emoji.name} - ${emoji.id}`);
    }
    consoleLog(">", "printOutAllEmojis");
  },
  async retrieveMemberFromGuildById(guild: any, userId: any) {
    if (guild && userId) {
      let member = guild.members.cache.get(userId);
      if (!member) {
        try {
          member = await guild.members.fetch(userId);
        } catch {

          return null;
        }
      }
      return member;
    }
  },
  // Canonical user-fetch: cache → fetch with optional force
  async getUserFromClientAndId(client: any, userId: any, force: any = false) {
    let user = client.users.cache.get(userId);
    if (!user) {
      try {
        user = await client.users.fetch(userId, { force });
      } catch (error: any) {
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
  async retrieveUserFromClientAndUserId(client: any, userId: any) {
    return DiscordUtilityService.getUserFromClientAndId(client, userId);
  },
  // Sync cache-only lookup (no fetch)
  getUserByClientAndId(client: any, userId: any) {
    return client.users.cache.get(userId);
  },
  // Convenience wrapper for message context
  async getUserFromMessage(message: any, force: any = false) {
    return DiscordUtilityService.getUserFromClientAndId(
      message.client,
      message.author.id,
      force,
    );
  },
  // Event Handlers
  onEventClientReady(client: any, options: any, customFunction: any) {
    return client.on(Events.ClientReady, async () => {
      customFunction(client, options);
    });
  },
  onEventMessageCreate(client: any, { mongo, localMongo }: any, customFunction: any) {
    return client.on(Events.MessageCreate, async (message: any) => {
      customFunction(client, { mongo, localMongo }, message);
    });
  },
  onEventMessageUpdate(client: any, { mongo, localMongo }: any, customFunction: any) {
    return client.on(Events.MessageUpdate, async (oldMessage: any, newMessage: any) => {
      customFunction(client, { mongo, localMongo }, oldMessage, newMessage);
    });
  },
  onEventMessageDelete(client: any, mongo: any, customFunction: any) {
    return client.on(Events.MessageDelete, async (message: any) => {
      customFunction(client, mongo, message);
    });
  },
  onEventMessageReactionAdd(client: any, mongo: any, customFunction: any) {
    return client.on(Events.MessageReactionAdd, async (reaction: any, user: any) => {
      customFunction(client, mongo, reaction, user);
    });
  },
  onEventMessageReactionRemove(client: any, mongo: any, customFunction: any) {
    return client.on(Events.MessageReactionRemove, async (reaction: any, user: any) => {
      customFunction(client, mongo, reaction, user);
    });
  },
  onEventGuildMemberAdd(client: any, mongo: any, customFunction: any) {
    return client.on(Events.GuildMemberAdd, async (member: any) => {
      customFunction(client, mongo, member);
    });
  },
  onEventGuildMemberAvailable(client: any, mongo: any, customFunction: any) {
    return client.on(Events.GuildMemberAvailable, async (member: any) => {
      customFunction(client, mongo, member);
    });
  },
  onEventInteractionCreate(client: any, mongo: any, customFunction: any) {
    return client.on(Events.InteractionCreate, async (interaction: any) => {
      customFunction(client, mongo, interaction);
    });
  },
  onEventPresenceUpdate(client: any, customFunction: any) {
    return client.on(
      Events.PresenceUpdate,
      async (oldPresence: any, newPresence: any) => {
        customFunction(client, oldPresence, newPresence);
      },
    );
  },
  onEventVoiceStateUpdate(client: any, mongo: any, customFunction: any) {
    return client.on(Events.VoiceStateUpdate, async (oldState: any, newState: any) => {
      customFunction(client, mongo, oldState, newState);
    });
  },
  onEventGuildMemberRemove(client: any, mongo: any, customFunction: any) {
    return client.on(Events.GuildMemberRemove, async (member: any) => {
      customFunction(client, mongo, member);
    });
  },
  onEventGuildMemberUpdate(client: any, mongo: any, customFunction: any) {
    return client.on(Events.GuildMemberUpdate, async (oldMember: any, newMember: any) => {
      customFunction(client, mongo, oldMember, newMember);
    });
  },
  async getAllServerEmojisFromMessage(message: any, format: any = "string") {
    // format can be: array, string
    if (message.guild.emojis.cache.size) {
      const emojis = message.guild.emojis.cache.map((emoji: any) => {
        return {
          id: emoji.id,
          name: emoji.name,
          url: emoji.url,
        };
      });
      if (format === "array") {
        return emojis;
      } else if (format === "string") {
        return emojis.map((emoji: any) => `<${emoji.name}:${emoji.id}>`).join(", ");
      }
    } else {
      return [];
    }
  },
  // Special functions
  async fetchMessages(client: any, channelId: any, options: Record<string, any> = {}) {
    const channel = client.channels.cache.find(
      (channel: any) => channel.id == channelId,
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
    const initialFetchOptions: Record<string, any> = {
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

      const fetchOptions: Record<string, any> = {
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
      const uniqueMessages = messages.filter((message: any) => !allMessages.has(message.id));
      allMessages = allMessages.concat(uniqueMessages);

      // Break if no new messages were added (to prevent infinite loops)
      if (uniqueMessages.size === 0) break;
    }


    // Trim collection if we fetched more than needed
    if (allMessages.size > limit) {
      const trimmedCollection = new Collection();
      let count = 0;

      // Maintain message order based on fetch direction
      const messageArray: any[] = Array.from(allMessages.values());
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
  async getOrFetchChannelByChannelId(client: any, channelId: any) {
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await client.channels.fetch(channelId);
      } catch (error: any) {
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
  getBotName(client: any) {
    return client.user.tag;
  },
  setUserActivity(client: any, message: any) {
    return client.user.setActivity(message, { type: ActivityType.Custom });
  },
  // Channel functions
  getChannelById(client: any, channelId: any) {
    return client.channels.cache.get(channelId);
  },
  getChannelName(client: any, channelId: any) {
    return client.channels.cache.get(channelId)?.name;
  },
  // Guilds functions
  getGuildById(client: any, guildId: any) {
    return client.guilds.cache.get(guildId);
  },
  getAllGuilds(client: any) {
    let guildsCollection: any;
    if (client) {
      guildsCollection = client.guilds.cache;
    }
    return guildsCollection;
  },
  getNameFromItem(item: any) {
    return (
      item?.author?.displayName ||
      item?.author?.username ||
      item?.user?.globalName ||
      item?.user?.username
    );
  },
  // REST functions
  async patchBanner(client: any, imageUrl: any) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," + Buffer.from(imageUrl).toString("base64"),
      },
    });
  },
  async patchBannerFromImageUrl(client: any, imageUrl: any) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," +
          Buffer.from(await (await fetch(imageUrl)).bytes()).toString(
            "base64",
          ),
      },
    });
  },
  async getBannerFromUserId(client: any, userId: any) {
    const getUser = await client.rest.get(`/users/${userId}`);
    return getUser.banner;
  },
  // Typing functions
  async startTypingInterval(channel: any) {
    // Fire-and-forget — never await sendTyping(). Its promise can hang
    // indefinitely if discord.js's internal rate limit queue is stuck
    // (e.g., after a Discord API outage). Typing is cosmetic.
    channel.sendTyping().catch((error: any) => {
      console.warn(`⚠️ [startTypingInterval] Initial sendTyping failed: ${error.message}`);
    });
    // Refresh typing every 5s (Discord auto-clears after 10s)
    const sendTypingInterval = setInterval(() => {
      channel.sendTyping().catch((_error: any) => {
        if (sendTypingInterval) {
          clearInterval(sendTypingInterval);
        }
      });
    }, 5000);
    return sendTypingInterval;
  },
  clearTypingInterval(sendTypingInterval: any) {
    if (sendTypingInterval) clearInterval(sendTypingInterval);
    return null;
  },
  // Message functions
  async sendMessageInChunks(
    sendOrReply: any,
    message: any,
    generatedTextResponse: any,
    encodedImageDataBase64: any,
    imagePrompt: any,
  ) {
    const messageChunkSizeLimit = 2000;
    let fileName = "lupos.png";
    let imageDescription = "";
    let returnedFirstMessage: any;

    if (imagePrompt) {
      fileName = `${imagePrompt.substring(0, 240)}.png`;
      imageDescription = imagePrompt.substring(0, 1000);
    }

    // Handle image-only response (agent generated an image but no text)
    if ((!generatedTextResponse || generatedTextResponse.length === 0) && encodedImageDataBase64) {
      // encodedImageDataBase64 may be a Buffer (from agent) or a base64 string (legacy)
      const imageAttachment = Buffer.isBuffer(encodedImageDataBase64)
        ? encodedImageDataBase64
        : Buffer.from(encodedImageDataBase64, "base64");
      const files = [{
        attachment: imageAttachment,
        name: fileName,
        description: imageDescription,
      }];
      if (sendOrReply === "send") {
        return await message.channel.send({ files });
      } else {
        return await message.reply({ files });
      }
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
      const files: any[] = [];


      if (
        encodedImageDataBase64 &&
        i + messageChunkSizeLimit >= generatedTextResponse.length
      ) {
        // encodedImageDataBase64 may be a Buffer (from agent) or a base64 string (legacy)
        const imageAttachment = Buffer.isBuffer(encodedImageDataBase64)
          ? encodedImageDataBase64
          : Buffer.from(encodedImageDataBase64, "base64");
        files.push({
          attachment: imageAttachment,
          name: fileName,
          description: imageDescription,
        });
      }
      messageReplyOptions = { ...messageReplyOptions, files: files } as any;
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
  async displayAllChannelActivity(client: any) {
    const MONTHS_TO_ANALYZE = 36;
    const CONCURRENT_CHANNELS = 10; // Number of channels to process simultaneously
    const periodText =
      (MONTHS_TO_ANALYZE as number) === 1 ? "1 month" : `${MONTHS_TO_ANALYZE} months`;

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

    const channelStats: any[] = [];
    const globalUserStats: Record<string, any> = {};
    const now = TemporalHelpers.now();
    const cutoffDate = TemporalHelpers.minus(now, { months: MONTHS_TO_ANALYZE });
    console.log(`[TIME] Current time: ${TemporalHelpers.nowISO()}`);
    console.log(
      `[TIME] Cutoff date (${periodText} ago): ${cutoffDate.toInstant().toString()}`,
    );

    let processedChannelCount = 0;
    let totalFetchCount = 0;

    // Collect all eligible channels first
    const eligibleChannels: any[] = [];
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
    const processChannel = async (channel: any, channelIndex: any) => {
      const logPrefix = `[CH ${channelIndex}/${eligibleChannelCount}]`;
      console.log(
        `\n${logPrefix} Processing: #${channel.name} (Category: ${channel.parent.name})`,
      );

      try {
        let allMessages: any[] = [];
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

          const messagesArray: any[] = messages ? Array.from(messages.values()) : [];

          if (messagesArray.length === 0) {
            console.log(
              `  ${logPrefix} [FETCH] No messages found, stopping fetch`,
            );
            fetchMore = false;
            break;
          }

          const oldestMessage = messagesArray[messagesArray.length - 1];
          const oldestMessageDateTime = TemporalHelpers.fromMillis(
            oldestMessage.createdTimestamp,
          );
          const newestMessage = messagesArray[0];
          const newestMessageDateTime = TemporalHelpers.fromMillis(
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
            (message: any) =>
              !allMessages.some((existingMsg: any) => existingMsg.id === message.id),
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
            `  ${logPrefix} [FETCH] Date range: ${TemporalHelpers.format(newestMessageDateTime, "yyyy-MM-dd HH:mm:ss")} to ${TemporalHelpers.format(oldestMessageDateTime, "yyyy-MM-dd HH:mm:ss")}`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Oldest message ID: ${oldestMessage.id}`,
          );

          if (TemporalHelpers.toEpochMs(oldestMessageDateTime) < TemporalHelpers.toEpochMs(cutoffDate)) {
            console.log(
              `  ${logPrefix} [FETCH] Reached messages older than ${periodText} (${TemporalHelpers.format(oldestMessageDateTime, "yyyy-MM-dd")} < ${TemporalHelpers.format(cutoffDate, "yyyy-MM-dd")})`,
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

          await new Promise((resolve: any) => setTimeout(resolve, 100));
        }

        console.log(
          `  ${logPrefix} [FETCH] Total fetches for this channel: ${channelFetchCount}`,
        );
        console.log(
          `  ${logPrefix} [PROCESS] Filtering messages from the last ${periodText}...`,
        );

        const messagesInPeriod = allMessages.filter(
          (message: any) =>
            TemporalHelpers.toEpochMs(TemporalHelpers.fromMillis(message.createdTimestamp)) > TemporalHelpers.toEpochMs(cutoffDate),
        );
        console.log(
          `  ${logPrefix} [PROCESS] Found ${messagesInPeriod.length} messages in the last ${periodText} (out of ${allMessages.length} total fetched)`,
        );

        const userMessageCount: Record<string, any> = {};
        const localUserStats: Record<string, any> = {}; // Collect locally first to avoid race conditions

        messagesInPeriod.forEach((message: any) => {
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
          .sort((a: any, b: any) => b[1].count - a[1].count)
          .slice(0, 20)
          .map(([_userId, data]: any) => ({
            username: data.username,
            count: data.count,
          }));

        if (sortedUsers.length > 0) {
          console.log(`  ${logPrefix} [TOP USERS] Top contributors:`);
          sortedUsers.forEach((user: any, index: any) => {
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
          const oldestDateTime = TemporalHelpers.fromMillis(
            oldestRecentMessage.createdTimestamp,
          );
          const newestDateTime = TemporalHelpers.fromMillis(
            newestMessage.createdTimestamp,
          );
          const daySpan = Math.max(
            1,
            TemporalHelpers.diffIn(newestDateTime, oldestDateTime, "days"),
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
            `  ${logPrefix} [METRICS] Last message: ${TemporalHelpers.format(lastMessageDate, "yyyy-MM-dd HH:mm")}`,
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
      } catch (error: any) {
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
    const results: any[] = [];
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

      const batchPromises = batch.map((channel: any, batchIndex: any) =>
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
        for (const [userId, data] of Object.entries(result.localUserStats) as [string, any][]) {
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
      (a: any, b: any) => b.averageMessagesPerDay - a.averageMessagesPerDay,
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

    channelStats.forEach((stat: any, index: any) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const avgPerDay = stat.averageMessagesPerDay.toFixed(2).padStart(7, " ");
      const messageCount = stat.messageCount.toString().padStart(8, " ");
      const uniqueUsers = stat.uniqueUsers.toString().padStart(5, " ");

      let daysSinceLastMessage = "N/A";
      if (stat.lastMessageDate) {
        const daysDiff = TemporalHelpers.diffIn(now, stat.lastMessageDate, "days");
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
          .map((user: any, index: any) => `${index + 1}. ${user.username} (${user.count})`)
          .join(", ");
      } else {
        topUsersStr = "No activity";
      }

      console.log(
        `${rank} | ${avgPerDay} | ${messageCount} | ${uniqueUsers} | ${daysSinceLastMessage} | ${category} | ${channelName} | ${topUsersStr}`,
      );
    });

    const totalMessages = channelStats.reduce(
      (sum: any, stat: any) => sum + stat.messageCount,
      0,
    );
    const activeChannels = channelStats.filter(
      (stat: any) => stat.messageCount > 0,
    ).length;
    const inactiveChannels = channelStats.filter(
      (stat: any) => stat.messageCount === 0,
    ).length;
    const totalUniqueUsers = Object.keys(globalUserStats).length;

    const mostActiveByAverage = channelStats[0];

    const topTenUsers = Object.entries(globalUserStats)
      .sort((a: any, b: any) => b[1].totalMessages - a[1].totalMessages)
      .slice(0, 10)
      .map(([_userId, data]: any) => ({
        username: data.username,
        totalMessages: data.totalMessages,
        channelCount: data.channels.size,
      }));

    const endTime = Date.now();
    const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const totalTimeMinutes = (Number(totalTimeSeconds) / 60).toFixed(2);

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

    topTenUsers.forEach((user: any, index: any) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const username = user.username.substring(0, 23).padEnd(23, " ");
      const totalMessages = user.totalMessages.toString().padStart(14, " ");
      const channelCount = user.channelCount.toString().padStart(15, " ");

      console.log(`${rank} | ${username} | ${totalMessages} | ${channelCount}`);
    });

    console.log("\n[END] Channel activity analysis complete!");
    consoleLog(">", "displayAllChannelActivity");
  },
  async calculateMessagesSentOnAveragePerDayInChannel(client: any, channelId: any) {
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
    } catch (error: any) {
      console.log(
        `Error fetching messages from channel ${channel.name}: ${error.message}`,
      );
      return;
    }

    const daysSinceStart = Math.max(
      1,
      Math.ceil((now - (lastMessageDate?.getTime() || now)) / MS_PER_DAY),
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
  async addRoleToMember(member: any, roleId: any) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: any) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        !member.roles.cache.some((role: any) => role.id === roleId)
      ) {
        await member.roles.add(role);
        console.log(...LogFormatter.roleAdded(member, role));
      }
    } catch (error: any) {
      console.error(
        ...LogFormatter.roleFailedToAdd(member.user.id, role, error.message),
      );
    }
  },
  async removeRoleFromMember(member: any, roleId: any) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: any) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        member.roles.cache.some((role: any) => role.id === roleId)
      ) {
        await member.roles.remove(role);
        console.log(...LogFormatter.roleRemoved(member, role));
      }
    } catch (error: any) {
      console.error(
        ...LogFormatter.roleFailedToRemove(member.user.id, role, error.message),
      );
    }
  },
  async setUserStatus(client: any, status: any) {
    try {
      await client.user.setStatus(status);
      console.log(`Set bot status to ${status}`);
    } catch (error: any) {
      console.error(`Failed to set bot status to ${status}:`, error.message);
    }
  },
};

export default DiscordUtilityService;
