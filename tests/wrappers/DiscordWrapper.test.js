import {
  jest,
  describe,
  test,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "@jest/globals";

jest.unstable_mockModule("discord.js", () => {
  const mClient = {
    login: jest.fn(),
    options: {},
  };
  return {
    default: {},
    Client: jest.fn(() => mClient),
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
  };
});

const DiscordWrapper = (await import("../../services/DiscordService.js"))
  .default;
const { Client } = await import("discord.js");

describe("DiscordWrapper", () => {
  beforeEach(() => {
    // Clear clients array before each test to ensure state isolation
    DiscordWrapper.clients.length = 0;
    jest.clearAllMocks();
  });

  test("should create a new client and login", () => {
    const client = DiscordWrapper.createClient("testBot", "fakeToken");

    expect(Client).toHaveBeenCalledTimes(1);
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
