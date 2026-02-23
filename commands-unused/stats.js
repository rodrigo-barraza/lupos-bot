import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import HungerService from '#/services/HungerService.js';
import AlcoholService from '#/services/AlcoholService.js';
import ThirstService from '#/services/ThirstService.js';
import EnergyService from '#/services/EnergyService.js';
import HygieneService from '#/services/HygieneService.js';
import BathroomService from '#/services/BathroomService.js';
import MoodService from '#/services/MoodService.js';
import SicknessService from '#/services/SicknessService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Provides general statistics about Lupos.'),
    async execute(interaction) {
        const hungerLevel = HungerService.getHungerLevel();
        const thirstLevel = ThirstService.getThirstLevel();
        const alcoholLevel = AlcoholService.getAlcoholLevel() * 10;
        const moodName = MoodService.getMoodName();
        const healthState = 'Healthy';
        const weight = 250;
        const height = 182;
        const age = 1;
        const energyLevel = EnergyService.getEnergyLevel();
        const boredomLevel = 100;
        const bathroomLevel = BathroomService.getBathroomLevel();
        const hygieneLevel = HygieneService.getHygieneLevel();
        const sicknessLevel = SicknessService.getSicknessLevel();
        // await interaction.reply(`Hunger level is ${hungerLevel}.\n
        // Alcohol level is ${alcoholLevel}.\n
        // Mood level is ${moodName}.\n
        // Health state is ${healthState}.\n
        // Weight is ${weight}.\n
        // Age is ${age}.\n
        // Energy level is ${energyLevel > 0 ? 'Alert' : 'Sleepy'}.\n`);

        // reply with an embed
        const Embed = new EmbedBuilder()
            .setTitle(`Lupos Statistics`)
            .setDescription('The different properties of our local shadow wolf.')
            // .setColor(0x00FF00)
            .addFields(
                // { name: 'Hunger', value: `${hungerLevel}%`, inline: true },
                // { name: 'Thirst', value: `${thirstLevel}%`, inline: true },
                // { name: 'Boredom', value: `${boredomLevel}%`, inline: true },
                // { name: 'Energy', value: `${energyLevel}%`, inline: true },
                // { name: 'Hygiene', value: `${hygieneLevel}%`, inline: true },

                { name: 'Drunk', value: `${alcoholLevel}%`, inline: true },
                { name: 'Sickness', value: `${sicknessLevel}%`, inline: true },
                // { name: 'Bathroom', value: `${bathroomLevel}%`, inline: true },



                { name: '\u200B', value: '\u200B' },
                { name: 'Personality', value: `Spicy`, inline: true },
                { name: 'Mood', value: `${moodName}`, inline: true },
                { name: 'Health', value: `${healthState}`, inline: true },
                { name: 'Weight', value: `${weight}lbs`, inline: true },
                { name: 'Height', value: `${height}cm`, inline: true },
                { name: 'Age', value: `${age}`, inline: true },
                // { name: 'Energy level', value: energyLevel > 0 ? 'Alert' : 'Sleepy' }.addFields(
                // { name: 'Regular field title', value: 'Some value here' },
                // { name: '\u200B', value: '\u200B' },
                // { name: 'Inline field title', value: 'Some value here', inline: true },
                // { name: 'Inline field title', value: 'Some value here', inline: true },
            )
        // .setImage('https://i.imgur.com/AfFp7pu.png')
        // .setTimestamp()
        await interaction.reply({ embeds: [Embed] });
    },
};
