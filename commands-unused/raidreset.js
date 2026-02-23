import { SlashCommandBuilder } from 'discord.js';
import DungeonTimerService from '../../services/DungeonTimerService.js';
import MoodService from '../../services/MoodService.js';
import moment from 'moment';

export default {
	data: new SlashCommandBuilder()
		.setName('raidreset')
		.setDescription('Find out when the next raid reset timer date is.'),
    async execute(interaction) {
        await interaction.deferReply();
        const reply = await DungeonTimerService.dungeonTimerMessage(interaction);
        MoodService.decreaseMoodLevel();
        await interaction.editReply(reply);
    },
};