import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import MongoWrapper from '../../wrappers/MongoWrapper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mentions')
        .setDescription('Shows top 5 users who have mentioned a specific user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check mentions for')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('years')
                .setDescription('Number of years to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(7))
        .addIntegerOption(option =>
            option.setName('months')
                .setDescription('Number of months to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(12))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Number of days to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(31))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to check (default: all channels)')
                .setRequired(false)),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");


        const serverAgeInDays = Math.floor((Date.now() - interaction.guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        const serverAgeInMonths = Math.floor(serverAgeInDays / 30);
        const serverAgeInYears = Math.floor(serverAgeInDays / 365);

        await interaction.deferReply();

        // Get parameters
        const targetUser = interaction.options.getUser('user');
        let years = interaction.options.getInteger('years') || 0;
        const months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;
        const channel = interaction.options.getChannel('channel');

        if (years === 0 && months === 0 && days === 0) {
            years = serverAgeInYears;
        }

        // Calculate start date
        const now = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(startDate.getDate() - days);
        const unixStartDate = Math.floor(startDate.getTime());

        // Build match query
        const match = {
            createdTimestamp: { $gte: unixStartDate },
            guildId: interaction.guildId,
            'mentions.users': {
                $elemMatch: { id: targetUser.id }
            }
        };

        if (channel) {
            match.channelId = channel.id;
        }

        try {
            // Use aggregation pipeline
            const [result] = await messagesCollection.aggregate([
                {
                    $match: match
                },
                {
                    $facet: {
                        // Get top mentioners (non-bots only)
                        topMentioners: [
                            {
                                $match: {
                                    'author.bot': { $ne: true },
                                    'author.id': { $ne: targetUser.id } // Exclude self-mentions
                                }
                            },
                            {
                                $group: {
                                    _id: '$author.id',
                                    username: { $first: '$author.username' },
                                    avatar: { $first: '$author.defaultAvatarURL' },
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $sort: { count: -1 }
                            },
                            {
                                $limit: 5
                            }
                        ],
                        // Get total statistics
                        stats: [
                            {
                                $match: {
                                    'author.bot': { $ne: true }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalMentions: { $sum: 1 },
                                    uniqueMentioners: { $addToSet: '$author.id' }
                                }
                            },
                            {
                                $project: {
                                    totalMentions: 1,
                                    uniqueMentioners: { $size: '$uniqueMentioners' }
                                }
                            }
                        ]
                    }
                }
            ]).toArray();

            const topMentioners = result.topMentioners || [];
            const stats = result.stats[0] || { totalMentions: 0, uniqueMentioners: 0 };

            let description = `**User:** ${targetUser.toString()}\n**Time Period:** ${formatTimePeriod(years, months, days)}\n**Channel:** ${channel ? channel.toString() : 'All Channels'}\n**Total Mentions:** ${stats.totalMentions}\n\n`;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`💬 Mention Leaderboard`)
                .setDescription(description)
                .setColor(0x5865F2)
                .setTimestamp()
                .setFooter({ text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}` });

            // Set thumbnail to target user's avatar
            if (targetUser.displayAvatarURL) {
                embed.setThumbnail(targetUser.displayAvatarURL());
            }

            // Add leaderboard fields
            if (topMentioners.length === 0) {
                embed.addFields({
                    name: 'No Mentions',
                    value: `No one has mentioned ${targetUser.username} in the specified time period.`
                });
            } else {
                const leaderboardText = topMentioners
                    .map((user, index) => {
                        const medal = getMedal(index);
                        const percentage = ((user.count / stats.totalMentions) * 100).toFixed(1);
                        return `${medal} **${index + 1}.** ${user.username} - **${user.count}** mentions (${percentage}%)`;
                    })
                    .join('\n');

                embed.addFields({
                    name: 'Top Mentioners',
                    value: leaderboardText
                });

                embed.addFields({
                    name: '📈 Statistics',
                    value: `**Unique Mentioners:** ${stats.uniqueMentioners}\n**Average Mentions per User:** ${(stats.totalMentions / stats.uniqueMentioners).toFixed(1)}`
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching mention leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching the mention leaderboard. Please try again later.'
            });
        }
    }
};

// Helper function to format time period
function formatTimePeriod(years, months, days) {
    const parts = [];
    if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

    if (parts.length === 0) return 'Last 30 days (default)';
    return 'Last ' + parts.join(', ');
}

// Helper function to get medal emoji for top 5
function getMedal(index) {
    switch (index) {
        case 0: return '🥇';
        case 1: return '🥈';
        case 2: return '🥉';
        case 3: return '🏅';
        case 4: return '🏅';
        default: return '  ';
    }
}
