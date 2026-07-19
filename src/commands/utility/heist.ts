import { SlashCommandBuilder } from "discord.js";
import type { SlashCommandIntegerOption } from "discord.js";
import {
  HEIST_DEFAULT_BUYIN,
  HEIST_MAX_BUYIN,
  HEIST_MIN_BUYIN,
} from "./heist/heistMath.ts";
import { executeHeist } from "./heist/heistGame.ts";

export default {
  data: new SlashCommandBuilder()
    .setName("heist")
    .setDescription(
      "Assemble a crew and raid the wolf's gold hoard - three stages, big scores, real consequences",
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("buyin")
        .setDescription(
          `Gold each crew member stakes on the job (default: ${HEIST_DEFAULT_BUYIN})`,
        )
        .setMinValue(HEIST_MIN_BUYIN)
        .setMaxValue(HEIST_MAX_BUYIN)
        .setRequired(false),
    ),

  guildOnly: true,

  execute: executeHeist,
};
