// Mock StatService — the factory that BathroomService delegates to
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
    getName: vi.fn(() => "bathroom"),
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

const BathroomService = (await import("../../services/BathroomService.js"))
  .default;
const { __resetLevel } = await import("../../services/StatService");

describe("BathroomService", () => {
  beforeEach(() => {
    __resetLevel();
    BathroomService.setBathroomLevel(0);
    vi.clearAllMocks();
  });

  test("should initialize with a bathroom level of 0", () => {
    expect(BathroomService.getBathroomLevel()).toBe(0);
  });

  test("setBathroomLevel should update the bathroom level", () => {
    BathroomService.setBathroomLevel(50);
    expect(BathroomService.getBathroomLevel()).toBe(50);
  });

  test("increaseBathroomLevel should increase the level by 1", () => {
    BathroomService.setBathroomLevel(50);
    const newLevel = BathroomService.increaseBathroomLevel();
    expect(newLevel).toBe(51);
    expect(BathroomService.getBathroomLevel()).toBe(51);
  });

  test("increaseBathroomLevel should not exceed 100", () => {
    BathroomService.setBathroomLevel(100);
    const newLevel = BathroomService.increaseBathroomLevel();
    expect(newLevel).toBe(100);
    expect(BathroomService.getBathroomLevel()).toBe(100);
  });

  test("decreaseBathroomLevel should decrease the level by 1", () => {
    BathroomService.setBathroomLevel(50);
    const newLevel = BathroomService.decreaseBathroomLevel();
    expect(newLevel).toBe(49);
    expect(BathroomService.getBathroomLevel()).toBe(49);
  });

  test("decreaseBathroomLevel should not fall below 0", () => {
    BathroomService.setBathroomLevel(0);
    const newLevel = BathroomService.decreaseBathroomLevel();
    expect(newLevel).toBe(0);
    expect(BathroomService.getBathroomLevel()).toBe(0);
  });
});
