/**
 * Pure math and constants for Heist the Hoard.
 * No I/O — everything here is unit-testable.
 *
 * Design invariants:
 * - The riddle stage is judged by local answer matching (this module),
 *   never by an LLM — nothing in the money path is promptable.
 * - Loot percentages apply to the CURRENT hoard, so a fat hoard makes
 *   heists worth running and a lean one doesn't: the hoard is
 *   self-balancing between the wolf's income (mugs, rakes, stakes)
 *   and successful raids.
 */

// ─── Crew & Lobby ─────────────────────────────────────────────────────

export const HEIST_MIN_CREW = 2;
export const HEIST_MAX_CREW = 6;
export const HEIST_MIN_BUYIN = 25;
export const HEIST_MAX_BUYIN = 200;
export const HEIST_DEFAULT_BUYIN = 50;
/** How long the crew lobby stays open. */
export const HEIST_LOBBY_LIFETIME_MS = 3 * 60 * 1000;
/** One heist per guild per this window (measured from the last END). */
export const HEIST_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** The hoard must hold at least this much to be worth robbing. */
export const HEIST_MIN_HOARD = 300;

// ─── Stages ───────────────────────────────────────────────────────────

export type HeistStageKind = "sneak" | "lock" | "riddle";

export const HEIST_STAGE_KINDS: HeistStageKind[] = ["sneak", "lock", "riddle"];

/** Lockpick: roll 0-100 must be ≥ this. */
export const LOCKPICK_THRESHOLD = 45;
/** Sneak: the GO signal fires after a random delay in this range... */
export const SNEAK_MIN_DELAY_MS = 2000;
export const SNEAK_MAX_DELAY_MS = 5000;
/** ...and the point player must click within this window after it. */
export const SNEAK_WINDOW_MS = 4000;
/** Riddle: total crew guesses allowed within the time limit. */
export const RIDDLE_TIME_MS = 60 * 1000;
export const RIDDLE_MAX_GUESSES = 5;
/** A stage with no action at all fails after this long. */
export const STAGE_IDLE_MS = 90 * 1000;

// ─── Outcomes ─────────────────────────────────────────────────────────

/** Clean job (3/3): fraction of the hoard stolen, stakes returned. */
export const HEIST_BIG_SCORE_PCT = 0.25;
/** Messy job (2/3): smaller fraction, stakes returned. */
export const HEIST_SMALL_SCORE_PCT = 0.1;
/** Total failure (0/3): the wolf mauls the crew (timeout sting). */
export const MAULED_TIMEOUT_MS = 60 * 1000;

export type HeistTier = "master" | "grab" | "bust" | "mauled";

export interface HeistOutcome {
  tier: HeistTier;
  /** Fraction of the current hoard the crew steals (0 for failures). */
  hoardPct: number;
  /** Whether the crew's stakes come back. */
  stakesReturned: boolean;
  /** Whether the wolf mauls the crew (timeouts). */
  mauled: boolean;
}

/**
 * Maps stage successes (0-3) to the heist outcome.
 */
export function computeHeistOutcome(successes: number): HeistOutcome {
  if (successes >= 3) {
    return {
      tier: "master",
      hoardPct: HEIST_BIG_SCORE_PCT,
      stakesReturned: true,
      mauled: false,
    };
  }
  if (successes === 2) {
    return {
      tier: "grab",
      hoardPct: HEIST_SMALL_SCORE_PCT,
      stakesReturned: true,
      mauled: false,
    };
  }
  if (successes === 1) {
    return { tier: "bust", hoardPct: 0, stakesReturned: false, mauled: false };
  }
  return { tier: "mauled", hoardPct: 0, stakesReturned: false, mauled: true };
}

/** Gold stolen from the hoard for a given outcome (floored, never > hoard). */
export function computeHeistLoot(hoardBalance: number, hoardPct: number) {
  if (hoardBalance <= 0 || hoardPct <= 0) return 0;
  return Math.min(hoardBalance, Math.floor(hoardBalance * hoardPct));
}

/**
 * Splits loot equally among the crew; the remainder goes to the first
 * member (the host by convention). Returns [] when there's nothing.
 */
export function splitHeistLoot(loot: number, crewCount: number): number[] {
  if (loot <= 0 || crewCount <= 0) return [];
  const base = Math.floor(loot / crewCount);
  const shares = Array.from({ length: crewCount }, () => base);
  shares[0] += loot - base * crewCount;
  return shares;
}

/**
 * Shuffled stage order for one heist. `rand` injectable for tests.
 */
export function rollStageOrder(
  rand: () => number = Math.random,
): HeistStageKind[] {
  const order = [...HEIST_STAGE_KINDS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ─── Riddle Matching (local, LLM-free) ────────────────────────────────

/**
 * Normalizes a guess: lowercase, strip punctuation, collapse spaces,
 * drop leading articles.
 */
export function normalizeRiddleGuess(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the|its|it is|itis) /, "")
    .trim();
}

/**
 * True when the guess matches any accepted answer after normalization.
 * A guess also matches when it contains an accepted answer as a whole
 * word ("it's your shadow!" matches "shadow").
 */
export function matchesRiddleAnswer(guess: string, answers: string[]) {
  const normalizedGuess = normalizeRiddleGuess(guess);
  if (!normalizedGuess) return false;
  return answers.some((answer: string) => {
    const normalizedAnswer = normalizeRiddleGuess(answer);
    if (!normalizedAnswer) return false;
    if (normalizedGuess === normalizedAnswer) return true;
    return new RegExp(
      `\\b${normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`,
    ).test(normalizedGuess);
  });
}

// ─── Sneak Timing ─────────────────────────────────────────────────────

export type SneakClickVerdict = "too_early" | "success" | "too_late";

/**
 * Judges a sneak-stage click against the GO-signal timestamp.
 */
export function judgeSneakClick(
  clickAtMs: number,
  goSignalAtMs: number,
  windowMs: number = SNEAK_WINDOW_MS,
): SneakClickVerdict {
  if (clickAtMs < goSignalAtMs) return "too_early";
  if (clickAtMs - goSignalAtMs <= windowMs) return "success";
  return "too_late";
}
