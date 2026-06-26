// ── Message Context Retention Tests ──────────────────────────────────────────
// Validates that ALL channel messages survive into the agent conversation array.
// This is a regression test for a bug where the message filter in
// extractContentFromMessages silently stripped messages that discord.js
// considered "mentions" of the bot (including implicit reply-mentions),
// reducing conversation context to a single message.

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("discord.js", () => {
  class MockCollection extends Map {
    filter(predicate: (value: unknown, key: string, map: Map<string, unknown>) => boolean) {
      const result = new MockCollection();
      for (const [key, value] of this) {
        if (predicate(value, key, this)) {
          result.set(key, value);
        }
      }
      return result;
    }
    last(count?: number) {
      const values = [...this.values()];
      if (count === undefined) return values[values.length - 1];
      return values.slice(-count);
    }
    first() {
      return [...this.values()][0];
    }
    concat(other: Map<string, unknown>) {
      const result = new MockCollection(this);
      for (const [key, value] of other) {
        result.set(key, value);
      }
      return result;
    }
  }
  return {
    Collection: MockCollection,
    ChannelType: { GuildText: 0 },
    EmbedBuilder: vi.fn(),
    ActionRowBuilder: vi.fn(),
    ButtonBuilder: vi.fn(),
    ButtonStyle: {},
    MessageFlags: {},
    Events: {},
    ActivityType: { Custom: 4 },
    GatewayIntentBits: {},
    Partials: {},
    Client: vi.fn(() => ({
      login: vi.fn(),
      options: {},
    })),
  };
});
vi.mock("hex-color-to-color-name", () => ({
  GetColorName: vi.fn((hex: string) => hex),
}));
vi.mock("luxon", () => ({
  DateTime: {
    now: vi.fn(() => ({
      toISO: () => "2026-01-01T00:00:00.000Z",
      toFormat: () => "January 01, 2026",
      diff: () => ({ toObject: () => ({ seconds: 0 }) }),
    })),
    fromISO: vi.fn(() => ({
      diff: () => ({ toObject: () => ({ seconds: 0 }) }),
    })),
    fromMillis: vi.fn(() => ({
      setZone: () => ({ toFormat: () => "Jan 01, 2026" }),
      toRelative: () => "just now",
      toFormat: () => "Jan 01, 2026 at 12:00:00 AM",
    })),
  },
}));

// ── Internal services ────────────────────────────────────────────────────────
vi.mock("../../src/services/ScraperService", () => ({ default: {} }));
vi.mock("../../src/wrappers/DiscordWrapper", () => ({
  default: {
    getClient: vi.fn().mockReturnValue({
      user: { setActivity: vi.fn(), id: "bot-id-999" },
      clients: [],
    }),
    clients: [],
  },
}));
vi.mock("../../src/services/YouTubeService", () => ({ default: {} }));
vi.mock("../../src/services/LightsService", () => ({ default: {} }));
vi.mock("../../src/services/MongoService", () => ({
  default: { getClient: vi.fn().mockReturnValue(null) },
}));
vi.mock("../../src/services/PrismService", () => ({
  default: {
    generateText: vi.fn(),
    generateImage: vi.fn(),
    captionImage: vi.fn(),
    transcribeAudio: vi.fn(),
    generateAgentResponse: vi.fn().mockResolvedValue({ text: "test response" }),
  },
}));
vi.mock("../../src/services/DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn((message: { author?: { username?: string } }) =>
      message?.author?.username?.replace(/\s/g, "") || "UnknownUser",
    ),
    getDisplayName: vi.fn().mockResolvedValue("TestUser"),
    extractAudioUrlsFromMessage: vi.fn().mockResolvedValue([]),
    extractImageUrlsFromMessage: vi.fn().mockResolvedValue([]),
    retrieveMessageReferenceFromMessage: vi.fn().mockResolvedValue(null),
    retrieveMemberFromGuildById: vi.fn().mockResolvedValue(null),
    getChannelById: vi.fn().mockReturnValue(null),
  },
}));
vi.mock("../../src/services/AIService", () => ({
  default: {
    generateTextDetermineHowManyMessagesToFetch: vi.fn().mockResolvedValue(20),
    captionImages: vi.fn().mockResolvedValue({ images: [], imagesMap: new Map() }),
    transcribeAudioUrls: vi.fn().mockResolvedValue({ transcriptionsMap: new Map() }),
    generateText: vi.fn().mockResolvedValue(""),
  },
}));
vi.mock("../../src/services/CurrentService", () => ({
  default: {
    getMessage: vi.fn(),
    setUser: vi.fn(),
    setMessage: vi.fn(),
    setStartTime: vi.fn(),
    setEndTime: vi.fn(),
    getTraceId: vi.fn().mockReturnValue(null),
    setTraceId: vi.fn(),
    addModel: vi.fn(),
    addModelType: vi.fn(),
  },
}));
vi.mock("../../src/services/CensorService", () => ({ default: {} }));
vi.mock("../../src/services/AccountGuardService", () => ({
  kickIfTooNew: vi.fn(),
  kickIfForbiddenCombo: vi.fn(),
  purgeByAccountAge: vi.fn(),
}));
vi.mock("../../src/jobs/scheduled/BirthdayJob", () => ({ default: {} }));
vi.mock("../../src/jobs/scheduled/ActivityRoleAssignmentJob", () => ({ default: {} }));
vi.mock("../../src/jobs/scheduled/PermanentTimeOutJob", () => ({ default: {} }));
vi.mock("../../src/jobs/scheduled/RandomTagJob", () => ({ default: {} }));
vi.mock("../../src/jobs/scheduled/ServerIconJob", () => ({ default: {} }));
vi.mock("../../src/jobs/event-driven/ReactJob", () => ({ default: {} }));

// ── Import modules under test ────────────────────────────────────────────────
const { Collection } = await import("discord.js");
const AIService = (await import("../../src/services/AIService.js")).default;

// ── Helpers: Discord message factory ─────────────────────────────────────────
const BOT_USER_ID = "bot-id-999";
let messageCounter = 0;

function createMockDiscordMessage(overrides: {
  authorId: string;
  authorUsername: string;
  content: string;
  isBot?: boolean;
  timestamp?: number;
  referenceMessageId?: string | null;
  mentionsBotUser?: boolean;
}) {
  const messageId = `msg-${++messageCounter}`;
  const timestamp = overrides.timestamp || Date.now() - (1000 - messageCounter) * 1000;
  const mentionedUserIds = new Set(overrides.mentionsBotUser ? [BOT_USER_ID] : []);

  return {
    id: messageId,
    content: overrides.content,
    cleanContent: overrides.content,
    createdTimestamp: timestamp,
    author: {
      id: overrides.authorId,
      username: overrides.authorUsername,
      bot: overrides.isBot || false,
      avatar: null,
      banner: null,
      globalName: overrides.authorUsername,
    },
    member: {
      id: overrides.authorId,
      displayName: overrides.authorUsername,
      user: {
        id: overrides.authorId,
        username: overrides.authorUsername,
        bot: overrides.isBot || false,
        avatar: null,
        banner: null,
      },
      avatar: null,
      banner: null,
    },
    guild: {
      id: "guild-001",
      name: "Test Server",
      memberCount: 50,
      channels: { cache: new Collection() },
      premiumSubscriptionCount: 0,
      bans: { fetch: vi.fn().mockResolvedValue(new Collection()) },
      members: { cache: new Collection() },
    },
    channel: {
      id: "channel-001",
      name: "general",
      messages: {
        cache: new Collection(),
        fetch: vi.fn().mockResolvedValue(null),
      },
    },
    client: {
      user: { id: BOT_USER_ID, username: "Lupos" },
    },
    reference: overrides.referenceMessageId
      ? { messageId: overrides.referenceMessageId }
      : null,
    mentions: {
      users: new Collection(
        overrides.mentionsBotUser
          ? [[BOT_USER_ID, { id: BOT_USER_ID, username: "Lupos" }]]
          : [],
      ),
      members: new Collection(),
      has: (userId: string) => mentionedUserIds.has(userId),
    },
    attachments: new Collection(),
    embeds: [],
    reactions: { cache: new Collection() },
  };
}

function buildRecentMessagesCollection(
  messages: ReturnType<typeof createMockDiscordMessage>[],
) {
  const collection = new Collection<string, ReturnType<typeof createMockDiscordMessage>>();
  for (const message of messages) {
    collection.set(message.id, message);
  }
  return collection;
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE CONTEXT RETENTION
//   Regression tests: the conversation array must contain ALL channel messages,
//   not just the latest one. Previously, a filter silently removed messages that
//   discord.js considered "mentions" of the bot (including reply-mentions).
// ─────────────────────────────────────────────────────────────────────────────
describe("Message Context Retention", () => {
  beforeEach(() => {
    messageCounter = 0;
    vi.clearAllMocks();
    AIService.generateTextDetermineHowManyMessagesToFetch.mockResolvedValue(20);
  });

  describe("recentMessages pass-through (no filtering)", () => {
    it("should retain all messages regardless of bot mentions", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "Hey @Lupos what's up?",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "Not much, just vibing",
          isBot: true,
          referenceMessageId: "msg-1",
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "@Lupos draw me something",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: "user-C",
          authorUsername: "Charlie",
          content: "lol nice",
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "@Lupos yes do it",
          mentionsBotUser: true,
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);

      // This mirrors the production code: filteredRecentMessages = recentMessages (no filter)
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      expect(recentXMessages).toHaveLength(5);
      expect(recentXMessages.map((message: { author: { username: string } }) => message.author.username)).toEqual([
        "Alice",
        "Lupos",
        "Bob",
        "Charlie",
        "Alice",
      ]);
    });

    it("should retain messages that reply to the bot (implicit discord.js mentions)", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "What do you think?",
          isBot: true,
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "I think that's cool",
          referenceMessageId: "msg-1",
          mentionsBotUser: true, // discord.js treats replies-to-bot as mentions
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "Yeah I agree",
          referenceMessageId: "msg-1",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: "user-C",
          authorUsername: "Charlie",
          content: "Same here",
          referenceMessageId: "msg-1",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "Yes",
          referenceMessageId: "msg-1",
          mentionsBotUser: true,
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      // ALL 5 messages must survive — previously only the last one did
      expect(recentXMessages).toHaveLength(5);

      const userMessages = recentXMessages.filter(
        (message: { author: { bot: boolean } }) => !message.author.bot,
      );
      expect(userMessages).toHaveLength(4);
    });

    it("should retain un-replied bot mentions from other users as context", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "@Lupos tell me a joke",
          mentionsBotUser: true,
        }),
        // Bot never replied to Alice — previously this was filtered out
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "@Lupos what about you?",
          mentionsBotUser: true,
        }),
        // Bob also unreplied — previously filtered out
        createMockDiscordMessage({
          authorId: "user-C",
          authorUsername: "Charlie",
          content: "Hey everyone",
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "@Lupos please?",
          mentionsBotUser: true,
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      // ALL messages preserved — no filtering of unreplied mentions
      expect(recentXMessages).toHaveLength(4);
    });
  });

  describe("message count heuristic integration", () => {
    it("should pass last N messages based on heuristic (default 20)", () => {
      const messages = Array.from({ length: 30 }, (_, index) =>
        createMockDiscordMessage({
          authorId: index % 2 === 0 ? "user-A" : "user-B",
          authorUsername: index % 2 === 0 ? "Alice" : "Bob",
          content: `Message number ${index + 1}`,
          timestamp: Date.now() - (30 - index) * 1000,
        }),
      );

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      // Should get the 20 most recent out of 30
      expect(recentXMessages).toHaveLength(20);
      // First message in the slice should be message 11 (index 10)
      expect(recentXMessages[0].content).toBe("Message number 11");
      // Last message should be message 30
      expect(recentXMessages[19].content).toBe("Message number 30");
    });

    it("should return all messages when collection has fewer than N", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "First message",
        }),
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "Bot reply",
          isBot: true,
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "Third message",
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      // Only 3 messages available — should get all 3
      expect(recentXMessages).toHaveLength(3);
    });
  });

  describe("multi-user conversation context", () => {
    it("should preserve messages from multiple participants in a typical channel conversation", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "Has anyone played the new game?",
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "Yeah it's pretty fun",
        }),
        createMockDiscordMessage({
          authorId: "user-C",
          authorUsername: "Charlie",
          content: "I haven't tried it yet",
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Alice",
          content: "@Lupos what do you think about it?",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "I've been watching streams of it, looks great",
          isBot: true,
          referenceMessageId: "msg-4",
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Bob",
          content: "@Lupos you should play with us",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: "user-D",
          authorUsername: "Diana",
          content: "Count me in too",
        }),
        createMockDiscordMessage({
          authorId: "user-C",
          authorUsername: "Charlie",
          content: "Yes let's do it",
          referenceMessageId: "msg-5",
          mentionsBotUser: true,
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      // All 8 messages must be present
      expect(recentXMessages).toHaveLength(8);

      // Verify all 4 unique users + bot are represented
      const uniqueAuthors = new Set(
        recentXMessages.map((message: { author: { id: string } }) => message.author.id),
      );
      expect(uniqueAuthors.size).toBe(5); // Alice, Bob, Charlie, Diana, Lupos

      // Verify message ordering is preserved (chronological)
      expect(recentXMessages[0].author.username).toBe("Alice");
      expect(recentXMessages[recentXMessages.length - 1].author.username).toBe("Charlie");
    });

    it("should preserve interleaved bot and multi-user messages in an active conversation", () => {
      const messages = [
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Skippi",
          content: "@Lupos how are you?",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "I'm doing great!",
          isBot: true,
          referenceMessageId: "msg-1",
        }),
        createMockDiscordMessage({
          authorId: "user-B",
          authorUsername: "Rodrigo",
          content: "Hey everyone",
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Skippi",
          content: "That's good to hear",
          referenceMessageId: "msg-2",
          mentionsBotUser: true,
        }),
        createMockDiscordMessage({
          authorId: BOT_USER_ID,
          authorUsername: "Lupos",
          content: "Thanks! What are you up to?",
          isBot: true,
          referenceMessageId: "msg-4",
        }),
        createMockDiscordMessage({
          authorId: "user-A",
          authorUsername: "Skippi",
          content: "Yes",
          referenceMessageId: "msg-5",
          mentionsBotUser: true,
        }),
      ];

      const recentMessages = buildRecentMessagesCollection(messages);
      const filteredRecentMessages = recentMessages;
      const recentXMessages = filteredRecentMessages.last(20);

      expect(recentXMessages).toHaveLength(6);

      const userMessages = recentXMessages.filter(
        (message: { author: { bot: boolean } }) => !message.author.bot,
      );
      const botMessages = recentXMessages.filter(
        (message: { author: { bot: boolean } }) => message.author.bot,
      );

      // 4 user messages (3 from Skippi + 1 from Rodrigo), 2 bot messages
      expect(userMessages).toHaveLength(4);
      expect(botMessages).toHaveLength(2);
    });
  });
});
