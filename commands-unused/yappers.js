import { SlashCommandBuilder } from 'discord.js';
import YapperService from '#services/YapperService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('yappers')
        .setDescription('Have a quick look as to who has been blabber-mouthing in the past short while.'),
    async execute(interaction) {
        await interaction.deferReply();
        const yapperMessage = await YapperService.yapperMessage(interaction);
        await interaction.editReply(yapperMessage);
    },
};