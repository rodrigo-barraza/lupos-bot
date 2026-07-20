/**
 * MongoDB data access for deathroll: collections, indexes, aggregation
 * pipelines, stats fetches, game persistence, and leaderboard queries.
 */

import MongoService from "#root/services/MongoService.ts";
import config from "#root/config.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";
import utilities from "#root/utilities.ts";
import type { Collection, Document, ObjectId, UpdateFilter } from "mongodb";
import {
  applyTimeDecayRD,
  computeLossStatsUpdate,
  computePlayerProfile,
  computeWinStatsUpdate,
  getSeasonMMR,
  mmrMultiplier,
  calculateKFactor,
  gravityGainScale,
  gravityLossScale,
  MIN_MMR,
  MIN_RD,
  RD_DECREASE_PER_GAME,
  PLACEMENT_GAMES,
  UNRANKED_DISPLAY,
} from "./mmr.ts";
import type { GameState, PlayerProfile, UserStats } from "./types.ts";
import { adjustGold } from "../gold/goldRepository.ts";
import { DEATHROLL_WIN_GOLD, computeWagerPot } from "../gold/goldMath.ts";

/**
 * Gold paid to a 1v1 deathroll winner, scaled by the same compressed
 * multiplier the MMR system uses for Double-or-Nothing games.
 */
export function computeDeathrollWinGold(timeoutMultiplier: number) {
  return Math.round(DEATHROLL_WIN_GOLD * mmrMultiplier(timeoutMultiplier));
}

// ─── Collections & Indexes ────────────────────────────────────────────

let deathrollIndexesEnsured = false;

export function getDeathrollDb() {
  const localMongo = MongoService.getClient("local");
  if (!localMongo)
    throw new Error("MongoService: local client not initialized");
  return localMongo.db(MONGO_DB_NAME);
}

export function getDeathrollCollections() {
  const db = getDeathrollDb();
  const collections = {
    statsCollection: db.collection("DeathRollUserStats"),
    gamesCollection: db.collection("DeathRollGameHistory"),
  };

  // Ensure indexes once on first access (lazy init)
  if (!deathrollIndexesEnsured) {
    deathrollIndexesEnsured = true;
    ensureDeathrollIndexes(collections).catch((err: unknown) =>
      console.error(
        "Failed to ensure deathroll indexes:",
        utilities.errorMessage(err),
      ),
    );
  }

  return collections;
}

/**
 * Create indexes on DeathRoll game collections.
 * Prevents full collection scans on findOne({ userId, guildId }),
 * aggregate({ guildId, season }), and leaderboard queries.
 * The unique gameId index makes double-saving a game a no-op.
 */
async function ensureDeathrollIndexes({
  statsCollection,
  gamesCollection,
}: {
  statsCollection: Collection;
  gamesCollection: Collection;
}) {
  await Promise.all([
    // DeathRollUserStats — primary lookup pattern
    statsCollection.createIndex({ userId: 1, guildId: 1 }, { unique: true }),
    statsCollection.createIndex({ guildId: 1 }),
    statsCollection.createIndex({ guildId: 1, mmr: -1 }),

    // DeathRollGameHistory — idempotent saves + aggregation + H2H queries
    gamesCollection.createIndex({ gameId: 1 }, { unique: true }),
    gamesCollection.createIndex({ guildId: 1, season: 1 }),
    gamesCollection.createIndex({
      guildId: 1,
      season: 1,
      winnerId: 1,
      loserId: 1,
    }),
    gamesCollection.createIndex({ guildId: 1, season: 1, loserId: 1 }),
    gamesCollection.createIndex({ endedAt: -1 }),
  ]);
  console.log("📊 DeathRoll collection indexes ensured");
}

// ─── Game History Aggregation ─────────────────────────────────────────

/**
 * Aggregates a single player's stats from DeathRollGameHistory.
 * Returns wins, losses, totalGames, mmrWins, mmrLosses, multiplier stats,
 * lastPlayedAt, and createdAt — all derived from game records.
 */
export async function aggregatePlayerStats(guildId: string, userId: string) {
  const { gamesCollection } = getDeathrollCollections();
  const season = config.DEATHROLL_SEASON;
  const results = await gamesCollection
    .aggregate([
      {
        $match: {
          guildId,
          season,
          $or: [{ winnerId: userId }, { loserId: userId }],
        },
      },
      {
        $group: {
          _id: null,
          wins: { $sum: { $cond: [{ $eq: ["$winnerId", userId] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ["$loserId", userId] }, 1, 0] } },
          mmrWins: {
            $sum: {
              $cond: [
                { $eq: ["$winnerId", userId] },
                { $ifNull: ["$timeoutMultiplier", 1] },
                0,
              ],
            },
          },
          mmrLosses: {
            $sum: {
              $cond: [
                { $eq: ["$loserId", userId] },
                { $ifNull: ["$timeoutMultiplier", 1] },
                0,
              ],
            },
          },
          multiplierWins: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$winnerId", userId] },
                    { $gt: ["$timeoutMultiplier", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          multiplierLosses: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$loserId", userId] },
                    { $gt: ["$timeoutMultiplier", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          lastPlayedAt: { $max: "$endedAt" },
          createdAt: { $min: "$startedAt" },
        },
      },
    ])
    .toArray();

  const aggregation = results[0];
  if (!aggregation) return null;

  return {
    wins: aggregation.wins,
    losses: aggregation.losses,
    totalGames: aggregation.wins + aggregation.losses,
    mmrWins: aggregation.mmrWins,
    mmrLosses: aggregation.mmrLosses,
    multiplierWins: aggregation.multiplierWins,
    multiplierLosses: aggregation.multiplierLosses,
    multiplierGames: aggregation.multiplierWins + aggregation.multiplierLosses,
    lastPlayedAt: aggregation.lastPlayedAt,
    createdAt: aggregation.createdAt,
  };
}

interface AggregatedPlayerDoc {
  _id: string;
  wins: number;
  losses: number;
  mmrWins: number;
  mmrLosses: number;
  multiplierWins: number;
  multiplierLosses: number;
  lastPlayedAt: number;
  createdAt: number;
}

/**
 * Aggregates all players' stats from DeathRollGameHistory for leaderboard.
 * Each game doc is split into a winner and loser record, then grouped per player.
 */
export async function aggregateAllPlayerStats(guildId: string) {
  const { gamesCollection } = getDeathrollCollections();
  const season = config.DEATHROLL_SEASON;
  const results = (await gamesCollection
    .aggregate([
      { $match: { guildId, season } },
      {
        $project: {
          players: [
            {
              userId: "$winnerId",
              username: "$winnerName",
              result: "win",
              multiplier: { $ifNull: ["$timeoutMultiplier", 1] },
              endedAt: "$endedAt",
              startedAt: "$startedAt",
            },
            {
              userId: "$loserId",
              username: "$loserName",
              result: "loss",
              multiplier: { $ifNull: ["$timeoutMultiplier", 1] },
              endedAt: "$endedAt",
              startedAt: "$startedAt",
            },
          ],
        },
      },
      { $unwind: "$players" },
      {
        $group: {
          _id: "$players.userId",
          wins: {
            $sum: { $cond: [{ $eq: ["$players.result", "win"] }, 1, 0] },
          },
          losses: {
            $sum: { $cond: [{ $eq: ["$players.result", "loss"] }, 1, 0] },
          },
          mmrWins: {
            $sum: {
              $cond: [
                { $eq: ["$players.result", "win"] },
                "$players.multiplier",
                0,
              ],
            },
          },
          mmrLosses: {
            $sum: {
              $cond: [
                { $eq: ["$players.result", "loss"] },
                "$players.multiplier",
                0,
              ],
            },
          },
          multiplierWins: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$players.result", "win"] },
                    { $gt: ["$players.multiplier", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          multiplierLosses: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$players.result", "loss"] },
                    { $gt: ["$players.multiplier", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          lastPlayedAt: { $max: "$players.endedAt" },
          createdAt: { $min: "$players.startedAt" },
        },
      },
    ])
    .toArray()) as unknown as AggregatedPlayerDoc[];

  return results.map((r: AggregatedPlayerDoc) => ({
    userId: r._id,
    wins: r.wins,
    losses: r.losses,
    totalGames: r.wins + r.losses,
    mmrWins: r.mmrWins,
    mmrLosses: r.mmrLosses,
    multiplierWins: r.multiplierWins,
    multiplierLosses: r.multiplierLosses,
    multiplierGames: r.multiplierWins + r.multiplierLosses,
    lastPlayedAt: r.lastPlayedAt,
    createdAt: r.createdAt,
  }));
}

// ─── Data Access Functions ────────────────────────────────────────────

export async function fetchSinglePlayerStats(guildId: string, userId: string) {
  try {
    const { statsCollection } = getDeathrollCollections();
    const [historyStats, userStats] = await Promise.all([
      aggregatePlayerStats(guildId, userId),
      statsCollection.findOne({
        userId,
        guildId,
      }) as unknown as Partial<UserStats> | null,
    ]);

    if (!historyStats) return computePlayerProfile(null);

    const { mmr, rd } = getSeasonMMR(userStats);
    const decayedRD = applyTimeDecayRD(rd, userStats?.lastPlayedAt);

    return computePlayerProfile({
      ...historyStats,
      mmr,
      rd: decayedRD,
      currentStreak: userStats?.currentStreak || 0,
      bestStreak: userStats?.bestStreak || 0,
    });
  } catch (error: unknown) {
    console.error("Error fetching deathroll stats:", error);
    return null;
  }
}

export async function fetchMidGameStats(
  guildId: string,
  initiatorId: string,
  opponentId: string,
) {
  try {
    const { statsCollection } = getDeathrollCollections();
    const [
      initiatorHistory,
      opponentHistory,
      initiatorUserStats,
      opponentUserStats,
    ] = await Promise.all([
      aggregatePlayerStats(guildId, initiatorId),
      aggregatePlayerStats(guildId, opponentId),
      statsCollection.findOne({
        userId: initiatorId,
        guildId,
      }) as unknown as Promise<Partial<UserStats> | null>,
      statsCollection.findOne({
        userId: opponentId,
        guildId,
      }) as unknown as Promise<Partial<UserStats> | null>,
    ]);

    const initiatorMMR = getSeasonMMR(initiatorUserStats);
    const opponentMMR = getSeasonMMR(opponentUserStats);

    return {
      initiator: computePlayerProfile({
        ...(initiatorHistory || {}),
        mmr: initiatorMMR.mmr,
        rd: applyTimeDecayRD(initiatorMMR.rd, initiatorUserStats?.lastPlayedAt),
        currentStreak: initiatorUserStats?.currentStreak || 0,
        bestStreak: initiatorUserStats?.bestStreak || 0,
      }),
      opponent: computePlayerProfile({
        ...(opponentHistory || {}),
        mmr: opponentMMR.mmr,
        rd: applyTimeDecayRD(opponentMMR.rd, opponentUserStats?.lastPlayedAt),
        currentStreak: opponentUserStats?.currentStreak || 0,
        bestStreak: opponentUserStats?.bestStreak || 0,
      }),
    };
  } catch (error: unknown) {
    console.error("Error fetching mid-game deathroll stats:", error);
    return null;
  }
}

export async function fetchHeadToHead(
  guildId: string,
  player1Id: string,
  player2Id: string,
) {
  try {
    const { gamesCollection } = getDeathrollCollections();
    const season = config.DEATHROLL_SEASON;
    const [p1Wins, p2Wins] = await Promise.all([
      gamesCollection.countDocuments({
        guildId,
        season,
        winnerId: player1Id,
        loserId: player2Id,
      }),
      gamesCollection.countDocuments({
        guildId,
        season,
        winnerId: player2Id,
        loserId: player1Id,
      }),
    ]);
    return { player1Wins: p1Wins, player2Wins: p2Wins };
  } catch (error: unknown) {
    console.error("Error fetching H2H:", error);
    return null;
  }
}

export async function buildEndGameData(
  guildId: string,
  game: GameState,
  winnerId: string,
  loserId: string,
) {
  try {
    const { statsCollection } = getDeathrollCollections();
    const [winnerHistory, loserHistory, winnerUserStats, loserUserStats] =
      await Promise.all([
        aggregatePlayerStats(guildId, winnerId),
        aggregatePlayerStats(guildId, loserId),
        statsCollection.findOne({
          userId: winnerId,
          guildId,
        }) as unknown as Promise<Partial<UserStats> | null>,
        statsCollection.findOne({
          userId: loserId,
          guildId,
        }) as unknown as Promise<Partial<UserStats> | null>,
      ]);

    const multiplier = game.timeoutMultiplier || 1;

    // Get stored MMR/RD (season-aware) and apply time decay
    const winnerSeason = getSeasonMMR(winnerUserStats);
    const loserSeason = getSeasonMMR(loserUserStats);
    const winnerRD = applyTimeDecayRD(
      winnerSeason.rd,
      winnerUserStats?.lastPlayedAt,
    );
    const loserRD = applyTimeDecayRD(
      loserSeason.rd,
      loserUserStats?.lastPlayedAt,
    );

    const winnerPre = computePlayerProfile({
      ...(winnerHistory || {}),
      mmr: winnerSeason.mmr,
      rd: winnerRD,
      currentStreak: winnerUserStats?.currentStreak || 0,
      bestStreak: winnerUserStats?.bestStreak || 0,
    });
    const loserPre = computePlayerProfile({
      ...(loserHistory || {}),
      mmr: loserSeason.mmr,
      rd: loserRD,
      currentStreak: loserUserStats?.currentStreak || 0,
      bestStreak: loserUserStats?.bestStreak || 0,
    });

    // Predict post-game MMR (this game hasn't been saved yet)
    const winnerK = calculateKFactor(winnerRD);
    const loserK = calculateKFactor(loserRD);
    const mmrMult = mmrMultiplier(multiplier);
    const winnerPostMmr = Math.round(
      winnerSeason.mmr + winnerK * mmrMult * gravityGainScale(winnerSeason.mmr),
    );
    const loserPostMmr = Math.max(
      MIN_MMR,
      Math.round(
        loserSeason.mmr - loserK * mmrMult * gravityLossScale(loserSeason.mmr),
      ),
    );
    const winnerPostRD = Math.max(MIN_RD, winnerRD - RD_DECREASE_PER_GAME);
    const loserPostRD = Math.max(MIN_RD, loserRD - RD_DECREASE_PER_GAME);

    const winnerPost = computePlayerProfile({
      ...(winnerHistory || {}),
      wins: (winnerHistory?.wins || 0) + 1,
      totalGames: (winnerHistory?.totalGames || 0) + 1,
      mmr: winnerPostMmr,
      rd: winnerPostRD,
    });
    const loserPost = computePlayerProfile({
      ...(loserHistory || {}),
      losses: (loserHistory?.losses || 0) + 1,
      totalGames: (loserHistory?.totalGames || 0) + 1,
      mmr: loserPostMmr,
      rd: loserPostRD,
    });

    const winnerCurrentStreak = Math.max(0, winnerPre.currentStreak) + 1;
    const loserCurrentStreak = Math.min(0, loserPre.currentStreak) - 1;
    const winnerMmrDiff = winnerPost.mmr - winnerPre.mmr;
    const loserMmrDiff = loserPost.mmr - loserPre.mmr;
    const multiplierLabel = multiplier > 1 ? ` [${multiplier}x]` : "";

    return {
      winner: { wins: winnerPost.wins, losses: winnerPost.losses },
      loser: { wins: loserPost.wins, losses: loserPost.losses },
      winnerRank: winnerPost.isPlacement
        ? `${UNRANKED_DISPLAY.emoji} ${UNRANKED_DISPLAY.title}`
        : `${winnerPost.rank.emoji} ${winnerPost.rank.title}`,
      loserRank: loserPost.isPlacement
        ? `${UNRANKED_DISPLAY.emoji} ${UNRANKED_DISPLAY.title}`
        : `${loserPost.rank.emoji} ${loserPost.rank.title}`,
      winnerMmrChange: winnerPost.isPlacement
        ? ` (${PLACEMENT_GAMES - winnerPost.totalGames} game${PLACEMENT_GAMES - winnerPost.totalGames !== 1 ? "s" : ""} until ranked)`
        : ` (${winnerPost.mmr} MMR, +${winnerMmrDiff}${multiplierLabel} ↑)`,
      loserMmrChange: loserPost.isPlacement
        ? ` (${PLACEMENT_GAMES - loserPost.totalGames} game${PLACEMENT_GAMES - loserPost.totalGames !== 1 ? "s" : ""} until ranked)`
        : ` (${loserPost.mmr} MMR, ${loserMmrDiff}${multiplierLabel} ↓)`,
      winnerStreak: winnerCurrentStreak,
      loserStreak: loserCurrentStreak,
      winnerGold: computeDeathrollWinGold(multiplier),
      winnerPot: game.wager > 0 ? computeWagerPot(game.wager, 2) : 0,
    };
  } catch (error: unknown) {
    console.error("Error building end game data:", error);
    return null;
  }
}

// ─── Game Result Persistence ──────────────────────────────────────────

/**
 * Applies a per-player stats update with optimistic concurrency:
 * reads the current doc, computes the update from it, then writes with a
 * filter pinned to the previously-read MMR value. On a lost race (another
 * game ended for the same player in between) it re-reads and retries once.
 */
async function updatePlayerStatsAtomic(
  statsCollection: Collection,
  userId: string,
  guildId: string,
  buildUpdate: (current: Partial<UserStats> | null) => UpdateFilter<Document>,
) {
  const current = (await statsCollection.findOne({
    userId,
    guildId,
  })) as (Partial<UserStats> & { _id: ObjectId }) | null;
  const update = buildUpdate(current);

  if (current) {
    const mmrGuard =
      current.mmr === undefined ? { $exists: false } : current.mmr;
    const result = await statsCollection.updateOne(
      { _id: current._id, mmr: mmrGuard },
      update,
    );
    if (result.matchedCount > 0) return;

    // Lost the race — re-read, recompute from fresh state, write once more.
    const fresh = (await statsCollection.findOne({
      userId,
      guildId,
    })) as Partial<UserStats> | null;
    await statsCollection.updateOne({ userId, guildId }, buildUpdate(fresh), {
      upsert: true,
    });
    return;
  }

  try {
    await statsCollection.updateOne({ userId, guildId }, update, {
      upsert: true,
    });
  } catch (error: unknown) {
    // Concurrent insert beat our upsert — recompute against the new doc.
    if ((error as { code?: number }).code === 11000) {
      const fresh = (await statsCollection.findOne({
        userId,
        guildId,
      })) as Partial<UserStats> | null;
      await statsCollection.updateOne({ userId, guildId }, buildUpdate(fresh), {
        upsert: true,
      });
      return;
    }
    throw error;
  }
}

/**
 * Saves game result. Updates MMR, RD, streaks & metadata in DeathRollUserStats.
 * MMR uses Glicko-2 inspired system with K-factor scaled by Rating Deviation.
 *
 * The game record is inserted first and acts as the idempotency token:
 * a duplicate gameId (double save) skips the stats updates entirely.
 */
export async function saveGameResult(
  guildId: string,
  game: GameState,
  winnerId: string,
  loserId: string,
  winnerInfo: { username: string; displayName: string },
  loserInfo: { username: string; displayName: string },
  endReason: string | null,
) {
  const { statsCollection, gamesCollection } = getDeathrollCollections();
  const now = Date.now();
  const multiplier = game.timeoutMultiplier || 1;

  const gameRecord: Record<string, unknown> = {
    gameId: `${guildId}_${game.messageId}`,
    guildId,
    channelId: game.channelId,
    initiatorId: game.initiator,
    initiatorName: game.initiatorName,
    opponentId: game.opponent,
    opponentName: game.opponentName,
    startingNumber: game.startingNumber,
    winnerId,
    winnerName: winnerInfo.username,
    loserId,
    loserName: loserInfo.username,
    rolls: game.rolls,
    totalRolls: game.rolls.length,
    startedAt: game.startedAt,
    endedAt: now,
    duration: now - game.startedAt,
    timeoutMultiplier: multiplier,
    wager: game.wager || 0,
    pot: game.wager > 0 ? computeWagerPot(game.wager, 2) : 0,
    season: config.DEATHROLL_SEASON,
  };
  if (endReason) {
    gameRecord.endReason = endReason;
  }

  try {
    await gamesCollection.insertOne(gameRecord);
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      console.warn(
        `[deathroll] Game ${gameRecord.gameId as string} already saved — skipping duplicate save`,
      );
      return;
    }
    throw error;
  }

  // The unique gameId insert above is the idempotency gate, so the gold
  // awards can't double-pay on a duplicate save.
  await adjustGold(
    guildId,
    winnerId,
    computeDeathrollWinGold(multiplier),
    "deathroll_win",
    {
      userInfo: winnerInfo,
      meta: { gameId: gameRecord.gameId },
    },
  );
  // Escrowed wagers pay out here — the only "result saved" moment — so
  // the pot survives Double-or-Nothing chains and restart reconciliation.
  if (game.wager > 0) {
    await adjustGold(
      guildId,
      winnerId,
      computeWagerPot(game.wager, 2),
      "deathroll_pot",
      {
        userInfo: winnerInfo,
        meta: { gameId: gameRecord.gameId, wager: game.wager },
      },
    );
  }

  await updatePlayerStatsAtomic(
    statsCollection,
    loserId,
    guildId,
    (current: Partial<UserStats> | null) => {
      const loss = computeLossStatsUpdate(current, multiplier);
      return {
        $set: {
          username: loserInfo.username,
          displayName: loserInfo.displayName,
          lastPlayedAt: now,
          lastOpponentId: winnerId,
          lastOpponentName: winnerInfo.username,
          lastGameResult: "loss",
          lastStartingNumber: game.startingNumber,
          currentStreak: loss.currentStreak,
          mmr: loss.mmr,
          rd: loss.rd,
          mmrSeason: config.DEATHROLL_SEASON,
        },
        $setOnInsert: { createdAt: now, bestStreak: 0 },
      };
    },
  );

  await updatePlayerStatsAtomic(
    statsCollection,
    winnerId,
    guildId,
    (current: Partial<UserStats> | null) => {
      const win = computeWinStatsUpdate(current, multiplier);
      return {
        $set: {
          username: winnerInfo.username,
          displayName: winnerInfo.displayName,
          lastPlayedAt: now,
          lastOpponentId: loserId,
          lastOpponentName: loserInfo.username,
          lastGameResult: "win",
          lastStartingNumber: game.startingNumber,
          currentStreak: win.currentStreak,
          bestStreak: win.bestStreak,
          mmr: win.mmr,
          rd: win.rd,
          mmrSeason: config.DEATHROLL_SEASON,
        },
        $setOnInsert: { createdAt: now },
      };
    },
  );
}

// ─── Leaderboard & Rivals ─────────────────────────────────────────────

export async function fetchTopRivals(
  guildId: string,
  userId: string,
  limit: number = 3,
) {
  try {
    const { gamesCollection } = getDeathrollCollections();
    const season = config.DEATHROLL_SEASON;
    return await gamesCollection
      .aggregate([
        {
          $match: {
            guildId,
            season,
            $or: [{ winnerId: userId }, { loserId: userId }],
          },
        },
        {
          $project: {
            opponentId: {
              $cond: {
                if: { $eq: ["$winnerId", userId] },
                then: "$loserId",
                else: "$winnerId",
              },
            },
            opponentName: {
              $cond: {
                if: { $eq: ["$winnerId", userId] },
                then: "$loserName",
                else: "$winnerName",
              },
            },
            won: { $eq: ["$winnerId", userId] },
          },
        },
        {
          $group: {
            _id: "$opponentId",
            name: { $last: "$opponentName" },
            games: { $sum: 1 },
            winsAgainst: { $sum: { $cond: ["$won", 1, 0] } },
          },
        },
        { $sort: { games: -1 } },
        { $limit: limit },
      ])
      .toArray();
  } catch (error: unknown) {
    console.error("Error fetching top rivals:", error);
    return [];
  }
}

export interface LeaderboardPlayer {
  userId: string;
  wins: number;
  losses: number;
  totalGames: number;
  mmrWins: number;
  mmrLosses: number;
  multiplierWins: number;
  multiplierLosses: number;
  multiplierGames: number;
  lastPlayedAt: number;
  createdAt: number;
}

export interface RankedPlayer {
  userId: string;
  profile: PlayerProfile;
}

export async function fetchLeaderboard(guildId: string, limit: number = 20) {
  try {
    const { statsCollection } = getDeathrollCollections();
    const [historyStatsRaw, userStatsList] = await Promise.all([
      aggregateAllPlayerStats(guildId),
      statsCollection.find({ guildId }).toArray(),
    ]);

    const historyStats = historyStatsRaw as unknown as LeaderboardPlayer[];

    if (historyStats.length === 0) {
      return { players: [], ranked: [], totalGamesPlayed: 0 };
    }

    const userStatsMap = new Map<string, Partial<UserStats>>(
      userStatsList.map((s) => [
        s.userId as string,
        s as unknown as Partial<UserStats>,
      ]),
    );

    let ranked: RankedPlayer[] = historyStats
      .map((hs) => {
        const userStatsEntry = userStatsMap.get(hs.userId) || {};
        const { mmr, rd } = getSeasonMMR(userStatsEntry);
        return {
          userId: hs.userId,
          profile: computePlayerProfile({
            ...hs,
            mmr,
            rd: applyTimeDecayRD(rd, userStatsEntry.lastPlayedAt),
            currentStreak: userStatsEntry.currentStreak || 0,
            bestStreak: userStatsEntry.bestStreak || 0,
          }),
        };
      })
      .sort(
        (a: RankedPlayer, b: RankedPlayer) => b.profile.mmr - a.profile.mmr,
      );

    if (limit && limit > 0) {
      ranked = ranked.slice(0, limit);
    }

    // Each game has exactly one winner, so sum of wins = total games
    const totalGamesPlayed = historyStats.reduce(
      (sum: number, p: LeaderboardPlayer) => sum + p.wins,
      0,
    );
    return { players: historyStats, ranked, totalGamesPlayed };
  } catch (error: unknown) {
    console.error("Error fetching leaderboard:", error);
    return { players: [], ranked: [], totalGamesPlayed: 0 };
  }
}
