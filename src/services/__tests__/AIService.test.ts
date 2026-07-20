vi.mock("../DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn().mockReturnValue("TestUser"),
  },
}));

const AIService = (await import("../AIService.ts")).default;
const _DiscordUtilityService = (
  await import("../DiscordUtilityService.ts")
).default;

describe("AIService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateTextSummaryFromMessage", () => {
    it("should call generateText and return a cropped summary", async () => {
      const generateTextSpy = vi
        .spyOn(AIService, "generateText")
        .mockResolvedValue(
          "😀 A very long string that could potentially exceed one hundred and twenty eight characters just to make sure the substring logic works correctly as expected.",
        );

      const mockMessage = { author: { username: "test" } };
      const summary = await AIService.generateTextSummaryFromMessage(
        mockMessage,
        "Test content",
      );

      expect(generateTextSpy).toHaveBeenCalledTimes(1);
      expect(summary.length).toBeLessThanOrEqual(128);
      expect(summary).toContain("😀 A very long string");

      generateTextSpy.mockRestore();
    });
  });

});
