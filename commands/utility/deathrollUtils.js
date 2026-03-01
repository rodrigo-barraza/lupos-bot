/**
 * Shared utilities and data layer for deathroll commands.
 * All MongoDB access, game logic, and business logic lives here.
 * Command files are thin stubs that call exported functions from this file.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';
import config from '#root/config.json' with { type: 'json' };

// ─── Constants ────────────────────────────────────────────────────────

const RANK_TIERS = [
    { min: 1400, title: 'Deathroll King', emoji: '🔱' },
    { min: 1300, title: 'Diamond', emoji: '💎' },
    { min: 1200, title: 'Champion', emoji: '👑' },
    { min: 1100, title: 'Veteran', emoji: '🛡️' },
    { min: 1000, title: 'Duelist', emoji: '⚔️' },
    { min: 950, title: 'Roller', emoji: '🎲' },
    { min: 900, title: 'Grave', emoji: '🪦' },
    { min: -Infinity, title: 'Cursed', emoji: '💀' },
];

const BASE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Glicko-2 inspired MMR constants
const BASE_MMR = 1000;
const MIN_MMR = 1;
const MAX_RD = 200;   // Rating Deviation: max uncertainty (new/returning players)
const MIN_RD = 30;    // Rating Deviation: min uncertainty (veterans)
const BASE_K = 25;    // Base K-factor for MMR changes
const RD_DECAY_PER_DAY = 1;     // RD increases by this per day inactive
const RD_DECREASE_PER_GAME = 5; // RD decreases by this per game played

const MULTIPLIER_NAMES = {
    2: 'Double (2x)',
    4: 'Quadruple (4x)',
    8: 'Octuple (8x)',
    16: 'Sexdecuple (16x)',
    32: 'Duotrigintuple (32x)',
    64: 'Sexagintiquadruple (64x)',
    128: 'Centumduoduodecimal (128x)',
    256: 'Ducentiquinquagintaseptimal (256x)',
    512: 'Quinquagintaducentiseptimal (512x)',
    1024: 'Milliduoquattuorsexagesimal (1024x)'
};

function getMultiplierName(multiplier) {
    return MULTIPLIER_NAMES[multiplier] || `${multiplier}x`;
}

// Store active games (gameId -> game state)
const activeGames = new Map();
// Store active collectors
const activeCollectors = new Map();

// ─── Pure Computation Helpers ─────────────────────────────────────────

/**
 * Glicko-2 inspired K-factor: scales with Rating Deviation.
 * High RD (uncertain) = larger swings (up to 50).
 * Low RD (confident) = stable swings (25).
 */
function calculateKFactor(rd) {
    const clampedRD = Math.max(MIN_RD, Math.min(MAX_RD, rd));
    return BASE_K + BASE_K * (clampedRD - MIN_RD) / (MAX_RD - MIN_RD);
}

/**
 * Compresses the game timeout multiplier for MMR purposes.
 * Each Double or Nothing adds +0.25 to the MMR effect instead of doubling.
 * 1x→1, 2x→1.25, 4x→1.5, 16x→2, 1024x→3.5
 */
function mmrMultiplier(timeoutMultiplier) {
    if (timeoutMultiplier <= 1) return 1;
    return Math.log2(timeoutMultiplier) * 0.25 + 1;
}

/**
 * Rank Confidence: 0% (totally uncertain) to 100% (fully confident).
 * Derived from Rating Deviation.
 */
function calculateConfidence(rd) {
    const clampedRD = Math.max(MIN_RD, Math.min(MAX_RD, rd));
    return Math.round((1 - (clampedRD - MIN_RD) / (MAX_RD - MIN_RD)) * 100);
}

/**
 * Time-decay for Rating Deviation: RD grows by RD_DECAY_PER_DAY for each
 * day of inactivity, capped at MAX_RD. Returning players become volatile.
 */
function applyTimeDecayRD(rd, lastPlayedAt) {
    if (!lastPlayedAt) return MAX_RD;
    const daysSince = (Date.now() - lastPlayedAt) / (24 * 60 * 60 * 1000);
    return Math.min(MAX_RD, rd + daysSince * RD_DECAY_PER_DAY);
}

/**
 * Returns the current-season MMR/RD for a player from their UserStats doc.
 * If mmrSeason doesn't match the current season, returns defaults.
 */
function getSeasonMMR(userStats) {
    if (!userStats || userStats.mmrSeason !== config.DEATHROLL_SEASON) {
        return { mmr: BASE_MMR, rd: MAX_RD };
    }
    return {
        mmr: userStats.mmr ?? BASE_MMR,
        rd: userStats.rd ?? MAX_RD
    };
}

/**
 * Returns { title, emoji } for the given MMR value.
 */
function getRankTitle(mmr) {
    const tier = RANK_TIERS.find(t => mmr >= t.min);
    return tier || RANK_TIERS[RANK_TIERS.length - 1];
}

/**
 * Formats a compact stats string including rank and MMR.
 */
function formatStatsString(stats) {
    if (!stats) return '';
    const { wins, losses, mmr, rank } = stats;
    const total = wins + losses;
    const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const rankInfo = rank && mmr !== undefined ? `${rank.emoji} ${rank.title} (${mmr} MMR) | ` : '';
    return ` [${rankInfo}${wins}W/${losses}L ${winrate}%]`;
}

/**
 * Formats a streak display like "🔥×3" or "💀×2"
 */
function formatStreak(currentStreak) {
    if (!currentStreak || currentStreak === 0) return '';
    if (currentStreak > 0) return `🔥×${currentStreak}`;
    return `💀×${Math.abs(currentStreak)}`;
}

/**
 * Computes a full player profile.
 * MMR and RD are stored state (passed in), not derived.
 */
function computePlayerProfile(playerStats) {
    const wins = playerStats?.wins || 0;
    const losses = playerStats?.losses || 0;
    const totalGames = playerStats?.totalGames || (wins + losses);
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
    const mmr = playerStats?.mmr ?? BASE_MMR;
    const rd = playerStats?.rd ?? MAX_RD;
    const rank = getRankTitle(mmr);
    const confidence = calculateConfidence(rd);
    const currentStreak = playerStats?.currentStreak || 0;
    const bestStreak = playerStats?.bestStreak || 0;
    const multiplierGames = playerStats?.multiplierGames || 0;
    const multiplierWins = playerStats?.multiplierWins || 0;
    const multiplierLosses = playerStats?.multiplierLosses || 0;
    const lastPlayedAt = playerStats?.lastPlayedAt || null;
    const createdAt = playerStats?.createdAt || null;

    return {
        wins, losses, totalGames, winRate, mmr, rd, confidence, rank,
        currentStreak, bestStreak,
        multiplierGames, multiplierWins, multiplierLosses,
        lastPlayedAt, createdAt
    };
}

/**
 * Finds the biggest single-roll drop in a game.
 */
function getBiggestDrop(rolls) {
    let biggest = { drop: 0, from: 0, to: 0 };
    for (const roll of rolls) {
        const drop = roll.maxNumber - roll.roll;
        if (drop > biggest.drop) {
            biggest = { drop, from: roll.maxNumber, to: roll.roll };
        }
    }
    return biggest;
}

/**
 * Returns a medal emoji for leaderboard position.
 */
function getMedal(index) {
    switch (index) {
        case 0: return '🥇';
        case 1: return '🥈';
        case 2: return '🥉';
        default: return '  ';
    }
}

// ─── Database Helpers ─────────────────────────────────────────────────

function getDeathrollCollections() {
    const localMongo = MongoWrapper.getClient('local');
    const db = localMongo.db('lupos');
    return {
        statsCollection: db.collection('DeathRollUserStats'),
        gamesCollection: db.collection('DeathRollGameHistory')
    };
}

// ─── Game History Aggregation ─────────────────────────────────────────

/**
 * Aggregates a single player's stats from DeathRollGameHistory.
 * Returns wins, losses, totalGames, mmrWins, mmrLosses, multiplier stats,
 * lastPlayedAt, and createdAt — all derived from game records.
 */
async function aggregatePlayerStats(guildId, userId) {
    const { gamesCollection } = getDeathrollCollections();
    const season = config.DEATHROLL_SEASON;
    const results = await gamesCollection.aggregate([
        { $match: { guildId, season, $or: [{ winnerId: userId }, { loserId: userId }] } },
        {
            $group: {
                _id: null,
                wins: { $sum: { $cond: [{ $eq: ['$winnerId', userId] }, 1, 0] } },
                losses: { $sum: { $cond: [{ $eq: ['$loserId', userId] }, 1, 0] } },
                mmrWins: { $sum: { $cond: [{ $eq: ['$winnerId', userId] }, { $ifNull: ['$timeoutMultiplier', 1] }, 0] } },
                mmrLosses: { $sum: { $cond: [{ $eq: ['$loserId', userId] }, { $ifNull: ['$timeoutMultiplier', 1] }, 0] } },
                multiplierWins: { $sum: { $cond: [{ $and: [{ $eq: ['$winnerId', userId] }, { $gt: ['$timeoutMultiplier', 1] }] }, 1, 0] } },
                multiplierLosses: { $sum: { $cond: [{ $and: [{ $eq: ['$loserId', userId] }, { $gt: ['$timeoutMultiplier', 1] }] }, 1, 0] } },
                lastPlayedAt: { $max: '$endedAt' },
                createdAt: { $min: '$startedAt' }
            }
        }
    ]).toArray();

    const r = results[0];
    if (!r) return null;

    return {
        wins: r.wins,
        losses: r.losses,
        totalGames: r.wins + r.losses,
        mmrWins: r.mmrWins,
        mmrLosses: r.mmrLosses,
        multiplierWins: r.multiplierWins,
        multiplierLosses: r.multiplierLosses,
        multiplierGames: r.multiplierWins + r.multiplierLosses,
        lastPlayedAt: r.lastPlayedAt,
        createdAt: r.createdAt
    };
}

/**
 * Aggregates all players' stats from DeathRollGameHistory for leaderboard.
 * Each game doc is split into a winner and loser record, then grouped per player.
 */
async function aggregateAllPlayerStats(guildId) {
    const { gamesCollection } = getDeathrollCollections();
    const season = config.DEATHROLL_SEASON;
    const results = await gamesCollection.aggregate([
        { $match: { guildId, season } },
        {
            $project: {
                players: [
                    { userId: '$winnerId', username: '$winnerName', result: 'win', multiplier: { $ifNull: ['$timeoutMultiplier', 1] }, endedAt: '$endedAt', startedAt: '$startedAt' },
                    { userId: '$loserId', username: '$loserName', result: 'loss', multiplier: { $ifNull: ['$timeoutMultiplier', 1] }, endedAt: '$endedAt', startedAt: '$startedAt' }
                ]
            }
        },
        { $unwind: '$players' },
        {
            $group: {
                _id: '$players.userId',
                wins: { $sum: { $cond: [{ $eq: ['$players.result', 'win'] }, 1, 0] } },
                losses: { $sum: { $cond: [{ $eq: ['$players.result', 'loss'] }, 1, 0] } },
                mmrWins: { $sum: { $cond: [{ $eq: ['$players.result', 'win'] }, '$players.multiplier', 0] } },
                mmrLosses: { $sum: { $cond: [{ $eq: ['$players.result', 'loss'] }, '$players.multiplier', 0] } },
                multiplierWins: { $sum: { $cond: [{ $and: [{ $eq: ['$players.result', 'win'] }, { $gt: ['$players.multiplier', 1] }] }, 1, 0] } },
                multiplierLosses: { $sum: { $cond: [{ $and: [{ $eq: ['$players.result', 'loss'] }, { $gt: ['$players.multiplier', 1] }] }, 1, 0] } },
                lastPlayedAt: { $max: '$players.endedAt' },
                createdAt: { $min: '$players.startedAt' }
            }
        }
    ]).toArray();

    return results.map(r => ({
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
        createdAt: r.createdAt
    }));
}

// ─── Data Access Functions ────────────────────────────────────────────

async function fetchSinglePlayerStats(guildId, userId) {
    try {
        const { statsCollection } = getDeathrollCollections();
        const [historyStats, userStats] = await Promise.all([
            aggregatePlayerStats(guildId, userId),
            statsCollection.findOne({ userId, guildId })
        ]);

        if (!historyStats) return computePlayerProfile(null);

        const { mmr, rd } = getSeasonMMR(userStats);
        const decayedRD = applyTimeDecayRD(rd, userStats?.lastPlayedAt);

        return computePlayerProfile({
            ...historyStats,
            mmr, rd: decayedRD,
            currentStreak: userStats?.currentStreak || 0,
            bestStreak: userStats?.bestStreak || 0
        });
    } catch (error) {
        console.error('Error fetching deathroll stats:', error);
        return null;
    }
}

async function fetchMidGameStats(guildId, initiatorId, opponentId) {
    try {
        const { statsCollection } = getDeathrollCollections();
        const [initiatorHistory, opponentHistory, initiatorUserStats, opponentUserStats] = await Promise.all([
            aggregatePlayerStats(guildId, initiatorId),
            aggregatePlayerStats(guildId, opponentId),
            statsCollection.findOne({ userId: initiatorId, guildId }),
            statsCollection.findOne({ userId: opponentId, guildId })
        ]);

        const initiatorMMR = getSeasonMMR(initiatorUserStats);
        const opponentMMR = getSeasonMMR(opponentUserStats);

        return {
            initiator: computePlayerProfile({
                ...(initiatorHistory || {}),
                mmr: initiatorMMR.mmr,
                rd: applyTimeDecayRD(initiatorMMR.rd, initiatorUserStats?.lastPlayedAt),
                currentStreak: initiatorUserStats?.currentStreak || 0,
                bestStreak: initiatorUserStats?.bestStreak || 0
            }),
            opponent: computePlayerProfile({
                ...(opponentHistory || {}),
                mmr: opponentMMR.mmr,
                rd: applyTimeDecayRD(opponentMMR.rd, opponentUserStats?.lastPlayedAt),
                currentStreak: opponentUserStats?.currentStreak || 0,
                bestStreak: opponentUserStats?.bestStreak || 0
            })
        };
    } catch (error) {
        console.error('Error fetching mid-game deathroll stats:', error);
        return null;
    }
}

async function fetchHeadToHead(guildId, player1Id, player2Id) {
    try {
        const { gamesCollection } = getDeathrollCollections();
        const season = config.DEATHROLL_SEASON;
        const [p1Wins, p2Wins] = await Promise.all([
            gamesCollection.countDocuments({ guildId, season, winnerId: player1Id, loserId: player2Id }),
            gamesCollection.countDocuments({ guildId, season, winnerId: player2Id, loserId: player1Id })
        ]);
        return { player1Wins: p1Wins, player2Wins: p2Wins };
    } catch (error) {
        console.error('Error fetching H2H:', error);
        return null;
    }
}

async function buildEndGameData(guildId, game, winnerId, loserId) {
    try {
        const { statsCollection } = getDeathrollCollections();
        const [winnerHistory, loserHistory, winnerUserStats, loserUserStats] = await Promise.all([
            aggregatePlayerStats(guildId, winnerId),
            aggregatePlayerStats(guildId, loserId),
            statsCollection.findOne({ userId: winnerId, guildId }),
            statsCollection.findOne({ userId: loserId, guildId })
        ]);

        const multiplier = game.timeoutMultiplier || 1;

        // Get stored MMR/RD (season-aware) and apply time decay
        const winnerSeason = getSeasonMMR(winnerUserStats);
        const loserSeason = getSeasonMMR(loserUserStats);
        const winnerRD = applyTimeDecayRD(winnerSeason.rd, winnerUserStats?.lastPlayedAt);
        const loserRD = applyTimeDecayRD(loserSeason.rd, loserUserStats?.lastPlayedAt);

        const winnerPre = computePlayerProfile({
            ...(winnerHistory || {}),
            mmr: winnerSeason.mmr, rd: winnerRD,
            currentStreak: winnerUserStats?.currentStreak || 0,
            bestStreak: winnerUserStats?.bestStreak || 0
        });
        const loserPre = computePlayerProfile({
            ...(loserHistory || {}),
            mmr: loserSeason.mmr, rd: loserRD,
            currentStreak: loserUserStats?.currentStreak || 0,
            bestStreak: loserUserStats?.bestStreak || 0
        });

        // Predict post-game MMR (this game hasn't been saved yet)
        const winnerK = calculateKFactor(winnerRD);
        const loserK = calculateKFactor(loserRD);
        const mmrMult = mmrMultiplier(multiplier);
        const winnerPostMmr = Math.round(winnerSeason.mmr + winnerK * mmrMult);
        const loserPostMmr = Math.max(MIN_MMR, Math.round(loserSeason.mmr - loserK * mmrMult));
        const winnerPostRD = Math.max(MIN_RD, winnerRD - RD_DECREASE_PER_GAME);
        const loserPostRD = Math.max(MIN_RD, loserRD - RD_DECREASE_PER_GAME);

        const winnerPost = computePlayerProfile({
            ...(winnerHistory || {}),
            wins: (winnerHistory?.wins || 0) + 1,
            totalGames: (winnerHistory?.totalGames || 0) + 1,
            mmr: winnerPostMmr, rd: winnerPostRD
        });
        const loserPost = computePlayerProfile({
            ...(loserHistory || {}),
            losses: (loserHistory?.losses || 0) + 1,
            totalGames: (loserHistory?.totalGames || 0) + 1,
            mmr: loserPostMmr, rd: loserPostRD
        });

        const winnerCurrentStreak = Math.max(0, winnerPre.currentStreak) + 1;
        const loserCurrentStreak = Math.min(0, loserPre.currentStreak) - 1;
        const winnerMmrDiff = winnerPost.mmr - winnerPre.mmr;
        const loserMmrDiff = loserPost.mmr - loserPre.mmr;
        const multiplierLabel = multiplier > 1 ? ` [${multiplier}x]` : '';

        return {
            winner: { wins: winnerPost.wins, losses: winnerPost.losses },
            loser: { wins: loserPost.wins, losses: loserPost.losses },
            winnerRank: `${winnerPost.rank.emoji} ${winnerPost.rank.title}`,
            loserRank: `${loserPost.rank.emoji} ${loserPost.rank.title}`,
            winnerMmrChange: ` (${winnerPost.mmr} MMR, +${winnerMmrDiff}${multiplierLabel} ↑)`,
            loserMmrChange: ` (${loserPost.mmr} MMR, ${loserMmrDiff}${multiplierLabel} ↓)`,
            winnerStreak: winnerCurrentStreak,
            loserStreak: loserCurrentStreak
        };
    } catch (error) {
        console.error('Error building end game data:', error);
        return null;
    }
}

/**
 * Saves game result. Updates MMR, RD, streaks & metadata in DeathRollUserStats.
 * MMR uses Glicko-2 inspired system with K-factor scaled by Rating Deviation.
 */
async function saveGameResult(guildId, game, winnerId, loserId, winnerInfo, loserInfo, endReason) {
    const { statsCollection, gamesCollection } = getDeathrollCollections();
    const now = Date.now();
    const multiplier = game.timeoutMultiplier || 1;

    const [currentLoserStats, currentWinnerStats] = await Promise.all([
        statsCollection.findOne({ userId: loserId, guildId }),
        statsCollection.findOne({ userId: winnerId, guildId })
    ]);

    // Get season-aware MMR/RD, apply time decay
    const loserSeason = getSeasonMMR(currentLoserStats);
    const winnerSeason = getSeasonMMR(currentWinnerStats);
    const loserRD = applyTimeDecayRD(loserSeason.rd, currentLoserStats?.lastPlayedAt);
    const winnerRD = applyTimeDecayRD(winnerSeason.rd, currentWinnerStats?.lastPlayedAt);

    // Calculate MMR changes
    const loserK = calculateKFactor(loserRD);
    const winnerK = calculateKFactor(winnerRD);
    const mmrMult = mmrMultiplier(multiplier);
    const loserNewMmr = Math.max(MIN_MMR, Math.round(loserSeason.mmr - loserK * mmrMult));
    const winnerNewMmr = Math.round(winnerSeason.mmr + winnerK * mmrMult);
    const loserNewRD = Math.max(MIN_RD, loserRD - RD_DECREASE_PER_GAME);
    const winnerNewRD = Math.max(MIN_RD, winnerRD - RD_DECREASE_PER_GAME);

    const loserNewStreak = Math.min(0, currentLoserStats?.currentStreak || 0) - 1;
    const winnerNewStreak = Math.max(0, currentWinnerStats?.currentStreak || 0) + 1;
    const winnerBestStreak = Math.max(winnerNewStreak, currentWinnerStats?.bestStreak || 0);

    await statsCollection.findOneAndUpdate(
        { userId: loserId, guildId },
        {
            $set: {
                username: loserInfo.username, displayName: loserInfo.displayName,
                lastPlayedAt: now, lastOpponentId: winnerId, lastOpponentName: winnerInfo.username,
                lastGameResult: 'loss', lastStartingNumber: game.startingNumber, currentStreak: loserNewStreak,
                mmr: loserNewMmr, rd: loserNewRD, mmrSeason: config.DEATHROLL_SEASON
            },
            $setOnInsert: { createdAt: now, bestStreak: 0 }
        },
        { upsert: true }
    );

    await statsCollection.findOneAndUpdate(
        { userId: winnerId, guildId },
        {
            $set: {
                username: winnerInfo.username, displayName: winnerInfo.displayName,
                lastPlayedAt: now, lastOpponentId: loserId, lastOpponentName: loserInfo.username,
                lastGameResult: 'win', lastStartingNumber: game.startingNumber,
                currentStreak: winnerNewStreak, bestStreak: winnerBestStreak,
                mmr: winnerNewMmr, rd: winnerNewRD, mmrSeason: config.DEATHROLL_SEASON
            },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );

    const gameRecord = {
        gameId: `${guildId}_${game.messageId}`, guildId, channelId: game.channelId,
        initiatorId: game.initiator, initiatorName: game.initiatorName,
        opponentId: game.opponent, opponentName: game.opponentName,
        startingNumber: game.startingNumber, winnerId, winnerName: winnerInfo.username,
        loserId, loserName: loserInfo.username, rolls: game.rolls, totalRolls: game.rolls.length,
        startedAt: game.startedAt, endedAt: now, duration: now - game.startedAt,
        timeoutMultiplier: game.timeoutMultiplier || 1,
        season: config.DEATHROLL_SEASON
    };
    if (endReason) { gameRecord.endReason = endReason; }
    await gamesCollection.insertOne(gameRecord);
}

async function fetchTopRivals(guildId, userId, limit = 3) {
    try {
        const { gamesCollection } = getDeathrollCollections();
        const season = config.DEATHROLL_SEASON;
        return await gamesCollection.aggregate([
            { $match: { guildId, season, $or: [{ winnerId: userId }, { loserId: userId }] } },
            {
                $project: {
                    opponentId: { $cond: { if: { $eq: ['$winnerId', userId] }, then: '$loserId', else: '$winnerId' } },
                    opponentName: { $cond: { if: { $eq: ['$winnerId', userId] }, then: '$loserName', else: '$winnerName' } },
                    won: { $eq: ['$winnerId', userId] }
                }
            },
            { $group: { _id: '$opponentId', name: { $last: '$opponentName' }, games: { $sum: 1 }, winsAgainst: { $sum: { $cond: ['$won', 1, 0] } } } },
            { $sort: { games: -1 } },
            { $limit: limit }
        ]).toArray();
    } catch (error) {
        console.error('Error fetching top rivals:', error);
        return [];
    }
}

async function fetchLeaderboard(guildId, limit = 20) {
    try {
        const { statsCollection } = getDeathrollCollections();
        const [historyStats, userStatsList] = await Promise.all([
            aggregateAllPlayerStats(guildId),
            statsCollection.find({ guildId }).toArray()
        ]);

        if (historyStats.length === 0) {
            return { players: [], ranked: [], totalGamesPlayed: 0 };
        }

        const userStatsMap = new Map(userStatsList.map(s => [s.userId, s]));

        let ranked = historyStats
            .map(hs => {
                const us = userStatsMap.get(hs.userId) || {};
                const { mmr, rd } = getSeasonMMR(us);
                return {
                    userId: hs.userId,
                    profile: computePlayerProfile({
                        ...hs,
                        mmr, rd: applyTimeDecayRD(rd, us.lastPlayedAt),
                        currentStreak: us.currentStreak || 0,
                        bestStreak: us.bestStreak || 0
                    })
                };
            })
            .sort((a, b) => b.profile.mmr - a.profile.mmr);

        if (limit && limit > 0) {
            ranked = ranked.slice(0, limit);
        }

        // Each game has exactly one winner, so sum of wins = total games
        const totalGamesPlayed = historyStats.reduce((sum, p) => sum + p.wins, 0);
        return { players: historyStats, ranked, totalGamesPlayed };
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return { players: [], ranked: [], totalGamesPlayed: 0 };
    }
}

// ─── Message Formatting ───────────────────────────────────────────────

function formatGameMessage(game, lastRoll, lastRoller, lastRollerId, isGameOver, stats) {
    const timeoutMinutes = (game.timeoutMultiplier || 1) * 10;
    let content = `🎲 **Deathroll Game**${game.timeoutMultiplier > 1 ? ` 🎰 **${getMultiplierName(game.timeoutMultiplier).toUpperCase()} OR NOTHING (${timeoutMinutes}min timeout)**` : ''}\n`;

    if (stats && !isGameOver) {
        const initiatorRecord = stats.initiator ? formatStatsString(stats.initiator) : '';
        const opponentRecord = stats.opponent ? formatStatsString(stats.opponent) : '';
        content += `<@${game.initiator}>${initiatorRecord} vs <@${game.opponent}>${opponentRecord}\n`;
    } else {
        content += `<@${game.initiator}> vs <@${game.opponent}>\n`;
    }

    if (game.h2h && (game.h2h.player1Wins > 0 || game.h2h.player2Wins > 0)) {
        content += `-# H2H: <@${game.initiator}> ${game.h2h.player1Wins} - ${game.h2h.player2Wins} <@${game.opponent}>\n`;
    }

    content += `Starting number: **${game.startingNumber}**\n\n`;
    content += `**Roll History:**\n`;
    for (let i = 0; i < game.rolls.length; i++) {
        const roll = game.rolls[i];
        const clutch = roll.roll === 1 ? ' ⚡ **CLUTCH!**' : '';
        content += `-# ${i + 1}. <@${roll.userId}> rolled **${roll.roll}** (from 0-${roll.maxNumber})${clutch}\n`;
    }

    content += `\n`;

    if (isGameOver) {
        const winnerId = lastRollerId === game.initiator ? game.opponent : game.initiator;

        if (stats) {
            const biggestDrop = getBiggestDrop(game.rolls);
            content += `📊 **Game Stats**\n`;
            content += `-# Total rolls: ${game.rolls.length} · Biggest drop: ${biggestDrop.drop} (${biggestDrop.from} → ${biggestDrop.to})\n\n`;

            const winnerRank = stats.winnerRank || '';
            const loserRank = stats.loserRank || '';
            const winnerMmrChange = stats.winnerMmrChange || '';
            const loserMmrChange = stats.loserMmrChange || '';
            const winnerStreakStr = stats.winnerStreak ? ' · ' + formatStreak(stats.winnerStreak) : '';
            const loserStreakStr = stats.loserStreak ? ' · ' + formatStreak(stats.loserStreak) : '';

            content += `💀 <@${lastRollerId}> ${loserRank}${loserMmrChange} loses!${loserStreakStr}\n`;
            content += `🎉 <@${winnerId}> ${winnerRank}${winnerMmrChange} wins!${winnerStreakStr}`;
        } else {
            content += `💀 <@${lastRollerId}> loses!\n`;
            content += `🎉 <@${winnerId}> wins!`;
        }
    } else {
        const nextPlayerId = game.currentTurn;
        content += `Current number: **${game.currentNumber}**\n`;
        content += `<@${nextPlayerId}>, it's your turn!`;
    }

    return content;
}

// ─── Double or Nothing ────────────────────────────────────────────────

function buildDoubleOrNothingRow(game, winnerId, loserId) {
    const nextMultiplier = (game.timeoutMultiplier || 1) * 2;
    const nextTimeout = nextMultiplier * 10;
    const multiplierName = getMultiplierName(nextMultiplier);

    const donButton = new ButtonBuilder()
        .setCustomId(`deathroll_don_propose_${winnerId}_${loserId}_${game.startingNumber}_${nextMultiplier}`)
        .setLabel(`${multiplierName} or Nothing (${nextTimeout}min timeout)`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🎰');

    const row = new ActionRowBuilder().addComponents(donButton);
    return [row];
}

function createDoubleOrNothingCollector(message, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData) {
    const collector = message.createMessageComponentCollector({
        idle: 10 * 1000
    });

    let countdown = 10;
    const baseContent = message.content;
    const countdownInterval = setInterval(async () => {
        countdown--;
        if (countdown > 0) {
            await message.edit({
                content: baseContent + `\n-# ⏱️ **${countdown}** second${countdown !== 1 ? 's' : ''} remaining to propose...`
            }).catch(() => { });
        } else {
            clearInterval(countdownInterval);
        }
    }, 1000);

    collector.on('collect', async (buttonInteraction) => {
        clearInterval(countdownInterval);
        try {
            const userId = buttonInteraction.user.id;

            if (buttonInteraction.customId.startsWith('deathroll_don_propose_')) {
                if (userId !== loserId) {
                    return buttonInteraction.reply({ content: '🎲 Only the loser can propose Double or Nothing!', ephemeral: true });
                }

                collector.stop('manually stopped');

                const nextMultiplier = (timeoutMultiplier || 1) * 2;
                const nextTimeout = nextMultiplier * 10;
                const multiplierName = getMultiplierName(nextMultiplier);

                const acceptButton = new ButtonBuilder()
                    .setCustomId(`deathroll_don_accept_${winnerId}_${loserId}_${startingNumber}_${nextMultiplier}`)
                    .setLabel(`Accept ${multiplierName} or Nothing (${nextTimeout}min timeout)`)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅');

                const declineButton = new ButtonBuilder()
                    .setCustomId(`deathroll_don_decline_${winnerId}_${loserId}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌');

                const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);
                const currentTimeout = (timeoutMultiplier || 1) * 10;

                await buttonInteraction.update({
                    content: baseContent + `\n\n🎰 <@${loserId}> proposes **${multiplierName} or Nothing**! The ${currentTimeout}min timeout will be cancelled — but if they lose again, it's **${nextTimeout} minutes**.\n<@${winnerId}>, do you accept this high-risk challenge?`,
                    components: [row]
                });

                createAcceptDeclineCollector(buttonInteraction.message, guild, winnerId, loserId, startingNumber, nextMultiplier, pendingTimeoutData);
                return;
            }
        } catch (error) {
            console.error('Error in Double or Nothing propose collector:', error);
            try {
                const channel = buttonInteraction.channel;
                const recoveryNextMultiplier = (timeoutMultiplier || 1) * 2;
                const recoveryMultiplierName = getMultiplierName(recoveryNextMultiplier);
                const donButton = new ButtonBuilder()
                    .setCustomId(`deathroll_don_propose_${winnerId}_${loserId}_${startingNumber}_${recoveryNextMultiplier}`)
                    .setLabel(`${recoveryMultiplierName} or Nothing (${recoveryNextMultiplier * 10}min timeout)`)
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🎰');
                const row = new ActionRowBuilder().addComponents(donButton);
                const recoveryMsg = await channel.send({
                    content: `⚠️ Something went wrong! <@${loserId}>, click below to propose ${recoveryMultiplierName} or Nothing again.`,
                    components: [row]
                });
                createDoubleOrNothingCollector(recoveryMsg, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData);
            } catch (recoveryError) {
                console.error('Failed to recover from DoN propose error:', recoveryError);
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        clearInterval(countdownInterval);
        if (reason !== 'manually stopped') {
            const timeoutMinutes = (pendingTimeoutData?.timeoutDuration || BASE_TIMEOUT) / 60000;
            await message.edit({
                content: baseContent + `\n-# ⏱️ Time's up! <@${loserId}> has been timed out for ${timeoutMinutes} minutes.`,
                components: []
            }).catch(() => { });
            await applyPendingTimeout(guild, pendingTimeoutData);
        }
    });
}

function createAcceptDeclineCollector(message, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData) {
    const collector = message.createMessageComponentCollector({
        idle: 10 * 1000
    });

    let countdown = 10;
    const baseContent = message.content;
    const countdownInterval = setInterval(async () => {
        countdown--;
        if (countdown > 0) {
            await message.edit({
                content: baseContent + `\n-# ⏱️ **${countdown}** second${countdown !== 1 ? 's' : ''} remaining to accept or decline...`
            }).catch(() => { });
        } else {
            clearInterval(countdownInterval);
        }
    }, 1000);

    collector.on('collect', async (buttonInteraction) => {
        clearInterval(countdownInterval);
        try {
            const userId = buttonInteraction.user.id;

            if (buttonInteraction.customId.startsWith('deathroll_don_decline_')) {
                if (userId !== winnerId) {
                    return buttonInteraction.reply({ content: '🎲 Only the winner can accept or decline!', ephemeral: true });
                }

                collector.stop('manually stopped');
                await buttonInteraction.update({
                    content: baseContent + `\n\n❌ <@${winnerId}> declined the ${getMultiplierName(timeoutMultiplier)} or Nothing.`,
                    components: []
                });
                await applyPendingTimeout(guild, pendingTimeoutData);
                return;
            }

            if (buttonInteraction.customId.startsWith('deathroll_don_accept_')) {
                if (userId !== winnerId) {
                    return buttonInteraction.reply({ content: '🎲 Only the winner can accept or decline!', ephemeral: true });
                }

                collector.stop('manually stopped');

                const challengerMember = await guild.members.fetch(loserId).catch(() => null);
                const opponentMember = await guild.members.fetch(winnerId).catch(() => null);

                if (!challengerMember?.moderatable || !opponentMember?.moderatable) {
                    await buttonInteraction.update({ components: [] });
                    return buttonInteraction.followUp({ content: '🎲 One of the players can\'t be timed out anymore!', ephemeral: true });
                }

                await removePendingTimeout(guild, loserId);

                const h2h = await fetchHeadToHead(guild.id, loserId, winnerId);

                const gameId = `${buttonInteraction.channelId}_${buttonInteraction.id}`;
                const now = Date.now();

                activeGames.set(gameId, {
                    initiator: loserId,
                    initiatorName: challengerMember.user.username,
                    opponent: winnerId,
                    opponentName: opponentMember.user.username,
                    targetUserId: winnerId,
                    currentNumber: startingNumber,
                    currentTurn: winnerId,
                    messageId: buttonInteraction.message.id,
                    channelId: buttonInteraction.channelId,
                    startingNumber: startingNumber,
                    rolls: [],
                    startedAt: now,
                    currentMessageId: null,
                    timeoutMultiplier: timeoutMultiplier,
                    h2h: h2h
                });

                const roll = Math.floor(Math.random() * (startingNumber + 1));
                activeGames.get(gameId).rolls.push({
                    userId: winnerId, username: opponentMember.user.username, roll, maxNumber: startingNumber
                });

                await buttonInteraction.update({
                    content: baseContent + `\n\n✅ <@${winnerId}> accepted the **${getMultiplierName(timeoutMultiplier)} or Nothing**! 🎰`,
                    components: []
                });

                if (roll === 0) {
                    const game = activeGames.get(gameId);
                    const endGameData = await buildEndGameData(buttonInteraction.guild.id, game, loserId, winnerId);
                    const gameOverMsg = await buttonInteraction.followUp({
                        content: formatGameMessage(game, roll, opponentMember.user.username, winnerId, true, endGameData),
                        components: buildDoubleOrNothingRow(game, loserId, winnerId)
                    });
                    await handleLoss(buttonInteraction, game, winnerId, roll, gameOverMsg);
                    activeGames.delete(gameId);
                    return;
                }

                const game = activeGames.get(gameId);
                game.currentNumber = roll;
                game.currentTurn = loserId;

                const rollButton = new ButtonBuilder()
                    .setCustomId(`deathroll_roll_${gameId}`)
                    .setLabel(`Roll (0-${roll})`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎲');

                const row = new ActionRowBuilder().addComponents(rollButton);
                const midGameStats = await fetchMidGameStats(guild.id, loserId, winnerId);

                const newMessage = await buttonInteraction.followUp({
                    content: formatGameMessage(game, roll, opponentMember.user.username, winnerId, false, midGameStats),
                    components: [row]
                });

                game.currentMessageId = newMessage.id;
                createRollCollector(newMessage, gameId, guild);
            }
        } catch (error) {
            console.error('Error in Double or Nothing accept/decline collector:', error);
            try {
                const channel = buttonInteraction.channel;
                const recoveryMultiplierName = getMultiplierName(timeoutMultiplier);
                const acceptButton = new ButtonBuilder()
                    .setCustomId(`deathroll_don_accept_${winnerId}_${loserId}_${startingNumber}_${timeoutMultiplier}`)
                    .setLabel(`Accept ${recoveryMultiplierName} or Nothing (${timeoutMultiplier * 10}min timeout)`)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅');
                const declineButton = new ButtonBuilder()
                    .setCustomId(`deathroll_don_decline_${winnerId}_${loserId}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌');
                const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);
                const recoveryMsg = await channel.send({
                    content: `⚠️ Something went wrong! <@${winnerId}>, click below to accept or decline ${recoveryMultiplierName} or Nothing.`,
                    components: [row]
                });
                createAcceptDeclineCollector(recoveryMsg, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData);
            } catch (recoveryError) {
                console.error('Failed to recover from DoN accept/decline error:', recoveryError);
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        clearInterval(countdownInterval);
        if (reason !== 'manually stopped') {
            const timeoutMinutes = (pendingTimeoutData?.timeoutDuration || BASE_TIMEOUT) / 60000;
            await message.edit({
                content: baseContent + `\n-# ⏱️ Time's up! <@${loserId}> has been timed out for ${timeoutMinutes} minutes.`,
                components: []
            }).catch(() => { });
            await applyPendingTimeout(guild, pendingTimeoutData);
        }
    });
}

async function applyPendingTimeout(guild, pendingTimeoutData) {
    if (!pendingTimeoutData) return;
    const { loserId, timeoutDuration } = pendingTimeoutData;
    try {
        const loser = await guild.members.fetch(loserId).catch(() => null);
        if (loser && loser.moderatable) {
            const timeoutMinutes = timeoutDuration / 60000;
            await loser.timeout(timeoutDuration, `Lost a deathroll game (${timeoutMinutes}min) — Double or Nothing expired`);
        }
    } catch (error) {
        console.error('Error applying pending timeout:', error);
    }
}

async function removePendingTimeout(guild, userId) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.communicationDisabledUntil) {
            await member.timeout(null, 'Double or Nothing accepted — timeout cancelled');
        }
    } catch (error) {
        console.error('Error removing pending timeout:', error);
    }
}

// ─── Collectors ───────────────────────────────────────────────────────

function createRollCollector(message, gameId, guild) {
    const collector = message.createMessageComponentCollector({
        idle: 5 * 60 * 1000
    });

    activeCollectors.set(gameId, collector);

    collector.on('collect', async (buttonInteraction) => {
        try {
            await handleRollButton(buttonInteraction, gameId);
        } catch (error) {
            console.error('Error in roll collector:', error);
            try {
                const game = activeGames.get(gameId);
                if (!game) return;

                const channel = buttonInteraction.channel;
                const lastRoll = game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;
                const rollWasGenerated = lastRoll && lastRoll.userId === buttonInteraction.user.id;

                if (!rollWasGenerated) {
                    // Error before roll — re-post the existing roll button
                    const rollButton = new ButtonBuilder()
                        .setCustomId(`deathroll_roll_${gameId}`)
                        .setLabel(`Roll (0-${game.currentNumber})`)
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎲');
                    const row = new ActionRowBuilder().addComponents(rollButton);
                    const newMessage = await channel.send({
                        content: `⚠️ Something went wrong! <@${game.currentTurn}>, click below to roll again.`,
                        components: [row]
                    });
                    game.currentMessageId = newMessage.id;
                    createRollCollector(newMessage, gameId, buttonInteraction.guild);
                } else if (lastRoll.roll === 0) {
                    // Roll was 0 (game over) but display failed — recover via channel
                    const winnerId = lastRoll.userId === game.initiator ? game.opponent : game.initiator;
                    const endGameData = await buildEndGameData(buttonInteraction.guild.id, game, winnerId, lastRoll.userId);
                    const gameOverMsg = await channel.send({
                        content: formatGameMessage(game, lastRoll.roll, lastRoll.username, lastRoll.userId, true, endGameData),
                        components: buildDoubleOrNothingRow(game, winnerId, lastRoll.userId)
                    });
                    await handleLoss(buttonInteraction, game, lastRoll.userId, lastRoll.roll, gameOverMsg);
                    activeGames.delete(gameId);
                    activeCollectors.delete(gameId);
                } else {
                    // Roll was generated but display failed — update state and re-post
                    game.currentNumber = lastRoll.roll;
                    game.currentTurn = lastRoll.userId === game.initiator ? game.opponent : game.initiator;

                    const rollButton = new ButtonBuilder()
                        .setCustomId(`deathroll_roll_${gameId}`)
                        .setLabel(`Roll (0-${lastRoll.roll})`)
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎲');
                    const row = new ActionRowBuilder().addComponents(rollButton);
                    const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);
                    const newMessage = await channel.send({
                        content: formatGameMessage(game, lastRoll.roll, lastRoll.username, lastRoll.userId, false, midGameStats),
                        components: [row]
                    });
                    game.currentMessageId = newMessage.id;
                    createRollCollector(newMessage, gameId, buttonInteraction.guild);
                }
            } catch (recoveryError) {
                console.error('Failed to recover from roll error:', recoveryError);
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'manually stopped' && activeGames.has(gameId)) {
            const game = activeGames.get(gameId);

            if (game.opponent && game.currentTurn) {
                const loserId = game.currentTurn;
                const winnerId = loserId === game.initiator ? game.opponent : game.initiator;

                try {
                    await handleTimeoutLoss(guild, game, winnerId, loserId);
                    const timeoutMinutes = (game.timeoutMultiplier || 1) * 15;
                    await message.edit({
                        content: message.content + `\n\n⏱️ Game timed out! <@${loserId}> took too long to roll.\n💀 <@${loserId}> loses and has been timed out for ${timeoutMinutes} minutes!\n🎉 <@${winnerId}> wins!`,
                        components: []
                    }).catch(() => { });
                } catch (error) {
                    console.error('Error handling timeout loss:', error);
                    await message.edit({
                        content: message.content + '\n\n⏱️ Game timed out due to inactivity.',
                        components: []
                    }).catch(() => { });
                }
            } else {
                await message.edit({
                    content: message.content + '\n\n⏱️ Game timed out due to inactivity.',
                    components: []
                }).catch(() => { });
            }

            activeGames.delete(gameId);
            activeCollectors.delete(gameId);
        }
    });
}

// ─── Button Handlers ──────────────────────────────────────────────────

async function handleDeclineButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);
    if (!game) {
        return buttonInteraction.reply({ content: '🎲 This game is no longer active!', ephemeral: true });
    }

    const userId = buttonInteraction.user.id;

    if (game.targetUserId && userId !== game.targetUserId) {
        return buttonInteraction.reply({ content: '🎲 This challenge is not for you!', ephemeral: true });
    }

    if (game.opponent) {
        return buttonInteraction.reply({ content: '🎲 This game is already in progress!', ephemeral: true });
    }

    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    await buttonInteraction.update({
        content: `🎲 <@${game.initiator}>'s deathroll from **${game.startingNumber}** was denied by <@${buttonInteraction.user.id}>!`,
        components: []
    });

    activeGames.delete(gameId);
}

async function handleEngageButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);
    if (!game) {
        return buttonInteraction.reply({ content: '🎲 This game is no longer active!', ephemeral: true });
    }

    const userId = buttonInteraction.user.id;

    if (userId === game.initiator) {
        return buttonInteraction.reply({ content: '🎲 You can\'t play against yourself!', ephemeral: true });
    }

    if (game.targetUserId && userId !== game.targetUserId) {
        return buttonInteraction.reply({ content: '🎲 This challenge is not for you!', ephemeral: true });
    }

    if (game.opponent) {
        return buttonInteraction.reply({ content: '🎲 This game is already in progress!', ephemeral: true });
    }

    const guild = buttonInteraction.guild;
    const initiatorMember = await guild.members.fetch(game.initiator).catch(() => null);

    if (!initiatorMember) {
        await buttonInteraction.update({
            content: `🎲 <@${game.initiator}>'s deathroll has ended - they left the server!`,
            components: []
        });
        activeGames.delete(gameId);
        return;
    }

    const opponentMember = buttonInteraction.member;

    if (!initiatorMember.moderatable) {
        return buttonInteraction.reply({ content: `🎲 The game initiator can't be timed out (they have higher permissions)!`, ephemeral: true });
    }

    if (!opponentMember.moderatable) {
        return buttonInteraction.reply({ content: `🎲 You can't deathroll (you have higher permissions)!`, ephemeral: true });
    }

    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    game.opponent = userId;
    game.opponentName = buttonInteraction.user.username;
    game.currentTurn = userId;

    const h2h = await fetchHeadToHead(guild.id, game.initiator, userId);
    game.h2h = h2h;

    const roll = Math.floor(Math.random() * (game.currentNumber + 1));
    game.rolls.push({ userId, username: buttonInteraction.user.username, roll, maxNumber: game.currentNumber });

    await buttonInteraction.deferUpdate();
    await buttonInteraction.message.delete().catch(() => { });

    if (roll === 0) {
        const winnerId = game.initiator;
        const endGameData = await buildEndGameData(buttonInteraction.guild.id, game, winnerId, userId);
        const gameOverMsg = await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, endGameData),
            components: buildDoubleOrNothingRow(game, winnerId, userId)
        });
        await handleLoss(buttonInteraction, game, userId, roll, gameOverMsg);
        activeGames.delete(gameId);
        return;
    }

    game.currentNumber = roll;
    game.currentTurn = game.initiator;

    const rollButton = new ButtonBuilder()
        .setCustomId(`deathroll_roll_${gameId}`)
        .setLabel(`Roll (0-${roll})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎲');

    const row = new ActionRowBuilder().addComponents(rollButton);
    const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);

    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false, midGameStats),
        components: [row]
    });

    game.currentMessageId = newMessage.id;
    createRollCollector(newMessage, gameId, buttonInteraction.guild);
}

async function handleRollButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);
    if (!game) {
        return buttonInteraction.reply({ content: '🎲 This game is no longer active!', ephemeral: true });
    }

    const userId = buttonInteraction.user.id;

    if (userId !== game.currentTurn) {
        return buttonInteraction.reply({ content: '🎲 It\'s not your turn!', ephemeral: true });
    }

    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    const roll = Math.floor(Math.random() * (game.currentNumber + 1));
    game.rolls.push({ userId, username: buttonInteraction.user.username, roll, maxNumber: game.currentNumber });

    await buttonInteraction.update({ components: [] });

    const oldMessage = buttonInteraction.message;
    setTimeout(() => { oldMessage.delete().catch(() => { }); }, 500);

    if (roll === 0) {
        const winnerId = userId === game.initiator ? game.opponent : game.initiator;
        const endGameData = await buildEndGameData(buttonInteraction.guild.id, game, winnerId, userId);
        const gameOverMsg = await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, endGameData),
            components: buildDoubleOrNothingRow(game, winnerId, userId)
        });
        await handleLoss(buttonInteraction, game, userId, roll, gameOverMsg);
        activeGames.delete(gameId);
        activeCollectors.delete(gameId);
        return;
    }

    game.currentNumber = roll;
    const nextPlayer = userId === game.initiator ? game.opponent : game.initiator;
    game.currentTurn = nextPlayer;

    const rollButton = new ButtonBuilder()
        .setCustomId(`deathroll_roll_${gameId}`)
        .setLabel(`Roll (0-${roll})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎲');

    const row = new ActionRowBuilder().addComponents(rollButton);
    const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);

    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false, midGameStats),
        components: [row]
    });

    game.currentMessageId = newMessage.id;
    createRollCollector(newMessage, gameId, buttonInteraction.guild);
}

// ─── Game End Handler ─────────────────────────────────────────────────

async function handleLoss(buttonInteraction, game, loserId, roll, gameOverMessage) {
    const guild = buttonInteraction.guild;
    const loser = await guild.members.fetch(loserId);
    const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);
    const winnerId = loserId === game.initiator ? game.opponent : game.initiator;
    const winnerMember = await guild.members.fetch(winnerId);

    try {
        await saveGameResult(
            guild.id, game, winnerId, loserId,
            { username: winnerMember.user.username, displayName: winnerMember.displayName },
            { username: loser.user.username, displayName: loser.displayName }
        );

        if (gameOverMessage) {
            const pendingTimeoutData = { loserId, timeoutDuration };
            createDoubleOrNothingCollector(
                gameOverMessage, guild, winnerId, loserId,
                game.startingNumber, game.timeoutMultiplier || 1, pendingTimeoutData
            );
        } else {
            try {
                const timeoutMinutes = timeoutDuration / 60000;
                await loser.timeout(timeoutDuration, `Lost a deathroll game (${timeoutMinutes}min)`);
            } catch (error) {
                console.error('Error timing out user:', error);
            }
        }
    } catch (error) {
        console.error('Error saving deathroll to MongoDB:', error);
    }
}

async function handleTimeoutLoss(guild, game, winnerId, loserId) {
    const loser = await guild.members.fetch(loserId);
    const winnerMember = await guild.members.fetch(winnerId);
    const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);

    try {
        const timeoutMinutes = timeoutDuration / 60000;
        await loser.timeout(timeoutDuration, `Lost a deathroll game on timeout (${timeoutMinutes}min)`);
    } catch (error) {
        console.error('Error timing out user on timeout:', error);
    }

    await saveGameResult(
        guild.id, game, winnerId, loserId,
        { username: winnerMember.user.username, displayName: winnerMember.displayName },
        { username: loser.user.username, displayName: loser.displayName },
        'timeout'
    );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Exported Command Handlers ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * /deathroll command handler
 */
export async function executeDeathroll(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();
    const startingNumber = interaction.options.getInteger('number') || 100;
    const targetUser = interaction.options.getUser('opponent');

    await interaction.deferReply();

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return interaction.editReply({ content: '🎲 I don\'t have permission to timeout members!' });
    }

    if (!interaction.member.moderatable) {
        return interaction.editReply({ content: '🎲 You can\'t be timed out (you have higher permissions), so you can\'t play deathroll!' });
    }

    let targetMember = null;
    if (targetUser) {
        if (targetUser.id === userId) {
            return interaction.editReply({ content: '🎲 You can\'t challenge yourself!', ephemeral: true });
        }
        if (targetUser.bot) {
            return interaction.editReply({ content: '🎲 You can\'t challenge a bot!', ephemeral: true });
        }

        targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: '🎲 That user is not in this server!', ephemeral: true });
        }
        if (!targetMember.moderatable) {
            return interaction.editReply({ content: '🎲 That user can\'t be timed out (they have higher permissions)!', ephemeral: true });
        }
    }

    const guildId = interaction.guild.id;
    const initiatorStats = await fetchSinglePlayerStats(guildId, userId);
    const targetStats = targetUser ? await fetchSinglePlayerStats(guildId, targetUser.id) : null;

    const buttonLabel = targetUser && targetMember
        ? `Accept Deathroll ${targetMember.displayName} (0-${startingNumber})`
        : `Accept Deathroll (0-${startingNumber})`;

    const engageButton = new ButtonBuilder()
        .setCustomId(`deathroll_engage_${interaction.id}`)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🎲');

    const declineButton = new ButtonBuilder()
        .setCustomId(`deathroll_decline_${interaction.id}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(engageButton, declineButton);

    const initiatorRecord = formatStatsString(initiatorStats);
    let content = `🎲 <@${interaction.user.id}>${initiatorRecord} has started a deathroll from **${startingNumber}**!\n\n`;

    if (targetUser) {
        const targetRecord = formatStatsString(targetStats);
        content += `<@${targetUser.id}>${targetRecord}, you have been challenged!\n` +
            `Click the button below to accept or decline! The loser gets timed out for 10 minutes.`;
    } else {
        content += `Click the button below to engage! The loser gets timed out for 10 minutes.`;
    }

    const reply = await interaction.editReply({ content, components: [row] });

    const gameId = `${interaction.channelId}_${interaction.id}`;
    activeGames.set(gameId, {
        initiator: interaction.user.id,
        initiatorName: interaction.user.username,
        opponent: null, opponentName: null,
        targetUserId: targetUser ? targetUser.id : null,
        currentNumber: startingNumber, currentTurn: null,
        messageId: reply.id, channelId: interaction.channelId,
        startingNumber: startingNumber, rolls: [],
        startedAt: now, currentMessageId: reply.id,
        timeoutMultiplier: 1
    });

    const collector = reply.createMessageComponentCollector({ idle: 5 * 60 * 1000 });
    activeCollectors.set(gameId, collector);

    collector.on('collect', async (buttonInteraction) => {
        try {
            if (buttonInteraction.customId.startsWith('deathroll_engage_')) {
                await handleEngageButton(buttonInteraction, gameId);
            } else if (buttonInteraction.customId.startsWith('deathroll_decline_')) {
                await handleDeclineButton(buttonInteraction, gameId);
            }
        } catch (error) {
            console.error('Error in deathroll engage/decline collector:', error);
            try {
                const game = activeGames.get(gameId);
                if (!game) return;

                const channel = buttonInteraction.channel;
                const lastRoll = game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;

                if (game.opponent && lastRoll) {
                    // Engage happened, roll was generated but display failed — recover via channel
                    if (lastRoll.roll === 0) {
                        const winnerId = game.initiator;
                        const endGameData = await buildEndGameData(buttonInteraction.guild.id, game, winnerId, lastRoll.userId);
                        const gameOverMsg = await channel.send({
                            content: formatGameMessage(game, lastRoll.roll, lastRoll.username, lastRoll.userId, true, endGameData),
                            components: buildDoubleOrNothingRow(game, winnerId, lastRoll.userId)
                        });
                        await handleLoss(buttonInteraction, game, lastRoll.userId, lastRoll.roll, gameOverMsg);
                        activeGames.delete(gameId);
                    } else {
                        game.currentNumber = lastRoll.roll;
                        game.currentTurn = game.initiator;

                        const rollButton = new ButtonBuilder()
                            .setCustomId(`deathroll_roll_${gameId}`)
                            .setLabel(`Roll (0-${lastRoll.roll})`)
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('🎲');
                        const row = new ActionRowBuilder().addComponents(rollButton);
                        const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);
                        const newMessage = await channel.send({
                            content: formatGameMessage(game, lastRoll.roll, lastRoll.username, lastRoll.userId, false, midGameStats),
                            components: [row]
                        });
                        game.currentMessageId = newMessage.id;
                        createRollCollector(newMessage, gameId, buttonInteraction.guild);
                    }
                } else {
                    // Error before game started — re-post engage/decline buttons
                    const buttonLabel = game.targetUserId
                        ? `Accept Deathroll (0-${game.startingNumber})`
                        : `Accept Deathroll (0-${game.startingNumber})`;
                    const engageButton = new ButtonBuilder()
                        .setCustomId(`deathroll_engage_${gameId.split('_')[1]}`)
                        .setLabel(buttonLabel)
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🎲');
                    const declineButton = new ButtonBuilder()
                        .setCustomId(`deathroll_decline_${gameId.split('_')[1]}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('❌');
                    const row = new ActionRowBuilder().addComponents(engageButton, declineButton);
                    const recoveryMsg = await channel.send({
                        content: `⚠️ Something went wrong! Click below to accept or decline the deathroll challenge from <@${game.initiator}>.`,
                        components: [row]
                    });
                    game.currentMessageId = recoveryMsg.id;
                    const newCollector = recoveryMsg.createMessageComponentCollector({ idle: 5 * 60 * 1000 });
                    activeCollectors.set(gameId, newCollector);
                    newCollector.on('collect', async (bi) => {
                        try {
                            if (bi.customId.startsWith('deathroll_engage_')) {
                                await handleEngageButton(bi, gameId);
                            } else if (bi.customId.startsWith('deathroll_decline_')) {
                                await handleDeclineButton(bi, gameId);
                            }
                        } catch (e) {
                            console.error('Error in recovery engage/decline collector:', e);
                        }
                    });
                    newCollector.on('end', (collected, reason) => {
                        if (reason !== 'manually stopped' && activeGames.has(gameId)) {
                            const g = activeGames.get(gameId);
                            if (!g.opponent) {
                                recoveryMsg.edit({ content: `🎲 <@${g.initiator}>'s deathroll expired - no one engaged!`, components: [] }).catch(() => { });
                            }
                            activeGames.delete(gameId);
                            activeCollectors.delete(gameId);
                        }
                    });
                }
            } catch (recoveryError) {
                console.error('Failed to recover from engage/decline error:', recoveryError);
            }
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason !== 'manually stopped') {
            if (activeGames.has(gameId)) {
                const game = activeGames.get(gameId);
                if (!game.opponent) {
                    interaction.editReply({
                        content: `🎲 <@${game.initiator}>'s deathroll expired - no one engaged!`,
                        components: []
                    }).catch(() => { });
                }
                activeGames.delete(gameId);
            }
            activeCollectors.delete(gameId);
        }
    });
}

/**
 * /deathrollstats command handler
 */
export async function executeDeathrollStats(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    await interaction.deferReply();

    try {
        const profile = await fetchSinglePlayerStats(guildId, targetUser.id);

        const embed = new EmbedBuilder()
            .setTitle(`🎲 Deathroll Stats · Season ${config.DEATHROLL_SEASON}`)
            .setColor(0xE74C3C)
            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
            .setTimestamp();

        if (!profile || profile.totalGames === 0) {
            embed.setDescription(`<@${targetUser.id}> hasn't played any deathroll games yet!`);
            return interaction.editReply({ embeds: [embed] });
        }

        const mostPlayed = await fetchTopRivals(guildId, targetUser.id, 3);

        let description = `## ${profile.rank.emoji} ${profile.rank.title}\n`;
        description += `**${profile.mmr}** MMR\n\n`;
        description += `**Record:** ${profile.wins}W / ${profile.losses}L (${profile.winRate}%)\n`;
        description += `**Games Played:** ${profile.totalGames}\n`;

        const streakStr = formatStreak(profile.currentStreak);
        description += `**Rank Confidence:** ${profile.confidence}%\n`;
        description += `**Current Streak:** ${streakStr || 'None'}\n`;
        description += `**Best Win Streak:** ${profile.bestStreak > 0 ? `🔥×${profile.bestStreak}` : 'None'}\n`;

        if (profile.multiplierGames > 0) {
            description += `**Double or Nothing:** ${profile.multiplierWins}W / ${profile.multiplierLosses}L\n`;
        }

        if (profile.lastPlayedAt) {
            description += `**Last Played:** <t:${Math.floor(profile.lastPlayedAt / 1000)}:R>\n`;
        }
        if (profile.createdAt) {
            description += `**First Game:** <t:${Math.floor(profile.createdAt / 1000)}:D>\n`;
        }

        embed.setDescription(description);

        if (mostPlayed.length > 0) {
            const rivalLines = mostPlayed.map((opp, i) => {
                const lossesAgainst = opp.games - opp.winsAgainst;
                return `**${i + 1}.** <@${opp._id}> — ${opp.games} games (${opp.winsAgainst}W / ${lossesAgainst}L)`;
            });
            embed.addFields({ name: '⚔️ Top Rivals', value: rivalLines.join('\n') });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching deathroll stats:', error);
        await interaction.editReply({ content: 'An error occurred while fetching stats. Please try again later.' });
    }
}

/**
 * /deathrollleaderboard command handler
 */
export async function executeDeathrollLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const { ranked, totalGamesPlayed } = await fetchLeaderboard(interaction.guildId, 0);

        const embed = new EmbedBuilder()
            .setTitle(`🎲 Deathroll Leaderboard · Season ${config.DEATHROLL_SEASON}`)
            .setColor(0xE74C3C)
            .setTimestamp();

        if (!ranked || ranked.length === 0) {
            embed.setDescription('No deathroll games have been played yet!');
            return interaction.editReply({ embeds: [embed] });
        }

        let topPlayers = ranked.slice(0, 10);
        let bottomPlayers = ranked.length > 10 ? ranked.slice(Math.max(10, ranked.length - 10)) : [];

        const formatPlayerLine = (player) => {
            const index = ranked.indexOf(player);
            const medal = getMedal(index);
            const p = player.profile;
            const streak = formatStreak(p.currentStreak);
            const lastPlayed = p.lastPlayedAt
                ? `<t:${Math.floor(p.lastPlayedAt / 1000)}:R>`
                : 'Never';
            const don = p.multiplierGames > 0 ? ` · 🎰 ${p.multiplierWins}W/${p.multiplierLosses}L` : '';

            return `${medal} **${index + 1}.** <@${player.userId}> — ${p.rank.emoji} **${p.mmr}** MMR (${p.confidence}%)\n-# ${p.wins}W / ${p.losses}L (${p.winRate}%) · ${p.totalGames} games${streak ? ' · ' + streak : ''}${don} · ${lastPlayed}`;
        };

        const topLines = topPlayers.map(formatPlayerLine);
        const bottomLines = bottomPlayers.map(formatPlayerLine);

        let finalDescription = `**Players:** ${ranked.length} · **Total Games Played:** ${totalGamesPlayed}\nRanked by MMR.\n\n`;
        finalDescription += `**🏆 Top 10**\n` + topLines.join('\n');

        if (bottomLines.length > 0) {
            finalDescription += `\n\n**💀 Bottom 10**\n` + bottomLines.join('\n');
        }

        finalDescription += `\n\n-# 🔥×N Win streak · 💀×N Loss streak · 🎰 Double or Nothing`;

        embed.setDescription(finalDescription);

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching deathroll leaderboard:', error);
        await interaction.editReply({ content: 'An error occurred while fetching the deathroll leaderboard. Please try again later.' });
    }
}


