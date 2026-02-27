import { SlashCommandBuilder } from 'discord.js';
import { executeDeathroll } from './deathrollUtils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deathroll')
        .setDescription('Start a deathroll game - roll until someone hits 0! The loser gets timed out for 10 minutes.')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('Challenge a specific user to deathroll')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('Starting number for the deathroll (default: 100)')
                .setMinValue(2)
                .setMaxValue(10000)
                .setRequired(false)),

    execute: executeDeathroll
};
