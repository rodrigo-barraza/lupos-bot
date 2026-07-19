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
  computeRansomCost,
  computeRoyalePot,
  computeWagerPot,
  formatGold,
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

describe("formatGold", () => {
  it("formats with a thousands separator and the g suffix", () => {
    expect(formatGold(1250)).toBe("🪙 1,250g");
    expect(formatGold(0)).toBe("🪙 0g");
  });
});
