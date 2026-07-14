/**
 * Thin re-export facade for the deathroll feature.
 *
 * The implementation lives in ./deathroll/ (mmr, repository, gameState,
 * render, persistence, commands). This file keeps the historical import
 * paths working for the three command stubs and the test suite.
 */

export {
  executeDeathroll,
  executeDeathrollStats,
  executeDeathrollLeaderboard,
} from "./deathroll/commands.ts";

export type {
  AggregatedStats,
  GameRoll,
  GameState,
  H2HStats,
  PendingGameData,
  PendingTimeoutData,
  PlayerProfile,
  UserStats,
} from "./deathroll/types.ts";

import { getMedal } from "./commandUtils.ts";
import {
  BASE_K,
  BASE_MMR,
  GRAVITY_CENTER,
  GRAVITY_RANGE,
  GRAVITY_STRENGTH,
  MAX_RD,
  MIN_MMR,
  MIN_RD,
  MULTIPLIER_NAMES,
  PLACEMENT_GAMES,
  RANK_TIERS,
  RD_DECAY_PER_DAY,
  RD_DECREASE_PER_GAME,
  UNRANKED_DISPLAY,
  applyTimeDecayRD,
  calculateConfidence,
  calculateKFactor,
  computeLossStatsUpdate,
  computePlayerProfile,
  computeWinStatsUpdate,
  formatStatsString,
  formatStreak,
  getMultiplierName,
  getRankTitle,
  getSeasonMMR,
  gravityGainScale,
  gravityLossScale,
  mmrMultiplier,
} from "./deathroll/mmr.ts";

// ─── Exported Pure Functions (for testing) ────────────────────────────
export const _testHelpers = {
  calculateKFactor,
  calculateConfidence,
  applyTimeDecayRD,
  mmrMultiplier,
  gravityGainScale,
  gravityLossScale,
  getSeasonMMR,
  computePlayerProfile,
  computeWinStatsUpdate,
  computeLossStatsUpdate,
  getRankTitle,
  formatStreak,
  formatStatsString,
  getMedal,
  getMultiplierName,
  RANK_TIERS,
  MULTIPLIER_NAMES,
  BASE_MMR,
  MIN_MMR,
  MAX_RD,
  MIN_RD,
  BASE_K,
  RD_DECAY_PER_DAY,
  RD_DECREASE_PER_GAME,
  GRAVITY_STRENGTH,
  GRAVITY_RANGE,
  GRAVITY_CENTER,
  PLACEMENT_GAMES,
  UNRANKED_DISPLAY,
};
