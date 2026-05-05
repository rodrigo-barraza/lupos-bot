// Mock StatService — the factory that AlcoholService delegates to
vi.mock("../../services/StatService", () => {
  let level = 0;
  const mockStat = {
    getLevel: vi.fn(() => level),
    setLevel: vi.fn((v) => {
      level = Math.max(0, Math.min(10, v));
      return level;
    }),
    increase: vi.fn((m = 1) => {
      level = Math.min(10, level + m);
      return level;
    }),
    decrease: vi.fn((m = 1) => {
      level = Math.max(0, level - m);
      return level;
    }),
    getName: vi.fn(() => "alcohol"),
    reset: vi.fn(() => {
      level = 0;
      return level;
    }),
  };
  return {
    default: {
      create: vi.fn(() => mockStat),
    },
    __mockStat: mockStat,
    __resetLevel: () => {
      level = 0;
    },
  };
});

const AlcoholService = (await import("../../services/AlcoholService.js"))
  .default;
const { __resetLevel } = await import("../../services/StatService");

describe("AlcoholService", () => {
  beforeEach(() => {
    __resetLevel();
    AlcoholService.setAlcoholLevel(0);
    vi.clearAllMocks();
  });

  test("should initialize with an alcohol level of 0", () => {
    expect(AlcoholService.getAlcoholLevel()).toBe(0);
  });

  test("setAlcoholLevel should update the alcohol level", () => {
    AlcoholService.setAlcoholLevel(5);
    expect(AlcoholService.getAlcoholLevel()).toBe(5);
  });

  test("increaseAlcoholLevel should increase the level by 1", () => {
    AlcoholService.setAlcoholLevel(5);
    const newLevel = AlcoholService.increaseAlcoholLevel();
    expect(newLevel).toBe(6);
    expect(AlcoholService.getAlcoholLevel()).toBe(6);
  });

  test("increaseAlcoholLevel should not exceed 10", () => {
    AlcoholService.setAlcoholLevel(10);
    const newLevel = AlcoholService.increaseAlcoholLevel();
    expect(newLevel).toBe(10);
    expect(AlcoholService.getAlcoholLevel()).toBe(10);
  });

  test("decreaseAlcoholLevel should decrease the level by 1", () => {
    AlcoholService.setAlcoholLevel(5);
    const newLevel = AlcoholService.decreaseAlcoholLevel();
    expect(newLevel).toBe(4);
    expect(AlcoholService.getAlcoholLevel()).toBe(4);
  });

  test("decreaseAlcoholLevel should not fall below 0", () => {
    AlcoholService.setAlcoholLevel(0);
    const newLevel = AlcoholService.decreaseAlcoholLevel();
    expect(newLevel).toBe(0);
    expect(AlcoholService.getAlcoholLevel()).toBe(0);
  });

  test("generateAlcoholSystemPrompt should return a prompt with the correct alcohol level text", () => {
    AlcoholService.setAlcoholLevel(1);
    const prompt1 = AlcoholService.generateAlcoholSystemPrompt();
    expect(prompt1).toContain("1/10 drunk");

    AlcoholService.setAlcoholLevel(10);
    const prompt10 = AlcoholService.generateAlcoholSystemPrompt();
    expect(prompt10).toContain("10/10 drunk");
    expect(prompt10).toContain("You slur every single word");
  });

  test("generateAlcoholSystemPrompt should return empty string if level is 0", () => {
    AlcoholService.setAlcoholLevel(0);
    const prompt0 = AlcoholService.generateAlcoholSystemPrompt();
    expect(prompt0).toBe("");
  });
});
