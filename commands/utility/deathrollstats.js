import { SlashCommandBuilder } from 'discord.js';
import { executeDeathrollStats } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathrollstats')
        .setDescription('View deathroll stats for a player')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to view stats for (defaults to yourself)')
                .setRequired(false)),

    execute: executeDeathrollStats
};
