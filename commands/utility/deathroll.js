import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';

// Store active games (gameId -> game state)
const activeGames = new Map();
// Store active collectors
const activeCollectors = new Map();

export default {
    data: new SlashCommandBuilder()
        .setName('deathroll')
        .setDescription('Start a deathroll game - roll until someone hits 0! The loser gets timed out for 15 minutes.')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('Challenge a specific user to deathroll')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('Starting number for the deathroll (default: 100)')
                .setMinValue(2)
                .setMaxValue(10000)
                .setRequired(false)),

    async execute(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();

        const startingNumber = interaction.options.getInteger('number') || 100;
        const targetUser = interaction.options.getUser('opponent');

        await interaction.deferReply();

        // Check if bot has permission to timeout members
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.editReply({
                content: '🎲 I don\'t have permission to timeout members!'
            });
        }

        // Check if initiator can be timed out
        if (!interaction.member.moderatable) {
            return interaction.editReply({
                content: '🎲 You can\'t be timed out (you have higher permissions), so you can\'t play deathroll!',
            });
        }

        let targetMember = null;
        // If a target user was specified, validate them
        if (targetUser) {
            if (targetUser.id === userId) {
                return interaction.editReply({
                    content: '🎲 You can\'t challenge yourself!',
                    ephemeral: true
                });
            }

            if (targetUser.bot) {
                return interaction.editReply({
                    content: '🎲 You can\'t challenge a bot!',
                    ephemeral: true
                });
            }

            targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            if (!targetMember) {
                return interaction.editReply({
                    content: '🎲 That user is not in this server!',
                    ephemeral: true
                });
            }

            if (!targetMember.moderatable) {
                return interaction.editReply({
                    content: '🎲 That user can\'t be timed out (they have higher permissions)!',
                    ephemeral: true
                });
            }
        }

        // Fetch stats for the initiator (and target if present)
        const guildId = interaction.guild.id;
        const initiatorStats = await fetchSinglePlayerStats(guildId, userId);
        const targetStats = targetUser ? await fetchSinglePlayerStats(guildId, targetUser.id) : null;

        // Create buttons - use target's displayName if they exist, otherwise show generic message
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

        const row = new ActionRowBuilder()
            .addComponents(engageButton, declineButton);

        const initiatorRecord = formatStatsString(initiatorStats);
        let content = `🎲 <@${interaction.user.id}>${initiatorRecord} has started a deathroll from **${startingNumber}**!\n\n`;

        if (targetUser) {
            const targetRecord = formatStatsString(targetStats);
            content += `<@${targetUser.id}>${targetRecord}, you have been challenged!\n` +
                `Click the button below to accept or decline! The loser gets timed out for 15 minutes.`;
        } else {
            content += `Click the button below to engage! The loser gets timed out for 15 minutes.`;
        }

        const reply = await interaction.editReply({
            content: content,
            components: [row]
        });

        // Store game state
        const gameId = `${interaction.channelId}_${interaction.id}`;
        activeGames.set(gameId, {
            initiator: interaction.user.id,
            initiatorName: interaction.user.username,
            opponent: null,
            opponentName: null,
            targetUserId: targetUser ? targetUser.id : null,
            currentNumber: startingNumber,
            currentTurn: null,
            messageId: reply.id,
            channelId: interaction.channelId,
            startingNumber: startingNumber,
            rolls: [],
            startedAt: now,
            currentMessageId: reply.id
        });

        // Create collector for button interactions
        const collector = reply.createMessageComponentCollector({
            idle: 5 * 60 * 1000 // 5 minutes of inactivity
        });

        activeCollectors.set(gameId, collector);

        collector.on('collect', async (buttonInteraction) => {
            if (buttonInteraction.customId.startsWith('deathroll_engage_')) {
                await handleEngageButton(buttonInteraction, gameId);
            } else if (buttonInteraction.customId.startsWith('deathroll_decline_')) {
                await handleDeclineButton(buttonInteraction, gameId);
            }
        });

        collector.on('end', (collected, reason) => {
            // Only clean up if the reason is not manual stop
            if (reason !== 'manually stopped') {
                if (activeGames.has(gameId)) {
                    const game = activeGames.get(gameId);
                    if (!game.opponent) {
                        // Game was never engaged
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
};

async function handleDeclineButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);

    if (!game) {
        return buttonInteraction.reply({
            content: '🎲 This game is no longer active!',
            ephemeral: true
        });
    }

    const userId = buttonInteraction.user.id;

    // Check if there's a target user and if this is them
    if (game.targetUserId && userId !== game.targetUserId) {
        return buttonInteraction.reply({
            content: '🎲 This challenge is not for you!',
            ephemeral: true
        });
    }

    // Can't decline if game already has an opponent
    if (game.opponent) {
        return buttonInteraction.reply({
            content: '🎲 This game is already in progress!',
            ephemeral: true
        });
    }

    // Stop the collector
    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    // Update message to show denial
    await buttonInteraction.update({
        content: `🎲 <@${game.initiator}>'s deathroll from **${game.startingNumber}** was denied by <@${buttonInteraction.user.id}>!`,
        components: []
    });

    // Clean up game state
    activeGames.delete(gameId);
}

async function handleEngageButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);

    if (!game) {
        return buttonInteraction.reply({
            content: '🎲 This game is no longer active!',
            ephemeral: true
        });
    }

    const userId = buttonInteraction.user.id;
    const now = Date.now();

    // Can't engage with yourself
    if (userId === game.initiator) {
        return buttonInteraction.reply({
            content: '🎲 You can\'t play against yourself!',
            ephemeral: true
        });
    }

    // Check if there's a target user and if this is them
    if (game.targetUserId && userId !== game.targetUserId) {
        return buttonInteraction.reply({
            content: '🎲 This challenge is not for you!',
            ephemeral: true
        });
    }

    // Can't engage if game already has an opponent
    if (game.opponent) {
        return buttonInteraction.reply({
            content: '🎲 This game is already in progress!',
            ephemeral: true
        });
    }

    // Check if both users can be timed out
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
        return buttonInteraction.reply({
            content: `🎲 The game initiator can't be timed out (they have higher permissions)!`,
            ephemeral: true
        });
    }

    if (!opponentMember.moderatable) {
        return buttonInteraction.reply({
            content: `🎲 You can't deathroll (you have higher permissions)!`,
            ephemeral: true
        });
    }

    // Stop the old collector
    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    // Set opponent and make them go first
    game.opponent = userId;
    game.opponentName = buttonInteraction.user.username;
    game.currentTurn = userId;

    // Roll from 0 to currentNumber (inclusive)
    const roll = Math.floor(Math.random() * (game.currentNumber + 1));
    game.rolls.push({
        userId,
        username: buttonInteraction.user.username,
        roll,
        maxNumber: game.currentNumber
    });

    // Defer the update first
    await buttonInteraction.deferUpdate();

    // Delete the original message
    await buttonInteraction.message.delete().catch(() => { });

    // Check if they lost immediately
    if (roll === 0) {
        const winnerId = game.initiator;
        const stats = await fetchPlayerStats(buttonInteraction.guild.id, winnerId, userId);
        await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, stats),
        });
        await handleLoss(buttonInteraction, game, userId, roll);
        activeGames.delete(gameId);
        return;
    }

    // Update game state
    game.currentNumber = roll;
    game.currentTurn = game.initiator;

    // Create button for initiator's turn
    const rollButton = new ButtonBuilder()
        .setCustomId(`deathroll_roll_${gameId}`)
        .setLabel(`Roll (0-${roll})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎲');

    const row = new ActionRowBuilder()
        .addComponents(rollButton);

    // Post new message with all game information
    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false),
        components: [row]
    });

    game.currentMessageId = newMessage.id;

    // Create collector for the new message
    createRollCollector(newMessage, gameId);
}

async function handleRollButton(buttonInteraction, gameId) {
    const game = activeGames.get(gameId);

    if (!game) {
        return buttonInteraction.reply({
            content: '🎲 This game is no longer active!',
            ephemeral: true
        });
    }

    const userId = buttonInteraction.user.id;

    // Check if it's this user's turn
    if (userId !== game.currentTurn) {
        return buttonInteraction.reply({
            content: '🎲 It\'s not your turn!',
            ephemeral: true
        });
    }

    // Stop the old collector
    if (activeCollectors.has(gameId)) {
        activeCollectors.get(gameId).stop('manually stopped');
        activeCollectors.delete(gameId);
    }

    // Roll from 0 to currentNumber (inclusive)
    const roll = Math.floor(Math.random() * (game.currentNumber + 1));
    game.rolls.push({
        userId,
        username: buttonInteraction.user.username,
        roll,
        maxNumber: game.currentNumber
    });

    // Update current message to remove components
    await buttonInteraction.update({
        components: []
    });

    // Delete the old message after a short delay
    const oldMessage = buttonInteraction.message;
    setTimeout(() => {
        oldMessage.delete().catch(() => { });
    }, 500);

    // Check if they lost
    if (roll === 0) {
        const winnerId = userId === game.initiator ? game.opponent : game.initiator;
        const stats = await fetchPlayerStats(buttonInteraction.guild.id, winnerId, userId);
        await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, stats),
        });
        await handleLoss(buttonInteraction, game, userId, roll);
        activeGames.delete(gameId);
        activeCollectors.delete(gameId);
        return;
    }

    // Update game state
    game.currentNumber = roll;

    // Switch turns
    const nextPlayer = userId === game.initiator ? game.opponent : game.initiator;
    game.currentTurn = nextPlayer;

    // Create button for next turn
    const rollButton = new ButtonBuilder()
        .setCustomId(`deathroll_roll_${gameId}`)
        .setLabel(`Roll (0-${roll})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎲');

    const row = new ActionRowBuilder()
        .addComponents(rollButton);

    // Post new message with all roll history
    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false),
        components: [row]
    });

    game.currentMessageId = newMessage.id;

    // Create collector for the new message
    createRollCollector(newMessage, gameId);
}

function formatGameMessage(game, lastRoll, lastRoller, lastRollerId, isGameOver, stats) {
    let content = `🎲 **Deathroll Game**\n`;
    content += `<@${game.initiator}> vs <@${game.opponent}>\n`;
    content += `Starting number: **${game.startingNumber}**\n\n`;

    // Show roll history
    content += `**Roll History:**\n`;
    for (let i = 0; i < game.rolls.length; i++) {
        const roll = game.rolls[i];
        content += `-# ${i + 1}. <@${roll.userId}> rolled **${roll.roll}** (from 0-${roll.maxNumber})\n`;
    }

    content += `\n`;

    if (isGameOver) {
        const winnerId = lastRollerId === game.initiator ? game.opponent : game.initiator;
        const winnerRecord = stats ? formatStatsString(stats.winner) : '';
        const loserRecord = stats ? formatStatsString(stats.loser) : '';
        content += `💀 <@${lastRollerId}>${loserRecord} loses and has been timed out for 15 minutes!\n`;
        content += `🎉 <@${winnerId}>${winnerRecord} wins!`;
    } else {
        const nextPlayerId = game.currentTurn;
        content += `Current number: **${game.currentNumber}**\n`;
        content += `<@${nextPlayerId}>, it's your turn!`;
    }

    return content;
}

function createRollCollector(message, gameId) {
    const collector = message.createMessageComponentCollector({
        idle: 5 * 60 * 1000
    });

    activeCollectors.set(gameId, collector);

    collector.on('collect', async (buttonInteraction) => {
        await handleRollButton(buttonInteraction, gameId);
    });

    collector.on('end', (collected, reason) => {
        if (reason !== 'manually stopped' && activeGames.has(gameId)) {
            message.edit({
                content: message.content + '\n\n⏱️ Game timed out due to inactivity.',
                components: []
            }).catch(() => { });
            activeGames.delete(gameId);
            activeCollectors.delete(gameId);
        }
    });
}

function formatStatsString(stats) {
    if (!stats) return '';
    const { wins, losses } = stats;
    const total = wins + losses;
    const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return ` (${wins}W/${losses}L ${winrate}%)`;
}

async function fetchSinglePlayerStats(guildId, userId) {
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const deathrollsCollection = db.collection('DeathRollUserStats');
        const stats = await deathrollsCollection.findOne({ userId, guildId });
        return { wins: stats?.wins || 0, losses: stats?.losses || 0 };
    } catch (error) {
        console.error('Error fetching deathroll stats:', error);
        return null;
    }
}

async function fetchPlayerStats(guildId, winnerId, loserId) {
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const deathrollsCollection = db.collection('DeathRollUserStats');

        const [winnerStats, loserStats] = await Promise.all([
            deathrollsCollection.findOne({ userId: winnerId, guildId }),
            deathrollsCollection.findOne({ userId: loserId, guildId })
        ]);

        // Pre-compute post-game stats (handleLoss hasn't updated DB yet)
        return {
            winner: { wins: (winnerStats?.wins || 0) + 1, losses: winnerStats?.losses || 0 },
            loser: { wins: loserStats?.wins || 0, losses: (loserStats?.losses || 0) + 1 }
        };
    } catch (error) {
        console.error('Error fetching deathroll stats:', error);
        return null;
    }
}

async function handleLoss(buttonInteraction, game, loserId, roll) {
    const guild = buttonInteraction.guild;
    const loser = await guild.members.fetch(loserId);

    const timeoutDuration = 15 * 60 * 1000; // 15 minutes

    const winnerId = loserId === game.initiator ? game.opponent : game.initiator;
    const winnerMember = await guild.members.fetch(winnerId);

    try {
        await loser.timeout(timeoutDuration, `Lost a deathroll game`);
    } catch (error) {
        console.error('Error timing out user:', error);
    }

    // Save game to MongoDB
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const deathrollsCollection = db.collection('DeathRollUserStats');
        const gamesCollection = db.collection('DeathRollGameHistory');

        const now = Date.now();

        // Update loser stats
        await deathrollsCollection.findOneAndUpdate(
            {
                userId: loserId,
                guildId: guild.id
            },
            {
                $inc: {
                    totalGames: 1,
                    losses: 1
                },
                $set: {
                    username: loser.user.username,
                    displayName: loser.displayName,
                    lastPlayedAt: now,
                    lastOpponentId: winnerId,
                    lastOpponentName: winnerMember.user.username,
                    lastGameResult: 'loss',
                    lastStartingNumber: game.startingNumber
                },
                $setOnInsert: {
                    createdAt: now,
                    wins: 0
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        // Update winner stats
        await deathrollsCollection.findOneAndUpdate(
            {
                userId: winnerId,
                guildId: guild.id
            },
            {
                $inc: {
                    totalGames: 1,
                    wins: 1
                },
                $set: {
                    username: winnerMember.user.username,
                    displayName: winnerMember.displayName,
                    lastPlayedAt: now,
                    lastOpponentId: loserId,
                    lastOpponentName: loser.user.username,
                    lastGameResult: 'win',
                    lastStartingNumber: game.startingNumber
                },
                $setOnInsert: {
                    createdAt: now,
                    losses: 0
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        // Save game record
        await gamesCollection.insertOne({
            gameId: `${guild.id}_${game.messageId}`,
            guildId: guild.id,
            channelId: game.channelId,
            initiatorId: game.initiator,
            initiatorName: game.initiatorName,
            opponentId: game.opponent,
            opponentName: game.opponentName,
            startingNumber: game.startingNumber,
            winnerId: winnerId,
            winnerName: winnerMember.user.username,
            loserId: loserId,
            loserName: loser.user.username,
            rolls: game.rolls,
            totalRolls: game.rolls.length,
            startedAt: game.startedAt,
            endedAt: now,
            duration: now - game.startedAt
        });

    } catch (error) {
        console.error('Error saving deathroll to MongoDB:', error);
    }
}
