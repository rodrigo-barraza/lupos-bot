import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import MongoWrapper from '#/wrappers/MongoWrapper.js';

// How many votes needed to trigger timeout
const VOTES_REQUIRED = 3;

const multiHitMoves = {
    // 1-10 hits
    'POPULATION BOMB': '🐭',

    // 2-5 hits
    'BULLET SEED': '🌱',
    'ICICLE SPEAR': '🧊',
    'ROCK BLAST': '🪨',
    'PIN MISSILE': '📌',
    'FURY ATTACK': '🦅',
    'FURY SWIPES': '😾',
    'BARRAGE': '🥚',
    'SPIKE CANNON': '🔫',
    'TAIL SLAP': '🦎',
    'SCALE SHOT': '🐉',
    'BONE RUSH': '🦴',
    'WATER SHURIKEN': '💧',
    'ARM THRUST': '🤜',         // MISSING
    'COMET PUNCH': '☄️',        // MISSING

    // 2 hits
    'DOUBLE KICK': '👟',
    'DUAL CHOP': '🪓',
    'BONEMERANG': '🪃',
    'TWINEEDLE': '🐝',
    'DOUBLE HIT': '💥',
    'DUAL WINGBEAT': '🦅',
    'GEAR GRIND': '⚙️',
    'DOUBLE IRON BASH': '🔨',  // MISSING

    // 3 hits
    'TRIPLE AXEL': '⛸️',
    'TRIPLE KICK': '🦵',
    'SURGING STRIKES': '🌊',
    'TRIPLE DIVE': '🌀',

    // 2 hits, other
    'DRAGON DARTS': '🎯',

    // unique mechanic
    'BEAT UP': '👥'
};

// Helper function to get random move
function getRandomMove() {
    const moves = Object.keys(multiHitMoves);
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    return {
        name: randomMove,
        emoji: multiHitMoves[randomMove]
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('beatup')
        .setDescription('Vote to time out a user for 1 minute (requires 3 votes)')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to vote against')
                .setRequired(true)),

    async execute(interaction) {
        const voterId = interaction.user.id;
        const target = interaction.options.getMember('target');
        const now = Date.now();
        const cooldownAmount = 1 * 60 * 60 * 1000; // 1 hours

        // Validate target
        if (!target) {
            return interaction.reply({
                content: '❌ That user is not in this server!',
                ephemeral: true
            });
        }

        if (target.user.bot) {
            return interaction.reply({
                content: '❌ You can\'t beat up a bot!',
                ephemeral: true
            });
        }

        if (target.user.id === interaction.guild.ownerId) {
            return interaction.reply({
                content: '❌ You can\'t beat up the server owner!',
                ephemeral: true
            });
        }

        if (target.user.id === voterId) {
            return interaction.reply({
                content: '❌ You can\'t beat yourself up! (Well, not like this anyway)',
                ephemeral: true
            });
        }

        if (!target.moderatable) {
            return interaction.reply({
                content: '❌ I don\'t have permission to timeout this user!',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const localMongo = MongoWrapper.getClient('local');
            const db = localMongo.db("lupos");
            const beatupVotesCollection = db.collection('BeatUpGameVotes');
            const beatupCooldownsCollection = db.collection('BeatUpGameCooldowns');

            // Check if voter is on cooldown
            const voterCooldown = await beatupCooldownsCollection.findOne({
                userId: voterId,
                guildId: interaction.guildId,
                type: 'voter'
            });

            if (voterCooldown && (now - voterCooldown.lastVoteTime) < cooldownAmount) {
                const timeLeft = ((cooldownAmount - (now - voterCooldown.lastVoteTime)) / 1000 / 60 / 60).toFixed(1);
                return interaction.editReply({
                    content: `⏰ You can vote again in **${timeLeft}** hour(s)!`,
                    ephemeral: true
                });
            }

            // Check if target is on cooldown (was recently timed out)
            const targetCooldown = await beatupCooldownsCollection.findOne({
                userId: target.user.id,
                guildId: interaction.guildId,
                type: 'target'
            });

            if (targetCooldown && (now - targetCooldown.lastTimeoutTime) < cooldownAmount) {
                const timeLeft = ((cooldownAmount - (now - targetCooldown.lastTimeoutTime)) / 1000 / 60 / 60).toFixed(1);
                return interaction.editReply({
                    // There's no will to fight!
                    content: `🛡️ **${target.user.username}** was recently beaten up! They're safe for another **${timeLeft}** hour(s).`,
                    ephemeral: true
                });
            }

            // Get current votes for target
            const voteDoc = await beatupVotesCollection.findOne({
                targetId: target.user.id,
                guildId: interaction.guildId
            });

            let currentVotes = [];
            if (voteDoc) {
                // Filter out expired votes (older than 24 hours)
                currentVotes = voteDoc.votes.filter(vote =>
                    (now - vote.timestamp) < cooldownAmount
                );
            }

            // Check if user already voted
            if (currentVotes.some(vote => vote.voterId === voterId)) {
                return interaction.editReply({
                    content: `❌ You've already voted to beat up **${target.user.username}**!`,
                    ephemeral: true
                });
            }

            // Get random move
            const move = getRandomMove();

            // Add new vote
            currentVotes.push({
                voterId: voterId,
                voterUsername: interaction.user.username,
                timestamp: now
            });

            // Update votes in database
            await beatupVotesCollection.updateOne(
                {
                    targetId: target.user.id,
                    guildId: interaction.guildId
                },
                {
                    $set: {
                        targetUsername: target.user.username,
                        votes: currentVotes,
                        updatedAt: now
                    }
                },
                { upsert: true }
            );

            // Update voter cooldown
            await beatupCooldownsCollection.updateOne(
                {
                    userId: voterId,
                    guildId: interaction.guildId,
                    type: 'voter'
                },
                {
                    $set: {
                        username: interaction.user.username,
                        lastVoteTime: now
                    }
                },
                { upsert: true }
            );

            const votesNeeded = VOTES_REQUIRED - currentVotes.length;

            // Check if we have enough votes
            if (currentVotes.length >= VOTES_REQUIRED) {
                // Check bot permissions one more time
                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return interaction.editReply({
                        content: '❌ I don\'t have permission to timeout members!'
                    });
                }

                // Timeout for 1 minute (60000 milliseconds)
                await target.timeout(60000, `Beat up by ${currentVotes.length} users via /beatup command`);

                // Record target cooldown
                await beatupCooldownsCollection.updateOne(
                    {
                        userId: target.user.id,
                        guildId: interaction.guildId,
                        type: 'target'
                    },
                    {
                        $set: {
                            username: target.user.username,
                            lastTimeoutTime: now
                        }
                    },
                    { upsert: true }
                );

                // Clear votes for this target
                await beatupVotesCollection.deleteOne({
                    targetId: target.user.id,
                    guildId: interaction.guildId
                });

                // Format battle message
                let battleMessage = '';

                // Show all previous voters' attacks (without specific moves)
                if (currentVotes.length > 1) {
                    const previousAttacks = currentVotes
                        .slice(0, -1)
                        .map(vote => `<@${vote.voterId}>'s attack!`)
                        .join('\n');
                    battleMessage += previousAttacks + '\n';
                }

                // Show the last voter's specific move
                battleMessage += `<@${voterId}> used **${move.name}** ${move.emoji}**!**\n`;
                battleMessage += `Enemy ${target.user} has been ganged up on!\n`;
                battleMessage += `It can't move for the next **1** minute!`;

                await interaction.editReply({ content: battleMessage });

            } else {
                // Not enough votes yet
                await interaction.editReply({
                    content:
                        `${interaction.user} used **${move.name}** ${move.emoji}**!**\n` +
                        `Enemy ${target.user} is being ganged up on**!**\n` +
                        `**${votesNeeded}** more hit${votesNeeded === 1 ? '' : 's'} are required to knock enemy ${target.user} out**!**`
                });
            }

        } catch (error) {
            console.error('Error executing beatup command:', error);

            let errorMessage = '❌ An error occurred while processing the vote.';

            if (error.code === 50013) {
                errorMessage = '❌ I don\'t have permission to timeout this member!';
            } else if (error.code === 10008) {
                errorMessage = '❌ The selected user could not be found!';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};