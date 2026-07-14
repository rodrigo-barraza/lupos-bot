/**
 * Slash-command handlers for /deathroll, /deathrollstats, and
 * /deathrollleaderboard. Thin orchestration over the repository,
 * render, and gameState modules.
 */

import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import config from "#root/config.js";
import { truncateAtLineBoundary } from "../commandUtils.ts";
import {
  BASE_TIMEOUT_MINUTES,
  PLACEMENT_GAMES,
  UNRANKED_DISPLAY,
  formatStatsString,
  formatStreak,
} from "./mmr.ts";
import {
  fetchLeaderboard,
  fetchSinglePlayerStats,
  fetchTopRivals,
} from "./repository.ts";
import type { RankedPlayer } from "./repository.ts";
import { buildEngageDeclineRow } from "./render.ts";
import { createEngageCollector, createGame } from "./gameState.ts";

/**
 * /deathroll command handler
 */
export async function executeDeathroll(
  interaction: ChatInputCommandInteraction,
) {
  const userId = interaction.user.id;
  const now = Date.now();
  const startingNumber = interaction.options.getInteger("number") || 100;
  const targetUser = interaction.options.getUser("opponent");

  await interaction.deferReply();

  if (
    !interaction.guild!.members.me?.permissions.has(
      PermissionFlagsBits.ModerateMembers,
    )
  ) {
    return interaction.editReply({
      content: "🎲 I don't have permission to timeout members!",
    });
  }

  const member = interaction.member as GuildMember;
  if (!member || !member.moderatable) {
    return interaction.editReply({
      content:
        "🎲 You can't be timed out (you have higher permissions), so you can't play deathroll!",
    });
  }

  let targetMember = null;
  if (targetUser) {
    if (targetUser.id === userId) {
      return interaction.editReply({
        content: "🎲 You can't challenge yourself!",
      });
    }
    if (targetUser.bot) {
      return interaction.editReply({
        content: "🎲 You can't challenge a bot!",
      });
    }

    targetMember = await interaction
      .guild!.members.fetch(targetUser.id)
      .catch(() => null);

    if (!targetMember) {
      return interaction.editReply({
        content: "🎲 That user is not in this server!",
      });
    }
    if (!targetMember.moderatable) {
      return interaction.editReply({
        content:
          "🎲 That user can't be timed out (they have higher permissions)!",
      });
    }
  }

  const guildId = interaction.guild!.id;
  const initiatorStats = await fetchSinglePlayerStats(guildId, userId);
  const targetStats = targetUser
    ? await fetchSinglePlayerStats(guildId, targetUser.id)
    : null;

  const buttonLabel =
    targetUser && targetMember
      ? `Accept Deathroll ${targetMember.displayName} (0-${startingNumber})`
      : `Accept Deathroll (0-${startingNumber})`;

  const initiatorRecord = formatStatsString(initiatorStats || {});
  let content = `🎲 <@${interaction.user.id}>${initiatorRecord} has started a deathroll from **${startingNumber}**!\n\n`;

  if (targetUser) {
    const targetRecord = formatStatsString(targetStats || {});
    content +=
      `<@${targetUser.id}>${targetRecord}, you have been challenged!\n` +
      `Click the button below to accept or decline! The loser gets timed out for ${BASE_TIMEOUT_MINUTES} minutes.`;
  } else {
    content += `Click the button below to engage! The loser gets timed out for ${BASE_TIMEOUT_MINUTES} minutes.`;
  }

  const reply = await interaction.editReply({
    content,
    components: buildEngageDeclineRow(interaction.id, buttonLabel),
  });

  const gameId = `${interaction.channelId}_${interaction.id}`;
  createGame(
    gameId,
    guildId,
    {
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
      timeoutMultiplier: 1,
    },
    "pending",
  );

  createEngageCollector(reply, gameId, interaction);
}

/**
 * /deathrollstats command handler
 */
export async function executeDeathrollStats(
  interaction: ChatInputCommandInteraction,
) {
  const targetUser = interaction.options.getUser("user") || interaction.user;
  const guildId = interaction.guildId;

  await interaction.deferReply();

  if (!guildId) {
    return interaction.editReply({
      content: "🎲 This command can only be used in a server!",
    });
  }

  try {
    const profile = await fetchSinglePlayerStats(guildId, targetUser.id);

    const embed = new EmbedBuilder()
      .setTitle(`🎲 Deathroll Stats · Season ${config.DEATHROLL_SEASON}`)
      .setColor(0xe74c3c)
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .setTimestamp();

    if (!profile || profile.totalGames === 0) {
      embed.setDescription(
        `<@${targetUser.id}> hasn't played any deathroll games yet!`,
      );
      return interaction.editReply({ embeds: [embed] });
    }

    const mostPlayed = await fetchTopRivals(guildId, targetUser.id, 3);

    let description = `<@${targetUser.id}>\n`;

    if (profile.isPlacement) {
      description += `## ${UNRANKED_DISPLAY.emoji} ${UNRANKED_DISPLAY.title}\n`;
      description += `**Placement:** ${profile.totalGames}/${PLACEMENT_GAMES} games\n\n`;
    } else {
      description += `## ${profile.rank.emoji} ${profile.rank.title}\n`;
      description += `**${profile.mmr}** MMR\n\n`;
    }

    description += `**Record:** ${profile.wins}W / ${profile.losses}L (${profile.winRate}%)\n`;
    description += `**Games Played:** ${profile.totalGames}\n`;

    const streakStr = formatStreak(profile.currentStreak);
    if (!profile.isPlacement) {
      description += `**Rank Confidence:** ${profile.confidence}%\n`;
    }
    description += `**Current Streak:** ${streakStr || "None"}\n`;
    description += `**Best Win Streak:** ${profile.bestStreak > 0 ? `🔥×${profile.bestStreak}` : "None"}\n`;

    if ((profile.multiplierGames || 0) > 0) {
      description += `**Double or Nothing:** ${profile.multiplierWins || 0}W / ${profile.multiplierLosses || 0}L\n`;
    }

    if (profile.lastPlayedAt) {
      description += `**Last Played:** <t:${Math.floor(profile.lastPlayedAt / 1000)}:R>\n`;
    }
    if (profile.createdAt) {
      description += `**First Game:** <t:${Math.floor(profile.createdAt / 1000)}:D>\n`;
    }

    embed.setDescription(description);

    if (mostPlayed.length > 0) {
      const rivalLines = (
        mostPlayed as unknown as {
          _id: string;
          name: string;
          games: number;
          winsAgainst: number;
        }[]
      ).map((opp, i) => {
        const lossesAgainst = opp.games - opp.winsAgainst;
        return `**${i + 1}.** <@${opp._id}> — ${opp.games} games (${opp.winsAgainst}W / ${lossesAgainst}L)`;
      });
      embed.addFields({ name: "⚔️ Top Rivals", value: rivalLines.join("\n") });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error("Error fetching deathroll stats:", error);
    await interaction.editReply({
      content:
        "An error occurred while fetching stats. Please try again later.",
    });
  }
}

/**
 * /deathrollleaderboard command handler
 */
export async function executeDeathrollLeaderboard(
  interaction: ChatInputCommandInteraction,
) {
  await interaction.deferReply();

  try {
    const { ranked, totalGamesPlayed } = await fetchLeaderboard(
      interaction.guildId!,
      0,
    );

    const embed = new EmbedBuilder()
      .setTitle(`🎲 Deathroll Leaderboard · Season ${config.DEATHROLL_SEASON}`)
      .setColor(0xe74c3c)
      .setTimestamp();

    if (!ranked || ranked.length === 0) {
      embed.setDescription("No deathroll games have been played yet!");
      return interaction.editReply({ embeds: [embed] });
    }

    // Separate ranked (completed placement) from unranked (still placing)
    const rankedPlayers = ranked.filter(
      (p: RankedPlayer) => !p.profile.isPlacement,
    );
    const unrankedPlayers = ranked.filter(
      (p: RankedPlayer) => p.profile.isPlacement,
    );

    // Top 10: ranked players only
    const topPlayers = rankedPlayers.slice(0, 10);

    // Bottom 10: ranked players from the bottom, then unranked below
    const bottomRanked =
      rankedPlayers.length > 10
        ? rankedPlayers.slice(Math.max(10, rankedPlayers.length - 10))
        : [];

    const formatRankedLine = (player: RankedPlayer, index: number) => {
      const profile = player.profile;
      const streak = formatStreak(profile.currentStreak);
      const lastPlayed = profile.lastPlayedAt
        ? `<t:${Math.floor(profile.lastPlayedAt / 1000)}:R>`
        : "Never";
      const don =
        (profile.multiplierGames ?? 0) > 0
          ? ` · 🎰 ${profile.multiplierWins}W/${profile.multiplierLosses}L`
          : "";

      return `**${index + 1}.** ${profile.rank.emoji} <@${player.userId}> — ${profile.mmr} MMR (${profile.confidence}%)\n-# ${profile.wins}W / ${profile.losses}L (${profile.winRate}%) · ${profile.totalGames} games${streak ? " · " + streak : ""}${don} · ${lastPlayed}`;
    };

    const formatUnrankedLine = (player: RankedPlayer) => {
      const profile = player.profile;
      const streak = formatStreak(profile.currentStreak);
      const lastPlayed = profile.lastPlayedAt
        ? `<t:${Math.floor(profile.lastPlayedAt / 1000)}:R>`
        : "Never";

      return `   ${UNRANKED_DISPLAY.emoji} <@${player.userId}> — **${profile.totalGames}/${PLACEMENT_GAMES}** placement games\n-# ${profile.wins}W / ${profile.losses}L${streak ? " · " + streak : ""} · ${lastPlayed}`;
    };

    const topLines = topPlayers.map((p: RankedPlayer, i: number) =>
      formatRankedLine(p, i),
    );

    let finalDescription = `**Ranked Players:** ${rankedPlayers.length}${unrankedPlayers.length > 0 ? ` · **Placing:** ${unrankedPlayers.length}` : ""} · **Total Games:** ${totalGamesPlayed}\nRanked by MMR.\n\n`;
    finalDescription += `**🏆 Top 10**\n` + topLines.join("\n");

    if (bottomRanked.length > 0) {
      const bottomLines = bottomRanked.map((p: RankedPlayer) => {
        const index = rankedPlayers.indexOf(p);
        return formatRankedLine(p, index);
      });
      finalDescription += `\n\n**💀 Bottom 10**\n` + bottomLines.join("\n");
    }

    if (unrankedPlayers.length > 0) {
      unrankedPlayers.sort(
        (a: RankedPlayer, b: RankedPlayer) =>
          b.profile.totalGames - a.profile.totalGames,
      );
      const unrankedLines = unrankedPlayers.map(formatUnrankedLine);
      finalDescription +=
        `\n\n**${UNRANKED_DISPLAY.emoji} Unranked (Placing)**\n` +
        unrankedLines.join("\n");
    }

    finalDescription += `\n\n-# 🔥×N Win streak · 💀×N Loss streak · 🎰 Double or Nothing`;

    // Cap at Discord's 4096-char embed description limit (API error 50035
    // on big guilds otherwise).
    embed.setDescription(truncateAtLineBoundary(finalDescription));

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error("Error fetching deathroll leaderboard:", error);
    await interaction.editReply({
      content:
        "An error occurred while fetching the deathroll leaderboard. Please try again later.",
    });
  }
}
