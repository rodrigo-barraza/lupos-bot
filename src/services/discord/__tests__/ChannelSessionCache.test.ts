import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import ChannelSessionCache, {
  isSnowflakeAfter,
} from "#root/services/discord/ChannelSessionCache.ts";
import config from "#root/config.ts";
import type { ChatMessage } from "#root/services/AIService.ts";

const CHANNEL = "111222333444555666";

function turn(role: string, content: string): ChatMessage {
  return { role, content };
}

/** Commit a baseline request so a session exists. */
function commitBaseline({
  trigger = "1000",
  envelopeIds = ["998", "999", "1000"],
  assistantText = "grrr hello",
  participants = ["u1", "u2"],
}: {
  trigger?: string;
  envelopeIds?: string[];
  assistantText?: string | null;
  participants?: string[];
} = {}) {
  ChannelSessionCache.commit({
    channelId: CHANNEL,
    piggyback: false,
    sentConversation: [turn("user", "<discord-message id=\"999\">hi</discord-message>")],
    envelopeMessageIds: envelopeIds,
    triggerMessageId: trigger,
    assistantText,
    assistantName: "Lupos",
    participantUserIds: participants,
  });
}

describe("ChannelSessionCache", () => {
  beforeEach(() => {
    ChannelSessionCache.clearAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (config as Record<string, unknown>).PIGGYBACK_SESSIONS;
    delete (config as Record<string, unknown>).PIGGYBACK_SESSION_TTL_MS;
    delete (config as Record<string, unknown>).PIGGYBACK_SESSION_MAX_CHARS;
  });

  it("compares snowflakes numerically, not lexically", () => {
    expect(isSnowflakeAfter("1000", "999")).toBe(true);
    expect(isSnowflakeAfter("999", "1000")).toBe(false);
    expect(isSnowflakeAfter("garbage", "1000")).toBe(false);
  });

  it("rebaselines when no session exists", () => {
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["999", "1000", "1001"],
      windowSize: 50,
    });
    expect(plan).toEqual({ mode: "rebaseline", reason: "no session" });
  });

  it("piggybacks on a fresh session and freezes the assistant turn", () => {
    commitBaseline();
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["999", "1000", "1001"],
      windowSize: 2,
    });
    expect(plan.mode).toBe("piggyback");
    if (plan.mode !== "piggyback") return;
    expect(plan.session.watermarkId).toBe("1000");
    const last = plan.session.frozenConversation.at(-1);
    expect(last).toEqual({
      role: "assistant",
      name: "Lupos",
      content: "grrr hello",
    });
    // Everything already represented is excluded from the next slice.
    expect([...plan.skipIds].sort()).toEqual(["1000", "998", "999"]);
  });

  it("skips the frozen assistant turn when the agent produced no text", () => {
    commitBaseline({ assistantText: null });
    const session = ChannelSessionCache.get(CHANNEL);
    expect(
      session?.frozenConversation.some((m) => m.role === "assistant"),
    ).toBe(false);
  });

  it("rebaselines after the TTL expires and drops the session", () => {
    commitBaseline();
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["999", "1000", "1001"],
      windowSize: 2,
    });
    expect(plan).toEqual({ mode: "rebaseline", reason: "ttl expired" });
    expect(ChannelSessionCache.get(CHANNEL)).toBeUndefined();
  });

  it("honors a configured TTL override", () => {
    (config as Record<string, unknown>).PIGGYBACK_SESSION_TTL_MS = "1000";
    commitBaseline();
    vi.advanceTimersByTime(999);
    expect(
      ChannelSessionCache.planFor({
        channelId: CHANNEL,
        recentMessageIds: ["1000", "1001"],
        windowSize: 1,
      }).mode,
    ).toBe("piggyback");
    vi.advanceTimersByTime(2);
    expect(
      ChannelSessionCache.planFor({
        channelId: CHANNEL,
        recentMessageIds: ["1000", "1001"],
        windowSize: 1,
      }).mode,
    ).toBe("rebaseline");
  });

  it("rebaselines when the session outgrows the size budget", () => {
    (config as Record<string, unknown>).PIGGYBACK_SESSION_MAX_CHARS = "10";
    commitBaseline({ assistantText: "a very long reply that exceeds ten chars" });
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["1000", "1001"],
      windowSize: 1,
    });
    expect(plan).toEqual({
      mode: "rebaseline",
      reason: "session over size budget",
    });
  });

  it("rebaselines when the fetch window no longer reaches the watermark", () => {
    commitBaseline({ trigger: "1000" });
    // Every fetched id is newer than the watermark — gap risk.
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["2001", "2002", "2003"],
      windowSize: 2,
    });
    expect(plan).toEqual({
      mode: "rebaseline",
      reason: "watermark outside fetch window",
    });
  });

  it("rebaselines when the trigger asks for more history than the session holds", () => {
    commitBaseline({ envelopeIds: ["998", "999", "1000"] });
    // "recap everything" heuristic → windowSize 100 > 3 frozen + 1 new
    const plan = ChannelSessionCache.planFor({
      channelId: CHANNEL,
      recentMessageIds: ["999", "1000", "1001"],
      windowSize: 100,
    });
    expect(plan).toEqual({
      mode: "rebaseline",
      reason: "trigger wants larger window",
    });
  });

  it("merges session state on piggyback commits and replaces it on rebaseline", () => {
    commitBaseline({ participants: ["u1"] });
    ChannelSessionCache.recordBotPosts(CHANNEL, ["1500"]);

    ChannelSessionCache.commit({
      channelId: CHANNEL,
      piggyback: true,
      sentConversation: [turn("user", "next")],
      envelopeMessageIds: ["2000"],
      triggerMessageId: "2000",
      assistantText: "again",
      assistantName: "Lupos",
      participantUserIds: ["u2"],
    });
    let session = ChannelSessionCache.get(CHANNEL)!;
    expect(session.watermarkId).toBe("2000");
    expect(session.participantUserIds).toEqual(["u1", "u2"]);
    expect(session.messageIds.has("999")).toBe(true);
    expect(session.botPostedIds.has("1500")).toBe(true);
    expect(session.turns).toBe(2);

    ChannelSessionCache.commit({
      channelId: CHANNEL,
      piggyback: false,
      sentConversation: [turn("user", "fresh start")],
      envelopeMessageIds: ["3000"],
      triggerMessageId: "3000",
      assistantText: "clean",
      assistantName: "Lupos",
      participantUserIds: ["u3"],
    });
    session = ChannelSessionCache.get(CHANNEL)!;
    expect(session.participantUserIds).toEqual(["u3"]);
    expect(session.messageIds.has("999")).toBe(false);
    expect(session.botPostedIds.size).toBe(0);
    expect(session.turns).toBe(1);
  });

  it("appends frozen turns and counts them toward the size budget", () => {
    commitBaseline();
    const before = ChannelSessionCache.get(CHANNEL)!.approxChars;
    ChannelSessionCache.appendFrozenTurns(CHANNEL, [
      turn("system", '<message-annotation for="1500">img</message-annotation>'),
    ]);
    const session = ChannelSessionCache.get(CHANNEL)!;
    expect(session.frozenConversation.at(-1)?.role).toBe("system");
    expect(session.approxChars).toBeGreaterThan(before);
  });

  it("invalidates only when the edited/deleted message is in the session", () => {
    commitBaseline({ envelopeIds: ["998", "999", "1000"] });
    ChannelSessionCache.invalidateIfContains(CHANNEL, "555");
    expect(ChannelSessionCache.get(CHANNEL)).toBeDefined();
    ChannelSessionCache.invalidateIfContains(CHANNEL, "999");
    expect(ChannelSessionCache.get(CHANNEL)).toBeUndefined();
  });

  it("does nothing when disabled via config", () => {
    (config as Record<string, unknown>).PIGGYBACK_SESSIONS = "false";
    commitBaseline();
    expect(ChannelSessionCache.get(CHANNEL)).toBeUndefined();
    expect(
      ChannelSessionCache.planFor({
        channelId: CHANNEL,
        recentMessageIds: ["1000"],
        windowSize: 1,
      }),
    ).toEqual({ mode: "rebaseline", reason: "disabled" });
  });
});
