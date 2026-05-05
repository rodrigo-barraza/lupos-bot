// ── Mocks ────────────────────────────────────────────────────────────────────
// Mock heavyweight dependencies that AIService transitively depends on
vi.mock("../../services/MongoService", () => ({
  default: {
    getClient: vi.fn().mockReturnValue(null),
  },
}));
vi.mock("../../services/CurrentService", () => ({
  default: {
    getMessage: vi.fn().mockReturnValue({
      author: { username: "test_runner", id: "000" },
      guild: { name: "TestGuild", id: "111" },
      channel: { name: "test-channel", id: "222" },
    }),
    getTraceId: vi.fn().mockReturnValue(null),
    setTraceId: vi.fn(),
    setUser: vi.fn(),
    setMessage: vi.fn(),
    setStartTime: vi.fn(),
    setEndTime: vi.fn(),
    addModel: vi.fn(),
    addModelType: vi.fn(),
  },
}));
vi.mock("../../services/DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn().mockReturnValue("TestUser"),
    getDisplayName: vi.fn().mockResolvedValue("TestUser"),
  },
}));
vi.mock("../../services/PrismService", () => ({
  default: {
    generateText: vi.fn(),
    generateImage: vi.fn(),
    captionImage: vi.fn(),
    transcribeAudio: vi.fn(),
  },
}));

// ── Import AIService (after mocks are set up) ───────────────────────────────
const AIService = (await import("../../services/AIService.js")).default;

// ── Helpers ──────────────────────────────────────────────────────────────────
const mockMessage = {
  author: { username: "test_user", id: "12345" },
  guild: { name: "TestGuild", id: "111" },
  channel: { name: "test-channel", id: "222" },
  cleanContent: "",
  content: "",
};

const sampleMessageCountText = `As of Friday, March 13, 2026, I have analyzed the recent message activity.`;

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE FETCH COUNT DETERMINATION
//   Tests for generateTextDetermineHowManyMessagesToFetch
//   (rule-based, no AI calls needed)
// ─────────────────────────────────────────────────────────────────────────────
describe("Message Fetch Count Determination", () => {
  it("standalone image request should return 5 (fast-path)", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Draw me a picture of a dragon",
        mockMessage,
        sampleMessageCountText,
      );
    expect(result).toBe(5);
  });

  it("simple question should return 20 (default)", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Hey what's up?",
        mockMessage,
        sampleMessageCountText,
      );
    expect(result).toBe(20);
  });

  it("conversation context request should return 75", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Can you summarize what we've been talking about?",
        mockMessage,
        sampleMessageCountText,
      );
    expect(result).toBe(75);
  });

  it("full conversation summary with 'everything' keyword should return 100", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Summarize everything we've discussed today",
        mockMessage,
        sampleMessageCountText,
      );
    // "everything" matches the MAXIMAL tier before "summarize" matches LARGE
    expect(result).toBe(100);
  });

  it("everything-request should return 100", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Tell me everything we discussed",
        mockMessage,
        sampleMessageCountText,
      );
    expect(result).toBe(100);
  });

  it("should always return a valid number between 5 and 100", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Tell me a joke about wolves",
        mockMessage,
        sampleMessageCountText,
      );
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAST-PATH FETCH COUNT FOR STANDALONE IMAGE REQUESTS
//   Tests for the rule-based pre-filter in message fetch count
// ─────────────────────────────────────────────────────────────────────────────
describe("Fast-Path Fetch Count (Rule-Based)", () => {
  let originalGenerateText;

  beforeAll(() => {
    originalGenerateText = AIService.generateText;
  });

  afterAll(() => {
    AIService.generateText = originalGenerateText;
  });

  it("standalone 'draw X' request should return 5 without calling AI", async () => {
    const spy = vi.spyOn(AIService, "generateText").mockResolvedValue("50");

    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "<@123456789> draw a cat wearing a hat",
        mockMessage,
        "some message count text",
      );

    expect(result).toBe(5);
    // The AI should NOT have been called since the fast-path intercepted
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("draw request WITH conversation reference should NOT hit fast-path", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "<@123456789> draw what we talked about earlier",
        mockMessage,
        "some message count text",
      );

    // "what we talked about" matches LARGE tier (75) before generic refersToConversation (50)
    expect(result).toBe(75);
  });

  it("non-image request with time reference should return LARGE tier", async () => {
    const result =
      await AIService.generateTextDetermineHowManyMessagesToFetch(
        "Hey what's going on today?",
        mockMessage,
        "some message count text",
      );

    // "going on" triggers refersToConversation AND "today" matches LARGE tier
    expect(result).toBe(75);
  });
});
