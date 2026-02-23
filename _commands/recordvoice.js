// roll from 0 to 100 with the option to specify a range
import { SlashCommandBuilder } from 'discord.js';
import DiscordVoiceService from '#services/DiscordVoiceService.js';

const minSeconds = 5;
const maxSeconds = 30;

export default {
    data: new SlashCommandBuilder()
        .setName('recordvoice')
        .setDescription('Records voice from a user')
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Number of seconds to record')
                .setRequired(false)
                .setMinValue(minSeconds)
                .setMaxValue(maxSeconds)),
    async execute(interaction) {
        const seconds = interaction.options.getInteger('seconds') ?? 5;

        // Validate that seconds is within the allowed range
        if (seconds < minSeconds || seconds > maxSeconds) {
            await interaction.reply(`Please specify a valid duration between ${minSeconds} and ${maxSeconds} seconds.`);
            return;
        }
        await DiscordVoiceService.recordVoiceInVoiceChannel2(interaction, seconds);
        await interaction.reply(`You recorded voice for ${seconds} seconds.`);
    },
};
