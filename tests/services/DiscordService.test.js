// DiscordService has an enormous transitive dependency tree.
// Mock all heavyweight dependencies to allow the test to load.

// ── Third-party packages ─────────────────────────────────────────────────────
vi.mock("discord.js", () => ({
  Collection: class extends Map {},
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
}));
vi.mock("hex-color-to-color-name", () => ({
  GetColorName: vi.fn((hex) => hex),
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
    })),
  },
}));

// ── Internal services ────────────────────────────────────────────────────────
vi.mock("../../services/ScraperService", () => ({
  default: {},
}));
vi.mock("../../wrappers/DiscordWrapper", () => ({
  default: {
    getClient: vi.fn().mockReturnValue({
      user: { setActivity: vi.fn(), id: "bot-id" },
    }),
    clients: [],
  },
}));
vi.mock("../../services/YouTubeService", () => ({
  default: {},
}));
vi.mock("../../services/LightsService", () => ({
  default: {},
}));
vi.mock("../../services/MongoService", () => ({
  default: {
    getClient: vi.fn().mockReturnValue(null),
  },
}));
vi.mock("../../services/PrismService", () => ({
  default: {},
}));
vi.mock("../../services/DiscordUtilityService", () => ({
  default: {
    getUsernameNoSpaces: vi.fn(),
    getDisplayName: vi.fn(),
  },
}));
vi.mock("../../services/AIService", () => ({
  default: {},
}));
vi.mock("../../services/CurrentService", () => ({
  default: {
    getMessage: vi.fn(),
    setUser: vi.fn(),
    setMessage: vi.fn(),
  },
}));
vi.mock("../../services/CensorService", () => ({
  default: {},
}));
vi.mock("../../services/AccountGuardService", () => ({
  kickIfTooNew: vi.fn(),
  kickIfForbiddenCombo: vi.fn(),
  purgeByAccountAge: vi.fn(),
}));

// ── Jobs ─────────────────────────────────────────────────────────────────────
vi.mock("../../jobs/scheduled/BirthdayJob", () => ({
  default: {},
}));
vi.mock("../../jobs/scheduled/ActivityRoleAssignmentJob", () => ({
  default: {},
}));
vi.mock("../../jobs/scheduled/PermanentTimeOutJob", () => ({
  default: {},
}));
vi.mock("../../jobs/scheduled/RandomTagJob", () => ({
  default: {},
}));
vi.mock("../../jobs/scheduled/ServerIconJob", () => ({
  default: {},
}));
vi.mock("../../jobs/event-driven/ReactJob", () => ({
  default: {},
}));

const DiscordService = (await import("../../services/DiscordService.js"))
  .default;

describe("DiscordService", () => {
  it("should be defined", () => {
    expect(DiscordService).toBeDefined();
  });

  it("should have cloneMessages property", () => {
    expect(typeof DiscordService.cloneMessages).toBe("function");
  });
});
