import { describe, it, expect } from "vitest";
import {
  aliveInOrder,
  applyRoyaleRoll,
  createRoyaleState,
  eliminateRoyalePlayer,
  formatRoyaleGame,
  formatRoyaleLobby,
  isEliminated,
  nextAliveAfter,
  startRoyale,
} from "../royale.ts";
import type { RoyalePlayer, RoyaleState } from "../royale.ts";

const NOW = 1_800_000_000_000;

function player(id: string): RoyalePlayer {
  return { userId: id, username: id, displayName: id };
}

/** A started 4-player royale with a deterministic (unshuffled) order. */
function makeStartedState(
  playerIds = ["a", "b", "c", "d"],
  startingNumber = 100,
): RoyaleState {
  const state = createRoyaleState({
    guildId: "guild-1",
    channelId: "chan-1",
    host: player(playerIds[0]),
    startingNumber,
    wager: 0,
    maxPlayers: 8,
    now: NOW,
  });
  for (const id of playerIds.slice(1)) state.players.push(player(id));
  startRoyale(state, NOW, () => {}); // identity shuffle for determinism
  return state;
}

describe("royale lifecycle", () => {
  it("startRoyale locks the lobby and sets the first turn", () => {
    const state = makeStartedState();
    expect(state.phase).toBe("active");
    expect(state.turnOrder).toEqual(["a", "b", "c", "d"]);
    expect(state.currentTurn).toBe("a");
    expect(state.currentNumber).toBe(100);
    expect(state.startedAt).toBe(NOW);
  });

  it("a non-zero roll lowers the number and advances the turn", () => {
    const state = makeStartedState();
    const event = applyRoyaleRoll(state, 42);
    expect(event).toEqual({ type: "advance", nextPlayerId: "b" });
    expect(state.currentNumber).toBe(42);
    expect(state.currentTurn).toBe("b");
    expect(state.rolls).toHaveLength(1);
    expect(state.rolls[0]).toMatchObject({
      userId: "a",
      roll: 42,
      maxNumber: 100,
    });
  });

  it("turn order wraps around from the last player to the first", () => {
    const state = makeStartedState();
    applyRoyaleRoll(state, 50); // a → b
    applyRoyaleRoll(state, 40); // b → c
    applyRoyaleRoll(state, 30); // c → d
    const event = applyRoyaleRoll(state, 20); // d → a
    expect(event).toEqual({ type: "advance", nextPlayerId: "a" });
  });

  it("rolling 0 eliminates the roller and resets the number", () => {
    const state = makeStartedState();
    applyRoyaleRoll(state, 42); // a → b
    const event = applyRoyaleRoll(state, 0); // b eliminated
    expect(event).toEqual({
      type: "eliminated",
      userId: "b",
      forfeit: false,
      nextPlayerId: "c",
    });
    expect(isEliminated(state, "b")).toBe(true);
    expect(aliveInOrder(state)).toEqual(["a", "c", "d"]);
    expect(state.currentNumber).toBe(100);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("active");
  });

  it("skips eliminated players when advancing the turn", () => {
    const state = makeStartedState();
    applyRoyaleRoll(state, 42); // a → b
    applyRoyaleRoll(state, 0); // b out, c's turn
    applyRoyaleRoll(state, 60); // c → d
    const event = applyRoyaleRoll(state, 30); // d → a (skipping b)
    expect(event).toEqual({ type: "advance", nextPlayerId: "a" });
  });

  it("the last elimination declares a winner and ends the game", () => {
    const state = makeStartedState(["a", "b"]);
    const event = applyRoyaleRoll(state, 0); // a eliminated → b wins
    expect(event).toEqual({
      type: "winner",
      winnerId: "b",
      finalLoserId: "a",
      finalForfeit: false,
    });
    expect(state.phase).toBe("done");
    expect(state.currentTurn).toBeNull();
  });

  it("a full 4-player game plays down to one survivor", () => {
    const state = makeStartedState();
    applyRoyaleRoll(state, 0); // a out → b
    applyRoyaleRoll(state, 10); // b → c
    applyRoyaleRoll(state, 0); // c out → d
    const event = applyRoyaleRoll(state, 0); // d out → b wins
    expect(event).toMatchObject({
      type: "winner",
      winnerId: "b",
      finalLoserId: "d",
    });
    expect(state.eliminated.map((e) => e.userId)).toEqual(["a", "c", "d"]);
  });

  it("a turn-timeout forfeit eliminates the current player", () => {
    const state = makeStartedState(["a", "b", "c"]);
    const event = eliminateRoyalePlayer(state, "a", true);
    expect(event).toEqual({
      type: "eliminated",
      userId: "a",
      forfeit: true,
      nextPlayerId: "b",
    });
    expect(state.eliminated[0]).toEqual({ userId: "a", forfeit: true });
  });

  it("nextAliveAfter works for an already-eliminated pivot", () => {
    const state = makeStartedState();
    eliminateRoyalePlayer(state, "b", false);
    expect(nextAliveAfter(state, "b")).toBe("c");
    expect(nextAliveAfter(state, "d")).toBe("a");
  });
});

describe("royale rendering", () => {
  it("lobby message shows players, pot, and the entry fee", () => {
    const state = createRoyaleState({
      guildId: "g",
      channelId: "c",
      host: player("a"),
      startingNumber: 100,
      wager: 50,
      maxPlayers: 8,
      now: NOW,
    });
    state.players.push(player("b"));
    const content = formatRoyaleLobby(state, 1234567890);
    expect(content).toContain("DEATHROLL ROYALE");
    expect(content).toContain("<@a>");
    expect(content).toContain("(2/8)");
    expect(content).toContain("entry 🪙 50g");
    // 2 wagers (100g) minus the 10% house rake
    expect(content).toContain("🪙 90g");
    expect(content).toContain("house rake");
  });

  it("game message caps the roll history and stays under Discord's limit", () => {
    const state = makeStartedState();
    for (let i = 0; i < 40; i++) {
      applyRoyaleRoll(state, 50 + (i % 3)); // never 0 — no eliminations
    }
    const content = formatRoyaleGame(state, null);
    expect(content).toContain("…30 earlier rolls");
    expect(content.length).toBeLessThan(2000);
    expect(content).toContain("it's your turn!");
  });
});
