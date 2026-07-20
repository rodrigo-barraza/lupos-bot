const StatService = (await import("../StatService.ts")).default;

describe("StatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("create should initialize with the initial level", () => {
    const stat = StatService.create("hunger", { initial: 25 });
    expect(stat.getLevel()).toBe(25);
  });

  test("setLevel should update and clamp the level", () => {
    const stat = StatService.create("hunger", { min: 0, max: 100 });
    expect(stat.setLevel(50)).toBe(50);
    expect(stat.setLevel(150)).toBe(100);
    expect(stat.setLevel(-10)).toBe(0);
  });

  describe("setLevel non-finite input guards", () => {
    test("NaN is ignored and the current level is returned unchanged", () => {
      const stat = StatService.create("hunger", { initial: 40 });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(stat.setLevel(NaN)).toBe(40);
      expect(stat.getLevel()).toBe(40);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("Infinity and -Infinity are ignored", () => {
      const stat = StatService.create("thirst", { initial: 30 });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(stat.setLevel(Infinity)).toBe(30);
      expect(stat.setLevel(-Infinity)).toBe(30);
      expect(stat.getLevel()).toBe(30);
      warnSpy.mockRestore();
    });

    test("undefined cast to number is ignored", () => {
      const stat = StatService.create("energy", { initial: 60 });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(stat.setLevel(undefined as unknown as number)).toBe(60);
      expect(stat.getLevel()).toBe(60);
      warnSpy.mockRestore();
    });

    test("invalid input does not trigger onChange", () => {
      const onChange = vi.fn();
      const stat = StatService.create("mood", { initial: 10, onChange });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      stat.setLevel(NaN);
      expect(onChange).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("a NaN attempt does not poison subsequent valid updates", () => {
      const stat = StatService.create("hunger", { initial: 20 });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      stat.setLevel(NaN);
      expect(stat.setLevel(55)).toBe(55);
      expect(stat.getLevel()).toBe(55);
      warnSpy.mockRestore();
    });
  });
});
