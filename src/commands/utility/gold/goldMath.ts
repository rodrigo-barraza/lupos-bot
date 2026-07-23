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

// ─── Activity Gold (silent passive earnings) ──────────────────────────
// Calibrated against real Whitemane archive stats (2026-07: ~72 chatters
// /day, median 6 msgs & 229 chars per chatter-day, p90 = 80 msgs): the
// median chatter earns ~20g/day, only the top ~10% hit the daily cap,
// and the server-wide mint stays comparable to the /gold daily faucet.

/** Base gold for a counted chat message. */
export const CHAT_GOLD_BASE = 2;
/** One bonus gold per this many characters of a counted message... */
export const CHAT_GOLD_CHARS_PER_BONUS = 40;
/** ...capped at this many bonus gold per message (so 2-5g per message). */
export const CHAT_GOLD_LENGTH_BONUS_CAP = 3;
/** Only one message per this window counts — spam earns nothing extra. */
export const CHAT_GOLD_COOLDOWN_MS = 60_000;
/** Cap on base chat gold per user per UTC day (bonuses tracked apart). */
export const CHAT_GOLD_DAILY_CAP = 60;
/** One-time bonus for the first counted message of the day. */
export const FIRST_HOWL_GOLD = 10;
/** Bonus when a counted message carries an attachment... */
export const CHAT_ATTACHMENT_BONUS_GOLD = 2;
/** ...paid at most this many times per day. */
export const CHAT_ATTACHMENT_BONUS_DAILY_CAP = 3;
/** Bonus when a counted message contains a link... */
export const CHAT_LINK_BONUS_GOLD = 1;
/** ...paid at most this many times per day. */
export const CHAT_LINK_BONUS_DAILY_CAP = 3;

/** Gold to a message author per unique reactor... */
export const REACTION_RECEIVED_GOLD = 1;
/** ...capped per author per UTC day. */
export const REACTION_RECEIVED_DAILY_CAP = 10;
/** One-time bonus when a message reaches the #highlights channel. */
export const HIGHLIGHT_BONUS_GOLD = 25;

/** Gold per minute spent in voice with at least VOICE_MIN_HUMANS... */
export const VOICE_GOLD_PER_MINUTE = 1;
/** ...capped per user per UTC day. */
export const VOICE_GOLD_DAILY_CAP = 30;
/** Humans (undeafened, non-AFK) required in a channel before it pays. */
export const VOICE_MIN_HUMANS = 2;

/** A lapsed streak survives if the user chatted on every skipped day,
 * for gaps up to this many days. */
export const STREAK_CHAT_RESCUE_MAX_DAYS = 30;

// ─── Formatting ───────────────────────────────────────────────────────

/** Formats an amount like "🪙 1,250g". */
export function formatGold(amount: number) {
  return `${GOLD_EMOJI} ${amount.toLocaleString("en-US")}g`;
}

/** UTC calendar day ("2026-07-22") — the boundary for all daily caps. */
export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

// ─── Activity Earn Math ───────────────────────────────────────────────

/** Prior same-day counters that gate a chat earn. */
export interface ChatEarnCounters {
  chatEarned: number;
  attachBonuses: number;
  linkBonuses: number;
  firstHowlPaid: boolean;
}

export interface ChatEarnBreakdown {
  base: number;
  attach: number;
  link: number;
  firstHowl: number;
  total: number;
}

/**
 * Gold for one counted chat message given the day's prior counters:
 * 2g base + 1g per 40 chars (capped +3), clamped to the daily base cap,
 * plus capped attachment/link bonuses and the first-howl bonus.
 */
export function computeChatEarn(
  counters: ChatEarnCounters,
  chars: number,
  hasAttachment: boolean,
  hasLink: boolean,
): ChatEarnBreakdown {
  const raw =
    CHAT_GOLD_BASE +
    Math.min(
      Math.floor(Math.max(0, chars) / CHAT_GOLD_CHARS_PER_BONUS),
      CHAT_GOLD_LENGTH_BONUS_CAP,
    );
  const base = Math.max(
    0,
    Math.min(raw, CHAT_GOLD_DAILY_CAP - counters.chatEarned),
  );
  const attach =
    hasAttachment && counters.attachBonuses < CHAT_ATTACHMENT_BONUS_DAILY_CAP
      ? CHAT_ATTACHMENT_BONUS_GOLD
      : 0;
  const link =
    hasLink && counters.linkBonuses < CHAT_LINK_BONUS_DAILY_CAP
      ? CHAT_LINK_BONUS_GOLD
      : 0;
  const firstHowl = counters.firstHowlPaid ? 0 : FIRST_HOWL_GOLD;
  return { base, attach, link, firstHowl, total: base + attach + link + firstHowl };
}

/**
 * The full UTC days skipped between a daily claim at `lastDailyAt` and a
 * claim attempt at `now`. Empty when no full day was skipped; null when
 * the gap exceeds STREAK_CHAT_RESCUE_MAX_DAYS (streak unrescuable).
 */
export function computeStreakGapDays(
  lastDailyAt: number,
  now: number,
): string[] | null {
  const dayMs = 86_400_000;
  const first = Math.floor(lastDailyAt / dayMs) + 1;
  const last = Math.floor(now / dayMs) - 1;
  if (last < first) return [];
  if (last - first + 1 > STREAK_CHAT_RESCUE_MAX_DAYS) return null;
  const days: string[] = [];
  for (let i = first; i <= last; i++) {
    days.push(new Date(i * dayMs).toISOString().slice(0, 10));
  }
  return days;
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
 * `keptAliveByChat` rescues a streak past the grace window when the
 * caller verified the user chatted on every skipped day.
 */
export function computeDailyClaim(
  lastDailyAt: number | undefined,
  currentStreak: number,
  now: number,
  keptAliveByChat: boolean = false,
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
    lastDailyAt !== undefined &&
    (now - lastDailyAt <= DAILY_STREAK_GRACE_MS || keptAliveByChat);
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
