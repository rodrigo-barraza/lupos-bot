import { describe, it, expect } from "vitest";
import {
  formatSomaticStats,
  moodFromEmotion,
  type PrismSomaticSnapshot,
} from "../SomaticStatsFormatter.ts";

function snapshot(
  overrides: Partial<PrismSomaticSnapshot> = {},
): PrismSomaticSnapshot {
  return {
    emotion: { dominant: "neutral", intensity: 0, components: ["neutral"] },
    hunger: { level: 0 },
    thirst: { level: 0 },
    energy: { level: 100 },
    sickness: { level: 0 },
    alcohol: { level: 0 },
    substance: { level: 0 },
    bathroom: { level: 0 },
    ...overrides,
  };
}

describe("moodFromEmotion — valence projection", () => {
  it("maps neutral to the midpoint (50)", () => {
    const mood = moodFromEmotion({ dominant: "neutral", intensity: 0 });
    expect(mood.level).toBe(50);
    expect(mood.name).toBe("Neutral");
    expect(mood.emoji).toBe("😑");
  });

  it("pushes positive emotions above 50 scaled by intensity", () => {
    expect(moodFromEmotion({ dominant: "joy", intensity: 100 }).level).toBe(100);
    expect(moodFromEmotion({ dominant: "joy", intensity: 50 }).level).toBe(75);
    expect(moodFromEmotion({ dominant: "joy", intensity: 0 }).level).toBe(50);
  });

  it("pushes negative emotions below 50 scaled by intensity", () => {
    expect(moodFromEmotion({ dominant: "sadness", intensity: 100 }).level).toBe(5);
    expect(moodFromEmotion({ dominant: "anger", intensity: 80 }).level).toBe(26);
  });

  it("title-cases the emotion name and keeps the dyad label", () => {
    const mood = moodFromEmotion({
      dominant: "contempt",
      intensity: 40,
      isDyad: true,
      components: ["anger", "disgust"],
    });
    expect(mood.name).toBe("Contempt");
    expect(mood.emoji).toBe("😒"); // dyad override
  });

  it("averages component valences for a dyad without a valence entry", () => {
    // love = joy(+1.0) + trust(+0.5) → avg +0.75; intensity 100 → 50+37.5
    const mood = moodFromEmotion({
      dominant: "love",
      intensity: 100,
      isDyad: true,
      components: ["joy", "trust"],
    });
    expect(mood.level).toBe(88);
    expect(mood.emoji).toBe("❤️");
  });

  it("clamps out-of-range intensity to the 100 ceiling", () => {
    // joy valence +1.0 → reaches the top; sadness valence -0.9 floors at 5
    expect(moodFromEmotion({ dominant: "joy", intensity: 999 }).level).toBe(100);
    expect(moodFromEmotion({ dominant: "sadness", intensity: 999 }).level).toBe(5);
  });

  it("falls back to a component emoji for an unmapped dyad", () => {
    const mood = moodFromEmotion({
      dominant: "mysteryblend",
      intensity: 50,
      components: ["anger", "joy"],
    });
    // anger |valence| 0.6 > joy would be 1.0 → joy wins as strongest |valence|
    expect(mood.emoji).toBe("😊");
  });
});

describe("formatSomaticStats — full mapping", () => {
  it("passes physical stats through at their native ranges", () => {
    const stats = formatSomaticStats(
      snapshot({
        hunger: { level: 82 },
        thirst: { level: 40 },
        energy: { level: 15 },
        sickness: { level: 30 },
        alcohol: { level: 6 }, // 0-10 range preserved (client contract)
        substance: { level: 3 },
        bathroom: { level: 90 },
      }),
    );
    expect(stats.hunger).toBe(82);
    expect(stats.thirst).toBe(40);
    expect(stats.energy).toBe(15);
    expect(stats.sickness).toBe(30);
    expect(stats.alcohol).toBe(6);
    expect(stats.substance).toBe(3);
    expect(stats.bathroom).toBe(90);
  });

  it("produces the full client SomaticStats shape", () => {
    const stats = formatSomaticStats(
      snapshot({ emotion: { dominant: "anger", intensity: 60, components: ["anger"] } }),
    );
    expect(stats).toEqual({
      mood: { level: expect.any(Number), name: "Anger", emoji: "😠" },
      hunger: 0,
      thirst: 0,
      energy: 100,
      sickness: 0,
      alcohol: 0,
      bathroom: 0,
      substance: 0,
    });
  });
});
