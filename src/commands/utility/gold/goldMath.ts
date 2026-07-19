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
