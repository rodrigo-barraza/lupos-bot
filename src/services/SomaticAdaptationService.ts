import HungerService from "./HungerService.js";
import ThirstService from "./ThirstService.js";
import EnergyService from "./EnergyService.js";
import SicknessService from "./SicknessService.js";
import AlcoholService from "./AlcoholService.js";
import BathroomService from "./BathroomService.js";
import SubstanceService from "./SubstanceService.js";

// Semantic Regex Mappings
const FOOD_KEYWORDS = /\b(pizza|burger|taco|food|eat|eating|ramen|snack|cookie|lunch|dinner|breakfast|feast|delicious|yum|yummy|hungry|starving)\b|🍔|🍕|🌮|🍜|🍪/i;
const DRINK_KEYWORDS = /\b(water|soda|juice|tea|drink|drinking|sips|hydrate|coffee|fluid|quenched|thirsty|dehydrated)\b|🥛|🥤|🧃|☕/i;
const REST_KEYWORDS = /\b(sleep|nap|tired|rest|goodnight|bed|exhausted|sleepy|lazy)\b|😴|💤/i;
const WORK_KEYWORDS = /\b(work|coding|code|gaming|game|study|studying|running|run|push|exertion|labor|exercise|typing|testing)\b/i;
const SICK_KEYWORDS = /\b(poison|bleach|trash|vomit|sick|flu|covid|ill|illness|disease|nausea|pain|hurt|stomachache)\b|🤢|🤮|😷/i;
const ALCOHOL_KEYWORDS = /\b(beer|wine|whiskey|vodka|alcohol|drunk|party|shots|tipsy|inebriated|cocktail|booze)\b|🍺|🍻|🍷|🥃|🍸/i;
const SUBSTANCE_KEYWORDS = /\b(weed|marijuana|joint|smoke|high|stoned|baked|blunt|vape|trip|tripping|acid|shrooms|mushroom|cbd|thc|substance|intoxicated)\b|🌿|🚬|🍄|🌀/i;
const BATHROOM_KEYWORDS = /\b(toilet|bathroom|restroom|pee|poop|piss|shit|flush|lavatory|washroom)\b|🚽|🧻/i;

export default class SomaticAdaptationService {
  /**
   * Adapts Lupos's somatic states dynamically based on incoming conversational text context.
   * This is part of the Somatic Contextual Adaptation System to align simulated biology with chat.
   */
  static adaptFromMessage(text: string): void {
    if (!text) return;
    const cleanText = text.toLowerCase();

    // 1. Homeostatic drift applied on every conversational turn to prevent static locking
    this.applyHomeostaticDrift();

    // 2. Food -> Decrease Hunger (satisfies), Increase Bathroom slightly
    if (FOOD_KEYWORDS.test(cleanText)) {
      const previousLevel = HungerService.getHungerLevel();
      HungerService.decreaseHungerLevel();
      const currentLevel = HungerService.getHungerLevel();
      console.log(`🍖 [SomaticAdaptationService] Food keyword matched. Hunger level: ${previousLevel} -> ${currentLevel}`);
      BathroomService.increaseBathroomLevel();
    }

    // 3. Drinks -> Decrease Thirst, Increase Bathroom
    if (DRINK_KEYWORDS.test(cleanText)) {
      const previousLevel = ThirstService.getThirstLevel();
      ThirstService.decreaseThirstLevel();
      const currentLevel = ThirstService.getThirstLevel();
      console.log(`💧 [SomaticAdaptationService] Drink keyword matched. Thirst level: ${previousLevel} -> ${currentLevel}`);
      BathroomService.increaseBathroomLevel();
    }

    // 4. Rest -> Increase Energy
    if (REST_KEYWORDS.test(cleanText)) {
      const previousLevel = EnergyService.getEnergyLevel();
      EnergyService.increaseEnergyLevel();
      const currentLevel = EnergyService.getEnergyLevel();
      console.log(`💤 [SomaticAdaptationService] Rest keyword matched. Energy level: ${previousLevel} -> ${currentLevel}`);
    }

    // 5. Work/Activity -> Decrease Energy (fatigues)
    if (WORK_KEYWORDS.test(cleanText)) {
      const previousLevel = EnergyService.getEnergyLevel();
      EnergyService.decreaseEnergyLevel();
      const currentLevel = EnergyService.getEnergyLevel();
      console.log(`🔨 [SomaticAdaptationService] Work/Activity keyword matched. Energy level: ${previousLevel} -> ${currentLevel}`);
    }

    // 6. Sick/Toxins -> Increase Sickness
    if (SICK_KEYWORDS.test(cleanText)) {
      const previousLevel = SicknessService.getSicknessLevel();
      SicknessService.increaseSicknessLevel();
      const currentLevel = SicknessService.getSicknessLevel();
      console.log(`🤮 [SomaticAdaptationService] Sickness keyword matched. Sickness level: ${previousLevel} -> ${currentLevel}`);
    }

    // 7. Alcohol -> Increase Alcohol, decrease mood slightly if too drunk (or keep happy)
    if (ALCOHOL_KEYWORDS.test(cleanText)) {
      const previousLevel = AlcoholService.getAlcoholLevel();
      AlcoholService.increaseAlcoholLevel();
      const currentLevel = AlcoholService.getAlcoholLevel();
      console.log(`🍺 [SomaticAdaptationService] Alcohol keyword matched. Alcohol level: ${previousLevel} -> ${currentLevel}`);
    }

    // 7.5. Substance -> Increase Substance
    if (SUBSTANCE_KEYWORDS.test(cleanText)) {
      const previousLevel = SubstanceService.getSubstanceLevel();
      SubstanceService.increaseSubstanceLevel();
      const currentLevel = SubstanceService.getSubstanceLevel();
      console.log(`🌿 [SomaticAdaptationService] Substance keyword matched. Substance level: ${previousLevel} -> ${currentLevel}`);
    }

    // 8. Bathroom -> Reset/Decrease Bathroom level
    if (BATHROOM_KEYWORDS.test(cleanText)) {
      const previousLevel = BathroomService.getBathroomLevel();
      BathroomService.decreaseBathroomLevel();
      const currentLevel = BathroomService.getBathroomLevel();
      console.log(`🚽 [SomaticAdaptationService] Bathroom keyword matched. Bathroom level: ${previousLevel} -> ${currentLevel}`);
    }
  }

  /**
   * Applies slow baseline recovery of biological systems to prevent extreme lockups (Boundary Convergence).
   */
  static applyHomeostaticDrift(): void {
    // 1. Energy recovers slowly if below baseline
    const energy = EnergyService.getEnergyLevel();
    if (energy < 100) {
      // Re-energize slowly by 2
      EnergyService.setEnergyLevel(energy + 2);
    }

    // 2. Sickness slowly heals over time toward healthy baseline (0)
    const sickness = SicknessService.getSicknessLevel();
    if (sickness > 0) {
      SicknessService.setSicknessLevel(sickness - 5);
    }

    // 3. Alcohol naturally metabolizes and clears over time
    const alcohol = AlcoholService.getAlcoholLevel();
    if (alcohol > 0) {
      AlcoholService.setAlcoholLevel(alcohol - 1);
    }

    // 4. Substance naturally metabolizes and clears over time
    const substance = SubstanceService.getSubstanceLevel();
    if (substance > 0) {
      SubstanceService.setSubstanceLevel(substance - 1);
    }
  }
}
