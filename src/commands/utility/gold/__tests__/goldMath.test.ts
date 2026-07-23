import { describe, it, expect } from "vitest";
import {
  CHAT_ATTACHMENT_BONUS_DAILY_CAP,
  CHAT_ATTACHMENT_BONUS_GOLD,
  CHAT_GOLD_BASE,
  CHAT_GOLD_DAILY_CAP,
  CHAT_GOLD_LENGTH_BONUS_CAP,
  CHAT_LINK_BONUS_DAILY_CAP,
  CHAT_LINK_BONUS_GOLD,
  DAILY_BASE_GOLD,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_BONUS,
  DAILY_STREAK_BONUS_CAP,
  DAILY_STREAK_GRACE_MS,
  FIRST_HOWL_GOLD,
  HOUSE_RAKE,
  RANSOM_GOLD_PER_MINUTE,
  ROYALE_PRIZE_PER_OPPONENT,
  STREAK_CHAT_RESCUE_MAX_DAYS,
  computeChatEarn,
  computeDailyClaim,
  computeStreakGapDays,
  MAX_SCATTER_PILES,
  computeRansomCost,
  computeRoyalePot,
  computeScatterPileCount,
  computeShockDropGold,
  computeShockMissDropGold,
  computeWagerPot,
  formatGold,
  splitGoldPiles,
  utcDay,
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

describe("computeChatEarn", () => {
  const fresh = {
    chatEarned: 0,
    attachBonuses: 0,
    linkBonuses: 0,
    firstHowlPaid: true,
  };

  it("pays the base for a short message", () => {
    const earn = computeChatEarn(fresh, 10, false, false);
    expect(earn.base).toBe(CHAT_GOLD_BASE);
    expect(earn.total).toBe(CHAT_GOLD_BASE);
  });

  it("scales with length and caps the length bonus", () => {
    expect(computeChatEarn(fresh, 40, false, false).base).toBe(
      CHAT_GOLD_BASE + 1,
    );
    expect(computeChatEarn(fresh, 85, false, false).base).toBe(
      CHAT_GOLD_BASE + 2,
    );
    // A pasted novel still caps out
    expect(computeChatEarn(fresh, 100_000, false, false).base).toBe(
      CHAT_GOLD_BASE + CHAT_GOLD_LENGTH_BONUS_CAP,
    );
  });

  it("clamps the base to what's left under the daily cap", () => {
    const nearCap = { ...fresh, chatEarned: CHAT_GOLD_DAILY_CAP - 1 };
    expect(computeChatEarn(nearCap, 200, false, false).base).toBe(1);
    const atCap = { ...fresh, chatEarned: CHAT_GOLD_DAILY_CAP };
    expect(computeChatEarn(atCap, 200, false, false).base).toBe(0);
  });

  it("pays attachment and link bonuses under their own caps", () => {
    const earn = computeChatEarn(fresh, 10, true, true);
    expect(earn.attach).toBe(CHAT_ATTACHMENT_BONUS_GOLD);
    expect(earn.link).toBe(CHAT_LINK_BONUS_GOLD);
    const spent = {
      ...fresh,
      attachBonuses: CHAT_ATTACHMENT_BONUS_DAILY_CAP,
      linkBonuses: CHAT_LINK_BONUS_DAILY_CAP,
    };
    const capped = computeChatEarn(spent, 10, true, true);
    expect(capped.attach).toBe(0);
    expect(capped.link).toBe(0);
  });

  it("still pays bonuses when the base cap is spent", () => {
    const atCap = { ...fresh, chatEarned: CHAT_GOLD_DAILY_CAP };
    const earn = computeChatEarn(atCap, 10, true, false);
    expect(earn.total).toBe(CHAT_ATTACHMENT_BONUS_GOLD);
  });

  it("pays the first howl exactly once", () => {
    const first = computeChatEarn(
      { ...fresh, firstHowlPaid: false },
      10,
      false,
      false,
    );
    expect(first.firstHowl).toBe(FIRST_HOWL_GOLD);
    expect(first.total).toBe(CHAT_GOLD_BASE + FIRST_HOWL_GOLD);
    expect(computeChatEarn(fresh, 10, false, false).firstHowl).toBe(0);
  });
});

describe("computeStreakGapDays", () => {
  const DAY = 86_400_000;
  // Noon UTC on an arbitrary day
  const NOON = Math.floor(NOW / DAY) * DAY + DAY / 2;

  it("returns empty when no full day was skipped", () => {
    expect(computeStreakGapDays(NOON - DAY, NOON)).toEqual([]);
  });

  it("lists the full skipped days", () => {
    const days = computeStreakGapDays(NOON - 3 * DAY, NOON);
    expect(days).toHaveLength(2);
    expect(days![0]).toBe(utcDay(NOON - 2 * DAY));
    expect(days![1]).toBe(utcDay(NOON - DAY));
  });

  it("returns null for an unrescuably long gap", () => {
    expect(
      computeStreakGapDays(NOON - (STREAK_CHAT_RESCUE_MAX_DAYS + 2) * DAY, NOON),
    ).toBeNull();
  });
});

describe("computeDailyClaim chat rescue", () => {
  it("keeps the streak past the grace window when kept alive by chat", () => {
    const lastDailyAt = NOW - DAILY_STREAK_GRACE_MS - 5 * 86_400_000;
    const claim = computeDailyClaim(lastDailyAt, 6, NOW, true);
    expect(claim.eligible).toBe(true);
    expect(claim.streak).toBe(7);
    expect(claim.amount).toBe(DAILY_BASE_GOLD + 6 * DAILY_STREAK_BONUS);
  });

  it("still resets without the rescue flag", () => {
    const lastDailyAt = NOW - DAILY_STREAK_GRACE_MS - 5 * 86_400_000;
    const claim = computeDailyClaim(lastDailyAt, 6, NOW, false);
    expect(claim.streak).toBe(1);
  });

  it("never rescues a first-ever claim", () => {
    const claim = computeDailyClaim(undefined, 0, NOW, true);
    expect(claim.streak).toBe(1);
  });
});

describe("utcDay", () => {
  it("formats the UTC calendar day", () => {
    expect(utcDay(0)).toBe("1970-01-01");
    expect(utcDay(86_400_000 - 1)).toBe("1970-01-01");
    expect(utcDay(86_400_000)).toBe("1970-01-02");
  });
});
