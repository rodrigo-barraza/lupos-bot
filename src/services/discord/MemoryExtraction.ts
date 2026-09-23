// ============================================================
// MemoryExtraction — what a reply hands Prism's /memory/extract
// ============================================================
// After a reply lands, the recent user turns go to Prism, which
// extracts durable facts about the people in them (contract §7):
//   - participants travel as { id, username, displayName } objects —
//     Prism attributes each fact by id/username, so bare display-name
//     strings left every fact unattributed;
//   - only channels @everyone can see are mined: a fact learned in a
//     private channel must never surface later in a public one.
// ============================================================

import type { Channel, Collection, GuildMember, User } from "discord.js";
import type { MemoryParticipant } from "#root/types/prism.ts";

/**
 * The people in a reply's conversation: every message author, then
 * everyone mentioned, each once, in that order.
 */
export function buildMemoryParticipants(
  participantsCollection:
    | Collection<string, { user?: User | null; member?: GuildMember | null }>
    | undefined,
  memberMentionsCollection: Collection<string, GuildMember> | undefined,
): MemoryParticipant[] {
  const participants: MemoryParticipant[] = [];
  const addedIds = new Set<string>();
  const add = (user: User | null | undefined, member?: GuildMember | null) => {
    const id = user?.id || member?.id;
    if (!id || addedIds.has(id)) return;
    addedIds.add(id);
    const username = user?.username || member?.user?.username || "";
    participants.push({
      id,
      username,
      displayName:
        member?.displayName ||
        user?.globalName ||
        member?.user?.globalName ||
        username,
    });
  };
  for (const participant of participantsCollection?.values() ?? []) {
    add(participant?.user, participant?.member);
  }
  for (const member of memberMentionsCollection?.values() ?? []) {
    add(member.user, member);
  }
  return participants;
}

/**
 * Whether @everyone can view the channel (ViewChannel for the guild's
 * everyone role, overwrites included). Threads answer for their parent.
 * Anything unresolvable — DMs, a missing parent, no permission data —
 * counts as not public.
 */
export function isVisibleToEveryone(
  channel: Channel | null | undefined,
): boolean {
  if (!channel || channel.isDMBased()) return false;
  const target = channel.isThread() ? channel.parent : channel;
  if (!target || !("permissionsFor" in target)) return false;
  try {
    return Boolean(
      target
        .permissionsFor(target.guild.roles.everyone)
        ?.has("ViewChannel"),
    );
  } catch {
    return false;
  }
}
