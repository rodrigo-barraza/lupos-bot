import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandIntegerOption,
  SlashCommandSubcommandBuilder,
  SlashCommandUserOption,
} from "discord.js";
import {
  buildLeaderboardEmbed,
  clearGameTimeoutRecord,
  fetchGameTimeout,
} from "./commandUtils.ts";
import {
  adjustGold,
  claimDaily,
  fetchGoldLeaderboard,
  fetchWallet,
  transferGold,
} from "./gold/goldRepository.ts";
import type { GoldLeaderboardEntry } from "./gold/goldRepository.ts";
import {
  DAILY_STREAK_BONUS,
  GOLD_COLOR,
  GOLD_EMOJI,
  RANSOM_GOLD_PER_MINUTE,
  computeRansomCost,
  formatGold,
} from "./gold/goldMath.ts";

async function executeBalance(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user") || interaction.user;
  const wallet = await fetchWallet(interaction.guildId!, targetUser.id);

  const embed = new EmbedBuilder()
    .setTitle(`${GOLD_EMOJI} Gold Balance`)
    .setColor(GOLD_COLOR)
    .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
    .setTimestamp();

  if (!wallet) {
    embed.setDescription(
      `<@${targetUser.id}> doesn't have a gold pouch yet!\nWin a deathroll, guess right in /guesswho, or claim /gold daily to start earning.`,
    );
  } else {
    let description = `<@${targetUser.id}>\n## ${formatGold(wallet.balance)}\n`;
    description += `**Lifetime Earned:** ${formatGold(wallet.lifetimeEarned)}\n`;
    if (wallet.dailyStreak > 0) {
      description += `**Daily Streak:** 🔥×${wallet.dailyStreak} (best ×${wallet.bestDailyStreak})\n`;
    }
    if (wallet.lastDailyAt) {
      description += `**Last Daily:** <t:${Math.floor(wallet.lastDailyAt / 1000)}:R>\n`;
    }
    embed.setDescription(description);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function executeDaily(interaction: ChatInputCommandInteraction) {
  const result = await claimDaily(interaction.guildId!, interaction.user.id, {
    username: interaction.user.username,
    displayName:
      (interaction.member as { displayName?: string } | null)?.displayName ??
      interaction.user.username,
  });

  if (!result.claimed) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} You already claimed your daily gold! Next claim <t:${Math.floor(result.nextClaimAt / 1000)}:R>.`,
    });
  }

  let content = `${GOLD_EMOJI} <@${interaction.user.id}> claimed **${formatGold(result.amount)}**!`;
  if (result.streak > 1) {
    content += ` 🔥 ${result.streak}-day streak (+${Math.min((result.streak - 1) * DAILY_STREAK_BONUS, 100)}g bonus)`;
  }
  content += `\n-# Balance: ${formatGold(result.balance)} · Next claim <t:${Math.floor(result.nextClaimAt / 1000)}:R>`;
  await interaction.editReply({ content });
}

async function executeGive(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);

  if (targetUser.id === interaction.user.id) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} You can't give gold to yourself!`,
    });
  }
  if (targetUser.bot) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} Bots have no use for gold!`,
    });
  }

  const result = await transferGold(
    interaction.guildId!,
    interaction.user.id,
    targetUser.id,
    amount,
    {
      username: interaction.user.username,
      displayName:
        (interaction.member as { displayName?: string } | null)?.displayName ??
        interaction.user.username,
    },
    { username: targetUser.username, displayName: targetUser.username },
  );

  if (!result.ok) {
    if (result.error === "insufficient") {
      const wallet = await fetchWallet(
        interaction.guildId!,
        interaction.user.id,
      );
      return interaction.editReply({
        content: `${GOLD_EMOJI} Not enough gold! You have ${formatGold(wallet?.balance ?? 0)}.`,
      });
    }
    return interaction.editReply({
      content: `${GOLD_EMOJI} Something went wrong with the transfer. Please try again.`,
    });
  }

  await interaction.editReply({
    content: `${GOLD_EMOJI} <@${interaction.user.id}> gave **${formatGold(amount)}** to <@${targetUser.id}>!\n-# Your balance: ${formatGold(result.balance)}`,
  });
}

async function executeRansom(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user", true);
  const guildId = interaction.guildId!;
  const now = Date.now();

  if (targetUser.bot) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} Bots can't be timed out, let alone ransomed!`,
    });
  }

  const member = (await interaction
    .guild!.members.fetch(targetUser.id)
    .catch(() => null)) as GuildMember | null;
  if (!member) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} That user is not in this server!`,
    });
  }

  const timedOutUntil = member.communicationDisabledUntilTimestamp;
  if (!timedOutUntil || timedOutUntil <= now) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} <@${targetUser.id}> isn't timed out — nothing to ransom!`,
    });
  }

  // Only game-issued timeouts can be bought out — a moderator timeout
  // extends past (or isn't in) the GameTimeouts record and stays put.
  const gameTimeout = await fetchGameTimeout(guildId, targetUser.id);
  const RECORD_SLACK_MS = 5_000;
  if (!gameTimeout || timedOutUntil > gameTimeout.until + RECORD_SLACK_MS) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} That timeout wasn't from a game — no amount of gold can buy out a moderator's justice!`,
    });
  }

  const remainingMs = timedOutUntil - now;
  const cost = computeRansomCost(remainingMs);

  const debit = await adjustGold(
    guildId,
    interaction.user.id,
    -cost,
    "ransom",
    {
      userInfo: {
        username: interaction.user.username,
        displayName:
          (interaction.member as { displayName?: string } | null)
            ?.displayName ?? interaction.user.username,
      },
      meta: { freed: targetUser.id, remainingMs },
    },
  );
  if (!debit.ok) {
    if (debit.error === "insufficient") {
      const wallet = await fetchWallet(guildId, interaction.user.id);
      return interaction.editReply({
        content: `${GOLD_EMOJI} Freeing <@${targetUser.id}> costs **${formatGold(cost)}** (${RANSOM_GOLD_PER_MINUTE}g/min) — you only have ${formatGold(wallet?.balance ?? 0)}!`,
      });
    }
    return interaction.editReply({
      content: `${GOLD_EMOJI} Something went wrong — no gold was taken. Please try again.`,
    });
  }

  try {
    await member.timeout(
      null,
      `Ransomed out of a game timeout by ${interaction.user.username} for ${cost}g`,
    );
  } catch (error: unknown) {
    console.error("[gold] Failed to lift ransomed timeout:", error);
    // The timeout couldn't be lifted — give the gold back.
    await adjustGold(guildId, interaction.user.id, cost, "ransom", {
      meta: { refundFailedRansomOf: targetUser.id },
    });
    return interaction.editReply({
      content: `${GOLD_EMOJI} I couldn't lift the timeout (permissions?) — your gold was refunded.`,
    });
  }

  clearGameTimeoutRecord(guildId, targetUser.id);

  const minutes = Math.ceil(remainingMs / 60_000);
  await interaction.editReply({
    content:
      `${GOLD_EMOJI} <@${interaction.user.id}> paid **${formatGold(cost)}** to ransom <@${targetUser.id}> out of their timeout ` +
      `(${minutes} minute${minutes !== 1 ? "s" : ""} remaining)! The gold burns in the house's forge. 🔥\n` +
      `-# Balance: ${formatGold(debit.balance)}`,
  });
}

async function executeLeaderboard(interaction: ChatInputCommandInteraction) {
  const { entries, totalWallets } = await fetchGoldLeaderboard(
    interaction.guildId!,
    15,
  );

  if (entries.length === 0) {
    return interaction.editReply({
      content: `${GOLD_EMOJI} No one has any gold yet! Claim /gold daily to get started.`,
    });
  }

  const embed = buildLeaderboardEmbed<GoldLeaderboardEntry>({
    title: `${GOLD_EMOJI} Gold Leaderboard`,
    color: GOLD_COLOR,
    description: `**Gold Pouches:** ${totalWallets}\nRanked by current balance.`,
    entries,
    formatLine: (entry: GoldLeaderboardEntry, index: number, medal: string) => {
      const streak = entry.dailyStreak > 0 ? ` · 🔥×${entry.dailyStreak}` : "";
      return `${medal} **${index + 1}.** <@${entry.userId}> — **${formatGold(entry.balance)}**\n-# Lifetime: ${formatGold(entry.lifetimeEarned)}${streak}`;
    },
    footer: "Earn gold from deathrolls, royales, guesswho, and daily claims",
  });

  await interaction.editReply({ embeds: [embed] });
}

export default {
  data: new SlashCommandBuilder()
    .setName("gold")
    .setDescription(
      "Server gold economy - earn, claim, gift, and flex your gold",
    )
    .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
      sub
        .setName("balance")
        .setDescription("Check a gold balance")
        .addUserOption((option: SlashCommandUserOption) =>
          option
            .setName("user")
            .setDescription("Whose balance to check (default: you)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
      sub.setName("daily").setDescription("Claim your daily gold reward"),
    )
    .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
      sub
        .setName("give")
        .setDescription("Give some of your gold to another member")
        .addUserOption((option: SlashCommandUserOption) =>
          option
            .setName("user")
            .setDescription("Who to give gold to")
            .setRequired(true),
        )
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("amount")
            .setDescription("How much gold to give")
            .setMinValue(1)
            .setMaxValue(1000000)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
      sub
        .setName("ransom")
        .setDescription(
          `Pay gold to free someone from a game timeout (${RANSOM_GOLD_PER_MINUTE}g per remaining minute)`,
        )
        .addUserOption((option: SlashCommandUserOption) =>
          option
            .setName("user")
            .setDescription("The timed-out member to free")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
      sub
        .setName("leaderboard")
        .setDescription("See the richest members of the server"),
    ),

  guildOnly: true,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "balance":
        return executeBalance(interaction);
      case "daily":
        return executeDaily(interaction);
      case "give":
        return executeGive(interaction);
      case "ransom":
        return executeRansom(interaction);
      case "leaderboard":
        return executeLeaderboard(interaction);
    }
  },
};
