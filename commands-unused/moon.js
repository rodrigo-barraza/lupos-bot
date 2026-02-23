import { SlashCommandBuilder } from 'discord.js';
import DiscordService from '../../services/DiscordService.js';
import moment from 'moment';

const fullMoons = [
    { date: '2024-01-25', name: 'Wolf Moon' },
    { date: '2024-02-24', name: 'Snow Moon' },
    { date: '2024-03-25', name: 'Worm Moon' },
    { date: '2024-04-23', name: 'Pink Moon' },
    { date: '2024-05-23', name: 'Flower Moon' },
    { date: '2024-06-21', name: 'Strawberry Moon' },
    { date: '2024-07-21', name: 'Buck Moon' },
    { date: '2024-08-19', name: 'Sturgeon Moon' },
    { date: '2024-09-17', name: 'Harvest Moon' },
    { date: '2024-10-17', name: 'Hunter\'s Moon' },
    { date: '2024-11-15', name: 'Beaver Moon' },
    { date: '2024-12-15', name: 'Cold Moon' }
]

function getNextFullMoon() {
    const now = moment();
    const nextFullMoon = fullMoons.find(moon => moment(moon.date).isAfter(now));
    return nextFullMoon;
}

export default {
	data: new SlashCommandBuilder()
		.setName('moon')
		.setDescription('Find when the next full moon is.'),
    async execute(interaction) {
        await interaction.deferReply();
        const systemContent = `
            You will answer, in character, when the next full moon is. The next full moon is the ${getNextFullMoon().name} on ${moment(getNextFullMoon().date).format('MMMM Do, YYYY')}. You will either answer by saying the date, or by saying how many more days are left until the next full moon."
        `;
        const userContent = 'When is the next full moon?'
        const characterResponse = await DiscordService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
        await interaction.editReply(characterResponse);
    },
};