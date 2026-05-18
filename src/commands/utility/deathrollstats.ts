import { SlashCommandBuilder } from "discord.js";
import { executeDeathrollStats } from "./deathrollUtils.ts";

export default {
  data: new SlashCommandBuilder()
    .setName("deathrollstats")
    .setDescription("View deathroll stats for a player")
    .addUserOption((option: any) =>
      option
        .setName("user")
        .setDescription("User to view stats for (defaults to yourself)")
        .setRequired(false),
    ),

  execute: executeDeathrollStats,
};
