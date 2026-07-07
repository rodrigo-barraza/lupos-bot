import { describe, test, expect, beforeEach } from "vitest";

const SomaticAdaptationService = (await import("../SomaticAdaptationService.js")).default;
const HungerService = (await import("../HungerService.js")).default;
const ThirstService = (await import("../ThirstService.js")).default;
const EnergyService = (await import("../EnergyService.js")).default;
const SicknessService = (await import("../SicknessService.js")).default;
const AlcoholService = (await import("../AlcoholService.js")).default;
const SubstanceService = (await import("../SubstanceService.js")).default;
const BathroomService = (await import("../BathroomService.js")).default;

describe("SomaticAdaptationService", () => {
  beforeEach(() => {
    // Reset stats to predictable baselines
    HungerService.setHungerLevel(50);
    ThirstService.setThirstLevel(50);
    EnergyService.setEnergyLevel(50);
    SicknessService.setSicknessLevel(0);
    AlcoholService.setAlcoholLevel(0);
    SubstanceService.setSubstanceLevel(0);
    BathroomService.setBathroomLevel(50);
  });

  test("should decrease hunger when food is mentioned", () => {
    const hungerBefore = HungerService.getHungerLevel();
    SomaticAdaptationService.adaptFromMessage("Who wants to eat some delicious pizza? 🍕");
    const hungerAfter = HungerService.getHungerLevel();
    expect(hungerAfter).toBeLessThan(hungerBefore);
  });

  test("should decrease thirst when drink is mentioned", () => {
    const thirstBefore = ThirstService.getThirstLevel();
    SomaticAdaptationService.adaptFromMessage("Lupos, have some refreshing water! 🥛");
    const thirstAfter = ThirstService.getThirstLevel();
    expect(thirstAfter).toBeLessThan(thirstBefore);
  });

  test("should increase energy when rest is mentioned", () => {
    const energyBefore = EnergyService.getEnergyLevel();
    SomaticAdaptationService.adaptFromMessage("Time to sleep, goodnight!");
    const energyAfter = EnergyService.getEnergyLevel();
    expect(energyAfter).toBeGreaterThan(energyBefore);
  });

  test("should decrease energy when work is mentioned", () => {
    // Energy starts at 50. Homeostatic drift will recover it to 52,
    // and then work keyword decreases it to 51.
    SomaticAdaptationService.adaptFromMessage("I have been coding all day long.");
    const energyAfter = EnergyService.getEnergyLevel();
    expect(energyAfter).toBe(51);
  });

  test("should increase sickness when sick/toxic words are mentioned", () => {
    const sicknessBefore = SicknessService.getSicknessLevel();
    SomaticAdaptationService.adaptFromMessage("Lupos got infected with a nasty virus 🤢");
    const sicknessAfter = SicknessService.getSicknessLevel();
    expect(sicknessAfter).toBeGreaterThan(sicknessBefore);
  });

  test("should increase alcohol level when booze is mentioned", () => {
    const alcoholBefore = AlcoholService.getAlcoholLevel();
    SomaticAdaptationService.adaptFromMessage("Let's drink some cold beer! 🍺");
    const alcoholAfter = AlcoholService.getAlcoholLevel();
    expect(alcoholAfter).toBeGreaterThan(alcoholBefore);
  });

  test("should decrease bathroom level when restroom words are mentioned", () => {
    const bathroomBefore = BathroomService.getBathroomLevel();
    SomaticAdaptationService.adaptFromMessage("I need to use the toilet urgently 🚽");
    const bathroomAfter = BathroomService.getBathroomLevel();
    expect(bathroomAfter).toBeLessThan(bathroomBefore);
  });

  test("should increase substance level when weed or psychedelics are mentioned", () => {
    const substanceBefore = SubstanceService.getSubstanceLevel();
    SomaticAdaptationService.adaptFromMessage("Let's smoke a joint and trip on some shrooms! 🍄🚬");
    const substanceAfter = SubstanceService.getSubstanceLevel();
    expect(substanceAfter).toBeGreaterThan(substanceBefore);
  });

  test("should apply homeostatic drift to recover energy, sickness, alcohol, and substance over time", () => {
    EnergyService.setEnergyLevel(80);
    SicknessService.setSicknessLevel(40);
    AlcoholService.setAlcoholLevel(5);
    SubstanceService.setSubstanceLevel(5);

    SomaticAdaptationService.applyHomeostaticDrift();

    expect(EnergyService.getEnergyLevel()).toBe(82); // recovering
    expect(SicknessService.getSicknessLevel()).toBe(35); // healing
    expect(AlcoholService.getAlcoholLevel()).toBe(4); // sobering up
    expect(SubstanceService.getSubstanceLevel()).toBe(4); // sobering up from substance
  });
});
