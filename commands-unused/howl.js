import { SlashCommandBuilder } from 'discord.js';
import UtilityLibrary from '../../libraries/UtilityLibrary.js';
import MoodService from '../../services/MoodService.js';

export default {
	data: new SlashCommandBuilder()
		.setName('howl')
		.setDescription('Raise your head up high, and call upon the full moon.'),
	async execute(interaction) {
		const howl = UtilityLibrary.howl();
		MoodService.increaseMoodLevel();
		await interaction.reply(howl);
	},
};