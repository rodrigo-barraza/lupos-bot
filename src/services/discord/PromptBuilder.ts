// ============================================================
// PromptBuilder — AI prompt assembly for agent replies
// ============================================================
// Extracted from DiscordService (R1 decomposition). Owns the
// participant-dossier builder (generateDescription) and the
// prompt-assembly half of the reply flow (buildAndGenerateReply):
// guild/channel/voice context, participant dossiers, emoji caption
// lists, reference-image attachment, and the final
// PrismService.generateAgentResponse call.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import { Collection } from "discord.js";
import type {
  Message,
  Guild,
  GuildMember,
  User,
  VoiceState,
  TextChannel,
  Collection as DiscordCollection,
} from "discord.js";
import { GetColorName } from "hex-color-to-color-name";

import config from "#root/config.js";

import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import AIService from "#root/services/AIService.js";
import type { ChatMessage } from "#root/services/AIService.js";
import PrismService from "#root/services/PrismService.js";
import CensorService from "#root/services/CensorService.js";
import DiscordState from "#root/services/discord/DiscordState.js";
import type { AgentStatusTracker } from "#root/services/discord/AgentStatusTracker.js";
import type { PrismSseEvent } from "#root/types/prism.js";
import {
  mightBeImageRequest,
  findUntaggedNameMatches,
  detectGroupReference,
  hasSelfReferenceRegex,
  hasBotSelfPortraitRegex,
  detectSelfReferenceViaLLM,
} from "#root/services/discord/ImageIntent.js";
import {
  extractEmojisFromAllMessage,
  splitEmojiNameAndId,
} from "#root/services/discord/ConversationExtractor.js";
import { buildReferenceImagesBlock } from "#root/services/discord/MessageEnvelope.js";

import utilities from "#root/utilities.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import { MessageConstant, APRIL_FOOLS_MODE } from "#root/constants.js";

/**
 * Format an epoch-milliseconds timestamp as an absolute date string
 * ("LLLL dd, yyyy 'at' hh:mm:ss a") plus a relative string ("3 days ago").
 * Pure formatting dedup of the repeated
 * fromMillis → format → toRelative triplet in generateDescription.
 */
function formatAbsoluteAndRelative(ms: number) {
  const dateTime = TemporalHelpers.fromMillis(ms);
  return {
    absolute: TemporalHelpers.format(dateTime, "LLLL dd, yyyy 'at' hh:mm:ss a"),
    relative: TemporalHelpers.toRelative(dateTime),
  };
}

/**
 * Resolve a userId into memberMentionsCollection or userMentionsCollection.
 * Checks cache first, then falls back to guild API fetch.
 * Deduplicates logic previously repeated in name-match and group-reference blocks.
 */
async function ensureMentionPopulated(
  userId: string,
  {
    message,
    memberMentionsCollection,
    userMentionsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    logPrefix = "",
  }: {
    message: import("discord.js").Message;
    memberMentionsCollection: import("discord.js").Collection<
      string,
      import("discord.js").GuildMember
    >;
    userMentionsCollection: import("discord.js").Collection<
      string,
      import("discord.js").User
    >;
    participantsMembersCollection: import("discord.js").Collection<
      string,
      import("discord.js").GuildMember
    >;
    participantsUsersCollection: import("discord.js").Collection<
      string,
      import("discord.js").User
    >;
    logPrefix?: string;
  },
) {
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

// Canonical Lupos reference for self-portraits: a pinned still of the bot's
// Discord profile avatar. Attaching it on self-portrait intent keeps him the
// SAME recognizable wolf across renders instead of a fresh design each time
// (reference-conditioned character consistency — Gemini image generation /
// "Nano Banana": https://ai.google.dev/gemini-api/docs/image-generation).
const CANONICAL_SELF_PORTRAIT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../images/lupos-canonical-reference.png",
);
let canonicalSelfPortraitDataUrl: string | null | undefined;

function loadCanonicalSelfPortraitReference(): string | null {
  if (canonicalSelfPortraitDataUrl !== undefined) {
    return canonicalSelfPortraitDataUrl;
  }
  try {
    const imageBuffer = fs.readFileSync(CANONICAL_SELF_PORTRAIT_PATH);
    canonicalSelfPortraitDataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
  } catch {
    console.warn(
      `⚠️ [PromptBuilder] Canonical self-portrait reference missing at ${CANONICAL_SELF_PORTRAIT_PATH} — falling back to the live avatar URL`,
    );
    canonicalSelfPortraitDataUrl = null;
  }
  return canonicalSelfPortraitDataUrl;
}

/**
 * Append verbatim `kind: "code"` tool outputs (ASCII banners, hashes,
 * diffs — anything tagged with a self-describing code display by
 * tools-service) as fenced blocks when the reply text doesn't already
 * contain the exact payload. Small models corrupt whitespace-exact text
 * when retyping it; the tool result is the source of truth. Oversized
 * payloads are skipped — they wouldn't survive Discord's 2000-char
 * message limit inside a single fence anyway.
 */
const MAX_INLINE_CODE_CHARS = 1500;
export function appendVerbatimCodeResults(
  text: string,
  toolResults:
    | Array<{ name?: string; result?: unknown; status?: string }>
    | undefined,
): string {
  if (!toolResults?.length) return text;
  let output = text;
  for (const toolResult of toolResults) {
    const resultObject =
      toolResult.result && typeof toolResult.result === "object"
        ? (toolResult.result as Record<string, unknown>)
        : null;
    const display = resultObject?.display as
      | { kind?: string; sourceField?: string; language?: string }
      | undefined;
    if (display?.kind !== "code" || !display.sourceField) continue;
    const codeText = resultObject?.[display.sourceField];
    if (typeof codeText !== "string" || !codeText.trim()) continue;
    // Already present verbatim (the model used the {{tool_output}} token
    // and Prism substituted it, or copied it correctly) — nothing to add.
    if (output.includes(codeText.trim())) continue;
    if (codeText.length > MAX_INLINE_CODE_CHARS) continue;
    const fenceLanguage =
      display.language && display.language !== "text" ? display.language : "";
    output = `${output}\n\`\`\`${fenceLanguage}\n${codeText.replace(/\s+$/, "")}\n\`\`\``;
  }
  return output;
}

/**
 * Pull a media URL out of tool results tagged with a self-describing
 * display envelope of the given kind — `video` (e.g. trim_video's MinIO
 * downloadUrl) or `image` (e.g. emoji kitchen, QR codes, GIF conversions).
 * First match wins — Discord replies carry at most one attachment per
 * kind. The send path downloads the URL and attaches it, falling back to
 * posting the URL when the file exceeds the guild's upload cap.
 */
export function extractDisplayMediaUrl(
  toolResults:
    | Array<{ name?: string; result?: unknown; status?: string }>
    | undefined,
  kind: "video" | "image",
): string | null {
  if (!toolResults?.length) return null;
  for (const toolResult of toolResults) {
    const resultObject =
      toolResult.result && typeof toolResult.result === "object"
        ? (toolResult.result as Record<string, unknown>)
        : null;
    const display = resultObject?.display as
      | { kind?: string; url?: string }
      | undefined;
    if (display?.kind === kind && typeof display.url === "string") {
      return display.url;
    }
  }
  return null;
}

/**
 * Pull the generation prompt out of an agent response's generate_image tool
 * call. Prism's /agent JSON path emits `{ name, args }` entries while the
 * declared client type is OpenAI-style `{ function: { name, arguments } }`
 * (JSON-encoded args) — accept both. Returns null when no generate_image
 * call with a usable prompt exists.
 */
export function extractGenerateImagePrompt(
  toolCalls: unknown[] | undefined,
): string | null {
  if (!toolCalls?.length) return null;
  for (const rawToolCall of toolCalls) {
    const toolCall = rawToolCall as {
      name?: string;
      args?: Record<string, unknown>;
      function?: { name?: string; arguments?: string };
    } | null;
    if (!toolCall) continue;

    // Prism /agent shape: { name, args }
    if (toolCall.name === "generate_image") {
      const promptArg = toolCall.args?.prompt;
      if (typeof promptArg === "string" && promptArg.trim()) {
        return promptArg.trim();
      }
    }

    // OpenAI-style shape: { function: { name, arguments: "<json>" } }
    if (toolCall.function?.name === "generate_image") {
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments || "{}") as {
          prompt?: unknown;
        };
        if (typeof parsedArgs.prompt === "string" && parsedArgs.prompt.trim()) {
          return parsedArgs.prompt.trim();
        }
      } catch {
        /* malformed tool-call arguments — ignore */
      }
    }
  }
  return null;
}

export async function generateDescription(
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
      const { absolute, relative } = formatAbsoluteAndRelative(
        lastMessageSentByUser.createdTimestamp,
      );
      messageSentAt = absolute;
      messageSentAtRelative = relative;
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
    const customStatus = presence.activities.find(
      (a: import("discord.js").Activity) => a.type === 4,
    );
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
    const toHex = (d: number) =>
      "#" + d.toString(16).padStart(6, "0").toUpperCase();
    const hexColor = toHex(user.accentColor);
    const colorName = GetColorName ? GetColorName(hexColor) : hexColor;
    systemPrompt += `\n- Profile color (their choice of color): ${colorName} (${hexColor})`;
  }

  if (who === "PRIMARY") {
    const { absolute: accountCreatedAt, relative: accountCreatedAtRelative } =
      formatAbsoluteAndRelative(user.createdTimestamp);
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
    const { absolute: serverJoinDateAt, relative: serverJoinDateRelative } =
      formatAbsoluteAndRelative(member.joinedTimestamp);
    systemPrompt += `\n- Join date: ${serverJoinDateAt} (${serverJoinDateRelative})`;
  }
  // is boosting the server
  if (member?.premiumSinceTimestamp) {
    const { absolute: boostDateAt, relative: boostDateRelative } =
      formatAbsoluteAndRelative(member.premiumSinceTimestamp);
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
  const hasModPerms = modPerms.filter((perm: string) =>
    member?.permissions?.has(perm as import("discord.js").PermissionResolvable),
  );
  if (hasModPerms.length > 0) {
    systemPrompt += `\n- Moderation permissions: ${hasModPerms.join(", ")}`;
  }
  const channelPerms =
    member && (message as Message).channel
      ? member.permissionsIn((message as Message).channel as TextChannel)
      : null;
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
    const voiceState = member.voice as VoiceState & {
      cameraOn?: boolean;
      streaming?: boolean;
    };
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

export async function buildAndGenerateReply({
  conversation,
  conversationsCollection,
  memberMentionsCollection,
  messagesEmojisCollection,
  messagesImagesCollection,
  participantsAvatarsCollection,
  participantsBannersCollection,
  participantsCollection,
  participantsMembersCollection,
  participantsUsersCollection,
  queuedDatum,
  userMentionsCollection,
  localMongo,
  statusTracker,
}: {
  conversation: Record<string, unknown>[];
  conversationsCollection: import("discord.js").Collection<
    string,
    Record<string, unknown>[]
  >;
  memberMentionsCollection: import("discord.js").Collection<
    string,
    import("discord.js").GuildMember
  >;
  messagesEmojisCollection: import("discord.js").Collection<string, unknown>;
  messagesImagesCollection: import("discord.js").Collection<string, unknown>;
  newSystemPrompt: string;
  participantsAvatarsCollection: import("discord.js").Collection<
    string,
    string
  >;
  participantsBannersCollection: import("discord.js").Collection<
    string,
    string
  >;
  participantsCollection: import("discord.js").Collection<
    string,
    | import("discord.js").GuildMember
    | import("discord.js").User
    | { id: string }
  >;
  participantsMembersCollection: import("discord.js").Collection<
    string,
    import("discord.js").GuildMember
  >;
  participantsUsersCollection: import("discord.js").Collection<
    string,
    import("discord.js").User
  >;
  queuedDatum: {
    message: import("discord.js").Message;
    recentMessages: import("discord.js").Collection<
      string,
      import("discord.js").Message
    >;
    actionType?: string;
  };
  userMentionsCollection: import("discord.js").Collection<
    string,
    import("discord.js").User
  >;
  localMongo: import("mongodb").MongoClient;
  /** Live presence-status sink for /agent SSE events (optional). */
  statusTracker?: AgentStatusTracker;
}) {
  // Build the system prompt
  const { message, recentMessages } = queuedDatum;
  const client = message.client;
  const bot = client.user;
  let systemPrompt: string;

  let generatedText: string;
  const serverContext: {
    title?: string;
    keywords?: string | string[];
    description?: string;
  }[] = [];
  let image: unknown = null;
  let audioRef: string | null = null;
  let videoUrl: string | null = null;
  let imageUrl: string | null = null;
  let imagePrompt: string | null = null;
  try {
    if (
      (message as Message).guildId === config.GUILD_ID_PRIMARY ||
      (message as Message).guildId === config.GUILD_ID_TESTING
    ) {
      // Match recent messages and user names against custom context keywords
      const customContextWhitemane = MessageConstant.customContextWhitemane;
      const serverContextSet = new Set<{
        title?: string;
        keywords?: string | string[];
        description?: string;
      }>();

      const contextWithPatterns = customContextWhitemane.map(
        (context: { keywords: string | string[] }) => {
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
        },
      );

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
        (channel: import("discord.js").GuildBasedChannel) =>
          ((channel.type as unknown as number) === 2 ||
            (channel.type as unknown as string) === "GUILD_VOICE") &&
          (channel as import("discord.js").VoiceChannel).members &&
          (channel as import("discord.js").VoiceChannel).members.size > 0,
      );
      if (voiceChannelMembers.size) {
        systemPrompt += `\n- The following voice channels have members in them:`;
        for (const channel of voiceChannelMembers.values()) {
          const chan = channel as
            | import("discord.js").VoiceChannel
            | import("discord.js").StageChannel;
          systemPrompt += `\n  - ${chan.name} (${chan.members.size} members)`;
          for (const member of chan.members.values()) {
            systemPrompt += `\n    - ${utilities.getCombinedNamesFromUserOrMember({ member })}`;
          }
        }
      }
    }
    if (message?.channel) {
      const channel = message.channel as
        | import("discord.js").TextChannel
        | import("discord.js").ThreadChannel;
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
    const messageText = (
      message.cleanContent ||
      (message as Message).content ||
      ""
    ).toLowerCase();
    const hasImageAttachments = message.attachments?.some(
      (a: import("discord.js").Attachment) =>
        a.contentType?.startsWith("image/"),
    );
    const isLikelyImageRequest =
      hasImageAttachments || mightBeImageRequest(messageText);

    // Cache the message reference once — reused by the self-reference
    // suppression below, the replied-to image capture, and avatar filtering.
    const cachedMessageReference = message.reference?.messageId
      ? await DiscordUtilityService.retrieveMessageReferenceFromMessage(message)
      : null;

    // Is this a reply to one of the bot's own messages that carries media
    // (i.e. a generated image the capture block below will pick up)? If so,
    // the replied-to image is what the user is talking about — the
    // self-reference tier must NOT hijack the request by attaching the
    // author's avatar (dative phrasings like "make me a bigger version"
    // false-positive as self-references and used to swap the subject from
    // the generated image to the user's profile picture).
    const repliedToBotImage: boolean =
      cachedMessageReference?.author?.id === bot.id &&
      Boolean(
        cachedMessageReference.attachments?.some(
          (attachment: import("discord.js").Attachment) =>
            attachment.contentType?.startsWith("image/") ||
            attachment.contentType?.startsWith("video/"),
        ) ||
        cachedMessageReference.embeds?.some(
          (embed: import("discord.js").Embed) =>
            embed.image || embed.thumbnail || embed.video,
        ),
      );

    // Detect untagged user names in image generation requests
    // e.g. "draw Rodrigo as a samurai" without @Rodrigo
    const untaggedMatchedUserIds = new Set<string>();
    if (isLikelyImageRequest) {
      // Build list of known participants (exclude bot, already-mentioned users, and message author)
      // The author is excluded because "draw your X" shouldn't match the author's name.
      // If the author wants to draw themselves, they should use "draw me" or @mention themselves.
      const alreadyMentionedIds = new Set([
        ...(memberMentionsCollection?.keys() || []),
        ...(userMentionsCollection?.keys() || []),
        bot.id,
        message.author?.id,
      ]);

      const knownParticipants: {
        id: string;
        username: string;
        displayName: string;
      }[] = [];
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
        const matchedIds = findUntaggedNameMatches(
          message.cleanContent || (message as Message).content || "",
          knownParticipants,
        );

        for (const matchedId of matchedIds) {
          untaggedMatchedUserIds.add(matchedId);
          // Add to memberMentionsCollection so they get full generateDescription treatment
          await ensureMentionPopulated(matchedId, {
            message,
            memberMentionsCollection,
            userMentionsCollection,
            participantsMembersCollection,
            participantsUsersCollection,
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
    if (isLikelyImageRequest) {
      // Only detect group refs when image generation is likely
      const groupCount = detectGroupReference(
        message.cleanContent || (message as Message).content || "",
      );

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
            message,
            memberMentionsCollection,
            userMentionsCollection,
            participantsMembersCollection,
            participantsUsersCollection,
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
    // When the message replies to a bot message that carries an image, the
    // replied-to image is the subject — skip BOTH self-reference tiers so
    // "make me a bigger version" edits the generated image instead of
    // attaching the author's avatar. @mention and name-match attachment
    // above are deliberately left untouched ("draw me next to @Rodrigo"
    // still resolves Rodrigo's avatar).
    if (
      isLikelyImageRequest &&
      !untaggedMatchedUserIds.has(message.author.id) &&
      !repliedToBotImage
    ) {
      const selfText =
        message.cleanContent || (message as Message).content || "";

      // ── Tier 1: Fast-path regex (English) ──────────────────────
      if (hasSelfReferenceRegex(selfText)) {
        untaggedMatchedUserIds.add(message.author.id);
        console.log(
          `🪞 [DiscordService] Self-referential detected (regex fast-path) — adding author ${message.author.id} to image references`,
        );
      } else {
        // ── Tier 2: LLM fallback (multilingual, indirect refs) ───
        // Only runs when regex didn't match but image request is likely.
        // Uses the fastest model (~200ms) with a simple yes/no classification.
        const isSelfRef = await detectSelfReferenceViaLLM(selfText);
        if (isSelfRef) {
          untaggedMatchedUserIds.add(message.author.id);
          console.log(
            `🪞 [DiscordService] Self-referential detected (LLM fallback) — adding author ${message.author.id} to image references`,
          );
        }
      }
    }

    // Detect the bot being asked to draw ITSELF ("draw yourself", "take a
    // selfie") — the canonical reference gets attached in the image block
    // below so Lupos stays the same recognizable wolf across self-portraits.
    // Deliberately NOT gated on isLikelyImageRequest: selfie phrasings
    // ("take a selfie") carry image intent without a draw-verb, and the
    // regex is itself image-specific. Skipped for replies to bot images for
    // the same reason as above: the replied-to image is the subject.
    const isBotSelfPortraitRequest =
      !repliedToBotImage &&
      hasBotSelfPortraitRegex(
        message.cleanContent || (message as Message).content || "",
      );

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
      const filteredParticipants = participantsCollection.filter(
        (participant: GuildMember | User | Record<string, unknown>) => {
          const pId =
            (participant as { user?: { id: string }; id?: string }).user?.id ||
            (participant as { user?: { id: string }; id?: string }).id;
          if (!pId) return false;
          if (pId === message.author.id) return false;
          if (memberMentionsCollection?.has(pId)) return false;
          if (userMentionsCollection?.has(pId)) return false;
          return true;
        },
      );
      if (filteredParticipants.size > 0) {
        systemPrompt += `\n\n# Secondary participants (${filteredParticipants.size})`;
        systemPrompt += `\nYou are aware of other participants in this conversation, but you are only replying to me.`;
      }
      let currentUserCount = 0;
      for (const participant of filteredParticipants.values()) {
        const pId =
          (participant as { user?: { id: string }; id: string }).user?.id ||
          (participant as { id: string }).id;
        participantConversation = conversationsCollection.get(pId);
        participantMember = participantsMembersCollection.get(pId);
        participantUser = participantsUsersCollection.get(pId);
        currentUserCount++;
        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          participant as
            | import("discord.js").User
            | import("discord.js").GuildMember,
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
          const pId =
            (participant as { user?: { id: string }; id?: string }).user?.id ||
            (participant as { user?: { id: string }; id?: string }).id;
          if (pId && !participantUserIds.includes(pId)) {
            participantUserIds.push(pId);
          }
        }
      }
    }

    // Trending data is now fetched and injected via agentContext
    // in the agent path below — no longer appended to systemPrompt here.

    const imageUrls: string[] = [];
    const imageLabels: string[] = []; // Tracks what each image in imageUrls represents
    // url → caption for attached/replied reference images (filled by the
    // caption step below; avatar captions live in captionsMap instead).
    const referenceCaptionsMap = new Map<string, string>();
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
      const attachmentImages = messagesImagesCollection.get(
        (message as Message).id,
      ) as import("discord.js").Collection<
        string,
        { url: string }
      > | undefined;
      if (attachmentImages && attachmentImages.size > 0) {
        for (const imageObject of attachmentImages.values()) {
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

    // (cachedMessageReference is computed above, before the image-intent
    // detection blocks, so the self-reference tier can be suppressed for
    // replies to the bot's own images.)

    // Unambiguous label for the replied-to image so the model binds "it" /
    // "this" to the right picture instead of a better-described avatar.
    const repliedToImageLabel =
      cachedMessageReference?.author?.id === bot.id
        ? "THE IMAGE BEING DISCUSSED (from the replied-to message, posted by you)"
        : "THE IMAGE BEING DISCUSSED (from the replied-to message)";

    // If it's replying to a message with an image
    if (message.reference && message.reference.messageId) {
      const referencedMessageImages = messagesImagesCollection.get(
        message.reference.messageId as string,
      ) as import("discord.js").Collection<
        string,
        { url: string }
      > | undefined;
      // If the referenced message has an image in the collection, use that
      // (both user and bot messages are captioned into the collection)
      if (referencedMessageImages && referencedMessageImages.size > 0) {
        const firstImage = referencedMessageImages.first();
        const imageUrl = firstImage?.url;
        if (imageUrl) {
          imageLabels.push(repliedToImageLabel);
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
              imageLabels.push(repliedToImageLabel);
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
                embed.image?.proxyURL ||
                embed.image?.url ||
                embed.thumbnail?.proxyURL ||
                embed.thumbnail?.url;
              const videoUrl = embed.video?.proxyURL || embed.video?.url;
              const embedImageUrl = staticImageUrl || videoUrl;

              if (embedImageUrl) {
                // If we only have a video/GIF URL (no static thumbnail), extract
                // the first frame so the model receives a proper static image
                if (!staticImageUrl && videoUrl) {
                  try {
                    const videoResponse = await fetch(videoUrl);
                    const videoBuffer = Buffer.from(
                      await videoResponse.arrayBuffer(),
                    );
                    const contentType =
                      videoResponse.headers.get("content-type") || "";
                    if (
                      contentType.includes("gif") ||
                      contentType.includes("image")
                    ) {
                      const { default: sharp } = await import("sharp");
                      const firstFrameBuffer = await sharp(videoBuffer, {
                        animated: false,
                      })
                        .png()
                        .toBuffer();
                      const firstFrameDataUrl = `data:image/png;base64,${firstFrameBuffer.toString("base64")}`;
                      imageLabels.push(
                        `${repliedToImageLabel} (embedded, first frame)`,
                      );
                      imageUrls.push(firstFrameDataUrl);
                      foundImage = true;
                      console.log(
                        `🖼️ [DiscordService] Extracted first frame from GIF embed for reference`,
                      );
                      break;
                    }
                  } catch (frameError: unknown) {
                    console.warn(
                      `🖼️ [DiscordService] First-frame extraction failed, using video URL directly: ${(frameError as Error).message}`,
                    );
                  }
                }

                if (!foundImage) {
                  imageLabels.push(`${repliedToImageLabel} (embedded)`);
                  imageUrls.push(embedImageUrl);
                  foundImage = true;
                }
                break;
              }
            }
          }

          if (foundImage) {
            console.log(
              `🖼️ [DiscordService] Captured reference image from replied-to message (${cachedMessageReference.author?.bot ? "bot" : "user"})`,
            );
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
      // Key captions by URL so labels stay aligned with their images even
      // when captioning fails or deduplicates entries (the map is keyed by
      // content hash, so index-based pairing is unreliable).
      for (const mapObject of imagesMap.values()) {
        referenceCaptionsMap.set(mapObject.url, mapObject.caption);
      }
      // Build <attached-reference-images> block with indexed descriptions.
      // The URL rides along so the agent has a real handle to pass into
      // image tools (data: URIs are filtered out by the block builder).
      const referenceEntries = imageUrls.map(
        (imageUrl: string, index: number) => ({
          label: imageLabels[index] || `Attachment ${index + 1}`,
          caption: referenceCaptionsMap.get(imageUrl),
          url: imageUrl,
        }),
      );
      const referenceBlock = buildReferenceImagesBlock(referenceEntries);
      if (referenceBlock) {
        edittedMessageCleanContent += `\n${referenceBlock}`;
      }
    }
    // If it mentions a user with an avatar, use that avatar as the image
    // Track which user IDs have already had their avatar added to prevent
    // duplicates across tagged mentions and untagged name-match paths.
    const avatarUserIdsAdded = new Set();
    if (message.mentions && message.mentions.users.size > 0) {
      const repliedUserId = cachedMessageReference?.author?.id;

      let mentionedMembersOrUsersWithAvatars:
        | import("discord.js").Collection<string, GuildMember>
        | import("discord.js").Collection<string, User> = (
        message.mentions.members || new Collection<string, GuildMember>()
      ).filter((member: GuildMember) => {
        // Exclude bot and the replied-to user (if this is a reply)
        return (
          member.id !== bot.id &&
          member.id !== repliedUserId &&
          member.user.avatar
        );
      });

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
    if (untaggedMatchedUserIds.size > 0) {
      // Agent-era: always resolve avatar images
      const repliedUserId = cachedMessageReference?.author?.id;

      for (const matchedId of untaggedMatchedUserIds) {
        // Skip if already handled by @mention block above
        if (avatarUserIdsAdded.has(matchedId)) continue;
        if (
          mentionsImageUrls.some(
            (m: Record<string, unknown>) => m.userId === matchedId,
          )
        )
          continue;
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
        const matchedUser =
          participantsUsersCollection.get(matchedId) ||
          (matchedId === message.author?.id ? message.author : null);
        const avatarSource = matchedMember || matchedUser;

        const avatarUrl = resolveAvatarUrl(
          avatarSource as
            | import("discord.js").User
            | import("discord.js").GuildMember,
        );
        if (avatarUrl) {
          mentionsImageUrls.push({ userId: matchedId, url: avatarUrl });
        }
      }
      // Attach untagged user avatars as base64 references for generate_image
      // (no text injection — avatar URLs are already per-participant in the system prompt)
      const uncaptionedUrls = mentionsImageUrls.filter(
        (m: Record<string, unknown>) =>
          !avatarUserIdsAdded.has(m.userId as string) &&
          !imageUrls.includes(m.url as string),
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
        const emojiObject = emojiObj as {
          url: string;
          caption?: string;
          name?: string;
        };
        if (emojiObject && emojiObject.url) {
          const emojiData = await splitEmojiNameAndId(emoji);
          const emojiName = emojiData
            ? emojiData.name
            : emojiObject.name || emoji;
          const caption = emojiObject.caption || "";
          imageLabels.push(
            `Emoji: ${emojiName}${caption ? ` — ${caption}` : ""}`,
          );
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
      let serverContextText =
        "\n\n# Relevant information for this conversation";
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
      participantUserIds:
        participantUserIds.length > 0 ? participantUserIds : null,
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
        console.warn(
          `⏰ [DiscordService] Clock Crew context failed: ${(clockErr as Error).message}`,
        );
      }
    }

    // ── Build agent conversation ─────────────────────────────────
    // No system prompt injected here — Prism's SystemPromptAssembler
    // builds the complete prompt (persona + agentContext blocks).
    const agentConversation = [
      ...(conversation || []),
    ] as unknown as ChatMessage[];

    // Bot self-portrait: attach the canonical Lupos reference last, so it
    // rides along as a reference without displacing the request's own
    // attachments. The persona's image-prompt rules tell Lupos to stay
    // faithful to it and fold his current somatic state into the prompt.
    if (isBotSelfPortraitRequest) {
      const canonicalReference =
        loadCanonicalSelfPortraitReference() || resolveAvatarUrl(bot);
      if (canonicalReference) {
        imageLabels.push(
          "Lupos's canonical appearance (reference — keep him consistent)",
        );
        imageUrls.push(canonicalReference);
        console.log(
          `🐺 [DiscordService] Bot self-portrait detected — attaching canonical Lupos reference`,
        );
      }
    }

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
        // image is which and what it looks like. Reference-image captions
        // (attached/replied-to images, including the bot's own generated
        // images) come from referenceCaptionsMap; avatar/banner captions
        // come from captionsMap.
        if (imageLabels.length > 0) {
          const attachedBlock = buildReferenceImagesBlock(
            imageLabels.map((label: string, i: number) => ({
              label,
              caption:
                referenceCaptionsMap.get(imageUrls[i]) ||
                captionsMap?.get(imageUrls[i]),
              // Real handle for image tools; data: URIs filtered by builder
              url: imageUrls[i],
            })),
          );
          if (attachedBlock) {
            lastUserMsg.content += `\n\n${attachedBlock}`;
          }
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
        videoUrl: null,
        imageUrl: null,
        imagePrompt: null,
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
      temperature: config.LANGUAGE_MODEL_TEMPERATURE
        ? parseFloat(config.LANGUAGE_MODEL_TEMPERATURE)
        : undefined,
      thinkingEnabled: true,
      thinkingBudget: 10_000,
      username: message.author?.username || "unknown",
      ...AIService._getTraceParams(),
      // Stream the agent SSE when a status tracker is watching so presence
      // shows live thinking/tool progress; the return shape is identical.
      ...(statusTracker && {
        onEvent: (event: PrismSseEvent) => statusTracker.handleEvent(event),
      }),
    });

    generatedText = agentResponse.text || "";

    // Extract any generated images from the agent response
    if (agentResponse.images?.length > 0) {
      const firstImage = agentResponse.images[0];
      if (firstImage.data) {
        image = Buffer.from(firstImage.data, "base64");
      } else if (firstImage.minioRef) {
        // Streamed image events are lightweight (base64 stripped when a
        // minioRef exists) — route the ref through the send path's media
        // fetcher, which resolves minio:// via Prism's file endpoint.
        imageUrl = firstImage.minioRef;
      }

      // Recover the generation prompt from the generate_image tool call so
      // the Discord attachment carries a meaningful filename/description.
      // Future context rebuilds read attachment.description first — without
      // this, the bot's own images surface as "lupos.png" with no semantics.
      // The /agent JSON response emits { name, args } tool calls (Prism
      // SseUtilities), while the declared client type is OpenAI-style
      // { function: { name, arguments } } — handle both shapes.
      imagePrompt = extractGenerateImagePrompt(
        agentResponse.toolCalls as unknown[] | undefined,
      );
    }

    // Extract any generated audio from the agent response
    audioRef = agentResponse.audioRef || null;

    // If no top-level audioRef, check tool results for audioRef (from generate_audio or synthesize_speech)
    if (!audioRef && agentResponse.toolResults?.length > 0) {
      for (const toolResult of agentResponse.toolResults) {
        const resultObject = toolResult.result as Record<
          string,
          unknown
        > | null;
        if (resultObject?.audioRef) {
          audioRef = resultObject.audioRef as string;
          break;
        }
      }
    }

    // Extract a video clip URL (display.kind === "video", e.g. trim_video)
    videoUrl = extractDisplayMediaUrl(agentResponse.toolResults, "video");

    // Extract an image display URL (emoji kitchen, QR codes, charts, GIF
    // conversions, …) — but only when no image arrived via images[].
    // Raw-image tools (generate_image) also stamp a display envelope, so
    // this guard prevents double-attaching the same picture.
    if (!image && !imageUrl) {
      imageUrl = extractDisplayMediaUrl(agentResponse.toolResults, "image");
    }

    // Sanitize the response
    generatedText = utilities.fixBareMentions(generatedText);
    generatedText = utilities.removeMentions(generatedText);
    generatedText = CensorService.removeFlaggedWords(generatedText);

    // Verbatim code outputs (display.kind === "code", e.g. ASCII banners,
    // hashes, diffs): guarantee a byte-perfect copy on Discord. Prism's
    // server-side {{tool_output}} substitution usually inlines it into the
    // reply text already — only append a fenced block when the reply
    // doesn't carry the exact payload. Appended AFTER sanitization so the
    // sanitizers can never mangle the verbatim text.
    generatedText = appendVerbatimCodeResults(
      generatedText,
      agentResponse.toolResults,
    );
  } catch (error: unknown) {
    generatedText = "...";
    console.error(
      ...LogFormatter.error("buildAndGenerateReply", error as Error),
    );
  }
  return {
    generatedText,
    image,
    audioRef: audioRef ?? null,
    videoUrl: videoUrl ?? null,
    imageUrl: imageUrl ?? null,
    imagePrompt,
  };
}
