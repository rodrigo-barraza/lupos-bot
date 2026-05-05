// Mock StatService — the factory that ThirstService delegates to
vi.mock("../../services/StatService", () => {
  let level = 0;
  const mockStat = {
    getLevel: vi.fn(() => level),
    setLevel: vi.fn((v) => {
      level = Math.max(0, Math.min(100, v));
      return level;
    }),
    increase: vi.fn((m = 1) => {
      level = Math.min(100, level + m);
      return level;
    }),
    decrease: vi.fn((m = 1) => {
      level = Math.max(0, level - m);
      return level;
    }),
    getName: vi.fn(() => "thirst"),
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

const ThirstService = (await import("../../services/ThirstService.js")).default;
const { __resetLevel } = await import("../../services/StatService");

describe("ThirstService", () => {
  beforeEach(() => {
    __resetLevel();
    ThirstService.setThirstLevel(0);
    vi.clearAllMocks();
  });

  test("should initialize with a thirst level of 0", () => {
    expect(ThirstService.getThirstLevel()).toBe(0);
  });

  test("setThirstLevel should update the thirst level", () => {
    ThirstService.setThirstLevel(50);
    expect(ThirstService.getThirstLevel()).toBe(50);
  });

  test("increaseThirstLevel should increase the level by 1", () => {
    ThirstService.setThirstLevel(50);
    const newLevel = ThirstService.increaseThirstLevel();
    expect(newLevel).toBe(51);
    expect(ThirstService.getThirstLevel()).toBe(51);
  });

  test("increaseThirstLevel should not exceed 100", () => {
    ThirstService.setThirstLevel(100);
    const newLevel = ThirstService.increaseThirstLevel();
    expect(newLevel).toBe(100);
    expect(ThirstService.getThirstLevel()).toBe(100);
  });

  test("decreaseThirstLevel should decrease the level by 1", () => {
    ThirstService.setThirstLevel(50);
    const newLevel = ThirstService.decreaseThirstLevel();
    expect(newLevel).toBe(49);
    expect(ThirstService.getThirstLevel()).toBe(49);
  });

  test("decreaseThirstLevel should not fall below 0", () => {
    ThirstService.setThirstLevel(0);
    const newLevel = ThirstService.decreaseThirstLevel();
    expect(newLevel).toBe(0);
    expect(ThirstService.getThirstLevel()).toBe(0);
  });
});
