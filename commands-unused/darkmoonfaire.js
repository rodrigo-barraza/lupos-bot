const { SlashCommandBuilder } = require('discord.js');
const DarkMoonFaireService = require('../../services/DarkmoonFaireService.js');
const MoodService = require('../../services/MoodService.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('darkmoonfaire')
		.setDescription('Get the latest details on the Darkmoon Faire.'),
    async execute(interaction) {
        await interaction.deferReply();
        const reply = await DarkMoonFaireService.darkmoonFaireMessage(interaction);
        MoodService.decreaseMoodLevel();
        await interaction.editReply(reply);
    },
};