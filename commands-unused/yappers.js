const { SlashCommandBuilder } = require('discord.js');
const YapperService = require('../../services/YapperService.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('yappers')
		.setDescription('Have a quick look as to who has been blabber-mouthing in the past short while.'),
	async execute(interaction) {
        await interaction.deferReply();
		const yapperMessage = await YapperService.yapperMessage(interaction);
        await interaction.editReply(yapperMessage);
	},
};