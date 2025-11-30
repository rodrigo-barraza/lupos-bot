// roll from 0 to 100 with the option to specify a range
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('roll')
		.setDescription('Rolls a die from 0 to 100 (or custom range)')
		.addIntegerOption(option =>
			option.setName('min')
				.setDescription('The minimum value (default: 0)')
				.setRequired(false)
				.setMinValue(0))
		.addIntegerOption(option =>
			option.setName('max')
				.setDescription('The maximum value (default: 100)')
				.setRequired(false)
				.setMinValue(1)),
	async execute(interaction) {
		console.log('interaction', interaction);
		const min = interaction.options.getInteger('min') ?? 0;
		const max = interaction.options.getInteger('max') ?? 100;
		
		// Validate that max is greater than min
		if (max <= min) {
			await interaction.reply('The maximum value must be greater than the minimum value!');
			return;
		}
		
		// Generate random number between min and max (inclusive)
		const roll = Math.floor(Math.random() * (max - min + 1)) + min;
		await interaction.reply(`You rolled a ${roll}! (${min}-${max})`);
	},
};