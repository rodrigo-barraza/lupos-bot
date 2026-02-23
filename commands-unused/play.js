import { SlashCommandBuilder } from 'discord.js';
import ActionService from '#services/ActionService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('alcohol')
        .setDescription('Make Lupos take a swig from a random alcoholic beverage.'),
    async execute(interaction) {
        await interaction.deferReply();
        const characterResponse = await ActionService.alcohol(interaction);
        await interaction.editReply(characterResponse);
    },
};