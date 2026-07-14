import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import utilities from "#root/utilities.js";
const { consoleLog } = utilities;
import config from "#root/config.js";
import { Collection, ChannelType, Events, ActivityType } from "discord.js";
import { MILLISECONDS_PER_DAY, MONGO_DB_NAME, EXCLUDE_SOFT_DELETED } from "#root/constants.js";
import ScraperService from "#root/services/ScraperService.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import MediaArchivalService from "#root/services/MediaArchivalService.js";
import {
  Message, Guild, User, Client, TextChannel, GuildEmoji, MessageReaction,
  PartialMessageReaction, Presence, VoiceState, Interaction, GuildMember,
  PartialGuildMember, PartialMessage, Role, Attachment, PresenceStatusData,
  Embed, Poll, PollAnswer, Activity, Sticker, MessageMentions, UserPrimaryGuild,
  type Channel, type GuildBasedChannel, type AnyThreadChannel,
} from "discord.js";
import type { MongoError } from "mongodb";

// ─── Utility ────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown thrown value. */
const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Extract a stack trace from an unknown thrown value. */
const errorStack = (err: unknown): string | undefined =>
  err instanceof Error ? err.stack : undefined;

// ─── Transformed-shape interfaces ───────────────────────────────

interface TransformedUserPrimaryGuild {
  badge: string | null | undefined;
  identityEnabled: boolean | null | undefined;
  identityGuildId: string | null | undefined;
  tag: string | null | undefined;
}

interface TransformedUserConcise {
  displayName: string;
  globalName: string | null;
  id: string;
  tag: string;
  username: string;
}

interface TransformedUserFull extends TransformedUserConcise {
  accentColor: number | null | undefined;
  avatar: string | null;
  avatarDecorationData: import("discord.js").AvatarDecorationData | null;
  banner: string | null | undefined;
  bot: boolean;
  createdAt: Date;
  createdTimestamp: number;
  defaultAvatarURL: string;
  discriminator: string;
  dmChannel: import("discord.js").DMChannel | null;
  flags: import("discord.js").UserFlagsBitField | null;
  hexAccentColor: string | null | undefined;
  partial: false;
  primaryGuild: TransformedUserPrimaryGuild;
  system: boolean;
}

type TransformedUser = TransformedUserFull | TransformedUserConcise;

interface TransformedRole {
  color: number;
  colors?: {
    primaryColor: number;
    secondaryColor: number | null;
    tertiaryColor: number | null;
  };
  createdAt: Date;
  createdTimestamp: number;
  deletable: boolean | undefined;
  guildId: string | undefined;
  hoist: boolean;
  id: string;
  managed: boolean;
  name: string;
  position: number;
  flags: import("discord.js").RoleFlagsBitField;
  permissions: import("discord.js").PermissionsBitField;
  mentionable: boolean;
  mention: string | undefined;
  hexColor: string;
  iconURL: string | null;
  url: string | undefined;
}

interface TransformedAttachment {
  contentType: string | null;
  description: string | null;
  duration: number | null;
  ephemeral: boolean;
  flags: import("discord.js").AttachmentFlagsBitField;
  height: number | null;
  id: string;
  name: string;
  proxyURL: string;
  size: number;
  spoiler: boolean;
  title: string | null;
  url: string;
  waveform: string | null;
  width: number | null;
}

interface TransformedGuild {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  splash?: string;
}

interface TransformedActivity {
  name: string;
  state: string | null;
  type: import("discord.js").ActivityType;
  url: string | null;
}

interface TransformedPresence {
  activities: (TransformedActivity | undefined)[];
  clientStatus: import("discord.js").ClientPresenceStatusData | null;
  guild: TransformedGuild | undefined;
  member: TransformedMember | undefined;
  status: import("discord.js").PresenceStatus;
  user: TransformedUser | undefined;
  userId: string;
}

interface TransformedVoice {
  channel: TransformedTextChannel | null;
  channelId: string | null;
  deaf: boolean | null;
  guild: TransformedGuild | undefined;
  mute: boolean | null;
  requestToSpeakTimestamp: number | null;
  selfDeaf: boolean | null;
  selfMute: boolean | null;
  selfVideo: boolean | null;
  serverDeaf: boolean | null;
  serverMute: boolean | null;
  sessionId: string | null;
  streaming: boolean | null;
  suppress: boolean | null;
}

interface TransformedMemberConcise {
  id: string;
  displayName: string;
  displayHexColor: string;
  nickname: string | null;
  joinedAt: Date | null;
  joinedTimestamp: number | null;
  avatar: string | null;
  roleColors?: {
    primary: string;
    secondary: string | null;
    tertiary: string | null;
  };
}

interface TransformedMemberFull extends TransformedMemberConcise {
  avatarDecorationData: import("discord.js").AvatarDecorationData | null;
  bannable: boolean;
  banner: string | null;
  communicationDisabledUntil: Date | null;
  communicationDisabledUntilTimestamp: number | null;
  displayColor: number;
  flags: import("discord.js").GuildMemberFlagsBitField;
  guild: TransformedGuild | undefined;
  kickable: boolean;
  manageable: boolean;
  moderatable: boolean;
  partial: boolean;
  pending: boolean;
  permissions: import("discord.js").PermissionsString[];
  premiumSince: Date | null;
  premiumSinceTimestamp: number | null;
  presence: TransformedPresence | undefined;
  roles: TransformedRole[];
  user: TransformedUser | undefined;
  voice: TransformedVoice | undefined;
}

type TransformedMember = TransformedMemberFull | TransformedMemberConcise;

interface TransformedEmbed {
  author: import("discord.js").EmbedAuthorData | null;
  color: number | null;
  data: import("discord.js").APIEmbed;
  description: string | null;
  fields: import("discord.js").APIEmbedField[];
  footer: import("discord.js").EmbedFooterData | null;
  hexColor: string | null;
  image: import("discord.js").EmbedAssetData | null;
  length: number;
  provider: import("discord.js").APIEmbedProvider | null;
  thumbnail: import("discord.js").EmbedAssetData | null;
  timestamp: string | null;
  title: string | null;
  url: string | null;
  video: import("discord.js").EmbedAssetData | null;
}

interface TransformedEmoji {
  animated: boolean | null;
  createdAt: Date | null;
  createdTimestamp: number | null;
  id: string | null;
  identifier: string;
  name: string | null;
  imageUrl: string | null;
}

interface TransformedReaction {
  count: number | null;
  countDetails: { burst: number; normal: number };
  emoji: TransformedEmoji | undefined;
  users: (TransformedUser | undefined)[];
}

interface TransformedSticker {
  available: boolean | null;
  createdAt: Date;
  createdTimestamp: number;
  description: string | null;
  guild: TransformedGuild | undefined;
  guildId: string | null;
  id: string;
  name: string;
  packId: string | null;
  partial: boolean;
  sortValue: number | null;
  tags: string | null;
  type: import("discord.js").StickerType | null;
  url: string;
  user: TransformedUser | undefined;
}

interface TransformedPoll {
  allowMultiselect: boolean;
  answers: {
    emoji: TransformedEmoji | null;
    id: number;
    partial: boolean;
    text: string | null;
    voteCount: number;
  }[];
  expiresAt: Date | null;
  expiresTimestamp: number | null;
  layoutType: import("discord.js").PollLayoutType;
  question: import("discord.js").PollQuestionMedia;
  resultsFinalized: boolean;
}

interface TransformedTextChannel {
  createdAt: Date | null;
  createdTimestamp: number | null;
  defaultAutoArchiveDuration: import("discord.js").ThreadAutoArchiveDuration | null | undefined;
  defaultThreadRateLimitPerUser: number | null;
  deletable: boolean;
  flags: Readonly<import("discord.js").ChannelFlagsBitField>;
  guild: TransformedGuild | undefined;
  guildId: string;
  id: string;
  lastMessageId: string | null;
  lastPinAt: Date | null;
  lastPinTimestamp: number | null;
  manageable: boolean;
  name: string;
  nsfw: boolean;
  parentId: string | null;
  parentName: string | null;
  partial: false;
  permissionsLocked: boolean | null;
  position: number;
  rateLimitPerUser: number;
  rawPosition: number;
  topic: string | null;
  type: import("discord.js").ChannelType;
  url: string;
  viewable: boolean;
}

interface TransformedMessageMentions {
  channels: (TransformedTextChannel | undefined)[];
  everyone: boolean;
  guild: TransformedGuild | null | undefined;
  members: (TransformedMember | undefined)[];
  parsedUsers: (TransformedUser | undefined)[];
  roles: TransformedRole[];
  users: (TransformedUser | undefined)[];
}

interface TransformedMessageSnapshot {
  id: string | null;
  channelId: string | null;
  author: TransformedUser | undefined;
  content: string | null;
  createdAt: Date | null;
  editedAt: Date | null;
  flags: Readonly<import("discord.js").MessageFlagsBitField>;
  mentions: TransformedMessageMentions | undefined;
}

interface TransformedMessage {
  activity: import("discord.js").MessageActivity | null;
  applicationId: string | null;
  attachments: (TransformedAttachment | undefined)[];
  author: TransformedUser | undefined;
  bulkDeletable: boolean;
  call: import("discord.js").MessageCall | null;
  channel: TransformedTextChannel | undefined;
  channelId: string;
  cleanContent: string;
  components: import("discord.js").TopLevelComponent[];
  content: string;
  createdAt: Date;
  createdTimestamp: number;
  crosspostable: boolean;
  deletable: boolean;
  editable: boolean;
  editedAt: Date | null;
  editedTimestamp: number | null;
  embeds: TransformedEmbed[];
  flags: Readonly<import("discord.js").MessageFlagsBitField>;
  guild: TransformedGuild | undefined;
  guildId: string | null;
  hasThread: boolean;
  id: string;
  interaction: import("discord.js").MessageInteraction | null;
  interactionMetadata: import("discord.js").MessageInteractionMetadata | null;
  member: TransformedMember | undefined;
  mentions: TransformedMessageMentions | undefined;
  messageSnapshots: (TransformedMessageSnapshot | undefined)[] | undefined;
  nonce: number | string | null;
  partial: false;
  pinnable: boolean;
  pinned: boolean;
  poll: TransformedPoll | undefined;
  position: number | null;
  reactions: (TransformedReaction | undefined)[];
  reference: import("discord.js").MessageReference | null;
  roleSubscriptionData: { id: unknown } | null;
  stickers: (TransformedSticker | undefined)[] | undefined;
  system: boolean;
  tts: boolean;
  type: import("discord.js").MessageType;
  url: string;
  webhookId: string | null;
  mediaArchive?: Record<string, unknown>;
  isDeleted?: boolean;
  deletedAt?: Date;
  [key: string]: unknown;
}

/** Represents a channel stat entry from the activity analysis. */
interface ChannelStat {
  channel: TextChannel;
  messageCount: number;
  uniqueUsers: number;
  topUsers: { username: string; count: number }[];
  averageMessagesPerDay: number;
  lastMessageDate: Temporal.ZonedDateTime | null;
  categoryName: string;
}

/** Per-user global stats across all channels. */
interface UserStat {
  username: string;
  totalMessages: number;
  channels: Set<string>;
}

/** Options for MongoDB-backed operations. */
interface MongoConnections {
  mongo: import("mongodb").MongoClient;
  localMongo?: import("mongodb").MongoClient;
}

/** Resume point for message scraping. */
interface ResumePoint {
  channelId: string;
  lastMessageId: string;
}

/** Options for fetchAndSaveAllServerMessages */
interface FetchAndSaveOptions {
  collectionName?: string;
  concurrencyLimit?: number;
  resumePoints?: ResumePoint[] | null;
  batchSize?: number;
  dateLimit?: string;
  categoryIds?: string[] | null;
  channelIds?: string[] | null;
  forceUpdate?: boolean;
  autoResume?: boolean;
}

/** Options for purgeDeletedMessagesForUsers */
interface PurgeOptions {
  collectionName?: string;
  concurrencyLimit?: number;
}

/** Options for backfillMediaArchive */
interface BackfillOptions {
  collectionName?: string;
  authorIds?: string[] | null;
  guildId?: string | null;
  channelId?: string | null;
  forceRetry?: boolean;
  batchSize?: number;
}

/** Options for fetchMessages */
interface FetchMessagesOptions {
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
  cache?: boolean;
}

/** Result of a bulk save operation */
interface BulkSaveResult {
  saved: number;
  duplicates: number;
  errors: number;
  _lastDate?: string;
}

/** Result of channel processing */
interface ChannelProcessResult {
  saved: number;
  duplicates: number;
  errors: number;
}

/** Result of displayAllChannelActivity's processChannel */
interface ActivityChannelResult {
  channelStat: ChannelStat;
  localUserStats: Record<string, UserStat>;
}

async function fetchMessagesWithOptionalLastId(
  client: Client,
  channelId: string,
  maxMessages: number = 10,
  lastId?: string,
) {
  const channel = client.channels.cache.find(
    (ch) => ch.id === channelId,
  ) as TextChannel | undefined;

  if (channel) {
    let allMessages = new Collection<string, Message>();

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
      const trimmedCollection = new Collection<string, Message>();
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

const transformUserPrimaryGuild = (userPrimaryGuild: UserPrimaryGuild | null): TransformedUserPrimaryGuild => ({
  badge: userPrimaryGuild?.badge,
  identityEnabled: userPrimaryGuild?.identityEnabled,
  identityGuildId: userPrimaryGuild?.identityGuildId,
  tag: userPrimaryGuild?.tag,
});

const transformUser = (user: User, concise: boolean = false): TransformedUser | undefined => {
  if (user) {
    if (concise) {
      return {
        displayName: user.displayName,
        globalName: user.globalName,
        id: user.id,
        tag: user.tag,
        username: user.username,
      };
    }
    return {
      accentColor: user.accentColor,
      avatar: user.avatar,
      avatarDecorationData: user.avatarDecorationData,
      banner: user.banner,
      bot: user.bot,
      createdAt: user.createdAt,
      createdTimestamp: user.createdTimestamp,
      defaultAvatarURL: user.defaultAvatarURL,
      discriminator: user.discriminator,
      displayName: user.displayName,
      dmChannel: user.dmChannel,
      flags: user.flags,
      globalName: user.globalName,
      hexAccentColor: user.hexAccentColor,
      id: user.id,
      partial: user.partial,
      primaryGuild: transformUserPrimaryGuild(user.primaryGuild),
      system: user.system,
      tag: user.tag,
      username: user.username,
    };
  }
};

const transformRole = (role: Role): TransformedRole => {
  const base: TransformedRole = {
    color: role.color,
    createdAt: role.createdAt,
    createdTimestamp: role.createdTimestamp,
    deletable: "deletable" in role ? (role as Role & { deletable?: boolean }).deletable : undefined,
    guildId: "guildId" in role ? (role as Role & { guildId?: string }).guildId : undefined,
    hoist: role.hoist,
    id: role.id,
    managed: role.managed,
    name: role.name,
    position: role.position,
    flags: role.flags,
    permissions: role.permissions,
    mentionable: role.mentionable,
    mention: "mention" in role ? (role as Role & { mention?: string }).mention : undefined,
    hexColor: role.hexColor,
    iconURL: role.iconURL(),
    url: "url" in role ? (role as Role & { url?: string }).url : undefined,
  };
  // Enhanced Role Styles (gradient/holographic) — Discord ENHANCED_ROLE_COLORS feature
  if (role.colors) {
    base.colors = {
      primaryColor: role.colors.primaryColor,
      secondaryColor: role.colors.secondaryColor ?? null,
      tertiaryColor: role.colors.tertiaryColor ?? null,
    };
  }
  return base;
};

const transformAttachment = (attachment: Attachment): TransformedAttachment | undefined => {
  if (attachment) {
    return {
      contentType: attachment.contentType,
      description: attachment.description,
      duration: attachment.duration,
      ephemeral: attachment.ephemeral,
      flags: attachment.flags,
      height: attachment.height,
      id: attachment.id,
      name: attachment.name,
      proxyURL: attachment.proxyURL,
      size: attachment.size,
      spoiler: attachment.spoiler,
      title: attachment.title,
      url: attachment.url,
      waveform: attachment.waveform,
      width: attachment.width,
    };
  }
};

const transformTextChannel = (channel: TextChannel, _concise: boolean = false): TransformedTextChannel | undefined => {
  if (channel) {
    return {
      createdAt: channel.createdAt,
      createdTimestamp: channel.createdTimestamp,
      defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration,
      defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser,
      deletable: channel.deletable,
      flags: channel.flags,
      guild: transformGuild(channel.guild, true),
      guildId: channel.guildId,
      id: channel.id,
      lastMessageId: channel.lastMessageId,
      lastPinAt: channel.lastPinAt,
      lastPinTimestamp: channel.lastPinTimestamp,
      manageable: channel.manageable,
      name: channel.name,
      nsfw: channel.nsfw,
      parentId: channel.parentId,
      parentName: channel.parent?.name || null,
      partial: channel.partial,
      permissionsLocked: channel.permissionsLocked,
      position: channel.position,
      rateLimitPerUser: channel.rateLimitPerUser,
      rawPosition: channel.rawPosition,
      topic: channel.topic,
      type: channel.type,
      url: channel.url,
      viewable: channel.viewable,
    };
  }
};

const transformEmbeds = (embeds: Embed[]): TransformedEmbed[] => {
  return embeds.map((embed: Embed) => ({
    author: embed.author,
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

const transformGuild = (guild: Guild, _concise: boolean = false): TransformedGuild | undefined => {
  if (guild) {
    const result: TransformedGuild = {
      id: guild.id,
      name: guild.name,
    };
    // Persist icon/banner/splash hashes so downstream consumers can
    // reconstruct CDN URLs without the live Discord.js client.
    if (guild.icon) result.icon = guild.icon;
    if (guild.banner) result.banner = guild.banner;
    if (guild.splash) result.splash = guild.splash;
    return result;
  }
};


const transformPoll = (poll: Poll | null): TransformedPoll | undefined => {
  if (poll) {
    return {
      allowMultiselect: poll.allowMultiselect,
      answers: poll.answers.map((answer) => ({
        emoji: answer.emoji ? transformEmoji(answer.emoji as GuildEmoji, true) ?? null : null,
        id: answer.id,
        partial: answer.partial,
        text: answer.text,
        voteCount: answer.voteCount,
      })),
      expiresAt: poll.expiresAt,
      expiresTimestamp: poll.expiresTimestamp,
      layoutType: poll.layoutType,
      question: poll.question,
      resultsFinalized: poll.resultsFinalized,
    };
  }
};

const transformMessageMentions = (mentions: MessageMentions): TransformedMessageMentions | undefined => {
  if (mentions) {
    return {
      channels: mentions.channels.size
        ? mentions.channels.map((channel) =>
            transformTextChannel(channel as TextChannel, true),
          )
        : [],
      everyone: mentions.everyone,
      guild: mentions.guild ? transformGuild(mentions.guild, true) ?? null : null,
      members: mentions.members?.size
        ? mentions.members.map((member: GuildMember) => transformMember(member, true))
        : [],
      parsedUsers: mentions.parsedUsers.size
        ? mentions.parsedUsers.map((user: User) => transformUser(user, true))
        : [],
      roles: mentions.roles.size
        ? mentions.roles.map((role: Role) => transformRole(role))
        : [],
      users: mentions.users.size
        ? mentions.users.map((user: User) => transformUser(user, true))
        : [],
    };
  }
};

const transformMessageSnapshot = (messageSnapshot: import("discord.js").MessageSnapshot): TransformedMessageSnapshot | undefined => {
  if (messageSnapshot) {
    return {
      id: messageSnapshot.id,
      channelId: messageSnapshot.channelId,
      author: messageSnapshot.author ? transformUser(messageSnapshot.author, true) : undefined,
      content: messageSnapshot.content,
      createdAt: messageSnapshot.createdAt,
      editedAt: messageSnapshot.editedAt,
      flags: messageSnapshot.flags,
      mentions: transformMessageMentions(messageSnapshot.mentions),
    };
  }
};

const transformActivity = (activity: Activity): TransformedActivity | undefined => {
  if (activity) {
    return {
      name: activity.name,
      state: activity.state,
      type: activity.type,
      url: activity.url,
    };
  }
};

const transformPresence = (presence: Presence | null): TransformedPresence | undefined => {
  if (presence) {
    return {
      activities: presence.activities.map((activity: Activity) =>
        transformActivity(activity),
      ),
      clientStatus: presence.clientStatus,
      guild: presence.guild ? transformGuild(presence.guild, true) : undefined,
      member: presence.member ? transformMember(presence.member, true) : undefined,
      status: presence.status,
      user: presence.user ? transformUser(presence.user, true) : undefined,
      userId: presence.userId,
    };
  }
};

const transformVoice = (voice: VoiceState): TransformedVoice | undefined => {
  if (voice) {
    return {
      channel: voice.channel ? transformTextChannel(voice.channel as unknown as TextChannel, true) ?? null : null,
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

const transformMember = (member: GuildMember, concise: boolean = false): TransformedMember | undefined => {
  if (member) {
    // Build Enhanced Role Colors for gradient/holographic support.
    // member.roles.color is the highest role with a non-zero color.
    const colorRole = member.roles?.color;
    let roleColorsData: { primary: string; secondary: string | null; tertiary: string | null } | null = null;
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
      const conciseResult: TransformedMemberConcise = {
        id: member.id,
        displayName: member.displayName,
        displayHexColor: member.displayHexColor,
        nickname: member.nickname,
        joinedAt: member.joinedAt,
        joinedTimestamp: member.joinedTimestamp,
        avatar: member.avatar || null,
      };
      // Enhanced Role Styles — gradient (secondary) / holographic (tertiary)
      if (roleColorsData) conciseResult.roleColors = roleColorsData;
      return conciseResult;
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
      roles: member.roles.cache.map((role: Role) => transformRole(role)),
      user: transformUser(member.user, true),
      voice: transformVoice(member.voice),
    } satisfies TransformedMemberFull;
  }
};

const transformEmoji = (emoji: GuildEmoji, _concise: boolean = false): TransformedEmoji | undefined => {
  if (emoji) {
    return {
      animated: emoji.animated,
      createdAt: emoji.createdAt,
      createdTimestamp: emoji.createdTimestamp,
      id: emoji.id,
      identifier: emoji.identifier,
      name: emoji.name,
      imageUrl: typeof (emoji as GuildEmoji & { imageUrl?: () => string }).imageUrl === "function"
        ? (emoji as GuildEmoji & { imageUrl: () => string }).imageUrl()
        : null,
    };
  }
};

const transformReaction = (reaction: MessageReaction | PartialMessageReaction): TransformedReaction | undefined => {
  if (reaction) {
    return {
      count: reaction.count,
      countDetails: {
        burst: reaction.countDetails.burst,
        normal: reaction.countDetails.normal,
      },
      emoji: transformEmoji(reaction.emoji as GuildEmoji, true),
      users: reaction.users.cache.map((user: User) => transformUser(user, true)),
    };
  }
};

const transformSticker = (sticker: Sticker): TransformedSticker => ({
  available: sticker.available,
  createdAt: sticker.createdAt,
  createdTimestamp: sticker.createdTimestamp,
  description: sticker.description,
  guild: sticker.guild ? transformGuild(sticker.guild, true) : undefined,
  guildId: sticker.guildId,
  id: sticker.id,
  name: sticker.name,
  packId: sticker.packId,
  partial: sticker.partial,
  sortValue: sticker.sortValue,
  tags: sticker.tags,
  type: sticker.type,
  url: sticker.url,
  user: sticker.user ? transformUser(sticker.user, true) : undefined,
});

const transformMessageRoot = (message: Message): Record<string, unknown> => {
  return {
    // MessageActivity | null
    activity: message.activity,
    // Snowflake | null
    applicationId: message.applicationId,
    attachments: message.attachments.map((attachment: Attachment) =>
      transformAttachment(attachment),
    ),
    author: transformUser(message.author),
    // boolean
    bulkDeletable: message.bulkDeletable,
    // MessageCall | null
    call: message.call,
    channel: transformTextChannel(message.channel as TextChannel, true),
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
    guild: message.guild ? transformGuild(message.guild, true) : null,
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
    member: message.member ? transformMember(message.member, true) : null,
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
    reactions: message.reactions.cache.map((reaction: MessageReaction | PartialMessageReaction) =>
      transformReaction(reaction),
    ),
    // MessageReference | null
    reference: message.reference,
    // CommandInteractionResolvedData | null
    // resolved: message.resolved, // circular reference
    roleSubscriptionData: message.roleSubscriptionData
      ? {
          id: (message.roleSubscriptionData as unknown as Record<string, unknown>).id,
        }
      : null,
    stickers: message.stickers?.map((sticker) => transformSticker(sticker as Sticker)),
    system: message.system,
    // thread: message.thread, // circular reference
    tts: message.tts,
    type: message.type,
    url: message.url,
    webhookId: message.webhookId,
  };
};

/**
 * Run an event handler, awaiting it and containing any error so a rejection
 * in one handler can never become an unhandled promise rejection that kills
 * the process. Used by all onEvent* registration wrappers below.
 */
async function runEventHandler(
  eventName: string,
  handler: (...args: unknown[]) => void | Promise<void>,
  ...args: unknown[]
) {
  try {
    await handler(...args);
  } catch (error: unknown) {
    console.error(`❌ [DiscordUtilityService:${eventName}] Unhandled error in event handler:`, error);
  }
}

const DiscordUtilityService = {
  // Fetches and saves all messages from a Discord server to MongoDB.
  // Supports category filtering, date limits, auto-resume via checkpoints,
  // and concurrent channel processing with bulk upserts.
  async fetchAndSaveAllServerMessages(client: Client, mongo: import("mongodb").MongoClient, guildId: string, options: FetchAndSaveOptions = {}) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 10,
      resumePoints = null,
      batchSize = 100,
      dateLimit = "2025-11-01",
      categoryIds = null,
      channelIds = null,
      forceUpdate = false,
      autoResume = true,
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
    } catch (indexError: unknown) {
      if (indexError instanceof Error && "code" in indexError && (indexError as Error & { code: number }).code === 11000) {
        console.log(`[INDEX] Duplicate keys found — deduplicating before indexing...`);
        await DiscordUtilityService.deleteDuplicateMessagesByID(mongo, collectionName as string);
        await collection.createIndex({ id: 1 }, { unique: true, background: true });
        console.log(`[INDEX] Unique index created after deduplication`);
      } else {
        throw indexError;
      }
    }

    try {
      await collection.createIndex({ guildId: 1, createdTimestamp: -1 }, { background: true });
      await collection.createIndex({ guildId: 1, channelId: 1, createdTimestamp: -1 }, { background: true });
      await collection.createIndex({ guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 }, { background: true });
      await collection.createIndex({ guildId: 1, "author.id": 1, createdTimestamp: -1 }, { background: true });
      console.log(`[INDEX] Ensured compound indexes on "${collectionName}"`);
    } catch (indexError: unknown) {
      console.error(`[INDEX] Failed to create compound indexes on "${collectionName}":`, indexError);
    }

    // ── Resume logic ────────────────────────────────────────────────
    const resumeMap = new Map<string, string>();
    const completedChannelIds = new Set<string>();

    if (resumePoints && Array.isArray(resumePoints)) {
      // Explicit resume points take priority
      resumePoints.forEach((point: ResumePoint) => {
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

    // Filter by specific channel IDs if provided (takes precedence)
    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      textChannels = textChannels.filter(
        (channel) => channelIds.includes(channel.id),
      );
      console.log(
        `[CHANNELS] Filtering to ${channelIds.length} specific channel(s) — ${textChannels.size} matched`,
      );
    }
    // Otherwise filter by category IDs if provided
    else if (categoryIds && Array.isArray(categoryIds) && categoryIds.length > 0) {
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
    const bulkSaveNewMessages = async (messages: Message[]): Promise<BulkSaveResult> => {
      if (!messages || messages.length === 0) {
        return { saved: 0, duplicates: 0, errors: 0, _lastDate: '' };
      }

      const documents: Record<string, unknown>[] = [];
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
            } catch (archiveErr: unknown) {
              console.warn(`  [ARCHIVE] Media archival failed for ${message.id}: ${errorMessage(archiveErr)}`);
            }
          }

          documents.push(document);
        } catch (transformError: unknown) {
          console.error(
            `  [ERROR] Failed to transform message ${message.id}: ${errorMessage(transformError)}`,
          );
          transformErrorCount++;
        }
      }

      if (documents.length === 0) {
        return { saved: 0, duplicates: 0, errors: transformErrorCount };
      }

      try {
        const bulkOps = documents.map((document) => {
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
            "member.displayHexColor": (document.member as Record<string, unknown> | undefined)?.displayHexColor || null,
            "member.displayName": (document.member as Record<string, unknown> | undefined)?.displayName || null,
            "member.avatar": (document.member as Record<string, unknown> | undefined)?.avatar || null,
            // Enhanced Role Styles (gradient/holographic) — always update to latest
            ...((document.member as Record<string, unknown> | undefined)?.roleColors
              ? { "member.roleColors": (document.member as Record<string, unknown>).roleColors }
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
            const memberObj = insertDoc.member as Record<string, unknown>;
            const { displayHexColor: _dhc, displayName: _dn, avatar: _av, roleColors: _rc, ...restMember } = memberObj;
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
      } catch (error: unknown) {
        if (error instanceof Error && "writeErrors" in error) {
          const bulkError = error as Error & { writeErrors: unknown[]; result?: { nUpserted?: number } };
          const savedCount = bulkError.result?.nUpserted || 0;
          console.error(
            `  [ERROR] Bulk write partial failure: ${savedCount} saved, ${bulkError.writeErrors.length} errors`,
          );
          return {
            saved: savedCount,
            duplicates: 0,
            errors: bulkError.writeErrors.length + transformErrorCount,
          };
        }

        console.error(`  [ERROR] Bulk save failed: ${errorMessage(error)}`);
        return { saved: 0, duplicates: 0, errors: messages.length };
      }
    };

    // ── Concurrency limiter ─────────────────────────────────────────
    const createConcurrencyLimiter = (limit: number) => {
      let activeCount = 0;
      const queue: (() => void)[] = [];

      const run = async <T>(fn: () => Promise<T>): Promise<T> => {
        while (activeCount >= limit) {
          await new Promise<void>((resolve) => queue.push(resolve));
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
    const processChannel = async (channel: TextChannel) => {
      const channelStartTime = Date.now();
      let channelMessageCount = 0;
      let channelDuplicates = 0;
      let channelErrors = 0;

      // Track message IDs from the target users found on Discord
      const discordUserMessageIds = new Set<string>();

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
          const fetchOptions: FetchMessagesOptions = { limit: batchSize, cache: false };
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
        } catch (fetchError: unknown) {
          console.error(
            `  [ERROR] Failed to fetch messages from #${channel.name}: ${errorMessage(fetchError)}`,
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
        } catch (writeError: unknown) {
          console.error(
            `  [ERROR] Final batch write failed for #${channel.name}: ${errorMessage(writeError)}`,
          );
          channelErrors++;
          totalErrors++;
        }
      }

      // ── Cleanup: soft-delete orphaned messages from target users ──
      // Compare MongoDB messages by these users in this channel against
      // what was found on Discord — soft-delete any orphans.
      if (discordUserMessageIds.size > 0 || !limitDate) {
        try {
          const mongoUserMessages = await collection
            .find(
              { ...EXCLUDE_SOFT_DELETED, channelId: channel.id, "author.id": { $in: CLEANUP_USER_IDS } },
              { projection: { id: 1 } },
            )
            .toArray();

          const orphanIds = mongoUserMessages
            .filter((document: import('mongodb').Document) => !discordUserMessageIds.has(document.id))
            .map((document: import('mongodb').Document) => document.id);

          if (orphanIds.length > 0) {
            const softDeleteResult = await collection.updateMany(
              { id: { $in: orphanIds } },
              { $set: { isDeleted: true, deletedAt: new Date() } },
            );
            console.log(
              `  [CLEANUP] #${channel.name}: Soft-deleted ${softDeleteResult.modifiedCount} orphaned message(s) from tracked users`,
            );
          }
        } catch (cleanupErr: unknown) {
          console.warn(
            `  [CLEANUP] #${channel.name}: cleanup failed: ${errorMessage(cleanupErr)}`,
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
    const channelPromises: Promise<ChannelProcessResult | undefined>[] = [];
    for (const channel of textChannels.values()) {
      channelPromises.push(limiter.run(() => processChannel(channel as TextChannel)));
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
   * Soft-delete orphaned messages for specific users.
   * Queries MongoDB for all messages by the given user IDs, then verifies
   * each one against Discord. Messages that no longer exist (404/10008)
   * are soft-deleted in MongoDB (isDeleted + deletedAt).
   */
  async purgeDeletedMessagesForUsers(client: Client, mongo: import("mongodb").MongoClient, guildId: string, userIds: string[], options: PurgeOptions = {}) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 5,
    } = options;

    const startTime = Date.now();
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName as string);
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      console.error(`[CLEANUP] Guild ${guildId} not found`);
      return { verified: 0, deleted: 0, errors: 0 };
    }

    // Find all messages in MongoDB by these users in this guild
    const mongoMessages = await collection
      .find(
        { ...EXCLUDE_SOFT_DELETED, guildId, "author.id": { $in: userIds } },
        { projection: { id: 1, channelId: 1, "author.id": 1 } },
      )
      .toArray();

    console.log(`[CLEANUP] Found ${mongoMessages.length} message(s) from ${userIds.length} tracked user(s) to verify`);
    if (mongoMessages.length === 0) return { verified: 0, deleted: 0, errors: 0 };

    // Group by channel for efficient processing
    const byChannel = new Map<string, string[]>();
    for (const document of mongoMessages) {
      const chId = document.channelId as string;
      if (!byChannel.has(chId)) {
        byChannel.set(chId, []);
      }
      byChannel.get(chId)!.push(document.id as string);
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

      const orphanIds: string[] = [];

      // Process in concurrency-limited chunks
      for (let i = 0; i < messageIds.length; i += concurrencyLimit) {
        const chunk = messageIds.slice(i, i + concurrencyLimit);
        const results = await Promise.allSettled(
          chunk.map(async (msgId: string) => {
            try {
              await (channel as TextChannel).messages.fetch(msgId);
              return { exists: true, id: msgId };
            } catch (error: unknown) {
              const discordError = error as Error & { code?: number };
              if (discordError.code === 10008) {
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
        const softDeleteResult = await collection.updateMany(
          { id: { $in: orphanIds } },
          { $set: { isDeleted: true, deletedAt: new Date() } },
        );
        totalDeleted += softDeleteResult.modifiedCount;
        console.log(
          `  [CLEANUP] #${channel.name}: Soft-deleted ${softDeleteResult.modifiedCount} message(s)`,
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
  async backfillMediaArchive(client: Client, mongo: import("mongodb").MongoClient, options: BackfillOptions = {}) {
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
    const collection = db.collection(collectionName as string);

    // Build query: messages with media but no/empty mediaArchive
    const archiveConditions: import("mongodb").Filter<import("mongodb").Document>[] = [
      { mediaArchive: { $exists: false } },
    ];
    // forceRetry: also re-process messages that were previously marked
    // with empty mediaArchive (e.g. URLs were expired during prior attempts)
    if (forceRetry) {
      archiveConditions.push({ mediaArchive: { $eq: {} } });
    }

    const query: import("mongodb").Filter<import("mongodb").Document> = {
      ...EXCLUDE_SOFT_DELETED,
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
    const byChannel = new Map<string, import("mongodb").Document[]>();
    for (const document of docs) {
      const chId = document.channelId as string;
      if (!byChannel.has(chId)) {
        byChannel.set(chId, []);
      }
      byChannel.get(chId)!.push(document);
    }

    const guild = guildId ? client.guilds.cache.get(guildId as string) : null;
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
          let liveMessage: Message | null;
          try {
            liveMessage = await (channel as TextChannel).messages.fetch(document.id);
          } catch (fetchErr: unknown) {
            const discordError = fetchErr as Error & { code?: number };
            if (discordError.code === 10008) {
              // Message was deleted — mark and skip
              console.log(`  [BACKFILL] Message ${document.id} deleted from Discord — marking empty`);
              await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
              continue;
            }
            throw fetchErr;
          }

          // Use the standard archival pipeline on the live message
          const archiveMap = await MediaArchivalService.archiveMessageMedia(liveMessage!);

          if (Object.keys(archiveMap).length > 0) {
            // Transform fresh doc and rewrite URLs
            const freshDoc = transformMessageRoot(liveMessage!);
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
        } catch (error: unknown) {
          errors++;
          console.error(`  [BACKFILL] Error processing message ${document.id}: ${errorMessage(error)}`);
          // Mark failed so we don't retry on next run (can be cleared manually)
          await collection.updateOne({ _id: document._id }, { $set: { mediaArchive: {} } });
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[BACKFILL] Complete — processed: ${processed}, archived: ${archived}, errors: ${errors} (${duration}s)`);

    return { processed, archived, errors };
  },
  async deleteDuplicateMessagesByID(mongo: import("mongodb").MongoClient, collectionName: string = "Messages") {
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
  _sanitizeUsername(name: string) {
    if (!name) return "default";
    return name.replace(/\s+/g, "_").replace(/[^\w]/gi, "") || "default";
  },
  getUsernameNoSpaces(message: Message) {
    const name =
      message?.author?.displayName ||
      message?.author?.username ||
      (message as Message & { user?: User })?.user?.username;
    return DiscordUtilityService._sanitizeUsername(name ?? "");
  },

  async saveMessageToMongo(message: Message, mongo: import("mongodb").MongoClient, collectionName: string = "Messages") {
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
      } catch (error: unknown) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${errorMessage(error)}`);
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
  async updateMessageInMongo(message: Message, mongo: import("mongodb").MongoClient, collectionName: string = "Messages") {
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
      } catch (error: unknown) {
        console.warn(`📦 Media archival failed for message ${message.id}: ${errorMessage(error)}`);
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
  async syncReactionsToMongo(reactionMessage: Message, mongo: import("mongodb").MongoClient, collectionName: string = "Messages") {
    try {
      const db = mongo.db(MONGO_DB_NAME);
      const collection = db.collection(collectionName);
      const transformedReactions = reactionMessage.reactions.cache.map((r: MessageReaction) =>
        transformReaction(r),
      );
      await collection.updateOne(
        { id: reactionMessage.id },
        { $set: { reactions: transformedReactions } },
      );
    } catch (error: unknown) {
      console.warn(`[syncReactionsToMongo] Failed for message ${reactionMessage.id}: ${errorMessage(error)}`);
    }
  },

  async extractAudioUrlsFromMessage(message: Message) {
    const audioUrls: string[] = [];
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isAudio = attachment.contentType?.includes("audio/ogg");
        if (isAudio) {
          audioUrls.push(attachment.url);
        }
      }
    }
    return audioUrls;
  },
  async extractImageUrlsFromMessage(message: Message) {
    const imageUrls: string[] = [];
    // Attachments
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isImage = attachment.contentType?.includes("image/");
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
  async retrieveMessageReferenceFromMessage(message: Message) {
    let messageReference: Message | null;
    if (message?.reference && message.reference.messageId) {
      messageReference = message.channel.messages.cache.get(
        message.reference.messageId,
      ) ?? null;
      if (!messageReference) {
        try {
          messageReference = await message.channel.messages.fetch(
            message.reference.messageId,
          );
        } catch (error: unknown) {
          console.error("Error fetching message reference:", error);
        }
      }
    }
    return messageReference!;
  },
  getDisplayNameFromUserOrMember({ user, member }: { user?: User; member?: GuildMember }) {
    let displayName: string | null = null;
    if (user || member) {
      displayName = user?.displayName || member?.displayName || null;
    }
    return displayName;
  },
  getCleanUsernameFromUser(user: User) {
    // Replaces periods/hashes with underscores first, then delegates to shared sanitizer
    const raw = user?.username?.replace(/[.#]/g, "_");
    return DiscordUtilityService._sanitizeUsername(raw);
  },
  async getDisplayName(message: Message, userId: string) {
    let displayName: string | null = null;
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
  getNameFromUser(user: User) {
    return user?.displayName || user?.globalName || user?.username || undefined;
  },
  getUserMentionFromMessage(message: Message) {
    if (message) {
      // Find out why author and why user are different
      const userId = message?.author?.id || (message as Message & { user?: User })?.user?.id;
      return `<@${userId}>`;
    }
  },
  getDiscordTagFromMessage(message: Message) {
    if (message) {
      const userTag = message?.author?.tag || (message as Message & { user?: User })?.user?.tag;
      return userTag;
    }
  },
  async printOutAllRoles(client: Client) {
    // print out all roles in the order that they are in the server
    consoleLog("<", "printOutAllRoles");
    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) return;
    const roles = guild.roles.cache;
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
  async printOutAllEmojis(client: Client) {
    consoleLog("<", "printOutAllEmojis");
    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) return;
    const emojis = guild.emojis.cache;
    consoleLog("=", `Printing out all emojis in the server`);
    for (const emoji of emojis.values()) {
      console.log(`${emoji.name} - ${emoji.id}`);
    }
    consoleLog(">", "printOutAllEmojis");
  },
  async retrieveMemberFromGuildById(guild: Guild, userId: string) {
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
  async getUserFromClientAndId(client: Client, userId: string, force: boolean = false) {
    let user = client.users.cache.get(userId);
    if (!user) {
      try {
        user = await client.users.fetch(userId, { force });
      } catch (error: unknown) {
        consoleLog(
          "!",
          `Could not fetch user with ID ${userId}. Error: ${errorMessage(error)}`,
        );
        return null;
      }
    }
    return user;
  },
  // Deprecated: Use getUserFromClientAndId directly.
  // Kept as alias for existing call sites (PermanentTimeOutJob, getDisplayName).
  async retrieveUserFromClientAndUserId(client: Client, userId: string) {
    return DiscordUtilityService.getUserFromClientAndId(client, userId);
  },
  // Sync cache-only lookup (no fetch)
  getUserByClientAndId(client: Client, userId: string) {
    return client.users.cache.get(userId);
  },
  // Convenience wrapper for message context
  async getUserFromMessage(message: Message, force: boolean = false) {
    return DiscordUtilityService.getUserFromClientAndId(
      message.client,
      message.author.id,
      force,
    );
  },
  // Event Handlers
  onEventClientReady(client: Client, options: Record<string, unknown>, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.ClientReady, () => {
      void runEventHandler("clientReady", customFunction, client, options);
    });
  },
  onEventMessageCreate(client: Client, { mongo, localMongo }: MongoConnections, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.MessageCreate, (message: Message) => {
      void runEventHandler("messageCreate", customFunction, client, { mongo, localMongo }, message);
    });
  },
  onEventMessageUpdate(client: Client, { mongo, localMongo }: MongoConnections, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.MessageUpdate, (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
      void runEventHandler("messageUpdate", customFunction, client, { mongo, localMongo }, oldMessage, newMessage);
    });
  },
  onEventMessageDelete(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.MessageDelete, (message) => {
      void runEventHandler("messageDelete", customFunction, client, mongo, message);
    });
  },
  onEventMessageReactionAdd(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.MessageReactionAdd, (reaction, user) => {
      void runEventHandler("messageReactionAdd", customFunction, client, mongo, reaction, user);
    });
  },
  onEventMessageReactionRemove(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.MessageReactionRemove, (reaction, user) => {
      void runEventHandler("messageReactionRemove", customFunction, client, mongo, reaction, user);
    });
  },
  onEventGuildMemberAdd(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.GuildMemberAdd, (member: GuildMember) => {
      void runEventHandler("guildMemberAdd", customFunction, client, mongo, member);
    });
  },
  onEventGuildMemberAvailable(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.GuildMemberAvailable, (member) => {
      void runEventHandler("guildMemberAvailable", customFunction, client, mongo, member);
    });
  },
  onEventInteractionCreate(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.InteractionCreate, (interaction: Interaction) => {
      void runEventHandler("interactionCreate", customFunction, client, mongo, interaction);
    });
  },
  onEventPresenceUpdate(client: Client, customFunction: (...args: unknown[]) => void) {
    return client.on(
      Events.PresenceUpdate,
      (oldPresence: Presence | null, newPresence: Presence) => {
        void runEventHandler("presenceUpdate", customFunction, client, oldPresence, newPresence);
      },
    );
  },
  onEventVoiceStateUpdate(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
      void runEventHandler("voiceStateUpdate", customFunction, client, mongo, oldState, newState);
    });
  },
  onEventGuildMemberRemove(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.GuildMemberRemove, (member) => {
      void runEventHandler("guildMemberRemove", customFunction, client, mongo, member);
    });
  },
  onEventGuildMemberUpdate(client: Client, mongo: import("mongodb").MongoClient, customFunction: (...args: unknown[]) => void) {
    return client.on(Events.GuildMemberUpdate, (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
      void runEventHandler("guildMemberUpdate", customFunction, client, mongo, oldMember, newMember);
    });
  },
  async getAllServerEmojisFromMessage(message: Message, format: "string" | "array" = "string") {
    // format can be: array, string
    if (message.guild?.emojis.cache.size) {
      const emojis = message.guild.emojis.cache.map((emoji: GuildEmoji) => {
        return {
          id: emoji.id,
          name: emoji.name,
          url: emoji.url,
        };
      });
      if (format === "array") {
        return emojis;
      } else if (format === "string") {
        return emojis.map((emoji: { name: string; id: string }) => `<${emoji.name}:${emoji.id}>`).join(", ");
      }
    } else {
      return [];
    }
  },
  // Special functions
  async fetchMessages(client: Client, channelId: string, options: FetchMessagesOptions = {}) {
    const channel = client.channels.cache.find(
      (ch) => ch.id === channelId,
    ) as TextChannel | undefined;

    if (!channel) return null;

    const {
      limit = 10,
      before,
      after,
      around,
      cache = true,
    } = options;

    let allMessages = new Collection<string, Message>();

    // Metrics tracking
    let _apiCallCount = 0;
    const _startTime = Date.now();

    // If 'around' is specified, fetch once and return (Discord API behavior)
    if (around) {
      _apiCallCount++;
      let messages = await channel!.messages.fetch({
        limit: Math.min(100, limit),
        around,
        cache,
      });
      return messages;
    }

    // Determine pagination direction and cursor
    const isAfterMode = after && !before;
    let cursor: string | undefined = before || after;

    // Initial fetch
    _apiCallCount++;
    const initialFetchOptions: FetchMessagesOptions = {
      limit: Math.min(100, limit),
      cache,
    };

    if (before) initialFetchOptions.before = before;
    if (after) initialFetchOptions.after = after;

      let messages = await channel!.messages.fetch(initialFetchOptions as import("discord.js").FetchMessagesOptions);
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

      const fetchOptions: FetchMessagesOptions = {
        limit: Math.min(100, additionalMessagesNeeded),
        cache,
      };

      // Set the appropriate cursor
      if (isAfterMode) {
        fetchOptions.after = cursor;
      } else {
        fetchOptions.before = cursor;
      }

      messages = await channel!.messages.fetch(fetchOptions as import("discord.js").FetchMessagesOptions);

      // Avoid duplicates (Discord API might return overlapping messages)
      const uniqueMessages = messages.filter((message: Message) => !allMessages.has(message.id));
      allMessages = allMessages.concat(uniqueMessages);

      // Break if no new messages were added (to prevent infinite loops)
      if (uniqueMessages.size === 0) break;
    }


    // Trim collection if we fetched more than needed
    if (allMessages.size > limit) {
      const trimmedCollection = new Collection<string, Message>();
      let count = 0;

      // Maintain message order based on fetch direction
      const messageArray: Message[] = Array.from(allMessages.values());
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
  async getOrFetchChannelByChannelId(client: Client, channelId: string) {
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
      try {
      channel = await client.channels.fetch(channelId) ?? undefined;
      } catch (error: unknown) {
        consoleLog(
          "!",
          `Could not fetch channel with ID ${channelId}. Error: ${errorMessage(error)}`,
        );
        return null;
      }
    }
    return channel;
  },
  // User functions
  getBotName(client: Client) {
    return client.user?.tag;
  },
  setUserActivity(client: Client, message: string) {
    return client.user?.setActivity(message, { type: ActivityType.Custom });
  },
  // Channel functions
  getChannelById(client: Client, channelId: string) {
    return client.channels.cache.get(channelId);
  },
  getChannelName(client: Client, channelId: string) {
    return (client.channels.cache.get(channelId) as TextChannel | undefined)?.name;
  },
  // Guilds functions
  getGuildById(client: Client, guildId: string) {
    return client.guilds.cache.get(guildId);
  },
  getAllGuilds(client: Client) {
    let guildsCollection: import('discord.js').Collection<string, Guild> | undefined;
    if (client) {
      guildsCollection = client.guilds.cache;
    }
    return guildsCollection;
  },
  getNameFromItem(item: Message | Interaction) {
    const discordMessage = item as Message & { user?: User };
    return (
      discordMessage?.author?.displayName ||
      discordMessage?.author?.username ||
      discordMessage?.user?.globalName ||
      discordMessage?.user?.username
    );
  },
  // REST functions
  async patchBanner(client: Client, imageUrl: string) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," + Buffer.from(imageUrl).toString("base64"),
      },
    });
  },
  async patchBannerFromImageUrl(client: Client, imageUrl: string) {
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
  async getBannerFromUserId(client: Client, userId: string) {
    const getUser = await client.rest.get(`/users/${userId}`) as Record<string, unknown>;
    return getUser.banner;
  },
  // Typing functions
  async startTypingInterval(channel: TextChannel) {
    // Fire-and-forget — never await sendTyping(). Its promise can hang
    // indefinitely if discord.js's internal rate limit queue is stuck
    // (e.g., after a Discord API outage). Typing is cosmetic.
    channel.sendTyping().catch((error: Error) => {
      console.warn(`⚠️ [startTypingInterval] Initial sendTyping failed: ${error.message}`);
    });
    // Refresh typing every 5s (Discord auto-clears after 10s)
    const sendTypingInterval = setInterval(() => {
      channel.sendTyping().catch((_error: Error) => {
        if (sendTypingInterval) {
          clearInterval(sendTypingInterval);
        }
      });
    }, 5000);
    return sendTypingInterval;
  },
  clearTypingInterval(sendTypingInterval: NodeJS.Timeout) {
    if (sendTypingInterval) clearInterval(sendTypingInterval);
    return null;
  },
  // Message functions
  async sendMessageInChunks(
    sendOrReply: "send" | "reply",
    message: Message,
    generatedTextResponse: string | null,
    encodedImageDataBase64: Buffer | string | null,
    imagePrompt: string | null,
    audioRef?: string | null,
  ) {
    const messageChunkSizeLimit = 2000;
    let fileName = "lupos.png";
    let imageDescription = "";
    let returnedFirstMessage: Message | null = null;

    if (imagePrompt) {
      fileName = `${imagePrompt.substring(0, 240)}.png`;
      imageDescription = imagePrompt.substring(0, 1000);
    }

    // Fetch audio binary from Prism file service if audioRef is provided
    let audioBuffer: Buffer | null = null;
    let audioExtension = "wav";
    if (audioRef) {
      try {
        const audioFileKey = audioRef.startsWith("minio://") ? audioRef.replace("minio://", "") : audioRef;
        const audioUrl = `${config.PRISM_API_URL}/files/${audioFileKey}`;
        const audioResponse = await fetch(audioUrl, {
          signal: AbortSignal.timeout(10000),
        });
        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuffer);
          const contentType = audioResponse.headers.get("content-type");
          if (contentType) {
            if (contentType.includes("mpeg") || contentType.includes("mp3")) {
              audioExtension = "mp3";
            } else if (contentType.includes("ogg")) {
              audioExtension = "ogg";
            } else if (contentType.includes("webm")) {
              audioExtension = "webm";
            } else if (contentType.includes("wav") || contentType.includes("wave")) {
              audioExtension = "wav";
            }
          }
        } else {
          console.error(`[sendMessageInChunks] Failed to fetch audio from ${audioUrl}: ${audioResponse.status}`);
        }
      } catch (audioFetchError) {
        console.error("[sendMessageInChunks] Error fetching audio:", audioFetchError);
      }
    }

    // Handle media-only response (image/audio but no text)
    if ((!generatedTextResponse || generatedTextResponse.length === 0) && (encodedImageDataBase64 || audioBuffer)) {
      const files: import('discord.js').AttachmentPayload[] = [];
      if (encodedImageDataBase64) {
        const imageAttachment = Buffer.isBuffer(encodedImageDataBase64)
          ? encodedImageDataBase64
          : Buffer.from(encodedImageDataBase64, "base64");
        files.push({
          attachment: imageAttachment,
          name: fileName,
          description: imageDescription,
        });
      }
      if (audioBuffer) {
        const audioTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        files.push({
          attachment: audioBuffer,
          name: `${audioTimestamp}.${audioExtension}`,
          description: "Generated audio",
        });
      }
      if (sendOrReply === "send") {
      return await (message.channel as TextChannel).send({ files });
      } else {
        return await message.reply({ files });
      }
    }

    for (
      let i = 0;
      i < generatedTextResponse!.length;
      i += messageChunkSizeLimit
    ) {
      const chunk = generatedTextResponse!.substring(
        i,
        i + messageChunkSizeLimit,
      );
      let messageReplyOptions: Record<string, unknown> = { content: chunk };
      const files: import('discord.js').AttachmentPayload[] = [];

      const isLastChunk = i + messageChunkSizeLimit >= generatedTextResponse!.length;

      if (encodedImageDataBase64 && isLastChunk) {
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
      if (audioBuffer && isLastChunk) {
        const audioTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        files.push({
          attachment: audioBuffer,
          name: `${audioTimestamp}.${audioExtension}`,
          description: "Generated audio",
        });
      }
      messageReplyOptions = { ...messageReplyOptions, files: files };
      if (sendOrReply === "send") {
      const sentMessage = await (message.channel as TextChannel).send(messageReplyOptions);
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
    return returnedFirstMessage!;
  },
  // Utility functions
  async displayAllChannelActivity(client: Client) {
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

    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) {
      console.error("[ERROR] Primary guild not found");
      return;
    }
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

    const channelStats: ChannelStat[] = [];
    const globalUserStats: Record<string, UserStat> = {};
    const now = TemporalHelpers.now();
    const cutoffDate = TemporalHelpers.minus(now, { months: MONTHS_TO_ANALYZE });
    console.log(`[TIME] Current time: ${TemporalHelpers.nowISO()}`);
    console.log(
      `[TIME] Cutoff date (${periodText} ago): ${cutoffDate.toInstant().toString()}`,
    );

    let processedChannelCount = 0;
    let totalFetchCount = 0;

    // Collect all eligible channels first
    const eligibleChannels: TextChannel[] = [];
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
    const processChannel = async (channel: TextChannel, channelIndex: number) => {
      const logPrefix = `[CH ${channelIndex}/${eligibleChannelCount}]`;
      console.log(
        `\n${logPrefix} Processing: #${channel.name} (Category: ${channel.parent?.name ?? "No Category"})`,
      );

      try {
        let allMessages: Message[] = [];
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

          const messagesArray: Message[] = messages ? Array.from(messages.values()) : [];

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
            (message: Message) =>
              !allMessages.some((existingMsg: Message) => existingMsg.id === message.id),
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

          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }

        console.log(
          `  ${logPrefix} [FETCH] Total fetches for this channel: ${channelFetchCount}`,
        );
        console.log(
          `  ${logPrefix} [PROCESS] Filtering messages from the last ${periodText}...`,
        );

        const messagesInPeriod = allMessages.filter(
          (message: Message) =>
            TemporalHelpers.toEpochMs(TemporalHelpers.fromMillis(message.createdTimestamp)) > TemporalHelpers.toEpochMs(cutoffDate),
        );
        console.log(
          `  ${logPrefix} [PROCESS] Found ${messagesInPeriod.length} messages in the last ${periodText} (out of ${allMessages.length} total fetched)`,
        );

        const userMessageCount: Record<string, { username: string; count: number }> = {};
        const localUserStats: Record<string, UserStat> = {}; // Collect locally first to avoid race conditions

        messagesInPeriod.forEach((message: Message) => {
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
          .sort(([, a], [, b]) => b.count - a.count)
          .slice(0, 20)
          .map(([_userId, data]) => ({
            username: data.username,
            count: data.count,
          }));

        if (sortedUsers.length > 0) {
          console.log(`  ${logPrefix} [TOP USERS] Top contributors:`);
          sortedUsers.forEach((user, index: number) => {
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
      } catch (error: unknown) {
        console.error(
          `  ${logPrefix} [ERROR] Failed to fetch messages for channel ${channel.name}:`,
          errorMessage(error),
        );
        console.error(`  ${logPrefix} [ERROR] Stack trace:`, errorStack(error));
        processedChannelCount++;
        return null;
      }
    };

    // Process channels in batches with concurrency limit
    const results: (ActivityChannelResult | null)[] = [];
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

      const batchPromises = batch.map((channel: TextChannel, batchIndex: number) =>
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

    channelStats.forEach((stat, index: number) => {
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
          .map((user, userIndex: number) => `${userIndex + 1}. ${user.username} (${user.count})`)
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
      .sort(([, a], [, b]) => b.totalMessages - a.totalMessages)
      .slice(0, 10)
      .map(([_userId, data]) => ({
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

    topTenUsers.forEach((user, index: number) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const username = user.username.substring(0, 23).padEnd(23, " ");
      const totalMsgs = user.totalMessages.toString().padStart(14, " ");
      const channelCount = user.channelCount.toString().padStart(15, " ");

      console.log(`${rank} | ${username} | ${totalMsgs} | ${channelCount}`);
    });

    console.log("\n[END] Channel activity analysis complete!");
    consoleLog(">", "displayAllChannelActivity");
  },
  async calculateMessagesSentOnAveragePerDayInChannel(client: Client, channelId: string) {
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
      const fetchResult = await DiscordUtilityService.fetchMessages(client, channel.id, {
          limit: 100,
        });
      if (!fetchResult) return;
      const recentMessages = fetchResult.reverse();
      for (const recentMsg of recentMessages.values()) {
        messageCount++;
        if (
          !lastMessageDate ||
          recentMsg.createdTimestamp > lastMessageDate.getTime()
        ) {
          lastMessageDate = new Date(recentMsg.createdTimestamp);
        }
      }
    } catch (error: unknown) {
      console.log(
        `Error fetching messages from channel ${(channel as TextChannel).name}: ${errorMessage(error)}`,
      );
      return;
    }

    const daysSinceStart = Math.max(
      1,
      Math.ceil((now - (lastMessageDate?.getTime() || now)) / MILLISECONDS_PER_DAY),
    );
    const averageMessagesPerHour = (
      messageCount /
      (daysSinceStart * 24)
    ).toFixed(2);

    console.log(`Channel: ${(channel as TextChannel).name}`);
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
  async addRoleToMember(member: GuildMember, roleId: string) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: Role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        !member.roles.cache.some((r: Role) => r.id === roleId)
      ) {
        if (!role) return;
        await member.roles.add(role);
        console.log(...LogFormatter.roleAdded(member, role));
      }
    } catch (error: unknown) {
      if (!role) return;
      console.error(
        ...LogFormatter.roleFailedToAdd(member, role, error instanceof Error ? error : new Error(errorMessage(error))),
      );
    }
  },
  async removeRoleFromMember(member: GuildMember, roleId: string) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: Role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        member.roles.cache.some((r: Role) => r.id === roleId)
      ) {
        if (!role) return;
        await member.roles.remove(role);
        console.log(...LogFormatter.roleRemoved(member, role));
      }
    } catch (error: unknown) {
      if (!role) return;
      console.error(
        ...LogFormatter.roleFailedToRemove(member.user.id, role, error instanceof Error ? error : new Error(errorMessage(error))),
      );
    }
  },
  async setUserStatus(client: Client, status: PresenceStatusData) {
    try {
      if (!client.user) return;
      await client.user.setStatus(status);
      console.log(`Set bot status to ${status}`);
    } catch (error: unknown) {
      console.error(`Failed to set bot status to ${status}:`, errorMessage(error));
    }
  },
};

export default DiscordUtilityService;
