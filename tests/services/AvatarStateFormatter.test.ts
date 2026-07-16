/**
 * AvatarStateFormatter.test.ts
 *
 * Tests the somatic-state → mood-set portrait resolution:
 *   1. resolveAvatarState — physical extremes override mood, ladder order,
 *      dominant-emotion mapping (primaries, dyads, furious-anger variant),
 *      neutral fallback when prism is unreachable.
 *   2. AVATAR_KEYS — every key resolves to a PNG that actually exists in
 *      images/mood-set, so /bot/avatar/:key can never 404 on a known key.
 */

import fs from "fs";
import path from "path";
import {
  resolveAvatarState,
  AVATAR_KEYS,
} from "../../src/formatters/AvatarStateFormatter.js";
import type { SomaticStats } from "../../src/services/TraitRegistry.js";

function makeStats(overrides: Partial<Omit<SomaticStats, "mood">> = {}): SomaticStats {
  return {
    mood: { level: 50, name: "Neutral", emoji: "😑" },
    hunger: 0,
    thirst: 0,
    energy: 100,
    sickness: 0,
    alcohol: 0,
    bathroom: 0,
    substance: 0,
    ...overrides,
  };
}

describe("resolveAvatarState — mood mapping", () => {
  it("maps a primary emotion to its mood portrait", () => {
    const result = resolveAvatarState(makeStats(), { dominant: "joy", intensity: 60 });
    expect(result).toEqual({ key: "mood-joy", source: "mood", label: "Joy" });
  });

  it("maps a dyad to its mood portrait", () => {
    const result = resolveAvatarState(makeStats(), { dominant: "love", intensity: 40 });
    expect(result).toEqual({ key: "mood-love", source: "mood", label: "Love" });
  });

  it("uses the furious variant for high-intensity anger", () => {
    expect(
      resolveAvatarState(makeStats(), { dominant: "anger", intensity: 85 }).key,
    ).toBe("mood-anger-furious");
    expect(
      resolveAvatarState(makeStats(), { dominant: "anger", intensity: 50 }).key,
    ).toBe("mood-anger");
  });

  it("falls back to neutral without emotion data (prism down)", () => {
    expect(resolveAvatarState(makeStats(), null)).toEqual({
      key: "mood-neutral",
      source: "mood",
      label: "Neutral",
    });
    expect(resolveAvatarState(makeStats()).key).toBe("mood-neutral");
  });

  it("falls back to neutral for an unknown emotion id", () => {
    expect(
      resolveAvatarState(makeStats(), { dominant: "zesty", intensity: 90 }).key,
    ).toBe("mood-neutral");
  });

  it("is case-insensitive on the dominant emotion", () => {
    expect(
      resolveAvatarState(makeStats(), { dominant: "Curiosity", intensity: 30 }).key,
    ).toBe("mood-curiosity");
  });
});

describe("resolveAvatarState — physical state ladder", () => {
  it("severe physical states override any mood", () => {
    const joy = { dominant: "joy", intensity: 100 };
    expect(resolveAvatarState(makeStats({ alcohol: 7 }), joy).key).toBe("state-wasted");
    expect(resolveAvatarState(makeStats({ substance: 7 }), joy).key).toBe("state-tripping");
    expect(resolveAvatarState(makeStats({ sickness: 70 }), joy).key).toBe("state-severely-ill");
    expect(resolveAvatarState(makeStats({ hunger: 80 }), joy).key).toBe("state-starving");
    expect(resolveAvatarState(makeStats({ thirst: 80 }), joy).key).toBe("state-parched");
    expect(resolveAvatarState(makeStats({ bathroom: 80 }), joy).key).toBe("state-gotta-go");
    expect(resolveAvatarState(makeStats({ energy: 10 }), joy).key).toBe("state-exhausted");
  });

  it("moderate states pre-empt mood at their thresholds", () => {
    const joy = { dominant: "joy", intensity: 100 };
    expect(resolveAvatarState(makeStats({ alcohol: 4 }), joy).key).toBe("state-drunk");
    expect(resolveAvatarState(makeStats({ alcohol: 2 }), joy).key).toBe("state-tipsy");
    expect(resolveAvatarState(makeStats({ substance: 4 }), joy).key).toBe("state-high");
    expect(resolveAvatarState(makeStats({ sickness: 40 }), joy).key).toBe("state-nauseous");
    expect(resolveAvatarState(makeStats({ hunger: 65 }), joy).key).toBe("state-hungry");
    expect(resolveAvatarState(makeStats({ energy: 25 }), joy).key).toBe("state-tired");
  });

  it("below every threshold, mood wins", () => {
    const stats = makeStats({
      hunger: 60,
      thirst: 75,
      energy: 30,
      sickness: 35,
      alcohol: 1,
      substance: 3,
      bathroom: 75,
    });
    const result = resolveAvatarState(stats, { dominant: "hope", intensity: 55 });
    expect(result).toEqual({ key: "mood-hope", source: "mood", label: "Hope" });
  });

  it("severe tier outranks moderate tier regardless of ladder position", () => {
    // Drunk (moderate, listed early) must lose to starving (severe).
    const stats = makeStats({ alcohol: 4, hunger: 85 });
    expect(resolveAvatarState(stats, null).key).toBe("state-starving");
  });

  it("reports source and label for state picks", () => {
    const result = resolveAvatarState(makeStats({ alcohol: 9 }), null);
    expect(result).toEqual({ key: "state-wasted", source: "state", label: "Wasted" });
  });
});

describe("AVATAR_KEYS ↔ images/mood-set", () => {
  const moodSetDirectory = path.resolve(import.meta.dirname, "../../images/mood-set");

  it("every declared key has a PNG on disk", () => {
    for (const key of AVATAR_KEYS) {
      expect(
        fs.existsSync(path.join(moodSetDirectory, `${key}.png`)),
        `missing ${key}.png`,
      ).toBe(true);
    }
  });

  it("every PNG on disk has a declared key (no orphaned portraits)", () => {
    const files = fs
      .readdirSync(moodSetDirectory)
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.replace(/\.png$/, ""));
    for (const file of files) {
      expect(AVATAR_KEYS.has(file), `undeclared portrait ${file}.png`).toBe(true);
    }
    expect(files.length).toBe(AVATAR_KEYS.size);
  });
});
