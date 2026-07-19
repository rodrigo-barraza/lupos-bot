// ── Bot Image Context Tests ──────────────────────────────────────────────────
// Regression tests for the "bot gets confused about its own generated images"
// bug: when a user REPLIES to a Lupos message that carries a generated-image
// attachment, the model used to see only "Image description: lupos.png" and a
// [REPLYING TO] block with no hint an image existed — so it latched onto the
// only well-described images in context (participant avatars).
//
// Covers:
//   1. extractContentFromMessages captions BOT-message attachments (same
//      captionImages flow as user messages, keyed by message id).
//   2. The synthetic "YOUR MESSAGE CONTEXT" turn surfaces the vision caption
//      (and the generation prompt when the attachment carries a description).
//   3. A user reply to the bot's image message gets the caption inside its
//      [REPLYING TO] → [ATTACHED REFERENCE IMAGES] block.
//   4. extractGenerateImagePrompt recovers the generate_image prompt from
//      both tool-call shapes returned by Prism.

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("discord.js", () => {
  class MockCollection extends Map {
    filter(
      predicate: (
        value: unknown,
        key: string,
        map: Map<string, unknown>,
      ) => boolean,
    ) {
      const result = new MockCollection();
      for (const [key, value] of this) {
        if (predicate(value, key, this)) {
          result.set(key, value);
        }
      }
      return result;
    }
    find(predicate: (value: unknown, key: string) => boolean) {
      for (const [key, value] of this) {
        if (predicate(value, key)) return value;
      }
      return undefined;
    }
    some(predicate: (value: unknown, key: string) => boolean) {
      for (const [key, value] of this) {
        if (predicate(value, key)) return true;
      }
      return false;
    }
    map<T>(mapper: (value: unknown, key: string) => T) {
      const result: T[] = [];
      for (const [key, value] of this) {
        result.push(mapper(value, key));
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

// ── Internal services ────────────────────────────────────────────────────────
vi.mock("../../src/services/ScraperService", () => ({ default: {} }));
vi.mock("../../src/services/YouTubeService", () => ({ default: {} }));
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
vi.mock("../../src/services/CensorService", () => ({
  default: { removeFlaggedWords: vi.fn((text: string) => text) },
}));
vi.mock("../../src/services/DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn(
      (message: { author?: { username?: string } }) =>
        message?.author?.username?.replace(/\s/g, "") || "UnknownUser",
    ),
    getDisplayName: vi.fn().mockResolvedValue("TestUser"),
    getNameFromItem: vi.fn().mockReturnValue("TestUser"),
    getCleanUsernameFromUser: vi.fn().mockReturnValue("testuser"),
    extractAudioUrlsFromMessage: vi.fn().mockResolvedValue([]),
    // Mirror production behavior closely enough for the extractor: return
    // the URLs of image attachments on the message.
    extractImageUrlsFromMessage: vi.fn(
      async (message: {
        attachments?: Map<string, { contentType?: string; url: string }>;
      }) =>
        [...(message.attachments?.values() || [])]
          .filter((attachment) => attachment.contentType?.includes("image"))
          .map((attachment) => attachment.url),
    ),
    retrieveMessageReferenceFromMessage: vi.fn().mockResolvedValue(null),
    retrieveMemberFromGuildById: vi.fn().mockResolvedValue(null),
    getChannelById: vi.fn().mockReturnValue(null),
  },
}));
vi.mock("../../src/services/AIService", () => ({
  default: {
    generateTextDetermineHowManyMessagesToFetch: vi.fn().mockResolvedValue(20),
    // Deterministic captioner: caption is derived from the URL so tests can
    // assert exactly which image was captioned where.
    captionImages: vi.fn(async (imageUrls: Array<string | { url: string }>) => {
      const imagesMap = new Map();
      const images: string[] = [];
      for (const entry of imageUrls) {
        const url = typeof entry === "string" ? entry : entry.url;
        const caption = `caption-of(${url})`;
        images.push(caption);
        imagesMap.set(`hash-${url}`, {
          hash: `hash-${url}`,
          url,
          caption,
          fileType: "png",
          userId: null,
          model: null,
          provider: null,
          cached: false,
        });
      }
      return { images, imagesMap };
    }),
    transcribeAudioUrls: vi
      .fn()
      .mockResolvedValue({ transcriptionsMap: new Map() }),
    generateText: vi.fn().mockResolvedValue(""),
    _getTraceParams: vi.fn().mockReturnValue({}),
  },
}));

// ── Import modules under test ────────────────────────────────────────────────
const { Collection } = await import("discord.js");
const AIService = (await import("../../src/services/AIService.js")).default;
const { extractContentFromMessages } =
  await import("../../src/services/discord/ConversationExtractor.js");
const { extractGenerateImagePrompt } =
  await import("../../src/services/discord/PromptBuilder.js");

// ── Helpers ──────────────────────────────────────────────────────────────────
const BOT_USER_ID = "bot-id-999";
const BOT_IMAGE_URL = "https://cdn.example/attachments/lupos-generated.png";
let messageCounter = 0;

// Shared channel so replies can resolve referenced messages from the cache.
function createSharedChannel() {
  return {
    id: "channel-001",
    name: "general",
    messages: {
      cache: new Collection(),
      fetch: vi.fn().mockResolvedValue(null),
    },
  };
}

function createMockDiscordMessage(overrides: {
  authorId: string;
  authorUsername: string;
  content: string;
  isBot?: boolean;
  timestamp?: number;
  referenceMessageId?: string | null;
  attachments?: Array<{
    contentType: string;
    name: string;
    description?: string | null;
    title?: string | null;
    url: string;
    proxyURL?: string;
    size?: number;
    width?: number;
    height?: number;
  }>;
  channel?: ReturnType<typeof createSharedChannel>;
}) {
  const messageId = `msg-${++messageCounter}`;
  const timestamp =
    overrides.timestamp || Date.now() - (1000 - messageCounter) * 1000;

  const attachments = new Collection();
  for (const [index, attachment] of (overrides.attachments || []).entries()) {
    attachments.set(`attachment-${index}`, attachment);
  }

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
    channel: overrides.channel || createSharedChannel(),
    client: {
      user: { id: BOT_USER_ID, username: "Lupos" },
    },
    reference: overrides.referenceMessageId
      ? { messageId: overrides.referenceMessageId }
      : null,
    mentions: {
      users: new Collection(),
      members: new Collection(),
      has: () => false,
    },
    attachments,
    embeds: [],
    stickers: new Collection(),
    reactions: { cache: new Collection() },
  };
}

function buildRecentMessagesCollection(
  messages: ReturnType<typeof createMockDiscordMessage>[],
) {
  const collection = new Collection<
    string,
    ReturnType<typeof createMockDiscordMessage>
  >();
  for (const message of messages) {
    collection.set(message.id, message);
  }
  return collection;
}

// Minimal MongoClient stand-in: conversation-summary lookups always hit the
// "cache", and caption caching is exercised through the AIService mock.
function createFakeMongo() {
  return {
    db: () => ({
      collection: () => ({
        findOne: async () => ({ conversation: "cached user summary" }),
        insertOne: async () => ({}),
      }),
    }),
  } as unknown as import("mongodb").MongoClient;
}

/**
 * Standard scenario: Alice asks for an image, the bot posts one as an
 * attachment, Alice replies to the bot's image message.
 */
function buildReplyToBotImageScenario(botAttachmentDescription = "") {
  const channel = createSharedChannel();
  const userAsk = createMockDiscordMessage({
    authorId: "user-A",
    authorUsername: "Alice",
    content: "@Lupos draw a wolf howling at the moon",
    channel,
  });
  const botImageMessage = createMockDiscordMessage({
    authorId: BOT_USER_ID,
    authorUsername: "Lupos",
    content: "here you go, one majestic wolf",
    isBot: true,
    referenceMessageId: userAsk.id,
    channel,
    attachments: [
      {
        contentType: "image/png",
        name: "lupos.png",
        description: botAttachmentDescription,
        title: null,
        url: BOT_IMAGE_URL,
        proxyURL: BOT_IMAGE_URL,
        size: 2 * 1024 * 1024,
        width: 1024,
        height: 1024,
      },
    ],
  });
  const userReply = createMockDiscordMessage({
    authorId: "user-A",
    authorUsername: "Alice",
    content: "make it bigger",
    referenceMessageId: botImageMessage.id,
    channel,
  });
  // The replied-to bot message is resolvable from the channel cache.
  channel.messages.cache.set(botImageMessage.id, botImageMessage);

  const recentMessages = buildRecentMessagesCollection([
    userAsk,
    botImageMessage,
    userReply,
  ]);
  return { userAsk, botImageMessage, userReply, recentMessages };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT IMAGE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────
describe("Bot Image Context", () => {
  beforeEach(() => {
    messageCounter = 0;
    vi.clearAllMocks();
  });

  describe("extractContentFromMessages — bot attachment captioning", () => {
    it("captions bot-message image attachments into messagesImagesCollection (keyed by message id)", async () => {
      const { botImageMessage, userReply, recentMessages } =
        buildReplyToBotImageScenario();

      const { messagesImagesCollection } = await extractContentFromMessages(
        {
          message: userReply as unknown as import("discord.js").Message,
          recentMessages:
            recentMessages as unknown as import("discord.js").Collection<
              string,
              import("discord.js").Message
            >,
        },
        createFakeMongo(),
      );

      // captionImages was invoked with the bot's attachment URL
      const captionedUrlBatches = (
        AIService.captionImages as ReturnType<typeof vi.fn>
      ).mock.calls.map((call) => call[0]);
      expect(captionedUrlBatches.flat()).toContain(BOT_IMAGE_URL);

      // ...and the result landed under the BOT message's id
      const botImages = messagesImagesCollection.get(botImageMessage.id);
      expect(botImages).toBeDefined();
      expect([...botImages!.values()][0]).toMatchObject({
        url: BOT_IMAGE_URL,
        caption: `caption-of(${BOT_IMAGE_URL})`,
      });
    });

    it("surfaces the vision caption in the bot's <message-annotation> turn", async () => {
      const { botImageMessage, userReply, recentMessages } =
        buildReplyToBotImageScenario();

      const { conversation } = await extractContentFromMessages(
        {
          message: userReply as unknown as import("discord.js").Message,
          recentMessages:
            recentMessages as unknown as import("discord.js").Collection<
              string,
              import("discord.js").Message
            >,
        },
        createFakeMongo(),
      );

      const annotationTurn = conversation.find(
        (turn) =>
          turn.role === "system" &&
          typeof turn.content === "string" &&
          turn.content.includes(
            `<message-annotation for="${botImageMessage.id}">`,
          ),
      );
      expect(annotationTurn).toBeDefined();
      // The vision caption — not just the meaningless filename
      expect(annotationTurn!.content).toContain(
        `caption-of(${BOT_IMAGE_URL})</attachment>`,
      );
    });

    it("surfaces the generation prompt via attachment.description when present", async () => {
      const generationPrompt = "a majestic wolf howling at a full moon";
      const { userReply, recentMessages } =
        buildReplyToBotImageScenario(generationPrompt);

      const { conversation } = await extractContentFromMessages(
        {
          message: userReply as unknown as import("discord.js").Message,
          recentMessages:
            recentMessages as unknown as import("discord.js").Collection<
              string,
              import("discord.js").Message
            >,
        },
        createFakeMongo(),
      );

      const annotationTurn = conversation.find(
        (turn) =>
          turn.role === "system" &&
          typeof turn.content === "string" &&
          turn.content.includes("<message-annotation for="),
      );
      expect(annotationTurn).toBeDefined();
      expect(annotationTurn!.content).toContain(
        `description="${generationPrompt}"`,
      );
      // Caption still included alongside the prompt
      expect(annotationTurn!.content).toContain(
        `caption-of(${BOT_IMAGE_URL})</attachment>`,
      );
    });

    it("references the in-context bot message compactly and carries its caption via annotation", async () => {
      const { botImageMessage, userReply, recentMessages } =
        buildReplyToBotImageScenario();

      const { conversation } = await extractContentFromMessages(
        {
          message: userReply as unknown as import("discord.js").Message,
          recentMessages:
            recentMessages as unknown as import("discord.js").Collection<
              string,
              import("discord.js").Message
            >,
        },
        createFakeMongo(),
      );

      const replyTurn = conversation.find(
        (turn) =>
          turn.role === "user" &&
          typeof turn.content === "string" &&
          turn.content.includes("make it bigger"),
      );
      expect(replyTurn).toBeDefined();

      // The replied-to bot message is inside the fetched window, so the
      // reply must reference it by id (in-context) instead of re-quoting.
      expect(replyTurn!.content).toContain(
        `<replying-to id="${botImageMessage.id}"`,
      );
      expect(replyTurn!.content).toContain(`in-context="true"`);

      // The image semantics live in the bot message's annotation turn,
      // which precedes the reply in the conversation.
      const annotationIndex = conversation.findIndex(
        (turn) =>
          typeof turn.content === "string" &&
          turn.content.includes(
            `<message-annotation for="${botImageMessage.id}">`,
          ) &&
          turn.content.includes(`caption-of(${BOT_IMAGE_URL})`),
      );
      const replyIndex = conversation.indexOf(replyTurn!);
      expect(annotationIndex).toBeGreaterThanOrEqual(0);
      expect(annotationIndex).toBeLessThan(replyIndex);
    });

    it("does not regress user-message attachment captioning", async () => {
      const channel = createSharedChannel();
      const userImageUrl = "https://cdn.example/attachments/user-photo.png";
      const userImageMessage = createMockDiscordMessage({
        authorId: "user-B",
        authorUsername: "Bob",
        content: "check out my dog",
        channel,
        attachments: [
          {
            contentType: "image/png",
            name: "dog.png",
            url: userImageUrl,
          },
        ],
      });
      const trigger = createMockDiscordMessage({
        authorId: "user-A",
        authorUsername: "Alice",
        content: "@Lupos what do you think?",
        channel,
      });
      const recentMessages = buildRecentMessagesCollection([
        userImageMessage,
        trigger,
      ]);

      const { conversation, messagesImagesCollection } =
        await extractContentFromMessages(
          {
            message: trigger as unknown as import("discord.js").Message,
            recentMessages:
              recentMessages as unknown as import("discord.js").Collection<
                string,
                import("discord.js").Message
              >,
          },
          createFakeMongo(),
        );

      expect(messagesImagesCollection.get(userImageMessage.id)).toBeDefined();
      const userTurn = conversation.find(
        (turn) =>
          typeof turn.content === "string" &&
          turn.content.includes("check out my dog"),
      );
      expect(userTurn).toBeDefined();
      expect(userTurn!.content).toContain(`caption-of(${userImageUrl})`);
      expect(userTurn!.images).toEqual([userImageUrl]);
    });
  });

  describe("extractGenerateImagePrompt — tool-call prompt recovery", () => {
    it("extracts the prompt from Prism /agent shape ({ name, args })", () => {
      expect(
        extractGenerateImagePrompt([
          { name: "search_web", args: { query: "wolves" } },
          {
            name: "generate_image",
            args: { prompt: "  a majestic wolf howling  " },
          },
        ]),
      ).toBe("a majestic wolf howling");
    });

    it("extracts the prompt from OpenAI shape ({ function: { name, arguments } })", () => {
      expect(
        extractGenerateImagePrompt([
          {
            id: "call-1",
            type: "function",
            function: {
              name: "generate_image",
              arguments: JSON.stringify({
                prompt: "wolf in renaissance style",
              }),
            },
          },
        ]),
      ).toBe("wolf in renaissance style");
    });

    it("returns null when there is no generate_image call, no prompt, or malformed args", () => {
      expect(extractGenerateImagePrompt(undefined)).toBeNull();
      expect(extractGenerateImagePrompt([])).toBeNull();
      expect(
        extractGenerateImagePrompt([{ name: "search_web", args: {} }]),
      ).toBeNull();
      expect(
        extractGenerateImagePrompt([{ name: "generate_image", args: {} }]),
      ).toBeNull();
      expect(
        extractGenerateImagePrompt([
          { name: "generate_image", args: { prompt: "   " } },
        ]),
      ).toBeNull();
      expect(
        extractGenerateImagePrompt([
          {
            function: { name: "generate_image", arguments: "{not json" },
          },
        ]),
      ).toBeNull();
    });
  });
});
