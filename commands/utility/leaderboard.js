const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const MongoWrapper = require('../../wrappers/MongoWrapper.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows message leaderboard for a specified time period')
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
                .setDescription('Channel to check (default: current channel)')
                .setRequired(false)),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");

        await interaction.deferReply();

        // Get time parameters
        const years = interaction.options.getInteger('years') || 0;
        const months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;
        const channel = interaction.options.getChannel('channel');

        if (years === 0 && months === 0 && days === 0) {
            days = 7;
        }

        // Calculate start date
        const now = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(startDate.getDate() - days);
        const unixStartDate = Math.floor(startDate.getTime());

        const match = {
            createdTimestamp: { $gte: unixStartDate },
            guildId: interaction.guildId
        }

        if (channel) {
            match.channelId = channel.id;
        }

        try {
            // Use aggregation pipeline for efficiency
            const [result] = await messagesCollection.aggregate([
                // Match messages in channel and time period
                {
                    $match: match
                },
                {
                    $facet: {
                        // Get total message count (including bots)
                        totalCount: [
                            { $count: 'total' }
                        ],
                        // Get user statistics (non-bots only)
                        userStats: [
                            {
                                $match: {
                                    'author.bot': { $ne: true }
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
                                $limit: 10
                            }
                        ],
                        // Get overall statistics
                        allUserStats: [
                            {
                                $match: {
                                    'author.bot': { $ne: true }
                                }
                            },
                            {
                                $group: {
                                    _id: '$author.id',
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalUsers: { $sum: 1 },
                                    totalMessages: { $sum: '$count' },
                                    avgMessages: { $avg: '$count' }
                                }
                            }
                        ]
                    }
                }
            ]).toArray();

            const totalMessages = result.totalCount[0]?.total || 0;
            const sortedUsers = result.userStats || [];
            const stats = result.allUserStats[0] || { totalUsers: 0, avgMessages: 0 };

            let description = `**Time Period:** ${formatTimePeriod(years, months, days)}\n**Channel:** ${channel ? channel.toString() : 'All Channels'}\n**Total Messages:** ${totalMessages}\n\n`;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`📊 Message Leaderboard`)
                .setDescription(description)
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}` });

            // Add leaderboard fields
            if (sortedUsers.length === 0) {
                embed.addFields({
                    name: 'No Messages',
                    value: 'No messages found in the specified time period.'
                });
            } else {
                const leaderboardText = sortedUsers
                    .map((user, index) => {
                        const medal = getMedal(index);
                        return `${medal} **${index + 1}.** ${user.username} - **${user.count}** messages`;
                    })
                    .join('\n');

                embed.addFields({
                    name: 'Top Contributors',
                    value: leaderboardText
                });

                embed.addFields({
                    name: '📈 Statistics',
                    value: `**Active Users:** ${stats.totalUsers}\n**Average Messages/User:** ${stats.avgMessages.toFixed(1)}`
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching the leaderboard. Please try again later.'
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

    if (parts.length === 0) return 'Last 7 days (default)';
    return 'Last ' + parts.join(', ');
}

// Helper function to get medal emoji for top 3
function getMedal(index) {
    switch (index) {
        case 0: return '🥇';
        case 1: return '🥈';
        case 2: return '🥉';
        default: return '  ';
    }
}
