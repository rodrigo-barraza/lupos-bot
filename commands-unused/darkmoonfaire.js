import { SlashCommandBuilder } from 'discord.js';
import DarkMoonFaireService from '#root/services/DarkmoonFaireService.js';
import MoodService from '#root/services/MoodService.js';

export default {
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