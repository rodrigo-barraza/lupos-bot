import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';
import { calculateMMR, getRankTitle, formatStreak } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathrollstats')
        .setDescription('View deathroll stats for a player')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to view stats for (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guildId;

        await interaction.deferReply();

        try {
            const localMongo = MongoWrapper.getClient('local');
            const db = localMongo.db('lupos');
            const statsCollection = db.collection('DeathRollUserStats');
            const gamesCollection = db.collection('DeathRollGameHistory');

            const playerStats = await statsCollection.findOne({ userId: targetUser.id, guildId });

            const embed = new EmbedBuilder()
                .setTitle(`🎲 Deathroll Stats`)
                .setColor(0xE74C3C)
                .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                .setTimestamp();

            if (!playerStats) {
                embed.setDescription(`<@${targetUser.id}> hasn't played any deathroll games yet!`);
                return interaction.editReply({ embeds: [embed] });
            }

            const wins = playerStats.wins || 0;
            const losses = playerStats.losses || 0;
            const total = playerStats.totalGames || (wins + losses);
            const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
            const mmr = calculateMMR(playerStats);
            const rank = getRankTitle(mmr);
            const currentStreak = playerStats.currentStreak || 0;
            const bestStreak = playerStats.bestStreak || 0;

            // Find most-played opponent
            const mostPlayed = await gamesCollection.aggregate([
                {
                    $match: {
                        guildId,
                        $or: [
                            { winnerId: targetUser.id },
                            { loserId: targetUser.id }
                        ]
                    }
                },
                {
                    $project: {
                        opponentId: {
                            $cond: {
                                if: { $eq: ['$winnerId', targetUser.id] },
                                then: '$loserId',
                                else: '$winnerId'
                            }
                        },
                        opponentName: {
                            $cond: {
                                if: { $eq: ['$winnerId', targetUser.id] },
                                then: '$loserName',
                                else: '$winnerName'
                            }
                        },
                        won: { $eq: ['$winnerId', targetUser.id] }
                    }
                },
                {
                    $group: {
                        _id: '$opponentId',
                        name: { $last: '$opponentName' },
                        games: { $sum: 1 },
                        winsAgainst: { $sum: { $cond: ['$won', 1, 0] } }
                    }
                },
                { $sort: { games: -1 } },
                { $limit: 3 }
            ]).toArray();

            // Build description
            let description = `## ${rank.emoji} ${rank.title}\n`;
            description += `**${mmr}** MMR\n\n`;

            description += `**Record:** ${wins}W / ${losses}L (${winRate}%)\n`;
            description += `**Games Played:** ${total}\n`;

            const streakStr = formatStreak(currentStreak);
            description += `**Current Streak:** ${streakStr || 'None'}\n`;
            description += `**Best Win Streak:** ${bestStreak > 0 ? `🔥×${bestStreak}` : 'None'}\n`;

            if (playerStats.lastPlayedAt) {
                description += `**Last Played:** <t:${Math.floor(playerStats.lastPlayedAt / 1000)}:R>\n`;
            }
            if (playerStats.createdAt) {
                description += `**First Game:** <t:${Math.floor(playerStats.createdAt / 1000)}:D>\n`;
            }

            embed.setDescription(description);

            // Most played opponents
            if (mostPlayed.length > 0) {
                const rivalLines = mostPlayed.map((opp, i) => {
                    const lossesAgainst = opp.games - opp.winsAgainst;
                    return `**${i + 1}.** <@${opp._id}> — ${opp.games} games (${opp.winsAgainst}W / ${lossesAgainst}L)`;
                });

                embed.addFields({
                    name: '⚔️ Top Rivals',
                    value: rivalLines.join('\n')
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching deathroll stats:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching stats. Please try again later.'
            });
        }
    }
};
