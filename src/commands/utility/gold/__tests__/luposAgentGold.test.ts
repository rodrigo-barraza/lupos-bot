// ============================================================
// luposAgentGold.test.ts — the per-requester daily gold-action cap
// ============================================================
// Whoever Lupos is answering can set off at most five gold actions
// (gifts and mugs together) per UTC day per guild. The allowance lives
// in Mongo next to the per-target caps (same atomic capped upsert, a
// unique index behind it) and is refunded when an action moves no gold.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client, Guild } from "discord.js";
import { createFakeDb } from "#root/services/__tests__/support/fakeMongo.ts";

const fakeDb = createFakeDb();
vi.mock("../../commandUtils.ts", () => ({
  getMongoDb: () => fakeDb,
}));

// Wallets in memory: guildId:userId → balance.
const wallets = new Map<string, number>();
vi.mock("../goldRepository.ts", () => ({
  fetchWallet: vi.fn(async (guildId: string, userId: string) => {
    const balance = wallets.get(`${guildId}:${userId}`);
    return balance === undefined ? null : { balance };
  }),
  adjustGold: vi.fn(async (guildId: string, userId: string, amount: number) => {
    const key = `${guildId}:${userId}`;
    const balance = (wallets.get(key) ?? 0) + amount;
    if (balance < 0) return { ok: false, error: "insufficient" };
    wallets.set(key, balance);
    return { ok: true, balance };
  }),
  getGoldCollections: vi.fn(),
}));
vi.mock("../activityGold.ts", () => ({
  default: { fetchTodayActivity: vi.fn(async () => ({ totalEarned: 0 })) },
}));

const {
  LUPOS_GOLD_ACTIONS_PER_REQUESTER_PER_DAY,
  luposGiveGold,
  luposMugGold,
} = await import("#root/commands/utility/gold/luposAgentGold.ts");

const GUILD_ID = "100000000000000001";
const OTHER_GUILD_ID = "100000000000000002";
const BOT_ID = "300000000000000099";
const REQUESTER_ID = "300000000000000001";
const OTHER_REQUESTER_ID = "300000000000000002";
const BOT_TARGET_ID = "300000000000000098";

const targetId = (index: number) => `31000000000000000${index}`;

function makeGuild(id = GUILD_ID) {
  return {
    id,
    members: {
      fetch: vi.fn(async (userId: string) => ({
        displayName: `member-${userId.slice(-2)}`,
        user: { username: `user-${userId.slice(-2)}`, bot: userId === BOT_TARGET_ID },
      })),
    },
  } as unknown as Guild;
}

const client = { user: { id: BOT_ID } } as unknown as Client;

function give(guild: Guild, target: string, requester?: string) {
  return luposGiveGold(client, guild, target, 3, undefined, requester);
}

function mug(guild: Guild, target: string, requester?: string) {
  return luposMugGold(client, guild, undefined, target, 2, undefined, requester);
}

function requesterDoc(guildId = GUILD_ID, requesterId = REQUESTER_ID) {
  return fakeDb
    .collection("LuposGoldRequesterDailyActions")
    .documents.find(
      (doc) => doc.guildId === guildId && doc.requesterId === requesterId,
    );
}

beforeEach(() => {
  fakeDb.reset();
  wallets.clear();
  vi.useFakeTimers({ now: new Date("2026-09-22T12:00:00Z"), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("per-requester gold-action cap", () => {
  it("is five per day, gifts and mugs combined", async () => {
    expect(LUPOS_GOLD_ACTIONS_PER_REQUESTER_PER_DAY).toBe(5);
    const guild = makeGuild();
    for (let index = 0; index < 3; index++) {
      expect((await give(guild, targetId(index), REQUESTER_ID)).ok).toBe(true);
    }
    for (let index = 3; index < 5; index++) {
      wallets.set(`${GUILD_ID}:${targetId(index)}`, 10);
      expect((await mug(guild, targetId(index), REQUESTER_ID)).ok).toBe(true);
    }

    const sixth = await give(guild, targetId(6), REQUESTER_ID);
    expect(sixth).toMatchObject({ ok: false, reason: "requester_cap" });
    expect(sixth.summary).toMatch(/5 times today/);
    wallets.set(`${GUILD_ID}:${targetId(7)}`, 10);
    expect(await mug(guild, targetId(7), REQUESTER_ID)).toMatchObject({
      reason: "requester_cap",
    });
    expect(requesterDoc()?.actions).toBe(5);
  });

  it("is per requester and per guild", async () => {
    const guild = makeGuild();
    for (let index = 0; index < 5; index++) {
      await give(guild, targetId(index), REQUESTER_ID);
    }
    expect((await give(guild, targetId(5), REQUESTER_ID)).ok).toBe(false);
    expect((await give(guild, targetId(5), OTHER_REQUESTER_ID)).ok).toBe(true);
    expect((await give(makeGuild(OTHER_GUILD_ID), targetId(5), REQUESTER_ID)).ok).toBe(true);
  });

  it("refunds actions that moved no gold", async () => {
    const guild = makeGuild();
    // A broke victim, a bot target, and a target already gifted today:
    // none of them count.
    expect(await mug(guild, targetId(1), REQUESTER_ID)).toMatchObject({ reason: "broke" });
    expect(await give(guild, BOT_TARGET_ID, REQUESTER_ID)).toMatchObject({
      reason: "target_is_bot",
    });
    expect((await give(guild, targetId(2), REQUESTER_ID)).ok).toBe(true);
    expect(await give(guild, targetId(2), REQUESTER_ID)).toMatchObject({
      reason: "daily_cap",
    });
    expect(requesterDoc()?.actions).toBe(1);

    for (let index = 3; index < 7; index++) {
      expect((await give(guild, targetId(index), REQUESTER_ID)).ok).toBe(true);
    }
    expect((await give(guild, targetId(8), REQUESTER_ID)).ok).toBe(false);
  });

  it("resets on the next UTC day", async () => {
    const guild = makeGuild();
    for (let index = 0; index < 5; index++) {
      await give(guild, targetId(index), REQUESTER_ID);
    }
    expect((await give(guild, targetId(5), REQUESTER_ID)).ok).toBe(false);
    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await give(guild, targetId(5), REQUESTER_ID)).ok).toBe(true);
  });

  it("does not apply without a requester (callers outside a Discord conversation)", async () => {
    const guild = makeGuild();
    for (let index = 0; index < 7; index++) {
      expect((await give(guild, targetId(index))).ok).toBe(true);
    }
    expect(fakeDb.collection("LuposGoldRequesterDailyActions").documents).toHaveLength(0);
  });

  it("keeps the existing per-target caps", async () => {
    const guild = makeGuild();
    wallets.set(`${GUILD_ID}:${targetId(1)}`, 100);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await mug(guild, targetId(1), REQUESTER_ID)).ok).toBe(true);
    }
    expect(await mug(guild, targetId(1), REQUESTER_ID)).toMatchObject({ reason: "daily_cap" });
    expect(requesterDoc()?.actions).toBe(3);
  });
});
