import { SlashCommandBuilder } from "discord.js";
import type { SlashCommandIntegerOption } from "discord.js";
import {
  DEFAULT_ROYALE_PLAYERS,
  MAX_ROYALE_PLAYERS,
  MIN_ROYALE_PLAYERS,
  executeDeathrollRoyale,
} from "./deathroll/royale.ts";

export default {
  data: new SlashCommandBuilder()
    .setName("deathrollroyale")
    .setDescription(
      "Multiplayer deathroll battle royale - last one standing wins the gold pot!",
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("number")
        .setDescription("Starting number for each round (default: 100)")
        .setMinValue(2)
        .setMaxValue(10000)
        .setRequired(false),
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("wager")
        .setDescription(
          "Gold entry fee per player - winner takes the pot (default: 0)",
        )
        .setMinValue(0)
        .setMaxValue(10000)
        .setRequired(false),
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("max_players")
        .setDescription(
          `Auto-start when this many players join (default: ${DEFAULT_ROYALE_PLAYERS})`,
        )
        .setMinValue(MIN_ROYALE_PLAYERS)
        .setMaxValue(MAX_ROYALE_PLAYERS)
        .setRequired(false),
    ),

  guildOnly: true,

  execute: executeDeathrollRoyale,
};
