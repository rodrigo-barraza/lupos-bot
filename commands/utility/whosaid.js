import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import MongoWrapper from '../../wrappers/MongoWrapper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('whosaid')
        .setDescription('Shows who used a specific word/phrase the most')
        .addStringOption(option =>
            option.setName('word')
                .setDescription('Word or phrase to search for')
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
                .setMaxValue(31)),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");

        const serverAgeInDays = Math.floor((Date.now() - interaction.guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        const serverAgeInMonths = Math.floor(serverAgeInDays / 30);
        const serverAgeInYears = Math.floor(serverAgeInDays / 365);

        await interaction.deferReply();

        // Get parameters
        const searchWord = interaction.options.getString('word');
        let years = interaction.options.getInteger('years') || 0;
        const months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;
        const channel = interaction.options.getChannel('channel');
        const caseSensitive = interaction.options.getBoolean('case_sensitive') || false;

        if (years === 0 && months === 0 && days === 0) {
            years = serverAgeInYears + 1;
        }

        // Calculate start date
        const now = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(startDate.getDate() - days);
        const unixStartDate = Math.floor(startDate.getTime());

        // Escape regex special characters
        const escapedWord = searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // List of usernames to ignore
        const ignoredUsernames = ['kaynmont', 'z1gst3r', 'fallendna', 'lam_skin'];

        const baseMatch = {
            createdTimestamp: { $gte: unixStartDate },
            guildId: interaction.guildId,
            'author.bot': { $ne: true },
            'author.displayName': { $ne: 'Deleted User' },
            'author.username': { $nin: ignoredUsernames } // Exclude specified usernames
        };

        if (channel) {
            baseMatch.channelId = channel.id;
        }

        try {
            // Use aggregation pipeline to get both word usage and total messages
            const [result] = await messagesCollection.aggregate([
                {
                    $match: baseMatch
                },
                {
                    $facet: {
                        // Get word usage per user
                        wordUsage: [
                            {
                                $match: {
                                    content: {
                                        $regex: escapedWord,
                                        $options: caseSensitive ? '' : 'i'
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: '$author.id',
                                    username: { $first: '$author.username' },
                                    avatar: { $first: '$author.defaultAvatarURL' },
                                    wordCount: { $sum: 1 }
                                }
                            }
                        ],
                        // Get total messages per user
                        totalMessages: [
                            {
                                $group: {
                                    _id: '$author.id',
                                    totalCount: { $sum: 1 }
                                }
                            }
                        ],
                        // Get total word usage count
                        totalWordCount: [
                            {
                                $match: {
                                    content: {
                                        $regex: escapedWord,
                                        $options: caseSensitive ? '' : 'i'
                                    }
                                }
                            },
                            {
                                $count: 'total'
                            }
                        ]
                    }
                }
            ]).toArray();

            const totalMessages = result.totalWordCount[0]?.total || 0;

            // Create maps for easy lookup
            const totalMessagesMap = new Map(
                result.totalMessages.map(u => [u._id, u.totalCount])
            );

            // Combine word usage with total messages and calculate percentages
            const combined = result.wordUsage.map(user => ({
                ...user,
                totalMessages: totalMessagesMap.get(user._id) || 0,
                usagePercentage: ((user.wordCount / (totalMessagesMap.get(user._id) || 1)) * 100)
            }));

            // Sort by word count and get top 10
            combined.sort((a, b) => b.wordCount - a.wordCount);
            const sortedUsers = combined.slice(0, 10);

            // Calculate overall stats
            const totalUsers = result.wordUsage.length;
            const avgMessages = totalUsers > 0 ? totalMessages / totalUsers : 0;

            let description = `**Word/Phrase:** "${searchWord}"\n**Time Period:** ${formatTimePeriod(years, months, days)}\n**Channel:** ${channel ? channel.toString() : 'All Channels'}\n**Total Uses:** ${totalMessages.toLocaleString()}\n\n`;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Word Usage Leaderboard`)
                .setDescription(description)
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}` });

            // Add leaderboard fields
            if (sortedUsers.length === 0) {
                embed.addFields({
                    name: 'No Results',
                    value: `No one used "${searchWord}" in the specified time period.`
                });
            } else {
                const leaderboardText = sortedUsers
                    .map((user, index) => {
                        const medal = getMedal(index);
                        const percentage = ((user.wordCount / totalMessages) * 100).toFixed(1);
                        const userUsagePercentage = user.usagePercentage.toFixed(2);
                        return `${medal} **${index + 1}.** ${user.username}\n` +
                            `└ **${user.wordCount}** times (${percentage}% of total) | ${userUsagePercentage}% of their ${user.totalMessages.toLocaleString()} messages`;
                    })
                    .join('\n\n');

                embed.addFields({
                    name: 'Top Users',
                    value: leaderboardText
                });

                embed.addFields({
                    name: '📈 Statistics',
                    value: `**Active Users:** ${totalUsers}\n**Average Uses/User:** ${avgMessages.toFixed(1)}`
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching word leaderboard:', error);
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
