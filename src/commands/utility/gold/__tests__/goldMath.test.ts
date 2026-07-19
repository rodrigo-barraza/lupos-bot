import { describe, it, expect } from "vitest";
import {
  DAILY_BASE_GOLD,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_BONUS,
  DAILY_STREAK_BONUS_CAP,
  DAILY_STREAK_GRACE_MS,
  HOUSE_RAKE,
  RANSOM_GOLD_PER_MINUTE,
  ROYALE_PRIZE_PER_OPPONENT,
  computeDailyClaim,
  MAX_SCATTER_PILES,
  computeRansomCost,
  computeRoyalePot,
  computeScatterPileCount,
  computeShockDropGold,
  computeShockMissDropGold,
  computeWagerPot,
  formatGold,
  splitGoldPiles,
} from "../goldMath.ts";

const NOW = 1_800_000_000_000;

describe("computeDailyClaim", () => {
  it("pays the base amount on a first-ever claim", () => {
    const claim = computeDailyClaim(undefined, 0, NOW);
    expect(claim.eligible).toBe(true);
    expect(claim.amount).toBe(DAILY_BASE_GOLD);
    expect(claim.streak).toBe(1);
    expect(claim.nextClaimAt).toBe(NOW + DAILY_COOLDOWN_MS);
  });

  it("blocks a claim inside the cooldown window", () => {
    const lastDailyAt = NOW - DAILY_COOLDOWN_MS + 60_000;
    const claim = computeDailyClaim(lastDailyAt, 3, NOW);
    expect(claim.eligible).toBe(false);
    expect(claim.amount).toBe(0);
    expect(claim.streak).toBe(3);
    expect(claim.nextClaimAt).toBe(lastDailyAt + DAILY_COOLDOWN_MS);
  });

  it("continues the streak when claiming within the grace window", () => {
    const lastDailyAt = NOW - DAILY_COOLDOWN_MS - 60_000;
    const claim = computeDailyClaim(lastDailyAt, 3, NOW);
    expect(claim.eligible).toBe(true);
    expect(claim.streak).toBe(4);
    expect(claim.amount).toBe(DAILY_BASE_GOLD + 3 * DAILY_STREAK_BONUS);
  });

  it("resets the streak after the grace window lapses", () => {
    const lastDailyAt = NOW - DAILY_STREAK_GRACE_MS - 1;
    const claim = computeDailyClaim(lastDailyAt, 9, NOW);
    expect(claim.eligible).toBe(true);
    expect(claim.streak).toBe(1);
    expect(claim.amount).toBe(DAILY_BASE_GOLD);
  });

  it("caps the streak bonus", () => {
    const lastDailyAt = NOW - DAILY_COOLDOWN_MS - 60_000;
    const claim = computeDailyClaim(lastDailyAt, 50, NOW);
    expect(claim.streak).toBe(51);
    expect(claim.amount).toBe(DAILY_BASE_GOLD + DAILY_STREAK_BONUS_CAP);
  });

  it("claiming exactly at the cooldown boundary is allowed", () => {
    const lastDailyAt = NOW - DAILY_COOLDOWN_MS;
    const claim = computeDailyClaim(lastDailyAt, 1, NOW);
    expect(claim.eligible).toBe(true);
    expect(claim.streak).toBe(2);
  });
});

describe("computeRoyalePot", () => {
  it("is house-bonus only for wager-free games", () => {
    expect(computeRoyalePot(0, 4)).toBe(3 * ROYALE_PRIZE_PER_OPPONENT);
  });

  it("rakes wagered pots instead of adding a house bonus", () => {
    expect(computeRoyalePot(100, 5)).toBe(500 * (1 - HOUSE_RAKE));
  });

  it("rounds a raked pot down (the house never pays fractions)", () => {
    // 3 × 25g = 75g pot → 67.5 after rake → 67
    expect(computeRoyalePot(25, 3)).toBe(67);
  });

  it("a 2-player royale still pays one opponent bonus", () => {
    expect(computeRoyalePot(0, 2)).toBe(ROYALE_PRIZE_PER_OPPONENT);
  });
});

describe("computeWagerPot", () => {
  it("pays a 1v1 pot minus the house rake", () => {
    expect(computeWagerPot(100, 2)).toBe(180);
  });

  it("rounds down so the house never pays fractions", () => {
    // 2 × 25g = 50g → 45 after rake
    expect(computeWagerPot(25, 2)).toBe(45);
    // 2 × 5g = 10g → 9
    expect(computeWagerPot(5, 2)).toBe(9);
  });
});

describe("computeRansomCost", () => {
  it("charges per remaining minute, rounded up", () => {
    expect(computeRansomCost(5 * 60_000)).toBe(5 * RANSOM_GOLD_PER_MINUTE);
    expect(computeRansomCost(4 * 60_000 + 1)).toBe(5 * RANSOM_GOLD_PER_MINUTE);
  });

  it("the final seconds still cost a full minute", () => {
    expect(computeRansomCost(1_000)).toBe(RANSOM_GOLD_PER_MINUTE);
    expect(computeRansomCost(0)).toBe(RANSOM_GOLD_PER_MINUTE);
  });
});

describe("computeShockDropGold", () => {
  it("scales with paralysis duration at 10g per second", () => {
    expect(computeShockDropGold(5, 10_000)).toBe(50);
    expect(computeShockDropGold(15, 10_000)).toBe(150);
  });

  it("never drops more than the shocker carries", () => {
    expect(computeShockDropGold(10, 35)).toBe(35);
  });

  it("drops nothing from an empty or missing pouch", () => {
    expect(computeShockDropGold(10, 0)).toBe(0);
    expect(computeShockDropGold(10, -5)).toBe(0);
  });
});

describe("computeShockMissDropGold", () => {
  it("scales with the would-be timeout at 3g per second", () => {
    expect(computeShockMissDropGold(10, 10_000)).toBe(30);
  });

  it("caps at the caster's balance", () => {
    expect(computeShockMissDropGold(10, 12)).toBe(12);
    expect(computeShockMissDropGold(10, 0)).toBe(0);
  });
});

describe("computeScatterPileCount", () => {
  it("adds a pile per 50g, starting from one", () => {
    expect(computeScatterPileCount(30, 10)).toBe(1);
    expect(computeScatterPileCount(50, 10)).toBe(2);
    expect(computeScatterPileCount(100, 10)).toBe(3);
    expect(computeScatterPileCount(150, 10)).toBe(4);
  });

  it("never exceeds the cap or the bystander pool", () => {
    expect(computeScatterPileCount(10_000, 10)).toBe(MAX_SCATTER_PILES);
    expect(computeScatterPileCount(150, 2)).toBe(2);
  });

  it("is zero with no gold or no bystanders", () => {
    expect(computeScatterPileCount(0, 5)).toBe(0);
    expect(computeScatterPileCount(100, 0)).toBe(0);
  });
});

describe("splitGoldPiles", () => {
  const fixedRand = () => 0.5;

  it("returns the whole amount as a single pile", () => {
    expect(splitGoldPiles(90, 1)).toEqual([90]);
  });

  it("always sums exactly to the amount with no zero piles", () => {
    for (let trial = 0; trial < 50; trial++) {
      const piles = splitGoldPiles(137, 4);
      expect(piles).toHaveLength(4);
      expect(piles.reduce((a, b) => a + b, 0)).toBe(137);
      for (const pile of piles) expect(pile).toBeGreaterThanOrEqual(1);
    }
  });

  it("sorts piles largest-first", () => {
    const piles = splitGoldPiles(140, 3);
    const sorted = [...piles].sort((a, b) => b - a);
    expect(piles).toEqual(sorted);
  });

  it("shrinks the pile count for tiny drops instead of dealing 0g piles", () => {
    const piles = splitGoldPiles(2, 3, fixedRand);
    expect(piles).toHaveLength(2);
    expect(piles).toEqual([1, 1]);
  });

  it("is deterministic with an injected rand", () => {
    expect(splitGoldPiles(100, 3, fixedRand)).toEqual(
      splitGoldPiles(100, 3, fixedRand),
    );
  });

  it("returns empty for nothing to split", () => {
    expect(splitGoldPiles(0, 3)).toEqual([]);
    expect(splitGoldPiles(50, 0)).toEqual([]);
  });
});

describe("formatGold", () => {
  it("formats with a thousands separator and the g suffix", () => {
    expect(formatGold(1250)).toBe("🪙 1,250g");
    expect(formatGold(0)).toBe("🪙 0g");
  });
});
