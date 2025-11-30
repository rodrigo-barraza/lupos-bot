const { SlashCommandBuilder } = require('discord.js');
const ActionService = require('../../services/ActionService.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alcohol')
        .setDescription('Make Lupos take a swig from a random alcoholic beverage.'),
    async execute(interaction) {
        await interaction.deferReply();
        const characterResponse = await ActionService.alcohol(interaction);
        await interaction.editReply(characterResponse);
    },
};