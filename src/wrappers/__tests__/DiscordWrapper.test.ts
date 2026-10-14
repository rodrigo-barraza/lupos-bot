// The application flags GET /applications/@me answers with.
const application = vi.hoisted(() => ({ flags: 0 }));

vi.mock("discord.js", () => {
  // Class-based mock so `new Client(...)` works in Vitest 4 — each client
  // records its event handlers so a test can fire them.
  class MockClient {
    login = vi.fn();
    options: Record<string, unknown> = {};
    readyAt: Date | null = null;
    handlers: Record<string, (...args: unknown[]) => void> = {};
    rest = {
      setToken: vi.fn(),
      get: vi.fn(async () => ({ flags: application.flags })),
    };
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers[event] = handler;
      return this;
    });
  }
  class MockIntentsBitField {
    bits: number[];
    constructor(bits: number[]) {
      this.bits = bits;
    }
    freeze() {
      return this;
    }
    has(bit: number) {
      return this.bits.includes(bit);
    }
  }
  return {
    default: {},
    Client: MockClient,
    IntentsBitField: MockIntentsBitField,
    Routes: { currentApplication: () => "/applications/@me" },
    GatewayIntentBits: {
      Guilds: 1,
      GuildMembers: 2,
      GuildPresences: 4,
      GuildMessages: 8,
      MessageContent: 16,
      DirectMessages: 32,
      GuildMessageReactions: 64,
      GuildExpressions: 128,
      GuildVoiceStates: 256,
      AutoModerationExecution: 512,
    },
    ActivityType: {
      Playing: 0,
      Streaming: 1,
      Listening: 2,
      Watching: 3,
      Custom: 4,
      Competing: 5,
    },
    Events: {
      ClientReady: "ready",
      MessageCreate: "messageCreate",
      InteractionCreate: "interactionCreate",
      GuildMemberAdd: "guildMemberAdd",
      GuildMemberRemove: "guildMemberRemove",
      MessageReactionAdd: "messageReactionAdd",
      MessageReactionRemove: "messageReactionRemove",
      ShardReady: "shardReady",
      ShardResume: "shardResume",
      ShardReconnecting: "shardReconnecting",
      ShardDisconnect: "shardDisconnect",
    },
    ChannelType: {
      GuildText: 0,
      DM: 1,
      GuildVoice: 2,
      GroupDM: 3,
      GuildCategory: 4,
      GuildAnnouncement: 5,
      AnnouncementThread: 10,
      PublicThread: 11,
      PrivateThread: 12,
      GuildStageVoice: 13,
      GuildDirectory: 14,
      GuildForum: 15,
      GuildMedia: 16,
    },
    Partials: {
      Channel: 1,
      Message: 2,
      Reaction: 3,
      User: 4,
      GuildMember: 5,
    },
    Collection: class extends Map {},
  };
});

const wrapperModule = await import("../DiscordWrapper.ts");
const DiscordWrapper = wrapperModule.default;
const {
  resolveGrantedIntents,
  hasGatewayIntent,
  isMessageContentWithheld,
  assertGuildMembersIntent,
} = wrapperModule;
const { Client, IntentsBitField } = await import("discord.js");

type MockClient = InstanceType<typeof Client> & {
  handlers: Record<string, (...args: unknown[]) => void>;
  rest: { setToken: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  login: ReturnType<typeof vi.fn>;
};

// Mock intent values (see the GatewayIntentBits mock above).
const ALL_INTENTS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const GUILD_MEMBERS = 2;
const GUILD_PRESENCES = 4;
const MESSAGE_CONTENT = 16;
// Lupos's application flags on 2026-10-09, after Discord removed its
// privileged intent access: bits 21 and 24, none of the gateway flags.
const FLAGS_AFTER_REMOVAL = 18874368;

function clientWith(intents: number[] | undefined) {
  return {
    options: intents ? { intents: new IntentsBitField(intents as never) } : {},
  } as never;
}

describe("DiscordWrapper", () => {
  beforeEach(() => {
    // Clear clients array before each test to ensure state isolation
    DiscordWrapper.clients.length = 0;
    vi.clearAllMocks();
  });

  test("should create a new client and login", async () => {
    const client = DiscordWrapper.createClient("testBot", "fakeToken") as MockClient;

    expect(client).toBeInstanceOf(Client);
    await vi.waitFor(() => expect(client.login).toHaveBeenCalledWith("fakeToken"));
    expect(client.options.failIfNotExists).toBe(false);
  });

  test("should store created clients and retrieve them by name", () => {
    const client1 = DiscordWrapper.createClient("bot1", "token1");
    const client2 = DiscordWrapper.createClient("bot2", "token2");

    expect(DiscordWrapper.clients.length).toBe(2);
    expect(DiscordWrapper.getClient("bot1")).toBe(client1);
    expect(DiscordWrapper.getClient("bot2")).toBe(client2);
  });

  test("asks Discord for the application flags and logs in with only the granted intents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    application.flags = 1 << 14; // GuildMembers approved, nothing else
    const client = DiscordWrapper.createClient("lupos-test", "tok") as MockClient;

    await vi.waitFor(() => expect(client.login).toHaveBeenCalledWith("tok"));
    expect(client.rest.setToken).toHaveBeenCalledWith("tok");
    expect(client.rest.get).toHaveBeenCalledWith("/applications/@me");
    const intents = client.options.intents as unknown as { bits: number[] };
    expect(intents.bits).toEqual([1, 2, 8, 32, 64, 128, 256, 512]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GuildPresences, MessageContent"));
    application.flags = 0;
  });

  test("tracks the gateway: down until READY, down again on a disconnect", () => {
    const client = DiscordWrapper.createClient("gw", "tok") as MockClient;
    expect(DiscordWrapper.getGatewayDownSinceMs("gw")).toEqual(expect.any(Number));

    client.handlers.shardReady(0);
    expect(DiscordWrapper.getGatewayDownSinceMs("gw")).toBeNull();

    client.handlers.shardReconnecting(0);
    const downSince = DiscordWrapper.getGatewayDownSinceMs("gw");
    expect(downSince).toEqual(expect.any(Number));

    client.handlers.shardResume(0);
    expect(DiscordWrapper.getGatewayDownSinceMs("gw")).toBeNull();
    expect(DiscordWrapper.getGatewayDownSinceMs("never-created")).toBeNull();
  });

  test("restarts on a 4014 after READY, never on one at boot", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const client = DiscordWrapper.createClient("revoked", "tok") as MockClient;

    // At boot (never READY): the same answer would come back after a
    // restart, so the process stays up instead of looping.
    client.handlers.shardDisconnect({ code: 4014 }, 0);
    expect(kill).not.toHaveBeenCalled();

    // Mid-session: Discord withdrew an intent — restart to reconnect.
    (client as unknown as { readyAt: Date }).readyAt = new Date();
    client.handlers.shardDisconnect({ code: 4004 }, 0);
    expect(kill).not.toHaveBeenCalled();
    client.handlers.shardDisconnect({ code: 4014 }, 0);
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
    kill.mockRestore();
  });
});

describe("resolveGrantedIntents", () => {
  test("withholds all three privileged intents when no gateway flag is set", () => {
    expect(resolveGrantedIntents(ALL_INTENTS, FLAGS_AFTER_REMOVAL)).toEqual({
      granted: [1, 8, 32, 64, 128, 256],
      withheld: ["GuildMembers", "GuildPresences", "MessageContent"],
    });
  });

  test("grants them under the Developer Portal toggles (the _LIMITED flags)", () => {
    const limited = (1 << 13) | (1 << 15) | (1 << 19);
    expect(resolveGrantedIntents(ALL_INTENTS, limited)).toEqual({
      granted: ALL_INTENTS,
      withheld: [],
    });
  });

  test("grants them once approved through review (the plain flags)", () => {
    const approved = (1 << 12) | (1 << 14) | (1 << 18);
    expect(resolveGrantedIntents(ALL_INTENTS, approved).withheld).toEqual([]);
  });

  test("grants exactly the approved ones when only some are", () => {
    const membersOnly = 1 << 14;
    expect(resolveGrantedIntents(ALL_INTENTS, membersOnly)).toEqual({
      granted: [1, 2, 8, 32, 64, 128, 256],
      withheld: ["GuildPresences", "MessageContent"],
    });
  });
});

describe("intent checks", () => {
  test("hasGatewayIntent reads the client's intents; no intent information counts as all", () => {
    expect(hasGatewayIntent(clientWith([1, MESSAGE_CONTENT]), MESSAGE_CONTENT)).toBe(true);
    expect(hasGatewayIntent(clientWith([1]), MESSAGE_CONTENT)).toBe(false);
    expect(hasGatewayIntent(clientWith(undefined), MESSAGE_CONTENT)).toBe(true);
  });

  test("isMessageContentWithheld: an empty message on a client without MessageContent", () => {
    const message = (client: unknown, fields: Record<string, unknown> = {}) =>
      ({
        client,
        content: "",
        attachments: new Map(),
        embeds: [],
        poll: null,
        ...fields,
      }) as never;
    const withoutContent = clientWith([1, GUILD_MEMBERS]);
    expect(isMessageContentWithheld(message(withoutContent))).toBe(true);
    // An @-mention still carries its content.
    expect(isMessageContentWithheld(message(withoutContent, { content: "hi" }))).toBe(false);
    expect(
      isMessageContentWithheld(message(withoutContent, { attachments: new Map([["1", {}]]) })),
    ).toBe(false);
    // With the intent nothing is withheld, empty or not.
    expect(isMessageContentWithheld(message(clientWith([1, MESSAGE_CONTENT])))).toBe(false);
  });

  test("assertGuildMembersIntent throws without GuildMembers instead of waiting out a fetch", () => {
    const guild = (intents: number[]) => ({ name: "Whitemane", client: clientWith(intents) }) as never;
    expect(() => assertGuildMembersIntent(guild([1, GUILD_PRESENCES]))).toThrow(
      /GuildMembers intent.*Whitemane/,
    );
    expect(() => assertGuildMembersIntent(guild([1, GUILD_MEMBERS]))).not.toThrow();
  });
});
