// ============================================================
// Discord display formatting — entity name/ID combos, CDN URL
// builders, message URLs, reaction and time formatters.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import { ansiEscapeCodes } from "#root/utilities/console.js";
import type {
  Guild,
  GuildMember,
  MessageReaction,
  Role,
  User,
} from "discord.js";

interface UserOrMemberParam {
  user?: User | null;
  member?: GuildMember | null;
}

export function getCombinedNamesFromUserOrMember(
  { user, member }: UserOrMemberParam,
  isConsoleLog: boolean = false,
) {
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  const parts: string[] = [];

  if (member) {
    if (member.nickname) parts.push(bold(member.nickname));
    if (!member.nickname && member.user?.globalName)
      parts.push(bold(member.user?.globalName));
    if (member.user?.username) parts.push(member.user.username);
    if (member.user?.globalName && member.nickname)
      parts.push(member.user.globalName);
    if (member.user?.id) parts.push(faint(`<@${member.user.id}>`));
  } else if (user) {
    parts.push(bold(user.username));
    if (user.globalName) parts.push(user.globalName);
    if (!user.globalName && user.tag) {
      parts.push(`${user.tag}`);
    }
    parts.push(faint(`<@${user.id}>`));
  }

  return parts.join(" • ");
}

export function getCombinedGuildInformationFromGuild(
  guild: Guild | null,
  isConsoleLog: boolean = false,
) {
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  let combinedGuildInformation: string | undefined;
  if (guild) {
    combinedGuildInformation = `${bold(guild.name)} • ${faint(guild.id)}`;
  }
  return combinedGuildInformation;
}

export function getCombinedChannelInformationFromChannel(
  channel: { name: string; id: string } | null,
  isConsoleLog: boolean = false,
) {
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  let combinedChannelInformation: string | undefined;
  if (channel) {
    combinedChannelInformation = `#${bold(channel.name)} • ${faint(channel.id)}`;
  }
  return combinedChannelInformation;
}

export function getCombinedEmojiInformationFromReaction(
  reaction: MessageReaction | null,
  isConsoleLog: boolean = false,
) {
  if (!reaction) return;
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  const emoji = reaction.emoji;
  const parts: string[] = [];
  if (emoji) {
    parts.push(bold(emoji.name || "unknown"));
    if (emoji.id) {
      parts.push(faint(`<:${emoji.name}:${emoji.id}>`));
    }
  }
  return parts.join(" • ");
}

export function getCombinedRoleInformationFromRole(
  role: Role | null,
  isConsoleLog: boolean = false,
) {
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  let combinedRoleInformation: string | undefined;
  if (role) {
    combinedRoleInformation = `${bold(role.name)} • ${faint(role.id)}`;
  }
  return combinedRoleInformation;
}

export function getCombinedDateInformationFromDate(
  unixDate: number | null | undefined,
  isConsoleLog: boolean = false,
) {
  const { bold, faint } = ansiEscapeCodes(isConsoleLog);
  const effectiveDate = unixDate || Date.now();
  const dateTime = TemporalHelpers.fromMillis(effectiveDate);
  const time = TemporalHelpers.format(dateTime, "hh:mm:ss a");
  const date = TemporalHelpers.format(dateTime, "LLLL dd, yyyy");
  const combinedDateInformation = `${bold(time)} ${faint("on")} ${faint(date)} • ${faint(String(effectiveDate))}`;
  return combinedDateInformation;
}

/**
 * Build a Discord CDN avatar URL.
 * Handles animated avatars (a_ prefix → .gif) vs static (.png).
 * When `guildAvatar` is provided (a guild-specific avatar hash),
 * it takes precedence over the user's global avatar.
 */
export function getDiscordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
  size: number = 512,
  guildAvatar?: { guildId: string; avatarHash: string } | null,
) {
  if (!userId) return null;
  if (guildAvatar?.guildId && guildAvatar.avatarHash) {
    const ext = guildAvatar.avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/guilds/${guildAvatar.guildId}/users/${userId}/avatars/${guildAvatar.avatarHash}.${ext}?size=${size}`;
  }
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
}

/**
 * Build a Discord CDN banner URL.
 * Handles animated banners (a_ prefix → .gif) vs static (.png).
 */
export function getDiscordBannerUrl(
  userId: string,
  bannerHash: string,
  size: number = 512,
) {
  if (!userId || !bannerHash) return null;
  const ext = bannerHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.${ext}?size=${size}`;
}

/**
 * Build a Discord message URL.
 */
export function getDiscordMessageUrl(
  guildId: string,
  channelId: string,
  messageId: string,
) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * Format a Discord.js reactions cache into a human-readable string.
 *   - "list":   "\n- emoji x count (by you, Lupos)"
 *   - "inline": "emoji(by you, Lupos), emoji2"
 *   - "names":  "emoji, emoji2" (names only, no counts)
 */
export function formatReactions(
  reactionsCache: Map<string, MessageReaction> | null | undefined,
  format: "list" | "inline" | "names" = "list",
) {
  if (!reactionsCache?.size) return "";
  const entries = [...reactionsCache.values()];
  switch (format) {
    case "inline":
      return entries
        .map((r) => `${r.emoji.name}${r.me ? " (by you, Lupos)" : ""}`)
        .join(", ");
    case "names":
      return entries.map((r) => r.emoji.name).join(", ");
    case "list":
    default:
      return entries
        .map(
          (r) =>
            `- ${r.emoji.name} x ${r.count}${r.me ? " (by you, Lupos)" : ""}`,
        )
        .join("\n");
  }
}

/**
 * Format a millisecond duration into a human-readable string.
 */
export function formatTimeSpan(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format a millisecond duration as playback time (m:ss).
 */
export function formatPlaybackTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Format a Date as a relative time string, e.g. "5 minutes ago". */
export function getMinutesAgo(date: Date) {
  return TemporalHelpers.toRelative(TemporalHelpers.fromJSDate(date));
}
