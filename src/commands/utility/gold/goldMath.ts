/**
 * Pure computation helpers and constants for the gold economy.
 * No I/O — everything here is unit-testable.
 */

// ─── Constants ────────────────────────────────────────────────────────

export const GOLD_EMOJI = "🪙";
export const GOLD_COLOR = 0xf1c40f;

/** Base payout for /gold daily. */
export const DAILY_BASE_GOLD = 100;
/** Extra gold per consecutive daily-claim day beyond the first. */
export const DAILY_STREAK_BONUS = 10;
/** Cap on the total streak bonus (reached at an 11-day streak). */
export const DAILY_STREAK_BONUS_CAP = 100;
/** How long after a claim before the next one unlocks (20h, so a "daily"
 * habit doesn't slowly drift later every day). */
export const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;
/** Claiming within this window of the previous claim keeps the streak. */
export const DAILY_STREAK_GRACE_MS = 48 * 60 * 60 * 1000;

/** Base gold for winning a 1v1 deathroll (scaled by the MMR multiplier). */
export const DEATHROLL_WIN_GOLD = 50;
/** Gold for a correct /guesswho guess. */
export const GUESSWHO_CORRECT_GOLD = 25;
/** House-funded prize per defeated opponent in a wager-free royale. */
export const ROYALE_PRIZE_PER_OPPONENT = 25;
/** Fraction of any wagered pot the house burns (gold sink). */
export const HOUSE_RAKE = 0.1;
/** Cost per remaining minute to ransom someone out of a game timeout. */
export const RANSOM_GOLD_PER_MINUTE = 25;

/** Gold dropped per second of self-shock paralysis (backfire punishment). */
export const SHOCK_DROP_GOLD_PER_SECOND = 10;
/** Gold dropped per second of the timeout a missed shock would have dealt. */
export const SHOCK_MISS_DROP_GOLD_PER_SECOND = 3;
/** House bounty for landing a critical shock on someone else. */
export const SHOCK_CRIT_BONUS_GOLD = 25;
/** Insurance payout to the victim of a critical shock. */
export const SHOCK_CRIT_CONSOLATION_GOLD = 15;
/** Most gold a beatup victim drops for the mob to loot. */
export const BEATUP_VICTIM_DROP_GOLD = 60;

/** Scattered drops split into one extra pile per this much gold... */
export const GOLD_PER_EXTRA_PILE = 50;
/** ...capped at this many piles. */
export const MAX_SCATTER_PILES = 4;

// ─── Formatting ───────────────────────────────────────────────────────

/** Formats an amount like "🪙 1,250g". */
export function formatGold(amount: number) {
  return `${GOLD_EMOJI} ${amount.toLocaleString("en-US")}g`;
}

// ─── Daily Claim ──────────────────────────────────────────────────────

export interface DailyClaimComputation {
  eligible: boolean;
  /** When the next claim unlocks (from `now` if claiming, else from the last claim). */
  nextClaimAt: number;
  /** The streak this claim would set (unchanged when not eligible). */
  streak: number;
  /** Gold paid out by this claim (0 when not eligible). */
  amount: number;
}

/**
 * Computes the outcome of a daily claim attempt: whether it's allowed,
 * the resulting streak, and the payout including the streak bonus.
 */
export function computeDailyClaim(
  lastDailyAt: number | undefined,
  currentStreak: number,
  now: number,
): DailyClaimComputation {
  if (lastDailyAt && now - lastDailyAt < DAILY_COOLDOWN_MS) {
    return {
      eligible: false,
      nextClaimAt: lastDailyAt + DAILY_COOLDOWN_MS,
      streak: currentStreak,
      amount: 0,
    };
  }

  const keepsStreak =
    lastDailyAt !== undefined && now - lastDailyAt <= DAILY_STREAK_GRACE_MS;
  const streak = keepsStreak ? currentStreak + 1 : 1;
  const bonus = Math.min(
    (streak - 1) * DAILY_STREAK_BONUS,
    DAILY_STREAK_BONUS_CAP,
  );
  return {
    eligible: true,
    nextClaimAt: now + DAILY_COOLDOWN_MS,
    streak,
    amount: DAILY_BASE_GOLD + bonus,
  };
}

// ─── Prize Math ───────────────────────────────────────────────────────

/**
 * Winner's payout on a wagered pot: everyone's stake minus the house
 * rake, rounded down (the house never pays fractions). Used by both
 * 1v1 deathroll wagers (playerCount 2) and wagered royales.
 */
export function computeWagerPot(wager: number, playerCount: number) {
  return Math.floor(wager * playerCount * (1 - HOUSE_RAKE));
}

/**
 * Total royale pot paid to the winner.
 * Wagered games: the collected wagers minus the house rake (a gold sink).
 * Free games: a house-funded prize per defeated opponent, so there's
 * still something to win.
 */
export function computeRoyalePot(wager: number, playerCount: number) {
  if (wager > 0) {
    return computeWagerPot(wager, playerCount);
  }
  return ROYALE_PRIZE_PER_OPPONENT * (playerCount - 1);
}

/**
 * Ransom price to lift a game timeout: per-minute rate on the remaining
 * time, rounded up so even the last seconds cost a full minute.
 */
export function computeRansomCost(remainingMs: number) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return minutes * RANSOM_GOLD_PER_MINUTE;
}

/**
 * Gold a self-shocker drops: scales with how long they paralyzed
 * themselves, capped at what they actually carry (never negative).
 */
export function computeShockDropGold(timeoutSeconds: number, balance: number) {
  const drop = Math.round(timeoutSeconds * SHOCK_DROP_GOLD_PER_SECOND);
  return Math.max(0, Math.min(balance, drop));
}

/**
 * Fumble tax for a missed shock: scales with the timeout the move would
 * have dealt, capped at the caster's balance.
 */
export function computeShockMissDropGold(
  timeoutSeconds: number,
  balance: number,
) {
  const drop = Math.round(timeoutSeconds * SHOCK_MISS_DROP_GOLD_PER_SECOND);
  return Math.max(0, Math.min(balance, drop));
}

// ─── Scatter Math ─────────────────────────────────────────────────────

/**
 * How many piles a scattered drop splits into: one, plus one per
 * GOLD_PER_EXTRA_PILE, capped by the bystander pool and MAX_SCATTER_PILES.
 */
export function computeScatterPileCount(amount: number, poolSize: number) {
  if (amount <= 0 || poolSize <= 0) return 0;
  return Math.min(
    poolSize,
    1 + Math.floor(amount / GOLD_PER_EXTRA_PILE),
    MAX_SCATTER_PILES,
  );
}

/**
 * Splits an amount into `count` uneven piles that always sum exactly to
 * `amount`, each at least 1, sorted largest-first (loot-style — someone
 * always gets the big pile). `rand` is injectable for deterministic tests.
 */
export function splitGoldPiles(
  amount: number,
  count: number,
  rand: () => number = Math.random,
) {
  if (amount <= 0 || count <= 0) return [];
  // A tiny drop can't fill every pile — fewer piles, never a 0g pile.
  count = Math.min(count, amount);
  if (count === 1) return [amount];

  // Reserve 1 per pile, share the rest by random weight, then hand the
  // rounding remainder out one coin at a time.
  const weights = Array.from({ length: count }, () => rand() + 0.25);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const base = amount - count;
  const piles = weights.map((w) => 1 + Math.floor((base * w) / totalWeight));
  let remainder = amount - piles.reduce((sum, p) => sum + p, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % count) {
    piles[i]++;
    remainder--;
  }
  return piles.sort((a, b) => b - a);
}
