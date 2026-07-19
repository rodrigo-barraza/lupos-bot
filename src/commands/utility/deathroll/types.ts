/**
 * Shared types for the deathroll game modules.
 */

export interface GameRoll {
  userId: string;
  username: string | null | undefined;
  roll: number;
  maxNumber: number;
}

export interface H2HStats {
  player1Wins: number;
  player2Wins: number;
}

export interface GameState {
  initiator: string;
  initiatorName: string | null | undefined;
  opponent: string | null;
  opponentName: string | null | undefined;
  targetUserId: string | null;
  currentNumber: number;
  currentTurn: string | null;
  messageId: string;
  channelId: string;
  startingNumber: number;
  rolls: GameRoll[];
  startedAt: number;
  currentMessageId: string | null;
  timeoutMultiplier: number;
  /** Gold each player staked (0 = timeout-only game). Escrowed up front;
   * paid out (minus rake) by saveGameResult, refunded if no result. */
  wager: number;
  h2h?: H2HStats | null;
}

export interface PendingTimeoutData {
  loserId: string;
  timeoutDuration: number;
}

export interface PendingGameData {
  game: GameState;
  winnerId: string;
  loserId: string;
  winnerInfo: { username: string; displayName: string };
  loserInfo: { username: string; displayName: string };
}

export interface UserStats {
  mmrSeason?: string;
  multiplierGames?: number;
  multiplierWins?: number;
  multiplierLosses?: number;
  createdAt?: number;
  userId: string;
  guildId: string;
  mmr: number;
  rd: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt: number;
  wins?: number;
  losses?: number;
  totalGames?: number;
}

export interface PlayerProfile {
  multiplierGames?: number;
  multiplierWins?: number;
  multiplierLosses?: number;
  createdAt?: number;
  wins: number;
  losses: number;
  totalGames: number;
  winRate: number;
  mmr: number;
  rd: number;
  isPlacement: boolean;
  rank: { title: string; emoji: string };
  confidence: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt?: number;
}

export interface AggregatedStats {
  multiplierGames?: number;
  multiplierWins?: number;
  multiplierLosses?: number;
  userId: string;
  wins: number;
  losses: number;
  totalGames: number;
}

/** Lifecycle phase persisted for boot reconciliation. */
export type GamePhase = "pending" | "active" | "don_pending";

/**
 * Compact snapshot of an in-flight game, persisted to the
 * DeathrollActiveGames collection so a restart can reconcile it.
 */
export interface DeathrollGameSnapshot {
  gameId: string;
  guildId: string;
  channelId: string;
  /** Original game message id (used to derive the game-record gameId). */
  messageId: string;
  /** Latest live message id (edited on reconcile), if different. */
  currentMessageId: string | null;
  initiator: string;
  initiatorName: string | null | undefined;
  opponent: string | null;
  opponentName: string | null | undefined;
  currentTurn: string | null;
  currentMax: number;
  startingNumber: number;
  timeoutMultiplier: number;
  wager: number;
  phase: GamePhase;
  rolls: GameRoll[];
  startedAt: number;
  pendingTimeout?: PendingTimeoutData;
  /** Set in the don_pending phase: outcome already determined, save on reconcile. */
  pendingResult?: {
    winnerId: string;
    loserId: string;
    winnerInfo: { username: string; displayName: string };
    loserInfo: { username: string; displayName: string };
  };
  updatedAt: number;
}
