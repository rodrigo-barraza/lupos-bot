const TraitRegistry = (await import("../TraitRegistry.js")).default;

describe("TraitRegistry", () => {
  // Registry state is module-level; restore initial levels after each test.
  afterEach(() => {
    for (const stat of TraitRegistry.getAll()) {
      stat.reset();
    }
    vi.restoreAllMocks();
  });

  describe("trait configs", () => {
    test("registers all 8 traits", () => {
      const names = TraitRegistry.getAll().map((stat) => stat.getName());
      expect(names.sort()).toEqual(
        [
          "alcohol",
          "bathroom",
          "energy",
          "hunger",
          "mood",
          "sickness",
          "substance",
          "thirst",
        ].sort(),
      );
    });

    test("initial levels match the old wrapper services", () => {
      expect(TraitRegistry.get("mood").getLevel()).toBe(0);
      expect(TraitRegistry.get("hunger").getLevel()).toBe(0);
      expect(TraitRegistry.get("thirst").getLevel()).toBe(0);
      expect(TraitRegistry.get("energy").getLevel()).toBe(100);
      expect(TraitRegistry.get("sickness").getLevel()).toBe(0);
      expect(TraitRegistry.get("alcohol").getLevel()).toBe(0);
      expect(TraitRegistry.get("bathroom").getLevel()).toBe(0);
      expect(TraitRegistry.get("substance").getLevel()).toBe(0);
    });

    test("0-100 traits clamp to their range", () => {
      for (const name of ["hunger", "thirst", "energy", "bathroom"] as const) {
        const stat = TraitRegistry.get(name);
        expect(stat.setLevel(150)).toBe(100);
        expect(stat.setLevel(-5)).toBe(0);
      }
    });

    test("0-10 traits clamp to their range", () => {
      for (const name of ["alcohol", "substance"] as const) {
        const stat = TraitRegistry.get(name);
        expect(stat.setLevel(11)).toBe(10);
        expect(stat.setLevel(-1)).toBe(0);
      }
    });

    test("mood clamps to -10..10", () => {
      const mood = TraitRegistry.get("mood");
      expect(mood.setLevel(15)).toBe(10);
      expect(mood.setLevel(-15)).toBe(-10);
    });

    test("sickness increases in steps of 10", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const sickness = TraitRegistry.get("sickness");
      expect(sickness.increase()).toBe(10);
      expect(sickness.increase(2)).toBe(30);
      expect(sickness.decrease()).toBe(20);
    });

    test("other traits increase in steps of 1", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const hunger = TraitRegistry.get("hunger");
      expect(hunger.increase()).toBe(1);
      expect(hunger.increase(5)).toBe(6);
      expect(hunger.decrease(3)).toBe(3);
    });
  });

  describe("toStatsObject", () => {
    test("returns the exact /bot/stats somatic shape at initial state", () => {
      expect(TraitRegistry.toStatsObject()).toEqual({
        mood: { level: 0, name: "Neutral", emoji: "😑" },
        hunger: 0,
        thirst: 0,
        energy: 100,
        sickness: 0,
        alcohol: 0,
        bathroom: 0,
        substance: 0,
      });
    });

    test("preserves the key order /bot/stats has always served", () => {
      expect(Object.keys(TraitRegistry.toStatsObject())).toEqual([
        "mood",
        "hunger",
        "thirst",
        "energy",
        "sickness",
        "alcohol",
        "bathroom",
        "substance",
      ]);
    });

    test("reflects current levels", () => {
      TraitRegistry.get("hunger").setLevel(42);
      TraitRegistry.get("mood").setLevel(10);
      const stats = TraitRegistry.toStatsObject();
      expect(stats.hunger).toBe(42);
      expect(stats.mood).toEqual({
        level: 10,
        name: "Blissful",
        emoji: "😎",
      });
    });

    test("falls back to Unknown for a mood level with no MOODS entry", () => {
      TraitRegistry.get("mood").setLevel(0.5);
      expect(TraitRegistry.toStatsObject().mood).toEqual({
        level: 0.5,
        name: "Unknown",
        emoji: "😐",
      });
    });
  });

  describe("getMoodName", () => {
    test("returns Neutral at level 0", () => {
      expect(TraitRegistry.getMoodName()).toBe("Neutral");
    });

    test("returns the MOODS name for the current level", () => {
      TraitRegistry.get("mood").setLevel(-10);
      expect(TraitRegistry.getMoodName()).toBe("Enraged");
    });

    test("returns Unknown when no MOODS entry matches", () => {
      TraitRegistry.get("mood").setLevel(0.5);
      expect(TraitRegistry.getMoodName()).toBe("Unknown");
    });
  });
});
