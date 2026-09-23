// processMessage's gates, driven with mocked discord.js objects: which
// guild messages become a reply (mention, reply with the ping off, name
// used vocatively), which don't, and the per-user agent-turn limit.
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
vi.mock("../PrismService", () => ({ default: {} }));
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
        fetch: vi.fn(async () => ({ content: "a harmless message" })),
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
