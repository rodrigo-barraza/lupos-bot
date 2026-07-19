/**
 * Presentation layer for deathroll: game message formatting and
 * button-row builders.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  BASE_TIMEOUT_MINUTES,
  formatStatsString,
  formatStreak,
  getMultiplierName,
} from "./mmr.ts";
import type { GameState, PlayerProfile } from "./types.ts";

export interface EndGameDisplayStats {
  initiator?: PlayerProfile;
  opponent?: PlayerProfile;
  winnerRank?: string;
  loserRank?: string;
  winnerMmrChange?: string;
  loserMmrChange?: string;
  winnerStreak?: number;
  loserStreak?: number;
  winnerGold?: number;
  winnerPot?: number;
}

export function formatGameMessage(
  game: GameState,
  lastRoll: number,
  lastRoller: string | null | undefined,
  lastRollerId: string,
  isGameOver: boolean,
  stats: EndGameDisplayStats | null,
) {
  const timeoutMinutes = (game.timeoutMultiplier || 1) * BASE_TIMEOUT_MINUTES;
  let content = `🎲 **Deathroll Game**${game.timeoutMultiplier > 1 ? ` 🎰 **${getMultiplierName(game.timeoutMultiplier).toUpperCase()} OR NOTHING (${timeoutMinutes}min timeout)**` : ""}\n`;
  if (game.wager > 0) {
    content += `💰 **${game.wager}g wager each** — winner takes the pot\n`;
  }

  if (stats && !isGameOver) {
    const initiatorRecord = stats.initiator
      ? formatStatsString(stats.initiator as Partial<PlayerProfile>)
      : "";
    const opponentRecord = stats.opponent
      ? formatStatsString(stats.opponent as Partial<PlayerProfile>)
      : "";
    content += `<@${game.initiator}>${initiatorRecord}\nvs\n<@${game.opponent as string}>${opponentRecord}\n`;
  } else {
    content += `<@${game.initiator}>\nvs\n<@${game.opponent as string}>\n`;
  }

  if (game.h2h && (game.h2h.player1Wins > 0 || game.h2h.player2Wins > 0)) {
    content += `-# H2H: <@${game.initiator}> ${game.h2h.player1Wins} - ${game.h2h.player2Wins} <@${game.opponent as string}>\n`;
  }

  content += `Starting number: **${game.startingNumber}**\n\n`;
  content += `**Roll History:**\n`;
  for (let i = 0; i < game.rolls.length; i++) {
    const roll = game.rolls[i];
    const clutch = roll.roll === 1 ? " ⚡ **CLUTCH!**" : "";
    content += `-# ${i + 1}. <@${roll.userId}> rolled **${roll.roll}** (from 0-${roll.maxNumber})${clutch}\n`;
  }

  content += `\n`;

  if (isGameOver) {
    const winnerId =
      lastRollerId === game.initiator
        ? (game.opponent as string)
        : game.initiator;

    if (stats) {
      content += `📊 **Game Stats**\n`;
      content += `-# Total rolls: ${game.rolls.length}\n\n`;

      const winnerRank = stats.winnerRank || "";
      const loserRank = stats.loserRank || "";
      const winnerMmrChange = stats.winnerMmrChange || "";
      const loserMmrChange = stats.loserMmrChange || "";
      const winnerStreakStr = stats.winnerStreak
        ? " · " + formatStreak(stats.winnerStreak)
        : "";
      const loserStreakStr = stats.loserStreak
        ? " · " + formatStreak(stats.loserStreak)
        : "";

      const winnerGoldStr = stats.winnerGold
        ? ` · 🪙 +${stats.winnerGold}g`
        : "";
      const winnerPotStr = stats.winnerPot
        ? ` · 💰 +${stats.winnerPot}g pot`
        : "";

      content += `💀 ${loserRank} <@${lastRollerId}>${loserMmrChange} loses!${loserStreakStr}\n`;
      content += `🎉 ${winnerRank} <@${winnerId}>${winnerMmrChange} wins!${winnerStreakStr}${winnerGoldStr}${winnerPotStr}\n`;
      content += `-# 💰 /gold ransom can buy the loser out of their timeout`;
    } else {
      content += `💀 <@${lastRollerId}> loses!\n`;
      content += `🎉 <@${winnerId}> wins!`;
    }
  } else {
    const nextPlayerId = game.currentTurn;
    content += `Current number: **${game.currentNumber}**\n`;
    content += `<@${nextPlayerId}>, it's your turn!`;
  }

  return content;
}

// ─── Button Rows ──────────────────────────────────────────────────────

/**
 * The "Roll (0-N)" button row shown on every mid-game message.
 */
export function buildRollRow(gameId: string, maxNumber: number) {
  const rollButton = new ButtonBuilder()
    .setCustomId(`deathroll_roll_${gameId}`)
    .setLabel(`Roll (0-${maxNumber})`)
    .setStyle(ButtonStyle.Primary)
    .setEmoji("🎲");

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(rollButton)];
}

/**
 * The Accept/Decline row shown on a freshly-created challenge.
 */
export function buildEngageDeclineRow(interactionId: string, label: string) {
  const engageButton = new ButtonBuilder()
    .setCustomId(`deathroll_engage_${interactionId}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Danger)
    .setEmoji("🎲");

  const declineButton = new ButtonBuilder()
    .setCustomId(`deathroll_decline_${interactionId}`)
    .setLabel("Decline")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("❌");

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      engageButton,
      declineButton,
    ),
  ];
}

/**
 * The Double-or-Nothing agreement button attached to a game-over message.
 */
export function buildDoubleOrNothingAgreeRow(
  winnerId: string,
  loserId: string,
  startingNumber: number,
  nextMultiplier: number,
) {
  const nextTimeout = nextMultiplier * BASE_TIMEOUT_MINUTES;
  const multiplierName = getMultiplierName(nextMultiplier);

  const donButton = new ButtonBuilder()
    .setCustomId(
      `deathroll_don_agree_${winnerId}_${loserId}_${startingNumber}_${nextMultiplier}`,
    )
    .setLabel(`${multiplierName} or Nothing (${nextTimeout}min timeout)`)
    .setStyle(ButtonStyle.Danger)
    .setEmoji("🎰");

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(donButton)];
}

/**
 * DoN row derived from the finished game's state (label shows the *next*
 * multiplier).
 */
export function buildDoubleOrNothingRow(
  game: GameState,
  winnerId: string,
  loserId: string,
) {
  const nextMultiplier = (game.timeoutMultiplier || 1) * 2;
  return buildDoubleOrNothingAgreeRow(
    winnerId,
    loserId,
    game.startingNumber,
    nextMultiplier,
  );
}
