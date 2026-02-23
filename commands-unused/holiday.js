import { SlashCommandBuilder } from 'discord.js';
import HolidayService from '#/services/HolidayService.js';
import MoodService from '#/services/MoodService.js';

export default {
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