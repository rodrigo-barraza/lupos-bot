/**
 * Pure MMR/rank computation helpers and constants for deathroll.
 * No I/O — everything here is unit-testable.
 */

import config from "#root/config.js";
import { MILLISECONDS_PER_DAY } from "#root/constants.js";
import type { AggregatedStats, PlayerProfile, UserStats } from "./types.ts";

// ─── Constants ────────────────────────────────────────────────────────

export const RANK_TIERS = [
  { min: 1325, title: "Eternus", emoji: "👁️" },
  { min: 1275, title: "Ascendant", emoji: "🌟" },
  { min: 1225, title: "Phantom", emoji: "👻" },
  { min: 1175, title: "Oracle", emoji: "🔮" },
  { min: 1125, title: "Archon", emoji: "⚜️" },
  { min: 1075, title: "Emissary", emoji: "🏛️" },
  { min: 1025, title: "Ritualist", emoji: "🕯️" },
  { min: 975, title: "Arcanist", emoji: "✨" },
  { min: 925, title: "Alchemist", emoji: "⚗️" },
  { min: 875, title: "Seeker", emoji: "🔍" },
  { min: -Infinity, title: "Initiate", emoji: "🌱" },
];

export const BASE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const BASE_TIMEOUT_MINUTES = BASE_TIMEOUT / 60000;

// Glicko-2 inspired MMR constants
export const BASE_MMR = 1000;
export const MIN_MMR = 1;
export const MAX_RD = 200; // Rating Deviation: max uncertainty (new/returning players)
export const MIN_RD = 30; // Rating Deviation: min uncertainty (veterans)
export const BASE_K = 47; // Base K-factor for MMR changes
export const RD_DECAY_PER_DAY = 1; // RD increases by this per day inactive
export const RD_DECREASE_PER_GAME = 5; // RD decreases by this per game played
export const GRAVITY_STRENGTH = 0.7; // How strongly MMR is pulled toward GRAVITY_CENTER
export const GRAVITY_RANGE = 425; // MMR distance at which gravity reaches full effect
export const GRAVITY_CENTER = 1050; // Center of gravity pull (above BASE_MMR to offset floor asymmetry)
export const PLACEMENT_GAMES = 5; // Number of games before real rank is revealed (shows Unranked during placement)
export const UNRANKED_DISPLAY = { title: "Unranked", emoji: "❔" }; // Display for placement players

export const MULTIPLIER_NAMES = {
  2: "Double (2x)",
  4: "Quadruple (4x)",
  8: "Octuple (8x)",
  16: "Sexdecuple (16x)",
  32: "Duotrigintuple (32x)",
  64: "Sexagintiquadruple (64x)",
  128: "Centumduoduodecimal (128x)",
  256: "Ducentiquinquagintaseptimal (256x)",
  512: "Quinquagintaducentiseptimal (512x)",
  1024: "Milliduoquattuorsexagesimal (1024x)",
};

export function getMultiplierName(multiplier: number) {
  return (
    MULTIPLIER_NAMES[multiplier as keyof typeof MULTIPLIER_NAMES] ||
    `${multiplier}x`
  );
}

// ─── Pure Computation Helpers ─────────────────────────────────────────

/**
 * Glicko-2 inspired K-factor: scales with Rating Deviation.
 * High RD (uncertain) = larger swings (up to 50).
 * Low RD (confident) = stable swings (25).
 */
export function calculateKFactor(rd: number) {
  const clampedRD = Math.max(MIN_RD, Math.min(MAX_RD, rd));
  return BASE_K + (BASE_K * (clampedRD - MIN_RD)) / (MAX_RD - MIN_RD);
}

/**
 * Gravity gain scale: players above GRAVITY_CENTER gain less, below gain more.
 * Creates a "rubber band" pulling everyone toward GRAVITY_CENTER.
 * Center is set above BASE_MMR to offset the MMR floor asymmetry.
 * At GRAVITY_CENTER: returns 1.0 (no effect).
 * Above: returns < 1.0 (reduced gains).
 * Below: returns > 1.0 (boosted gains).
 */
export function gravityGainScale(mmr: number) {
  return Math.max(
    0.15,
    1 - ((mmr - GRAVITY_CENTER) / GRAVITY_RANGE) * GRAVITY_STRENGTH,
  );
}

/**
 * Gravity loss scale: players above GRAVITY_CENTER lose more, below lose less.
 * Mirror of gravityGainScale for losses.
 */
export function gravityLossScale(mmr: number) {
  return Math.max(
    0.15,
    1 + ((mmr - GRAVITY_CENTER) / GRAVITY_RANGE) * GRAVITY_STRENGTH,
  );
}

/**
 * Compresses the game timeout multiplier for MMR purposes.
 * Each Double or Nothing adds +0.25 to the MMR effect instead of doubling.
 * 1x→1, 2x→1.25, 4x→1.5, 16x→2, 1024x→3.5
 */
export function mmrMultiplier(timeoutMultiplier: number) {
  if (timeoutMultiplier <= 1) return 1;
  return Math.log2(timeoutMultiplier) * 0.25 + 1;
}

/**
 * Rank Confidence: 0% (totally uncertain) to 100% (fully confident).
 * Derived from Rating Deviation.
 */
export function calculateConfidence(rd: number) {
  const clampedRD = Math.max(MIN_RD, Math.min(MAX_RD, rd));
  return Math.round((1 - (clampedRD - MIN_RD) / (MAX_RD - MIN_RD)) * 100);
}

/**
 * Time-decay for Rating Deviation: RD grows by RD_DECAY_PER_DAY for each
 * day of inactivity, capped at MAX_RD. Returning players become volatile.
 */
export function applyTimeDecayRD(rd: number, lastPlayedAt: number | undefined) {
  if (!lastPlayedAt) return MAX_RD;
  const daysSince = (Date.now() - lastPlayedAt) / MILLISECONDS_PER_DAY;
  return Math.min(MAX_RD, rd + daysSince * RD_DECAY_PER_DAY);
}

/**
 * Returns the current-season MMR/RD for a player from their UserStats doc.
 * If mmrSeason doesn't match the current season, returns defaults.
 */
export function getSeasonMMR(userStats: Partial<UserStats> | null) {
  if (!userStats || userStats.mmrSeason !== config.DEATHROLL_SEASON) {
    return { mmr: BASE_MMR, rd: MAX_RD };
  }
  return {
    mmr: userStats.mmr ?? BASE_MMR,
    rd: userStats.rd ?? MAX_RD,
  };
}

/**
 * Post-game stat deltas for the winner of a game.
 * Reads the player's current (possibly null) stats doc and computes the
 * new MMR, RD, and streak values. Pure aside from Date.now-based RD decay.
 */
export function computeWinStatsUpdate(
  currentStats: Partial<UserStats> | null,
  timeoutMultiplier: number,
) {
  const season = getSeasonMMR(currentStats);
  const rd = applyTimeDecayRD(season.rd, currentStats?.lastPlayedAt);
  const k = calculateKFactor(rd);
  const mult = mmrMultiplier(timeoutMultiplier);
  const currentStreak = Math.max(0, currentStats?.currentStreak || 0) + 1;
  return {
    mmr: Math.round(season.mmr + k * mult * gravityGainScale(season.mmr)),
    rd: Math.max(MIN_RD, rd - RD_DECREASE_PER_GAME),
    currentStreak,
    bestStreak: Math.max(currentStreak, currentStats?.bestStreak || 0),
  };
}

/**
 * Post-game stat deltas for the loser of a game (MMR floored at MIN_MMR).
 */
export function computeLossStatsUpdate(
  currentStats: Partial<UserStats> | null,
  timeoutMultiplier: number,
) {
  const season = getSeasonMMR(currentStats);
  const rd = applyTimeDecayRD(season.rd, currentStats?.lastPlayedAt);
  const k = calculateKFactor(rd);
  const mult = mmrMultiplier(timeoutMultiplier);
  return {
    mmr: Math.max(
      MIN_MMR,
      Math.round(season.mmr - k * mult * gravityLossScale(season.mmr)),
    ),
    rd: Math.max(MIN_RD, rd - RD_DECREASE_PER_GAME),
    currentStreak: Math.min(0, currentStats?.currentStreak || 0) - 1,
  };
}

/**
 * Returns { title, emoji } for the given MMR value.
 */
export function getRankTitle(mmr: number) {
  const tier = RANK_TIERS.find(
    (t: { min: number; title: string; emoji: string }) => mmr >= t.min,
  );
  return tier || RANK_TIERS[RANK_TIERS.length - 1];
}

/**
 * Formats a compact stats string including rank and MMR.
 */
export function formatStatsString(stats: Partial<PlayerProfile>) {
  if (!stats) return "";
  const { wins = 0, losses = 0, mmr, rank, isPlacement } = stats;
  const total = wins + losses;
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
  let rankInfo = "";
  if (isPlacement) {
    rankInfo = `${UNRANKED_DISPLAY.emoji} ${UNRANKED_DISPLAY.title} | `;
  } else if (rank && mmr !== undefined) {
    rankInfo = `${rank.emoji} ${rank.title} (${mmr} MMR) | `;
  }
  return ` [${rankInfo}${wins}W/${losses}L ${winrate}%]`;
}

/**
 * Formats a streak display like "🔥×3" or "💀×2"
 */
export function formatStreak(currentStreak: number) {
  if (!currentStreak || currentStreak === 0) return "";
  if (currentStreak > 0) return `🔥×${currentStreak}`;
  return `💀×${Math.abs(currentStreak)}`;
}

/**
 * Computes a full player profile.
 * MMR and RD are stored state (passed in), not derived.
 */
export function computePlayerProfile(
  playerStats: (Partial<AggregatedStats> & Partial<UserStats>) | null,
): PlayerProfile {
  const wins = playerStats?.wins || 0;
  const losses = playerStats?.losses || 0;
  const totalGames = playerStats?.totalGames || (wins || 0) + (losses || 0);
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
  const mmr = playerStats?.mmr ?? BASE_MMR;
  const ratingDeviation = playerStats?.rd ?? MAX_RD;
  const isPlacement = totalGames < PLACEMENT_GAMES;
  const rank = isPlacement
    ? RANK_TIERS[RANK_TIERS.length - 1]
    : getRankTitle(mmr);
  const confidence = calculateConfidence(ratingDeviation);
  const currentStreak = playerStats?.currentStreak || 0;
  const bestStreak = playerStats?.bestStreak || 0;
  const multiplierGames = playerStats?.multiplierGames || 0;
  const multiplierWins = playerStats?.multiplierWins || 0;
  const multiplierLosses = playerStats?.multiplierLosses || 0;
  const lastPlayedAt = playerStats?.lastPlayedAt || undefined;
  const createdAt = playerStats?.createdAt || undefined;

  return {
    wins,
    losses,
    totalGames,
    winRate,
    mmr,
    rd: ratingDeviation,
    confidence,
    rank,
    isPlacement,
    currentStreak,
    bestStreak,
    multiplierGames,
    multiplierWins,
    multiplierLosses,
    lastPlayedAt,
    createdAt,
  };
}
