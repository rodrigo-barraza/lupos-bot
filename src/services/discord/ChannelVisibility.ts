// ============================================================
// Channel Visibility — which channels a member (or @everyone) can read
// ============================================================
// Feeds GET /guild/visible-channels, which tools-service uses to keep
// archive-backed results (message search, stats) inside what the person
// Lupos is answering can see. Reading history means ViewChannel AND
// ReadMessageHistory; threads inherit their parent's permissions.
// ============================================================

import { ChannelType, PermissionFlagsBits } from "discord.js";
import type {
  AnyThreadChannel,
  Guild,
  GuildBasedChannel,
  GuildMember,
} from "discord.js";

export interface VisibleChannels {
  channelIds: string[];
  threadIds: string[];
}

const READ_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * Channels that hold messages: text, announcement, voice/stage (text
 * chat), and forum/media (whose posts are threads under them — without
 * the parent listed, every post would read as invisible).
 */
function holdsMessages(channel: GuildBasedChannel): boolean {
  if (channel.isThread()) return false;
  return (
    channel.isTextBased() ||
    channel.type === ChannelType.GuildForum ||
    channel.type === ChannelType.GuildMedia
  );
}

/**
 * A private thread is not visible through its parent alone: only its
 * members (as far as the cache knows) and thread managers see it. With
 * no member (the @everyone view) it is never visible.
 */
function canSeePrivateThread(
  thread: AnyThreadChannel,
  member: GuildMember | null,
): boolean {
  if (!member) return false;
  if (thread.members.cache.has(member.id)) return true;
  return (
    thread.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads) ??
    false
  );
}

/**
 * `channelIds`: non-thread message channels where `member` — or, when
 * null, the @everyone role — has ViewChannel and ReadMessageHistory.
 * `threadIds`: cached threads (active, and archived ones in the cache)
 * whose parent is in `channelIds`, minus private threads the member is
 * not known to be in.
 */
export function computeVisibleChannels(
  guild: Guild,
  member: GuildMember | null,
): VisibleChannels {
  const subject = member ?? guild.roles.everyone;

  const channelIds: string[] = [];
  const parents = new Map<string, GuildBasedChannel>();
  for (const channel of guild.channels.cache.values()) {
    if (!holdsMessages(channel)) continue;
    if (!channel.permissionsFor(subject)?.has(READ_FLAGS)) continue;
    channelIds.push(channel.id);
    parents.set(channel.id, channel);
  }

  // Threads live in guild.channels.cache and in their parent's
  // threads.cache; union both so a thread only one of them knows about
  // still counts.
  const threads = new Map<string, AnyThreadChannel>();
  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) threads.set(channel.id, channel);
  }
  for (const parent of parents.values()) {
    const threadCache = (
      parent as { threads?: { cache?: Map<string, AnyThreadChannel> } }
    ).threads?.cache;
    for (const thread of threadCache?.values() ?? []) {
      threads.set(thread.id, thread);
    }
  }

  const threadIds: string[] = [];
  for (const thread of threads.values()) {
    if (!thread.parentId || !parents.has(thread.parentId)) continue;
    if (
      thread.type === ChannelType.PrivateThread &&
      !canSeePrivateThread(thread, member)
    ) {
      continue;
    }
    threadIds.push(thread.id);
  }

  return { channelIds, threadIds };
}
