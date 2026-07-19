import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
} from "discord.js";
import { getMongoDb, tryTimeoutMember } from "./commandUtils.ts";
import { adjustGold, fetchWallet } from "./gold/goldRepository.ts";
import {
  SHOCK_CRIT_BONUS_GOLD,
  SHOCK_CRIT_CONSOLATION_GOLD,
  computeScatterPileCount,
  computeShockDropGold,
  computeShockMissDropGold,
  formatGold,
} from "./gold/goldMath.ts";
import {
  buildScatterAssignments,
  creditScatter,
  formatScatterLine,
  pickScatterTargets,
} from "./gold/goldScatter.ts";
import type { ScatterTarget } from "./gold/goldScatter.ts";

/**
 * Everyone who spoke recently except the dropper and bots — broader than
 * the shockable pool (mods and timed-out members can still pick up gold).
 * The Lupos bot itself (`allowBotId`) is eligible: the wolf snatches
 * scattered gold into his hoard like anyone else.
 */
function buildBystanderPool(
  recentMessages: Message[],
  excludeId: string,
  allowBotId?: string,
): ScatterTarget[] {
  const pool = new Map<string, ScatterTarget>();
  for (const message of recentMessages) {
    if (message.author.id === excludeId) continue;
    if (message.author.bot && message.author.id !== allowBotId) continue;
    pool.set(message.author.id, {
      userId: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.username,
    });
  }
  return Array.from(pool.values());
}

// Per-user cooldown, enforced centrally by the dispatcher via cooldownSeconds
const COOLDOWN_SECONDS = 5 * 60; // 5 minutes

const newParalysisMoves = {
  "BODY SLAM": { emoji: "💥", power: 85, accuracy: 100 },
  "BOLT STRIKE": { emoji: "⚡", power: 130, accuracy: 85 },
  BOUNCE: { emoji: "🦘", power: 85, accuracy: 85 },
  "BUZZY BUZZ": { emoji: "🐝", power: 60, accuracy: 100 },
  "COMBAT TORQUE": { emoji: "🔧", power: 100, accuracy: 100 },
  "DIRE CLAW": { emoji: "🩸", power: 80, accuracy: 100 },
  DISCHARGE: { emoji: "🔋", power: 80, accuracy: 100 },
  "DRAGON BREATH": { emoji: "🐉", power: 60, accuracy: 100 },
  FLING: { emoji: "🪃", power: "Varies", accuracy: 100 },
  "FORCE PALM": { emoji: "👊", power: 60, accuracy: 100 },
  "FREEZE SHOCK": { emoji: "❄️", power: 140, accuracy: 90 },
  GLARE: { emoji: "👁️", power: 0, accuracy: 100 },
  LICK: { emoji: "👅", power: 30, accuracy: 100 },
  NUZZLE: { emoji: "🐭", power: 20, accuracy: 100 },
  "PSYCHO SHIFT": { emoji: "🧠", power: 0, accuracy: 100 },
  "SECRET POWER": { emoji: "🤫", power: 70, accuracy: 100 },
  "SHADOW BOLT": { emoji: "👻", power: 70, accuracy: 100 },
  SPARK: { emoji: "✨", power: 65, accuracy: 100 },
  "SPLISHY SPLASH": { emoji: "💦", power: 90, accuracy: 100 },
  "STOKED SPARKSURFER": { emoji: "🏄", power: 175, accuracy: 100 },
  "STUN SPORE": { emoji: "🍄", power: 0, accuracy: 75 },
  THUNDER: { emoji: "🌩️", power: 110, accuracy: 70 },
  "THUNDER FANG": { emoji: "🦷", power: 65, accuracy: 95 },
  "THUNDER PUNCH": { emoji: "👊", power: 75, accuracy: 100 },
  "THUNDER SHOCK": { emoji: "⚡", power: 40, accuracy: 100 },
  "THUNDER WAVE": { emoji: "〰️", power: 0, accuracy: 90 },
  THUNDERBOLT: { emoji: "⚡", power: 90, accuracy: 100 },
  "TRI ATTACK": { emoji: "🔺", power: 80, accuracy: 100 },
  "VOLT TACKLE": { emoji: "💥", power: 120, accuracy: 100 },
  "WILDBOLT STORM": { emoji: "🌪️", power: 100, accuracy: 80 },
  "ZAP CANNON": { emoji: "🔫", power: 120, accuracy: 50 },
};

// Calculate timeout duration based on move power (1-10 seconds)
function calculateTimeoutDuration(
  power: number | string,
  isCritical: boolean = false,
) {
  if (power === "Varies") {
    return isCritical ? 7500 : 5000; // 7.5 or 5 seconds for variable power moves
  }

  const numericPower = typeof power === "number" ? power : Number(power) || 0;

  if (numericPower === 0) {
    return isCritical ? 1500 : 1000; // 1.5 or 1 second for status moves
  }

  // Scale from 1 to 10 seconds based on power (20-175 range)
  const minPower = 20;
  const maxPower = 175;
  const minTimeout = 1;
  const maxTimeout = 10;

  const scaledTimeout =
    minTimeout +
    ((numericPower - minPower) / (maxPower - minPower)) *
      (maxTimeout - minTimeout);
  const timeoutSeconds = Math.min(
    maxTimeout,
    Math.max(minTimeout, Math.round(scaledTimeout)),
  );

  // Critical hits do 1.5x timeout duration
  const finalTimeout = isCritical ? timeoutSeconds * 1.5 : timeoutSeconds;

  return finalTimeout * 1000; // Convert to milliseconds
}

// Check if move hits based on accuracy
function doesMoveHit(accuracy: number) {
  const roll = Math.floor(Math.random() * 100) + 1; // Roll 1-100
  return roll <= accuracy;
}

// Check if move is a critical hit (6.25% chance)
function isCriticalHit() {
  return Math.random() < 0.0625; // 6.25% chance
}

export default {
  data: new SlashCommandBuilder()
    .setName("shock")
    .setDescription("Paralyzes a random person from the recent conversation"),

  guildOnly: true,
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldownSeconds: COOLDOWN_SECONDS,

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild!;
    const userId = interaction.user.id;
    const now = Date.now();

    await interaction.deferReply();

    if (!interaction.channel) {
      return interaction.editReply({
        content: "⚡ This command can only be used in a text channel!",
      });
    }

    // Fetch last 25 messages from the channel
    const messages = await interaction.channel.messages.fetch({ limit: 25 });

    // Get unique users from messages (exclude bots)
    const uniqueUsers = new Map<string, GuildMember>();

    for (const message of messages.values()) {
      const member = message.member;

      // Skip if:
      // - No member object
      // - User is a bot
      // - User is the guild owner
      // - User is already timed out
      if (
        !member ||
        message.author.bot ||
        message.author.id === guild.ownerId
      ) {
        continue;
      }

      // Skip if user is already timed out
      if (
        member.communicationDisabledUntil &&
        member.communicationDisabledUntil.getTime() > now
      ) {
        continue;
      }

      // Check if member can be timed out by the bot
      if (member.moderatable) {
        uniqueUsers.set(message.author.id, member);
      }
    }

    if (uniqueUsers.size === 0) {
      return interaction.editReply({
        content: "⚡ No eligible users found in the last 25 messages to shock!",
      });
    }

    // Pick a random user
    const usersArray = Array.from(uniqueUsers.values());
    const randomMember =
      usersArray[Math.floor(Math.random() * usersArray.length)];

    // Check if user shocked themselves
    const isSelfShock = randomMember.user.id === userId;

    // Pick a random move
    const moveNames = Object.keys(newParalysisMoves);
    const randomMoveName =
      moveNames[Math.floor(Math.random() * moveNames.length)];
    const moveData =
      newParalysisMoves[randomMoveName as keyof typeof newParalysisMoves];

    // Check if the move hits
    if (!doesMoveHit(moveData.accuracy)) {
      // Move missed - Pokemon-style miss message
      const missMessages = [
        `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\nBut it failed!`,
        `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n**${interaction.user}**'s attack missed!`,
        `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\nBut **${randomMember.user}** avoided the attack!`,
      ];

      let missMessage =
        missMessages[Math.floor(Math.random() * missMessages.length)];

      // Fumble tax: a whiff still drops gold — scaled by the timeout the
      // move would have dealt — scattered to bystanders. High-power,
      // low-accuracy moves are a genuine gamble now.
      const wouldBeSeconds =
        calculateTimeoutDuration(moveData.power, false) / 1000;
      const wallet = await fetchWallet(interaction.guildId!, userId);
      const fumbleDrop = computeShockMissDropGold(
        wouldBeSeconds,
        wallet?.balance ?? 0,
      );

      if (fumbleDrop > 0) {
        const debit = await adjustGold(
          interaction.guildId!,
          userId,
          -fumbleDrop,
          "shock_drop",
          {
            userInfo: {
              username: interaction.user.username,
              displayName: (interaction.member as GuildMember).displayName,
            },
            meta: { cause: "miss" },
          },
        );
        if (debit.ok) {
          const pool = buildBystanderPool(
            Array.from(messages.values()),
            userId,
            interaction.client.user?.id,
          );
          const targets = pickScatterTargets(
            pool,
            computeScatterPileCount(fumbleDrop, pool.length),
          );
          if (targets.length > 0) {
            const assignments = buildScatterAssignments(fumbleDrop, targets);
            await creditScatter(
              interaction.guildId!,
              assignments,
              "shock_pickup",
              {
                droppedBy: userId,
                cause: "miss",
              },
            );
            missMessage += `\n💸 In the fumble, **${interaction.user}** dropped **${formatGold(fumbleDrop)}**... ${formatScatterLine(assignments)}`;
          } else {
            missMessage += `\n💸 In the fumble, **${interaction.user}** dropped **${formatGold(fumbleDrop)}**... nobody was around, and it sinks into the floor.`;
          }
        }
      }

      return interaction.editReply({
        content: missMessage,
      });
    }

    // Check for critical hit
    const isCrit = isCriticalHit();

    // Calculate timeout duration based on power (and critical hit)
    const timeoutDuration = calculateTimeoutDuration(moveData.power, isCrit);
    const timeoutSeconds = timeoutDuration / 1000;

    // Timeout the user
    const timeoutResult = await tryTimeoutMember(
      randomMember,
      timeoutDuration,
      `Shocked by ${interaction.user.tag} using /shock command with ${randomMoveName}${isCrit ? " (Critical Hit!)" : ""}`,
    );

    if (!timeoutResult.ok) {
      return interaction.editReply({
        content:
          timeoutResult.error === "missing permissions"
            ? "⚡ I don't have permission to timeout this member!"
            : "⚡ An error occurred while trying to shock someone.",
      });
    }

    // Save shock to MongoDB and get updated count
    const db = getMongoDb();
    const shocksCollection = db.collection("ShockGameStatistics");

    await shocksCollection.findOneAndUpdate(
      {
        userId: randomMember.user.id,
        guildId: interaction.guildId,
      },
      {
        $inc: { shockCount: 1 },
        $set: {
          username: randomMember.user.username,
          displayName: randomMember.displayName,
          lastShockedAt: now,
          lastShockedBy: userId,
          lastShockedByUsername: interaction.user.username,
          lastShockedByDisplayName: (interaction.member as GuildMember)
            .displayName,
          lastMove: randomMoveName,
          lastMovePower: moveData.power,
          lastTimeoutDuration: timeoutSeconds,
          lastWasCritical: isCrit,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      },
    );

    // Format message differently for self-shock (like confusion self-damage)
    let battleMessage: string;

    if (isSelfShock) {
      battleMessage =
        `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n` +
        (isCrit ? `A critical hit!\n` : "") +
        `**${interaction.user}** is confused**!**\n` +
        `It hurt itself in its confusion**!**\n` +
        `**${interaction.user}** is paralyzed**!** It can't move for the next ${timeoutSeconds} second${timeoutSeconds !== 1 ? "s" : ""}**!**\n\n`;

      // Backfire punishment: the self-shocker drops gold, and it scatters
      // across the recent conversation — big drops shower up to 4 people.
      // No buttons, no interruption — one punchline line on the existing
      // message. With no bystanders around, the gold burns instead.
      const wallet = await fetchWallet(interaction.guildId!, userId);
      const dropAmount = computeShockDropGold(
        timeoutSeconds,
        wallet?.balance ?? 0,
      );

      if (dropAmount > 0) {
        const debit = await adjustGold(
          interaction.guildId!,
          userId,
          -dropAmount,
          "shock_drop",
          {
            userInfo: {
              username: interaction.user.username,
              displayName: (interaction.member as GuildMember).displayName,
            },
            meta: { cause: "self" },
          },
        );
        if (debit.ok) {
          const pool = buildBystanderPool(
            Array.from(messages.values()),
            userId,
            interaction.client.user?.id,
          );
          const targets = pickScatterTargets(
            pool,
            computeScatterPileCount(dropAmount, pool.length),
          );
          if (targets.length > 0) {
            const assignments = buildScatterAssignments(dropAmount, targets);
            await creditScatter(
              interaction.guildId!,
              assignments,
              "shock_pickup",
              {
                droppedBy: userId,
                cause: "self",
              },
            );
            battleMessage += `💰 **${interaction.user}** dropped **${formatGold(dropAmount)}** in the chaos... ${formatScatterLine(assignments)}`;
          } else {
            battleMessage += `💰 **${interaction.user}** dropped **${formatGold(dropAmount)}** in the chaos... nobody was around, and it sinks into the floor.`;
          }
        }
      } else {
        battleMessage += `💰 **${interaction.user}** fumbled for gold to drop... but their pouch is empty!`;
      }
    } else {
      battleMessage =
        `**${interaction.user}** used **${randomMoveName}** ${moveData.emoji}**!**\n` +
        (isCrit ? `A critical hit!\n` : "") +
        `Enemy **${randomMember.user}** is paralyzed**!** It may not attack**!**\n` +
        `The wild **${randomMember.user}** is paralyzed**!**\n` +
        `It can't move for the next ${timeoutSeconds} second${timeoutSeconds !== 1 ? "s" : ""}**!**\n\n`;

      // Critical hits pay out: a house bounty for the sharpshooter and an
      // insurance payout for the fried victim. Fire-and-forget — the
      // shock itself must never fail on the economy.
      if (isCrit) {
        adjustGold(
          interaction.guildId!,
          userId,
          SHOCK_CRIT_BONUS_GOLD,
          "shock_crit_bonus",
          {
            userInfo: {
              username: interaction.user.username,
              displayName: (interaction.member as GuildMember).displayName,
            },
          },
        ).catch(() => {});
        adjustGold(
          interaction.guildId!,
          randomMember.user.id,
          SHOCK_CRIT_CONSOLATION_GOLD,
          "shock_consolation",
          {
            userInfo: {
              username: randomMember.user.username,
              displayName: randomMember.displayName,
            },
          },
        ).catch(() => {});
        battleMessage += `🪙 Critical bounty: **+${SHOCK_CRIT_BONUS_GOLD}g** for ${interaction.user} · **+${SHOCK_CRIT_CONSOLATION_GOLD}g** insurance payout for ${randomMember.user}!`;
      }
    }

    await interaction.editReply({
      content: battleMessage,
    });
  },
};
