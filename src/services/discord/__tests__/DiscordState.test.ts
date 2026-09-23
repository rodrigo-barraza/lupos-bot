import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import DiscordState from "../DiscordState.ts";
import type { Message } from "discord.js";

/**
 * Regression tests for the shared queue/cancellation state.
 * DiscordService and DeletedMessageLogger must both operate on THIS
 * singleton — a previous split-brain bug had each side using its own
 * copy, so deleting a message never cancelled its in-flight reply.
 */

describe("DiscordState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    DiscordState.queuedData.length = 0;
    DiscordState.cancelledMessageIds.clear();
    DiscordState.acceptedReplyIds.clear();
    DiscordState.isProcessingQueue = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("cancellation", () => {
    it("marks a message cancelled and reports it", () => {
      expect(DiscordState.isMessageCancelled("123")).toBe(false);
      DiscordState.markCancelled("123");
      expect(DiscordState.isMessageCancelled("123")).toBe(true);
    });

    it("auto-expires cancellations after 5 minutes", () => {
      DiscordState.markCancelled("123");
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(DiscordState.isMessageCancelled("123")).toBe(true);
      vi.advanceTimersByTime(2);
      expect(DiscordState.isMessageCancelled("123")).toBe(false);
    });

    it("supports manual acknowledgement via cancelledMessageIds.delete", () => {
      DiscordState.markCancelled("123");
      DiscordState.cancelledMessageIds.delete("123");
      expect(DiscordState.isMessageCancelled("123")).toBe(false);
    });
  });

  describe("queue", () => {
    it("removes a deleted message from the pending queue by id", () => {
      const makeEntry = (id: string) => ({
        message: { id } as Message,
        recentMessages: new Map() as never,
        actionType: "CREATE",
      });
      DiscordState.queuedData.push(
        makeEntry("a"),
        makeEntry("b"),
        makeEntry("c"),
      );

      // Mirror of DeletedMessageLogger's queue-purge loop
      const deletedMessageId = "b";
      for (let i = DiscordState.queuedData.length - 1; i >= 0; i--) {
        if (DiscordState.queuedData[i].message?.id === deletedMessageId) {
          DiscordState.queuedData.splice(i, 1);
        }
      }

      expect(DiscordState.queuedData.map((q) => q.message.id)).toEqual([
        "a",
        "c",
      ]);
    });
  });

  // An edit to a message already taken for a reply must not queue a
  // second one — the edit path checks this before its mention diff,
  // which misreads a partial (uncached) oldMessage as "no mention".
  describe("accepted-for-reply record", () => {
    it("reports a message only after it was accepted", () => {
      expect(DiscordState.wasAcceptedForReply("m1")).toBe(false);
      DiscordState.markAcceptedForReply("m1");
      expect(DiscordState.wasAcceptedForReply("m1")).toBe(true);
      expect(DiscordState.wasAcceptedForReply("m2")).toBe(false);
    });

    it("still holds the record long after a slow reply was posted", () => {
      DiscordState.markAcceptedForReply("m1");
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(DiscordState.wasAcceptedForReply("m1")).toBe(true);
    });

    it("forgets the record after six hours", () => {
      DiscordState.markAcceptedForReply("m1");
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
      expect(DiscordState.wasAcceptedForReply("m1")).toBe(false);
    });
  });

  describe("isEditANewMention", () => {
    it("treats an edit that adds the mention as a new trigger", () => {
      expect(DiscordState.isEditANewMention("m1", true, false)).toBe(true);
    });

    it("ignores edits that keep, drop or never had the mention", () => {
      expect(DiscordState.isEditANewMention("m1", true, true)).toBe(false);
      expect(DiscordState.isEditANewMention("m1", false, true)).toBe(false);
      expect(DiscordState.isEditANewMention("m1", false, false)).toBe(false);
    });

    // The production double reply: the trigger was evicted from the
    // message cache by the 500-message history fetch, so the typo-fix
    // edit arrived with a partial oldMessage whose mentions read empty.
    it("never re-triggers a message already taken for a reply", () => {
      DiscordState.markAcceptedForReply("m1");
      expect(DiscordState.isEditANewMention("m1", true, false)).toBe(false);
    });
  });
});
