const { SlashCommandBuilder } = require('discord.js');
const UtilityLibrary = require('../../libraries/UtilityLibrary.js');
const MoodService = require('../../services/MoodService.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('howl')
		.setDescription('Raise your head up high, and call upon the full moon.'),
	async execute(interaction) {
		const howl = UtilityLibrary.howl();
		MoodService.increaseMoodLevel();
		await interaction.reply(howl);
	},
};