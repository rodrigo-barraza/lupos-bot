// ============================================================
// DiscordState — Shared In-Memory State Singleton
// ============================================================
// Centralizes all mutable module-level state that was previously
// scattered across DiscordService.js as top-level `let` / `const`
// variables. Moving state here enables the DiscordService
// decomposition (Phase 1) without passing state through function
// arguments or using closures.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.ts";
import BoundedMap from "#root/utilities/BoundedMap.ts";
import type { ReplyMode } from "#root/services/discord/Addressee.ts";
import type PrepTimings from "#root/services/discord/PrepTimings.ts";

export interface QueuedMessageData {
  message: import("discord.js").Message;
  recentMessages: import("discord.js").Collection<
    string,
    import("discord.js").Message
  >;
  actionType: string;
  /** How the reply was triggered; absent ⇒ "mention" (legacy entries). */
  replyMode?: ReplyMode;
  /** Prep-stage timings started when the message was accepted. */
  timings?: PrepTimings;
}

/**
 * How long after its author edits a message the update may still count as
 * adding a mention — the gateway delivers an edit within seconds.
 */
export const EDIT_MENTION_WINDOW_MS = 5 * 60 * 1000;

const DiscordState = {
  // ─── Message Processing Queue ─────────────────────────────────
  isProcessingQueue: false,
  queuedData: [] as QueuedMessageData[],
  cancelledMessageIds: new Set<string>(),
  // Messages that passed every gate and were taken for a reply. The
  // edit path consults this: once the reply pipeline's 500-message
  // history fetch pushes the trigger out of discord.js's cache, an edit
  // arrives with a partial oldMessage whose mentions read empty — which
  // looked like "edited to mention the bot" and queued a second reply.
  acceptedReplyIds: new BoundedMap<string, true>(5000, 6 * 60 * 60 * 1000),

  // ─── Reaction Highlights Queue ────────────────────────────────
  isProcessingOnReactionQueue: false,
  reactionQueue: [] as {
    reaction:
      | import("discord.js").MessageReaction
      | import("discord.js").PartialMessageReaction;
    user: import("discord.js").User | import("discord.js").PartialUser;
  }[],
  // Bounded maps for reaction tracking — prevents memory leaks from
  // accumulating reaction data for every message ever reacted to.
  allUniqueUsers: new BoundedMap<string, Set<string>>(2000, 4 * 60 * 60 * 1000),
  reactionMessages: new BoundedMap<string, string>(2000, 4 * 60 * 60 * 1000),

  // ─── Typing Indicators ───────────────────────────────────────
  typingIntervals: {} as Record<string, ReturnType<typeof setInterval>>,

  // ─── Timing ──────────────────────────────────────────────────
  lastMessageSentTime: TemporalHelpers.nowISO(),
  // Last time the reply queue made progress (drain started or an item
  // finished). HeartbeatService compares this against isProcessingQueue to
  // detect a wedged queue — the failure mode where one hung reply freezes
  // the single global serial drain while /health still answers 200.
  lastQueueActivityAtMs: Date.now(),

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * Check if a message has been cancelled (deleted by user before reply).
   */
  isMessageCancelled(messageId: string) {
    return this.cancelledMessageIds.has(messageId);
  },

  /**
   * Mark a message as cancelled with auto-cleanup after 5 minutes.
   */
  markCancelled(messageId: string) {
    this.cancelledMessageIds.add(messageId);
    setTimeout(() => this.cancelledMessageIds.delete(messageId), 5 * 60 * 1000);
  },

  /**
   * An AbortSignal that fires once the message is cancelled (deleted),
   * checked every `pollMs` — for handing to a long agent turn so it can
   * be abandoned mid-flight. Always call dispose() when the turn ends.
   */
  watchCancellation(messageId: string, pollMs = 1_000) {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (this.isMessageCancelled(messageId)) {
        clearInterval(timer);
        controller.abort(new Error(`trigger message ${messageId} was deleted`));
      }
    }, pollMs);
    timer.unref?.();
    return {
      signal: controller.signal,
      dispose: () => clearInterval(timer),
    };
  },

  /**
   * Record that a message was taken for a reply (queued, in flight or
   * answered), so a later edit of it never queues a second one.
   */
  markAcceptedForReply(messageId: string) {
    this.acceptedReplyIds.set(messageId, true);
  },

  wasAcceptedForReply(messageId: string) {
    return this.acceptedReplyIds.has(messageId);
  },

  /**
   * Undo markAcceptedForReply for a message that ended up not being taken
   * after all (a follow-up its running turn refused to fold in) — it then
   * goes through the normal gates as if it had never been marked.
   */
  forgetAcceptedForReply(messageId: string) {
    this.acceptedReplyIds.delete(messageId);
  },

  /**
   * Whether an edit turned a message into a new mention of the bot. The
   * mention diff alone is not enough: an uncached original arrives as a
   * partial oldMessage whose mentions read empty, so a message already
   * taken for a reply is never "newly" mentioning the bot — and the update
   * must be an edit its author just made. Discord also sends updates
   * nobody typed (an embed or attachment refreshed); on an uncached
   * message those read as a fresh mention too, and Lupos answered two
   * year-old, never-edited messages that way on 2026-09-25. A real edit
   * carries an edited timestamp from moments ago.
   */
  isEditANewMention(
    messageId: string,
    newMentionsBot: boolean,
    oldMentionsBot: boolean,
    editedAtMs: number | null,
    nowMs: number = Date.now(),
  ) {
    return (
      newMentionsBot &&
      !oldMentionsBot &&
      editedAtMs !== null &&
      nowMs - editedAtMs <= EDIT_MENTION_WINDOW_MS &&
      !this.wasAcceptedForReply(messageId)
    );
  },
};

export default DiscordState;
