const { SlashCommandBuilder } = require('discord.js');
const HolidayService = require('../../services/HolidayService.js');
const MoodService = require('../../services/MoodService.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('holiday')
		.setDescription('Inquire about the next upcoming Azerothian holiday.'),
    async execute(interaction) {
        await interaction.deferReply();
        const reply = await HolidayService.holidayMessage(interaction);
        MoodService.decreaseMoodLevel();
        await interaction.editReply(reply);
    },
};