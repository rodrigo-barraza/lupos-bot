// if (message.content.includes('🍺') || message.content.includes('🍻') || message.content.includes('🍷') || message.content.includes('🍸') || message.content.includes('🍹') || message.content.includes('🍾') || message.content.includes('🍶') || message.content.includes('🥃')) {
//     await AlcoholService.drinkAlcohol(message, openai);
//     return;
// }

// if includes food emojis
// const foodEmojis = ['🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤', '🧋', '🧃', '🧉', '🧊', '🥢', '🍽', '🍴', '🥄'];

// const drinkEmojis = ['🍺', '🍻', '🍷', '🍸', '🍹', '🍾', '🍶', '🥃', '🥤', '🧋', '🧃', '🧉', '🧊'];

// const alcoholEmojis = ['🍺', '🍻', '🍷', '🍸', '🍹', '🍾', '🍶', '🥃'];

// if (foodEmojis.some(emoji => message.content.includes(emoji))) {
//     await ActionService.eat(message, openai);
//     return;
// }

import { SlashCommandBuilder } from "discord.js";
import ActionService from "#root/services/ActionService.js";

export default {
  data: new SlashCommandBuilder()
    .setName("drink")
    .setDescription("Give Lupos something random to drink."),
  async execute(interaction) {
    await interaction.deferReply();
    const characterResponse = await ActionService.drink(interaction);
    await interaction.editReply(characterResponse);
  },
};
