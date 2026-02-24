import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';
import { calculateMMR, getRankTitle, formatStreak } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathrollleaderboard')
        .setDescription('Shows the top 20 deathroll players and their stats'),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const deathrollsCollection = db.collection('DeathRollUserStats');

        await interaction.deferReply();

        try {
            const allPlayers = await deathrollsCollection
                .find({ guildId: interaction.guildId })
                .toArray();

            const embed = new EmbedBuilder()
                .setTitle('🎲 Deathroll Leaderboard')
                .setColor(0xE74C3C)
                .setTimestamp();

            if (allPlayers.length === 0) {
                embed.setDescription('No deathroll games have been played yet!');
                return interaction.editReply({ embeds: [embed] });
            }

            // Compute MMR and sort
            const ranked = allPlayers
                .map(p => ({ ...p, mmr: calculateMMR(p) }))
                .sort((a, b) => b.mmr - a.mmr)
                .slice(0, 20);

            // Compute server-wide stats
            const totalGamesPlayed = allPlayers.reduce((sum, p) => sum + (p.totalGames || 0), 0);

            const leaderboardLines = ranked.map((player, index) => {
                const medal = getMedal(index);
                const wins = player.wins || 0;
                const losses = player.losses || 0;
                const total = player.totalGames || (wins + losses);
                const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
                const rank = getRankTitle(player.mmr);
                const streak = formatStreak(player.currentStreak);
                const lastPlayed = player.lastPlayedAt
                    ? `<t:${Math.floor(player.lastPlayedAt / 1000)}:R>`
                    : 'Never';

                return `${medal} **${index + 1}.** <@${player.userId}> — ${rank.emoji} **${player.mmr}** MMR\n-# ${wins}W / ${losses}L (${winRate}%) · ${total} games${streak ? ' · ' + streak : ''} · ${lastPlayed}`;
            });

            embed.setDescription(
                `**Players:** ${allPlayers.length} · **Total Games Played:** ${Math.floor(totalGamesPlayed / 2)}\n` +
                `Ranked by MMR. Showing top ${ranked.length} player${ranked.length !== 1 ? 's' : ''}.\n\n` +
                leaderboardLines.join('\n') +
                `\n\n-# 🔥×N Win streak · 💀×N Loss streak`
            );

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching deathroll leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching the deathroll leaderboard. Please try again later.'
            });
        }
    }
};

function getMedal(index) {
    switch (index) {
        case 0: return '🥇';
        case 1: return '🥈';
        case 2: return '🥉';
        default: return '  ';
    }
}
