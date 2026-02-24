/**
 * Shared utilities for deathroll commands.
 */

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

/**
 * Elo-style MMR: base 1000, +25 per net win, scaled by a confidence
 * multiplier that ramps from 0.5 to 1.0 over the first 10 games.
 */
export function calculateMMR(player) {
    const wins = player.wins || 0;
    const losses = player.losses || 0;
    const total = player.totalGames || (wins + losses);
    const confidence = Math.min(total / 10, 1) * 0.5 + 0.5;
    return Math.round(1000 + (wins - losses) * 25 * confidence);
}

/**
 * Returns { title, emoji } for the given MMR value.
 */
export function getRankTitle(mmr) {
    const tier = RANK_TIERS.find(t => mmr >= t.min);
    return tier || RANK_TIERS[RANK_TIERS.length - 1];
}

/**
 * Formats a compact stats string like " (5W/3L 63%)"
 */
export function formatStatsString(stats) {
    if (!stats) return '';
    const { wins, losses } = stats;
    const total = wins + losses;
    const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return ` (${wins}W/${losses}L ${winrate}%)`;
}

/**
 * Formats a streak display like "🔥×3" or "💀×2"
 */
export function formatStreak(currentStreak) {
    if (!currentStreak || currentStreak === 0) return '';
    if (currentStreak > 0) return `🔥×${currentStreak}`;
    return `💀×${Math.abs(currentStreak)}`;
}
