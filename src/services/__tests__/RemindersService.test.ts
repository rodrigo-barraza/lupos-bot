// ============================================================
// RemindersService.test.ts — schedule / list / cancel / deliver
// ============================================================
// Mongo is an in-memory fake collection (fakeMongo); Discord is mocked
// discord.js objects (fakeDiscord). Delivery is exercised across
// "restarts" (a fresh tick over the same collection) and overlapping
// ticks.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb } from "#root/services/__tests__/support/fakeMongo.ts";
import {
  BOT_ID,
  CHANNEL_ID,
  GUILD_ID,
  OTHER_GUILD_ID,
  REQUESTER_ID,
  STRANGER_ID,
  ViewChannel,
  asClient,
  conversationBody,
  makeClient,
  makeScene,
} from "#root/services/__tests__/support/fakeDiscord.ts";

const fakeDb = createFakeDb();
vi.mock("../MongoService.ts", () => ({
  default: { getDb: () => fakeDb },
}));

const {
  cancelReminder,
  createReminder,
  deliverDueReminders,
  formatReminderMessage,
  listReminders,
  readDueAt,
  resetRemindersIndexState,
} = await import("#root/services/RemindersService.ts");
const { runAgentAction } = await import("#root/services/discord/AgentActionGuards.ts");

const NOW = Date.parse("2026-09-22T12:00:00Z");
const MINUTE = 60_000;

function reminders() {
  return fakeDb.collection("Reminders");
}

async function schedule(
  scene: ReturnType<typeof makeScene>,
  extra: Record<string, unknown> = {},
  nowMs = NOW,
) {
  return runAgentAction("reminders", () =>
    createReminder(
      asClient(scene.client),
      conversationBody({ text: "take the pizza out", delayMinutes: 30, ...extra }),
      nowMs,
    ),
  );
}

beforeEach(() => {
  fakeDb.reset();
  resetRemindersIndexState();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readDueAt", () => {
  const status = (body: Record<string, unknown>) => {
    try {
      readDueAt(body, NOW);
      return 200;
    } catch (error: unknown) {
      return (error as { status: number }).status;
    }
  };

  it("turns delayMinutes into a due time", () => {
    expect(readDueAt({ delayMinutes: 90 }, NOW).toISOString()).toBe("2026-09-22T13:30:00.000Z");
    expect(readDueAt({ delayMinutes: "1" }, NOW).getTime()).toBe(NOW + MINUTE);
    expect(readDueAt({ delayMinutes: 43_200 }, NOW).getTime()).toBe(NOW + 30 * 24 * 60 * MINUTE);
  });

  it("accepts an ISO dueAt with an offset, 1 minute to 30 days ahead", () => {
    expect(readDueAt({ dueAt: "2026-09-22T10:00:00-07:00" }, NOW).toISOString()).toBe(
      "2026-09-22T17:00:00.000Z",
    );
    expect(status({ dueAt: "2026-09-22T12:01:00Z" })).toBe(200);
    expect(status({ dueAt: "2026-10-22T12:00:00Z" })).toBe(200);
  });

  it.each([
    [{}, "neither"],
    [{ delayMinutes: 5, dueAt: "2026-09-22T13:00:00Z" }, "both"],
    [{ delayMinutes: 0 }, "too soon"],
    [{ delayMinutes: 43_201 }, "too far"],
    [{ delayMinutes: "soon" }, "not a number"],
    [{ dueAt: "2026-09-22T12:00:30Z" }, "under a minute"],
    [{ dueAt: "2026-10-22T12:00:01Z" }, "over 30 days"],
    [{ dueAt: "2026-09-22T11:00:00Z" }, "in the past"],
    [{ dueAt: "2026-09-22T14:00:00" }, "no offset (would mean Pacific)"],
    [{ dueAt: "tomorrow at noon" }, "not ISO"],
  ])("rejects %o (%s) with a 400", (body) => {
    expect(status(body)).toBe(400);
  });
});

describe("createReminder", () => {
  it("stores a pending reminder for the requester in the conversation's channel", async () => {
    const scene = makeScene();
    const result = await schedule(scene);
    expect(result.status).toBe(200);
    const reminder = (result.body as { reminder: Record<string, string> }).reminder;
    expect(result.body.ok).toBe(true);
    expect(Object.keys(reminder).sort()).toEqual(["channelId", "dueAt", "id", "text"]);
    expect(reminder).toMatchObject({
      channelId: CHANNEL_ID,
      text: "take the pizza out",
      dueAt: "2026-09-22T12:30:00.000Z",
    });

    const [stored] = reminders().documents;
    expect(stored).toMatchObject({
      id: reminder.id,
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      userId: REQUESTER_ID,
      status: "pending",
      sentAt: null,
    });
    expect(stored.dueAt).toEqual(new Date("2026-09-22T12:30:00Z"));
    expect(stored.createdAt).toEqual(new Date(NOW));
  });

  it("ensures its indexes, with a unique id that tolerates legacy documents", async () => {
    await schedule(makeScene());
    const indexes = reminders().createdIndexes;
    expect(indexes).toContainEqual({
      spec: { id: 1 },
      options: { unique: true, partialFilterExpression: { id: { $type: "string" } } },
    });
    expect(indexes.map((index) => index.spec)).toContainEqual({ status: 1, dueAt: 1 });
  });

  it("refuses text over 300 characters, and slurs", async () => {
    expect((await schedule(makeScene(), { text: "x".repeat(301) })).status).toBe(400);
    expect((await schedule(makeScene(), { text: "remind the nigga" })).status).toBe(400);
    expect(reminders().documents).toHaveLength(0);
  });

  it("refuses outside the conversation's guild, and for non-members", async () => {
    expect((await schedule(makeScene(), { guildId: OTHER_GUILD_ID })).status).toBe(403);
    expect((await schedule(makeScene(), { requesterUserId: STRANGER_ID })).status).toBe(403);
  });

  it("needs both the requester and Lupos to be able to post in the channel", async () => {
    expect((await schedule(makeScene({ requesterFlags: [ViewChannel] }))).status).toBe(403);
    const botMuted = await schedule(makeScene({ botFlags: [ViewChannel] }));
    expect(botMuted.status).toBe(403);
    expect(botMuted.body.error).toMatch(/Lupos doesn't have permission to post reminders/);
  });

  it("caps pending reminders at 5 per user per guild", async () => {
    const scene = makeScene();
    for (let index = 0; index < 5; index++) {
      expect((await schedule(scene)).status).toBe(200);
    }
    const sixth = await schedule(scene);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/already have 5 reminders pending/);

    // A reminder that is no longer pending frees a slot.
    reminders().documents[0].status = "sent";
    expect((await schedule(scene)).status).toBe(200);
  });

  it("holds the per-user cap under concurrent requests", async () => {
    const scene = makeScene();
    const results = await Promise.all(Array.from({ length: 8 }, () => schedule(scene)));
    expect(results.filter((result) => result.status === 200)).toHaveLength(5);
    expect(results.filter((result) => result.status === 429)).toHaveLength(3);
  });

  it("caps pending reminders at 100 per guild", async () => {
    const scene = makeScene();
    for (let index = 0; index < 100; index++) {
      reminders().documents.push({
        id: `seed${index}`,
        guildId: GUILD_ID,
        userId: `3000000000000${String(index).padStart(5, "0")}`,
        status: "pending",
      });
    }
    const result = await schedule(scene);
    expect(result.status).toBe(429);
    expect(result.body.error).toMatch(/100 reminders pending/);
  });
});

describe("listReminders / cancelReminder", () => {
  async function seedTwo() {
    const scene = makeScene();
    const later = await schedule(scene, { delayMinutes: 120, text: "later" });
    const sooner = await schedule(scene, { delayMinutes: 10, text: "sooner" });
    const ids = [later, sooner].map(
      (result) => (result.body as { reminder: { id: string } }).reminder.id,
    );
    return { scene, laterId: ids[0], soonerId: ids[1] };
  }

  it("lists the requester's pending reminders in this guild, soonest first", async () => {
    await seedTwo();
    reminders().documents.push({
      id: "someone-else",
      guildId: GUILD_ID,
      userId: STRANGER_ID,
      status: "pending",
      dueAt: new Date(NOW),
    });
    const result = await runAgentAction("list", () =>
      listReminders({ guildId: GUILD_ID, requesterUserId: REQUESTER_ID }),
    );
    expect(result.status).toBe(200);
    const listed = (result.body as { reminders: { text: string }[] }).reminders;
    expect(listed.map((reminder) => reminder.text)).toEqual(["sooner", "later"]);
  });

  it("list requires guildId and requesterUserId, and honours scopeGuildId", async () => {
    const missing = await runAgentAction("list", () => listReminders({ guildId: GUILD_ID }));
    expect(missing.status).toBe(400);
    const outOfScope = await runAgentAction("list", () =>
      listReminders({
        guildId: OTHER_GUILD_ID,
        requesterUserId: REQUESTER_ID,
        scopeGuildId: GUILD_ID,
      }),
    );
    expect(outOfScope.status).toBe(403);
  });

  it("cancels only the requester's own pending reminder", async () => {
    const { soonerId } = await seedTwo();

    const notYours = await runAgentAction("cancel", () =>
      cancelReminder({ guildId: GUILD_ID, requesterUserId: STRANGER_ID, reminderId: soonerId }),
    );
    expect(notYours.status).toBe(404);

    const cancelled = await runAgentAction("cancel", () =>
      cancelReminder(conversationBody({ reminderId: soonerId })),
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      ok: true,
      reminder: { id: soonerId, text: "sooner", status: "cancelled" },
    });
    expect(reminders().documents.find((doc) => doc.id === soonerId)?.status).toBe("cancelled");

    const again = await runAgentAction("cancel", () =>
      cancelReminder(conversationBody({ reminderId: soonerId })),
    );
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already cancelled/);
  });
});

describe("formatReminderMessage", () => {
  const reminder = {
    userId: REQUESTER_ID,
    text: "stretch",
    dueAt: new Date(NOW),
  };

  it("pings the requester with the text", () => {
    expect(formatReminderMessage(reminder, NOW + 30_000)).toBe(`⏰ <@${REQUESTER_ID}> stretch`);
  });

  it("says when it is late, with a relative Discord timestamp", () => {
    const message = formatReminderMessage(reminder, NOW + 3 * 60 * MINUTE);
    expect(message.startsWith(`⏰ <@${REQUESTER_ID}> stretch\n`)).toBe(true);
    expect(message).toContain(`late — it was due <t:${NOW / 1000}:R>`);
  });
});

describe("deliverDueReminders", () => {
  async function scheduleDue(scene: ReturnType<typeof makeScene>, text = "stretch") {
    const result = await schedule(scene, { delayMinutes: 1, text }, NOW);
    return (result.body as { reminder: { id: string } }).reminder.id;
  }

  it("sends due reminders once, pinging only the requester", async () => {
    const scene = makeScene();
    const id = await scheduleDue(scene, "hey <@300000000000000002> @everyone look");
    await schedule(scene, { delayMinutes: 60, text: "not yet" }, NOW);

    const summary = await deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    expect(summary).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect(scene.channel.send).toHaveBeenCalledTimes(1);
    expect(scene.channel.send).toHaveBeenCalledWith({
      content: `⏰ <@${REQUESTER_ID}> hey <@300000000000000002> @everyone look`,
      allowedMentions: { users: [REQUESTER_ID] },
    });
    const stored = reminders().documents.find((doc) => doc.id === id)!;
    expect(stored).toMatchObject({ status: "sent", claimedAt: null, attempts: 1 });
    expect(stored.sentAt).toEqual(new Date(NOW + 2 * MINUTE));

    await deliverDueReminders(asClient(scene.client), NOW + 3 * MINUTE);
    expect(scene.channel.send).toHaveBeenCalledTimes(1);
  });

  it("never double-sends when two ticks overlap", async () => {
    const scene = makeScene();
    for (let index = 0; index < 3; index++) await scheduleDue(scene, `r${index}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scene.channel.send.mockImplementation(async () => {
      await gate;
      return { id: "1", url: "u" };
    });

    const first = deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    const second = deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.sent + b.sent).toBe(3);
    const texts = scene.channel.send.mock.calls.map(
      ([payload]) => (payload as { content: string }).content,
    );
    expect(new Set(texts).size).toBe(3);
    expect(texts).toHaveLength(3);
  });

  it("after a restart delivers what fell due while down, marked late", async () => {
    const scene = makeScene();
    await scheduleDue(scene);
    // Lupos was down for three hours; a fresh process ticks.
    const restarted = makeScene();
    const summary = await deliverDueReminders(asClient(restarted.client), NOW + 3 * 60 * MINUTE);
    expect(summary.sent).toBe(1);
    const [[payload]] = restarted.channel.send.mock.calls as [[{ content: string }]];
    expect(payload.content).toMatch(/late — it was due/);
  });

  it("retries a delivery claimed by a process that died mid-send, after the claim expires", async () => {
    const scene = makeScene();
    const id = await scheduleDue(scene);
    const stored = reminders().documents.find((doc) => doc.id === id)!;
    stored.claimedAt = new Date(NOW + 2 * MINUTE);
    stored.claimToken = "dead-process";

    const tooSoon = await deliverDueReminders(asClient(scene.client), NOW + 3 * MINUTE);
    expect(tooSoon.sent).toBe(0);
    const afterTtl = await deliverDueReminders(asClient(scene.client), NOW + 8 * MINUTE);
    expect(afterTtl.sent).toBe(1);
  });

  it("does not deliver cancelled reminders", async () => {
    const scene = makeScene();
    const id = await scheduleDue(scene);
    await cancelReminder(conversationBody({ reminderId: id }));
    const summary = await deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    expect(summary.sent).toBe(0);
    expect(scene.channel.send).not.toHaveBeenCalled();
  });

  it("retries transient send failures on later ticks, then gives up", async () => {
    const scene = makeScene();
    const id = await scheduleDue(scene);
    scene.channel.send.mockRejectedValue(
      Object.assign(new Error("Service Unavailable"), { status: 503 }),
    );
    for (let tick = 1; tick <= 4; tick++) {
      const summary = await deliverDueReminders(asClient(scene.client), NOW + (1 + tick) * MINUTE);
      expect(summary).toEqual({ sent: 0, failed: 0, retrying: 1 });
    }
    const last = await deliverDueReminders(asClient(scene.client), NOW + 6 * MINUTE);
    expect(last).toEqual({ sent: 0, failed: 1, retrying: 0 });
    expect(reminders().documents.find((doc) => doc.id === id)).toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "Service Unavailable",
    });
  });

  it("keeps delivering others in a tick when one fails transiently", async () => {
    const scene = makeScene();
    await scheduleDue(scene, "first");
    await scheduleDue(scene, "second");
    scene.channel.send
      .mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }))
      .mockResolvedValue({ id: "1", url: "u" });
    const summary = await deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    expect(summary).toEqual({ sent: 1, failed: 0, retrying: 1 });
  });

  it("fails permanently when Discord refuses, the channel is gone, or Lupos left", async () => {
    const refused = makeScene();
    await scheduleDue(refused);
    refused.channel.send.mockRejectedValue(
      Object.assign(new Error("Missing Permissions"), { code: 50013, status: 403 }),
    );
    expect(
      await deliverDueReminders(asClient(refused.client), NOW + 2 * MINUTE),
    ).toMatchObject({ failed: 1 });

    fakeDb.reset();
    const gone = makeScene();
    await scheduleDue(gone);
    gone.guild.channels.cache.delete(CHANNEL_ID);
    expect(await deliverDueReminders(asClient(gone.client), NOW + 2 * MINUTE)).toMatchObject({
      failed: 1,
    });
    expect(reminders().documents[0].lastError).toMatch(/no longer exists/);

    fakeDb.reset();
    const left = makeScene();
    await scheduleDue(left);
    expect(
      await deliverDueReminders(asClient(makeClient([])), NOW + 2 * MINUTE),
    ).toMatchObject({ failed: 1 });
  });

  it("fails without sending when Lupos can no longer post in the channel", async () => {
    const scene = makeScene();
    await scheduleDue(scene);
    scene.channel.grants[BOT_ID] = [ViewChannel];
    const summary = await deliverDueReminders(asClient(scene.client), NOW + 2 * MINUTE);
    expect(summary.failed).toBe(1);
    expect(scene.channel.send).not.toHaveBeenCalled();
  });

  it("ignores legacy documents from the retired reminders job", async () => {
    const scene = makeScene();
    reminders().documents.push({ reminderAt: "2020-01-01T00:00:00Z", message: "old" });
    const summary = await deliverDueReminders(asClient(scene.client), NOW);
    expect(summary).toEqual({ sent: 0, failed: 0, retrying: 0 });
  });
});
