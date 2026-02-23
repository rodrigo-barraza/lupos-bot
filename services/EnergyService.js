import DiscordService from '#root/services/DiscordService.js';

let energyLevel = 100;
let energyChannelId = '1198326193984913470';
let hasMessageBeenSent = false;

async function instantiate(client, openai) {
    const channel = client.channels.cache.get(energyChannelId);
    let currentEnergyLevel = EnergyService.getEnergyLevel();
    if (currentEnergyLevel !== 0) {
        currentEnergyLevel = EnergyService.decreaseEnergyLevel();
        EnergyService.setEnergyLevel(currentEnergyLevel);
    }
    if (!hasMessageBeenSent && currentEnergyLevel == 0) {
        // console.log('You are starving, you need to eat something.');
        // const systemContent = `You are starving like you never have before. The energy within you grows, and you begin to look around for people to eat. You know who you want to eat, it's one of these people you are having a conversation with. You are so hungry, that the people you are conversing with look really fucking delicious, and all you can think about is how they might taste, what their bones are like when you chew on them, or what the best tasting body part of theirs might be. You are vicious and demonic with energy, to the point where you are salivating about the people in here. You are so hungry, that not even thirst can quench your drive to want to devour people in here. You will try to eat someone in here.`;
        // const userContent = `You will talk about how hungry you are, and complain that you haven't a proper meal in hours, let alone having been properly fed. Do not include emoji if they are not food related. Do not include drink emojis, only foods. Start naming people in the conversation. Talk about how you would go about eating them, the environment, the scene. Make it cinematic and graphic. You will mention how the people in this conversation are starting to look good enough to eat, and how delicious they really seem. Make sure you mention that you need to be fed food emojis. Say that you need to eat some food emojis, or you will start eating the people in here.`;
        // const response = await DiscordService.generateInCharacterResponse2Special(client, systemContent, userContent, openai);
        // await channel.send(response);
        hasMessageBeenSent = true;
        return;
    }
}


const EnergyService = {
    instantiate(client, openai) {
        setInterval(() => instantiate(client, openai), 30 * 1000);
    },
    getEnergyLevel() {
        return energyLevel;
    },
    setEnergyLevel(level) {
        energyLevel = level;
    },
    increaseEnergyLevel() {
        let currentEnergyLevel = EnergyService.getEnergyLevel();
        currentEnergyLevel = currentEnergyLevel < 100 ? currentEnergyLevel + 1 : 100
        EnergyService.setEnergyLevel(currentEnergyLevel);
        console.log(`Energy level increased to: ${currentEnergyLevel}`);
        return currentEnergyLevel;
    },
    decreaseEnergyLevel() {
        let currentEnergyLevel = EnergyService.getEnergyLevel();
        currentEnergyLevel = currentEnergyLevel > 0 ? currentEnergyLevel - 1 : 0;
        EnergyService.setEnergyLevel(currentEnergyLevel);
        console.log(`Energy level decreased to: ${currentEnergyLevel}`);
        return currentEnergyLevel;
    }
}

export default EnergyService;