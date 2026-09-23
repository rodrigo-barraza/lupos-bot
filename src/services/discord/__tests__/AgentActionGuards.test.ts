// ============================================================
// AgentActionGuards.test.ts — the checks every agent action shares
// ============================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ActionError,
  CooldownWindow,
  SCOPE_ERROR,
  assertBotCan,
  assertClean,
  assertRequesterCan,
  assertScope,
  mapDiscordError,
  readSnowflake,
  readText,
  resolveActionContext,
  runAgentAction,
  withCooldown,
} from "#root/services/discord/AgentActionGuards.ts";
import {
  BOT_ID,
  CHANNEL_ID,
  GUILD_ID,
  OTHER_GUILD_ID,
  REQUESTER_ID,
  SendMessages,
  SendMessagesInThreads,
  SendPolls,
  STRANGER_ID,
  ViewChannel,
  asClient,
  asMember,
  conversationBody,
  makeChannel,
  makeMember,
  makeScene,
} from "#root/services/__tests__/support/fakeDiscord.ts";
import { ChannelType } from "discord.js";
import type { GuildTextBasedChannel } from "discord.js";

const asChannel = (channel: unknown) => channel as GuildTextBasedChannel;

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ActionError) return error.status;
    throw error;
  }
  return 200;
}

function statusOfSync(run: () => unknown): number {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof ActionError) return error.status;
    throw error;
  }
  return 200;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("input readers", () => {
  it("accepts snowflakes and refuses anything else with a 400", () => {
    expect(readSnowflake(GUILD_ID, "guildId")).toBe(GUILD_ID);
    expect(statusOfSync(() => readSnowflake(undefined, "guildId"))).toBe(400);
    expect(statusOfSync(() => readSnowflake("general", "guildId"))).toBe(400);
    expect(statusOfSync(() => readSnowflake(123, "guildId"))).toBe(400);
  });

  it("trims text and enforces the length limit", () => {
    expect(readText("  hello  ", "text", 5)).toBe("hello");
    expect(statusOfSync(() => readText("   ", "text", 5))).toBe(400);
    expect(statusOfSync(() => readText("toolong", "text", 5))).toBe(400);
    expect(() => readText("toolong", "text", 5)).toThrow(/limit is 5/);
  });
});

describe("assertScope", () => {
  it("passes without a scope, or with the same guild", () => {
    expect(() => assertScope(GUILD_ID, undefined)).not.toThrow();
    expect(() => assertScope(GUILD_ID, "")).not.toThrow();
    expect(() => assertScope(GUILD_ID, GUILD_ID)).not.toThrow();
  });

  it("refuses a guild other than the conversation's with the contract's 403", () => {
    expect(() => assertScope(OTHER_GUILD_ID, GUILD_ID)).toThrow(SCOPE_ERROR);
    expect(statusOfSync(() => assertScope(OTHER_GUILD_ID, GUILD_ID))).toBe(403);
  });
});

describe("resolveActionContext", () => {
  it("resolves the conversation's guild, channel and requester", async () => {
    const { client, channel, requester } = makeScene();
    const context = await resolveActionContext(asClient(client), conversationBody());
    expect(context.channel).toBe(channel);
    expect(context.requester).toBe(requester);
  });

  it("defaults guildId to scopeGuildId", async () => {
    const { client } = makeScene();
    const body = conversationBody({ guildId: undefined });
    await expect(resolveActionContext(asClient(client), body)).resolves.toBeDefined();
  });

  it("refuses a guildId outside scopeGuildId before touching Discord", async () => {
    const { client } = makeScene();
    const body = conversationBody({ guildId: OTHER_GUILD_ID });
    expect(await statusOf(resolveActionContext(asClient(client), body))).toBe(403);
  });

  it("requires the conversation context (channel and requester)", async () => {
    const { client } = makeScene();
    for (const missing of ["channelId", "requesterUserId"]) {
      const body = conversationBody({ [missing]: undefined });
      expect(await statusOf(resolveActionContext(asClient(client), body))).toBe(400);
    }
  });

  it("404s an unknown guild or a channel of another guild", async () => {
    const { client } = makeScene();
    expect(
      await statusOf(
        resolveActionContext(
          asClient(client),
          conversationBody({ guildId: OTHER_GUILD_ID, scopeGuildId: OTHER_GUILD_ID }),
        ),
      ),
    ).toBe(404);
    expect(
      await statusOf(
        resolveActionContext(
          asClient(client),
          conversationBody({ channelId: "299999999999999999" }),
        ),
      ),
    ).toBe(404);
  });

  it("refuses non-members and timed-out members with a 403", async () => {
    const { client } = makeScene();
    const stranger = conversationBody({ requesterUserId: STRANGER_ID });
    expect(await statusOf(resolveActionContext(asClient(client), stranger))).toBe(403);

    const timedOut = makeScene({ requester: { timedOut: true } });
    await expect(
      resolveActionContext(asClient(timedOut.client), conversationBody()),
    ).rejects.toThrow(/timed out/);
  });
});

describe("permission checks", () => {
  it("requires view + send + the action's own permission from the requester", () => {
    const channel = makeChannel({ grants: { [REQUESTER_ID]: [ViewChannel, SendMessages] } });
    const requester = makeMember();
    expect(() =>
      assertRequesterCan(asChannel(channel), asMember(requester), [], "post"),
    ).not.toThrow();
    expect(() =>
      assertRequesterCan(asChannel(channel), asMember(requester), [SendPolls], "create polls"),
    ).toThrow(/create polls in #general \(missing: Send Polls\)/);
  });

  it("uses Send Messages in Threads inside a thread", () => {
    const parent = makeChannel({
      grants: { [REQUESTER_ID]: [ViewChannel, SendMessages] },
    });
    const thread = makeChannel({
      id: "200000000000000077",
      type: ChannelType.PublicThread,
      parent,
    });
    expect(() =>
      assertRequesterCan(asChannel(thread), asMember(makeMember()), [], "post"),
    ).toThrow(/Send Messages In Threads/);
    parent.grants[REQUESTER_ID].push(SendMessagesInThreads);
    expect(() =>
      assertRequesterCan(asChannel(thread), asMember(makeMember()), [], "post"),
    ).not.toThrow();
  });

  it("names what Lupos himself is missing", () => {
    const channel = makeChannel({ grants: { [BOT_ID]: [ViewChannel] } });
    const bot = makeMember({ id: BOT_ID });
    expect(() =>
      assertBotCan(asChannel(channel), asMember(bot), [ViewChannel, SendMessages], "post"),
    ).toThrow(/Lupos doesn't have permission to post in #general \(missing: Send Messages\)/);
  });
});

describe("assertClean", () => {
  it("passes ordinary text and refuses slurs (including evasions) with a 400", () => {
    expect(() => assertClean(["pizza night?", "japanese food"])).not.toThrow();
    expect(() => assertClean(["fine", "f4gg0t"])).toThrow(ActionError);
    expect(statusOfSync(() => assertClean(["kys"]))).toBe(400);
  });
});

describe("CooldownWindow", () => {
  it("allows one claim per key per window and reports the wait", () => {
    const window = new CooldownWindow(10_000);
    expect(window.tryClaim("a", 1_000)).toBe(1_000);
    expect(window.tryClaim("a", 5_000)).toBeNull();
    expect(window.remainingMs("a", 5_000)).toBe(6_000);
    expect(window.tryClaim("b", 5_000)).toBe(5_000);
    expect(window.tryClaim("a", 11_000)).toBe(11_000);
  });

  it("release hands a failed action's claim back", () => {
    const window = new CooldownWindow(10_000);
    const claimedAt = window.tryClaim("a", 1_000)!;
    window.release("a", claimedAt);
    expect(window.tryClaim("a", 2_000)).toBe(2_000);
    window.release("a", claimedAt); // a stale token releases nothing
    expect(window.tryClaim("a", 3_000)).toBeNull();
  });

  it("withCooldown 429s while cooling down and releases when the action throws", async () => {
    const window = new CooldownWindow(60_000);
    await expect(
      withCooldown(window, "k", () => "busy", async () => {
        throw new Error("discord down");
      }),
    ).rejects.toThrow("discord down");
    await expect(withCooldown(window, "k", () => "busy", async () => "done")).resolves.toBe("done");
    const refusal = withCooldown(window, "k", (wait) => `busy for ${wait}`, async () => "again");
    await expect(refusal).rejects.toMatchObject({ status: 429, message: "busy for about a minute" });
  });
});

describe("error mapping", () => {
  it("maps Discord API errors to 4xx the model can relay", () => {
    const discord = (code: number, status: number, message = "x") =>
      Object.assign(new Error(message), { code, status });
    expect(mapDiscordError(discord(50013, 403))?.status).toBe(403);
    expect(mapDiscordError(discord(10008, 404))?.status).toBe(404);
    expect(mapDiscordError(discord(160004, 400))?.status).toBe(409);
    expect(mapDiscordError(discord(50035, 400, "Invalid Form Body\nname: bad"))?.body).toEqual({
      ok: false,
      error: "Discord rejected that: Invalid Form Body",
    });
    expect(mapDiscordError(discord(0, 429))?.status).toBe(429);
    expect(mapDiscordError(discord(0, 500))?.status).toBe(502);
  });

  it("leaves non-Discord errors (e.g. a Mongo duplicate key) alone", () => {
    expect(mapDiscordError(Object.assign(new Error("dup"), { code: 11000 }))).toBeNull();
    expect(mapDiscordError(new Error("boom"))).toBeNull();
  });

  it("runAgentAction wraps results and errors in the contract's shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runAgentAction("t", async () => ({ messageId: "1" }))).toEqual({
      status: 200,
      body: { ok: true, messageId: "1" },
    });
    expect(
      await runAgentAction("t", async () => {
        throw new ActionError(403, "nope");
      }),
    ).toEqual({ status: 403, body: { ok: false, error: "nope" } });
    const crashed = await runAgentAction("t", async () => {
      throw new Error("boom");
    });
    expect(crashed.status).toBe(500);
    expect(crashed.body.ok).toBe(false);
    expect(typeof crashed.body.error).toBe("string");
  });
});

describe("channel ids in fixtures", () => {
  it("are real snowflakes (the routes validate them)", () => {
    for (const id of [GUILD_ID, CHANNEL_ID, REQUESTER_ID, BOT_ID]) {
      expect(id).toMatch(/^\d{17,20}$/);
    }
  });
});
