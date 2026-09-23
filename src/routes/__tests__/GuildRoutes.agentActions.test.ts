// ============================================================
// GuildRoutes.agentActions.test.ts — the HTTP adapters, end to end
// ============================================================
// The real GuildRoutes router on a real Express app, called over HTTP:
// status codes and bodies are what tools-service will see. Discord is
// mocked discord.js objects, Mongo an in-memory fake; the gold logic is
// mocked here (luposAgentGold.test.ts covers it).
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakeDb } from "#root/services/__tests__/support/fakeMongo.ts";
import {
  CHANNEL_ID,
  FOREIGN_CHANNEL_ID,
  GUILD_ID,
  MEMBER_FLAGS,
  MESSAGE_ID,
  OTHER_GUILD_ID,
  REQUESTER_ID,
  STRANGER_ID,
  conversationBody,
  makeChannel,
  makeClient,
  makeGuild,
  makeScene,
} from "#root/services/__tests__/support/fakeDiscord.ts";

const fakeDb = createFakeDb();
let currentClient: unknown = null;

vi.mock("../../wrappers/DiscordWrapper.ts", () => ({
  default: { getClient: () => currentClient },
}));
vi.mock("../../config.ts", () => ({
  default: { GUILD_ID_CLOCK_CREW: "100000000000000001", GUILD_ID_PRIMARY: "100000000000000001" },
}));
vi.mock("../../services/MongoService.ts", () => ({
  default: { getDb: () => fakeDb, getClient: () => undefined },
}));
vi.mock("../../services/DmCampaignService.ts", () => ({ default: {} }));
vi.mock("../../services/PrismService.ts", () => ({ default: {} }));
vi.mock("../../commands/utility/commandUtils.ts", () => ({
  getMongoDb: () => fakeDb,
  getServerAgeYears: vi.fn(),
  computeStartDate: vi.fn(),
  formatTimePeriod: vi.fn(),
}));
const luposGiveGold = vi.fn();
const luposMugGold = vi.fn();
vi.mock("../../commands/utility/gold/luposAgentGold.ts", () => ({
  luposGetGoldBalance: vi.fn(),
  luposGiveGold,
  luposMugGold,
}));

const { default: guildRoutes } = await import("#root/routes/GuildRoutes.ts");
const { resetActionCooldowns } = await import("#root/services/DiscordActionService.ts");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", guildRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  fakeDb.reset();
  resetActionCooldowns();
  luposGiveGold.mockReset();
  luposMugGold.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Installs a scene's client as the bot's (always "ready"). */
function useScene(scene: { client: object }) {
  currentClient = { ...scene.client, isReady: () => true };
  return scene;
}

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("GET /guild/visible-channels", () => {
  it("returns the member's readable channels and threads", async () => {
    useScene(makeScene());
    const result = await call(
      "GET",
      `/guild/visible-channels?guildId=${GUILD_ID}&userId=${REQUESTER_ID}`,
    );
    expect(result).toEqual({
      status: 200,
      body: { guildId: GUILD_ID, userId: REQUESTER_ID, channelIds: [CHANNEL_ID], threadIds: [] },
    });
  });

  it("without userId answers for @everyone (userId: null)", async () => {
    useScene(makeScene());
    const result = await call("GET", `/guild/visible-channels?guildId=${GUILD_ID}`);
    expect(result.status).toBe(200);
    // The scene grants nothing to @everyone.
    expect(result.body).toEqual({ guildId: GUILD_ID, userId: null, channelIds: [], threadIds: [] });
  });

  it("404s an unknown guild or member, 400s malformed ids", async () => {
    useScene(makeScene());
    expect((await call("GET", `/guild/visible-channels?guildId=${OTHER_GUILD_ID}`)).status).toBe(404);
    const stranger = await call(
      "GET",
      `/guild/visible-channels?guildId=${GUILD_ID}&userId=${STRANGER_ID}`,
    );
    expect(stranger.status).toBe(404);
    expect(stranger.body.error).toEqual(expect.any(String));
    expect((await call("GET", "/guild/visible-channels?guildId=abc")).status).toBe(400);
    expect((await call("GET", `/guild/visible-channels?guildId=${GUILD_ID}&userId=me`)).status).toBe(400);
  });
});

describe("POST /guild/react", () => {
  function reactScene() {
    const scene = makeScene();
    const message = {
      id: MESSAGE_ID,
      reactions: { cache: { find: () => undefined } },
      react: vi.fn(async () => undefined),
    };
    scene.channel.messages.fetch.mockResolvedValue(message as never);
    const foreignChannel = makeChannel({
      id: FOREIGN_CHANNEL_ID,
      guildId: OTHER_GUILD_ID,
      grants: { [REQUESTER_ID]: MEMBER_FLAGS },
    });
    const otherGuild = makeGuild({ id: OTHER_GUILD_ID, channels: [foreignChannel] });
    useScene({ client: makeClient([scene.guild, otherGuild]) });
    return { ...scene, message };
  }

  it("refuses a channel outside scopeGuildId with 403 { ok:false, error } — and spends no cooldown", async () => {
    const { message } = reactScene();
    const refused = await call("POST", "/guild/react", {
      channelId: FOREIGN_CHANNEL_ID,
      messageId: MESSAGE_ID,
      emoji: "👍",
      scopeGuildId: GUILD_ID,
      requesterUserId: REQUESTER_ID,
    });
    expect(refused).toEqual({
      status: 403,
      body: { ok: false, error: "Lupos can only reach into the server this conversation is in." },
    });

    const allowed = await call("POST", "/guild/react", {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      emoji: "👍",
      scopeGuildId: GUILD_ID,
      requesterUserId: REQUESTER_ID,
    });
    expect(allowed).toEqual({ status: 200, body: { success: true } });
    expect(message.react).toHaveBeenCalledWith("👍");
  });
});

describe("POST /gold/give, /gold/mug", () => {
  it("maps a spent requester allowance to 429 { ok:false, error }", async () => {
    useScene(makeScene());
    luposGiveGold.mockResolvedValue({
      ok: false,
      reason: "requester_cap",
      summary: "You've already had Lupos move gold 5 times today",
    });
    const result = await call("POST", "/gold/give", {
      guildId: GUILD_ID,
      targetUserId: STRANGER_ID,
      amount: 3,
      requesterUserId: REQUESTER_ID,
      scopeGuildId: GUILD_ID,
    });
    expect(result).toEqual({
      status: 429,
      body: { ok: false, error: "You've already had Lupos move gold 5 times today" },
    });
    expect(luposGiveGold).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      STRANGER_ID,
      3,
      undefined,
      REQUESTER_ID,
    );
  });

  it("passes other results through unchanged (200)", async () => {
    useScene(makeScene());
    const mugged = { ok: true, outcome: "hoarded", amount: 2, summary: "Mugged 2g" };
    luposMugGold.mockResolvedValue(mugged);
    const result = await call("POST", "/gold/mug", {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      targetUserId: STRANGER_ID,
      requesterUserId: REQUESTER_ID,
    });
    expect(result).toEqual({ status: 200, body: mugged });

    luposGiveGold.mockResolvedValue({ ok: false, reason: "daily_cap", summary: "Already gifted" });
    const capped = await call("POST", "/gold/give", { guildId: GUILD_ID, targetUserId: STRANGER_ID });
    expect(capped.status).toBe(200);
  });

  it("refuses a guildId outside scopeGuildId (403) and a malformed requester (400)", async () => {
    useScene(makeScene());
    const outOfScope = await call("POST", "/gold/mug", {
      guildId: OTHER_GUILD_ID,
      targetUserId: STRANGER_ID,
      scopeGuildId: GUILD_ID,
    });
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.body.ok).toBe(false);
    const malformed = await call("POST", "/gold/give", {
      guildId: GUILD_ID,
      targetUserId: STRANGER_ID,
      requesterUserId: "someone",
    });
    expect(malformed.status).toBe(400);
    expect(luposGiveGold).not.toHaveBeenCalled();
    expect(luposMugGold).not.toHaveBeenCalled();
  });
});

describe("agent action routes", () => {
  it("POST /guild/poll → 200 { ok, messageId, url }", async () => {
    useScene(makeScene());
    const result = await call(
      "POST",
      "/guild/poll",
      conversationBody({ question: "Raid tonight?", answers: ["Yes", "No"] }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      messageId: "600000000000000001",
      url: expect.stringContaining(CHANNEL_ID),
    });
  });

  it("POST /guild/poll outside the conversation's guild → 403 { ok:false, error }", async () => {
    useScene(makeScene());
    const result = await call(
      "POST",
      "/guild/poll",
      conversationBody({ guildId: OTHER_GUILD_ID, question: "q", answers: ["a", "b"] }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ ok: false, error: expect.stringContaining("server this conversation") });
  });

  it("POST /guild/thread → 200 { ok, threadId, url }", async () => {
    useScene(makeScene());
    const result = await call("POST", "/guild/thread", conversationBody({ name: "Loot talk" }));
    expect(result).toEqual({
      status: 200,
      body: { ok: true, threadId: "500000000000000002", url: expect.any(String) },
    });
  });

  it("POST /guild/nickname → 200 { ok, nickname }; again within 10 min → 429", async () => {
    useScene(makeScene());
    expect(await call("POST", "/guild/nickname", conversationBody({ nickname: "Lupin" }))).toEqual({
      status: 200,
      body: { ok: true, nickname: "Lupin" },
    });
    const again = await call("POST", "/guild/nickname", conversationBody({ nickname: "Lupo" }));
    expect(again.status).toBe(429);
    expect(again.body.ok).toBe(false);
  });

  it("reminders: schedule, list, cancel", async () => {
    useScene(makeScene());
    const created = await call(
      "POST",
      "/guild/reminders",
      conversationBody({ text: "check the oven", delayMinutes: 15 }),
    );
    expect(created.status).toBe(200);
    const reminder = created.body.reminder as { id: string; channelId: string; text: string };
    expect(reminder).toMatchObject({ channelId: CHANNEL_ID, text: "check the oven" });

    const listed = await call(
      "GET",
      `/guild/reminders?guildId=${GUILD_ID}&requesterUserId=${REQUESTER_ID}`,
    );
    expect(listed).toEqual({ status: 200, body: { ok: true, reminders: [reminder] } });

    const otherPerson = await call(
      "GET",
      `/guild/reminders?guildId=${GUILD_ID}&requesterUserId=${STRANGER_ID}`,
    );
    expect(otherPerson.body).toEqual({ ok: true, reminders: [] });

    const cancelled = await call(
      "POST",
      "/guild/reminders/cancel",
      conversationBody({ reminderId: reminder.id }),
    );
    expect(cancelled).toEqual({
      status: 200,
      body: { ok: true, reminder: { ...reminder, status: "cancelled" } },
    });

    const missing = await call(
      "POST",
      "/guild/reminders/cancel",
      conversationBody({ reminderId: "nope" }),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.ok).toBe(false);
  });

  it("a bad reminder time is a 400 the model can act on", async () => {
    useScene(makeScene());
    const result = await call(
      "POST",
      "/guild/reminders",
      conversationBody({ text: "x", dueAt: "2026-09-23 10:00" }),
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/ISO 8601/);
  });
});
