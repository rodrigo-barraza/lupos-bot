// ============================================================
// DiscordActionService.test.ts — polls, threads, nickname, react scope
// ============================================================
// Against mocked discord.js objects (real PermissionsBitField): every
// action is bound to the conversation, checks the requester and Lupos,
// filters its text, and keeps its cooldown.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChannelType } from "discord.js";
import {
  checkReactScope,
  createPoll,
  createThread,
  resetActionCooldowns,
  setOwnNickname,
} from "#root/services/DiscordActionService.ts";
import { runAgentAction } from "#root/services/discord/AgentActionGuards.ts";
import {
  CHANNEL_ID,
  FOREIGN_CHANNEL_ID,
  GUILD_ID,
  MEMBER_FLAGS,
  MESSAGE_ID,
  OTHER_GUILD_ID,
  REQUESTER_ID,
  ReadMessageHistory,
  SendMessages,
  CreatePublicThreads,
  STRANGER_ID,
  ViewChannel,
  asClient,
  conversationBody,
  makeChannel,
  makeClient,
  makeGuild,
  makeMessage,
  makeScene,
} from "#root/services/__tests__/support/fakeDiscord.ts";

beforeEach(() => {
  resetActionCooldowns();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const POLL = {
  question: "Pizza or tacos?",
  answers: ["Pizza", "Tacos"],
};

async function poll(scene: ReturnType<typeof makeScene>, extra: Record<string, unknown> = {}) {
  return runAgentAction("poll", () =>
    createPoll(asClient(scene.client), conversationBody({ ...POLL, ...extra })),
  );
}

describe("createPoll", () => {
  it("posts a native poll in the conversation's channel", async () => {
    const scene = makeScene();
    const result = await poll(scene, { durationHours: 6, allowMultiselect: true });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      messageId: "600000000000000001",
      url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/600000000000000001`,
    });
    expect(scene.channel.send).toHaveBeenCalledWith({
      poll: {
        question: { text: "Pizza or tacos?" },
        answers: [{ text: "Pizza" }, { text: "Tacos" }],
        duration: 6,
        allowMultiselect: true,
      },
      allowedMentions: { parse: [] },
    });
  });

  it("defaults to 24 hours, single choice", async () => {
    const scene = makeScene();
    await poll(scene);
    const payload = scene.channel.send.mock.calls[0][0] as {
      poll: { duration: number; allowMultiselect: boolean };
    };
    expect(payload.poll.duration).toBe(24);
    expect(payload.poll.allowMultiselect).toBe(false);
  });

  it.each([
    [{ question: "x".repeat(301) }, /question is too long/],
    [{ answers: ["only one"] }, /2 to 10 options/],
    [{ answers: Array.from({ length: 11 }, (_, i) => `option ${i}`) }, /2 to 10 options/],
    [{ answers: ["ok", "y".repeat(56)] }, /answers\[1\] is too long/],
    [{ answers: ["Same", "same"] }, /must all be different/],
    [{ durationHours: 0 }, /1 to 168/],
    [{ durationHours: 169 }, /1 to 168/],
    [{ durationHours: 1.5 }, /whole number/],
    [{ allowMultiselect: "yes" }, /true or false/],
  ])("rejects invalid input %o with a 400", async (extra, message) => {
    const scene = makeScene();
    const result = await poll(scene, extra);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(message);
    expect(scene.channel.send).not.toHaveBeenCalled();
  });

  it("refuses a guild outside the conversation (scopeGuildId)", async () => {
    const scene = makeScene();
    const result = await poll(scene, { guildId: OTHER_GUILD_ID });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe(
      "Lupos can only reach into the server this conversation is in.",
    );
  });

  it("requires the requester to be a member with Create Polls", async () => {
    const stranger = await poll(makeScene(), { requesterUserId: STRANGER_ID });
    expect(stranger.status).toBe(403);

    const noPolls = makeScene({ requesterFlags: [ViewChannel, SendMessages] });
    const result = await poll(noPolls);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/You don't have permission to create polls.*Send Polls/);
    expect(noPolls.channel.send).not.toHaveBeenCalled();
  });

  it("requires Lupos to have Send Messages + Send Polls", async () => {
    const scene = makeScene({ botFlags: [ViewChannel, SendMessages] });
    const result = await poll(scene);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/Lupos doesn't have permission to post polls/);
  });

  it("filters slurs out of the question and answers", async () => {
    const scene = makeScene();
    const result = await poll(scene, { answers: ["fine", "faggot"] });
    expect(result.status).toBe(400);
    expect(scene.channel.send).not.toHaveBeenCalled();
  });

  it("allows one poll per channel per 10 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-22T12:00:00Z") });
    const scene = makeScene();
    expect((await poll(scene)).status).toBe(200);
    const second = await poll(scene);
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/10 minutes/);
    vi.setSystemTime(new Date("2026-09-22T12:10:01Z"));
    expect((await poll(scene)).status).toBe(200);
  });

  it("does not spend the cooldown when Discord refuses the poll", async () => {
    const scene = makeScene();
    scene.channel.send.mockRejectedValueOnce(
      Object.assign(new Error("Missing Permissions"), { code: 50013, status: 403 }),
    );
    expect((await poll(scene)).status).toBe(403);
    expect((await poll(scene)).status).toBe(200);
  });
});

describe("createThread", () => {
  async function thread(
    scene: ReturnType<typeof makeScene>,
    extra: Record<string, unknown> = {},
  ) {
    return runAgentAction("thread", () =>
      createThread(asClient(scene.client), conversationBody({ name: "Raid planning", ...extra })),
    );
  }

  it("starts a new public thread in the channel", async () => {
    const scene = makeScene();
    const result = await thread(scene, { autoArchiveMinutes: 60 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, threadId: "500000000000000002" });
    expect(scene.channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Raid planning",
        autoArchiveDuration: 60,
        type: ChannelType.PublicThread,
        reason: expect.stringContaining(REQUESTER_ID),
      }),
    );
  });

  it("starts the thread from a message in the channel, default 1 day archive", async () => {
    const message = makeMessage();
    const scene = makeScene({ channel: { messages: [message] } });
    const result = await thread(scene, { messageId: MESSAGE_ID });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ threadId: "500000000000000001" });
    expect(message.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Raid planning", autoArchiveDuration: 1440 }),
    );
    expect(scene.channel.threads.create).not.toHaveBeenCalled();
  });

  it("404s a message that is not in the conversation's channel", async () => {
    const scene = makeScene();
    const result = await thread(scene, { messageId: "400000000000000999" });
    expect(result.status).toBe(404);
  });

  it("409s a message that already has a thread, pointing at it", async () => {
    const existingUrl = `https://discord.com/channels/${GUILD_ID}/555`;
    const scene = makeScene({ channel: { messages: [makeMessage(MESSAGE_ID, { existingThreadUrl: existingUrl })] } });
    const result = await thread(scene, { messageId: MESSAGE_ID });
    expect(result.status).toBe(409);
    expect(result.body.error).toContain(existingUrl);
  });

  it.each([
    [{ name: "n".repeat(101) }, /name is too long/],
    [{ autoArchiveMinutes: 30 }, /60, 1440, 4320, 10080/],
    [{ messageId: "not-an-id" }, /messageId must be a Discord id/],
  ])("rejects %o with a 400", async (extra, message) => {
    const result = await thread(makeScene(), extra);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(message);
  });

  it("refuses inside a thread, and without a message in an announcement channel", async () => {
    const inThread = makeScene({ channel: { type: ChannelType.PublicThread } });
    expect((await thread(inThread)).status).toBe(400);
    const announcement = makeScene({ channel: { type: ChannelType.GuildAnnouncement } });
    const result = await thread(announcement);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/messageId/);
  });

  it("requires Create Public Threads from the requester (and history for a message)", async () => {
    const noThreads = makeScene({ requesterFlags: [ViewChannel, SendMessages, ReadMessageHistory] });
    const result = await thread(noThreads);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/Create Public Threads/);

    const noHistory = makeScene({ requesterFlags: [ViewChannel, SendMessages, CreatePublicThreads] });
    expect((await thread(noHistory, { messageId: MESSAGE_ID })).status).toBe(403);
    expect((await thread(noHistory)).status).toBe(200);
  });

  it("requires Create Public Threads from Lupos", async () => {
    const scene = makeScene({ botFlags: [ViewChannel, SendMessages] });
    const result = await thread(scene);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/Lupos doesn't have permission to create threads/);
  });

  it("filters the thread name", async () => {
    const result = await thread(makeScene(), { name: "kys" });
    expect(result.status).toBe(400);
  });

  it("allows one thread per channel per 10 minutes", async () => {
    const scene = makeScene();
    expect((await thread(scene)).status).toBe(200);
    expect((await thread(scene)).status).toBe(429);
  });
});

describe("setOwnNickname", () => {
  async function nickname(
    scene: ReturnType<typeof makeScene>,
    value: unknown,
    extra: Record<string, unknown> = {},
  ) {
    return runAgentAction("nickname", () =>
      setOwnNickname(asClient(scene.client), conversationBody({ nickname: value, ...extra })),
    );
  }

  it("sets Lupos's own nickname, trimmed", async () => {
    const scene = makeScene();
    const result = await nickname(scene, "  Sir Lupos  ");
    expect(result).toEqual({ status: 200, body: { ok: true, nickname: "Sir Lupos" } });
    expect(scene.bot.setNickname).toHaveBeenCalledWith(
      "Sir Lupos",
      expect.stringContaining(REQUESTER_ID),
    );
  });

  it("resets it with an empty string", async () => {
    const scene = makeScene();
    scene.bot.nickname = "Sir Lupos";
    const result = await nickname(scene, "");
    expect(result.body).toEqual({ ok: true, nickname: "" });
    expect(scene.bot.setNickname).toHaveBeenCalledWith(null, expect.any(String));
  });

  it("treats the current nickname as a no-op that spends no cooldown", async () => {
    const scene = makeScene();
    scene.bot.nickname = "Lupin";
    const unchanged = await nickname(scene, "Lupin");
    expect(unchanged.body).toEqual({ ok: true, nickname: "Lupin", unchanged: true });
    expect(scene.bot.setNickname).not.toHaveBeenCalled();
    expect((await nickname(scene, "Lupo")).status).toBe(200);
  });

  it("rejects non-strings and names over 32 characters", async () => {
    expect((await nickname(makeScene(), undefined)).status).toBe(400);
    expect((await nickname(makeScene(), "x".repeat(33))).status).toBe(400);
  });

  it("filters the nickname", async () => {
    const scene = makeScene();
    expect((await nickname(scene, "chink")).status).toBe(400);
    expect(scene.bot.setNickname).not.toHaveBeenCalled();
  });

  it("needs Change Nickname for Lupos, and a member requester who can post here", async () => {
    const noPermission = makeScene({ botGuildFlags: [] });
    const refused = await nickname(noPermission, "Lupin");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/Change Nickname/);

    const muted = makeScene({ requesterFlags: [ViewChannel] });
    expect((await nickname(muted, "Lupin")).status).toBe(403);
    expect((await nickname(makeScene(), "Lupin", { requesterUserId: STRANGER_ID })).status).toBe(403);
  });

  it("allows one change per guild per 10 minutes", async () => {
    const scene = makeScene();
    expect((await nickname(scene, "One")).status).toBe(200);
    const second = await nickname(scene, "Two");
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/nickname/);
  });
});

describe("checkReactScope", () => {
  function sceneWithForeignChannel() {
    const scene = makeScene();
    const foreignChannel = makeChannel({
      id: FOREIGN_CHANNEL_ID,
      guildId: OTHER_GUILD_ID,
      grants: { [REQUESTER_ID]: MEMBER_FLAGS },
    });
    const otherGuild = makeGuild({ id: OTHER_GUILD_ID, channels: [foreignChannel] });
    const client = makeClient([scene.guild, otherGuild]);
    return { ...scene, client };
  }

  it("without scopeGuildId behaves as before (body guildId, else the fallback)", async () => {
    const { client } = sceneWithForeignChannel();
    await expect(
      checkReactScope(asClient(client), { channelId: FOREIGN_CHANNEL_ID }, GUILD_ID),
    ).resolves.toBe(GUILD_ID);
    await expect(
      checkReactScope(
        asClient(client),
        { channelId: FOREIGN_CHANNEL_ID, guildId: OTHER_GUILD_ID },
        GUILD_ID,
      ),
    ).resolves.toBe(OTHER_GUILD_ID);
  });

  it("with scopeGuildId refuses a channel in another guild (403)", async () => {
    const { client } = sceneWithForeignChannel();
    await expect(
      checkReactScope(
        asClient(client),
        { channelId: FOREIGN_CHANNEL_ID, scopeGuildId: GUILD_ID },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      checkReactScope(
        asClient(client),
        { channelId: CHANNEL_ID, guildId: OTHER_GUILD_ID, scopeGuildId: GUILD_ID },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("with scopeGuildId reacts in the scope guild", async () => {
    const { client } = sceneWithForeignChannel();
    await expect(
      checkReactScope(
        asClient(client),
        { channelId: CHANNEL_ID, scopeGuildId: GUILD_ID, requesterUserId: REQUESTER_ID },
        "999999999999999999",
      ),
    ).resolves.toBe(GUILD_ID);
  });

  it("refuses a channel the requester cannot see", async () => {
    const scene = makeScene({ requesterFlags: [] });
    await expect(
      checkReactScope(
        asClient(scene.client),
        { channelId: CHANNEL_ID, scopeGuildId: GUILD_ID, requesterUserId: REQUESTER_ID },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      checkReactScope(
        asClient(scene.client),
        { channelId: CHANNEL_ID, scopeGuildId: GUILD_ID, requesterUserId: STRANGER_ID },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("leaves unknown channels to the route's own 404", async () => {
    const scene = makeScene();
    await expect(
      checkReactScope(
        asClient(scene.client),
        { channelId: "299999999999999999", scopeGuildId: GUILD_ID },
        undefined,
      ),
    ).resolves.toBe(GUILD_ID);
  });

  it("only needs the requester to see the channel (a reaction is not a post)", async () => {
    const scene = makeScene({ requesterFlags: [ViewChannel] });
    await expect(
      checkReactScope(
        asClient(scene.client),
        { channelId: CHANNEL_ID, requesterUserId: REQUESTER_ID },
        GUILD_ID,
      ),
    ).resolves.toBe(GUILD_ID);
  });
});
