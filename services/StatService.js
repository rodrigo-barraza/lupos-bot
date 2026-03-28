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

const StatService = {
  /**
   * Creates a new stat instance with clamped get/set/increase/decrease.
   *
   * @param {string} name - Human-readable name for logging.
   * @param {object} options
   * @param {number} [options.min=0] - Minimum allowed value.
   * @param {number} [options.max=100] - Maximum allowed value.
   * @param {number} [options.initial=0] - Starting value.
   * @param {number} [options.step=1] - Default increment/decrement amount.
   * @param {function} [options.onChange] - Callback fired after every level change.
   * @returns {object} A stat instance with getLevel, setLevel, increase, decrease, getName.
   */
  create(name, options = {}) {
    const {
      min = 0,
      max = 100,
      initial = 0,
      step = 1,
      onChange = null,
    } = options;

    let level = initial;

    const clamp = (value) => Math.max(min, Math.min(max, value));

    const stat = {
      getName() {
        return name;
      },

      getLevel() {
        return level;
      },

      setLevel(newLevel) {
        level = clamp(newLevel);
        if (onChange) onChange(level, name);
        return level;
      },

      increase(multiplier = 1) {
        const amount = step * multiplier;
        level = clamp(level + amount);
        console.log(
          `${name.charAt(0).toUpperCase() + name.slice(1)} level increased to: ${level}`,
        );
        if (onChange) onChange(level, name);
        return level;
      },

      decrease(multiplier = 1) {
        const amount = step * multiplier;
        level = clamp(level - amount);
        console.log(
          `${name.charAt(0).toUpperCase() + name.slice(1)} level decreased to: ${level}`,
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
