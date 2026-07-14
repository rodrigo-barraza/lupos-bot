import { describe, it, expect } from "vitest";
import { buildGameSnapshot } from "../persistence.ts";
import type { GameState } from "../types.ts";

function makeGame(overrides: Partial<GameState> = {}): GameState {
  return {
    initiator: "user-a",
    initiatorName: "alice",
    opponent: "user-b",
    opponentName: "bob",
    targetUserId: null,
    currentNumber: 42,
    currentTurn: "user-b",
    messageId: "msg-1",
    channelId: "chan-1",
    startingNumber: 100,
    rolls: [{ userId: "user-b", username: "bob", roll: 42, maxNumber: 100 }],
    startedAt: 1700000000000,
    currentMessageId: "msg-2",
    timeoutMultiplier: 2,
    ...overrides,
  };
}

describe("buildGameSnapshot", () => {
  it("captures the compact game state with the given phase", () => {
    const game = makeGame();
    const snapshot = buildGameSnapshot("game-1", "guild-1", game, "active");

    expect(snapshot).toMatchObject({
      gameId: "game-1",
      guildId: "guild-1",
      channelId: "chan-1",
      messageId: "msg-1",
      currentMessageId: "msg-2",
      initiator: "user-a",
      opponent: "user-b",
      currentTurn: "user-b",
      currentMax: 42,
      startingNumber: 100,
      timeoutMultiplier: 2,
      phase: "active",
      startedAt: 1700000000000,
    });
    expect(snapshot.rolls).toHaveLength(1);
    expect(typeof snapshot.updatedAt).toBe("number");
    expect(snapshot.pendingTimeout).toBeUndefined();
    expect(snapshot.pendingResult).toBeUndefined();
  });

  it("defaults a missing timeout multiplier to 1", () => {
    const game = makeGame({ timeoutMultiplier: 0 });
    const snapshot = buildGameSnapshot("game-1", "guild-1", game, "pending");
    expect(snapshot.timeoutMultiplier).toBe(1);
  });

  it("records pending timeout and result for the don_pending phase", () => {
    const game = makeGame();
    const snapshot = buildGameSnapshot(
      "game-1",
      "guild-1",
      game,
      "don_pending",
      {
        pendingTimeout: { loserId: "user-b", timeoutDuration: 600000 },
        pendingResult: {
          winnerId: "user-a",
          loserId: "user-b",
          winnerInfo: { username: "alice", displayName: "Alice" },
          loserInfo: { username: "bob", displayName: "Bob" },
        },
      },
    );

    expect(snapshot.phase).toBe("don_pending");
    expect(snapshot.pendingTimeout).toEqual({
      loserId: "user-b",
      timeoutDuration: 600000,
    });
    expect(snapshot.pendingResult?.winnerId).toBe("user-a");
    expect(snapshot.pendingResult?.loserInfo).toEqual({
      username: "bob",
      displayName: "Bob",
    });
  });

  it("represents a not-yet-accepted challenge (pending phase)", () => {
    const game = makeGame({
      opponent: null,
      opponentName: null,
      currentTurn: null,
      rolls: [],
      timeoutMultiplier: 1,
    });
    const snapshot = buildGameSnapshot("game-1", "guild-1", game, "pending");
    expect(snapshot.opponent).toBeNull();
    expect(snapshot.currentTurn).toBeNull();
    expect(snapshot.rolls).toHaveLength(0);
  });
});
