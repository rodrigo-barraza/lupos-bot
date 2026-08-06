// ============================================================
// AccountGuardService — kick-gate tests
// ============================================================
// These guard irreversible actions, so the boundaries are pinned
// explicitly. The load-bearing one is the separation between
// ACCOUNT_AGE_THRESHOLD_MS (blanket new-account kick, 4 weeks) and
// FORBIDDEN_COMBO_MAX_ACCOUNT_AGE_MS (combo rule, 5 years) — sharing
// one constant would make kickIfTooNew empty the server.
// ============================================================

import { Collection } from "discord.js";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("#root/config.ts", () => ({ default: {} }));

const whitelist: string[] = [];
vi.mock("#root/services/BotSettingsService.ts", () => ({
  default: { get: () => whitelist },
}));

const {
  kickIfTooNew,
  kickIfForbiddenCombo,
  sweepForbiddenComboJoiners,
  FORBIDDEN_COMBO_ROLE_IDS,
} = await import("../AccountGuardService.ts");

const [HORDE_ID, APEX_ID] = FORBIDDEN_COMBO_ROLE_IDS;
const GUILD_ID = "609471635308937237";
const DAY = 24 * 60 * 60 * 1000;

let memberCounter = 0;

/**
 * Build a GuildMember stand-in. `roleIds` excludes @everyone — it is added
 * here because Discord always includes it and its id equals the guild id.
 */
function makeMember({
  roleIds = [] as string[],
  accountAgeDays = 30,
  joinedDaysAgo = 1,
  bot = false,
  joinedTimestamp = undefined as number | undefined,
}) {
  const id = `member-${++memberCounter}`;
  const roleEntries: [string, { id: string; name: string }][] = [
    [GUILD_ID, { id: GUILD_ID, name: "@everyone" }],
    ...roleIds.map(
      (roleId: string) =>
        [roleId, { id: roleId, name: `role-${roleId}` }] as [
          string,
          { id: string; name: string },
        ],
    ),
  ];

  return {
    id,
    user: {
      bot,
      username: `user-${id}`,
      createdAt: new Date(Date.now() - accountAgeDays * DAY),
    },
    joinedTimestamp:
      joinedTimestamp === undefined
        ? Date.now() - joinedDaysAgo * DAY
        : joinedTimestamp,
    guild: {
      id: GUILD_ID,
      name: "Whitemane",
      roles: { cache: new Collection() },
    },
    roles: { cache: new Collection(roleEntries) },
    kick: vi.fn().mockResolvedValue(undefined),
  };
}

function makeGuild(members: ReturnType<typeof makeMember>[]) {
  return {
    id: GUILD_ID,
    name: "Whitemane",
    roles: { cache: new Collection() },
    members: {
      fetch: vi
        .fn()
        .mockResolvedValue(new Collection(members.map((m) => [m.id, m]))),
    },
  };
}

beforeEach(() => {
  whitelist.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("kickIfForbiddenCombo — account-age gate is 5 years", () => {
  test("kicks a 3-year-old account holding both roles", async () => {
    const member = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      accountAgeDays: 3 * 365,
      joinedDaysAgo: 2,
    });

    expect(await kickIfForbiddenCombo(member as any)).toBe(true);
    expect(member.kick).toHaveBeenCalledTimes(1);
  });

  test("spares an account older than 5 years", async () => {
    const member = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      accountAgeDays: 6 * 365,
      joinedDaysAgo: 2,
    });

    expect(await kickIfForbiddenCombo(member as any)).toBe(false);
    expect(member.kick).not.toHaveBeenCalled();
  });

  test("still spares members who joined more than 4 weeks ago", async () => {
    const member = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      accountAgeDays: 3 * 365,
      joinedDaysAgo: 40,
    });

    expect(await kickIfForbiddenCombo(member as any)).toBe(false);
  });

  test("spares a member holding only one of the two roles", async () => {
    const member = makeMember({ roleIds: [HORDE_ID], accountAgeDays: 10 });

    expect(await kickIfForbiddenCombo(member as any)).toBe(false);
  });
});

describe("kickIfTooNew — unaffected by the combo widening", () => {
  test("does NOT kick a 2-month-old account", async () => {
    const member = makeMember({ accountAgeDays: 60 });

    expect(await kickIfTooNew(member as any)).toBe(false);
    expect(member.kick).not.toHaveBeenCalled();
  });

  test("still kicks an account younger than 4 weeks", async () => {
    const member = makeMember({ accountAgeDays: 3 });

    expect(await kickIfTooNew(member as any)).toBe(true);
  });
});

describe("sweepForbiddenComboJoiners", () => {
  test("dry run reports without kicking", async () => {
    const target = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      accountAgeDays: 8 * 365,
      joinedDaysAgo: 90,
    });
    const guild = makeGuild([target]);

    const result = await sweepForbiddenComboJoiners(guild as any);

    expect(result.kicked).toBe(1);
    expect(target.kick).not.toHaveBeenCalled();
  });

  test("kicks combo-only joiners regardless of account age", async () => {
    const ancient = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      accountAgeDays: 9 * 365,
      joinedDaysAgo: 100,
    });
    const guild = makeGuild([ancient]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(1);
    expect(ancient.kick).toHaveBeenCalledTimes(1);
  });

  test("@everyone does not count as an extra role", async () => {
    const member = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      joinedDaysAgo: 30,
    });
    const guild = makeGuild([member]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(1);
    expect(result.withExtraRoles).toBe(0);
  });

  test("skips members holding other roles when onlyTheseRoles is on", async () => {
    const extra = makeMember({
      roleIds: [HORDE_ID, APEX_ID, "999"],
      joinedDaysAgo: 30,
    });
    const guild = makeGuild([extra]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(0);
    expect(result.withExtraRoles).toBe(1);
    expect(extra.kick).not.toHaveBeenCalled();
  });

  test("includes them when onlyTheseRoles is off", async () => {
    const extra = makeMember({
      roleIds: [HORDE_ID, APEX_ID, "999"],
      joinedDaysAgo: 30,
    });
    const guild = makeGuild([extra]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
      onlyTheseRoles: false,
    });

    expect(result.kicked).toBe(1);
    expect(extra.kick).toHaveBeenCalledTimes(1);
  });

  test("skips members who joined outside the 6-month window", async () => {
    const old = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      joinedDaysAgo: 200,
    });
    const guild = makeGuild([old]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(0);
    expect(old.kick).not.toHaveBeenCalled();
  });

  test("skips members with an unknown join date", async () => {
    const unknown = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      joinedTimestamp: 0,
    });
    const guild = makeGuild([unknown]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(0);
    expect(unknown.kick).not.toHaveBeenCalled();
  });

  test("skips bots and whitelisted members", async () => {
    const bot = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      joinedDaysAgo: 10,
      bot: true,
    });
    const whitelisted = makeMember({
      roleIds: [HORDE_ID, APEX_ID],
      joinedDaysAgo: 10,
    });
    whitelist.push(whitelisted.id);
    const guild = makeGuild([bot, whitelisted]);

    const result = await sweepForbiddenComboJoiners(guild as any, {
      dryRun: false,
    });

    expect(result.kicked).toBe(0);
    expect(result.skipped).toBe(1);
    expect(bot.kick).not.toHaveBeenCalled();
    expect(whitelisted.kick).not.toHaveBeenCalled();
  });
});
