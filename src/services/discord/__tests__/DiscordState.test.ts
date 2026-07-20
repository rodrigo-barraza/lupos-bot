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
});
