/**
 * Pure computation helpers and constants for the gold economy.
 * No I/O — everything here is unit-testable.
 */

// ─── Constants ────────────────────────────────────────────────────────

export const GOLD_EMOJI = "🪙";
export const GOLD_COLOR = 0xf1c40f;

// Every amount here is one tenth of the values gold first shipped with.
// That first run went 24 days barely noticed and still minted ~2,000g/day
// server-wide — 50,000g total — almost all of it passive chat gold, against
// zero sinks anywhere in the ledger. On 2026-08-12 the wallets were dropped
// and the economy restarted from empty at these amounts. Percentage figures
// (HOUSE_RAKE, the heist loot cuts) are scale-free and unchanged.

/** Base payout for /gold daily. */
export const DAILY_BASE_GOLD = 10;
/** Extra gold per consecutive daily-claim day beyond the first. */
export const DAILY_STREAK_BONUS = 1;
/** Cap on the total streak bonus (reached at an 11-day streak). */
export const DAILY_STREAK_BONUS_CAP = 10;
/** How long after a claim before the next one unlocks (20h, so a "daily"
 * habit doesn't slowly drift later every day). */
export const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;
/** Claiming within this window of the previous claim keeps the streak. */
export const DAILY_STREAK_GRACE_MS = 48 * 60 * 60 * 1000;

/** Base gold for winning a 1v1 deathroll (scaled by the MMR multiplier). */
export const DEATHROLL_WIN_GOLD = 5;
/** Gold for a correct /guesswho guess. */
export const GUESSWHO_CORRECT_GOLD = 3;
/** House-funded prize per defeated opponent in a wager-free royale. */
export const ROYALE_PRIZE_PER_OPPONENT = 3;
/** Fraction of any wagered pot the house burns (gold sink). */
export const HOUSE_RAKE = 0.1;
/** Cost per remaining minute to ransom someone out of a game timeout. */
export const RANSOM_GOLD_PER_MINUTE = 3;

/** Gold dropped per second of self-shock paralysis (backfire punishment). */
export const SHOCK_DROP_GOLD_PER_SECOND = 1;
/** Gold dropped per second of the timeout a missed shock would have dealt.
 * Can't go below 1g/s without fractional gold, so this is the one amount
 * the ÷10 left proportionally heavier than it used to be. */
export const SHOCK_MISS_DROP_GOLD_PER_SECOND = 1;
/** House bounty for landing a critical shock on someone else. */
export const SHOCK_CRIT_BONUS_GOLD = 3;
/** Insurance payout to the victim of a critical shock. */
export const SHOCK_CRIT_CONSOLATION_GOLD = 2;
/** Most gold a beatup victim drops for the mob to loot. */
export const BEATUP_VICTIM_DROP_GOLD = 6;

/** Scattered drops split into one extra pile per this much gold... */
export const GOLD_PER_EXTRA_PILE = 5;
/** ...capped at this many piles. */
export const MAX_SCATTER_PILES = 4;

// ─── Activity Gold (silent passive earnings) ──────────────────────────
// Originally calibrated (2026-07) against real Whitemane archive stats
// (~72 chatters/day, median 6 msgs & 229 chars per chatter-day, p90 = 80
// msgs) for a ~20g/day median chatter. Far too generous in practice: this
// is where 85% of that first 50,000g came from.
//
// Gold is an integer and a 2g message can't pay 0.2g, so the per-message
// amounts bottom out at 1 — only a 2x cut where a 10x was wanted. The daily
// cap absorbs the difference. Replaying the real 24-day message stream
// through these numbers mints 4,762g rather than 50,123g, about 190g/day
// server-wide instead of 2,020g.
//
// The cost is that CHAT_GOLD_DAILY_CAP binds on a chatter's first message
// or two, so the length gradient below rarely gets to matter. That was the
// accepted trade for landing near a tenth; if it ever wants softening,
// raise the cap and nothing else — every 1g here is already at the floor.

/** Base gold for a counted chat message. */
export const CHAT_GOLD_BASE = 1;
/** One bonus gold per this many characters of a counted message... */
export const CHAT_GOLD_CHARS_PER_BONUS = 80;
/** ...capped at this many bonus gold per message (so 1-3g per message,
 * before the daily cap below claws most of it back). */
export const CHAT_GOLD_LENGTH_BONUS_CAP = 2;
/** Only one message per this window counts — spam earns nothing extra. */
export const CHAT_GOLD_COOLDOWN_MS = 600_000;
/** Cap on base chat gold per user per UTC day (bonuses tracked apart). */
export const CHAT_GOLD_DAILY_CAP = 2;
/** One-time bonus for the first counted message of the day. */
export const FIRST_HOWL_GOLD = 1;
/** Bonus when a counted message carries an attachment... */
export const CHAT_ATTACHMENT_BONUS_GOLD = 1;
/** ...paid at most this many times per day. */
export const CHAT_ATTACHMENT_BONUS_DAILY_CAP = 1;
/** Bonus when a counted message contains a link... */
export const CHAT_LINK_BONUS_GOLD = 1;
/** ...paid at most this many times per day. */
export const CHAT_LINK_BONUS_DAILY_CAP = 1;

/** Gold to a message author per unique reactor... */
export const REACTION_RECEIVED_GOLD = 1;
/** ...capped per author per UTC day. */
export const REACTION_RECEIVED_DAILY_CAP = 1;
/** One-time bonus when a message reaches the #highlights channel. */
export const HIGHLIGHT_BONUS_GOLD = 3;

/** Gold per minute spent in voice with at least VOICE_MIN_HUMANS... */
export const VOICE_GOLD_PER_MINUTE = 1;
/** ...capped per user per UTC day. */
export const VOICE_GOLD_DAILY_CAP = 3;
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
 * 1g base + 1g per 80 chars (capped +2), clamped to the daily base cap,
 * plus capped attachment/link bonuses and the first-howl bonus.
 * Every term is a whole number of gold — nothing here can emit a fraction.
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
