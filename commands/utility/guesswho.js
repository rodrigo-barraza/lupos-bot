import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('guesswho')
        .setDescription('Guess the user from an anonymous message quote')
        .addIntegerOption(option =>
            option.setName('years')
                .setDescription('Number of years to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(10))
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
                .setMaxValue(365))
        .addIntegerOption(option =>
            option.setName('min_length')
                .setDescription('Minimum message length (default: 20)')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(500)),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");
        const scoresCollection = db.collection('GuessWhoGameScore');

        const serverAgeInDays = Math.floor((Date.now() - interaction.guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        const serverAgeInMonths = Math.floor(serverAgeInDays / 30);
        const serverAgeInYears = Math.floor(serverAgeInDays / 365);

        await interaction.deferReply();

        // Get time parameters
        let years = interaction.options.getInteger('years') || 0;
        let months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const minLength = interaction.options.getInteger('min_length') || 20;

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

        const match = {
            createdTimestamp: { $gte: unixStartDate },
            guildId: interaction.guildId,
            'author.bot': { $ne: true },
            content: {
                $exists: true,
                $ne: '',
                $not: { $regex: '^[!./]' }
            }
        };

        if (channel) {
            match.channelId = channel.id;
        }

        try {
            // Get random message using aggregation
            const messages = await messagesCollection.aggregate([
                { $match: match },
                {
                    $addFields: {
                        contentLength: { $strLenCP: '$content' }
                    }
                },
                {
                    $match: {
                        contentLength: { $gte: minLength }
                    }
                },
                { $sample: { size: 1 } }
            ]).toArray();

            if (messages.length === 0) {
                await interaction.editReply({
                    content: 'No suitable messages found in the specified time period. Try adjusting your parameters!'
                });
                return;
            }

            const message = messages[0];
            const correctUserId = message.author.id;
            const correctUsername = message.author.username;

            // Create message link
            const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

            // Get 3 other random users from the same time period as decoys
            const decoyUsers = await messagesCollection.aggregate([
                {
                    $match: {
                        ...match,
                        guildId: interaction.guildId,
                        'author.id': { $ne: correctUserId }
                    }
                },
                {
                    $group: {
                        _id: '$author.id',
                        username: { $first: '$author.username' },
                        avatar: { $first: '$author.defaultAvatarURL' }
                    }
                },
                { $sample: { size: 3 } }
            ]).toArray();

            if (decoyUsers.length < 3) {
                await interaction.editReply({
                    content: 'Not enough active users found for a proper game. Try a longer time period!'
                });
                return;
            }

            // Fetch guild members to get display names
            const allUserIds = [correctUserId, ...decoyUsers.map(u => u._id)];
            const memberPromises = allUserIds.map(async (userId) => {
                try {
                    const member = await interaction.guild.members.fetch(userId);
                    return { userId, displayName: member.displayName };
                } catch (error) {
                    const user = userId === correctUserId
                        ? { username: correctUsername }
                        : decoyUsers.find(u => u._id === userId);
                    return { userId, displayName: user.username };
                }
            });

            const memberData = await Promise.all(memberPromises);
            const userDisplayNames = new Map(memberData.map(m => [m.userId, m.displayName]));

            // Create array of all options and shuffle
            const allOptions = [
                {
                    userId: correctUserId,
                    displayName: userDisplayNames.get(correctUserId),
                    isCorrect: true
                },
                ...decoyUsers.map(u => ({
                    userId: u._id,
                    displayName: userDisplayNames.get(u._id),
                    isCorrect: false
                }))
            ];
            shuffleArray(allOptions);

            // Truncate message if too long
            let displayContent = message.content;
            if (displayContent.length > 500) {
                displayContent = displayContent.substring(0, 497) + '...';
            }

            // Create embed with timer
            const createEmbed = (timeRemaining) => {
                const embed = new EmbedBuilder()
                    .setTitle(`❓ Guess Who? ⏱️ ${timeRemaining}s`)
                    .setDescription(`**Guess who said this:**\n\n> ${displayContent}`)
                    .setColor(0x5865F2)
                    .setFooter({
                        text: `Message from ${new Date(message.createdTimestamp).toLocaleDateString()} • Time period: ${formatTimePeriod(years, months, days)}`
                    });

                if (channel) {
                    embed.addFields({ name: 'Channel', value: channel.toString(), inline: true });
                }

                return embed;
            };

            // Create buttons
            const row = new ActionRowBuilder()
                .addComponents(
                    allOptions.map((option, index) =>
                        new ButtonBuilder()
                            .setCustomId(`whosthat_${option.userId}_${option.isCorrect}`)
                            .setLabel(option.displayName)
                            .setStyle(ButtonStyle.Primary)
                    )
                );

            const response = await interaction.editReply({
                embeds: [createEmbed(60)],
                components: [row]
            });

            // Timer update logic
            const startTime = Date.now();
            const timeLimit = 60000; // 60 seconds
            let timerInterval;

            const updateTimer = async () => {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 1000));

                if (remaining > 0) {
                    try {
                        await response.edit({
                            embeds: [createEmbed(remaining)],
                            components: [row]
                        });
                    } catch (error) {
                        clearInterval(timerInterval);
                    }
                }
            };

            // Start timer updates
            timerInterval = setInterval(updateTimer, 1000);

            // Create collector for button interactions
            const collector = response.createMessageComponentCollector({
                time: timeLimit
            });

            const guesses = new Map(); // Track who guessed what

            collector.on('collect', async i => {
                // Check if user already guessed
                if (guesses.has(i.user.id)) {
                    await i.reply({
                        content: 'You already made a guess!',
                        ephemeral: true
                    });
                    return;
                }

                const [, userId, isCorrectStr] = i.customId.split('_');
                const isCorrect = isCorrectStr === 'true';

                // Calculate points change
                const pointsChange = isCorrect ? 1 : -2;

                // Update score in database
                await scoresCollection.updateOne(
                    {
                        userId: i.user.id,
                        guildId: interaction.guildId
                    },
                    {
                        $inc: { score: pointsChange },
                        $set: {
                            username: i.user.username,
                            lastUpdated: new Date()
                        }
                    },
                    { upsert: true }
                );

                guesses.set(i.user.id, {
                    guessedUserId: userId,
                    isCorrect,
                    guessedName: userDisplayNames.get(userId),
                    pointsChange
                });

                if (isCorrect) {
                    await i.reply({
                        content: `✅ Correct! It was **${userDisplayNames.get(correctUserId)}**! (+1 point)`,
                        ephemeral: true
                    });
                    collector.stop('correct_answer');
                } else {
                    await i.reply({
                        content: `❌ Wrong guess! (-2 points)`,
                        ephemeral: true
                    });
                }
            });

            collector.on('end', async (collected, reason) => {
                // Clear timer interval
                clearInterval(timerInterval);

                // Disable all buttons
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        allOptions.map((option, index) => {
                            const button = new ButtonBuilder()
                                .setCustomId(`whosthat_${option.userId}_${option.isCorrect}_disabled`)
                                .setLabel(option.displayName)
                                .setDisabled(true);

                            if (option.isCorrect) {
                                button.setStyle(ButtonStyle.Success);
                            } else {
                                button.setStyle(ButtonStyle.Secondary);
                            }

                            return button;
                        })
                    );

                // Fetch current scores for all players who participated
                const playerIds = Array.from(guesses.keys());
                const scores = await scoresCollection.find({
                    userId: { $in: playerIds },
                    guildId: interaction.guildId
                }).toArray();

                const scoreMap = new Map(scores.map(s => [s.userId, s.score]));

                // Create final embed without timer
                const finalEmbed = new EmbedBuilder()
                    .setTitle('❓ Guess Who? ⏱️ ENDED')
                    .setDescription(`**Guess who said this:**\n\n> ${displayContent}`)
                    .setColor(reason === 'correct_answer' ? 0x57F287 : 0xED4245)
                    .setFooter({
                        text: `Message from ${new Date(message.createdTimestamp).toLocaleDateString()} • Time period: ${formatTimePeriod(years, months, days)}`
                    });

                if (channel) {
                    finalEmbed.addFields({ name: 'Message', value: messageLink, inline: true });
                }

                // Separate correct and incorrect guesses with scores
                const correctGuesses = [];
                const incorrectGuesses = [];

                for (const [userId, data] of guesses.entries()) {
                    const currentScore = scoreMap.get(userId) || 0;
                    const pointsDisplay = data.pointsChange > 0 ? `+${data.pointsChange}` : data.pointsChange;

                    if (data.isCorrect) {
                        correctGuesses.push(`<@${userId}> (${pointsDisplay} → **${currentScore}** points)`);
                    } else {
                        incorrectGuesses.push(`<@${userId}> guessed ${data.guessedName} (${pointsDisplay} → **${currentScore}** points)`);
                    }
                }

                if (reason === 'correct_answer') {
                    if (correctGuesses.length > 0) {
                        finalEmbed.addFields({
                            name: '🎉 Winner(s)',
                            value: correctGuesses.join('\n')
                        });
                    }
                } else {
                    finalEmbed.addFields({
                        name: '⏱️ Time\'s Up!',
                        value: `The correct answer was **${userDisplayNames.get(correctUserId)}**`
                    });

                    if (correctGuesses.length > 0) {
                        finalEmbed.addFields({
                            name: '✅ Correct Guesses',
                            value: correctGuesses.join('\n')
                        });
                    }
                }

                // Add incorrect guesses field
                if (incorrectGuesses.length > 0) {
                    finalEmbed.addFields({
                        name: '❌ Incorrect Guesses',
                        value: incorrectGuesses.join('\n')
                    });
                }

                await response.edit({
                    embeds: [finalEmbed],
                    components: [disabledRow]
                });
            });

        } catch (error) {
            console.error('Error in guesswho command:', error);
            await interaction.editReply({
                content: 'An error occurred while fetching a message. Please try again later.'
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

    if (parts.length === 0) return 'Last year (default)';
    return 'Last ' + parts.join(', ');
}

// Fisher-Yates shuffle
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
