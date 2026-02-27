import { SlashCommandBuilder } from 'discord.js';
import { executeDeathrollLeaderboard } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathrollleaderboard')
        .setDescription('Shows the top 20 deathroll players and their stats'),

    execute: executeDeathrollLeaderboard
};
