// buildAndGenerateReply's side of the agent turn: the trusted context it
// sends (requesterUserId, no temperature), the respond-to directive per
// reply mode, and an ambient turn's [[pass]] — nothing posted, nothing
// committed to the channel session.

vi.mock("#root/services/PrismService.ts", () => ({
  default: { generateAgentResponse: vi.fn() },
  conversationIdOf: (event: { conversationId?: unknown }) =>
    typeof event.conversationId === "string" ? event.conversationId : null,
}));
vi.mock("#root/services/AIService.ts", () => ({
  default: {
    _getTraceParams: vi.fn(() => ({ traceId: "trace-1" })),
    captionImages: vi.fn().mockResolvedValue({ images: [], imagesMap: new Map() }),
  },
}));
vi.mock("#root/services/DiscordUtilityService.ts", () => ({
  default: {
    retrieveMessageReferenceFromMessage: vi.fn().mockResolvedValue(null),
    retrieveMemberFromGuildById: vi.fn().mockResolvedValue(null),
    getDisplayName: vi.fn().mockResolvedValue("Someone"),
  },
}));
vi.mock("#root/services/discord/ConversationExtractor.ts", () => ({
  displayNameOf: (message: { author?: { username?: string } }) =>
    message.author?.username,
  extractEmojisFromAllMessage: vi.fn().mockResolvedValue(new Map()),
  splitEmojiNameAndId: vi.fn(),
}));
vi.mock("#root/services/CensorService.ts", () => ({
  default: { removeFlaggedWords: (text: string) => text },
}));

const { Collection } = await import("discord.js");
const PrismService = (await import("#root/services/PrismService.ts")).default;
const ChannelSessionCache = (
  await import("#root/services/discord/ChannelSessionCache.ts")
).default;
const { buildAndGenerateReply } = await import("../PromptBuilder.ts");
const { openSteerableTurn, resetTurnSteering } = await import("../TurnSteering.ts");

const AUTHOR_ID = "800000000000000001";

function turnInput(replyMode?: "mention" | "ambient") {
  const message = {
    id: "700000000000000042",
    guildId: "600000000000000001",
    channelId: "500000000000000001",
    content: "anyone know a good ramen place",
    cleanContent: "anyone know a good ramen place",
    client: { user: { id: "900000000000000001", username: "Lupos" } },
    author: { id: AUTHOR_ID, username: "alice" },
    attachments: new Collection(),
    mentions: { users: new Collection(), members: new Collection() },
    reference: null,
    guild: null,
    channel: { id: "500000000000000001", name: "general-chat" },
  };
  return {
    conversation: [{ role: "user", content: "<discord-message …>" }],
    memberMentionsCollection: new Collection(),
    messagesEmojisCollection: new Collection(),
    messagesImagesCollection: new Collection(),
    participantsAvatarsCollection: new Collection(),
    participantsCollection: new Collection(),
    participantsMembersCollection: new Collection(),
    participantsUsersCollection: new Collection(),
    queuedDatum: { message, recentMessages: new Collection([[message.id, message]]) },
    userMentionsCollection: new Collection(),
    localMongo: {},
    session: {
      channelId: "500000000000000001",
      piggyback: false,
      representedMessageIds: ["700000000000000042"],
      cumulativeParticipantUserIds: [],
    },
    ...(replyMode && { replyMode }),
  } as never;
}

function agentReply(text: string) {
  vi.mocked(PrismService.generateAgentResponse).mockResolvedValue({
    text,
    images: [],
    toolCalls: [],
    toolResults: [],
    audioRef: null,
    model: "m",
    provider: "p",
  } as never);
}

function sentRequest() {
  return vi.mocked(PrismService.generateAgentResponse).mock.calls[0][0];
}

beforeEach(() => {
  vi.mocked(PrismService.generateAgentResponse).mockReset();
  ChannelSessionCache.clearAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildAndGenerateReply — agent request", () => {
  it("sends the author as requesterUserId and no temperature", async () => {
    agentReply("try the place on main");
    await buildAndGenerateReply(turnInput());
    const request = sentRequest();
    expect(request.agentContext).toMatchObject({
      platform: "discord",
      requesterUserId: AUTHOR_ID,
    });
    expect(request).not.toHaveProperty("temperature");
  });

  it("sends the plain directive when he was addressed", async () => {
    agentReply("try the place on main");
    await buildAndGenerateReply(turnInput("mention"));
    const directive = sentRequest().messages.at(-1);
    expect(directive).toEqual({
      role: "system",
      content: `<respond-to id="700000000000000042" author="alice" author-id="${AUTHOR_ID}" />`,
    });
  });
});

describe("buildAndGenerateReply — ambient turns", () => {
  it("tells him he wasn't addressed and may pass", async () => {
    agentReply("try the place on main");
    await buildAndGenerateReply(turnInput("ambient"));
    const directive = String(sentRequest().messages.at(-1)?.content);
    expect(directive).toContain('addressed="false"');
    expect(directive).toContain("[[pass]]");
  });

  it("a [[pass]] reply posts nothing and commits nothing to the session", async () => {
    const commit = vi.spyOn(ChannelSessionCache, "commit");
    agentReply("[[pass]]");
    const reply = await buildAndGenerateReply(turnInput("ambient"));
    expect(reply).toEqual({
      generatedText: null,
      image: null,
      audioRef: null,
      videoUrl: null,
      imageUrl: null,
      imagePrompt: null,
      passed: true,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(ChannelSessionCache.get("500000000000000001")).toBeUndefined();
  });

  it("an ambient turn that fails is silence, not the \"...\" fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(PrismService.generateAgentResponse).mockRejectedValue(
      new Error("Prism API error: 500"),
    );
    expect((await buildAndGenerateReply(turnInput("ambient"))).generatedText).toBeNull();
    expect((await buildAndGenerateReply(turnInput("mention"))).generatedText).toBe("...");
  });

  it("a real ambient reply is posted and committed like any other", async () => {
    const commit = vi.spyOn(ChannelSessionCache, "commit");
    agentReply("ramen? the one on main, obviously");
    const reply = await buildAndGenerateReply(turnInput("ambient"));
    expect(reply.passed).toBeUndefined();
    expect(reply.generatedText).toBe("ramen? the one on main, obviously");
    expect(commit).toHaveBeenCalledOnce();
  });
});

// The steering handle (TurnSteering) rides the turn's stream: it learns
// the conversation id and which folded follow-ups were applied, closes
// when the stream ends, and answered follow-ups are frozen into the
// channel session between the conversation and the reply.
describe("buildAndGenerateReply — folded follow-ups", () => {
  const FOLLOW_UP_ID = "700000000000000043";

  function steeringFor(input: ReturnType<typeof turnInput>) {
    const { message } = (input as unknown as { queuedDatum: { message: never } }).queuedDatum;
    const steering = openSteerableTurn(message);
    steering.folds.push({
      message: { id: FOLLOW_UP_ID } as never,
      replyMode: "name",
      turn: { role: "user", name: "alice", content: "<discord-message follow-up>" },
      posted: Promise.resolve("input-1"),
      inputId: "input-1",
    });
    return steering;
  }

  beforeEach(() => resetTurnSteering());

  it("streams to the steering handle even with no status tracker, then closes it", async () => {
    const input = turnInput("mention");
    const steering = steeringFor(input);
    vi.mocked(PrismService.generateAgentResponse).mockImplementation(async (params) => {
      expect(steering.closed).toBe(false);
      params.onEvent?.({ type: "user_message", conversationId: "conv-1" });
      params.onEvent?.({ type: "turn_input", id: "input-1", boundary: "before_end" });
      return { text: "ramen on main. and yes, takeout.", images: [], toolCalls: [], toolResults: [], audioRef: null } as never;
    });
    await buildAndGenerateReply({ ...(input as object), steering } as never);
    expect(sentRequest().signal).toBeInstanceOf(AbortSignal);
    expect(steering.conversationId).toBe("conv-1");
    expect(steering.closed).toBe(true);
    expect(steering.modelReplied).toBe(true);
  });

  it("freezes an answered follow-up after the conversation and before the reply", async () => {
    const input = turnInput("mention");
    const steering = steeringFor(input);
    vi.mocked(PrismService.generateAgentResponse).mockImplementation(async (params) => {
      params.onEvent?.({ type: "turn_input", id: "input-1", boundary: "before_end" });
      return { text: "both answered", images: [], toolCalls: [], toolResults: [], audioRef: null } as never;
    });
    await buildAndGenerateReply({ ...(input as object), steering } as never);
    const session = ChannelSessionCache.get("500000000000000001")!;
    expect(session.frozenConversation.map((turn) => turn.content)).toEqual([
      "<discord-message …>",
      "<discord-message follow-up>",
      "both answered",
    ]);
    expect(session.messageIds.has(FOLLOW_UP_ID)).toBe(true);
  });

  it("leaves a follow-up that only joined as the turn ended out of the session", async () => {
    const input = turnInput("mention");
    const steering = steeringFor(input);
    vi.mocked(PrismService.generateAgentResponse).mockImplementation(async (params) => {
      params.onEvent?.({ type: "turn_input", id: "input-1", boundary: "turn_end" });
      return { text: "first only", images: [], toolCalls: [], toolResults: [], audioRef: null } as never;
    });
    await buildAndGenerateReply({ ...(input as object), steering } as never);
    const session = ChannelSessionCache.get("500000000000000001")!;
    expect(session.frozenConversation).toHaveLength(2);
    expect(session.messageIds.has(FOLLOW_UP_ID)).toBe(false);
  });

  it("a failed turn closes the handle without marking a reply", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const input = turnInput("mention");
    const steering = steeringFor(input);
    vi.mocked(PrismService.generateAgentResponse).mockRejectedValue(new Error("Prism API error: 500"));
    const reply = await buildAndGenerateReply({ ...(input as object), steering } as never);
    expect(reply.generatedText).toBe("...");
    expect(steering.closed).toBe(true);
    expect(steering.modelReplied).toBe(false);
  });
});
