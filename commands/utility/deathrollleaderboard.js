import { SlashCommandBuilder } from 'discord.js';
import { executeDeathrollLeaderboard } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathrollleaderboard')
        .setDescription('Shows the top 10 and bottom 10 deathroll players and their stats'),

    execute: executeDeathrollLeaderboard
};
