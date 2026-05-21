// ============================================================
// DiscordState — Shared In-Memory State Singleton
// ============================================================
// Centralizes all mutable module-level state that was previously
// scattered across DiscordService.js as top-level `let` / `const`
// variables. Moving state here enables the DiscordService
// decomposition (Phase 1) without passing state through function
// arguments or using closures.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import BoundedMap from "#root/utilities/BoundedMap.js";

const DiscordState = {
  // ─── Message Processing Queue ─────────────────────────────────
  isProcessingQueue: false,
  queuedData: [] as Record<string, unknown>[],
  cancelledMessageIds: new Set<string>(),

  // Bounded maps prevent unbounded memory growth during long-running sessions.
  // TTL: 2 hours, max 5,000 entries — entries auto-evict when stale.
  repliedMessagesCollection: new BoundedMap(5000, 2 * 60 * 60 * 1000),
  botRepliedMessages: new BoundedMap(5000, 2 * 60 * 60 * 1000),

  // ─── Reaction Highlights Queue ────────────────────────────────
  isProcessingOnReactionQueue: false,
  reactionQueue: [] as { reaction: unknown; user: unknown }[],
  // Bounded maps for reaction tracking — prevents memory leaks from
  // accumulating reaction data for every message ever reacted to.
  allUniqueUsers: new BoundedMap(2000, 4 * 60 * 60 * 1000),
  reactionMessages: new BoundedMap(2000, 4 * 60 * 60 * 1000),

  // ─── Typing Indicators ───────────────────────────────────────
  typingIntervals: {} as Record<string, ReturnType<typeof setInterval>>,

  // ─── Timing ──────────────────────────────────────────────────
  lastMessageSentTime: TemporalHelpers.nowISO(),

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
};

export default DiscordState;
