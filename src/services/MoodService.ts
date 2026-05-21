import type { Message } from "discord.js";
import { ActivityType } from "discord.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import StatService from "#root/services/StatService.js";
import { MOODS, MOOD_TEMPERATURE_THRESHOLDS } from "#root/constants.js";
import type { MoodEntry } from "#root/types/index.js";

const moodStat = StatService.create("mood", {
  min: -10,
  max: 10,
  initial: 0,
  onChange: () => {
    try {
      const client = DiscordWrapper.getClient("lupos");
      if (client?.user) {
        const currentMood = MOODS.find(
          (mood: MoodEntry) => mood.level === moodStat.getLevel(),
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
    if (client?.user) {
      client.user.setActivity("Don't tag me...", { type: ActivityType.Custom });
    }
  },
  getMoodLevel() {
    return moodStat.getLevel();
  },
  getMoodName() {
    const mood = MOODS.find((mood: MoodEntry) => mood.level === moodStat.getLevel());
    return mood?.name || "Unknown";
  },
  setMoodLevel(level: number) {
    return moodStat.setLevel(level);
  },
  increaseMoodLevel(multiplier: number = 1) {
    return moodStat.increase(multiplier);
  },
  decreaseMoodLevel(multiplier: number = 1) {
    return moodStat.decrease(multiplier);
  },
  async generateMoodMessage(message: Message) {
    const moodTemperature =
      await (DiscordUtilityService as typeof DiscordUtilityService & { generateMoodTemperature(message: Message): Promise<number> }).generateMoodTemperature(message);

    // Apply mood change based on temperature thresholds
    for (const [min, max, direction, multiplier] of MOOD_TEMPERATURE_THRESHOLDS) {
      if (moodTemperature >= Number(min) && moodTemperature <= Number(max)) {
        if (direction === "decrease") {
          MoodService.decreaseMoodLevel(Number(multiplier));
        } else {
          MoodService.increaseMoodLevel(Number(multiplier));
        }
        break;
      }
    }

    const currentMood = MOODS.find(
      (mood: MoodEntry) => mood.level === moodStat.getLevel(),
    );
    const moodResponse = currentMood?.description || "";

    console.log(`Current mood level: ${moodStat.getLevel()}`);
    return moodResponse;
  },
};

export default MoodService;
