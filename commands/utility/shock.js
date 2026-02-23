import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import MongoWrapper from '#/wrappers/MongoWrapper.js';

// Store cooldowns in memory (userId -> timestamp)
const cooldowns = new Map();

const newParalysisMoves = {
    'BODY SLAM': { emoji: '💥', power: 85, accuracy: 100 },
    'BOLT STRIKE': { emoji: '⚡', power: 130, accuracy: 85 },
    'BOUNCE': { emoji: '🦘', power: 85, accuracy: 85 },
    'BUZZY BUZZ': { emoji: '🐝', power: 60, accuracy: 100 },
    'COMBAT TORQUE': { emoji: '🔧', power: 100, accuracy: 100 },
    'DIRE CLAW': { emoji: '🩸', power: 80, accuracy: 100 },
    'DISCHARGE': { emoji: '🔋', power: 80, accuracy: 100 },
    'DRAGON BREATH': { emoji: '🐉', power: 60, accuracy: 100 },
    'FLING': { emoji: '🪃', power: 'Varies', accuracy: 100 },
    'FORCE PALM': { emoji: '👊', power: 60, accuracy: 100 },
    'FREEZE SHOCK': { emoji: '❄️', power: 140, accuracy: 90 },
    'GLARE': { emoji: '👁️', power: 0, accuracy: 100 },
    'LICK': { emoji: '👅', power: 30, accuracy: 100 },
    'NUZZLE': { emoji: '🐭', power: 20, accuracy: 100 },
    'PSYCHO SHIFT': { emoji: '🧠', power: 0, accuracy: 100 },
    'SECRET POWER': { emoji: '🤫', power: 70, accuracy: 100 },
    'SHADOW BOLT': { emoji: '👻', power: 70, accuracy: 100 },
    'SPARK': { emoji: '✨', power: 65, accuracy: 100 },
    'SPLISHY SPLASH': { emoji: '💦', power: 90, accuracy: 100 },
    'STOKED SPARKSURFER': { emoji: '🏄', power: 175, accuracy: 100 },
    'STUN SPORE': { emoji: '🍄', power: 0, accuracy: 75 },
    'THUNDER': { emoji: '🌩️', power: 110, accuracy: 70 },
    'THUNDER FANG': { emoji: '🦷', power: 65, accuracy: 95 },
    'THUNDER PUNCH': { emoji: '👊', power: 75, accuracy: 100 },
    'THUNDER SHOCK': { emoji: '⚡', power: 40, accuracy: 100 },
    'THUNDER WAVE': { emoji: '〰️', power: 0, accuracy: 90 },
    'THUNDERBOLT': { emoji: '⚡', power: 90, accuracy: 100 },
    'TRI ATTACK': { emoji: '🔺', power: 80, accuracy: 100 },
    'VOLT TACKLE': { emoji: '💥', power: 120, accuracy: 100 },
    'WILDBOLT STORM': { emoji: '🌪️', power: 100, accuracy: 80 },
    'ZAP CANNON': { emoji: '🔫', power: 120, accuracy: 50 }
};

// Calculate timeout duration based on move power (1-10 seconds)
function calculateTimeoutDuration(power, isCritical = false) {
    if (power === 'Varies') {
        return isCritical ? 7500 : 5000; // 7.5 or 5 seconds for variable power moves
    }

    if (power === 0) {
        return isCritical ? 1500 : 1000; // 1.5 or 1 second for status moves
    }

    // Scale from 1 to 10 seconds based on power (20-175 range)
    const minPower = 20;
    const maxPower = 175;
    const minTimeout = 1;
    const maxTimeout = 10;

    const scaledTimeout = minTimeout + ((power - minPower) / (maxPower - minPower)) * (maxTimeout - minTimeout);
    const timeoutSeconds = Math.min(maxTimeout, Math.max(minTimeout, Math.round(scaledTimeout)));

    // Critical hits do 1.5x timeout duration
    const finalTimeout = isCritical ? timeoutSeconds * 1.5 : timeoutSeconds;

    return finalTimeout * 1000; // Convert to milliseconds
}

// Check if move hits based on accuracy
function doesMoveHit(accuracy) {
    const roll = Math.floor(Math.random() * 100) + 1; // Roll 1-100
    return roll <= accuracy;
}

// Check if move is a critical hit (6.25% chance)
function isCriticalHit() {
    return Math.random() < 0.0625; // 6.25% chance
}

export default {
    data: new SlashCommandBuilder()
        .setName('shock')
        .setDescription('Paralyzes a random person from the recent conversation'),

    async execute(interaction) {
        // Check cooldown
        const userId = interaction.user.id;
        const now = Date.now();
        const cooldownAmount = 5 * 60 * 1000; // 5 minutes in milliseconds

        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId) + cooldownAmount;

            if (now < expirationTime) {
                const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
                return interaction.reply({
                    content: `⚡ Please wait **${timeLeft}** more second(s) before using \`/shock\` again.`,
                    ephemeral: true
                });
            }
        }

        await interaction.deferReply();

        try {
            // Check if bot has permission to timeout members
            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.editReply({
                    content: '⚡ I don\'t have permission to timeout members!'
                });
            }

            // Fetch last 100 messages from the channel
            const messages = await interaction.channel.messages.fetch({ limit: 25 });

            // Get unique users from messages (exclude bots)
            const uniqueUsers = new Map();

            for (const message of messages.values()) {
                const member = message.member;

                // Skip if:
                // - No member object
                // - User is a bot
                // - User is the guild owner
                // - User is already timed out
                if (!member ||
                    message.author.bot ||
                    message.author.id === interaction.guild.ownerId) {
                    continue;
                }

                // Skip if user is already timed out
                if (member.communicationDisabledUntil && member.communicationDisabledUntil > now) {
                    continue;
                }

                // Check if member can be timed out by the bot
                if (member.moderatable) {
                    uniqueUsers.set(message.author.id, member);
                }
            }

            if (uniqueUsers.size === 0) {
                return interaction.editReply({
                    content: '⚡ No eligible users found in the last 25 messages to shock!'
                });
            }

            // Pick a random user
            const usersArray = Array.from(uniqueUsers.values());
            const randomMember = usersArray[Math.floor(Math.random() * usersArray.length)];

            // Check if user shocked themselves
            const isSelfShock = randomMember.user.id === userId;

            // Pick a random move
            const moveNames = Object.keys(newParalysisMoves);
            const randomMoveName = moveNames[Math.floor(Math.random() * moveNames.length)];
            const moveData = newParalysisMoves[randomMoveName];

            // Set cooldown (do this before checking if move hits)
            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), cooldownAmount);

            // Check if the move hits
            if (!doesMoveHit(moveData.accuracy)) {
                // Move missed - Pokemon-style miss message
                const missMessages = [
                    `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\nBut it failed!`,
                    `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n**${interaction.user}**'s attack missed!`,
                    `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\nBut **${randomMember.user}** avoided the attack!`
                ];

                const randomMissMessage = missMessages[Math.floor(Math.random() * missMessages.length)];

                return interaction.editReply({
                    content: randomMissMessage
                });
            }

            // Check for critical hit
            const isCrit = isCriticalHit();

            // Calculate timeout duration based on power (and critical hit)
            const timeoutDuration = calculateTimeoutDuration(moveData.power, isCrit);
            const timeoutSeconds = timeoutDuration / 1000;

            // Timeout the user
            await randomMember.timeout(timeoutDuration, `Shocked by ${interaction.user.tag} using /shock command with ${randomMoveName}${isCrit ? ' (Critical Hit!)' : ''}`);

            // Save shock to MongoDB and get updated count
            const localMongo = MongoWrapper.getClient('local');
            const db = localMongo.db("lupos");
            const shocksCollection = db.collection('ShockGameStatistics');

            const result = await shocksCollection.findOneAndUpdate(
                {
                    userId: randomMember.user.id,
                    guildId: interaction.guildId
                },
                {
                    $inc: { shockCount: 1 },
                    $set: {
                        username: randomMember.user.username,
                        displayName: randomMember.displayName,
                        lastShockedAt: now,
                        lastShockedBy: userId,
                        lastShockedByUsername: interaction.user.username,
                        lastShockedByDisplayName: interaction.member.displayName,
                        lastMove: randomMoveName,
                        lastMovePower: moveData.power,
                        lastTimeoutDuration: timeoutSeconds,
                        lastWasCritical: isCrit
                    },
                    $setOnInsert: {
                        createdAt: now
                    }
                },
                {
                    upsert: true,
                    returnDocument: 'after'
                }
            );

            const shockCount = result.shockCount;

            // Format message differently for self-shock (like confusion self-damage)
            let battleMessage;

            if (isSelfShock) {
                battleMessage =
                    `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n` +
                    (isCrit ? `A critical hit!\n` : '') +
                    `**${interaction.user}** is confused**!**\n` +
                    `It hurt itself in its confusion**!**\n` +
                    `**${interaction.user}** is paralyzed**!** It can't move for the next ${timeoutSeconds} second${timeoutSeconds !== 1 ? 's' : ''}**!**\n\n`;
            } else {
                battleMessage =
                    `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n` +
                    (isCrit ? `A critical hit!\n` : '') +
                    `Enemy **${randomMember.user}** is paralyzed**!** It may not attack**!**\n` +
                    `The wild **${randomMember.user}** is paralyzed**!**\n` +
                    `It can't move for the next ${timeoutSeconds} second${timeoutSeconds !== 1 ? 's' : ''}**!**\n\n`;
            }

            // Add power and accuracy info
            // battleMessage += `-# *Move Power: ${moveData.power} | Accuracy: ${moveData.accuracy}%*`;

            await interaction.editReply({
                content: battleMessage
            });

        } catch (error) {
            console.error('Error executing shock command:', error);

            let errorMessage = '⚡ An error occurred while trying to shock someone.';

            if (error.code === 50013) {
                errorMessage = '⚡ I don\'t have permission to timeout this member!';
            } else if (error.code === 10008) {
                errorMessage = '⚡ The selected user could not be found!';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
