import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock StatService — the factory that SubstanceService delegates to
vi.mock("../StatService", () => {
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
    getName: vi.fn(() => "substance"),
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

const SubstanceService = (await import("../SubstanceService.js"))
  .default;
const { __resetLevel } = await import("../StatService");

describe("SubstanceService", () => {
  beforeEach(() => {
    __resetLevel();
    SubstanceService.setSubstanceLevel(0);
    vi.clearAllMocks();
  });

  test("should initialize with a substance level of 0", () => {
    expect(SubstanceService.getSubstanceLevel()).toBe(0);
  });

  test("setSubstanceLevel should update the substance level", () => {
    SubstanceService.setSubstanceLevel(5);
    expect(SubstanceService.getSubstanceLevel()).toBe(5);
  });

  test("increaseSubstanceLevel should increase the level by 1", () => {
    SubstanceService.setSubstanceLevel(5);
    const newLevel = SubstanceService.increaseSubstanceLevel();
    expect(newLevel).toBe(6);
    expect(SubstanceService.getSubstanceLevel()).toBe(6);
  });

  test("increaseSubstanceLevel should not exceed 10", () => {
    SubstanceService.setSubstanceLevel(10);
    const newLevel = SubstanceService.increaseSubstanceLevel();
    expect(newLevel).toBe(10);
    expect(SubstanceService.getSubstanceLevel()).toBe(10);
  });

  test("decreaseSubstanceLevel should decrease the level by 1", () => {
    SubstanceService.setSubstanceLevel(5);
    const newLevel = SubstanceService.decreaseSubstanceLevel();
    expect(newLevel).toBe(4);
    expect(SubstanceService.getSubstanceLevel()).toBe(4);
  });

  test("decreaseSubstanceLevel should not fall below 0", () => {
    SubstanceService.setSubstanceLevel(0);
    const newLevel = SubstanceService.decreaseSubstanceLevel();
    expect(newLevel).toBe(0);
    expect(SubstanceService.getSubstanceLevel()).toBe(0);
  });
});
