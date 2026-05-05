vi.mock("discord.js", () => {
  const mClient = {
    login: vi.fn(),
    options: {},
  };
  // Class-based mock so `new Client(...)` works in Vitest 4
  // and we can still assert on call count
  class MockClient {
    constructor() {
      Object.assign(this, mClient);
    }
  }
  return {
    default: {},
    Client: MockClient,
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

const DiscordWrapper = (await import("../../wrappers/DiscordWrapper.js"))
  .default;
const { Client } = await import("discord.js");

describe("DiscordWrapper", () => {
  beforeEach(() => {
    // Clear clients array before each test to ensure state isolation
    DiscordWrapper.clients.length = 0;
    vi.clearAllMocks();
  });

  test("should create a new client and login", () => {
    const client = DiscordWrapper.createClient("testBot", "fakeToken");

    expect(client).toBeInstanceOf(Client);
    expect(client.login).toHaveBeenCalledWith("fakeToken");
    expect(client.options.failIfNotExists).toBe(false);
  });

  test("should store created clients and retrieve them by name", () => {
    const client1 = DiscordWrapper.createClient("bot1", "token1");
    const client2 = DiscordWrapper.createClient("bot2", "token2");

    expect(DiscordWrapper.clients.length).toBe(2);
    expect(DiscordWrapper.getClient("bot1")).toBe(client1);
    expect(DiscordWrapper.getClient("bot2")).toBe(client2);
  });
});
