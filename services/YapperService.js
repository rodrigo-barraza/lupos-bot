import AIService from '#services/AIService.js';
import HungerService from '#services/HungerService.js';
import ThirstService from '#services/ThirstService.js';
import BathroomService from '#services/BathroomService.js';
import MoodService from '#services/MoodService.js';
import SicknessService from '#services/SicknessService.js';
import AlcoholService from '#services/AlcoholService.js';

let currentYappers = [];

const YapperService = {
    setYappers(yappers) {
        currentYappers = yappers;
    },
    getYappers() {
        return currentYappers;
    },
    async yapperMessage(interaction) {
        MoodService.decreaseMoodLevel();
        const yappers = YapperService.getYappers();
        let systemContent = `
            You do not ever mention the time, for any reason.
            You will answer who the top 5 recent yappers currently are, and how many yaps they have gained from talking so much recently, in order. List each yapper with a trophy, star, ribbon, or similar emojis beside the name at the start. 
            You will list out statistical facts about the yaps. Each yap is a message, and there are 300 in total. Show the different percentages of yaps each user has and how much total conversation they have taken up. You will roast each of these users based on their names and how they've been talking so much.
            
            After the rundown, you will answer the following as well in this format:

            # Top 5 Yappers
        `;

        for (const yapper of yappers) {
            systemContent += `- ${yapper.displayName} with ${yapper.count} recent yaps\n`;
        }
        const userContent = `Who are the current top 5 yappers in order?`;
        return await AIService.generateTextFromSystemUserMessages(systemContent, userContent, interaction);
    }
}

export default YapperService;