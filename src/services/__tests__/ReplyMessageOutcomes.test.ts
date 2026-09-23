// What replyMessage does with a generated turn, driven through the real
// queue drain (processMessage → acceptAndQueueReply → replyMessage) with
// the history extraction and prompt building mocked out:
//   - an ambient turn that passed posts nothing and stops typing;
//   - an ambient turn that waited too long in the queue is dropped;
//   - memory extraction sends participant objects, public channels only.

vi.mock("discord.js", () => ({
  Collection: class extends Map {},
  ChannelType: { GuildText: 0, DM: 1 },
  MessageType: { Default: 0, Reply: 19 },
  EmbedBuilder: vi.fn(),
  ActionRowBuilder: vi.fn(),
  ButtonBuilder: vi.fn(),
  ButtonStyle: {},
  MessageFlags: {},
  Events: {},
  ActivityType: { Custom: 4 },
  GatewayIntentBits: {},
  Partials: {},
  Client: vi.fn(() => ({ login: vi.fn(), options: {} })),
}));
vi.mock("hex-color-to-color-name", () => ({
  GetColorName: vi.fn((hex) => hex),
}));
vi.mock("../ScraperService", () => ({ default: {} }));
vi.mock("../../wrappers/DiscordWrapper", () => ({
  default: { getClient: vi.fn(), clients: [] },
}));
vi.mock("../YouTubeService", () => ({ default: {} }));
vi.mock("../LightsService", () => ({ default: {} }));
vi.mock("../MongoService", () => ({
  default: { getClient: vi.fn().mockReturnValue(null) },
}));
vi.mock("../PrismService", () => ({
  default: {
    generateText: vi.fn(),
    extractMemories: vi.fn().mockResolvedValue({ count: 0 }),
    getSomaticSnapshot: vi.fn().mockResolvedValue(null),
    postAgentInput: vi.fn(),
  },
  conversationIdOf: (event: { conversationId?: unknown }) =>
    typeof event.conversationId === "string" ? event.conversationId : null,
}));
vi.mock("../DiscordUtilityService", () => ({
  default: {
    fetchMessages: vi.fn().mockResolvedValue({ reverse: () => new Map() }),
    startTypingInterval: vi.fn().mockResolvedValue("typing-timer"),
    clearTypingInterval: vi.fn(),
    addRoleToMember: vi.fn(),
    removeRoleFromMember: vi.fn(),
    setUserActivity: vi.fn(),
    sendMessageInChunks: vi.fn().mockResolvedValue({ sentMessages: [] }),
    getUsernameNoSpaces: vi.fn(() => "alice"),
  },
}));
vi.mock("../AIService", () => ({
  default: {
    generateTextDetermineHowManyMessagesToFetch: vi.fn().mockResolvedValue(20),
  },
}));
vi.mock("../CurrentService", () => ({
  default: {
    setUser: vi.fn(),
    setMessage: vi.fn(),
    setStartTime: vi.fn(),
    setEndTime: vi.fn(),
    clearTraceId: vi.fn(),
    getTraceId: vi.fn().mockReturnValue(null),
    getModels: vi.fn().mockReturnValue([]),
    getModelTypes: vi.fn().mockReturnValue([]),
    clearModels: vi.fn(),
    clearModelTypes: vi.fn(),
  },
}));
vi.mock("../CensorService", () => ({
  default: { containsFlaggedWords: vi.fn(() => false) },
}));
vi.mock("../AccountGuardService", () => ({
  kickIfTooNew: vi.fn(),
  kickIfForbiddenCombo: vi.fn(),
  purgeByAccountAge: vi.fn(),
}));
vi.mock("../BotSettingsService", () => ({
  default: {
    get: vi.fn((key: string) => botSettings[key] ?? []),
    initialize: vi.fn(),
  },
}));
vi.mock("../../formatters/LogFormatter", () => ({
  default: new Proxy({}, { get: () => () => [] }),
}));
vi.mock("../discord/ConversationExtractor", () => ({
  extractContentFromMessages: vi.fn(),
  displayNameOf: vi.fn(),
  prefetchMessageCaptions: vi.fn(),
}));
vi.mock("../discord/PromptBuilder", () => ({
  buildAndGenerateReply: vi.fn(),
  prefetchTriggerReferenceCaptions: vi.fn(),
  prefetchRepliedImageCaption: vi.fn(),
}));
vi.mock("../../jobs/scheduled/BirthdayJob", () => ({ default: {} }));
vi.mock("../../jobs/scheduled/ActivityRoleAssignmentJob", () => ({
  default: {},
}));
vi.mock("../../jobs/scheduled/PermanentTimeOutJob", () => ({ default: {} }));
vi.mock("../../jobs/scheduled/RandomTagJob", () => ({ default: {} }));
vi.mock("../../jobs/scheduled/ServerIconJob", () => ({ default: {} }));
vi.mock("../../jobs/event-driven/ReactJob", () => ({ default: {} }));

const botSettings: Record<string, string[]> = {};

const { processMessage } = await import("../DiscordService.ts");
const DiscordState = (await import("../discord/DiscordState.ts")).default;
const DiscordUtilityService = (await import("../DiscordUtilityService.ts"))
  .default;
const PrismService = (await import("../PrismService.ts")).default;
const { extractContentFromMessages } = await import(
  "../discord/ConversationExtractor.ts"
);
const { buildAndGenerateReply } = await import("../discord/PromptBuilder.ts");
const { agentTurnRateLimiter } = await import(
  "../discord/AgentTurnRateLimiter.ts"
);
const { AMBIENT_LIMITS, resetAmbientState } = await import(
  "../discord/AmbientInterjection.ts"
);
const config = (await import("#root/config.ts")).default;
const { resetTurnSteering } = await import("../discord/TurnSteering.ts");

const BOT_ID = "900000000000000001";
const AUTHOR_ID = "800000000000000001";
const CHANNEL_ID = "600000000000000001";
const client = { user: { id: BOT_ID, username: "Lupos" } } as never;
const insertOne = vi.fn();
const mongoClients = {
  mongo: {} as never,
  localMongo: { db: () => ({ collection: () => ({ insertOne }) }) } as never,
};

let nextMessageId = 5000;

function fakeMessage({
  everyoneCanView = true,
  createdTimestamp = Date.now(),
  content = "lupos, settle this for us",
}: {
  everyoneCanView?: boolean;
  createdTimestamp?: number;
  content?: string;
} = {}) {
  const everyone = { id: "everyone" };
  const message = {
    id: String(nextMessageId++),
    content,
    cleanContent: content,
    type: 0,
    guildId: "700000000000000001",
    channelId: CHANNEL_ID,
    createdAt: new Date(createdTimestamp),
    createdTimestamp,
    author: { id: AUTHOR_ID, username: "alice", bot: false },
    member: { roles: { cache: { some: () => false } } },
    guild: { id: "700000000000000001", name: "Guild", roles: { everyone } },
    client,
    channel: {
      id: CHANNEL_ID,
      type: 0,
      name: "general-chat",
      guild: { roles: { everyone } },
      isDMBased: () => false,
      isThread: () => false,
      permissionsFor: (role: unknown) => ({
        has: (permission: string) =>
          role === everyone && permission === "ViewChannel" && everyoneCanView,
      }),
      messages: { cache: new Map(), fetch: vi.fn(async () => new Map()) },
    },
    mentions: { has: vi.fn(() => false), repliedUser: null },
    reference: null,
    attachments: new Map(),
    stickers: new Map(),
    react: vi.fn(),
    reply: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
  };
  return message;
}

function extractedConversation() {
  const alice = { id: AUTHOR_ID, username: "alice", globalName: "Alice" };
  return {
    conversation: [{ role: "user", content: "<discord-message …>" }],
    newSystemPrompt: "",
    memberMentionsCollection: new Map(),
    messagesEmojisCollection: new Map(),
    messagesImagesCollection: new Map(),
    messagesTranscriptionsCollection: new Map(),
    participantsAvatarsCollection: new Map(),
    participantsCollection: new Map([
      [AUTHOR_ID, { user: alice, member: { displayName: "Queen Alice" } }],
    ]),
    participantsMembersCollection: new Map(),
    participantsUsersCollection: new Map(),
    representedMessageIds: [],
    userMentionsCollection: new Map(),
  };
}

function generated(overrides: Record<string, unknown> = {}) {
  return {
    generatedText: "the answer is 42",
    image: null,
    audioRef: null,
    videoUrl: null,
    imageUrl: null,
    imagePrompt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  agentTurnRateLimiter.reset();
  DiscordState.queuedData.length = 0;
  DiscordState.isProcessingQueue = false;
  vi.mocked(extractContentFromMessages).mockResolvedValue(
    extractedConversation() as never,
  );
  vi.mocked(buildAndGenerateReply).mockReset();
  vi.mocked(PrismService.extractMemories).mockClear();
  vi.mocked(DiscordUtilityService.sendMessageInChunks).mockClear();
  vi.mocked(DiscordUtilityService.clearTypingInterval).mockClear();
  insertOne.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replyMessage — ambient outcomes", () => {
  afterEach(() => {
    delete botSettings.CHANNEL_IDS_AMBIENT;
    delete DiscordState.typingIntervals[CHANNEL_ID];
  });

  it("a [[pass]] posts nothing, stops typing and extracts no memories", async () => {
    resetAmbientState();
    botSettings.CHANNEL_IDS_AMBIENT = [CHANNEL_ID];
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: '{"interject": true, "score": 0.9}',
    } as never);
    vi.mocked(buildAndGenerateReply).mockResolvedValue(
      generated({ generatedText: null, passed: true }) as never,
    );
    const message = fakeMessage({
      content: "does anyone know when the raid starts tonight",
    });
    await processMessage(client, mongoClients, message as never, "CREATE");

    expect(buildAndGenerateReply).toHaveBeenCalledOnce();
    expect(vi.mocked(buildAndGenerateReply).mock.calls[0][0]).toMatchObject({
      replyMode: "ambient",
    });
    expect(message.reply).not.toHaveBeenCalled();
    expect(DiscordUtilityService.sendMessageInChunks).not.toHaveBeenCalled();
    expect(PrismService.extractMemories).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(DiscordUtilityService.clearTypingInterval).toHaveBeenCalledWith(
      "typing-timer",
    );
    expect(DiscordState.typingIntervals[CHANNEL_ID]).toBeUndefined();
  });

  it("an ambient turn that came back empty posts nothing — no \"...\"", async () => {
    resetAmbientState();
    botSettings.CHANNEL_IDS_AMBIENT = [CHANNEL_ID];
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: '{"interject": true, "score": 0.9}',
    } as never);
    vi.mocked(buildAndGenerateReply).mockResolvedValue(
      generated({ generatedText: null }) as never,
    );
    const message = fakeMessage({
      content: "does anyone know when the raid starts tonight",
    });
    await processMessage(client, mongoClients, message as never, "CREATE");
    expect(buildAndGenerateReply).toHaveBeenCalledOnce();
    expect(message.reply).not.toHaveBeenCalled();
    expect(DiscordUtilityService.sendMessageInChunks).not.toHaveBeenCalled();
    expect(DiscordState.typingIntervals[CHANNEL_ID]).toBeUndefined();
  });

  it("an addressed turn that came back empty still gets the \"...\" fallback", async () => {
    vi.mocked(buildAndGenerateReply).mockResolvedValue(
      generated({ generatedText: null }) as never,
    );
    const message = fakeMessage();
    await processMessage(client, mongoClients, message as never, "CREATE");
    expect(message.reply).toHaveBeenCalledWith("...");
  });

  it("drops an ambient turn that waited in the queue past its moment", async () => {
    const stale = fakeMessage({
      createdTimestamp: Date.now() - AMBIENT_LIMITS.maxQueueDelayMs - 1000,
    });
    DiscordState.queuedData.push({
      message: stale as never,
      recentMessages: new Map([[stale.id, stale]]) as never,
      actionType: "CREATE",
      replyMode: "ambient",
    });
    const trigger = fakeMessage();
    vi.mocked(buildAndGenerateReply).mockResolvedValue(generated() as never);
    await processMessage(client, mongoClients, trigger as never, "CREATE");
    expect(buildAndGenerateReply).toHaveBeenCalledOnce();
    expect(vi.mocked(buildAndGenerateReply).mock.calls[0][0]).toMatchObject({
      replyMode: "name",
    });
  });
});

describe("replyMessage — memory extraction", () => {
  it("sends participant objects from a public channel", async () => {
    vi.mocked(buildAndGenerateReply).mockResolvedValue(generated() as never);
    await processMessage(client, mongoClients, fakeMessage() as never, "CREATE");
    expect(PrismService.extractMemories).toHaveBeenCalledOnce();
    expect(vi.mocked(PrismService.extractMemories).mock.calls[0][0]).toMatchObject({
      channelId: CHANNEL_ID,
      participants: [{ id: AUTHOR_ID, username: "alice", displayName: "Queen Alice" }],
    });
  });

  it("extracts nothing from a channel @everyone can't see", async () => {
    vi.mocked(buildAndGenerateReply).mockResolvedValue(generated() as never);
    await processMessage(
      client,
      mongoClients,
      fakeMessage({ everyoneCanView: false }) as never,
      "CREATE",
    );
    expect(DiscordUtilityService.sendMessageInChunks).toHaveBeenCalledOnce();
    expect(PrismService.extractMemories).not.toHaveBeenCalled();
  });
});

// A follow-up folded into a running turn (TurnSteering) is answered by
// that turn's reply — or, when the turn did not act on it, queued as its
// own turn once the first one is over.
describe("replyMessage — follow-ups folded into the turn", () => {
  type Steering = import("../discord/TurnSteering.ts").SteerableTurn;

  /**
   * buildAndGenerateReply stand-in for the trigger's turn: the stream
   * names the conversation, the follow-up arrives and folds, Prism
   * acknowledges it at `boundary`, then the turn ends as `outcome` says.
   */
  function turnThatFolds(
    followUp: ReturnType<typeof fakeMessage>,
    boundary: string | null,
    outcome: "replied" | "failed" | "abandoned" = "replied",
    trigger?: ReturnType<typeof fakeMessage>,
  ) {
    vi.mocked(buildAndGenerateReply).mockImplementationOnce(async (input) => {
      const steering = (input as { steering?: Steering }).steering!;
      steering.observe({ type: "user_message", conversationId: "conv-1" });
      await processMessage(client, mongoClients, followUp as never, "CREATE");
      if (boundary) {
        steering.observe({ type: "turn_input", id: "input-1", boundary });
      }
      if (outcome === "replied") steering.modelReplied = true;
      if (outcome === "abandoned") DiscordState.markCancelled(trigger!.id);
      steering.close();
      return generated(
        outcome === "replied" ? {} : { generatedText: outcome === "failed" ? "..." : null },
      ) as never;
    });
    vi.mocked(buildAndGenerateReply).mockResolvedValue(generated() as never);
  }

  beforeEach(() => {
    resetTurnSteering();
    vi.mocked(PrismService.postAgentInput).mockReset();
    vi.mocked(PrismService.postAgentInput).mockResolvedValue("input-1");
  });

  it("answered in the turn (applied before its last pass): one reply, 👀 on the follow-up", async () => {
    const trigger = fakeMessage();
    const followUp = fakeMessage({ content: "lupos, and also this" });
    turnThatFolds(followUp, "before_end");
    await processMessage(client, mongoClients, trigger as never, "CREATE");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(buildAndGenerateReply).toHaveBeenCalledOnce();
    expect(DiscordUtilityService.sendMessageInChunks).toHaveBeenCalledOnce();
    expect(followUp.react).toHaveBeenCalledWith("👀");
    expect(followUp.reply).not.toHaveBeenCalled();
  });

  it("only joined as the turn ended: queued and answered as its own turn", async () => {
    const trigger = fakeMessage();
    const followUp = fakeMessage({ content: "lupos, and also this" });
    turnThatFolds(followUp, "turn_end");
    await processMessage(client, mongoClients, trigger as never, "CREATE");
    await vi.waitFor(() => expect(buildAndGenerateReply).toHaveBeenCalledTimes(2));
    const second = vi.mocked(buildAndGenerateReply).mock.calls[1][0] as {
      queuedDatum: { message: { id: string } };
      replyMode: string;
    };
    expect(second.queuedDatum.message.id).toBe(followUp.id);
    expect(second.replyMode).toBe("name");
  });

  it("the turn failed or was abandoned: the follow-up gets its own turn", async () => {
    for (const outcome of ["failed", "abandoned"] as const) {
      vi.mocked(buildAndGenerateReply).mockReset();
      agentTurnRateLimiter.reset();
      const trigger = fakeMessage();
      const followUp = fakeMessage({ content: "lupos, and also this" });
      turnThatFolds(followUp, "before_end", outcome, trigger);
      await processMessage(client, mongoClients, trigger as never, "CREATE");
      await vi.waitFor(() => expect(buildAndGenerateReply).toHaveBeenCalledTimes(2));
      expect(
        (vi.mocked(buildAndGenerateReply).mock.calls[1][0] as {
          queuedDatum: { message: { id: string } };
        }).queuedDatum.message.id,
      ).toBe(followUp.id);
    }
  });

  it("an ambient turn takes no follow-ups", async () => {
    resetAmbientState();
    botSettings.CHANNEL_IDS_AMBIENT = [CHANNEL_ID];
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: '{"interject": true, "score": 0.9}',
    } as never);
    vi.mocked(buildAndGenerateReply).mockImplementationOnce(async (input) => {
      expect((input as { steering?: unknown }).steering).toBeUndefined();
      return generated() as never;
    });
    await processMessage(
      client,
      mongoClients,
      fakeMessage({ content: "does anyone know when the raid starts tonight" }) as never,
      "CREATE",
    );
    delete botSettings.CHANNEL_IDS_AMBIENT;
    expect(buildAndGenerateReply).toHaveBeenCalledOnce();
  });
});
