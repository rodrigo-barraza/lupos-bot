// ============================================================
// transformers — Pure Discord.js → Mongo-document transformers
// ============================================================
// Transformed-shape interfaces + pure transform* functions moved
// verbatim from DiscordUtilityService.ts (R1 split). These are
// side-effect-free and must NOT import DiscordUtilityService.
// ============================================================

import {
  Message,
  Guild,
  User,
  TextChannel,
  GuildEmoji,
  MessageReaction,
  PartialMessageReaction,
  Presence,
  VoiceState,
  GuildMember,
  Role,
  Attachment,
  Embed,
  Poll,
  Activity,
  Sticker,
  MessageMentions,
  UserPrimaryGuild,
} from "discord.js";

// ─── Transformed-shape interfaces ───────────────────────────────

export interface TransformedUserPrimaryGuild {
  badge: string | null | undefined;
  identityEnabled: boolean | null | undefined;
  identityGuildId: string | null | undefined;
  tag: string | null | undefined;
}

export interface TransformedUserConcise {
  displayName: string;
  globalName: string | null;
  id: string;
  tag: string;
  username: string;
}

export interface TransformedUserFull extends TransformedUserConcise {
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

export type TransformedUser = TransformedUserFull | TransformedUserConcise;

export interface TransformedRole {
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

export interface TransformedAttachment {
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

export interface TransformedGuild {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  splash?: string;
}

export interface TransformedActivity {
  name: string;
  state: string | null;
  type: import("discord.js").ActivityType;
  url: string | null;
}

export interface TransformedPresence {
  activities: (TransformedActivity | undefined)[];
  clientStatus: import("discord.js").ClientPresenceStatusData | null;
  guild: TransformedGuild | undefined;
  member: TransformedMember | undefined;
  status: import("discord.js").PresenceStatus;
  user: TransformedUser | undefined;
  userId: string;
}

export interface TransformedVoice {
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

export interface TransformedMemberConcise {
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

export interface TransformedMemberFull extends TransformedMemberConcise {
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

export type TransformedMember =
  | TransformedMemberFull
  | TransformedMemberConcise;

export interface TransformedEmbed {
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

export interface TransformedEmoji {
  animated: boolean | null;
  createdAt: Date | null;
  createdTimestamp: number | null;
  id: string | null;
  identifier: string;
  name: string | null;
  imageUrl: string | null;
}

export interface TransformedReaction {
  count: number | null;
  countDetails: { burst: number; normal: number };
  emoji: TransformedEmoji | undefined;
  users: (TransformedUser | undefined)[];
}

export interface TransformedSticker {
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

export interface TransformedPoll {
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

export interface TransformedTextChannel {
  createdAt: Date | null;
  createdTimestamp: number | null;
  defaultAutoArchiveDuration:
    | import("discord.js").ThreadAutoArchiveDuration
    | null
    | undefined;
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

export interface TransformedMessageMentions {
  channels: (TransformedTextChannel | undefined)[];
  everyone: boolean;
  guild: TransformedGuild | null | undefined;
  members: (TransformedMember | undefined)[];
  parsedUsers: (TransformedUser | undefined)[];
  roles: TransformedRole[];
  users: (TransformedUser | undefined)[];
}

export interface TransformedMessageSnapshot {
  id: string | null;
  channelId: string | null;
  author: TransformedUser | undefined;
  content: string | null;
  createdAt: Date | null;
  editedAt: Date | null;
  flags: Readonly<import("discord.js").MessageFlagsBitField>;
  mentions: TransformedMessageMentions | undefined;
}

export interface TransformedMessage {
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

export const transformUserPrimaryGuild = (
  userPrimaryGuild: UserPrimaryGuild | null,
): TransformedUserPrimaryGuild => ({
  badge: userPrimaryGuild?.badge,
  identityEnabled: userPrimaryGuild?.identityEnabled,
  identityGuildId: userPrimaryGuild?.identityGuildId,
  tag: userPrimaryGuild?.tag,
});

export const transformUser = (
  user: User,
  concise: boolean = false,
): TransformedUser | undefined => {
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

export const transformRole = (role: Role): TransformedRole => {
  const base: TransformedRole = {
    color: role.color,
    createdAt: role.createdAt,
    createdTimestamp: role.createdTimestamp,
    deletable:
      "deletable" in role
        ? (role as Role & { deletable?: boolean }).deletable
        : undefined,
    guildId:
      "guildId" in role
        ? (role as Role & { guildId?: string }).guildId
        : undefined,
    hoist: role.hoist,
    id: role.id,
    managed: role.managed,
    name: role.name,
    position: role.position,
    flags: role.flags,
    permissions: role.permissions,
    mentionable: role.mentionable,
    mention:
      "mention" in role
        ? (role as Role & { mention?: string }).mention
        : undefined,
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

export const transformAttachment = (
  attachment: Attachment,
): TransformedAttachment | undefined => {
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

export const transformTextChannel = (
  channel: TextChannel,
  _concise: boolean = false,
): TransformedTextChannel | undefined => {
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

export const transformEmbeds = (embeds: Embed[]): TransformedEmbed[] => {
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

export const transformGuild = (
  guild: Guild,
  _concise: boolean = false,
): TransformedGuild | undefined => {
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

export const transformPoll = (
  poll: Poll | null,
): TransformedPoll | undefined => {
  if (poll) {
    return {
      allowMultiselect: poll.allowMultiselect,
      answers: poll.answers.map((answer) => ({
        emoji: answer.emoji
          ? (transformEmoji(answer.emoji as GuildEmoji, true) ?? null)
          : null,
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

export const transformMessageMentions = (
  mentions: MessageMentions,
): TransformedMessageMentions | undefined => {
  if (mentions) {
    return {
      channels: mentions.channels.size
        ? mentions.channels.map((channel) =>
            transformTextChannel(channel as TextChannel, true),
          )
        : [],
      everyone: mentions.everyone,
      guild: mentions.guild
        ? (transformGuild(mentions.guild, true) ?? null)
        : null,
      members: mentions.members?.size
        ? mentions.members.map((member: GuildMember) =>
            transformMember(member, true),
          )
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

export const transformMessageSnapshot = (
  messageSnapshot: import("discord.js").MessageSnapshot,
): TransformedMessageSnapshot | undefined => {
  if (messageSnapshot) {
    return {
      id: messageSnapshot.id,
      channelId: messageSnapshot.channelId,
      author: messageSnapshot.author
        ? transformUser(messageSnapshot.author, true)
        : undefined,
      content: messageSnapshot.content,
      createdAt: messageSnapshot.createdAt,
      editedAt: messageSnapshot.editedAt,
      flags: messageSnapshot.flags,
      mentions: transformMessageMentions(messageSnapshot.mentions),
    };
  }
};

export const transformActivity = (
  activity: Activity,
): TransformedActivity | undefined => {
  if (activity) {
    return {
      name: activity.name,
      state: activity.state,
      type: activity.type,
      url: activity.url,
    };
  }
};

export const transformPresence = (
  presence: Presence | null,
): TransformedPresence | undefined => {
  if (presence) {
    return {
      activities: presence.activities.map((activity: Activity) =>
        transformActivity(activity),
      ),
      clientStatus: presence.clientStatus,
      guild: presence.guild ? transformGuild(presence.guild, true) : undefined,
      member: presence.member
        ? transformMember(presence.member, true)
        : undefined,
      status: presence.status,
      user: presence.user ? transformUser(presence.user, true) : undefined,
      userId: presence.userId,
    };
  }
};

export const transformVoice = (
  voice: VoiceState,
): TransformedVoice | undefined => {
  if (voice) {
    return {
      channel: voice.channel
        ? (transformTextChannel(
            voice.channel as unknown as TextChannel,
            true,
          ) ?? null)
        : null,
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

export const transformMember = (
  member: GuildMember,
  concise: boolean = false,
): TransformedMember | undefined => {
  if (member) {
    // Build Enhanced Role Colors for gradient/holographic support.
    // member.roles.color is the highest role with a non-zero color.
    const colorRole = member.roles?.color;
    let roleColorsData: {
      primary: string;
      secondary: string | null;
      tertiary: string | null;
    } | null = null;
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

export const transformEmoji = (
  emoji: GuildEmoji,
  _concise: boolean = false,
): TransformedEmoji | undefined => {
  if (emoji) {
    return {
      animated: emoji.animated,
      createdAt: emoji.createdAt,
      createdTimestamp: emoji.createdTimestamp,
      id: emoji.id,
      identifier: emoji.identifier,
      name: emoji.name,
      imageUrl:
        typeof (emoji as GuildEmoji & { imageUrl?: () => string }).imageUrl ===
        "function"
          ? (emoji as GuildEmoji & { imageUrl: () => string }).imageUrl()
          : null,
    };
  }
};

export const transformReaction = (
  reaction: MessageReaction | PartialMessageReaction,
): TransformedReaction | undefined => {
  if (reaction) {
    return {
      count: reaction.count,
      countDetails: {
        burst: reaction.countDetails.burst,
        normal: reaction.countDetails.normal,
      },
      emoji: transformEmoji(reaction.emoji as GuildEmoji, true),
      users: reaction.users.cache.map((user: User) =>
        transformUser(user, true),
      ),
    };
  }
};

export const transformSticker = (sticker: Sticker): TransformedSticker => ({
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

export const transformMessageRoot = (
  message: Message,
): Record<string, unknown> => {
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
    reactions: message.reactions.cache.map(
      (reaction: MessageReaction | PartialMessageReaction) =>
        transformReaction(reaction),
    ),
    // MessageReference | null
    reference: message.reference,
    // CommandInteractionResolvedData | null
    // resolved: message.resolved, // circular reference
    roleSubscriptionData: message.roleSubscriptionData
      ? {
          id: (
            message.roleSubscriptionData as unknown as Record<string, unknown>
          ).id,
        }
      : null,
    stickers: message.stickers?.map((sticker) =>
      transformSticker(sticker as Sticker),
    ),
    system: message.system,
    // thread: message.thread, // circular reference
    tts: message.tts,
    type: message.type,
    url: message.url,
    webhookId: message.webhookId,
  };
};
