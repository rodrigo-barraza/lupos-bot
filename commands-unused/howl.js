import { SlashCommandBuilder } from "discord.js";
import utilities from "#root/utilities.js";
import MoodService from "#root/services/MoodService.js";

export default {
  data: new SlashCommandBuilder()
    .setName("howl")
    .setDescription("Raise your head up high, and call upon the full moon."),
  async execute(interaction) {
    const howl = utilities.howl();
    MoodService.increaseMoodLevel();
    await interaction.reply(howl);
  },
};
