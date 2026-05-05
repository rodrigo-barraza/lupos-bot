// Mock discord.js — MoodService imports { ActivityType } from discord.js
vi.mock("discord.js", () => ({
  ActivityType: {
    Playing: 0,
    Streaming: 1,
    Listening: 2,
    Watching: 3,
    Custom: 4,
    Competing: 5,
  },
}));

// Mock DiscordWrapper — MoodService imports from #root/wrappers/DiscordWrapper.js
vi.mock("../../wrappers/DiscordWrapper", () => ({
  default: {
    getClient: vi.fn().mockReturnValue({
      user: {
        setActivity: vi.fn(),
      },
    }),
  },
}));

// Mock DiscordUtilityService
vi.mock("../../services/DiscordUtilityService", () => ({
  default: {
    generateMoodTemperature: vi.fn().mockResolvedValue(0),
  },
}));

// Mock StatService — MoodService creates a stat with min:-10, max:10
vi.mock("../../services/StatService", () => {
  let level = 0;
  let onChangeFn = null;
  const mockStat = {
    getLevel: vi.fn(() => level),
    setLevel: vi.fn((v) => {
      level = Math.max(-10, Math.min(10, v));
      if (onChangeFn) onChangeFn(level, "mood");
      return level;
    }),
    increase: vi.fn((m = 1) => {
      level = Math.min(10, level + m);
      if (onChangeFn) onChangeFn(level, "mood");
      return level;
    }),
    decrease: vi.fn((m = 1) => {
      level = Math.max(-10, level - m);
      if (onChangeFn) onChangeFn(level, "mood");
      return level;
    }),
    getName: vi.fn(() => "mood"),
    reset: vi.fn(() => {
      level = 0;
      return level;
    }),
  };
  return {
    default: {
      create: vi.fn((name, opts) => {
        if (opts?.onChange) onChangeFn = opts.onChange;
        return mockStat;
      }),
    },
    __mockStat: mockStat,
    __resetLevel: () => {
      level = 0;
    },
  };
});

const MoodService = (await import("../../services/MoodService.js")).default;
const DiscordWrapper = (await import("../../wrappers/DiscordWrapper.js"))
  .default;
const DiscordUtilityService = (
  await import("../../services/DiscordUtilityService.js")
).default;
const { __resetLevel } = await import("../../services/StatService");

describe("MoodService", () => {
  beforeEach(() => {
    __resetLevel();
    MoodService.setMoodLevel(0);
    vi.clearAllMocks();
  });

  test("should initialize with a mood level of 0", () => {
    expect(MoodService.getMoodLevel()).toBe(0);
    expect(MoodService.getMoodName()).toBe("Neutral");
  });

  test("setMoodLevel should update mood level and set activity", () => {
    MoodService.setMoodLevel(5);
    expect(MoodService.getMoodLevel()).toBe(5);
    expect(MoodService.getMoodName()).toBe("Happy");

    const mockClient = DiscordWrapper.getClient();
    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      "Mood: 😃 Happy (5)",
      expect.anything(),
    );
  });

  test("increaseMoodLevel should increase the level", () => {
    MoodService.setMoodLevel(5);
    const newLevel = MoodService.increaseMoodLevel(3);
    expect(newLevel).toBe(8);
    expect(MoodService.getMoodLevel()).toBe(8);
  });

  test("increaseMoodLevel should not exceed 10", () => {
    MoodService.setMoodLevel(9);
    const newLevel = MoodService.increaseMoodLevel(5);
    expect(newLevel).toBe(10);
    expect(MoodService.getMoodLevel()).toBe(10);
  });

  test("decreaseMoodLevel should decrease the level", () => {
    MoodService.setMoodLevel(5);
    const newLevel = MoodService.decreaseMoodLevel(3);
    expect(newLevel).toBe(2);
    expect(MoodService.getMoodLevel()).toBe(2);
  });

  test("decreaseMoodLevel should not fall below -10", () => {
    MoodService.setMoodLevel(-8);
    const newLevel = MoodService.decreaseMoodLevel(5);
    expect(newLevel).toBe(-10);
    expect(MoodService.getMoodLevel()).toBe(-10);
  });

  test("generateMoodMessage should correctly alter mood based on temperature", async () => {
    DiscordUtilityService.generateMoodTemperature.mockResolvedValueOnce(5);
    MoodService.setMoodLevel(0);
    const description = await MoodService.generateMoodMessage({
      content: "test message",
    });

    // temperature 5 → [4, 5, "increase", 3] → increases mood by 3
    expect(MoodService.getMoodLevel()).toBe(3);
    expect(description).toContain(
      "The harmony of your inner world hums a quiet tune",
    );
  });
});
