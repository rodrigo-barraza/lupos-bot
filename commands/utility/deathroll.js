import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import MongoWrapper from '#root/wrappers/MongoWrapper.js';
import { calculateMMR, getRankTitle, formatStatsString, formatStreak } from './deathrollUtils.js';

// Store active games (gameId -> game state)
const activeGames = new Map();
// Store active collectors
const activeCollectors = new Map();

const BASE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export default {
    data: new SlashCommandBuilder()
        .setName('deathroll')
        .setDescription('Start a deathroll game - roll until someone hits 0! The loser gets timed out for 10 minutes.')
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
                `Click the button below to accept or decline! The loser gets timed out for 10 minutes.`;
        } else {
            content += `Click the button below to engage! The loser gets timed out for 10 minutes.`;
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
            currentMessageId: reply.id,
            timeoutMultiplier: 1
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

    // Fetch head-to-head record
    const h2h = await fetchHeadToHead(guild.id, game.initiator, userId);
    game.h2h = h2h;

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
        const endGameData = await buildEndGameData(buttonInteraction, game, winnerId, userId);
        const gameOverMsg = await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, endGameData),
            components: buildDoubleOrNothingRow(game, winnerId, userId)
        });
        await handleLoss(buttonInteraction, game, userId, roll, gameOverMsg);
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

    // Fetch both players' stats for mid-game display
    const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);

    // Post new message with all game information
    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false, midGameStats),
        components: [row]
    });

    game.currentMessageId = newMessage.id;

    // Create collector for the new message
    createRollCollector(newMessage, gameId, buttonInteraction.guild);
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
        const endGameData = await buildEndGameData(buttonInteraction, game, winnerId, userId);
        const gameOverMsg = await buttonInteraction.followUp({
            content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, true, endGameData),
            components: buildDoubleOrNothingRow(game, winnerId, userId)
        });
        await handleLoss(buttonInteraction, game, userId, roll, gameOverMsg);
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

    // Fetch both players' stats for mid-game display
    const midGameStats = await fetchMidGameStats(buttonInteraction.guild.id, game.initiator, game.opponent);

    // Post new message with all roll history
    const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(game, roll, buttonInteraction.user.username, userId, false, midGameStats),
        components: [row]
    });

    game.currentMessageId = newMessage.id;

    // Create collector for the new message
    createRollCollector(newMessage, gameId, buttonInteraction.guild);
}

// ─── Message Formatting ───────────────────────────────────────────────

function formatGameMessage(game, lastRoll, lastRoller, lastRollerId, isGameOver, stats) {
    const timeoutMinutes = (game.timeoutMultiplier || 1) * 10;
    let content = `🎲 **Deathroll Game**${game.timeoutMultiplier > 1 ? ` 🎰 **DOUBLE OR NOTHING (${timeoutMinutes}min timeout)**` : ''}\n`;

    // Show player names with stats and H2H
    if (stats && !isGameOver) {
        const initiatorRecord = stats.initiator ? formatStatsString(stats.initiator) : '';
        const opponentRecord = stats.opponent ? formatStatsString(stats.opponent) : '';
        content += `<@${game.initiator}>${initiatorRecord} vs <@${game.opponent}>${opponentRecord}\n`;
    } else {
        content += `<@${game.initiator}> vs <@${game.opponent}>\n`;
    }

    // Show H2H record
    if (game.h2h && (game.h2h.player1Wins > 0 || game.h2h.player2Wins > 0)) {
        content += `-# H2H: <@${game.initiator}> ${game.h2h.player1Wins} - ${game.h2h.player2Wins} <@${game.opponent}>\n`;
    }

    content += `Starting number: **${game.startingNumber}**\n\n`;

    // Show roll history
    content += `**Roll History:**\n`;
    for (let i = 0; i < game.rolls.length; i++) {
        const roll = game.rolls[i];
        const clutch = roll.roll === 1 ? ' ⚡ **CLUTCH!**' : '';
        content += `-# ${i + 1}. <@${roll.userId}> rolled **${roll.roll}** (from 0-${roll.maxNumber})${clutch}\n`;
    }

    content += `\n`;

    if (isGameOver) {
        const winnerId = lastRollerId === game.initiator ? game.opponent : game.initiator;

        // Post-game stats card
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

            content += `💀 <@${lastRollerId}> ${loserRank}${loserMmrChange} loses and has been timed out for ${timeoutMinutes} minutes!${loserStreakStr}\n`;
            content += `🎉 <@${winnerId}> ${winnerRank}${winnerMmrChange} wins!${winnerStreakStr}`;
        } else {
            content += `💀 <@${lastRollerId}> loses and has been timed out for ${timeoutMinutes} minutes!\n`;
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

    const donButton = new ButtonBuilder()
        .setCustomId(`deathroll_don_propose_${winnerId}_${loserId}_${game.startingNumber}_${nextMultiplier}`)
        .setLabel(`Double or Nothing (${nextTimeout}min timeout)`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🎰');

    const row = new ActionRowBuilder().addComponents(donButton);
    return [row];
}

function createDoubleOrNothingCollector(message, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData) {
    const collector = message.createMessageComponentCollector({
        idle: 60 * 1000 // 60 seconds for the loser to propose
    });

    collector.on('collect', async (buttonInteraction) => {
        const userId = buttonInteraction.user.id;

        // ── Step 1: Loser proposes Double or Nothing ──
        if (buttonInteraction.customId.startsWith('deathroll_don_propose_')) {
            // Only the loser can propose
            if (userId !== loserId) {
                return buttonInteraction.reply({
                    content: '🎲 Only the loser can propose Double or Nothing!',
                    ephemeral: true
                });
            }

            collector.stop('manually stopped');

            const nextMultiplier = (timeoutMultiplier || 1) * 2;
            const nextTimeout = nextMultiplier * 10;

            // Build accept/decline buttons for the winner
            const acceptButton = new ButtonBuilder()
                .setCustomId(`deathroll_don_accept_${winnerId}_${loserId}_${startingNumber}_${nextMultiplier}`)
                .setLabel(`Accept Double or Nothing (${nextTimeout}min timeout)`)
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
                content: message.content + `\n\n� <@${loserId}> proposes **Double or Nothing**! The ${currentTimeout}min timeout will be cancelled — but if they lose again, it's **${nextTimeout} minutes**.\n<@${winnerId}>, do you accept this high-risk challenge?`,
                components: [row]
            });

            // Create a new collector for the winner's accept/decline decision
            createAcceptDeclineCollector(buttonInteraction.message, guild, winnerId, loserId, startingNumber, nextMultiplier, pendingTimeoutData);
            return;
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'manually stopped') {
            // Time expired — loser didn't propose. Apply the pending timeout.
            await message.edit({ components: [] }).catch(() => { });
            await applyPendingTimeout(guild, pendingTimeoutData);
        }
    });
}

function createAcceptDeclineCollector(message, guild, winnerId, loserId, startingNumber, timeoutMultiplier, pendingTimeoutData) {
    const collector = message.createMessageComponentCollector({
        idle: 60 * 1000 // 60 seconds for the winner to decide
    });

    collector.on('collect', async (buttonInteraction) => {
        const userId = buttonInteraction.user.id;

        // ── Winner declines ──
        if (buttonInteraction.customId.startsWith('deathroll_don_decline_')) {
            if (userId !== winnerId) {
                return buttonInteraction.reply({
                    content: '🎲 Only the winner can accept or decline!',
                    ephemeral: true
                });
            }

            collector.stop('manually stopped');

            await buttonInteraction.update({
                content: message.content + `\n\n❌ <@${winnerId}> declined the Double or Nothing.`,
                components: []
            });

            // Apply the original timeout
            await applyPendingTimeout(guild, pendingTimeoutData);
            return;
        }

        // ── Winner accepts ──
        if (buttonInteraction.customId.startsWith('deathroll_don_accept_')) {
            if (userId !== winnerId) {
                return buttonInteraction.reply({
                    content: '🎲 Only the winner can accept or decline!',
                    ephemeral: true
                });
            }

            collector.stop('manually stopped');

            // Check permissions
            const challengerMember = await guild.members.fetch(loserId).catch(() => null);
            const opponentMember = await guild.members.fetch(winnerId).catch(() => null);

            if (!challengerMember?.moderatable || !opponentMember?.moderatable) {
                await buttonInteraction.update({ components: [] });
                return buttonInteraction.followUp({
                    content: '🎲 One of the players can\'t be timed out anymore!',
                    ephemeral: true
                });
            }

            // Remove the loser's pending timeout since they got a reprieve
            await removePendingTimeout(guild, loserId);

            // Fetch H2H for the rematch
            const h2h = await fetchHeadToHead(guild.id, loserId, winnerId);

            // Create the Double or Nothing game — loser is the initiator (challenger)
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

            // Winner (previous round's winner) rolls first
            const roll = Math.floor(Math.random() * (startingNumber + 1));
            activeGames.get(gameId).rolls.push({
                userId: winnerId,
                username: opponentMember.user.username,
                roll,
                maxNumber: startingNumber
            });

            // Remove accept/decline buttons from old message
            await buttonInteraction.update({
                content: message.content + `\n\n✅ <@${winnerId}> accepted the **Double or Nothing**! 🎰`,
                components: []
            });

            if (roll === 0) {
                const game = activeGames.get(gameId);
                const endGameData = await buildEndGameData(buttonInteraction, game, loserId, winnerId);
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
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'manually stopped') {
            // Winner didn't respond in time — apply the timeout
            await message.edit({ components: [] }).catch(() => { });
            await applyPendingTimeout(guild, pendingTimeoutData);
        }
    });
}

// Apply a deferred timeout to the loser
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

// Remove an existing timeout if the loser gets a reprieve via Double or Nothing
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
        await handleRollButton(buttonInteraction, gameId);
    });

    collector.on('end', async (collected, reason) => {
        if (reason !== 'manually stopped' && activeGames.has(gameId)) {
            const game = activeGames.get(gameId);

            // Both players engaged — give a loss to whoever's turn it was
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
                // No opponent engaged, just expire
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

// ─── Stats Helpers ────────────────────────────────────────────────────

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

async function buildEndGameData(buttonInteraction, game, winnerId, loserId) {
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const deathrollsCollection = db.collection('DeathRollUserStats');

        const [winnerStats, loserStats] = await Promise.all([
            deathrollsCollection.findOne({ userId: winnerId, guildId: buttonInteraction.guild.id }),
            deathrollsCollection.findOne({ userId: loserId, guildId: buttonInteraction.guild.id })
        ]);

        // Pre-compute post-game values (DB hasn't been updated yet)
        const winnerWins = (winnerStats?.wins || 0) + 1;
        const winnerLosses = winnerStats?.losses || 0;
        const loserWins = loserStats?.wins || 0;
        const loserLosses = (loserStats?.losses || 0) + 1;

        const winnerCurrentStreak = Math.max(0, winnerStats?.currentStreak || 0) + 1;
        const loserCurrentStreak = Math.min(0, loserStats?.currentStreak || 0) - 1;

        // Calculate MMR before and after
        const winnerOldMmr = calculateMMR({ wins: winnerWins - 1, losses: winnerLosses, totalGames: (winnerStats?.totalGames || 0) });
        const winnerNewMmr = calculateMMR({ wins: winnerWins, losses: winnerLosses, totalGames: (winnerStats?.totalGames || 0) + 1 });
        const loserOldMmr = calculateMMR({ wins: loserWins, losses: loserLosses - 1, totalGames: (loserStats?.totalGames || 0) });
        const loserNewMmr = calculateMMR({ wins: loserWins, losses: loserLosses, totalGames: (loserStats?.totalGames || 0) + 1 });

        const winnerMmrDiff = winnerNewMmr - winnerOldMmr;
        const loserMmrDiff = loserNewMmr - loserOldMmr;

        const winnerRank = getRankTitle(winnerNewMmr);
        const loserRank = getRankTitle(loserNewMmr);

        return {
            winner: { wins: winnerWins, losses: winnerLosses },
            loser: { wins: loserWins, losses: loserLosses },
            winnerRank: `${winnerRank.emoji} ${winnerRank.title}`,
            loserRank: `${loserRank.emoji} ${loserRank.title}`,
            winnerMmrChange: ` (${winnerNewMmr} MMR, +${winnerMmrDiff} ↑)`,
            loserMmrChange: ` (${loserNewMmr} MMR, ${loserMmrDiff} ↓)`,
            winnerStreak: winnerCurrentStreak,
            loserStreak: loserCurrentStreak
        };
    } catch (error) {
        console.error('Error building end game data:', error);
        return null;
    }
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

async function fetchMidGameStats(guildId, initiatorId, opponentId) {
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const deathrollsCollection = db.collection('DeathRollUserStats');

        const [initiatorStats, opponentStats] = await Promise.all([
            deathrollsCollection.findOne({ userId: initiatorId, guildId }),
            deathrollsCollection.findOne({ userId: opponentId, guildId })
        ]);

        return {
            initiator: { wins: initiatorStats?.wins || 0, losses: initiatorStats?.losses || 0 },
            opponent: { wins: opponentStats?.wins || 0, losses: opponentStats?.losses || 0 }
        };
    } catch (error) {
        console.error('Error fetching mid-game deathroll stats:', error);
        return null;
    }
}

async function fetchHeadToHead(guildId, player1Id, player2Id) {
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db('lupos');
        const gamesCollection = db.collection('DeathRollGameHistory');

        const [p1Wins, p2Wins] = await Promise.all([
            gamesCollection.countDocuments({
                guildId,
                winnerId: player1Id,
                loserId: player2Id
            }),
            gamesCollection.countDocuments({
                guildId,
                winnerId: player2Id,
                loserId: player1Id
            })
        ]);

        return { player1Wins: p1Wins, player2Wins: p2Wins };
    } catch (error) {
        console.error('Error fetching H2H:', error);
        return null;
    }
}

// ─── Game End Handler ─────────────────────────────────────────────────

async function handleLoss(buttonInteraction, game, loserId, roll, gameOverMessage) {
    const guild = buttonInteraction.guild;
    const loser = await guild.members.fetch(loserId);

    const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);

    const winnerId = loserId === game.initiator ? game.opponent : game.initiator;
    const winnerMember = await guild.members.fetch(winnerId);

    // Save game to MongoDB
    try {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const deathrollsCollection = db.collection('DeathRollUserStats');
        const gamesCollection = db.collection('DeathRollGameHistory');

        const now = Date.now();

        // Fetch current streaks before update
        const [currentLoserStats, currentWinnerStats] = await Promise.all([
            deathrollsCollection.findOne({ userId: loserId, guildId: guild.id }),
            deathrollsCollection.findOne({ userId: winnerId, guildId: guild.id })
        ]);

        const loserNewStreak = Math.min(0, currentLoserStats?.currentStreak || 0) - 1;
        const winnerNewStreak = Math.max(0, currentWinnerStats?.currentStreak || 0) + 1;
        const winnerBestStreak = Math.max(winnerNewStreak, currentWinnerStats?.bestStreak || 0);

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
                    lastStartingNumber: game.startingNumber,
                    currentStreak: loserNewStreak
                },
                $setOnInsert: {
                    createdAt: now,
                    wins: 0,
                    bestStreak: 0
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
                    lastStartingNumber: game.startingNumber,
                    currentStreak: winnerNewStreak,
                    bestStreak: winnerBestStreak
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
            duration: now - game.startedAt,
            timeoutMultiplier: game.timeoutMultiplier || 1
        });

        // Set up Double or Nothing collector on the game-over message
        // Timeout is deferred — loser has 1 minute to propose, winner has 1 minute to accept
        if (gameOverMessage) {
            const pendingTimeoutData = { loserId, timeoutDuration };
            createDoubleOrNothingCollector(
                gameOverMessage, guild, winnerId, loserId,
                game.startingNumber, game.timeoutMultiplier || 1,
                pendingTimeoutData
            );
        } else {
            // Fallback: no message reference, apply timeout immediately
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

    // Save game to MongoDB
    const localMongo = MongoWrapper.getClient('local');
    const db = localMongo.db('lupos');
    const deathrollsCollection = db.collection('DeathRollUserStats');
    const gamesCollection = db.collection('DeathRollGameHistory');

    const now = Date.now();

    const [currentLoserStats, currentWinnerStats] = await Promise.all([
        deathrollsCollection.findOne({ userId: loserId, guildId: guild.id }),
        deathrollsCollection.findOne({ userId: winnerId, guildId: guild.id })
    ]);

    const loserNewStreak = Math.min(0, currentLoserStats?.currentStreak || 0) - 1;
    const winnerNewStreak = Math.max(0, currentWinnerStats?.currentStreak || 0) + 1;
    const winnerBestStreak = Math.max(winnerNewStreak, currentWinnerStats?.bestStreak || 0);

    await deathrollsCollection.findOneAndUpdate(
        { userId: loserId, guildId: guild.id },
        {
            $inc: { totalGames: 1, losses: 1 },
            $set: {
                username: loser.user.username,
                displayName: loser.displayName,
                lastPlayedAt: now,
                lastOpponentId: winnerId,
                lastOpponentName: winnerMember.user.username,
                lastGameResult: 'loss',
                lastStartingNumber: game.startingNumber,
                currentStreak: loserNewStreak
            },
            $setOnInsert: { createdAt: now, wins: 0, bestStreak: 0 }
        },
        { upsert: true, returnDocument: 'after' }
    );

    await deathrollsCollection.findOneAndUpdate(
        { userId: winnerId, guildId: guild.id },
        {
            $inc: { totalGames: 1, wins: 1 },
            $set: {
                username: winnerMember.user.username,
                displayName: winnerMember.displayName,
                lastPlayedAt: now,
                lastOpponentId: loserId,
                lastOpponentName: loser.user.username,
                lastGameResult: 'win',
                lastStartingNumber: game.startingNumber,
                currentStreak: winnerNewStreak,
                bestStreak: winnerBestStreak
            },
            $setOnInsert: { createdAt: now, losses: 0 }
        },
        { upsert: true, returnDocument: 'after' }
    );

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
        duration: now - game.startedAt,
        timeoutMultiplier: game.timeoutMultiplier || 1,
        endReason: 'timeout'
    });
}
