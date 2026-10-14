/**
 * LaughOnlyAutoMod.test.ts
 *
 * The laugh-only rule while Discord withholds message content: an AutoMod
 * rule of Lupos's flags the laughs and he deletes a listed member's. These
 * pin the pattern (it must agree with isLaughOnlyMessage, in a form Discord
 * accepts), the rule's upkeep per guild, and what a verdict does.
 */
import { describe, it, expect, vi } from "vitest";
import {
  AutoModerationActionType,
  ChannelType,
  Collection,
  DiscordAPIError,
  GatewayIntentBits,
  PermissionFlagsBits,
  Routes,
} from "discord.js";

vi.mock("#root/config.ts", () => ({
  default: { GUILD_ID_GROBBULUS: "grobbulus" },
}));

const LISTED = "469535087114059776";
vi.mock("#root/services/BotSettingsService.ts", () => ({
  default: {
    get: (key: string) =>
      key === "USER_IDS_LAUGH_ONLY_DELETED" ? [LISTED] : [],
  },
}));

const {
  ALERT_CHANNEL_NAME,
  AUTOMOD_RULE_NAME,
  LAUGH_ONLY_AUTOMOD_PATTERN,
  luposOnAutoModerationActionExecution,
  reconcileLaughOnlyAutoMod,
} = await import("#root/services/discord/LaughOnlyAutoMod.ts");
const { isLaughOnlyMessage } =
  await import("#root/services/discord/LaughOnlyMessages.ts");
const { LAUGHS, MIXED_LAUGHS, NOT_LAUGHS } = await import("./laughCases.ts");

// ─── The pattern ───────────────────────────────────────────────

/**
 * The pattern in JavaScript's dialect: (?i) → the i flag, \A … \z → ^ … $
 * (no m flag, so the whole message), \pP → \p{P}. Discord runs the Rust
 * original, which was checked against the same cases with the regex crate.
 */
function asJavaScript(pattern: string): RegExp {
  const body = pattern
    .replace(/^\(\?i\)\\A/, "^")
    .replace(/\\z$/, "$")
    .replaceAll("\\pP", "\\p{P}");
  return new RegExp(body, "iu");
}

/**
 * How deep regex-syntax nests a pattern's syntax tree. Discord parses an
 * AutoMod regex with a nest limit of 10 and refuses anything deeper
 * ("exceed the maximum number of nested parentheses/brackets (10)"). A
 * level per group, repetition, bracketed class, and alternation or
 * concatenation of two or more items; one more for a class of two or more
 * items. Covers the syntax the pattern uses.
 */
function nestDepth(pattern: string): number {
  const chars = [...pattern];
  const QUANTIFIERS = new Set(["*", "+", "?", "{"]);
  let i = 0;
  const levelOver = (depths: number[]) =>
    depths.length > 1 ? 1 + Math.max(...depths) : (depths[0] ?? 0);

  function escape(): void {
    i++; // the backslash
    const kind = chars[i++];
    if ((kind === "p" || kind === "x" || kind === "u") && chars[i] === "{") {
      while (i < chars.length && chars[i] !== "}") i++;
      i++;
    } else if (kind === "p") {
      i++; // \pP: one-letter class
    }
  }

  function bracketedClass(): number {
    i++; // [
    if (chars[i] === "^") i++;
    let items = 0;
    let first = true;
    while (i < chars.length && (chars[i] !== "]" || first)) {
      first = false;
      if (chars[i] === "\\") escape();
      else i++;
      if (chars[i] === "-" && chars[i + 1] !== "]") {
        i++; // a range is one item
        if (chars[i] === "\\") escape();
        else i++;
      }
      items++;
    }
    i++; // ]
    return items > 1 ? 2 : 1;
  }

  function atom(): number {
    const c = chars[i];
    if (c === "(") {
      i++;
      if (chars[i] === "?") {
        i++;
        while (i < chars.length && chars[i] !== ":" && chars[i] !== ")") i++;
        if (chars[i] === ")") {
          i++;
          return 0; // (?i): flags, not a group
        }
        i++; // :
      }
      const inner = alternation();
      i++; // )
      return 1 + inner;
    }
    if (c === "[") return bracketedClass();
    if (c === "\\") {
      escape();
      return 0;
    }
    i++;
    return 0;
  }

  function concatenation(): number {
    const items: number[] = [];
    while (i < chars.length && chars[i] !== "|" && chars[i] !== ")") {
      let depth = atom();
      while (QUANTIFIERS.has(chars[i])) {
        if (chars[i] === "{") while (i < chars.length && chars[i] !== "}") i++;
        i++;
        if (chars[i] === "?") i++; // lazy
        depth += 1;
      }
      items.push(depth);
    }
    return levelOver(items);
  }

  function alternation(): number {
    const branches = [concatenation()];
    while (chars[i] === "|") {
      i++;
      branches.push(concatenation());
    }
    return levelOver(branches);
  }

  return alternation();
}

describe("LAUGH_ONLY_AUTOMOD_PATTERN", () => {
  const regex = asJavaScript(LAUGH_ONLY_AUTOMOD_PATTERN);

  it.each([...LAUGHS, ...MIXED_LAUGHS])(
    "flags a laugh-only message: %j",
    (content) => {
      expect(regex.test(content)).toBe(true);
      expect(isLaughOnlyMessage(content)).toBe(true);
    },
  );

  it.each(NOT_LAUGHS)("lets anything else through: %j", (content) => {
    expect(regex.test(content)).toBe(false);
    expect(isLaughOnlyMessage(content)).toBe(false);
  });

  it("differs from isLaughOnlyMessage only where the flat pattern must", () => {
    // Tokens may run together: no room for a separator between them.
    expect(regex.test("lolhaha")).toBe(true);
    expect(isLaughOnlyMessage("lolhaha")).toBe(false);
    // A custom emote counts only when its name laughs.
    expect(regex.test("<:hehe:1>")).toBe(false);
    expect(isLaughOnlyMessage("<:hehe:1>")).toBe(true);
  });

  it("fits Discord's limits: 260 characters, nesting 10 deep", () => {
    expect([...LAUGH_ONLY_AUTOMOD_PATTERN].length).toBeLessThanOrEqual(260);
    expect(nestDepth(LAUGH_ONLY_AUTOMOD_PATTERN)).toBeLessThanOrEqual(10);
  });

  it("counts nesting the way regex-syntax does", () => {
    expect(nestDepth("a")).toBe(0);
    expect(nestDepth("ab")).toBe(1);
    expect(nestDepth("[a]")).toBe(1);
    expect(nestDepth("[ab]")).toBe(2);
    expect(nestDepth("(?:a|b)+")).toBe(3);
    // Discord refused this earlier draft on 2026-10-14; regex-syntax puts it at 13.
    expect(
      nestDepth(
        "(?i)\\A[\\s\\pP]*(?:(?:l+(?:o+l+)+[sz]?|a?(?:[hj][ae]+){2,}[hj]?)[\\s\\pP]*)+\\z",
      ),
    ).toBe(13);
  });
});

// ─── Keeping the rule ──────────────────────────────────────────

const BOT_ID = "lupos";
const ALL_PERMISSIONS = [
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
];

function makeRule(overrides: Record<string, unknown> = {}) {
  const rule: Record<string, unknown> = {
    id: "rule",
    name: AUTOMOD_RULE_NAME,
    creatorId: BOT_ID,
    enabled: true,
    eventType: 1,
    triggerMetadata: { regexPatterns: [LAUGH_ONLY_AUTOMOD_PATTERN] },
    actions: [
      {
        type: AutoModerationActionType.SendAlertMessage,
        metadata: { channelId: "alerts" },
      },
    ],
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  rule.edit = vi.fn().mockResolvedValue(rule);
  return rule;
}

function makeGuild({
  id = "guild",
  memberIds = [LISTED],
  permissions = ALL_PERMISSIONS,
  rules = [] as Record<string, unknown>[],
  channels = [] as Record<string, unknown>[],
} = {}) {
  const channelCache = new Collection(
    channels.map((channel) => [channel.id as string, channel]),
  );
  return {
    id,
    name: `guild ${id}`,
    roles: { everyone: { id: "everyone" } },
    members: {
      me: {
        id: BOT_ID,
        permissions: { has: (bit: bigint) => permissions.includes(bit) },
      },
      cache: new Collection(),
      fetch: vi.fn(async (userId: string) => {
        if (memberIds.includes(userId)) return { id: userId };
        throw new DiscordAPIError(
          { code: 10007, message: "Unknown Member" },
          10007,
          404,
          "GET",
          `/guilds/${id}/members/${userId}`,
          {},
        );
      }),
    },
    channels: {
      cache: channelCache,
      create: vi.fn(async (options: { name: string }) => {
        const channel = {
          id: "created",
          name: options.name,
          type: ChannelType.GuildText,
        };
        channelCache.set(channel.id, channel);
        return channel;
      }),
    },
    autoModerationRules: {
      fetch: vi.fn(
        async () =>
          new Collection(rules.map((rule) => [rule.id as string, rule])),
      ),
      create: vi.fn(async () => makeRule({ id: "created-rule" })),
    },
    client: { rest: { delete: vi.fn().mockResolvedValue(undefined) } },
  };
}

function makeClient(
  guilds: ReturnType<typeof makeGuild>[],
  { messageContent = false } = {},
) {
  return {
    options: {
      intents: {
        has: (bit: number) =>
          bit === GatewayIntentBits.MessageContent ? messageContent : true,
      },
    },
    guilds: { cache: new Collection(guilds.map((guild) => [guild.id, guild])) },
  } as never;
}

const alertChannel = {
  id: "alerts",
  name: ALERT_CHANNEL_NAME,
  type: ChannelType.GuildText,
};

describe("reconcileLaughOnlyAutoMod", () => {
  it("makes a hidden alert channel and the rule where a listed member is", async () => {
    const guild = makeGuild({ id: "fresh" });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));

    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: ALERT_CHANNEL_NAME,
        type: ChannelType.GuildText,
        permissionOverwrites: expect.arrayContaining([
          { id: "everyone", deny: [PermissionFlagsBits.ViewChannel] },
        ]),
      }),
    );
    expect(guild.autoModerationRules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: AUTOMOD_RULE_NAME,
        triggerMetadata: { regexPatterns: [LAUGH_ONLY_AUTOMOD_PATTERN] },
        actions: [
          {
            type: AutoModerationActionType.SendAlertMessage,
            metadata: { channel: "created" },
          },
        ],
        enabled: true,
      }),
    );
  });

  it("puts the channel beside the moderators' AutoMod alerts, seen by the same staff", async () => {
    const staff = { id: "staff-role", allow: 1024n, deny: 0n };
    const hiddenFromEveryone = { id: "everyone", allow: 0n, deny: 1024n };
    const automodLog = {
      id: "automod-log",
      name: "automod-log",
      type: ChannelType.GuildText,
      parentId: "administration",
      isThread: () => false,
      permissionOverwrites: {
        cache: new Collection([
          [staff.id, staff],
          [hiddenFromEveryone.id, hiddenFromEveryone],
        ]),
      },
    };
    const moderatorRule = makeRule({
      id: "flagged-words",
      name: "Custom Flagged Words",
      creatorId: "a-moderator",
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: { channelId: null },
        },
        {
          type: AutoModerationActionType.SendAlertMessage,
          metadata: { channelId: "automod-log" },
        },
      ],
    });
    const guild = makeGuild({
      id: "staffed",
      rules: [moderatorRule],
      channels: [automodLog],
    });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));

    const options = guild.channels.create.mock.calls[0][0] as unknown as {
      parent: string;
      permissionOverwrites: unknown[];
    };
    expect(options.parent).toBe("administration");
    expect(options.permissionOverwrites).toEqual([
      staff,
      { id: "everyone", deny: [PermissionFlagsBits.ViewChannel] },
      expect.objectContaining({ id: BOT_ID }),
    ]);
    expect(moderatorRule.edit).not.toHaveBeenCalled();
    expect(moderatorRule.delete).not.toHaveBeenCalled();
  });

  it("keeps a rule that is up to date as it is", async () => {
    const rule = makeRule({ id: "current" });
    const guild = makeGuild({
      id: "current",
      rules: [rule],
      channels: [alertChannel],
    });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));

    expect(rule.edit).not.toHaveBeenCalled();
    expect(guild.autoModerationRules.create).not.toHaveBeenCalled();
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it("updates a drifted pattern and leaves a disabled rule disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rule = makeRule({
      id: "stale",
      enabled: false,
      triggerMetadata: { regexPatterns: ["(?i)\\Alol\\z"] },
    });
    const guild = makeGuild({
      id: "stale",
      rules: [rule],
      channels: [alertChannel],
    });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));

    expect(rule.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerMetadata: { regexPatterns: [LAUGH_ONLY_AUTOMOD_PATTERN] },
      }),
    );
    expect(
      (rule.edit as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).not.toHaveProperty("enabled");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    warn.mockRestore();
  });

  it("removes the rule from a guild with no listed member", async () => {
    const rule = makeRule({ id: "nobody-listed" });
    const guild = makeGuild({
      id: "nobody",
      memberIds: [],
      rules: [rule],
      channels: [alertChannel],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await reconcileLaughOnlyAutoMod(makeClient([guild]));
    log.mockRestore();

    expect(rule.delete).toHaveBeenCalledTimes(1);
    expect(guild.autoModerationRules.create).not.toHaveBeenCalled();
  });

  it("keeps the rule when Discord fails to answer the member lookup", async () => {
    const rule = makeRule({ id: "hiccup" });
    const guild = makeGuild({
      id: "hiccup",
      rules: [rule],
      channels: [alertChannel],
    });
    guild.members.fetch.mockRejectedValueOnce(
      new Error("503 Service Unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reconcileLaughOnlyAutoMod(makeClient([guild]));

    expect(rule.delete).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("503"));
    warn.mockRestore();
  });

  it("removes the rule everywhere once Lupos reads message content again", async () => {
    const rule = makeRule({ id: "content-back" });
    const guild = makeGuild({
      id: "content-back",
      rules: [rule],
      channels: [alertChannel],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await reconcileLaughOnlyAutoMod(
      makeClient([guild], { messageContent: true }),
    );
    log.mockRestore();

    expect(rule.delete).toHaveBeenCalledTimes(1);
  });

  it("leaves Grobbulus out, as processMessage does", async () => {
    const guild = makeGuild({ id: "grobbulus" });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));
    expect(guild.autoModerationRules.create).not.toHaveBeenCalled();
  });

  it("does nothing where Lupos cannot manage the server", async () => {
    const guild = makeGuild({ id: "no-perms", permissions: [] });
    await reconcileLaughOnlyAutoMod(makeClient([guild]));
    expect(guild.autoModerationRules.fetch).not.toHaveBeenCalled();
  });
});

// ─── Acting on a verdict ───────────────────────────────────────

/** A guild whose rule "kept" is Lupos's, registered by a reconcile. */
async function guildWithRule() {
  const guild = makeGuild({
    id: `verdicts-${Math.random()}`,
    rules: [makeRule({ id: "kept" })],
    channels: [alertChannel],
  });
  await reconcileLaughOnlyAutoMod(makeClient([guild]));
  return guild;
}

function makeExecution(
  guild: ReturnType<typeof makeGuild>,
  { userId = LISTED, ruleId = "kept", stickers = 0, fetchFails = false } = {},
) {
  const message = {
    author: { id: userId, tag: "deuxv" },
    stickers: { size: stickers },
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const channel = {
    name: "politics",
    isTextBased: () => true,
    messages: {
      fetch: fetchFails
        ? vi.fn().mockRejectedValue(new Error("Unknown Message"))
        : vi.fn().mockResolvedValue(message),
    },
  };
  return {
    message,
    channel,
    execution: {
      guild,
      ruleId,
      userId,
      channelId: "politics",
      messageId: "laugh",
      alertSystemMessageId: "alert",
      channel,
      action: {
        type: AutoModerationActionType.SendAlertMessage,
        metadata: { channelId: "alerts" },
      },
    } as never,
  };
}

describe("luposOnAutoModerationActionExecution", () => {
  it("deletes a listed member's flagged laugh and keeps its alert as the record", async () => {
    const guild = await guildWithRule();
    const { execution, message } = makeExecution(guild);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await luposOnAutoModerationActionExecution({} as never, execution);
    log.mockRestore();

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.client.rest.delete).not.toHaveBeenCalled();
  });

  it("clears the alert of anyone else's laugh and deletes nothing", async () => {
    const guild = await guildWithRule();
    const { execution, channel } = makeExecution(guild, {
      userId: "someone-else",
    });
    await luposOnAutoModerationActionExecution({} as never, execution);

    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(guild.client.rest.delete).toHaveBeenCalledWith(
      Routes.channelMessage("alerts", "alert"),
    );
  });

  it("keeps a laugh with a sticker, as LaughOnlyMessages does", async () => {
    const guild = await guildWithRule();
    const { execution, message } = makeExecution(guild, { stickers: 1 });
    await luposOnAutoModerationActionExecution({} as never, execution);

    expect(message.delete).not.toHaveBeenCalled();
    expect(guild.client.rest.delete).toHaveBeenCalledTimes(1);
  });

  it("clears the alert when the message is already gone", async () => {
    const guild = await guildWithRule();
    const { execution } = makeExecution(guild, { fetchFails: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await luposOnAutoModerationActionExecution({} as never, execution);
    log.mockRestore();

    expect(guild.client.rest.delete).toHaveBeenCalledTimes(1);
  });

  it("ignores the verdicts of the moderators' own rules", async () => {
    const guild = await guildWithRule();
    const { execution, message } = makeExecution(guild, {
      ruleId: "flagged-words",
    });
    await luposOnAutoModerationActionExecution({} as never, execution);

    expect(message.delete).not.toHaveBeenCalled();
    expect(guild.client.rest.delete).not.toHaveBeenCalled();
  });
});
