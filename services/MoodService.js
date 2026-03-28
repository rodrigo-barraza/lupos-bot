import { ActivityType } from "discord.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import StatService from "#root/services/StatService.js";
import { MOODS, MOOD_TEMPERATURE_THRESHOLDS } from "#root/constants.js";

const moodStat = StatService.create("mood", {
  min: -10,
  max: 10,
  initial: 0,
  onChange: () => {
    try {
      const client = DiscordWrapper.getClient("lupos");
      if (client?.user) {
        const currentMood = MOODS.find(
          (mood) => mood.level === moodStat.getLevel(),
        );
        if (currentMood) {
          client.user.setActivity(
            `Mood: ${currentMood.emoji} ${currentMood.name} (${moodStat.getLevel()})`,
            { type: ActivityType.Custom },
          );
        }
      }
    } catch {
      // Client may not be ready yet during startup
    }
  },
});

const MoodService = {
  instantiate() {
    const client = DiscordWrapper.getClient("lupos");
    client.user.setActivity("Don't tag me...", { type: ActivityType.Custom });
  },
  getMoodLevel() {
    return moodStat.getLevel();
  },
  getMoodName() {
    const mood = MOODS.find((mood) => mood.level === moodStat.getLevel());
    return mood?.name || "Unknown";
  },
  setMoodLevel(level) {
    return moodStat.setLevel(level);
  },
  increaseMoodLevel(multiplier = 1) {
    return moodStat.increase(multiplier);
  },
  decreaseMoodLevel(multiplier = 1) {
    return moodStat.decrease(multiplier);
  },
  async generateMoodMessage(message) {
    const moodTemperature =
      await DiscordUtilityService.generateMoodTemperature(message);

    // Apply mood change based on temperature thresholds
    for (const [min, max, direction, multiplier] of MOOD_TEMPERATURE_THRESHOLDS) {
      if (moodTemperature >= min && moodTemperature <= max) {
        if (direction === "decrease") {
          MoodService.decreaseMoodLevel(multiplier);
        } else {
          MoodService.increaseMoodLevel(multiplier);
        }
        break;
      }
    }

    const currentMood = MOODS.find(
      (mood) => mood.level === moodStat.getLevel(),
    );
    const moodResponse = currentMood?.description || "";

    console.log(`Current mood level: ${moodStat.getLevel()}`);
    return moodResponse;
  },
};

export default MoodService;
