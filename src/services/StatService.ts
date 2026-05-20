/**
 * StatService — Factory for creating personality trait stat instances.
 *
 * Eliminates the duplicated get/set/increase/decrease boilerplate
 * across HungerService, ThirstService, EnergyService, AlcoholService,
 * BathroomService, SicknessService, and MoodService.
 *
 * Usage:
 *   const hunger = StatService.create("hunger", { min: 0, max: 100, initial: 0 });
 *   hunger.increase();       // 1
 *   hunger.increase(5);      // 6
 *   hunger.decrease(3);      // 3
 *   hunger.getLevel();       // 3
 *   hunger.setLevel(50);
 *   hunger.getName();        // "hunger"
 */

import utilities from "#root/utilities.js";

export interface StatOptions {
  min?: number;
  max?: number;
  initial?: number;
  step?: number;
  onChange?: ((level: number, name: string) => void) | null;
}

export interface StatInstance {
  getName(): string;
  getLevel(): number;
  setLevel(newLevel: number): number;
  increase(multiplier?: number): number;
  decrease(multiplier?: number): number;
  reset(): number;
}

const StatService = {
  /**
   * Creates a new stat instance with clamped get/set/increase/decrease.
   *
   * @returns {StatInstance} A stat instance with getLevel, setLevel, increase, decrease, getName.
   */
  create(name: string, options: StatOptions = {}): StatInstance {
    const {
      min = 0,
      max = 100,
      initial = 0,
      step = 1,
      onChange = null,
    } = options;

    let level = initial;

    const clamp = (value: number) => Math.max(min, Math.min(max, value));

    const stat: StatInstance = {
      getName() {
        return name;
      },

      getLevel() {
        return level;
      },

      setLevel(newLevel: number) {
        level = clamp(newLevel);
        if (onChange) onChange(level, name);
        return level;
      },

      increase(multiplier: number = 1) {
        const amount = step * multiplier;
        level = clamp(level + amount);
        const capitalized = utilities.capitalize(name);
        console.log(
          `${capitalized} level increased to: ${level}`,
        );
        if (onChange) onChange(level, name);
        return level;
      },

      decrease(multiplier: number = 1) {
        const amount = step * multiplier;
        level = clamp(level - amount);
        const capitalized = utilities.capitalize(name);
        console.log(
          `${capitalized} level decreased to: ${level}`,
        );
        if (onChange) onChange(level, name);
        return level;
      },

      reset() {
        level = initial;
        if (onChange) onChange(level, name);
        return level;
      },
    };

    return stat;
  },
};

export default StatService;
