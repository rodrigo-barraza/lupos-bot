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

export interface QueuedMessageData {
  message: import("discord.js").Message;
  recentMessages: import("discord.js").Collection<
    string,
    import("discord.js").Message
  >;
  actionType: string;
}

const DiscordState = {
  // ─── Message Processing Queue ─────────────────────────────────
  isProcessingQueue: false,
  queuedData: [] as QueuedMessageData[],
  cancelledMessageIds: new Set<string>(),

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
