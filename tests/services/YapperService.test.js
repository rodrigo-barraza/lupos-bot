// Mock all transitive dependencies that pull in heavy native modules
vi.mock("../../services/DiscordService", () => ({
  default: {},
}));
vi.mock("../../services/AIService", () => ({
  default: {
    generateText: vi.fn().mockResolvedValue("Mocked AI response"),
  },
}));
vi.mock("../../services/MoodService", () => ({
  default: {
    decreaseMoodLevel: vi.fn(),
  },
}));
vi.mock("../../services/HungerService", () => ({
  default: {},
}));
vi.mock("../../services/ThirstService", () => ({
  default: {},
}));
vi.mock("../../services/BathroomService", () => ({
  default: {},
}));
vi.mock("../../services/SicknessService", () => ({
  default: {},
}));
vi.mock("../../services/AlcoholService", () => ({
  default: {},
}));

const YapperService = (await import("../../services/YapperService.js")).default;
const AIService = (await import("../../services/AIService.js")).default;
const MoodService = (await import("../../services/MoodService.js")).default;

describe("YapperService", () => {
  beforeEach(() => {
    YapperService.setYappers([]);
    vi.clearAllMocks();
  });

  test("should handle setting and getting yappers", () => {
    const mockYappers = [
      { displayName: "User1", count: 50 },
      { displayName: "User2", count: 30 },
    ];

    YapperService.setYappers(mockYappers);
    expect(YapperService.getYappers()).toEqual(mockYappers);
  });

  test("yapperMessage should decrease mood and call AIService.generateText", async () => {
    const mockYappers = [
      { displayName: "User1", count: 50 },
      { displayName: "User2", count: 30 },
    ];
    YapperService.setYappers(mockYappers);

    const mockInteraction = { user: { id: "123" } };

    const response = await YapperService.yapperMessage(mockInteraction);

    expect(MoodService.decreaseMoodLevel).toHaveBeenCalledTimes(1);
    expect(AIService.generateText).toHaveBeenCalledTimes(1);

    // Verify the conversation structure passed to generateText
    const callArgs = AIService.generateText.mock.calls[0][0];
    expect(callArgs).toHaveProperty("conversation");
    expect(callArgs).toHaveProperty("modelPerformance", "POWERFUL");

    // Verify system message content includes yapper data
    const systemMessage = callArgs.conversation.find(
      (m) => m.role === "system",
    );
    expect(systemMessage.content).toContain("User1 with 50 recent yaps");
    expect(systemMessage.content).toContain("User2 with 30 recent yaps");

    // Verify user message asks about top yappers
    const userMessage = callArgs.conversation.find((m) => m.role === "user");
    expect(userMessage.content).toContain("top 5 yappers");

    expect(response).toBe("Mocked AI response");
  });
});
