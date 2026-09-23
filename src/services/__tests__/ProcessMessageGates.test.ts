// processMessage's gates, driven with mocked discord.js objects: which
// guild messages become a reply (mention, reply with the ping off, name
// used vocatively, an ambient interjection), which don't, and the
// per-user agent-turn limit.
// DiscordUtilityService.fetchMessages returns null, which ends the
// pipeline right after a message is accepted — acceptance is read from
// DiscordState.wasAcceptedForReply.

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
  default: { generateText: vi.fn(), postAgentInput: vi.fn() },
  conversationIdOf: (event: { conversationId?: unknown }) =>
    typeof event.conversationId === "string" ? event.conversationId : null,
}));
vi.mock("../DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn(),
    getDisplayName: vi.fn(),
    fetchMessages: vi.fn().mockResolvedValue(null),
    startTypingInterval: vi.fn().mockResolvedValue(undefined),
    clearTypingInterval: vi.fn(),
    addRoleToMember: vi.fn(),
    removeRoleFromMember: vi.fn(),
  },
}));
vi.mock("../AIService", () => ({ default: {} }));
vi.mock("../CurrentService", () => ({
  default: { getMessage: vi.fn(), setUser: vi.fn(), setMessage: vi.fn() },
}));
vi.mock("../CensorService", () => ({
  default: {
    containsFlaggedWords: vi.fn((text: string) => /\bslur\b/.test(text)),
  },
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
const { agentTurnRateLimiter } = await import(
  "../discord/AgentTurnRateLimiter.ts"
);
const DiscordUtilityService = (await import("../DiscordUtilityService.ts"))
  .default;
const { DISCORD_USERS } = await import(
  "@rodrigo-barraza/utilities-library/taxonomy"
);
const PrismService = (await import("../PrismService.ts")).default;
const { resetAmbientState } = await import(
  "../discord/AmbientInterjection.ts"
);
const config = (await import("#root/config.ts")).default;
const { openSteerableTurn, resetTurnSteering } = await import(
  "../discord/TurnSteering.ts"
);
const PrepTimings = (await import("../discord/PrepTimings.ts")).default;

const BOT_ID = "900000000000000001";
const botUser = { id: BOT_ID, username: "Lupos" };
const client = { user: botUser } as never;
const mongoClients = { mongo: {} as never, localMongo: {} as never };

let nextMessageId = 1000;

interface FakeMessageOptions {
  content?: string;
  authorId?: string;
  bot?: boolean;
  mentionsBot?: boolean;
  repliedUserId?: string;
  roleIds?: string[];
}

function fakeMessage({
  content = "",
  authorId = "800000000000000001",
  bot = false,
  mentionsBot = false,
  repliedUserId,
  roleIds = [],
}: FakeMessageOptions = {}) {
  const id = String(nextMessageId++);
  const react = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  const message = {
    id,
    content,
    cleanContent: content,
    type: repliedUserId ? 19 : 0,
    guildId: "700000000000000001",
    channelId: "600000000000000001",
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    author: { id: authorId, username: `user${authorId.slice(-2)}`, bot },
    member: {
      roles: {
        cache: {
          some: (predicate: (role: { id: string }) => boolean) =>
            roleIds.some((roleId) => predicate({ id: roleId })),
        },
      },
    },
    guild: { id: "700000000000000001", name: "Guild" },
    channel: {
      id: "600000000000000001",
      type: 0,
      name: "general-chat",
      messages: {
        cache: new Map(),
        // fetch(id) → the replied-to message; fetch({ limit }) → history
        fetch: vi.fn(async (query: unknown) =>
          typeof query === "string" ? { content: "a harmless message" } : new Map(),
        ),
      },
    },
    mentions: {
      has: vi.fn((user: { id: string }) => mentionsBot && user.id === BOT_ID),
      repliedUser: repliedUserId ? { id: repliedUserId } : null,
    },
    reference: repliedUserId ? { messageId: "500000000000000001" } : null,
    attachments: new Map(),
    stickers: new Map(),
    react,
    reply,
  };
  return { message: message as never, react, reply, id };
}

async function run(options: FakeMessageOptions) {
  const fake = fakeMessage(options);
  await processMessage(client, mongoClients, fake.message, "CREATE");
  return { ...fake, accepted: DiscordState.wasAcceptedForReply(fake.id) };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  agentTurnRateLimiter.reset();
  for (const key of Object.keys(botSettings)) delete botSettings[key];
  vi.mocked(DiscordUtilityService.fetchMessages).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processMessage — who Lupos answers", () => {
  it("answers an @-mention (unchanged)", async () => {
    expect((await run({ content: "<@900000000000000001> hi", mentionsBot: true })).accepted).toBe(true);
  });

  it("answers a reply to one of his messages with the ping OFF", async () => {
    const { accepted } = await run({ content: "lmao ok", repliedUserId: BOT_ID });
    expect(accepted).toBe(true);
    expect(DiscordUtilityService.fetchMessages).toHaveBeenCalledOnce();
  });

  it("answers his name used vocatively", async () => {
    expect((await run({ content: "lupos, who won the game?" })).accepted).toBe(true);
    expect((await run({ content: "what's the move tonight, lupos?" })).accepted).toBe(true);
  });

  it("ignores his name mid-sentence and replies to other people", async () => {
    expect((await run({ content: "i think lupos is broken again" })).accepted).toBe(false);
    expect(
      (await run({ content: "agreed", repliedUserId: "800000000000000009" })).accepted,
    ).toBe(false);
    expect(DiscordUtilityService.fetchMessages).not.toHaveBeenCalled();
  });

  it("never answers bots, even by name or reply", async () => {
    expect((await run({ content: "lupos, hi", bot: true })).accepted).toBe(false);
    expect((await run({ content: "hi", bot: true, repliedUserId: BOT_ID })).accepted).toBe(false);
  });

  it("keeps the ignore lists and roles on the new paths", async () => {
    botSettings.USER_IDS_IGNORE = ["800000000000000005"];
    botSettings.ROLES_IDS_IGNORE = ["400000000000000001"];
    expect(
      (await run({ content: "lupos, hi", authorId: "800000000000000005" })).accepted,
    ).toBe(false);
    expect(
      (await run({ content: "hi", repliedUserId: BOT_ID, roleIds: ["400000000000000001"] }))
        .accepted,
    ).toBe(false);
  });

  it("keeps the disallowed list on the new paths", async () => {
    botSettings.USER_IDS_DISALLOWED = ["800000000000000006"];
    expect(
      (await run({ content: "hey lupos", authorId: "800000000000000006" })).accepted,
    ).toBe(false);
  });

  it("runs the flagged-content check on replies and name addresses too", async () => {
    const byName = await run({ content: "lupos, say slur" });
    expect(byName.accepted).toBe(false);
    expect(byName.reply).toHaveBeenCalledWith("beep boop, no slurs, ya dumbass");

    const byReply = await run({ content: "slur", repliedUserId: BOT_ID });
    expect(byReply.accepted).toBe(false);
    expect(byReply.reply).toHaveBeenCalledOnce();
  });

  it("never polices messages that weren't addressed to him", async () => {
    const unaddressed = await run({ content: "slur" });
    expect(unaddressed.reply).not.toHaveBeenCalled();
  });
});

describe("processMessage — per-user agent-turn limit", () => {
  it("takes 4 turns in 2 minutes, then reacts ⏳ instead of replying", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await run({ content: "lupos, again" })).accepted).toBe(true);
    }
    const fifth = await run({ content: "lupos, again" });
    expect(fifth.accepted).toBe(false);
    expect(fifth.react).toHaveBeenCalledWith("⏳");
    expect(fifth.react).toHaveBeenCalledOnce();
  });

  it("counts every path against the same allowance", async () => {
    await run({ content: "<@900000000000000001>", mentionsBot: true });
    await run({ content: "ok", repliedUserId: BOT_ID });
    await run({ content: "hey lupos" });
    await run({ content: "lupos?" });
    const fifth = await run({ content: "hi", mentionsBot: true });
    expect(fifth.accepted).toBe(false);
    expect(fifth.react).toHaveBeenCalledWith("⏳");
  });

  it("exempts the owner", async () => {
    for (let i = 0; i < 8; i++) {
      const turn = await run({ content: "lupos, again", authorId: DISCORD_USERS.owner });
      expect(turn.accepted).toBe(true);
      expect(turn.react).not.toHaveBeenCalled();
    }
  });

  it("does not spend allowance on ignored or unaddressed messages", async () => {
    for (let i = 0; i < 10; i++) await run({ content: "just chatting" });
    expect((await run({ content: "lupos, hi" })).accepted).toBe(true);
  });
});

describe("processMessage — ambient interjection", () => {
  const AMBIENT_CHANNEL = "600000000000000001";
  const question = "does anyone know when the raid starts tonight";

  function classifierSays(interject: boolean, score: number) {
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: JSON.stringify({ interject, score }),
    } as never);
  }

  beforeEach(() => {
    resetAmbientState();
    vi.mocked(PrismService.generateText).mockReset();
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    botSettings.CHANNEL_IDS_AMBIENT = [AMBIENT_CHANNEL];
    // Hold the drain so a queued turn can be inspected, not run.
    DiscordState.isProcessingQueue = true;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue({
      reverse: () => new Map(),
    } as never);
  });

  afterEach(() => {
    DiscordState.isProcessingQueue = false;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue(null);
  });

  it("chimes in when the classifier says yes — queued as an ambient turn", async () => {
    classifierSays(true, 0.9);
    const turn = await run({ content: question });
    expect(turn.accepted).toBe(true);
    expect(DiscordState.queuedData.map((queued) => queued.replyMode)).toEqual(["ambient"]);
    expect(turn.react).not.toHaveBeenCalled();
  });

  it("stays silent (no reply, no reaction) when the classifier says no or errors", async () => {
    classifierSays(true, 0.5);
    const lukewarm = await run({ content: question });
    expect(lukewarm.accepted).toBe(false);
    expect(lukewarm.reply).not.toHaveBeenCalled();
    expect(lukewarm.react).not.toHaveBeenCalled();

    resetAmbientState();
    vi.mocked(PrismService.generateText).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await run({ content: question })).accepted).toBe(false);
    expect(DiscordState.queuedData).toHaveLength(0);
  });

  it("is off everywhere by default", async () => {
    botSettings.CHANNEL_IDS_AMBIENT = [];
    classifierSays(true, 0.99);
    expect((await run({ content: question })).accepted).toBe(false);
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("never classifies messages any other gate would refuse", async () => {
    classifierSays(true, 0.99);
    botSettings.USER_IDS_IGNORE = ["800000000000000005"];
    botSettings.ROLES_IDS_IGNORE = ["400000000000000001"];
    await run({ content: question, authorId: "800000000000000005" });
    await run({ content: question, roleIds: ["400000000000000001"] });
    await run({ content: question, bot: true });
    const flagged = await run({ content: "the raid leader is a slur honestly" });
    expect(flagged.reply).not.toHaveBeenCalled();
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("leaves addressed messages in an ambient channel to the normal path", async () => {
    classifierSays(false, 0);
    const turn = await run({ content: "lupos, when does the raid start" });
    expect(turn.accepted).toBe(true);
    expect(DiscordState.queuedData.map((queued) => queued.replyMode)).toEqual(["name"]);
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("spends the author's turn allowance, and skips (silently) once it is gone", async () => {
    for (let i = 0; i < 4; i++) await run({ content: "lupos, again" });
    classifierSays(true, 0.99);
    const turn = await run({ content: question });
    expect(turn.accepted).toBe(false);
    expect(turn.react).not.toHaveBeenCalled();
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("holds the channel cooldown after an interjection — no second classifier call", async () => {
    classifierSays(true, 0.9);
    expect((await run({ content: question })).accepted).toBe(true);
    expect(
      (await run({ content: "and who is bringing the flasks this time", authorId: "800000000000000003" }))
        .accepted,
    ).toBe(false);
    expect(PrismService.generateText).toHaveBeenCalledOnce();
  });

  it("never interjects on an edit", async () => {
    classifierSays(true, 0.99);
    const fake = fakeMessage({ content: question });
    await processMessage(client, mongoClients, fake.message, "UPDATE");
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });
});

// Round-2 contract §4: a follow-up by the author of the turn that is
// streaming in this channel joins that turn (POST /agent/input) instead
// of being queued behind it.
describe("processMessage — folding a follow-up into the running turn", () => {
  const AUTHOR = "800000000000000001";

  function runningTurn() {
    const trigger = fakeMessage({ content: "lupos, first question" }).message;
    const turn = openSteerableTurn(trigger);
    turn.observe({ type: "user_message", conversationId: "conv-1" });
    return turn;
  }

  beforeEach(() => {
    resetTurnSteering();
    resetAmbientState();
    vi.mocked(PrismService.postAgentInput).mockReset();
    vi.mocked(PrismService.postAgentInput).mockResolvedValue("input-1");
    vi.mocked(PrismService.generateText).mockReset();
    // Hold the drain so a queued turn can be inspected, not run.
    DiscordState.isProcessingQueue = true;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue({
      reverse: () => new Map(),
    } as never);
  });

  afterEach(() => {
    DiscordState.isProcessingQueue = false;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue(null);
  });

  it("folds the author's next addressed message: 👀 once, nothing queued", async () => {
    runningTurn();
    const followUp = await run({ content: "lupos, and what about tomorrow?" });
    expect(PrismService.postAgentInput).toHaveBeenCalledOnce();
    expect(vi.mocked(PrismService.postAgentInput).mock.calls[0][0]).toBe("conv-1");
    expect(followUp.react).toHaveBeenCalledOnce();
    expect(followUp.react).toHaveBeenCalledWith("👀");
    expect(followUp.reply).not.toHaveBeenCalled();
    expect(followUp.accepted).toBe(true); // an edit can't re-reply it
    expect(DiscordUtilityService.fetchMessages).not.toHaveBeenCalled();
    expect(DiscordState.queuedData).toHaveLength(0);
  });

  it("folds every addressing mode (mention, reply, name)", async () => {
    runningTurn();
    await run({ content: "<@900000000000000001> also", mentionsBot: true });
    await run({ content: "also", repliedUserId: BOT_ID });
    await run({ content: "lupos, also" });
    expect(PrismService.postAgentInput).toHaveBeenCalledTimes(3);
    expect(DiscordState.queuedData).toHaveLength(0);
  });

  it("queues it as its own turn when Prism refuses (409 / error)", async () => {
    vi.mocked(PrismService.postAgentInput).mockResolvedValue(null);
    runningTurn();
    const followUp = await run({ content: "lupos, and tomorrow?" });
    expect(followUp.react).not.toHaveBeenCalled();
    expect(followUp.accepted).toBe(true);
    expect(DiscordState.queuedData.map((queued) => queued.message.id)).toEqual([followUp.id]);
  });

  it("never folds another author's message", async () => {
    runningTurn();
    const other = await run({ content: "lupos, me too", authorId: "800000000000000002" });
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
    expect(DiscordState.queuedData.map((queued) => queued.message.id)).toEqual([other.id]);
  });

  it("never folds before the stream named the conversation, or after it finished", async () => {
    openSteerableTurn(fakeMessage({ content: "lupos, first" }).message);
    await run({ content: "lupos, also" });
    const finished = runningTurn();
    finished.observe({ type: "done" });
    await run({ content: "lupos, also" });
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
    expect(DiscordState.queuedData).toHaveLength(2);
  });

  it("never folds an edit", async () => {
    runningTurn();
    const fake = fakeMessage({ content: "lupos, edited", mentionsBot: true });
    await processMessage(client, mongoClients, fake.message, "UPDATE");
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
  });

  it("never folds a message that reached him on the ambient path", async () => {
    botSettings.CHANNEL_IDS_AMBIENT = ["600000000000000001"];
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: JSON.stringify({ interject: true, score: 0.9 }),
    } as never);
    runningTurn();
    await run({ content: "does anyone know when the raid starts tonight" });
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
    expect(DiscordState.queuedData.map((queued) => queued.replyMode)).toEqual(["ambient"]);
  });

  it("a folded follow-up spends no turn allowance", async () => {
    runningTurn();
    for (let i = 0; i < 6; i++) {
      const followUp = await run({ content: "lupos, one more thing", authorId: AUTHOR });
      expect(followUp.react).toHaveBeenCalledWith("👀");
      expect(followUp.react).not.toHaveBeenCalledWith("⏳");
    }
  });
});

describe("acceptAndQueueReply — before the reply is built", () => {
  const PRIMARY = "700000000000000001";
  let savedPrimary: string | undefined;

  beforeEach(() => {
    resetTurnSteering();
    savedPrimary = config.GUILD_ID_PRIMARY;
    config.GUILD_ID_PRIMARY = PRIMARY;
    DiscordState.isProcessingQueue = true;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue({
      reverse: () => new Map(),
    } as never);
  });

  afterEach(() => {
    config.GUILD_ID_PRIMARY = savedPrimary;
    DiscordState.isProcessingQueue = false;
    DiscordState.queuedData.length = 0;
    vi.mocked(DiscordUtilityService.fetchMessages).mockResolvedValue(null);
    vi.mocked(DiscordUtilityService.addRoleToMember).mockReset();
  });

  it("runs the chatter-role PUT and the history fetch side by side; queues after both", async () => {
    let finishRole: () => void = () => {};
    vi.mocked(DiscordUtilityService.addRoleToMember).mockImplementation(
      () => new Promise<void>((resolve) => {
        finishRole = resolve;
      }),
    );
    const fake = fakeMessage({ content: "lupos, hi" });
    const pending = processMessage(client, mongoClients, fake.message, "CREATE");
    await vi.waitFor(() => expect(DiscordUtilityService.fetchMessages).toHaveBeenCalledOnce());
    expect(DiscordUtilityService.addRoleToMember).toHaveBeenCalledOnce();
    expect(vi.mocked(DiscordUtilityService.fetchMessages).mock.calls[0][2]).toEqual({
      limit: 500,
      before: fake.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(DiscordState.queuedData).toHaveLength(0); // still waiting on the role
    finishRole();
    await pending;
    expect(DiscordState.queuedData).toHaveLength(1);
    expect(DiscordState.queuedData[0].timings).toBeInstanceOf(PrepTimings);
  });

  it("gives no chatter role on the ambient path", async () => {
    botSettings.CHANNEL_IDS_AMBIENT = ["600000000000000001"];
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
    resetAmbientState();
    vi.mocked(PrismService.generateText).mockResolvedValue({
      text: JSON.stringify({ interject: true, score: 0.9 }),
    } as never);
    await run({ content: "does anyone know when the raid starts tonight" });
    expect(DiscordState.queuedData.map((queued) => queued.replyMode)).toEqual(["ambient"]);
    expect(DiscordUtilityService.addRoleToMember).not.toHaveBeenCalled();
  });
});
