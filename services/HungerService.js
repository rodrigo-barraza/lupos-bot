import StatService from "#root/services/StatService.js";
import AIService from "#root/services/AIService.js";
import config from "#root/secrets.js";

const hungerStat = StatService.create("hunger", {
  min: 0,
  max: 100,
  initial: 0,
});

let hasMessageBeenSent = false;

async function instantiate(client) {
  const channel = client.channels.cache.get(config.CHANNEL_ID_BOT_STATUS);
  if (hungerStat.getLevel() >= 0) {
    hungerStat.increase();
  }
  if (!hasMessageBeenSent && hungerStat.getLevel() === 100) {
    console.log("You are starving, you need to eat something.");
    const systemContent = `You are starving like you never have before. The hunger within you grows, and you begin to look around for people to eat. You know who you want to eat, it's one of these people you are having a conversation with. You are so hungry, that the people you are conversing with look really fucking delicious, and all you can think about is how they might taste, what their bones are like when you chew on them, or what the best tasting body part of theirs might be. You are vicious and demonic with hunger, to the point where you are salivating about the people in here. You are so hungry, that not even thirst can quench your drive to want to devour people in here. You will try to eat someone in here.`;
    const userContent = `You will talk about how hungry you are, and complain that you haven't a proper meal in hours, let alone having been properly fed. Do not include emoji if they are not food related. Do not include drink emojis, only foods. Start naming people in the conversation. Talk about how you would go about eating them, the environment, the scene. Make it cinematic and graphic. You will mention how the people in this conversation are starting to look good enough to eat, and how delicious they really seem. Make sure you mention that you need to be fed food emojis. Say that you need to eat some food emojis, or you will start eating the people in here.`;
    const conversation = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];
    const response = await AIService.generateText({
      conversation,
      type: config.LANGUAGE_MODEL_TYPE,
      modelPerformance: "POWERFUL",
      tokens: config.LANGUAGE_MODEL_MAX_TOKENS,
      temperature: config.LANGUAGE_MODEL_TEMPERATURE,
    });
    if (response) {
      await channel.send(response);
    }
    hasMessageBeenSent = true;
    return;
  }
}

const HungerService = {
  instantiate(client) {
    setInterval(() => instantiate(client), 45 * 1000);
  },
  getHungerLevel() {
    return hungerStat.getLevel();
  },
  setHungerLevel(level) {
    return hungerStat.setLevel(level);
  },
  increaseHungerLevel() {
    return hungerStat.increase();
  },
  decreaseHungerLevel() {
    return hungerStat.decrease();
  },
};

export default HungerService;
