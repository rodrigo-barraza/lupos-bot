/**
 * TraitRegistry — config-driven registry of the bot's somatic trait stats.
 *
 * Replaces the eight per-trait wrapper services (MoodService, HungerService,
 * ThirstService, EnergyService, SicknessService, AlcoholService,
 * BathroomService, SubstanceService) that were deleted under improvement-plan
 * item R8 option (a). Persona/somatic state lives server-side in Prism; the
 * only live consumer of these in-memory stats is `GET /bot/stats`.
 *
 * Trait state is memory-only and resets on every restart.
 */

import StatService from "#root/services/StatService.ts";
import type { StatInstance, StatOptions } from "#root/services/StatService.ts";
import { MOODS } from "#root/constants.ts";
import type { MoodEntry } from "#root/types/index.ts";

/** Per-trait configs, copied verbatim from the deleted wrapper services. */
const TRAIT_CONFIGS = {
  mood: { min: -10, max: 10, initial: 0 },
  hunger: { min: 0, max: 100, initial: 0 },
  thirst: { min: 0, max: 100, initial: 0 },
  energy: { min: 0, max: 100, initial: 100 },
  sickness: { min: 0, max: 100, initial: 0, step: 10 },
  alcohol: { min: 0, max: 10, initial: 0 },
  bathroom: { min: 0, max: 100, initial: 0 },
  substance: { min: 0, max: 10, initial: 0 },
} as const satisfies Record<string, StatOptions>;

export type TraitName = keyof typeof TRAIT_CONFIGS;

const traits = new Map<TraitName, StatInstance>(
  (Object.entries(TRAIT_CONFIGS) as [TraitName, StatOptions][]).map(
    ([name, options]) => [name, StatService.create(name, options)],
  ),
);

/** Shape of the `somatic` object returned by GET /bot/stats. */
export interface SomaticStats {
  mood: { level: number; name: string; emoji: string };
  hunger: number;
  thirst: number;
  energy: number;
  sickness: number;
  alcohol: number;
  bathroom: number;
  substance: number;
}

const TraitRegistry = {
  /** Returns the stat instance for a trait. */
  get(name: TraitName): StatInstance {
    const stat = traits.get(name);
    if (!stat) {
      throw new Error(`[TraitRegistry] Unknown trait: ${name}`);
    }
    return stat;
  },

  /** Returns all registered stat instances. */
  getAll(): StatInstance[] {
    return [...traits.values()];
  },

  /** Returns the MOODS entry name for the current mood level. */
  getMoodName(): string {
    const level = TraitRegistry.get("mood").getLevel();
    const mood = MOODS.find((entry: MoodEntry) => entry.level === level);
    return mood?.name || "Unknown";
  },

  /**
   * Builds the `somatic` object served by GET /bot/stats.
   * Prism reads this endpoint — the shape must stay stable.
   */
  toStatsObject(): SomaticStats {
    const moodLevel = TraitRegistry.get("mood").getLevel();
    const currentMood = MOODS.find(
      (entry: MoodEntry) => entry.level === moodLevel,
    ) || {
      name: "Unknown",
      emoji: "😐",
    };

    return {
      mood: {
        level: moodLevel,
        name: currentMood.name,
        emoji: currentMood.emoji,
      },
      hunger: TraitRegistry.get("hunger").getLevel(),
      thirst: TraitRegistry.get("thirst").getLevel(),
      energy: TraitRegistry.get("energy").getLevel(),
      sickness: TraitRegistry.get("sickness").getLevel(),
      alcohol: TraitRegistry.get("alcohol").getLevel(),
      bathroom: TraitRegistry.get("bathroom").getLevel(),
      substance: TraitRegistry.get("substance").getLevel(),
    };
  },
};

export default TraitRegistry;
