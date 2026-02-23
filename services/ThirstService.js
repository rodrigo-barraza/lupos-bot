import DiscordService from '#services/DiscordService.js';

let thirstLevel = 0;
let hungerChannelId = '1198326193984913470';
let hasMessageBeenSent = false;

async function instantiate(client, openai) {
    const channel = client.channels.cache.get(hungerChannelId);
    let currentThirstLevel = ThirstService.getThirstLevel();
    if (currentThirstLevel >= 0) {
        currentThirstLevel = ThirstService.increaseThirstLevel();
        ThirstService.setThirstLevel(currentThirstLevel);
    }
    if (!hasMessageBeenSent && currentThirstLevel == 100) {
        // console.log('You are starving, you need to eat something.');
        // const systemContent = `You are starving like you never have before. The hunger within you grows, and you begin to look around for people to eat. You know who you want to eat, it's one of these people you are having a conversation with. You are so hungry, that the people you are conversing with look really fucking delicious, and all you can think about is how they might taste, what their bones are like when you chew on them, or what the best tasting body part of theirs might be. You are vicious and demonic with hunger, to the point where you are salivating about the people in here. You are so hungry, that not even thirst can quench your drive to want to devour people in here. You will try to eat someone in here.`;
        // const userContent = `You will talk about how hungry you are, and complain that you haven't a proper meal in hours, let alone having been properly fed. Do not include emoji if they are not food related. Do not include drink emojis, only foods. Start naming people in the conversation. Talk about how you would go about eating them, the environment, the scene. Make it cinematic and graphic. You will mention how the people in this conversation are starting to look good enough to eat, and how delicious they really seem. Make sure you mention that you need to be fed food emojis. Say that you need to eat some food emojis, or you will start eating the people in here.`;
        // const response = await DiscordService.generateInCharacterResponse2Special(client, systemContent, userContent, openai);
        // await channel.send(response);
        hasMessageBeenSent = true;
        return;
    }
}


const ThirstService = {
    instantiate(client, openai) {
        setInterval(() => instantiate(client, openai), 15 * 1000);
    },
    getThirstLevel() {
        return thirstLevel;
    },
    setThirstLevel(level) {
        thirstLevel = level;
    },
    increaseThirstLevel() {
        let currentThirstLevel = ThirstService.getThirstLevel();
        currentThirstLevel = currentThirstLevel < 100 ? currentThirstLevel + 1 : 100
        ThirstService.setThirstLevel(currentThirstLevel);
        console.log(`Thirst level increased to: ${currentThirstLevel}`);
        return currentThirstLevel;
    },
    decreaseThirstLevel() {
        let currentThirstLevel = ThirstService.getThirstLevel();
        currentThirstLevel = currentThirstLevel > 0 ? currentThirstLevel - 1 : 0;
        ThirstService.setThirstLevel(currentThirstLevel);
        console.log(`Thirst level decreased to: ${currentThirstLevel}`);
        return currentThirstLevel;
    },
    async drink(message) {
        currentThirstLevel = ThirstService.decreaseThirstLevel();
        const content = `
        You will drink whatever is given to you. You will always accept it, and you will take a sip, gulp, chug, swallow down, the delicious drink that has been given to you. You have just been fed a drink. You are now ${currentThirstLevel}/100 thirsty. This means that you are at a ${currentThirstLevel} out of 100 level of hunger. You start acting like you are ${currentThirstLevel}/100 thirsty. You just drank the drink and it tasted ${currentThirstLevel} out of one hundred in terms of taste.
        ${message.content}
        `;
        const response = await DiscordService.generateTextFromSystemUserMessages(content, message);
        await message.reply({ content: response });
        return;
    }
}

export default ThirstService;