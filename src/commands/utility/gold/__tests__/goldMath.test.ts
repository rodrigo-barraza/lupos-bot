import { describe, it, expect } from "vitest";
import {
  CHAT_ATTACHMENT_BONUS_DAILY_CAP,
  CHAT_ATTACHMENT_BONUS_GOLD,
  CHAT_GOLD_BASE,
  CHAT_GOLD_CHARS_PER_BONUS,
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
  GOLD_PER_EXTRA_PILE,
  HOUSE_RAKE,
  RANSOM_GOLD_PER_MINUTE,
  ROYALE_PRIZE_PER_OPPONENT,
  BEATUP_VICTIM_DROP_GOLD,
  DEATHROLL_WIN_GOLD,
  GUESSWHO_CORRECT_GOLD,
  HIGHLIGHT_BONUS_GOLD,
  REACTION_RECEIVED_DAILY_CAP,
  REACTION_RECEIVED_GOLD,
  SHOCK_CRIT_BONUS_GOLD,
  SHOCK_CRIT_CONSOLATION_GOLD,
  VOICE_GOLD_DAILY_CAP,
  VOICE_GOLD_PER_MINUTE,
  SHOCK_DROP_GOLD_PER_SECOND,
  SHOCK_MISS_DROP_GOLD_PER_SECOND,
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
  it("scales with paralysis duration at the per-second rate", () => {
    expect(computeShockDropGold(5, 10_000)).toBe(
      5 * SHOCK_DROP_GOLD_PER_SECOND,
    );
    expect(computeShockDropGold(15, 10_000)).toBe(
      15 * SHOCK_DROP_GOLD_PER_SECOND,
    );
  });

  it("never drops more than the shocker carries", () => {
    const broke = SHOCK_DROP_GOLD_PER_SECOND * 10 - 1;
    expect(computeShockDropGold(10, broke)).toBe(broke);
  });

  it("drops nothing from an empty or missing pouch", () => {
    expect(computeShockDropGold(10, 0)).toBe(0);
    expect(computeShockDropGold(10, -5)).toBe(0);
  });
});

describe("computeShockMissDropGold", () => {
  it("scales with the would-be timeout at the per-second rate", () => {
    expect(computeShockMissDropGold(10, 10_000)).toBe(
      10 * SHOCK_MISS_DROP_GOLD_PER_SECOND,
    );
  });

  it("caps at the caster's balance", () => {
    const broke = SHOCK_MISS_DROP_GOLD_PER_SECOND * 10 - 1;
    expect(computeShockMissDropGold(10, broke)).toBe(broke);
    expect(computeShockMissDropGold(10, 0)).toBe(0);
  });
});

describe("computeScatterPileCount", () => {
  it("adds a pile per GOLD_PER_EXTRA_PILE, starting from one", () => {
    const per = GOLD_PER_EXTRA_PILE;
    expect(computeScatterPileCount(per - 1, 10)).toBe(1);
    expect(computeScatterPileCount(per, 10)).toBe(2);
    expect(computeScatterPileCount(per * 2, 10)).toBe(3);
    expect(computeScatterPileCount(per * 3, 10)).toBe(4);
  });

  it("never exceeds the cap or the bystander pool", () => {
    expect(computeScatterPileCount(10_000, 10)).toBe(MAX_SCATTER_PILES);
    expect(computeScatterPileCount(GOLD_PER_EXTRA_PILE * 3, 2)).toBe(2);
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

  it("scales with length, bounded by the length and daily caps", () => {
    const per = CHAT_GOLD_CHARS_PER_BONUS;
    // The gradient is real but the daily cap clips it: the cap is small
    // enough to bind on a chatter's first message, so every expectation
    // here is a min() against what's left for the day.
    const capped = (raw: number) => Math.min(raw, CHAT_GOLD_DAILY_CAP);

    expect(computeChatEarn(fresh, per - 1, false, false).base).toBe(
      capped(CHAT_GOLD_BASE),
    );
    expect(computeChatEarn(fresh, per, false, false).base).toBe(
      capped(CHAT_GOLD_BASE + 1),
    );
    expect(computeChatEarn(fresh, per * 2 + 5, false, false).base).toBe(
      capped(CHAT_GOLD_BASE + 2),
    );
    // A pasted novel is worth no more than the length cap allows
    expect(computeChatEarn(fresh, 100_000, false, false).base).toBe(
      capped(CHAT_GOLD_BASE + CHAT_GOLD_LENGTH_BONUS_CAP),
    );
  });

  it("keeps a length gradient underneath the daily cap", () => {
    // Guards the ordering itself, which the cap would otherwise hide: a
    // longer message is never worth less than a shorter one.
    const per = CHAT_GOLD_CHARS_PER_BONUS;
    const lengths = [0, per - 1, per, per * 2, per * 3, 100_000];
    const bases = lengths.map((n) => computeChatEarn(fresh, n, false, false).base);
    for (let i = 1; i < bases.length; i++) {
      expect(bases[i]).toBeGreaterThanOrEqual(bases[i - 1]);
    }
    expect(Math.max(...bases)).toBeLessThanOrEqual(CHAT_GOLD_DAILY_CAP);
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

describe("gold is always whole", () => {
  // Gold is displayed and stored as a plain integer count of coins, and
  // Mongo's $inc will happily persist 0.30000000000000004 forever. Nothing
  // that produces an amount may emit a fraction — so every constant and
  // every payout function is checked here rather than trusted.
  const isWhole = (n: number) => Number.isInteger(n);

  it("every gold constant is a whole number", () => {
    const amounts: Record<string, number> = {
      DAILY_BASE_GOLD,
      DAILY_STREAK_BONUS,
      DAILY_STREAK_BONUS_CAP,
      DEATHROLL_WIN_GOLD,
      GUESSWHO_CORRECT_GOLD,
      ROYALE_PRIZE_PER_OPPONENT,
      RANSOM_GOLD_PER_MINUTE,
      SHOCK_DROP_GOLD_PER_SECOND,
      SHOCK_MISS_DROP_GOLD_PER_SECOND,
      SHOCK_CRIT_BONUS_GOLD,
      SHOCK_CRIT_CONSOLATION_GOLD,
      BEATUP_VICTIM_DROP_GOLD,
      GOLD_PER_EXTRA_PILE,
      CHAT_GOLD_BASE,
      CHAT_GOLD_LENGTH_BONUS_CAP,
      CHAT_GOLD_DAILY_CAP,
      FIRST_HOWL_GOLD,
      CHAT_ATTACHMENT_BONUS_GOLD,
      CHAT_LINK_BONUS_GOLD,
      REACTION_RECEIVED_GOLD,
      REACTION_RECEIVED_DAILY_CAP,
      HIGHLIGHT_BONUS_GOLD,
      VOICE_GOLD_PER_MINUTE,
      VOICE_GOLD_DAILY_CAP,
    };
    for (const [name, value] of Object.entries(amounts)) {
      expect(`${name}=${value}`).toBe(`${name}=${Math.trunc(value)}`);
    }
  });

  it("no payout function returns a fraction, at any input", () => {
    // HOUSE_RAKE (0.1) and the MMR multiplier are the fraction sources, so
    // the pot and wager sweeps below are the ones that actually matter.
    for (let wager = 0; wager <= 200; wager++) {
      for (let players = 2; players <= 8; players++) {
        expect(isWhole(computeWagerPot(wager, players))).toBe(true);
        expect(isWhole(computeRoyalePot(wager, players))).toBe(true);
      }
    }
    for (let ms = 0; ms <= 600_000; ms += 997) {
      expect(isWhole(computeRansomCost(ms))).toBe(true);
    }
    for (let secs = 0; secs <= 120; secs += 0.5) {
      expect(isWhole(computeShockDropGold(secs, 10_000))).toBe(true);
      expect(isWhole(computeShockMissDropGold(secs, 10_000))).toBe(true);
    }
    for (let chars = 0; chars <= 500; chars++) {
      const earn = computeChatEarn(
        { chatEarned: 0, attachBonuses: 0, linkBonuses: 0, firstHowlPaid: false },
        chars,
        true,
        true,
      );
      expect(isWhole(earn.total)).toBe(true);
      expect(earn.total).toBe(earn.base + earn.attach + earn.link + earn.firstHowl);
    }
    for (let streak = 0; streak <= 40; streak++) {
      expect(isWhole(computeDailyClaim(undefined, streak, NOW).amount)).toBe(
        true,
      );
    }
  });

  it("splits a scattered drop into whole piles that sum exactly", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let amount = 1; amount <= 400; amount++) {
      const piles = splitGoldPiles(amount, MAX_SCATTER_PILES, rand);
      for (const pile of piles) {
        expect(isWhole(pile)).toBe(true);
        expect(pile).toBeGreaterThan(0);
      }
      expect(piles.reduce((sum, p) => sum + p, 0)).toBe(amount);
    }
  });
});
