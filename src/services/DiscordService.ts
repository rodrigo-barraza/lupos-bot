import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import crypto from "crypto";
import {
  Collection,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  } from "discord.js";
import type { Message, Client, GuildMember, User, Presence, VoiceState, MessageReaction, PartialMessageReaction, PartialMessage, Interaction, Guild, TextChannel, GuildChannel, Collection as DiscordCollection } from "discord.js";
import { GetColorName } from "hex-color-to-color-name";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import config from "#root/config.js";

import { rolesVideogames, warcraftClasses, warcraftFactions } from "#root/arrays/roles.js";
import channels from "#root/arrays/channels.js";

import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import YouTubeService from "#root/services/YouTubeService.js";
import MongoService from "#root/services/MongoService.js";
import PrismService from "#root/services/PrismService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import AIService from "#root/services/AIService.js";
import type { ChatMessage, CaptionMapObject, TranscriptionMapObject } from "#root/services/AIService.js";
import CurrentService from "#root/services/CurrentService.js";

import BirthdayJob from "#root/jobs/scheduled/BirthdayJob.js";
import ActivityRoleAssignmentJob from "#root/jobs/scheduled/ActivityRoleAssignmentJob.js";

import PermanentTimeOutJob from "#root/jobs/scheduled/PermanentTimeOutJob.js";
import RandomTagJob from "#root/jobs/scheduled/RandomTagJob.js";
import ServerIconJob from "#root/jobs/scheduled/ServerIconJob.js";
import CountdownIconJob from "#root/jobs/scheduled/CountdownIconJob.js";
import EventReactJob from "#root/jobs/event-driven/ReactJob.js";

import utilities from "#root/utilities.js";
import type { TransformedPrismResponse } from "#root/types/prism.js";
// EXTRACTED MODULES (Phase 1 decomposition)
import DeletedMessageLogger from "#root/services/discord/DeletedMessageLogger.js";
import DiscordState from "#root/services/discord/DiscordState.js";
import type { QueuedMessageData } from "#root/services/discord/DiscordState.js";
import ReactionHighlights from "#root/services/discord/ReactionHighlights.js";
import PresenceTracker from "#root/services/discord/PresenceTracker.js";

import LogFormatter from "#root/formatters/LogFormatter.js";

import {
  MessageConstant,
  APRIL_FOOLS_MODE,
  EXPLOSION_GIFS,
  YOUTUBE_BUTTON_ACTIONS,
  MILLISECONDS_PER_DAY,
  MONGO_DB_NAME,
} from "#root/constants.js";
import CensorService from "#root/services/CensorService.js";
import { kickIfTooNew, kickIfForbiddenCombo, purgeByAccountAge } from "#root/services/AccountGuardService.js";


/**
 * Fetch guild members with automatic retry on Gateway rate limits (opcode 8).
 * Discord.js throws GatewayRateLimitError when the gateway rejects the
 * REQUEST_GUILD_MEMBERS payload — this is NOT a REST error and won't be
 * caught by the REST rate-limit handler. We catch it here and wait the
 * advertised retry_after duration before retrying.


 */
async function fetchMembersWithRetry(guild: Guild, maxRetries: number = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await guild.members.fetch();
    } catch (error: unknown) {
      const isGatewayRateLimit =
        (error as Error & { data?: { retry_after?: number, opcode?: number } }).constructor?.name === "GatewayRateLimitError" ||
        ((error as Error & { data?: { retry_after?: number, opcode?: number } }).data?.retry_after && (error as Error & { data?: { retry_after?: number, opcode?: number } }).data?.opcode === 8);

      if (isGatewayRateLimit && attempt < maxRetries) {
        const waitMs = Math.ceil(((error as Error & { data?: { retry_after?: number, opcode?: number } }).data?.retry_after || 30) * 1000) + 1000;
        console.warn(
          `⏳ [fetchMembersWithRetry] Gateway rate-limited (attempt ${attempt}/${maxRetries}). ` +
          `Retrying in ${(waitMs / 1000).toFixed(1)}s...`
        );
        await new Promise((resolve: (value: void | PromiseLike<void>) => void) => setTimeout(resolve, waitMs));
      } else {
        throw error;
      }
    }
  }
  throw new Error("fetchMembersWithRetry failed");
}

const args = process.argv.slice(2);
const mode = args.find((arg: string) => arg.startsWith("mode="))?.split("=")[1];

interface MessageProcessingData {
  index: number;
  recentMessage: Message;
  member: GuildMember | null;
  user: User;
  isBot: boolean;
  isLastMessage: boolean;
  userMessageXofY: number;
  sequentialUserMessages: number;
  dateIdFormat: string;
  repliedMessage?: Message;
}

/**
 * Resolve a userId into memberMentionsCollection or userMentionsCollection.
 * Checks cache first, then falls back to guild API fetch.
 * Deduplicates logic previously repeated in name-match and group-reference blocks.
 */
async function ensureMentionPopulated(userId: string, {
  message, memberMentionsCollection, userMentionsCollection,
  participantsMembersCollection, participantsUsersCollection,
  logPrefix = "",
}: {
  message: import("discord.js").Message;
  memberMentionsCollection: import("discord.js").Collection<string, import("discord.js").GuildMember>;
  userMentionsCollection: import("discord.js").Collection<string, import("discord.js").User>;
  participantsMembersCollection: import("discord.js").Collection<string, import("discord.js").GuildMember>;
  participantsUsersCollection: import("discord.js").Collection<string, import("discord.js").User>;
  logPrefix?: string;
}) {
  if (memberMentionsCollection.has(userId)) return;
  const member =
    participantsMembersCollection.get(userId) ||
    (message as Message).guild?.members?.cache?.get(userId);
  const user = participantsUsersCollection.get(userId);
  if (member) {
    memberMentionsCollection.set(userId, member);
  } else if (user) {
    userMentionsCollection.set(userId, user);
  } else if ((message as Message).guild) {
    try {
      const fetchedMember =
        await DiscordUtilityService.retrieveMemberFromGuildById(
          (message as Message).guild!,
          userId,
        );
      if (fetchedMember) {
        memberMentionsCollection.set(userId, fetchedMember);
      }
    } catch {
      console.warn(
        `${logPrefix} [DiscordService] Could not fetch member ${userId} from guild`,
      );
    }
  }
}

/**
 * Resolve a Discord member/user to their avatar URL with consistent sizing.
 * Returns null if the source doesn't support displayAvatarURL.
 */
function resolveAvatarUrl(source: User | GuildMember) {
  return source?.displayAvatarURL?.({ extension: "png", size: 512 }) || null;
}
// function to split emoji name and id, example: <:monkaHmm:722280797025075271>
async function splitEmojiNameAndId(emoji: string) {
  const match = emoji.match(/<(a)?:(.+):(\d+)>/);
  if (match) {
    return {
      animated: !!match[1],
      name: match[2],
      id: match[3],
    };
  }
  return null;
}

async function extractEmojisFromAllMessage(
  message: Message,
  localMongo: import("mongodb").MongoClient,
  type: string = "EMOJI",
) {
  // Returns a Collection of emojis with their captions
  const messageEmojisCollection = new Collection<string, unknown>();
  const messageEmojis =
    (message as Message).content.split(" ").filter((part: string) => /<(a)?:.+:\d+>/g.test(part)) ||
    [];

  if (messageEmojis.length > 0) {
    // Prepare all emoji URLs and create a mapping
    const emojiUrls: string[] = [];
    const emojiMapping = new Map(); // Map URL to original emoji string

    for (const emoji of messageEmojis) {
      const parsedEmoji = emoji.replace(/[\n#]/g, "");
      const parts = parsedEmoji.split(":");
      const lastPart = parts[parts.length - 1] || "";
      const emojiId = lastPart.slice(0, -1);
      const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.png`;

      emojiUrls.push(emojiUrl);
      emojiMapping.set(emojiUrl, emoji);
    }

    // Caption all images at once
    const { imagesMap } = await AIService.captionImages(
      emojiUrls,
      localMongo,
      type,
    );

    // Map the results back to the original emojis
    for (const [_hash, emojiData] of imagesMap) {
      const originalEmoji = emojiMapping.get(emojiData.url);
      if (originalEmoji) {
        messageEmojisCollection.set(originalEmoji, emojiData);
      }
    }
  }

  return messageEmojisCollection;
}

async function generateDescription(
  systemPrompt: string, // should stay the same
  message: Message, // should stay the same
  participant: User | GuildMember, //is either user or member
  who: "MENTIONED" | "SECONDARY" | string,
  participantIndex: number, // used only for who='MENTIONED' or 'SECONDARY'
  messages: Message[], // should stay the same
  participantsAvatarsCollection: DiscordCollection<string, string | null>, // should stay the same
  participantsBannersCollection: DiscordCollection<string, string | null>, // should stay the same
  conversation: Record<string, unknown>[] | undefined,
  member: GuildMember | undefined,
  user: User | undefined,
  captionsMap: Map<string, string>, // pre-computed Map<url, caption> from batch captioning
) {
  if (!user) {
    if (member) {
      user = member.user;
    } else if (participant) {
      if ("user" in participant) {
        user = participant.user;
      } else {
        user = participant as User;
      }
    }
  }

  if (!user) {
    console.error("No user found for participant:", participant);
    return systemPrompt;
  }

  let messageSentAt: string | null = null;
  let messageSentAtRelative: string | null = null;
  const combinedNames = utilities.getCombinedNamesFromUserOrMember({
    member,
    user,
  });

  if (messages?.length) {
    const lastMessageSentByUser = messages.find(
      (message: Message) => message.author.id === user.id,
    );
    if (lastMessageSentByUser) {
      const lastMessageDateTime = TemporalHelpers.fromMillis(
        lastMessageSentByUser.createdTimestamp,
      );
      messageSentAt = TemporalHelpers.format(lastMessageDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a");
      messageSentAtRelative = TemporalHelpers.toRelative(lastMessageDateTime);
    }
  }

  if (who === "PRIMARY") {
    systemPrompt += `\n\n# About me: ${combinedNames}`;
    systemPrompt += `\n- PRIMARY TARGET: You're replying to me only (aware of others but ignore them)`;
  } else if (who === "SECONDARY" || who === "MENTIONED") {
    systemPrompt += `\n\n# ${participantIndex}. ${combinedNames}`;

  }

  // Inject avatar/banner URLs and pre-computed descriptions
  const avatarUrl = participantsAvatarsCollection.get(user.id);
  const bannerUrl = participantsBannersCollection.get(user.id);
  if (avatarUrl) {
    const avatarCaption = captionsMap?.get(avatarUrl);
    systemPrompt += `\n- Avatar URL: ${avatarUrl}`;
    if (avatarCaption) {
      systemPrompt += `\n- Avatar description: ${avatarCaption}`;
    }
  }
  if (bannerUrl) {
    const bannerCaption = captionsMap?.get(bannerUrl);
    systemPrompt += `\n- Banner URL: ${bannerUrl}`;
    if (bannerCaption) {
      systemPrompt += `\n- Banner description: ${bannerCaption}`;
    }
  }

  const totalMessages = messages.filter(
    (message: Message) => message.author.id === user.id,
  ).length;
  if (totalMessages) {
    systemPrompt += `\n- Total from the last ${messages.length} messages: ${totalMessages} messages`;
  }

  if (user?.id) {
    systemPrompt += `\n- Discord user ID tag (use this to mention/tag them): <@${user.id}>`;
  }
  if (member?.nickname) {
    systemPrompt += `\n- Nickname: ${member?.nickname}`;
  } // Server-specific nickname
  if (user?.globalName) {
    systemPrompt += `\n- Name: ${user.globalName}`;
  } // Discord nickname
  if (user?.username) {
    systemPrompt += `\n- Username: ${user.username}`;
  } // Discord username

  const presence = member?.presence;
  if (presence?.status) {
    systemPrompt += `\n- Status: ${presence.status}`; // online, idle, dnd, offline
    if (presence.status === "online") {
      if (presence.clientStatus) {
        const platforms = Object.keys(presence.clientStatus);
        systemPrompt += `\n- Active on: ${platforms.join(", ")}`;
      }
    }
  }
  if (presence?.activities && presence.activities.length > 0) {
    const customStatus = presence.activities.find((a: import("discord.js").Activity) => a.type === 4);
    if (customStatus?.state) {
      systemPrompt += `\n- Custom status: "${customStatus.state}"`;
    }

    // Current activities (playing games, listening to music, etc.)
    const activities = presence.activities
      .filter((a: import("discord.js").Activity) => a.type !== 4)
      .map((a: import("discord.js").Activity) => {
        const types = [
          "Playing",
          "Streaming",
          "Listening to",
          "Watching",
          "Custom",
          "Competing",
        ];
        const state = a.state ? `: (${a.state})` : "";
        return `${types[a.type]} ${a.name}${state}`;
      });
    if (activities.length > 0) {
      systemPrompt += `\n- Activities: ${activities.join(", ")}`;
    }
  }

  if (user?.accentColor) {
    // User must be force-fetched to get this property
    const toHex = (d: number) => "#" + d.toString(16).padStart(6, "0").toUpperCase();
    const hexColor = toHex(user.accentColor);
    const colorName = GetColorName ? GetColorName(hexColor) : hexColor;
    systemPrompt += `\n- Profile color (their choice of color): ${colorName} (${hexColor})`;
  }

  if (who === "PRIMARY") {
    const createdDateTime = TemporalHelpers.fromMillis(user.createdTimestamp);
    const accountCreatedAt = TemporalHelpers.format(createdDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a");
    const accountCreatedAtRelative = TemporalHelpers.toRelative(createdDateTime);
    systemPrompt += `\n- Account creation date: ${accountCreatedAt} (${accountCreatedAtRelative})`;
  }
  if (messageSentAt && messageSentAtRelative) {
    systemPrompt += `\n- Last message sent on: ${messageSentAt} (${messageSentAtRelative})`;
  }

  // is timed out
  if (member?.communicationDisabledUntilTimestamp) {
    const disabledDateTime = TemporalHelpers.fromMillis(
      member.communicationDisabledUntilTimestamp,
    );
    if (member.communicationDisabledUntilTimestamp > Date.now()) {
      systemPrompt += `\n- Timed out until: ${TemporalHelpers.toRelative(disabledDateTime)}`;
    } else {
      systemPrompt += `\n- Last timed out at: ${TemporalHelpers.toRelative(disabledDateTime)}`;
    }
  }
  // when they joined the server
  if (member && member.joinedTimestamp) {
    const joinedDateTime = TemporalHelpers.fromMillis(member.joinedTimestamp);
    const serverJoinDateAt = TemporalHelpers.format(joinedDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a");
    const serverJoinDateRelative = TemporalHelpers.toRelative(joinedDateTime);
    systemPrompt += `\n- Join date: ${serverJoinDateAt} (${serverJoinDateRelative})`;
  }
  // is boosting the server
  if (member?.premiumSinceTimestamp) {
    const boostDateTime = TemporalHelpers.fromMillis(member.premiumSinceTimestamp);
    const boostDateAt = TemporalHelpers.format(boostDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a");
    const boostDateRelative = TemporalHelpers.toRelative(boostDateTime);
    systemPrompt += `\n- Boosting since: ${boostDateAt} (${boostDateRelative})`;
  }

  // + Permissions
  if (member?.permissions?.has("Administrator")) {
    systemPrompt += `\n- Has administrator permissions`;
  }
  const modPerms = [
    "ManageMessages",
    "KickMembers",
    "BanMembers",
    "ManageRoles",
  ];
  const hasModPerms = modPerms.filter((perm: string) => member?.permissions?.has(perm as import("discord.js").PermissionResolvable));
  if (hasModPerms.length > 0) {
    systemPrompt += `\n- Moderation permissions: ${hasModPerms.join(", ")}`;
  }
  const channelPerms =
    member && (message as Message).channel ? member.permissionsIn((message as Message).channel as TextChannel) : null;
  if (channelPerms) {
    if (!channelPerms.has("SendMessages")) {
      systemPrompt += `\n- Cannot send messages in this channel`;
    }
    if (!channelPerms.has("ViewChannel")) {
      systemPrompt += `\n- Cannot view this channel (but was mentioned)`;
    }
  }
  // - Permissions

  if (!member) {
    systemPrompt += `\n- They have left the server and are no longer in the chat because they ran away.`;
  } else {
    // + Manageable
    if (member.kickable) {
      systemPrompt += `\n- You can kick or ban them from the server`;
    } else {
      systemPrompt += `\n- You cannot kick or ban them from the server. You do not have permission to do so.`;
    }
    if (member.manageable) {
      systemPrompt += `\n- You can manage this user's roles`;
    } else {
      systemPrompt += `\n- You cannot manage this user's roles.`;
    }
    // - Manageable
    // + Server Roles
    if (member.roles?.cache.size > 1) {
      systemPrompt += `\n- Roles: ${member.roles.cache
        .filter((role: import("discord.js").Role) => role.name !== "@everyone")
        .map((role: import("discord.js").Role) => role.name)
        .join(", ")}`;
      if (member.roles.highest) {
        systemPrompt += `\n- Current highest role: ${member.roles.highest.name}`;

      }
    } else {
      systemPrompt += `\n- Roles: No roles`;
    }
    // - Server Roles
    if (member.displayHexColor) {
      systemPrompt += `\n- Display name color (dependant on current highest role): ${GetColorName(member?.displayHexColor)} (${member.displayHexColor})`;
    }
  }

  // is it a bot
  if (user.bot) {
    systemPrompt += `\n- They are a bot`;
  }

  // + Voice Channel Details
  if (member?.voice?.channel) {
    systemPrompt += `\n- In voice channel: ${member.voice.channel.name}`;
    if (member.voice.deaf || member.voice.selfDeaf) {
      systemPrompt += `\n- Deafened in voice`;
    }
    if (member.voice.mute || member.voice.selfMute) {
      systemPrompt += `\n- Muted in voice`;
    }
    const voiceState = member.voice as VoiceState & { cameraOn?: boolean; streaming?: boolean };
    if (voiceState.streaming) {
      systemPrompt += `\n- Streaming in voice`;
    }
    if (voiceState.cameraOn) {
      systemPrompt += `\n- Camera on in voice`;
    }
    if (voiceState.suppress) {
      systemPrompt += `\n- Suppressed in voice`;
    }
    if (voiceState.requestToSpeakTimestamp) {
      systemPrompt += `\n- Requested to speak in voice`;
    }
  }
  // - Voice Channel Details

  if (who === "PRIMARY") {
    systemPrompt += `\n\n## My conversation summary `;
    systemPrompt += `\n${conversation}`;
  } else if (who === "SECONDARY") {
    systemPrompt += `\n\n## The conversation summary of ${combinedNames}`;
    systemPrompt += `\n${conversation}`;
  }
  return systemPrompt;
}

async function buildAndGenerateReply({
  conversation,
  conversationsCollection,
  memberMentionsCollection,
  messagesEmojisCollection,
  messagesImagesCollection,
  newSystemPrompt,
  participantsAvatarsCollection,
  participantsBannersCollection,
  participantsCollection,
  participantsMembersCollection,
  participantsUsersCollection,
  queuedDatum,
  userMentionsCollection,
  localMongo,
}: {
  conversation: Record<string, unknown>[];
  conversationsCollection: import("discord.js").Collection<string, Record<string, unknown>[]>;
  memberMentionsCollection: import("discord.js").Collection<string, import("discord.js").GuildMember>;
  messagesEmojisCollection: import("discord.js").Collection<string, unknown>;
  messagesImagesCollection: import("discord.js").Collection<string, unknown>;
  newSystemPrompt: string;
  participantsAvatarsCollection: import("discord.js").Collection<string, string>;
  participantsBannersCollection: import("discord.js").Collection<string, string>;
  participantsCollection: import("discord.js").Collection<string, import("discord.js").GuildMember | import("discord.js").User | { id: string }>;
  participantsMembersCollection: import("discord.js").Collection<string, import("discord.js").GuildMember>;
  participantsUsersCollection: import("discord.js").Collection<string, import("discord.js").User>;
  queuedDatum: { message: import("discord.js").Message; recentMessages: import("discord.js").Collection<string, import("discord.js").Message>; actionType?: string };
  userMentionsCollection: import("discord.js").Collection<string, import("discord.js").User>;
  localMongo: import("mongodb").MongoClient;
}) {
  // Build the system prompt
  const { message, recentMessages } = queuedDatum;
  const client = message.client;
  const bot = client.user;
  let systemPrompt = newSystemPrompt;

  let generatedText: string = "";
  const serverContext: { title?: string; keywords?: string | string[]; description?: string }[] = [];
  let image: unknown = null;
  let audioRef: string | null = null;
  try {
    if (
      (message as Message).guildId === config.GUILD_ID_PRIMARY ||
      (message as Message).guildId === config.GUILD_ID_TESTING
    ) {
      // Match recent messages and user names against custom context keywords
      const customContextWhitemane = MessageConstant.customContextWhitemane;
      const serverContextSet = new Set<{ title?: string; keywords?: string | string[]; description?: string }>();

      const contextWithPatterns = customContextWhitemane.map((context: { keywords: string | string[] }) => {
        const keywords = Array.isArray(context.keywords)
          ? context.keywords
          : context.keywords.split(/[,\s]+/);
        const patterns = keywords.map(
          (keyword: string) =>
            new RegExp(
              `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
              "i",
            ),
        );
        return { context, patterns };
      });

      // Search recent messages for custom context keyword matches
      for (const recentMessage of recentMessages.values()) {
        let searchText = `${(recentMessage as Message).cleanContent}`;

        if ((recentMessage as Message).author) {
          searchText += ` ${(recentMessage as Message).author?.globalName} ${(recentMessage as Message).author?.username} ${(recentMessage as Message).author?.displayName}`;
        }

        searchText = searchText.toLowerCase();

        for (const { context, patterns } of contextWithPatterns) {
          if (patterns.some((pattern: RegExp) => pattern.test(searchText))) {
            serverContextSet.add(context);
          }
        }
      }
      serverContext.push(...serverContextSet);
    }

    systemPrompt = `# Discord client information`;
    systemPrompt += `\n- Your name: ${utilities.getCombinedNamesFromUserOrMember({ user: bot })}`;
    systemPrompt += `\n- Your discord user ID tag: <@${bot.id}>`;
    systemPrompt += `\n- To mention, tag or reply to someone, you do it by mentioning their Discord user ID tag. For example, to mention me, you would type <@${bot.id}>.`;

    const guild = (message as Message).guild;
    if (guild) {
      const bans = await guild.bans.fetch();

      systemPrompt += `\n\n# Discord server information`;
      systemPrompt += `\n- You are in the discord server called: ${guild.name}.`;
      if (guild.description) {
        systemPrompt += `\n- The server description is: ${guild.description}`;
      }
      systemPrompt += `\n- This server has ${guild.memberCount} members, ${guild.channels.cache.size} channels, and ${guild.premiumSubscriptionCount} nitro boosts.`;
      if (bans.size) {
        systemPrompt += `\n- ${bans.size} bans on record.`;
      }


      // who is in voice chat
      const voiceChannelMembers = guild.channels.cache.filter(
        (channel: import("discord.js").GuildBasedChannel) => ((channel.type as unknown as number) === 2 || (channel.type as unknown as string) === "GUILD_VOICE") && (channel as import("discord.js").VoiceChannel).members && (channel as import("discord.js").VoiceChannel).members.size > 0,
      );
      if (voiceChannelMembers.size) {
        systemPrompt += `\n- The following voice channels have members in them:`;
        for (const channel of voiceChannelMembers.values()) {
          const chan = channel as import("discord.js").VoiceChannel | import("discord.js").StageChannel;
          systemPrompt += `\n  - ${chan.name} (${chan.members.size} members)`;
          for (const member of chan.members.values()) {
            systemPrompt += `\n    - ${utilities.getCombinedNamesFromUserOrMember({ member })}`;
          }
        }
      }
    }
    if (message?.channel) {
      const channel = message.channel as import("discord.js").TextChannel | import("discord.js").ThreadChannel;
      systemPrompt += `\n\n# Discord channel information`;
      if (channel.name) {
        systemPrompt += `\n- You are in the channel called: ${channel.name}`;
      }
      if ((channel as import("discord.js").TextChannel).topic) {
        systemPrompt += `\n- The channel topic is: ${(channel as import("discord.js").TextChannel).topic}.`;
      }

    }

    let participantMember: GuildMember | undefined;
    let participantUser: User | undefined;
    let participantConversation: Record<string, unknown>[] | undefined;

    // ── Batch caption ALL avatar and banner images in parallel ────
    // Collect all URLs, caption them in one Promise.all, then inject
    // descriptions into the system prompt per-participant.
    const allVisionUrls: { url: string; userId: string }[] = [];
    for (const [userId, url] of participantsAvatarsCollection) {
      allVisionUrls.push({ url, userId });
    }
    for (const [userId, url] of participantsBannersCollection) {
      allVisionUrls.push({ url, userId });
    }

    // Build a Map<url, caption> from the batch result
    const captionsMap = new Map();
    if (allVisionUrls.length > 0) {
      const { imagesMap } = await AIService.captionImages(
        allVisionUrls,
        localMongo,
        "SMALL",
      );
      for (const [, mapObject] of imagesMap) {
        captionsMap.set(mapObject.url, mapObject.caption);
      }
      console.log(
        `🖼️ [DiscordService] Batch captioned ${captionsMap.size}/${allVisionUrls.length} ` +
        `avatar/banner images in parallel`,
      );
    }

    // Process primary participant (message author)
    if (participantsCollection?.size) {
      const primaryParticipant = participantsCollection.get(message.author?.id);
      if (primaryParticipant && (primaryParticipant as { user?: User }).user) {
        participantMember = participantsMembersCollection.get(
          message.author?.id,
        );
        participantUser = participantsUsersCollection.get(message.author?.id);
        participantConversation = conversationsCollection.get(
          message.author?.id,
        );
      }
      systemPrompt = await generateDescription(
        systemPrompt,
        message,
        message.author,
        "PRIMARY",
        0,
        Array.from(recentMessages.values()),
        participantsAvatarsCollection,
        participantsBannersCollection,
        participantConversation,
        participantMember,
        participantUser,
        captionsMap,
      );
    }

    // Cheap heuristic: might the user be asking for image generation?
    // This avoids two expensive AI calls (name extraction + group detection)
    // on every message. The agent still decides autonomously — this just
    // controls whether we pre-fetch avatars and detect group refs.
    const messageText = (message.cleanContent || (message as Message).content || "").toLowerCase();
    const hasImageAttachments = message.attachments?.some((a: import("discord.js").Attachment) =>
      a.contentType?.startsWith("image/"),
    );
    const mightBeImageRequest =
      hasImageAttachments ||
      /\b(draw|paint|sketch|illustrate|render|generate|create|make|design|depict|redraw|reimagine)\b.*\b(image|picture|painting|illustration|art|artwork|portrait|scene|drawing|me|us|everyone|him|her|them)\b/i.test(messageText) ||
      /\b(draw|paint|sketch|illustrate|render|depict)\b/i.test(messageText);

    // Detect untagged user names in image generation requests
    // e.g. "draw Rodrigo as a samurai" without @Rodrigo
    const untaggedMatchedUserIds = new Set<string>();
    if (mightBeImageRequest) {
      // Build list of known participants (exclude bot, already-mentioned users, and message author)
      // The author is excluded because "draw your X" shouldn't match the author's name.
      // If the author wants to draw themselves, they should use "draw me" or @mention themselves.
      const alreadyMentionedIds = new Set([
        ...(memberMentionsCollection?.keys() || []),
        ...(userMentionsCollection?.keys() || []),
        bot.id,
        message.author?.id,
      ]);

      const knownParticipants: { id: string; username: string; displayName: string }[] = [];
      const addedIds = new Set();
      for (const [id, member] of participantsMembersCollection.entries()) {
        if (alreadyMentionedIds.has(id)) continue;
        addedIds.add(id);
        knownParticipants.push({
          id,
          username: member.user?.username || "",
          displayName:
            member.displayName ||
            member.user?.globalName ||
            member.user?.username ||
            "",
        });
      }
      // Also check participantsUsersCollection for users not in members
      for (const [id, user] of participantsUsersCollection.entries()) {
        if (alreadyMentionedIds.has(id) || addedIds.has(id)) continue;
        addedIds.add(id);
        knownParticipants.push({
          id,
          username: user.username || "",
          displayName: user.globalName || user.username || "",
        });
      }
      // Also check the guild member cache (covers users from reactions, voice, other channels, etc.)
      // Pre-filter: only include members whose name appears in the message (avoids sending thousands of names to AI)
      if (guild?.members?.cache) {
        const messageTextLower = (
          message.cleanContent ||
          (message as Message).content ||
          ""
        ).toLowerCase();
        for (const [id, member] of guild.members.cache.entries()) {
          if (
            alreadyMentionedIds.has(id) ||
            addedIds.has(id) ||
            member.user?.bot
          )
            continue;
          const username = (member.user?.username || "").toLowerCase();
          const displayName = (
            member.displayName ||
            member.user?.globalName ||
            ""
          ).toLowerCase();
          // Only include if the name (3+ chars) appears in the message text
          const hasNameMatch =
            (username.length >= 3 && messageTextLower.includes(username)) ||
            (displayName.length >= 3 && messageTextLower.includes(displayName));
          if (!hasNameMatch) continue;
          addedIds.add(id);
          knownParticipants.push({
            id,
            username: member.user?.username || "",
            displayName:
              member.displayName ||
              member.user?.globalName ||
              member.user?.username ||
              "",
          });
        }
      }

      if (knownParticipants.length > 0) {
        // Deterministic name matching — word-boundary check against the pre-filtered list.
        // knownParticipants already only contains names that appear in the message text,
        // so this is a refinement pass using word boundaries to avoid false positives.
        const messageTextForMatch = (message.cleanContent || (message as Message).content || "").toLowerCase();
        const matchedIds: string[] = [];
        for (const participant of knownParticipants) {
          const names = [participant.username, participant.displayName]
            .filter((n: string) => n && n.length >= 3)
            .map((n: string) => n.toLowerCase());
          for (const name of names) {
            // Use word-boundary-aware check: the name must not be inside another word
            const index = messageTextForMatch.indexOf(name);
            if (index === -1) continue;
            const charBefore = index > 0 ? messageTextForMatch[index - 1] : " ";
            const charAfter = index + name.length < messageTextForMatch.length
              ? messageTextForMatch[index + name.length]
              : " ";
            const isBoundaryBefore = !/\w/.test(charBefore);
            const isBoundaryAfter = !/\w/.test(charAfter);
            if (isBoundaryBefore && isBoundaryAfter) {
              matchedIds.push(participant.id);
              break; // One match per participant is enough
            }
          }
        }

        for (const matchedId of matchedIds) {
          untaggedMatchedUserIds.add(matchedId);
          // Add to memberMentionsCollection so they get full generateDescription treatment
          await ensureMentionPopulated(matchedId, {
            message, memberMentionsCollection, userMentionsCollection,
            participantsMembersCollection, participantsUsersCollection,
            logPrefix: "🏷️",
          });
        }

        if (untaggedMatchedUserIds.size > 0) {
          console.log(
            `🏷️ [DiscordService] Detected ${untaggedMatchedUserIds.size} untagged user(s) in draw request: ${[...untaggedMatchedUserIds].join(", ")}`,
          );
        }
      }
    }

    // Detect GROUP references (e.g. "draw the top 5 people here", "draw everyone")
    // Deterministic keyword/regex matching replaces the old AI classification call.
    // This handles mixed cases like "draw @Rodrigo surrounded by everyone" correctly.
    if (mightBeImageRequest) { // Only detect group refs when image generation is likely
      const groupText = (message.cleanContent || (message as Message).content || "").toLowerCase();

      // Check for "top N" pattern first (returns the specific number)
      const topNMatch = groupText.match(/\btop\s+(\d+)\b/);
      // Check for "the N of us" pattern
      const nOfUsMatch = groupText.match(/\bthe\s+(\d+)\s+of\s+us\b/);
      // Check for "everyone" / "all" / "everybody" / group slang
      const isEveryoneRef =
        /\b(everyone|everybody|every\s*one|all\s+of\s+us|everyone\s+else|the\s+boys|the\s+squad|the\s+gang|the\s+server|us\s+all)\b/i.test(groupText) ||
        // "all the chatters", "the chatters", "all chatters", "all the people", "all participants", etc.
        /\b(all\s+(?:the\s+)?)?(?:chatters|people|participants|members|peeps|folks|homies)\b/i.test(groupText) && /\b(draw|paint|sketch|illustrate|render|depict|generate|create|make|design)\b/i.test(groupText) ||
        // "the chat" as a standalone group reference (word boundary prevents matching "chatters" above)
        /\bthe\s+chat\b/i.test(groupText) ||
        // "all of them" / "all of these people"
        /\ball\s+of\s+(them|these)\b/i.test(groupText) ||
        // bare "draw all" / "draw all ..." where "all" is the group quantifier
        /\b(draw|paint|sketch|illustrate|render|depict)\s+all\b/i.test(groupText);

      let groupCount = 0;
      if (topNMatch) {
        groupCount = parseInt(topNMatch[1], 10);
      } else if (nOfUsMatch) {
        groupCount = parseInt(nOfUsMatch[1], 10);
      } else if (isEveryoneRef) {
        groupCount = 99; // Capped downstream
      }

      if (groupCount > 0) {
        console.log(
          `👥 [DiscordService] Detected group reference requesting ${groupCount} people`,
        );

        // Rank participants by message count in recentMessages (exclude bot only)
        const messageCounts = new Map();
        for (const message of recentMessages.values()) {
          const authorId = message.author?.id;
          if (!authorId || authorId === bot.id) continue;
          messageCounts.set(authorId, (messageCounts.get(authorId) || 0) + 1);
        }

        // Sort by message count (most active first), cap at groupCount
        const cap =
          groupCount === 99
            ? Math.min(messageCounts.size, 10) // "everyone" capped at 10
            : Math.min(groupCount, messageCounts.size);

        const topUserIds = [...messageCounts.entries()]
          .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
          .slice(0, cap)
          .map(([id]: [string, number]) => id);

        // Add the message author too (they said "us" / "the boys" — likely including themselves)
        if (!topUserIds.includes(message.author.id)) {
          topUserIds.unshift(message.author.id);
          // Keep within cap
          if (topUserIds.length > cap && cap > 0) topUserIds.pop();
        }

        for (const userId of topUserIds) {
          untaggedMatchedUserIds.add(userId);
          await ensureMentionPopulated(userId, {
            message, memberMentionsCollection, userMentionsCollection,
            participantsMembersCollection, participantsUsersCollection,
            logPrefix: "👥",
          });
        }

        if (topUserIds.length > 0) {
          console.log(
            `👥 [DiscordService] Auto-populated ${topUserIds.length} participants for group reference: ${topUserIds.join(", ")}`,
          );
        }
      }
    }

    // Detect self-referential requests in image generation messages.
    // The author is excluded from knownParticipants name matching (line 700), and
    // isn't in message.mentions when they only @mention the bot — so self-referential
    // requests would produce zero attached reference images without this block.
    //
    // Two-tier detection:
    //   1. Fast-path regex for common English patterns (zero latency, no API cost)
    //   2. Lightweight LLM fallback for everything regex can't cover:
    //      other languages, indirect refs, creative phrasings, slang
    //      (~200ms Haiku call — negligible against the ~50s total flow)
    if (mightBeImageRequest && !untaggedMatchedUserIds.has(message.author.id)) {
      const selfText = (message.cleanContent || (message as Message).content || "").toLowerCase();

      // ── Tier 1: Fast-path regex (English) ──────────────────────
      const hasSelfRefRegex =
        // "draw me", "paint myself", "create me as...", etc.
        /\b(draw|paint|sketch|illustrate|render|depict|generate|create|make|design|reimagine|redraw|turn|put|do)\b.*\b(me|myself)\b/i.test(selfText)
        // "my profile picture", "my pfp", "my cool avatar", etc.
        // Allows up to 3 intermediate words between "my" and the visual noun
        || /\b(my)\s+(?:\w+\s+){0,3}(portrait|face|avatar|picture|photo|image|drawing|painting|illustration|likeness|selfie|caricature|pfp|dp|pic|profile)\b/i.test(selfText)
        // "how would I look as...", "what would I look like..."
        || /\b(how|what)\s+would\s+I\s+look\b/i.test(selfText)
        // "a portrait/painting/picture of me"
        || /\b(portrait|painting|picture|photo|image|illustration|drawing|version|rendition|interpretation)\s+of\s+me\b/i.test(selfText);

      if (hasSelfRefRegex) {
        untaggedMatchedUserIds.add(message.author.id);
        console.log(
          `🪞 [DiscordService] Self-referential detected (regex fast-path) — adding author ${message.author.id} to image references`,
        );
      } else {
        // ── Tier 2: LLM fallback (multilingual, indirect refs) ───
        // Only runs when regex didn't match but image request is likely.
        // Uses the fastest model (~200ms) with a simple yes/no classification.
        try {
          const classificationResult = await AIService.generateText({
            systemPrompt: `You are a classifier. Determine if the user's message is asking for an image that involves THEMSELVES — their own appearance, their own profile picture, their own avatar, or any visual depiction of themselves.

This includes:
- Direct self-references in ANY language: "draw me", "dibújame", "dessine-moi", "画我", "나를 그려줘", "нарисуй меня", etc.
- Possessive references to their own image: "my profile picture", "mi foto de perfil", "mein Profilbild", etc.
- Indirect self-references: "how would I look as...", "turn my pic into...", "make that a renaissance version" (when referring to their own image)
- Hypothetical self-references: "what would I look like as a knight"
- Shorthand: "my pfp", "my dp", "my avi"

Respond with ONLY "yes" or "no". Nothing else.`,
            conversation: [
              {
                role: "user",
                content: message.cleanContent || (message as Message).content || "",
              },
            ],
            type: "ANTHROPIC",
            model: config.ANTHROPIC_LANGUAGE_MODEL_FAST,
            temperature: 0,
            tokens: 4,
          });

          const isSelfRef = classificationResult?.trim().toLowerCase() === "yes";
          if (isSelfRef) {
            untaggedMatchedUserIds.add(message.author.id);
            console.log(
              `🪞 [DiscordService] Self-referential detected (LLM fallback) — adding author ${message.author.id} to image references`,
            );
          }
        } catch (classifyErr: unknown) {
          console.warn(
            `🪞 [DiscordService] Self-referential LLM classification failed: ${(classifyErr as Error).message}`,
          );
        }
      }
    }

    // Process mentioned members
    if (memberMentionsCollection?.size) {
      // Skip the target user — they're already in "About me" above
      const filteredMemberMentions = memberMentionsCollection.filter(
        (member: GuildMember) => member.id !== message.author.id,
      );
      if (filteredMemberMentions.size > 0) {
        systemPrompt += `\n\n# Mentioned members in this server (${filteredMemberMentions.size})`;
        let currentUserCount = 0;
        for (const member of filteredMemberMentions.values()) {
          currentUserCount++;
          participantMember = participantsMembersCollection.get(member.id);
          // Member may not have sent messages — not in cache, so fetch from guild
          if (!participantMember) {
            participantMember =
              (await DiscordUtilityService.retrieveMemberFromGuildById(
                guild as Guild,
                member.id,
              )) || undefined;
          }
          participantUser = participantsUsersCollection.get(member.id);
          participantConversation = conversationsCollection.get(member.id);

          systemPrompt = await generateDescription(
            systemPrompt,
            message,
            member,
            "MENTIONED",
            currentUserCount,
            Array.from(recentMessages.values()),
            participantsAvatarsCollection,
            participantsBannersCollection,
            participantConversation,
            participantMember,
            participantUser,
            captionsMap,
          );
        }
      }
    }
    // Process mentioned users (not in this server)
    if (userMentionsCollection?.size) {
      systemPrompt += `\n\n# Mentioned users not in this server (${userMentionsCollection.size})`;
      let currentUserCount = 0;
      for (const user of userMentionsCollection.values()) {
        currentUserCount++;
        participantMember = participantsMembersCollection.get(user.id);
        // Member may not have sent messages — not in cache, so fetch from guild
        if (!participantMember) {
          participantMember =
            (await DiscordUtilityService.retrieveMemberFromGuildById(
              guild as Guild,
              user.id,
            )) || undefined;
        }
        participantUser = participantsUsersCollection.get(user.id);
        participantConversation = conversationsCollection.get(user.id);

        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          user,
          "MENTIONED",
          currentUserCount,
          Array.from(recentMessages.values()),
          participantsAvatarsCollection,
          participantsBannersCollection,
          participantConversation,
          participantMember,
          participantUser,
          captionsMap,
        );
      }
    }
    // Process secondary participants (size > 1 since it includes Lupos)
    if (participantsCollection?.size > 1) {
      // Skip users already listed in "About me" or "Mentioned members" to avoid duplication
      const filteredParticipants = participantsCollection.filter((participant: GuildMember | User | Record<string, unknown>) => {
        const pId = (participant as { user?: { id: string }, id?: string }).user?.id || (participant as { user?: { id: string }, id?: string }).id;
        if (!pId) return false;
        if (pId === message.author.id) return false;
        if (memberMentionsCollection?.has(pId)) return false;
        if (userMentionsCollection?.has(pId)) return false;
        return true;
      });
      if (filteredParticipants.size > 0) {
        systemPrompt += `\n\n# Secondary participants (${filteredParticipants.size})`;
        systemPrompt += `\nYou are aware of other participants in this conversation, but you are only replying to me.`;
      }
      let currentUserCount = 0;
      for (const participant of filteredParticipants.values()) {
        const pId = (participant as { user?: { id: string }, id: string }).user?.id || (participant as { id: string }).id;
        participantConversation = conversationsCollection.get(pId);
        participantMember = participantsMembersCollection.get(pId);
        participantUser = participantsUsersCollection.get(pId);
        currentUserCount++;
        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          participant as import("discord.js").User | import("discord.js").GuildMember,
          "SECONDARY",
          currentUserCount,
          Array.from(recentMessages.values()),
          participantsAvatarsCollection,
          participantsBannersCollection,
          participantConversation,
          participantMember,
          participantUser,
          captionsMap,
        );
      }
    }

    if (messagesEmojisCollection?.size) {
      systemPrompt += `\n\n# A list of custom emoji names and their descriptions in this conversation (${messagesEmojisCollection.size})`;
      systemPrompt += `\nTo use these emojis, simply type the name of the emoji. Good examples: <a:emoji_name:1065508812565528596>, <emoji_name:1065508812565528596>. Bad example: :emoji_name:`;

      for (const [emoji, emojiObj] of messagesEmojisCollection.entries()) {
        const emojiObject = emojiObj as { caption?: string };
        // systemPrompt += `\n- ${emoji}: ${emojiObject.caption}`;
        systemPrompt += `\n- ${emoji}: ${emojiObject.caption}`;
      }
    }

    // Server-specific context (customContextWhitemane matches) is now
    // injected via agentContext.serverContext in the agent path below.

    // Memory retrieval is now handled server-side by Prism's SystemPromptAssembler.
    // We only need to collect participant user IDs so Prism can scope its memory search.
    const guildId = (message as Message).guildId;
    const participantUserIds: string[] = [];
    if (guildId) {
      if (message.author?.id) participantUserIds.push(message.author.id);
      for (const [id] of memberMentionsCollection.entries()) {
        if (!participantUserIds.includes(id)) participantUserIds.push(id);
      }
      for (const [id] of userMentionsCollection.entries()) {
        if (!participantUserIds.includes(id)) participantUserIds.push(id);
      }
      // Add secondary participants
      if (participantsCollection?.size) {
        for (const participant of participantsCollection.values()) {
          const pId = (participant as { user?: { id: string }, id?: string }).user?.id || (participant as { user?: { id: string }, id?: string }).id;
          if (
            pId &&
            !participantUserIds.includes(pId)
          ) {
            participantUserIds.push(pId);
          }
        }
      }
    }

    // Trending data is now fetched and injected via agentContext
    // in the agent path below — no longer appended to systemPrompt here.

    const imageUrls: string[] = [];
    const imageLabels: string[] = []; // Tracks what each image in imageUrls represents
    const mentionsImageUrls: Record<string, unknown>[] = [];
    // This creates a shallow copy, which is no different than what we had before, can be changed back.
    let edittedMessageCleanContent = "";
    let composition = String(message.cleanContent);

    // Remove first occurrence of bot mention from the clean content '@Lupos'
    const botMentionSyntax = `@${bot.username}`;
    if (composition.includes(botMentionSyntax)) {
      composition = composition.replace(botMentionSyntax, "").trim();
    }


    // if has image attachment, check if messagesImagesCollection has any images using the message id as the key
    if (message.attachments && message.attachments.size > 0) {
      const attachmentImages = messagesImagesCollection.filter((value: unknown, key: string) => {
        return key.startsWith((message as Message).id);
      }) as import("discord.js").Collection<string, Map<string, { url: string }>>;
      if (attachmentImages.size > 0) {
        for (const imageObject of attachmentImages.first()!.values()) {
          const imageUrl = imageObject.url;
          imageLabels.push("Attached image from message");
          imageUrls.push(imageUrl);
        }
      }

      // Video attachments aren't in messagesImagesCollection (it's
      // image-only). Pass the raw video URL through as a reference, exactly
      // like a GIF — Prism fetches it and hands it to the model (Gemini
      // handles video natively), so no local frame extraction is needed.
      for (const attachment of (message as Message).attachments.values()) {
        if (attachment.contentType?.startsWith("video/")) {
          imageLabels.push("Attached video from message");
          imageUrls.push(attachment.url);
        }
      }
    }


    // Cache the message reference once — reused for avatar filtering below
    const cachedMessageReference = message.reference?.messageId
      ? await DiscordUtilityService.retrieveMessageReferenceFromMessage(message)
      : null;

    // If it's replying to a message with an image
    if (message.reference && message.reference.messageId) {
      const referencedMessageImages = messagesImagesCollection.filter(
        (value: unknown, key: string) => {
          return key.startsWith(message.reference!.messageId as string);
        },
      ) as import("discord.js").Collection<string, Map<string, { url: string }>>;
      // If the referenced message has an image in the collection, use that
      // (Only user messages are stored, not bot messages)
      if (referencedMessageImages && referencedMessageImages.size > 0) {
        const firstImages = referencedMessageImages.first();
        const imageUrl = firstImages ? firstImages.values().next().value?.url : undefined;
        if (imageUrl) {
          imageLabels.push("Replied-to message image");
          imageUrls.push(imageUrl);
        }
      } else {
        // If the referenced message is not in the collection, because we process a random amount of messages (5-100) ...
        // ... then we need to fetch the message and check if it has an attachment that is an image ...
        // ... this is a fallback in case the referenced message is not in the recent messages ...
        // ... along with bot messages (which are not stored in messagesImagesCollection)
        if (cachedMessageReference) {
          let foundImage = false;

          // Check attachments first (user-uploaded images)
          if (
            cachedMessageReference.attachments &&
            cachedMessageReference.attachments.size > 0
          ) {
            const imageAttachment = cachedMessageReference.attachments.find(
              (attachment: import("discord.js").Attachment) => {
                return (
                  attachment.contentType &&
                  attachment.contentType.startsWith("image/")
                );
              },
            );
            if (imageAttachment) {
              const imageUrl = imageAttachment.proxyURL || imageAttachment.url;
              imageLabels.push("Replied-to message image");
              imageUrls.push(imageUrl);
              foundImage = true;
            }

            // No image attachment, but there may be a video — pass its raw
            // URL through as a reference, just like a GIF. Prism/Gemini
            // handles the video, so no local frame extraction is needed.
            if (!foundImage) {
              const videoAttachment = cachedMessageReference.attachments.find(
                (attachment: import("discord.js").Attachment) =>
                  attachment.contentType?.startsWith("video/"),
              );
              if (videoAttachment) {
                imageLabels.push("Replied-to message video");
                imageUrls.push(videoAttachment.proxyURL || videoAttachment.url);
                foundImage = true;
              }
            }
          }

          // Check embeds for images (bot-generated images are sent via embeds,
          // Tenor/Giphy GIFs use embed.thumbnail or embed.video instead of embed.image)
          if (
            !foundImage &&
            cachedMessageReference.embeds &&
            cachedMessageReference.embeds.length > 0
          ) {
            for (const embed of cachedMessageReference.embeds) {
              // Prefer static image sources (first frame for GIFs), fall back to video
              const staticImageUrl =
                embed.image?.proxyURL || embed.image?.url ||
                embed.thumbnail?.proxyURL || embed.thumbnail?.url;
              const videoUrl = embed.video?.proxyURL || embed.video?.url;
              const embedImageUrl = staticImageUrl || videoUrl;

              if (embedImageUrl) {
                // If we only have a video/GIF URL (no static thumbnail), extract
                // the first frame so the model receives a proper static image
                if (!staticImageUrl && videoUrl) {
                  try {
                    const videoResponse = await fetch(videoUrl);
                    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
                    const contentType = videoResponse.headers.get("content-type") || "";
                    if (contentType.includes("gif") || contentType.includes("image")) {
                      const { default: sharp } = await import("sharp");
                      const firstFrameBuffer = await sharp(videoBuffer, { animated: false }).png().toBuffer();
                      const firstFrameDataUrl = `data:image/png;base64,${firstFrameBuffer.toString("base64")}`;
                      imageLabels.push("Replied-to message image (embedded, first frame)");
                      imageUrls.push(firstFrameDataUrl);
                      foundImage = true;
                      console.log(`🖼️ [DiscordService] Extracted first frame from GIF embed for reference`);
                      break;
                    }
                  } catch (frameError: unknown) {
                    console.warn(`🖼️ [DiscordService] First-frame extraction failed, using video URL directly: ${(frameError as Error).message}`);
                  }
                }

                if (!foundImage) {
                  imageLabels.push("Replied-to message image (embedded)");
                  imageUrls.push(embedImageUrl);
                  foundImage = true;
                }
                break;
              }
            }
          }

          if (foundImage) {
            console.log(`🖼️ [DiscordService] Captured reference image from replied-to message (${cachedMessageReference.author?.bot ? "bot" : "user"})`);
          }
        }
      }
    }

    // Caption attached/replied images and add descriptions to the message
    if (imageUrls.length > 0) {
      const { imagesMap } = await AIService.captionImages(
        imageUrls,
        localMongo,
        "SMALL",
      );
      // Build [ATTACHED REFERENCE IMAGES] block with indexed descriptions
      edittedMessageCleanContent += `\n[ATTACHED REFERENCE IMAGES]`;
      let index = 0;
      for (const mapObject of imagesMap.values()) {
        const label = imageLabels[index] || `Attachment ${index + 1}`;
        edittedMessageCleanContent += `\n  ${index + 1}. ${label}: ${mapObject.caption}`;
        index++;
      }
    }
    // If it mentions a user with an avatar, use that avatar as the image
    // Track which user IDs have already had their avatar added to prevent
    // duplicates across tagged mentions and untagged name-match paths.
    const avatarUserIdsAdded = new Set();
    if (
      message.mentions &&
      message.mentions.users.size > 0
    ) {
      const repliedUserId = cachedMessageReference?.author?.id;

      let mentionedMembersOrUsersWithAvatars: import("discord.js").Collection<string, GuildMember> | import("discord.js").Collection<string, User> = (message.mentions.members || new Collection<string, GuildMember>()).filter(
        (member: GuildMember) => {
          // Exclude bot and the replied-to user (if this is a reply)
          return (
            member.id !== bot.id &&
            member.id !== repliedUserId &&
            member.user.avatar
          );
        },
      );

      if (mentionedMembersOrUsersWithAvatars.size === 0) {
        mentionedMembersOrUsersWithAvatars = message.mentions.users.filter(
          (user: User) => {
            // Exclude bot and the replied-to user (if this is a reply)
            return (
              user.id !== bot.id && user.id !== repliedUserId && user.avatar
            );
          },
        );
      }

      if (mentionedMembersOrUsersWithAvatars.size > 0) {
        for (const memberOrUser of mentionedMembersOrUsersWithAvatars.values()) {
          const avatarUrl = resolveAvatarUrl(memberOrUser);
          if (avatarUrl) {
            mentionsImageUrls.push({ userId: memberOrUser.id, url: avatarUrl });
          }
        }
        // Attach avatar images as base64 references for generate_image
        // (no text injection — avatar URLs are already per-participant in the system prompt)
        for (const mentionImg of mentionsImageUrls) {
          if (avatarUserIdsAdded.has(mentionImg.userId)) continue;
          avatarUserIdsAdded.add(mentionImg.userId);
          const userDisplayName = await DiscordUtilityService.getDisplayName(
            message,
            mentionImg.userId as string,
          );
          imageLabels.push(`${userDisplayName}'s avatar/profile picture`);
          imageUrls.push(mentionImg.url as string);
        }
      }
    }
    // Handle avatars for untagged matched users (detected by name, not @tag)
    if (untaggedMatchedUserIds.size > 0) { // Agent-era: always resolve avatar images
      const repliedUserId = cachedMessageReference?.author?.id;

      for (const matchedId of untaggedMatchedUserIds) {
        // Skip if already handled by @mention block above
        if (avatarUserIdsAdded.has(matchedId)) continue;
        if (mentionsImageUrls.some((m: Record<string, unknown>) => m.userId === matchedId)) continue;
        // Skip bot and replied-to user
        if (matchedId === bot.id || matchedId === repliedUserId) continue;

        // Try to get the member from the guild for their avatar
        let matchedMember = participantsMembersCollection.get(matchedId);
        if (!matchedMember && guild) {
          // For self-referential requests, (message as Message).member is the most reliable source
          if (matchedId === message.author?.id && (message as Message).member) {
            matchedMember = (message as Message).member || undefined;
          } else {
            matchedMember =
              (await DiscordUtilityService.retrieveMemberFromGuildById(
                guild as Guild,
                matchedId,
              )) || undefined;
          }
        }
        const matchedUser = participantsUsersCollection.get(matchedId) ||
          (matchedId === message.author?.id ? message.author : null);
        const avatarSource = matchedMember || matchedUser;

        const avatarUrl = resolveAvatarUrl(avatarSource as import("discord.js").User | import("discord.js").GuildMember);
        if (avatarUrl) {
          mentionsImageUrls.push({ userId: matchedId, url: avatarUrl });
        }
      }
      // Attach untagged user avatars as base64 references for generate_image
      // (no text injection — avatar URLs are already per-participant in the system prompt)
      const uncaptionedUrls = mentionsImageUrls.filter(
        (m: Record<string, unknown>) => !avatarUserIdsAdded.has(m.userId as string) && !imageUrls.includes(m.url as string),
      );
      for (const mentionImg of uncaptionedUrls) {
        if (avatarUserIdsAdded.has(mentionImg.userId)) continue;
        avatarUserIdsAdded.add(mentionImg.userId);
        const userDisplayName = await DiscordUtilityService.getDisplayName(
          message,
          mentionImg.userId as string,
        );
        imageLabels.push(`${userDisplayName}'s avatar/profile picture`);
        imageUrls.push(mentionImg.url as string);
      }
    }

    // If emotion emojis are present, add them to the composition
    const emojisInMessage = await extractEmojisFromAllMessage(
      message,
      localMongo,
      "SMALL",
    );
    if (emojisInMessage && emojisInMessage.size > 0) {
      for (const [emoji, emojiObj] of emojisInMessage.entries()) {
        const emojiObject = emojiObj as { url: string; caption?: string; name?: string };
        if (emojiObject && emojiObject.url) {
          const emojiData = await splitEmojiNameAndId(emoji);
          const emojiName = emojiData ? emojiData.name : (emojiObject.name || emoji);
          const caption = emojiObject.caption || "";
          imageLabels.push(`Emoji: ${emojiName}${caption ? ` — ${caption}` : ""}`);
          imageUrls.push(emojiObject.url);
        }
      }
    }

    // ── Build agentContext for Prism ─────────────────────────────
    // Prism's SystemPromptAssembler handles personality, tool policy,
    // guidelines, and somatic state via AgentPersonaRegistry and
    // SomaticStateService. Lupos only passes platform-specific runtime:
    //   - platformContext: Discord server/channel/participant info, image captions
    //   - Top-level: platform identifier, guild/channel IDs, participant IDs
    const messageGuildId = (message as Message).guildId || null;
    const messageChannelId = (message as Message).channelId || null;

    // ── Platform Context (Discord-specific runtime data) ──────────
    const platformContext: Record<string, unknown> = {};
    if (systemPrompt) {
      platformContext.description = systemPrompt;
    }
    if (serverContext?.length) {
      let serverContextText = "\n\n# Relevant information for this conversation";
      for (const contextItem of serverContext) {
        serverContextText += `\n\n# ${contextItem.title}`;
        serverContextText += `\n- Keywords: ${contextItem.keywords}`;
        serverContextText += `\n- Description: ${contextItem.description}`;
      }
      platformContext.serverContext = serverContextText;
    }
    if (edittedMessageCleanContent?.trim()) {
      platformContext.imageContext = edittedMessageCleanContent;
    }
    if (messageGuildId) {
      let idsBlock = `# Discord IDs\n- Guild ID: ${messageGuildId}`;
      if (messageChannelId) idsBlock += `\n- Channel ID: ${messageChannelId}`;
      platformContext.ids = idsBlock;
    }

    const agentContext: Record<string, unknown> = {
      platform: "discord",
      guildId: messageGuildId,
      channelId: messageChannelId,
      participantUserIds: participantUserIds.length > 0 ? participantUserIds : null,
      aprilFoolsMode: APRIL_FOOLS_MODE,
      platformContext,
    };

    // Clock Crew context — if this is the Clock Crew guild, build the
    // clocks list for injection into the persona. The persona identity
    // is handled by AgentPersonaRegistry based on guildId.
    if ((message as Message).guildId === config.GUILD_ID_CLOCK_CREW) {
      try {
        const { ClockCrewConstants } = await import("#root/constants.js");
        const clockWithoutProfiles = ClockCrewConstants.clocks_without_profiles;
        const clocksWithProfiles = ClockCrewConstants.clocks_with_profiles;
        const allClocks = [...clockWithoutProfiles, ...clocksWithProfiles];

        if (allClocks.length) {
          let clockCtx = `\n# List of Clocks`;
          for (const clock of allClocks) {
            clockCtx += `\n- ${clock.name}`;
            if (clock.description) {
              clockCtx += `\n  - Description: ${clock.description}`;
            }
          }
          agentContext.clockCrewContext = clockCtx;
        }
      } catch (clockErr: unknown) {
        console.warn(`⏰ [DiscordService] Clock Crew context failed: ${(clockErr as Error).message}`);
      }
    }

    // ── Build agent conversation ─────────────────────────────────
    // No system prompt injected here — Prism's SystemPromptAssembler
    // builds the complete prompt (persona + agentContext blocks).
    const agentConversation = [...(conversation || [])] as unknown as ChatMessage[];

    // Attach collected image data URLs to the last user message
    // so the agent (and the generate_image tool) can access them
    if (imageUrls.length > 0) {
      const lastUserMsg = [...agentConversation]
        .reverse()
        .find((m) => m.role === "user");
      if (lastUserMsg) {
        if (!lastUserMsg.images) lastUserMsg.images = [];
        lastUserMsg.images.push(...imageUrls);

        // Add image index with descriptions so the agent knows which
        // image is which and what it looks like
        if (imageLabels.length > 0) {
          const labelLines = imageLabels
            .map((label: string, i: number) => {
              const caption = captionsMap?.get(imageUrls[i]);
              return caption
                ? `  ${i + 1}. ${label}: ${caption}`
                : `  ${i + 1}. ${label}`;
            })
            .join("\n");
          lastUserMsg.content += `\n\n[ATTACHED REFERENCE IMAGES]\n${labelLines}`;
        }
      }
    }

    // Check if message was deleted before starting expensive agent call
    if (DiscordState.isMessageCancelled((message as Message).id)) {
      console.log(
        `🗑️ [DiscordService] Message ${(message as Message).id} was deleted before agent call, aborting.`,
      );
      return {
        generatedText: null,
        image: null,
        audioRef: null,
        promptForImagePromptGeneration: null,
      };
    }

    // ── Single agent call — Prism handles personality + tools ─────
    const agentModel =
      config.LANGUAGE_MODEL_TYPE === "GOOGLE"
        ? config.GOOGLE_LANGUAGE_MODEL_FAST
        : config.LANGUAGE_MODEL_TYPE === "OPENAI"
          ? config.FAST_LANGUAGE_MODEL_OPENAI
          : config.LANGUAGE_MODEL_TYPE === "LOCAL"
            ? config.FAST_LANGUAGE_MODEL_LOCAL
            : config.ANTHROPIC_LANGUAGE_MODEL_FAST;

    const agentResponse = await PrismService.generateAgentResponse({
      messages: agentConversation,
      type: config.LANGUAGE_MODEL_TYPE || "",
      model: agentModel || "",
      agentContext,
      maxTokens: 16_384, // Lupos text is ~1 sentence, but tool-call JSON (generate_audio compositions) can be 3-5K tokens
      temperature: config.LANGUAGE_MODEL_TEMPERATURE ? parseFloat(config.LANGUAGE_MODEL_TEMPERATURE) : undefined,
      thinkingEnabled: true,
      thinkingBudget: 10_000,
      username: message.author?.username || "unknown",
      ...AIService._getTraceParams(),
    });


    generatedText = agentResponse.text || "";

    // Extract any generated images from the agent response
    if (agentResponse.images?.length > 0) {
      const firstImage = agentResponse.images[0];
      if (firstImage.data) {
        image = Buffer.from(firstImage.data, "base64");
      } else if (firstImage.minioRef) {
        // If only minioRef, we can still use it
        image = firstImage.minioRef;
      }
    }

    // Extract any generated audio from the agent response
    audioRef = agentResponse.audioRef || null;

    // If no top-level audioRef, check tool results for audioRef (from generate_audio or synthesize_speech)
    if (!audioRef && agentResponse.toolResults?.length > 0) {
      for (const toolResult of agentResponse.toolResults) {
        const resultObject = toolResult.result as Record<string, unknown> | null;
        if (resultObject?.audioRef) {
          audioRef = resultObject.audioRef as string;
          break;
        }
      }
    }

    // Sanitize the response
    generatedText = utilities.fixBareMentions(generatedText);
    generatedText = utilities.removeMentions(generatedText);
    generatedText = CensorService.removeFlaggedWords(generatedText);

  } catch (error: unknown) {
    generatedText = "...";
    console.error(...LogFormatter.error("buildAndGenerateReply", error as Error));
  }
  return {
    generatedText,
    image,
    audioRef: audioRef ?? null,
  };
}

async function replyMessage(queuedDatum: { message: import("discord.js").Message; recentMessages: import("discord.js").Collection<string, import("discord.js").Message>; actionType?: string }, localMongo: import("mongodb").MongoClient) {
  // Handles incoming Discord messages and message updates
  const message = queuedDatum.message;
  const _messages = queuedDatum.recentMessages;
  const actionType = queuedDatum.actionType;

  const client = message.client;
  const guild = (message as Message).guild;
  const channel = (message as Message).channel;
  const member = (message as Message).member;
  const user = message.author;
  const combinedNames = utilities.getCombinedNamesFromUserOrMember({
    member,
    user,
  });

  CurrentService.setUser(user);
  CurrentService.setMessage(message);
  CurrentService.setStartTime(Date.now());
  CurrentService.clearTraceId();

  // Check if message was deleted before we start processing
  if (DiscordState.isMessageCancelled((message as Message).id)) {
    console.log(
      `🗑️ [DiscordService] Message ${(message as Message).id} was deleted before processing started, skipping.`,
    );
    DiscordState.cancelledMessageIds.delete((message as Message).id);
    return;
  }

  let combinedGuildInformation: string | null = null;
  let combinedChannelInformation: string | null = null;

  // Update status to say who it is replying to
  DiscordUtilityService.setUserActivity(
    client,
    `Replying to ${combinedNames}...`,
  );

  const start = performance.now();

  if (guild) {
    combinedGuildInformation =
      utilities.getCombinedGuildInformationFromGuild(guild) || null;
    combinedChannelInformation =
      utilities.getCombinedChannelInformationFromChannel(channel as import("discord.js").TextChannel) || null;
    console.log(...LogFormatter.receivedGuildMessage(message as Message, actionType || ""));
  } else {
    console.log(...LogFormatter.receivedDirectMessage(message as Message, actionType || ""));
  }


  // Generate custom emoji reaction
  const customEmojiReact =
    await AIService.generateTextCustomEmojiReactFromMessage(
      message as Message,
      localMongo,
    );
  if (customEmojiReact) {
    try {
      await message.react(customEmojiReact);
    } catch { /* emoji reaction failed — non-critical */ }
  }

  // Image detection is no longer needed — the agent decides autonomously
  // whether to generate images via the generate_image tool.

  // Extract content from recent messages

  const {
    conversation,
    newSystemPrompt,
    conversationsCollection,
    memberMentionsCollection,
    messagesEmojisCollection,
    messagesImagesCollection,
    messagesTranscriptionsCollection: _messagesTranscriptionsCollection,
    participantsAvatarsCollection,
    participantsBannersCollection,
    participantsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    userMentionsCollection,
  } = await extractContentFromMessages(queuedDatum, localMongo);




  // Check if message was deleted during content extraction
  if (DiscordState.isMessageCancelled((message as Message).id)) {
    console.log(
      `🗑️ [DiscordService] Message ${(message as Message).id} was deleted during content extraction, aborting.`,
    );
    DiscordState.cancelledMessageIds.delete((message as Message).id);
    return;
  }


  const { generatedText, image, audioRef } =
    await buildAndGenerateReply({
      conversation: conversation as unknown as Record<string, unknown>[],
      conversationsCollection: conversationsCollection as import("discord.js").Collection<string, Record<string, unknown>[]>,
      memberMentionsCollection,
      messagesEmojisCollection,
      messagesImagesCollection,
      newSystemPrompt,
      participantsAvatarsCollection: participantsAvatarsCollection as import("discord.js").Collection<string, string>,
      participantsBannersCollection: participantsBannersCollection as import("discord.js").Collection<string, string>,
      participantsCollection: participantsCollection as unknown as import("discord.js").Collection<string, GuildMember | User | { id: string }>,
      participantsMembersCollection,
      participantsUsersCollection,
      queuedDatum,
      userMentionsCollection,
      localMongo,
    });

  const generatedTextResponse = generatedText;
  const generatedImage = image;
  const generatedAudioRef = audioRef;

  // (Image conversations are already saved per-call inside generateImage)


  // GENERATE SUMMARY — use first ~5 words of the agent response instead of a separate LLM call
  const textSummary = generatedTextResponse
    ? `💬 ${generatedTextResponse.replace(/[*_~`#>]/g, "").split(/\s+/).slice(0, 5).join(" ").substring(0, 100)}…`
    : "";
  DiscordUtilityService.setUserActivity(client, textSummary);

  if (!generatedTextResponse && !generatedImage && !generatedAudioRef) {
    await message.reply("...");
    DiscordState.lastMessageSentTime = TemporalHelpers.nowISO();

    console.error(`❌ [DiscordService:replyMessage] NO RESPONSE GENERATED
${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild?.id || "", channel?.id || "", (message as Message).id)}` : ""}`);
    return;
  }
  // SEND THE REPLY
  try {
    // Check if message was deleted during reply generation
    if (DiscordState.isMessageCancelled((message as Message).id)) {
      console.log(
        `🗑️ [DiscordService] Message ${(message as Message).id} was deleted during reply generation, not sending reply.`,
      );
      DiscordState.cancelledMessageIds.delete((message as Message).id);
      return;
    }
    await message.fetch();

    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      generatedTextResponse,
      generatedImage as string | Buffer | null,
      null,
      generatedAudioRef,
    );

  } catch (error: unknown) {
    console.warn(`❌ [DiscordService:replyMessage] MESSAGE NOT FOUND (OR DELETED)
            ${error}
    ${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
    ${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
    ${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
    ${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild?.id || "", channel?.id || "", (message as Message).id)}` : ""}`);

    return;
  }

  DiscordState.lastMessageSentTime = TemporalHelpers.nowISO();
  CurrentService.setEndTime(Date.now());

  // Fire-and-forget memory extraction from the conversation
  const guildId = (message as Message).guildId;
  if (guildId && conversation?.length > 0) {
    const memoryParticipants: { id: string; displayName?: string; username?: string }[] = [];
    // Collect participant info for extraction
    if (participantsCollection?.size) {
      for (const participant of participantsCollection.values()) {
        const pId = participant?.user?.id;
        const pUser = participant?.user || participant;
        if (pId) {
          memoryParticipants.push({
            id: pId,
            username: pUser?.username || "",
            displayName:
              pUser?.globalName || pUser?.username || "",
          });
        }
      }
    }
    // Include mentioned users
    if (memberMentionsCollection?.size) {
      for (const member of memberMentionsCollection.values()) {
        const alreadyAdded = memoryParticipants.some((p: { id: string }) => p.id === member.id);
        if (!alreadyAdded) {
          memoryParticipants.push({
            id: member.id,
            username: member.user?.username || "",
            displayName:
              member.displayName ||
              member.user?.globalName ||
              member.user?.username,
          });
        }
      }
    }
    if (memoryParticipants.length > 0) {
      // Only send the last ~10 user messages for extraction (skip system/assistant)
      const recentUserMessages = conversation
        .filter((m: ChatMessage) => m.role === "user")
        .slice(-10);

      PrismService.extractMemories({
        guildId,
        channelId: (message as Message).channel?.id || "",
        messages: recentUserMessages,
        participants: memoryParticipants.map((p: { id: string; displayName?: string; username?: string }) => p.displayName || p.username || p.id),
        sourceMessageId: (message as Message).id,
        traceId: CurrentService.getTraceId() || undefined,
      })
        .then((result: TransformedPrismResponse) => {
          if (result?.count && result.count > 0) {
            console.log(
              `🧠 [DiscordService] Extracted ${result.count} memory/memories from conversation.`,
            );
          }
        })
        .catch((error: Error) => {
          console.warn(
            `🧠 [DiscordService] Memory extraction failed: ${error.message}`,
          );
        });
    }
  }

  const end = performance.now();
  const duration = end - start;

  if (guild) {
    console.log(
      ...LogFormatter.replyGuildMessageSuccess(
        message,
        generatedTextResponse || "",
        duration,
      ),
    );
  } else {
    console.log(
      ...LogFormatter.replyDirectMessageSuccess(
        message,
        generatedTextResponse || "",
        duration,
      ),
    );
  }

  const models = CurrentService.getModels();
  const modelTypes = CurrentService.getModelTypes();

  const db = localMongo.db(MONGO_DB_NAME);
  const collection2 = db.collection("MetricsMessageGeneration");
  await collection2.insertOne({
    models: models.join(", "),
    modelTypes: modelTypes.join(", "),
    guildId: (message as Message).guild?.id || "DM",
    guildName: (message as Message).guild?.name || "DM",
    channel: ((message as Message).channel as TextChannel)?.name || "DM",
    channelId: (message as Message).channel?.id || "DM",
    messageId: (message as Message).id,
    userId: message.author?.id,
    userName: message.author?.username,
    content: message.cleanContent,
  });
  CurrentService.clearModels();
  CurrentService.clearModelTypes();
  CurrentService.clearTraceId();

  return;
}

async function generateUserConversationAndHash(
  queuedDatum: { message: import("discord.js").Message; recentMessages: import("discord.js").Collection<string, import("discord.js").Message>; actionType?: string },
  recentMessage: Message,
  localMongo: import("mongodb").MongoClient,
) {
  // Create a hash of all the this specific user's recent messages
  const { message, recentMessages } = queuedDatum;
  const userMessages = recentMessages.filter(
    (message: Message) => message.author.id === (recentMessage as Message).author.id,
  );
  const userMessagesAsText = userMessages
    .map((message: Message) => (message as Message).content)
    .join("\n\n");
  const hash = crypto
    .createHash("sha256")
    .update(userMessagesAsText)
    .digest("hex");
  // Check if we already have a conversation for this hash
  const db = localMongo.db(MONGO_DB_NAME);
  const collection = db.collection("UserConversationSummaries");
  const existingConversation = await collection.findOne({ hash });
  if (existingConversation) {
    return existingConversation.conversation;
  }
  // If not, generate a new conversation
  const userName = DiscordUtilityService.getNameFromItem(recentMessage) || "Unknown";
  const cleanUserName = DiscordUtilityService.getCleanUsernameFromUser(
    message.author,
  );
  const conversation = await AIService.generateTextFromUserConversation(
    userName,
    cleanUserName,
    userMessagesAsText,
  );
  // Store the conversation and hash in the database
  await collection.insertOne({
    hash,
    userId: message.author.id,
    conversation,
    createdAt: new Date(),
  });
  return conversation;
}

async function extractContentFromMessages(
  queuedDatum: { message: import("discord.js").Message; recentMessages: import("discord.js").Collection<string, import("discord.js").Message>; actionType?: string },
  localMongo: import("mongodb").MongoClient,
  _maxSimultaneous: number = 50,
) {
  const functionName = "extractContentFromMessages";

  const { message, recentMessages } = queuedDatum;




  // All messages are kept as conversation context — bot messages, other users'
  // messages, and the current message. The agent needs the full channel history
  // to understand the ongoing discussion.
  const filteredRecentMessages = recentMessages;

  const totalMessages = filteredRecentMessages.size;

  // Determine how many messages to process — deterministic keyword heuristic
  // (no longer needs timing data or hourly breakdowns)
  const messagesToFetch =
    await AIService.generateTextDetermineHowManyMessagesToFetch(
      (message as Message).content,
      message,
      "",
    );

  console.log(
    `PROCESSING ${messagesToFetch} MESSAGES (out of ${totalMessages} available)`,
  );

  const recentXMessages = filteredRecentMessages.last(messagesToFetch);
  const client = message.client;


  // Initialize collections
  const participantsCollection = new Collection<string, { user: User; member: GuildMember | null; time?: number }>();
  const participantsAvatarsCollection = new Collection<string, string | null>();
  const participantsBannersCollection = new Collection<string, string | null>();
  const participantsUsersCollection = new Collection<string, User>();
  const participantsMembersCollection = new Collection<string, GuildMember>();
  let memberMentionsCollection = new Collection<string, GuildMember>();
  let userMentionsCollection = new Collection<string, User>();
  const messagesImagesCollection = new Collection<string, DiscordCollection<string, { url: string, caption: string }>>();
  const messagesTranscriptionsCollection = new Collection<string, DiscordCollection<string, { transcription: string }>>();
  const messagesEmojisCollection = new Collection<string, unknown>();
  const conversationsCollection = new Collection<string, unknown>();
  const conversation: ChatMessage[] = [];
  const newSystemPrompt = "";

  // Prepare all async operations
  const allPromises = {
    conversations: [] as { userId: string; promise: Promise<unknown> }[],
    emojis: [] as { messageId: string; promise: Promise<Collection<string, unknown>> }[],
    audio: [] as { message: Message; promise: Promise<{ transcriptionsMap: Map<string, TranscriptionMapObject> }> }[],
    images: [] as { message: Message; promise: Promise<{ images: string[]; imagesMap: Map<string, CaptionMapObject> }> }[],
    replies: [] as { messageId: string; referenceId: string; promise: Promise<Message | void | null> }[],
  };

  // First pass: collect all async operations
  const messageProcessingData: MessageProcessingData[] = [];

  if ((message as Message).guild) {
    let index = 0;
    const firstMessageDateTime = TemporalHelpers.fromMillis(
      recentXMessages[0].createdTimestamp,
    );
    const lastMessageDateTime = TemporalHelpers.fromMillis(
      recentXMessages[recentXMessages.length - 1].createdTimestamp,
    );
    let dateIdFormat = "yyMMddHHmmSSS";
    if (TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "hour")) {
      dateIdFormat = "mSSS";
    } else if (TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "day")) {
      dateIdFormat = "HmmSSS";
    } else if (TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "month")) {
      dateIdFormat = "dHHmmSSS";
    } else if (TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "year")) {
      dateIdFormat = "MddHHmmSSS";
    }

    // Pre-calculate message sequences
    const messageSequenceInfo = new Map();
    let currentSequenceAuthor = null;
    let _currentSequenceStart = -1;
    let currentSequenceMessages: number[] = [];

    for (let i = 0; i < recentXMessages.length; i++) {
      const message = recentXMessages[i];
      const isBot = message.author.id === client.user!.id;

      if (isBot) {
        // If we had a sequence going, finalize it
        if (currentSequenceMessages.length > 0) {
          const total = currentSequenceMessages.length;
          for (const [
            position,
            msgIndex,
          ] of currentSequenceMessages.entries()) {
            messageSequenceInfo.set(msgIndex, {
              xOfY: position + 1,
              total: total,
            });
          }
        }
        // Reset for bot message
        currentSequenceAuthor = null;
        _currentSequenceStart = -1;
        currentSequenceMessages = [];
        // Bot messages don't get sequence info
        messageSequenceInfo.set(i, { xOfY: 0, total: 0 });
      } else {
        // User message
        if (message.author.id !== currentSequenceAuthor) {
          // New author - finalize previous sequence if exists
          if (currentSequenceMessages.length > 0) {
            const total = currentSequenceMessages.length;
            for (const [
              position,
              msgIndex,
            ] of currentSequenceMessages.entries()) {
              messageSequenceInfo.set(msgIndex, {
                xOfY: position + 1,
                total: total,
              });
            }
          }
          // Start new sequence
          currentSequenceAuthor = message.author.id;
          _currentSequenceStart = i;
          currentSequenceMessages = [i];
        } else {
          // Same author - continue sequence
          currentSequenceMessages.push(i);
        }
      }
    }

    // Finalize the last sequence if it exists
    if (currentSequenceMessages.length > 0) {
      const total = currentSequenceMessages.length;
      for (const [position, msgIndex] of currentSequenceMessages.entries()) {
        messageSequenceInfo.set(msgIndex, {
          xOfY: position + 1,
          total: total,
        });
      }
    }

    // Now process messages with the correct counts
    for (const recentMessage of recentXMessages) {
      const member = recentMessage.member;
      const user = (recentMessage as Message).author;

      if (!user || !user.id) {
        console.warn(
          `❌ [DiscordService:getParticipants] User is null or missing ID in message: ${recentMessage.id}`,
        );
        index++;
        continue;
      }

      const isBot = user.id === client.user!.id;
      const isLastMessage = index === recentXMessages.length - 1;

      // Get the sequence info for this message
      const sequenceInfo = messageSequenceInfo.get(index) || {
        xOfY: 0,
        total: 0,
      };
      const userMessageXofY = sequenceInfo.xOfY;
      const sequentialUserMessages = sequenceInfo.total;

      const messageData: MessageProcessingData = {
        index,
        recentMessage,
        member: member ?? null,
        user,
        isBot,
        isLastMessage,
        userMessageXofY,
        sequentialUserMessages,
        dateIdFormat,
      };

      if (isBot) {
        // Process bot messages synchronously as they don't need API calls
        messageProcessingData.push(messageData);
      } else {
        // Collect user data
        const userExists = participantsCollection.get(user.id);
        if (!userExists) {
          participantsCollection.set(user.id, { user, member });

          // Queue conversation generation
          allPromises.conversations.push({
            userId: user.id,
            promise: generateUserConversationAndHash(
              queuedDatum,
              recentMessage,
              localMongo,
            ),
          });

          // Store avatar/banner URLs — the agent calls describe_image on-demand
          // instead of pre-captioning every avatar on every message.
          let avatarUrl: string | null = null, bannerUrl: string | null = null;
          if (user) {
            avatarUrl = user.avatar ? utilities.getDiscordAvatarUrl(user.id, user.avatar) : null;
            bannerUrl = user.banner ? utilities.getDiscordBannerUrl(user.id, user.banner) : null;
          }
          if (member) {
            if (member.avatar) {
              avatarUrl = utilities.getDiscordAvatarUrl(member.id, member.avatar);
            }
            if (member.banner) {
              bannerUrl = utilities.getDiscordBannerUrl(member.id, member.banner);
            }
          }

          if (avatarUrl) {
            participantsAvatarsCollection.set(user.id, avatarUrl);
          }
          if (bannerUrl) {
            participantsBannersCollection.set(user.id, bannerUrl);
          }
        } else if (userExists.time !== undefined && userExists.time < recentMessage.createdTimestamp) {
          userExists.time = recentMessage.createdTimestamp;
        }


        // Queue emoji extraction
        allPromises.emojis.push({
          messageId: recentMessage.id,
          promise: extractEmojisFromAllMessage(recentMessage, localMongo),
        });

        // Queue audio transcription
        const audioUrls =
          await DiscordUtilityService.extractAudioUrlsFromMessage(
            recentMessage,
          );
        if (audioUrls?.length) {
          allPromises.audio.push({
            message: recentMessage,
            promise: AIService.transcribeAudioUrls(
              audioUrls,
              recentMessage.id,
              localMongo,
            ),
          });
        }

        // Queue image captioning
        const imageUrls =
          await DiscordUtilityService.extractImageUrlsFromMessage(
            recentMessage,
          );
        if (imageUrls.length) {
          allPromises.images.push({
            message: recentMessage,
            promise: AIService.captionImages(imageUrls, localMongo, "IMAGE"),
          });
        }

        // Queue reply fetching
        if (recentMessage.reference?.messageId) {
          const channel = recentMessage.channel || (message as Message).channel;
          const repliedMessage = channel?.messages.cache.get(
            recentMessage.reference.messageId,
          );
          if (!repliedMessage) {
            allPromises.replies.push({
              messageId: recentMessage.id,
              referenceId: recentMessage.reference!.messageId,
              promise: channel?.messages
                .fetch(recentMessage.reference!.messageId as string)
                .catch((error: Error) => {
                  console.log(
                    `Could not fetch replied message ${recentMessage.reference?.messageId}:`,
                    error.message,
                  );
                  return null;
                }),
            });
          } else {
            messageData.repliedMessage = repliedMessage;
          }
        }

        // Store participants
        participantsUsersCollection.set(user.id, user);
        if (member) {
          participantsMembersCollection.set(member.id, member);
        }

        // Store mentions
        const userMentions = recentMessage.mentions.users;
        const memberMentions = recentMessage.mentions.members;
        if (userMentions?.size) {
          userMentionsCollection = new Collection([
            ...userMentionsCollection,
            ...userMentions,
          ]);
        }
        if (memberMentions?.size) {
          memberMentionsCollection = new Collection([
            ...memberMentionsCollection,
            ...memberMentions,
          ]);
        }

        messageProcessingData.push(messageData);
      }

      index++;
    }

    // Rest of your code remains the same...
    // Execute all promises in parallel
    const results = await Promise.allSettled([
      ...allPromises.conversations.map((item: { userId: string; promise: Promise<unknown> }) => item.promise),
      ...allPromises.emojis.map((item: { messageId: string; promise: Promise<Collection<string, unknown>> }) => item.promise),
      ...allPromises.audio.map((item: { message: Message; promise: Promise<{ transcriptionsMap: Map<string, TranscriptionMapObject> }> }) => item.promise),
      ...allPromises.images.map((item: { message: Message; promise: Promise<{ images: string[]; imagesMap: Map<string, CaptionMapObject> }> }) => item.promise),
      ...allPromises.replies.map((item: { messageId: string; referenceId: string; promise: Promise<Message | void | null> }) => item.promise),
    ]);

    // Process results
    let resultIndex = 0;

    // Process conversations
    for (const item of allPromises.conversations) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        conversationsCollection.set(item.userId, (result as PromiseFulfilledResult<unknown>).value);
      }
    }


    // Process emojis
    for (const _item of allPromises.emojis) {
      const result = results[resultIndex++] as PromiseSettledResult<Collection<string, unknown>>;
      if (result.status === "fulfilled" && result.value?.size) {
        for (const [emoji, emojiObject] of result.value.entries()) {
          messagesEmojisCollection.set(emoji, emojiObject);
        }
      }
    }

    // Process audio
    for (const item of allPromises.audio) {
      const result = results[resultIndex++] as PromiseSettledResult<{ transcriptionsMap: Map<string, TranscriptionMapObject> }>;
      if (result.status === "fulfilled") {
        const { transcriptionsMap } = result.value;
        messagesTranscriptionsCollection.set(item.message.id, new Collection(transcriptionsMap));
        for (const [hash, transcriptionObject] of transcriptionsMap.entries()) {
          console.log(
            ...LogFormatter.transcribeSuccess({
              functionName,
              message: item.message,
              audioUrl: transcriptionObject.url,
              transcription: transcriptionObject.transcription,
              cached: transcriptionObject.cached,
            }),
          );
        }
      }
    }

    // Process images
    for (const item of allPromises.images) {
      const result = results[resultIndex++] as PromiseSettledResult<{ images: string[]; imagesMap: Map<string, CaptionMapObject> }>;
      if (result.status === "fulfilled") {
        const { imagesMap } = result.value;
        messagesImagesCollection.set(item.message.id, new Collection(imagesMap));
        for (const [hash, mapObject] of imagesMap.entries()) {
          console.log(
            ...LogFormatter.captionSuccess({
              functionName,
              hash,
              message: item.message,
              imageUrl: mapObject.url,
              caption: mapObject.caption,
              cached: mapObject.cached,
            }),
          );
        }
      }
    }

    // Process replies
    const repliesMap: Record<string, Message> = {};
    for (const item of allPromises.replies) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled" && result.value) {
        repliesMap[item.messageId] = result.value as Message;
      }
    }

    // Build conversation with all collected data
    for (const messageData of messageProcessingData) {
      const {
        recentMessage,
        isBot,
        isLastMessage,
        userMessageXofY,
        sequentialUserMessages,
        dateIdFormat,
      } = messageData;

      if (isBot) {
        let imageDescription: string | null = null, imageSize: number = 0, imageWidth: number = 0, imageHeight: number = 0;
        let attachmentContext: string | null = null;

        // Bot has attached an image to this message
        if (recentMessage?.attachments?.size > 0) {
          const imageAttached = recentMessage.attachments.find((attachment: import("discord.js").Attachment) =>
            attachment.contentType && attachment.contentType.includes("image"),
          );
          if (imageAttached) {
            if (imageAttached.description) {
              imageDescription = imageAttached.description;
            } else if (imageAttached.title) {
              imageDescription = imageAttached.title;
            } else {
              imageDescription = imageAttached.name.replace(/[_-]/g, " ");
            }

            if (imageAttached.size) {
              imageSize = imageAttached.size / 1024 / 1024;
            }

            if (imageAttached.width && imageAttached.height) {
              imageWidth = imageAttached.width;
              imageHeight = imageAttached.height;
            }
          }
        }

        // Append reactions to content
        let reactionsContent = "";
        if (recentMessage.reactions?.cache?.size > 0) {
          reactionsContent = `\n[REACTIONS]\n${utilities.formatReactions(recentMessage.reactions.cache, "list")}`;
        }

        let _replyContent = "";
        // Append reply context
        if (recentMessage.reference) {
          _replyContent = `\n[REPLYING TO]`;
          const _repliedMessage =
            messageData.repliedMessage || repliesMap[recentMessage.id];
        }

        // If recentMessage has embeds, add them to the content
        let newContent = "";
        if (recentMessage.embeds?.length > 0) {
          for (const embed of recentMessage.embeds) {
            newContent += `\n\n[MESSAGE EMBED]`;
            if (embed.title) {
              newContent += `\nTitle: ${embed.title}`;
            }
            if (embed.description) {
              newContent += `\nDescription: ${embed.description}`;
            }
            if (embed.fields?.length > 0) {
              for (const field of embed.fields) {
                newContent += `\n${field.name}: ${field.value}`;
              }
            }
            if (embed.footer) {
              newContent += `\nFooter: ${embed.footer.text}`;
            }
            if (embed.url) {
              newContent += `\nURL: ${embed.url}`;
            }
          }
        } else {
          newContent = recentMessage.content;
        }

        conversation.push({
          role: "assistant",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: newContent,
        });

        if (imageDescription || reactionsContent) {
          attachmentContext = `=== YOUR MESSAGE CONTEXT ===`;
          attachmentContext += `\nThis is additional context for your message above. Do not respond to this context directly, but use it as information to enhance your understanding of the situation.`;
          if (imageDescription) {
            attachmentContext += `\n[IMAGE ATTACHED]`;
            attachmentContext += `\nDimensions: ${imageWidth}x${imageHeight}`;
            attachmentContext += `\nFile size: ${imageSize.toFixed(2)} MB`;
            attachmentContext += `\nImage description: ${imageDescription}`;
          }
          if (reactionsContent) {
            attachmentContext += `\n[REACTIONS]`;
            attachmentContext += reactionsContent;
          }

          conversation.push({
            role: "user",
            name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
            content: attachmentContext,
          });
        }
      } else {
        // Build user message content with all collected data
        const recentMessageDateTime = TemporalHelpers.fromMillis(
          recentMessage.createdTimestamp,
        );
        const messageId = TemporalHelpers.toDateId(recentMessageDateTime, dateIdFormat);
        const combinedNames = utilities.getCombinedNamesFromUserOrMember({
          member: recentMessage.member,
        });
        let modifiedContent = `=== MESSAGE ${userMessageXofY} of ${sequentialUserMessages} ${userMessageXofY === sequentialUserMessages && isLastMessage ? "(MOST RECENT)" : ""} ===`;
        modifiedContent += `\n[METADATA]`;
        modifiedContent += `\nFrom: ${combinedNames}`;
        modifiedContent += `\nMessage ID: ${messageId}`;

        // Add reply information
        const repliedMessage: Message | undefined =
          messageData.repliedMessage || (repliesMap[recentMessage.id] as Message | undefined);
        if (recentMessage.reference?.messageId) {
          modifiedContent += `\n\n[REPLYING TO]`;
          if (!repliedMessage) {
            modifiedContent += `\nAuthor: Unknown (DELETED MESSAGE)`;
            modifiedContent += `\nMessage ID: ${recentMessage.reference.messageId}`;
          } else {
            const repliedMessageDateTime = TemporalHelpers.fromMillis(
              repliedMessage.createdTimestamp,
            );
            const replyMessageId =
              TemporalHelpers.toDateId(repliedMessageDateTime, dateIdFormat);
            const combinedRepliedNames =
              utilities.getCombinedNamesFromUserOrMember({
                member: repliedMessage.member,
              });
            modifiedContent += `\nAuthor: ${combinedRepliedNames}`;
            modifiedContent += `\nTime: ${TemporalHelpers.format(repliedMessageDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a")} (${TemporalHelpers.toRelative(repliedMessageDateTime)})`;
            modifiedContent += `\nMessage ID: ${replyMessageId}`;

            if (repliedMessage.cleanContent) {
              modifiedContent += `\nType: Text Message`;
              modifiedContent += `\nContent:`;
              modifiedContent += `\n<message_content>`;
              modifiedContent += `\n${repliedMessage.content}`;
              modifiedContent += `\n</message_content>`;
            }

            const repliedAttachmentResult = await generateAttachmentsResponse(
              repliedMessage,
              messagesTranscriptionsCollection,
              messagesImagesCollection,
              repliedMessage,
              modifiedContent,
              localMongo,
            );
            modifiedContent = repliedAttachmentResult.modifiedContent;
            // Reply image URLs will be collected but not attached separately
            // — they belong to context, not the current message

            modifiedContent += await generateEmojiResponse(
              repliedMessage,
              true,
            );
          }
        }

        modifiedContent += `\n\n[CURRENT MESSAGE]`;
        if (recentMessage.content) {
          modifiedContent += `\nType: Text Message`;
          modifiedContent += `\nContent:`;
          modifiedContent += `\n<message_content>`;
          modifiedContent += `\n${recentMessage.content}`;
          modifiedContent += `\n</message_content>`;


        }

        const attachmentResult = await generateAttachmentsResponse(
          recentMessage,
          messagesTranscriptionsCollection,
          messagesImagesCollection,
          recentMessage,
          modifiedContent,
          localMongo,
        );
        modifiedContent = attachmentResult.modifiedContent;

        // Add reactions
        const isCurrentMessage = recentMessage.id !== (message as Message).id;
        if (recentMessage.reactions?.cache?.size > 0 && !isCurrentMessage) {
          modifiedContent += `\nNumber of reactions in this message: ${recentMessage.reactions.cache.size}`;
          modifiedContent += `\nReaction list: ${utilities.formatReactions(recentMessage.reactions.cache, "inline")}`;
        }

        const msgEntry: ChatMessage = {
          role: "user",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: modifiedContent,
        };
        // Attach image URLs to this specific message for multimodal vision
        if (attachmentResult.messageImageUrls.length > 0) {
          msgEntry.images = attachmentResult.messageImageUrls;
        }
        conversation.push(msgEntry);
      }
    }
  }

  // Clean up collections
  userMentionsCollection = userMentionsCollection.filter(
    (user: User) => !memberMentionsCollection.has(user.id),
  );
  memberMentionsCollection.delete(client.user!.id);


  return {
    conversation,
    conversationsCollection,
    memberMentionsCollection,
    messagesEmojisCollection,
    messagesImagesCollection,
    messagesTranscriptionsCollection,
    newSystemPrompt,
    participantsAvatarsCollection,
    participantsBannersCollection,
    participantsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    userMentionsCollection,
  };
}

async function generateRolesEmbedMessage(client: Client) {
  // get the original message and edit it to show the new role count on the button
  // re-render the buttons with the new role count
  const guildId = config.GUILD_ID_PRIMARY;
  if (!guildId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const roles = guild.roles.cache
    .sort((a: import("discord.js").Role, b: import("discord.js").Role) => a.rawPosition - b.rawPosition)
    .reverse();

  /**
   * Build a role-picker embed + button rows for a given role source array.


   */
  function buildRolePickerSection(title: string, description: string, sourceArray: { id: string, emojiId?: string }[], options: Record<string, unknown> = {}) {
    const maxButtonsPerRow = 5;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor("#00FF00");

    let filtered = roles.filter((role: import("discord.js").Role) =>
      sourceArray.some((src: { id: string }) => src.id === role.id),
    );
    if (options.sort) {
      filtered = filtered.sort((a: import("discord.js").Role, b: import("discord.js").Role) => a.name.localeCompare(b.name));
    }
    const rolesArray = filtered.map((role: import("discord.js").Role) => role);

    const rows: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[] = [];
    for (let i = 0; i < rolesArray.length; i += maxButtonsPerRow) {
      const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>();
      const currentRoles = rolesArray.slice(i, i + maxButtonsPerRow);
      for (const role of currentRoles) {
        const emoji = sourceArray.find((src: { id: string }) => src.id === role.id)?.emojiId || null;
        const button = new ButtonBuilder()
          .setLabel(`${role.name} (${role.members.size})`)
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(`pick-role-${role.id}`);
        if (emoji) button.setEmoji(emoji);
        row.addComponents(button);
      }
      rows.push(row);
    }
    return { embed, rows };
  }

  const classes = buildRolePickerSection("Pick Your WoW Classes", "Which classes do you play as?", warcraftClasses);
  const factions = buildRolePickerSection("Pick Your WoW Faction", "Which faction do you play as?", warcraftFactions);
  const videogames = buildRolePickerSection("Pick Your Videogames", "Which videogames do you play?", rolesVideogames, { sort: true });

  // if the channel is empty, create a new message
  const channelId = config.CHANNEL_ID_SELF_ROLES;
  if (!channelId) return;
  const channel = DiscordUtilityService.getChannelById(
    client,
    channelId,
  ) as TextChannel | null;
  if (!channel) {
    return;
  }
  const messagesCacheSize =
    channel.messages.cache.size ||
    (await channel.messages
      .fetch({ limit: 10 })
      .then((messages: DiscordCollection<string, Message>) => messages.size));
  // if the channel is empty, post message, otherwise edit the first message
  if (messagesCacheSize === 0) {
    await channel.send({ embeds: [factions.embed], components: factions.rows });
    await channel.send({ embeds: [classes.embed], components: classes.rows });
    await channel.send({ embeds: [videogames.embed], components: videogames.rows });

    const guildMastersEmbed = new EmbedBuilder()
      .setTitle("Guild Masters / Officers")
      .setDescription(
        `If you would like access to post in our guild recruitment channel and other guild leadership channels, please post on the <#966457267417411614> channel:

- Include a screenshot of your guild tab showing you as GM or officer, as well as the name and faction of the guild.
- Put your guild tag in your Discord nickname <Like This>.
            `,
      )
      .setColor("#00FF00");

    await channel.send({ embeds: [guildMastersEmbed] });

    return;
  } else {
    const allMessages = await channel.messages.fetch({ limit: 20 });
    const message1 = allMessages.at(allMessages.size - 1);
    const message2 = allMessages.at(allMessages.size - 2);
    const message3 = allMessages.at(allMessages.size - 3);
    if (message1) await message1.edit({ embeds: [factions.embed], components: factions.rows });
    if (message2) await message2.edit({ embeds: [classes.embed], components: classes.rows });
    if (message3) await message3.edit({ embeds: [videogames.embed], components: videogames.rows });
    return;
  }
}

async function luposOnReady(client: Client, { mongo }: { mongo: import("mongodb").MongoClient }) {
  console.log(...LogFormatter.botReady(client));
  consoleLogAllGuilds(client);

  try {
    const db = mongo.db(MONGO_DB_NAME);
    const messagesCollection = db.collection("Messages");
    await messagesCollection.createIndex({ guildId: 1, createdTimestamp: -1 }, { background: true });
    await messagesCollection.createIndex({ guildId: 1, channelId: 1, createdTimestamp: -1 }, { background: true });
    await messagesCollection.createIndex({ guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 }, { background: true });
    await messagesCollection.createIndex({ guildId: 1, "author.id": 1, createdTimestamp: -1 }, { background: true });
    await messagesCollection.createIndex(
      { isDeleted: 1 },
      { background: true, partialFilterExpression: { isDeleted: true } },
    );
    console.log("🔌 [DiscordService] Messages compound indexes ensured");

    const guessWhoScoresCollection = db.collection("GuessWhoGameScore");
    await guessWhoScoresCollection.createIndex({ userId: 1, guildId: 1 }, { unique: true, background: true });
    await guessWhoScoresCollection.createIndex({ guildId: 1, score: -1 }, { background: true });
    console.log("🔌 [DiscordService] GuessWhoGameScore compound indexes ensured");

    const beatUpVotesCollection = db.collection("BeatUpGameVotes");
    await beatUpVotesCollection.createIndex({ targetId: 1, guildId: 1 }, { unique: true, background: true });
    console.log("🔌 [DiscordService] BeatUpGameVotes unique index ensured");

    const beatUpCooldownsCollection = db.collection("BeatUpGameCooldowns");
    await beatUpCooldownsCollection.createIndex({ userId: 1, guildId: 1, type: 1 }, { unique: true, background: true });
    console.log("🔌 [DiscordService] BeatUpGameCooldowns unique index ensured");

    const shockStatisticsCollection = db.collection("ShockGameStatistics");
    await shockStatisticsCollection.createIndex({ userId: 1, guildId: 1 }, { unique: true, background: true });
    console.log("🔌 [DiscordService] ShockGameStatistics unique index ensured");

    const gameActivityCollection = db.collection("GameActivity");
    const existingGameActivityIndexes = await gameActivityCollection.indexes();
    const conflictingNameIndex = existingGameActivityIndexes.find(
      (existingIndex) => existingIndex.name === "name_1" && !existingIndex.unique,
    );
    if (conflictingNameIndex) {
      await gameActivityCollection.dropIndex("name_1");
      console.log("🔌 [DiscordService] GameActivity dropped stale non-unique name_1 index");
    }
    await gameActivityCollection.createIndex({ name: 1 }, { unique: true, background: true });
    await gameActivityCollection.createIndex({ count: -1 }, { background: true });
    console.log("🔌 [DiscordService] GameActivity indexes ensured");

    const activeStreamersCollection = db.collection("ActiveStreamers");
    await activeStreamersCollection.createIndex({ userId: 1 }, { unique: true, background: true });
    console.log("🔌 [DiscordService] ActiveStreamers index ensured");
  } catch (indexError: unknown) {
    console.error("⚠️ [DiscordService] Failed to create database indexes:", indexError);
  }

  // Warm up the Discord REST connection pool — the first REST call after
  // gateway connect can stall on DNS/TLS in Docker (Synology bridge network).
  // Issuing a lightweight call here primes the pool so sendTyping() doesn't hang.
  try {
    if (client.application) {
      await client.application.fetch();
      console.log('🔌 [DiscordService] REST connection pool warmed up');
    }
  } catch (error: unknown) {
    console.warn(`⚠️ [DiscordService] REST warmup failed: ${(error as Error).message}`);
  }

  // ─── Maintenance Gate ──────────────────────────────────────────
  if (config.UNDER_MAINTENANCE) {
    if (client.user) {
      client.user.setPresence({
        activities: [{ name: '🚧 Under maintenance 🚧', type: 4 }],
        status: 'idle',
      });
    }
    console.log('🚧 Lupos is under maintenance — skipping normal initialization.');
    return;
  }

  DiscordUtilityService.setUserActivity(client, APRIL_FOOLS_MODE ? `:3` : `Don't @ me...`);

  if (mode === "services" || !mode) {
    await generateRolesEmbedMessage(client);

    // Sweep existing members: kick accounts < 4 weeks old that joined while bot was offline
    await luposOnReadyDeleteNewAccounts(client);

    // Bulk role revocation — strip target role from all members in the specified guild
    await revokeRoleFromAllMembers(client);

    if (config.ROLE_ID_BIRTHDAY_MONTH) {
      BirthdayJob.startJob(client);
    }

    // RemindersJob.startJob(client, mongo);

    if (config.EMOJI_ID_FLAG && config.ROLE_ID_FLAG) {
      EventReactJob.startJob(client, mongo);
    }

    PermanentTimeOutJob.startJob(client);

    if (
      config.CHANNEL_ID_POLITICS &&
      config.ROLE_ID_YAPPER &&
      config.ROLE_ID_REACTOR
    ) {
      ActivityRoleAssignmentJob.startJob({
        client,
        mongo,
        primaryChannelId: (config.CHANNEL_ID_POLITICS as string),
        roleIdYapper: config.ROLE_ID_YAPPER,
        roleIdReactor: config.ROLE_ID_REACTOR,
        periodMinutes: 60,
        intervalMinutes: 1,
      });
    }
  } else if (mode === "messages") {
    // Reset bot nickname to "Lupos" in specific guild on startup
    try {
      const targetGuild = client.guilds.cache.get((config.GUILD_ID_GROBBULUS as string));
      if (targetGuild) {
        const botMember = await targetGuild.members.fetch(client.user!.id);
        if (botMember) {
          await botMember.setNickname("Lupos");
          console.log(
            `Bot nickname reset to "Lupos" in guild ${targetGuild.name}`,
          );
        }
      }
    } catch (error: unknown) {
      console.error("Failed to reset bot nickname on startup:", error);
    }

    // April Fools: Random tag job
    if (APRIL_FOOLS_MODE) {
      RandomTagJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY as string,
        channelId: config.CHANNEL_ID_POLITICS as string,
      });

      // April Fools: Server icon rotation
      ServerIconJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY as string,
      });
    }

  }

  // Countdown icon overlay — runs in ALL modes (daily countdown on guild icon)
  if (config.GUILD_ID_PRIMARY && config.COUNTDOWN_ICON_TARGET_DATE) {
    const { parseTargetDateString } = await import("#root/utilities/CountdownIconOverlay.js");
    CountdownIconJob.startJob({
      client,
      guildId: config.GUILD_ID_PRIMARY,
      targetDate: parseTargetDateString(config.COUNTDOWN_ICON_TARGET_DATE),
    });
  }
}

async function luposOnReadyReports(client: Client, mongo: import("mongodb").MongoClient) {
  utilities.consoleLog("<", "luposOnReadyReports");
  utilities.consoleLog(
    "=",
    `Logged in as ${DiscordUtilityService.getBotName(client)}`,
  );
  try {
    await mongo.connect();
    utilities.consoleLog("=", "Connected to MongoDB");
  } catch (error: unknown) {
    utilities.consoleLog("=", `Error connecting to MongoDB \n${error}`);
  }
  DiscordUtilityService.displayAllChannelActivity(client);
  utilities.consoleLog(">", "luposOnReadyReports");
}

async function luposOnReadyCloneMessages(client: Client, { localMongo }: { localMongo: import("mongodb").MongoClient }) {
  await DiscordUtilityService.fetchAndSaveAllServerMessages(
    client,
    localMongo,
    "249010731910037507",
  );

  // Backfill media archive for Lupos messages with Discord CDN URLs
  await DiscordUtilityService.backfillMediaArchive(client, localMongo, {
    authorIds: ["1198099566088699904"],
    guildId: "249010731910037507",
  });
}

async function luposOnReadyRescrapeChannels(client: Client, { localMongo, channelIds, guildIds, dateLimit }: { localMongo: import("mongodb").MongoClient, channelIds?: string[], guildIds?: string[], dateLimit?: string }) {
  const guilds = guildIds || ["249010731910037507"];
  const limit = dateLimit || "2025-01-01";

  for (const guildId of guilds) {
    const guild = client.guilds.cache.get(guildId);
    const guildName = guild?.name || guildId;
    console.log(`[rescrape:channels] Rescraping guild "${guildName}" (${guildId})${channelIds ? ` — ${channelIds.length} channel(s)` : " — all channels"} | dateLimit: ${limit}`);

    await DiscordUtilityService.fetchAndSaveAllServerMessages(
      client,
      localMongo,
      guildId,
      {
        channelIds: channelIds || undefined,
        dateLimit: limit,
        autoResume: false,
        forceUpdate: true,
      },
    );
    console.log(`[rescrape:channels] Done with guild "${guildName}".`);
  }

  console.log(`[rescrape:channels] All guilds complete.`);
  process.exit(0);
}

async function luposOnReadyDeleteDuplicateMessages(client: Client, { localMongo }: { localMongo: import("mongodb").MongoClient }) {
  await DiscordUtilityService.deleteDuplicateMessagesByID(localMongo);
}

async function luposOnReadyDeleteNewAccounts(client: Client) {
  const functionName = "luposOnReadyDeleteNewAccounts";
  const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);
  if (!guild) {
    console.error(`[${functionName}] Primary guild not found`);
    return;
  }

  console.log(`[${functionName}] Fetching all members...`);
  const members = await fetchMembersWithRetry(guild);
  let kickedAge = 0;
  let kickedCombo = 0;

  for (const [, member] of members) {
    const wasTooNew = await kickIfTooNew(member, functionName);
    if (wasTooNew) {
      kickedAge++;
      continue;
    }
    const wasForbidden = await kickIfForbiddenCombo(member, functionName);
    if (wasForbidden) kickedCombo++;
  }

  console.log(`[${functionName}] Done. Kicked — age: ${kickedAge}, forbidden combo: ${kickedCombo}`);
}

/**
 * One-off purge: kick all members with accounts < 2 months old
 * in a specific guild.
 */
const TWO_MONTHS_MS = 60 * MILLISECONDS_PER_DAY;
const PURGE_TARGET_GUILD_ID = "609471635308937237";
const REVOKE_ROLE_ID = "1353101921681936456";

async function luposOnReadyPurgeYoungAccounts(client: Client) {
  const functionName = "luposOnReadyPurgeYoungAccounts";
  const guild = client.guilds.cache.get(PURGE_TARGET_GUILD_ID);
  if (!guild) {
    console.error(
      `[${functionName}] Guild ${PURGE_TARGET_GUILD_ID} not found in cache`,
    );
    return;
  }

  await purgeByAccountAge(guild, TWO_MONTHS_MS, {
    dryRun: true,
    callerName: functionName,
  });
}

/**
 * Bulk role revocation — strips a specific role from every member who has it
 * in the target guild. Runs once on bot startup to clean up stale roles.
 */
async function revokeRoleFromAllMembers(client: Client) {
  const functionName = "revokeRoleFromAllMembers";
  const guild = client.guilds.cache.get(PURGE_TARGET_GUILD_ID);
  if (!guild) {
    console.error(`[${functionName}] Guild ${PURGE_TARGET_GUILD_ID} not found in cache`);
    return;
  }

  const role = guild.roles.cache.get(REVOKE_ROLE_ID);
  if (!role) {
    console.error(`[${functionName}] Role ${REVOKE_ROLE_ID} not found in guild ${guild.name}`);
    return;
  }

  console.log(`[${functionName}] Fetching members with role "${role.name}" (${REVOKE_ROLE_ID})...`);
  const members = await fetchMembersWithRetry(guild);
  const membersWithRole = members.filter((m: import("discord.js").GuildMember) => m.roles.cache.has(REVOKE_ROLE_ID));

  if (membersWithRole.size === 0) {
    console.log(`[${functionName}] No members found with role "${role.name}" — nothing to do.`);
    return;
  }

  console.log(`[${functionName}] Revoking role "${role.name}" from ${membersWithRole.size} member(s)...`);
  let revoked = 0;
  let failed = 0;

  for (const [, member] of membersWithRole) {
    try {
      await member.roles.remove(REVOKE_ROLE_ID, `[${functionName}] Startup bulk role revocation`);
      revoked++;
      console.log(`[${functionName}] ✅ Removed role from ${member.user.tag} (${member.id})`);
    } catch (error: unknown) {
      failed++;
      console.error(`[${functionName}] ❌ Failed to remove role from ${member.user.tag} (${member.id}): ${(error as Error).message}`);
    }
  }

  console.log(`[${functionName}] Done. Revoked: ${revoked}, Failed: ${failed}`);
}

/**
 * Check if a message or its replied-to message contains flagged words.
 * If flagged, sends a reply and returns true; otherwise returns false.

 */
async function rejectIfFlaggedContent(message: Message) {
  const FLAGGED_REPLY = "beep boop, no slurs, ya dumbass";

  // Check direct message content
  if ((message as Message).content && CensorService.containsFlaggedWords((message as Message).content)) {
    console.log(`⛔ [DiscordService] Message contains flagged words, ignoring.`);
    try { await message.reply(FLAGGED_REPLY); } catch (error: unknown) { console.log("Error sending flagged words response:",  error); }
    return true;
  }

  // Check replied-to message content
  if (message.reference && message.reference.messageId as string) {
    try {
      const repliedMessage = await (message as Message).channel.messages.fetch(message.reference.messageId as string);
      if (repliedMessage.content && CensorService.containsFlaggedWords(repliedMessage.content)) {
        console.log(`⛔ [DiscordService] Replied message contains flagged words, ignoring.`);
        try { await message.reply(FLAGGED_REPLY); } catch (error: unknown) { console.log("Error sending flagged words response:",  error); }
        return true;
      }
    } catch (error: unknown) {
      console.log("Error fetching replied message:", error);
    }
  }

  return false;
}

/**
 * Send a self-destructing maintenance mode countdown message.
 * Randomly selects an explosion GIF and counts down from 10s before deleting.

 */
async function sendMaintenanceCountdown(message: Message) {
  let secondsRemaining = 10;
  const randomExplosionGif =
    EXPLOSION_GIFS[Math.floor(Math.random() * EXPLOSION_GIFS.length)];

  try {
    const sentMessage = await message.reply(
      `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
    );

    const interval = setInterval(async () => {
      secondsRemaining--;
      try {
        if (secondsRemaining <= 0) {
          clearInterval(interval);
          await sentMessage.delete();
        } else if (secondsRemaining < 3) {
          await sentMessage.edit(randomExplosionGif);
        } else {
          await sentMessage.edit(
            `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
          );
        }
      } catch (error: unknown) {
        console.error(error);
        clearInterval(interval);
      }
    }, 1000);
  } catch (error: unknown) {
    console.error(error);
  }
}

async function processMessage(
  client: Client,
  { mongo, localMongo }: { mongo: import("mongodb").MongoClient; localMongo: import("mongodb").MongoClient },
  message: Message,
  actionType: string,
) {
  const isDirectMessage = (message as Message).channel.type === ChannelType.DM;
  const isSelfMessage = message.author.id === client.user!.id;
  const isDirectMessageFromSelf = isDirectMessage && isSelfMessage;
  const isMessageWithoutSelfMention =
    !isDirectMessage && !message.mentions.has(client.user!);
  const isMessageFromBot = message.author.bot;
  const isGuildWhitemane = message?.guildId === config.GUILD_ID_PRIMARY;
  const isMentioningBot = isDirectMessage || message.mentions.has(client.user!);

  if ((message as Message).guildId === (config.GUILD_ID_GROBBULUS as string)) {
    return;
  }

  if (config.USER_IDS_DISALLOWED.includes(message.author.id)) {
    return;
  }

  // Check for flagged words in message content or replied-to content
  if (!isSelfMessage && !isMessageFromBot && isMentioningBot) {
    if (await rejectIfFlaggedContent(message)) return;
  }

  try {
    if (!message.author.bot) {
      const date = utilities.getCombinedDateInformationFromDate(
        message.createdAt.getTime(),
        true,
      );

      let logMessage = `${date}
Message: ${message.cleanContent}`;

      if (message.attachments?.size > 0) {
        logMessage += `\nAttachment Message: ${[...message.attachments.values()].map((att: import("discord.js").Attachment) => att.url).join(", ")}`;
      }

      if (message.stickers?.size > 0) {
        logMessage += `\nSticker Message: ${[...message.stickers.values()].map((sticker: import("discord.js").Sticker) => sticker.name).join(", ")}`;
      }

      if (message.reference && message.reference.messageId as string) {
        logMessage += `\nReply Message: Yes, to message ID ${message.reference.messageId as string}`;
      }

      logMessage += `
Guild: ${(message as Message).guild?.name}
Channel: #${((message as Message).channel as TextChannel)?.name}
Author: ${utilities.getCombinedNamesFromUserOrMember({ member: (message as Message).member, user: message.author })}
URL: ${utilities.getDiscordMessageUrl((message as Message).guild?.id || "", (message as Message).channel.id, (message as Message).id)}`;

      console.log(logMessage);
    }
  } catch (error: unknown) {
    console.log("Error saving message to MongoDB:", error);
  }

  if (config.CHANNEL_IDS_JUKEBOX.includes((message as Message).channelId)) {
    await YouTubeService.searchAndPlay(client, message);
    await YouTubeService.stop(client, message);
    await YouTubeService.next(client, message);
    await YouTubeService.pause(client, message);
    await YouTubeService.resume(client, message);
    await YouTubeService.setVolume(client, message);
  }

  if (isMessageWithoutSelfMention) {
    return;
  }

  // IGNORE MESSAGES FROM BOT ACCOUNTS
  if (isMessageFromBot) {
    return;
  }

  // ASSIGN ROLES TO USERS BASED ON CHANNELS
  for (const channel of channels) {
    if ((message as Message).channelId === channel.id) {
      await DiscordUtilityService.addRoleToMember(
        (message as Message).member!,
        channel.roleId,
      );
    }
  }

  // IGNORE MESSAGES FROM THE BOT ITSELF
  if (isDirectMessageFromSelf) {
    return;
  }

  // IGNORE MESSAGES FROM SPECIFIC USERS
  if (config.USER_IDS_IGNORE.includes(message.author.id)) {
    return;
  }

  // IGNORE MESSAGES FROM USERS WITH SPECIFIC ROLES
  const memberObj = (message as Message).member;
  if (
    memberObj &&
    memberObj.roles.cache.some((role: import("discord.js").Role) =>
      config.ROLES_IDS_IGNORE.includes(role.id),
    )
  ) {
    return;
  }

  if (config.UNDER_MAINTENANCE && message.author.id !== '166745313258897409') {
    // Only the owner can interact with Lupos during maintenance
    if ((message as Message).guild?.id === config.GUILD_ID_PRIMARY) {
      await sendMaintenanceCountdown(message);
    }
    return;
  }


  // START TYPING
  if (!DiscordState.typingIntervals[(message as Message).channel.id]) {
    try {
      DiscordState.typingIntervals[(message as Message).channel.id] =
        await DiscordUtilityService.startTypingInterval((message as Message).channel as TextChannel);
    } catch (error: unknown) {
      console.warn(`⚠️ [processMessage] Could not start typing: ${(error as Error).message}`);
    }
  }

  // LUPOS CHATTER ROLE
  if (isGuildWhitemane) {
    await DiscordUtilityService.addRoleToMember(
      (message as Message).member!,
      (config.ROLE_ID_BOT_CHATTER as string),
    );
    // remove after 1 minutes
    setTimeout(
      async () => {
        await DiscordUtilityService.removeRoleFromMember(
          (message as Message).member!,
          (config.ROLE_ID_BOT_CHATTER as string),
        );
      },
      1 * 60 * 1000,
    );
  }


  // Fetch messages before the current one...
  const fetchedMessages = await DiscordUtilityService.fetchMessages(client, (message as Message).channel.id, {
    limit: 500,
    before: (message as Message).id,
  });
  if (!fetchedMessages) {
    console.error(`❌ [processMessage] fetchMessages returned null — channel not in cache`);
    // Clear the typing indicator we started above so it doesn't spin forever
    const typingChannelId = (message as Message).channel.id;
    if (DiscordState.typingIntervals[typingChannelId]) {
      DiscordUtilityService.clearTypingInterval(DiscordState.typingIntervals[typingChannelId]);
      delete DiscordState.typingIntervals[typingChannelId];
    }
    return;
  }
  const recentMessages = fetchedMessages.reverse();
  // ...and append the current message to the end
  recentMessages.set((message as Message).id, message);

  DiscordState.queuedData.push({ message: message as Message, recentMessages, actionType: actionType || "" });

  if (!DiscordState.isProcessingQueue) {
    DiscordState.isProcessingQueue = true;
    try {
      while (DiscordState.queuedData.length > 0) {
        const queuedDatum = DiscordState.queuedData.shift() as QueuedMessageData;
        const currentChannelId = (queuedDatum.message as Message).channel.id;
        try {
          await replyMessage(queuedDatum, localMongo);
        } catch (error: unknown) {
          console.error(
            `❌ [processMessage] Uncaught error in replyMessage — queue will continue processing:\n`,
            error,
          );
          // Clear typing for the failed channel so it doesn't hang
          if (DiscordState.typingIntervals[currentChannelId]) {
            DiscordUtilityService.clearTypingInterval(
              DiscordState.typingIntervals[currentChannelId],
            );
            delete DiscordState.typingIntervals[currentChannelId];
          }
        }
        // No more queued messages for this channel — clear typing indicator
        if (
          !DiscordState.queuedData.some((q: QueuedMessageData) => q.message?.channel?.id === currentChannelId)
        ) {
          // Clear typing for this specific channel only
          if (DiscordState.typingIntervals[currentChannelId]) {
            DiscordUtilityService.clearTypingInterval(
              DiscordState.typingIntervals[currentChannelId],
            );
            delete DiscordState.typingIntervals[currentChannelId];
          }
        }
      }
    } finally {
      DiscordState.isProcessingQueue = false;
    }
    return;
  }
}

async function luposOnMessageCreate(client: Client, { mongo, localMongo }: { mongo: import("mongodb").MongoClient, localMongo: import("mongodb").MongoClient }, message: Message) {
  await processMessage(client, { mongo, localMongo }, message, "CREATE");
}

async function luposOnMessageCreateCloneMessage(
  client: Client,
  { _mongo, localMongo }: { _mongo: import("mongodb").MongoClient; localMongo: import("mongodb").MongoClient },
  message: Message,
) {
  await DiscordUtilityService.saveMessageToMongo(message, localMongo);
}

async function luposOnMessageUpdateCloneMessage(
  client: Client,
  { _mongo, localMongo }: { _mongo: import("mongodb").MongoClient; localMongo: import("mongodb").MongoClient },
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  await DiscordUtilityService.updateMessageInMongo(newMessage as Message, localMongo);
}

async function luposOnMessageUpdate(
  client: Client,
  { mongo, localMongo }: { mongo: import("mongodb").MongoClient, localMongo: import("mongodb").MongoClient },
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  // Process if message was edited to mention the bot
  if (
    newMessage.mentions.has(client.user!) &&
    !oldMessage.mentions.has(client.user!)
  ) {
    // Skip if the bot already replied to this message
    const fetchedMessages = await DiscordUtilityService.fetchMessages(client, newMessage.channel.id, {
      limit: 100,
      after: newMessage.id,
    });
    if (!fetchedMessages) return;
    const futureMessages = fetchedMessages.filter(
      (message: Message) =>
        message.author.id === client.user!.id &&
        message.reference?.messageId === newMessage.id,
    );
    if (futureMessages.size) return;
    await processMessage(client, { mongo, localMongo }, newMessage as Message, "UPDATE");
  } else {
    return;
  }
}

// Whenever a message is deleted in WHITEMANE, post it in the deleted-message channel
// ── Delegated to DeletedMessageLogger ───────────────────────────
async function luposOnMessageDelete(client: Client, mongo: import("mongodb").MongoClient, message: Message) {
  return DeletedMessageLogger.handleMessageDelete(client, mongo, message);
}

// ── Delegated to ReactionHighlights ─────────────────────────────
async function luposOnReactionCreateQueue(client: Client, mongo: import("mongodb").MongoClient, reaction: MessageReaction | PartialMessageReaction, user: User) {
  return ReactionHighlights.handleReactionCreate(client, mongo, reaction, user);
}

async function luposOnReactionRemoveQueue(client: Client, mongo: import("mongodb").MongoClient, reaction: MessageReaction | PartialMessageReaction, user: User) {
  return ReactionHighlights.handleReactionRemove(client, mongo, reaction, user);
}

// Whenever a new member joins the server
async function luposOnGuildMemberAdd(client: Client, mongo: import("mongodb").MongoClient, member: GuildMember) {
  const functionName = "luposOnGuildMemberAdd";
  if (member.guild.id !== config.GUILD_ID_PRIMARY) return;
  console.log(...LogFormatter.memberJoinedGuild(functionName, member));

  // Kick accounts less than 4 weeks old (unless whitelisted)
  const wasKicked = await kickIfTooNew(member, functionName);
  if (wasKicked) return;

  // Assign politics mute role if user is in the muted list
  if (config.USER_IDS_POLITICS_MUTED?.includes(member.id) && config.ROLE_ID_POLITICS_MUTE) {
    await DiscordUtilityService.addRoleToMember(
      member,
      config.ROLE_ID_POLITICS_MUTE,
    );
  }
}

// Whenever a member is updated
async function luposOnGuildMemberUpdate(client: Client, mongo: import("mongodb").MongoClient, oldMember: GuildMember, newMember: GuildMember) {
  const functionName = "luposOnGuildMemberUpdate";

  // Revert bot nickname if changed in specific server
  if (
    newMember.guild.id === (config.GUILD_ID_GROBBULUS as string) &&
    newMember.id === client.user!.id
  ) {
    const expectedNickname = "Lupos";
    // Only act if nickname changed AND is not the expected name
    if (
      oldMember.nickname !== newMember.nickname &&
      newMember.nickname !== expectedNickname
    ) {
      try {
        await newMember.setNickname(expectedNickname);
        console.log(
          `[${functionName}] Bot nickname was changed to "${newMember.nickname}", reverted to "${expectedNickname}"`,
        );
      } catch (error: unknown) {
        console.error(
          `[${functionName}] Failed to revert bot nickname:`,
          error,
        );
      }
    }
  }


  if (oldMember.guild.id !== config.GUILD_ID_PRIMARY) return;

  // Kick if member now holds the forbidden role combo (Horde + Apex Legends).
  // Always check — oldMember can be a partial with an empty role cache,
  // making size-based comparisons unreliable.
  await kickIfForbiddenCombo(newMember, functionName);

  // Whenever a user completes onboarding
  const hasOldMemberCompletedOnboarding = oldMember.flags ? (oldMember.flags.bitfield & (1 << 1)) : 0;
  const hasNewMemberCompletedOnboarding = newMember.flags ? (newMember.flags.bitfield & (1 << 1)) : 0;
  if (!hasOldMemberCompletedOnboarding && hasNewMemberCompletedOnboarding) {

    console.log(
      ...LogFormatter.memberUpdateOnboardingComplete(functionName, newMember),
    );
    await generateRolesEmbedMessage(client);

    // Re-check both guards after onboarding — the member now has all their chosen roles
    const freshMember = await newMember.guild.members.fetch(newMember.id);
    const kickedAge = await kickIfTooNew(freshMember, functionName);
    if (!kickedAge) {
      await kickIfForbiddenCombo(freshMember, functionName);
    }
  }
}

async function luposOnInteractionCreate(client: Client, mongo: import("mongodb").MongoClient, interaction: Interaction) {
  const functionName = "luposOnInteractionCreate";
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("pick-role-")) {
      if (!interaction.guild || !interaction.member) return;
      const roleId = interaction.customId.split("pick-role-")[1];
      const role = interaction.guild.roles.cache.get(roleId);
      const member = interaction.member as GuildMember;
      if (!role) {
        console.error(...LogFormatter.roleNotFound(functionName, interaction, roleId));
        return;
      }
      if (member.roles.cache.has(roleId)) {
        console.log(
          ...LogFormatter.roleSelfRemoved(functionName, interaction, role),
        );
        await interaction.reply({
          content: `Removing <@&${roleId}>...`,
          ephemeral: true,
        });
        await DiscordUtilityService.removeRoleFromMember(member, roleId);
        // update reply message to say role removed
        // I want to get the http response from the editReply call and log it
        await interaction.editReply({
          content: `Removed <@&${roleId}>!`,
          
        });
        // wait 5 seconds before deleting the reply
        await new Promise((resolve: (value: void | PromiseLike<void>) => void) => setTimeout(resolve, 5000));
        await interaction.deleteReply();
        await generateRolesEmbedMessage(client);
        return;
      } else {
        console.log(
          ...LogFormatter.roleSelfAdded(functionName, interaction, role),
        );
        await interaction.reply({
          content: `Adding <@&${roleId}>...`,
          ephemeral: true,
        });
        await DiscordUtilityService.addRoleToMember(member, roleId);

        // Re-fetch member so role cache reflects the newly added role
        const freshMember = await interaction.guild!.members.fetch(member.id);
        const wasKicked = await kickIfForbiddenCombo(freshMember, functionName);
        if (wasKicked) {
          await interaction.editReply({
            content: "Forbidden role combination detected. You have been removed from the server.",
            
          });
          return;
        }

        // update reply message to say role added
        await interaction.editReply({
          content: `Added <@&${roleId}>!`,
          
        });
        // wait 5 seconds before deleting the reply
        await new Promise((resolve: (value: void | PromiseLike<void>) => void) => setTimeout(resolve, 5000));
        await interaction.deleteReply();
        await generateRolesEmbedMessage(client);
        return;
      }
    }

    const youtubeAction = YOUTUBE_BUTTON_ACTIONS[interaction.customId as keyof typeof YOUTUBE_BUTTON_ACTIONS];
    if (youtubeAction) {
      const reply = await interaction.deferReply();
      (YouTubeService as unknown as Record<string, (...args: unknown[]) => void>)[youtubeAction.method](...youtubeAction.args);
      await reply.delete();
      return;
    }
  } else if (interaction.isCommand()) {

    console.log(
      ...LogFormatter.interactionCreateCommand(functionName, interaction),
    );
    if (interaction.commandName === "ping") {
      await interaction.reply("Pong!");
      return;
    }
    else {
      const command = (client as Client & { commands: DiscordCollection<string, { execute: (interaction: Interaction) => Promise<void> }> }).commands.get(interaction.commandName);

      if (!command) {
        console.error(...LogFormatter.commandNotFound(functionName, interaction));
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error: unknown) {
        if (interaction.replied || interaction.deferred) {
          // Already responded — silently swallow
          return;
        } else {
          console.log(
            ...LogFormatter.commandError(functionName, interaction, error as Error),
          );
          await interaction.reply({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        }
      }
    }
  }
}

// ── Delegated to PresenceTracker ────────────────────────────────
async function luposOnPresenceUpdate(client: Client, oldPresence: Presence | null, newPresence: Presence) {
  return PresenceTracker.handlePresenceUpdate(client, oldPresence, newPresence);
}

async function luposOnGuildMemberRemove(client: Client, mongo: import("mongodb").MongoClient, member: GuildMember) {

  if (member.guild.id === (config.GUILD_ID_PRIMARY as string)) {
    if (config.CHANNEL_ID_LEAVERS) {
      const leaversLogChannel = DiscordUtilityService.getChannelById(
        client,
        config.CHANNEL_ID_LEAVERS,
      ) as TextChannel;
      if (leaversLogChannel) {
        let description = "";
        description += `Tag: <@${member.id}>\n`;
        description += `ID: \`${member.user.id}\`\n`;
        description += `Global Name: \`${member.user.globalName}\`\n`;
        description += `Username: \`${member.user.username}\`\n`;
        if (member.joinedTimestamp) {
          const joinedDateTime = TemporalHelpers.fromMillis(member.joinedTimestamp);
          // Friday, October 14, 1983, 9:30:33 AM Eastern Daylight Time
          const joinedDate = TemporalHelpers.formatDateTimeHugeWithSeconds(joinedDateTime);
          description += `Joined Server: \`${joinedDate}\`\n`;
        }
        description += `Current Member Count: \`${member.guild.memberCount}\`\n`;
        const embed = new EmbedBuilder()
          .setAuthor({
            name: member.user.username,
            iconURL: member.user.displayAvatarURL(),
          })
          .setTitle(`${member.user.username} has left the server`)
          .setDescription(description)
          .setColor("#FF0000");
        // .setTimestamp()
        // .setFooter({ text: `User ID: ${member.id}`, iconURL: member.user.displayAvatarURL() });
        await leaversLogChannel.send({ embeds: [embed] });
      }
    }
  }
}

async function luposOnVoiceStateUpdate(client: Client, mongo: import("mongodb").MongoClient, oldState: VoiceState, newState: VoiceState) {
  if (newState.channelId) {
    if (!newState.member) return;
    console.log(...LogFormatter.memberJoinedVoiceChannel(newState));
    if (newState.member.guild.id === (config.GUILD_ID_PRIMARY as string)) {
      const voiceChatterRoleId = config.ROLE_ID_VOICE_CHATTER;
      if (voiceChatterRoleId) {
        await DiscordUtilityService.addRoleToMember(
          newState.member,
          voiceChatterRoleId,
        );
      }
    }
  } else {
    console.log(...LogFormatter.memberLeftVoiceChannel(oldState));
  }
}

async function consoleLogAllGuilds(client: Client) {
  const guilds = DiscordUtilityService.getAllGuilds(client) as unknown as DiscordCollection<string, Guild>;
  console.log(...LogFormatter.displayAllGuilds(guilds));
}

async function generateStickerResponse(message: Message, localMongo: import("mongodb").MongoClient) {
  // if sticker
  let content = "";
  if (message.stickers.size === 1) {
    const sticker = message.stickers.first();
    if (!sticker) return "";
    const url = sticker.url;
    const { images } = await AIService.captionImages(
      [url],
      localMongo,
      "STICKER",
    );
    const imageCaption = images[0];
    content += `\nType: Sticker Message`;
    content += `\nSticker Name: ${sticker.name}`;
    if (sticker.description) {
      content += `\nSticker Description: ${sticker.description}`;
    }
    if (imageCaption) {
      content += `\nSticker Caption: ${imageCaption}`;
    }
  }
  return content;
}

async function generateAttachmentsResponse(
  message: Message,
  messagesTranscriptionsCollection: DiscordCollection<string, DiscordCollection<string, { transcription: string }>>,
  messagesImagesCollection: DiscordCollection<string, DiscordCollection<string, { url: string, caption: string }>>,
  userMessage: Message,
  modifiedContent: string,
  localMongo: import("mongodb").MongoClient,
) {
  const transcriptionsCollection = messagesTranscriptionsCollection.get(
    userMessage.id,
  );
  const imagesCollection = messagesImagesCollection.get(userMessage.id);
  const messageImageUrls: string[] = []; // Collect image URLs to attach to message

  if (!(message as Message).content) {
    if ((transcriptionsCollection?.size ?? 0) > 0) {
      // iterate through the first one only
      const audioTranscriptions = transcriptionsCollection!.values().next()
        .value?.transcription || "";
      modifiedContent += `\nType: Voice Message`;
      modifiedContent += `\nAudio Content:`;
      modifiedContent += `\n<audio_transcription>`;
      modifiedContent += `\n${audioTranscriptions}`;
      modifiedContent += `\n</audio_transcription>`;
    }
    if (!(transcriptionsCollection?.size ?? 0) && imagesCollection?.size) {
      modifiedContent += `\nType: Image Message`;
      modifiedContent += `\n\n[ATTACHED REFERENCE IMAGES]`;
      let imgIndex = 0;
      for (const [, image] of imagesCollection.entries()) {
        imgIndex++;
        modifiedContent += `\n  ${imgIndex}. Attachment: ${image.caption}`;
        messageImageUrls.push(image.url);
      }
    }
  } else {
    if ((transcriptionsCollection?.size ?? 0)) {
      const audioTranscriptions = transcriptionsCollection!.values().next()
        .value?.transcription || "";
      modifiedContent += `\nAudio Transcription: ${audioTranscriptions}`;
    }
    if (imagesCollection?.size) {
      modifiedContent += `\n\n[ATTACHED REFERENCE IMAGES]`;
      let imgIndex = 0;
      for (const [, image] of imagesCollection.entries()) {
        imgIndex++;
        modifiedContent += `\n  ${imgIndex}. Attachment: ${image.caption}`;
        messageImageUrls.push(image.url);
      }
    }
  }

  modifiedContent += await generateStickerResponse(userMessage, localMongo);
  return { modifiedContent, messageImageUrls };
}

async function generateEmojiResponse(message: Message, _isReply: boolean = false) {
  if (!message.reactions?.cache?.size) return "";
  const names = utilities.formatReactions(message.reactions.cache, "names");
  return `\nReactions (${message.reactions.cache.size}):\n  • ${names}`;
}

const DiscordService = {
  // VENDER
  async initializeBotVender() {
    const venderClient = DiscordWrapper.createClient(
      "vender",
      (config.VENDER_TOKEN as string),
    );
    // Initialize MongoDB client
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const mongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      venderClient,
      { mongo, localMongo: mongo },
      undefined as never, // venderOnReady placeholder
    );
    DiscordUtilityService.onEventMessageCreate(
      venderClient,
      { mongo, localMongo: mongo },
      undefined as never, // venderOnMessageCreate placeholder
    );
    DiscordUtilityService.onEventInteractionCreate(
      venderClient,
      mongo,
      undefined as never, // venderOnInteractionCreate placeholder
    );
  },
  // LUPOS
  async initializeBotLupos() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    // Initialize MongoDB client
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const mongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    const localMongo = mongo;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo, localMongo },
      luposOnReady as (...args: unknown[]) => void,
    );
    // ─── Data-driven event registration ─────────────────────────────
    // Each entry: [registrationMethod, ...args]
    // "mongoBoth" = { mongo, localMongo }, "mongo" = mongo only, "none" = no db arg
    const cloneEvents: [string, ...unknown[]][] = [
      ["onEventMessageCreate",      { mongo, localMongo }, luposOnMessageCreateCloneMessage],
      ["onEventMessageUpdate",      { mongo, localMongo }, luposOnMessageUpdateCloneMessage],
    ];
    const messageEvents: [string, ...unknown[]][] = [
      ["onEventMessageCreate",      { mongo, localMongo }, luposOnMessageCreate],
      ["onEventMessageUpdate",      { mongo, localMongo }, luposOnMessageUpdate],
    ];
    const guildEvents: [string, ...unknown[]][] = [
      ["onEventGuildMemberAdd",     mongo, luposOnGuildMemberAdd],
      ["onEventGuildMemberUpdate",  mongo, luposOnGuildMemberUpdate],
    ];
    const interactionEvents: [string, ...unknown[]][] = [
      ["onEventMessageReactionAdd",    mongo, luposOnReactionCreateQueue],
      ["onEventMessageReactionRemove", mongo, luposOnReactionRemoveQueue],
      ["onEventInteractionCreate",     mongo, luposOnInteractionCreate],
      ["onEventMessageDelete",         mongo, luposOnMessageDelete],
      ["onEventPresenceUpdate",        luposOnPresenceUpdate],
      ["onEventGuildMemberRemove",     mongo, luposOnGuildMemberRemove],
      ["onEventVoiceStateUpdate",      mongo, luposOnVoiceStateUpdate],
    ];

    const EVENT_REGISTRATIONS: Record<string, [string, ...unknown[]][]> = {
      services: [...cloneEvents, ...guildEvents, ...interactionEvents],
      messages: [...messageEvents],
      default:  [...cloneEvents, ...guildEvents, ...messageEvents, ...interactionEvents],
    };

    const eventsToRegister = EVENT_REGISTRATIONS[mode ?? "default"] ?? EVENT_REGISTRATIONS.default;
    for (const [method, ...args] of eventsToRegister) {
      (DiscordUtilityService as Record<string, (...args: unknown[]) => void>)[method](luposClient, ...args);
    }

    // Log readiness for message-processing modes
    if (mode !== "services") {
      console.log(...LogFormatter.readyToProcessMessages());
      console.log(...LogFormatter.readyToProcessMessageUpdates());
    }

    // Create a collection to store your commands
    (luposClient as Client & { commands: DiscordCollection<string, unknown> }).commands = new Collection<string, unknown>();

    // Load all commands from the commands directory
    const foldersPath = path.join(import.meta.dirname, "..", "commands");
    const commandFolders = fs.readdirSync(foldersPath);

    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file: string) => file.endsWith(".js"));

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = (await import(pathToFileURL(filePath).href)).default;

        if (!command) {
          console.log(`[WARNING] Skipping ${file} — no default export found.`);
          continue;
        }

        if ("data" in command && "execute" in command) {
          (luposClient as Client & { commands: DiscordCollection<string, unknown> }).commands.set(command.data.name, command);
          console.log(...LogFormatter.commandLoaded(command.data.name));
        } else {
          console.error(...LogFormatter.commandFailedToLoad(command.data.name));
        }
      }
    }
  },
  async cloneMessages() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const localMongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnReadyCloneMessages as (...args: unknown[]) => void,
    );
    // Also handle deletes during scraping
    DiscordUtilityService.onEventMessageDelete(luposClient, localMongo, luposOnMessageDelete as (...args: unknown[]) => void);
  },
  async rescrapeChannels({ channelIds, guildIds, dateLimit }: Record<string, unknown> = {}) {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const localMongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { localMongo, channelIds, guildIds, dateLimit },
      luposOnReadyRescrapeChannels as (...args: unknown[]) => void,
    );
    // Register clone handlers so live messages aren't dropped when
    // Discord load-balances gateway events across the two sessions.
    DiscordUtilityService.onEventMessageCreate(luposClient, { mongo: localMongo, localMongo }, luposOnMessageCreateCloneMessage as (...args: unknown[]) => void);
    DiscordUtilityService.onEventMessageUpdate(luposClient, { mongo: localMongo, localMongo }, luposOnMessageUpdateCloneMessage as (...args: unknown[]) => void);
    DiscordUtilityService.onEventMessageDelete(luposClient, localMongo, luposOnMessageDelete as (...args: unknown[]) => void);
  },
  async deleteDuplicateMessages() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const localMongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnReadyDeleteDuplicateMessages as (...args: unknown[]) => void,
    );
  },
  async deleteNewAccounts() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      {},
      luposOnReadyDeleteNewAccounts as (...args: unknown[]) => void,
    );
  },
  async purgeYoungAccounts() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      {},
      luposOnReadyPurgeYoungAccounts as (...args: unknown[]) => void,
    );
  },
  async initializeBotLuposReports() {
    // Create the Mongo client first — reports mode boots standalone, so no
    // other initializer has registered "local" yet.
    await MongoService.createClient("local", (config.DATABASE_URL as string));
    const mongo = MongoService.getClient("local") as import("mongodb").MongoClient;
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      (config.LUPOS_TOKEN as string),
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo, localMongo: mongo },
      luposOnReadyReports as (...args: unknown[]) => void,
    );
  },
};

export default DiscordService;
