import { describe, it, expect } from "vitest";
import {
  HEIST_BIG_SCORE_PCT,
  HEIST_SMALL_SCORE_PCT,
  HEIST_STAGE_KINDS,
  computeHeistLoot,
  computeHeistOutcome,
  judgeSneakClick,
  matchesRiddleAnswer,
  normalizeRiddleGuess,
  rollStageOrder,
  splitHeistLoot,
} from "../heistMath.ts";
import { HEIST_RIDDLES } from "../riddles.ts";
import {
  createHeistState,
  pointForStage,
  startHeist,
  successCount,
} from "../heistGame.ts";
import type { HeistCrewMember } from "../heistGame.ts";

const NOW = 1_800_000_000_000;

describe("computeHeistOutcome", () => {
  it("maps successes to the four tiers", () => {
    expect(computeHeistOutcome(3)).toMatchObject({
      tier: "master",
      hoardPct: HEIST_BIG_SCORE_PCT,
      stakesReturned: true,
      mauled: false,
    });
    expect(computeHeistOutcome(2)).toMatchObject({
      tier: "grab",
      hoardPct: HEIST_SMALL_SCORE_PCT,
      stakesReturned: true,
    });
    expect(computeHeistOutcome(1)).toMatchObject({
      tier: "bust",
      hoardPct: 0,
      stakesReturned: false,
      mauled: false,
    });
    expect(computeHeistOutcome(0)).toMatchObject({
      tier: "mauled",
      stakesReturned: false,
      mauled: true,
    });
  });
});

describe("computeHeistLoot", () => {
  it("floors the percentage of the hoard", () => {
    expect(computeHeistLoot(1337, 0.25)).toBe(334);
    expect(computeHeistLoot(1000, 0.1)).toBe(100);
  });

  it("never exceeds the hoard and handles empty hoards", () => {
    expect(computeHeistLoot(0, 0.25)).toBe(0);
    expect(computeHeistLoot(-50, 0.25)).toBe(0);
    expect(computeHeistLoot(100, 0)).toBe(0);
  });
});

describe("splitHeistLoot", () => {
  it("splits equally with the remainder to the first member", () => {
    expect(splitHeistLoot(100, 3)).toEqual([34, 33, 33]);
    expect(splitHeistLoot(90, 3)).toEqual([30, 30, 30]);
  });

  it("conserves the total", () => {
    const shares = splitHeistLoot(337, 6);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(337);
  });

  it("is empty for nothing to split", () => {
    expect(splitHeistLoot(0, 3)).toEqual([]);
    expect(splitHeistLoot(50, 0)).toEqual([]);
  });
});

describe("rollStageOrder", () => {
  it("returns all three stages exactly once", () => {
    const order = rollStageOrder();
    expect([...order].sort()).toEqual([...HEIST_STAGE_KINDS].sort());
  });

  it("is deterministic with an injected rand", () => {
    const fixed = () => 0.99;
    expect(rollStageOrder(fixed)).toEqual(rollStageOrder(fixed));
  });
});

describe("riddle matching", () => {
  it("normalizes case, punctuation, and articles", () => {
    expect(normalizeRiddleGuess("  The SHADOW!! ")).toBe("shadow");
    expect(normalizeRiddleGuess("a hole")).toBe("hole");
  });

  it("matches exact answers and answers embedded in a sentence", () => {
    expect(matchesRiddleAnswer("shadow", ["shadow"])).toBe(true);
    expect(matchesRiddleAnswer("it's your shadow!", ["shadow"])).toBe(true);
    expect(matchesRiddleAnswer("The Echo", ["echo", "an echo"])).toBe(true);
  });

  it("rejects wrong and partial-word guesses", () => {
    expect(matchesRiddleAnswer("shadowboxer", ["shadow"])).toBe(false);
    expect(matchesRiddleAnswer("fire", ["shadow"])).toBe(false);
    expect(matchesRiddleAnswer("", ["shadow"])).toBe(false);
  });

  it("every riddle in the bank has at least one matchable answer", () => {
    for (const riddle of HEIST_RIDDLES) {
      expect(riddle.answers.length).toBeGreaterThan(0);
      expect(matchesRiddleAnswer(riddle.answers[0], riddle.answers)).toBe(true);
    }
  });
});

describe("judgeSneakClick", () => {
  it("fails clicks before the GO signal", () => {
    expect(judgeSneakClick(NOW, NOW + 1000)).toBe("too_early");
    expect(judgeSneakClick(NOW, Infinity)).toBe("too_early");
  });

  it("passes clicks inside the window", () => {
    expect(judgeSneakClick(NOW + 500, NOW, 4000)).toBe("success");
    expect(judgeSneakClick(NOW + 4000, NOW, 4000)).toBe("success");
  });

  it("fails clicks after the window", () => {
    expect(judgeSneakClick(NOW + 4001, NOW, 4000)).toBe("too_late");
  });
});

describe("heist state machine", () => {
  function member(id: string): HeistCrewMember {
    return { userId: id, username: id, displayName: id };
  }

  function makeStarted(crewIds = ["a", "b", "c"]) {
    const state = createHeistState({
      guildId: "g",
      channelId: "c",
      host: member(crewIds[0]),
      buyin: 50,
      now: NOW,
    });
    for (const id of crewIds.slice(1)) state.crew.push(member(id));
    startHeist(
      state,
      NOW,
      () => ["sneak", "lock", "riddle"],
      () => {}, // identity shuffle
    );
    return state;
  }

  it("startHeist locks the lobby with a stage and point order", () => {
    const state = makeStarted();
    expect(state.phase).toBe("active");
    expect(state.stageOrder).toEqual(["sneak", "lock", "riddle"]);
    expect(state.pointOrder).toEqual(["a", "b", "c"]);
    expect(state.startedAt).toBe(NOW);
  });

  it("rotates point duty through the crew, wrapping for small crews", () => {
    const state = makeStarted(["a", "b"]);
    expect(pointForStage(state, 0)).toBe("a");
    expect(pointForStage(state, 1)).toBe("b");
    expect(pointForStage(state, 2)).toBe("a");
  });

  it("counts stage successes", () => {
    const state = makeStarted();
    state.stageResults.push(
      { kind: "sneak", pointId: "a", success: true, detail: "" },
      { kind: "lock", pointId: "b", success: false, detail: "" },
      { kind: "riddle", pointId: "c", success: true, detail: "" },
    );
    expect(successCount(state)).toBe(2);
  });
});
