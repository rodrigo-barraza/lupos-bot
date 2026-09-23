import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import config from "#root/config.ts";
import PrismService, {
  AgentTurnAbortedError,
  DEFAULT_AGENT_MAX_COST_DOLLARS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  readSseEvents,
  resolveAgentTurnBudget,
} from "../PrismService.ts";

// The /agent runtime contract (lupos contract §1): every turn carries a
// budget and no temperature, and a turn Lupos gives up on is stopped on
// Prism's side (Prism keeps running a turn its caller walked away from).

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A stream that emits `frames` and then either closes, stays open, or errors. */
function sseStream(
  frames: string[],
  ending: "close" | "hang" | Error = "close",
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of frames) controller.enqueue(encoder.encode(text));
      if (ending === "close") controller.close();
      else if (ending instanceof Error) {
        // Let the queued frames be read first, then fail the stream the
        // way an expired AbortSignal.timeout fails the fetch body.
        setTimeout(() => controller.error(ending), 5);
      }
    },
  });
}

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

/** Stub global fetch: /agent answers with `agentStream`, /agent/stop with `stopStatus`. */
function stubPrism(agentStream: ReadableStream<Uint8Array>, stopStatus = 200) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
    if (url.endsWith("/agent/stop")) {
      return new Response(JSON.stringify({ ok: stopStatus === 200 }), {
        status: stopStatus,
      });
    }
    return new Response(agentStream, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const baseParams = {
  messages: [{ role: "user", content: "hi" }],
  type: "GOOGLE",
  model: "gemini-test",
  agentContext: { platform: "discord", requesterUserId: "123456789012345678" },
  username: "someone",
};

beforeAll(() => {
  config.PRISM_API_URL = "http://prism.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveAgentTurnBudget", () => {
  it("defaults to 10 iterations and $0.50", () => {
    expect(resolveAgentTurnBudget({})).toEqual({
      maxIterations: 10,
      maxCostDollars: 0.5,
    });
    expect(DEFAULT_AGENT_MAX_ITERATIONS).toBe(10);
    expect(DEFAULT_AGENT_MAX_COST_DOLLARS).toBe(0.5);
  });

  it("takes positive overrides from config", () => {
    expect(
      resolveAgentTurnBudget({
        AGENT_MAX_ITERATIONS: "6",
        AGENT_MAX_COST_DOLLARS: "0.25",
      }),
    ).toEqual({ maxIterations: 6, maxCostDollars: 0.25 });
  });

  it("ignores zero, negative, fractional-iteration and junk values", () => {
    for (const [iterations, cost] of [
      ["0", "0"],
      ["-3", "-1"],
      ["2.5", "abc"],
      ["", ""],
    ]) {
      expect(
        resolveAgentTurnBudget({
          AGENT_MAX_ITERATIONS: iterations,
          AGENT_MAX_COST_DOLLARS: cost,
        }),
      ).toEqual({ maxIterations: 10, maxCostDollars: 0.5 });
    }
  });
});

describe("generateAgentResponse — /agent body", () => {
  it("sends the budget and agentContext, and never a temperature", async () => {
    const { calls } = stubPrism(
      sseStream([frame({ type: "chunk", content: "yo" }), frame({ type: "done" })]),
    );
    const result = await PrismService.generateAgentResponse({
      ...baseParams,
      onEvent: () => {},
    });
    expect(result.text).toBe("yo");
    const agentCall = calls.find((call) => call.url.endsWith("/agent"));
    expect(agentCall?.body).toMatchObject({
      agent: "LUPOS",
      maxIterations: 10,
      maxCostDollars: 0.5,
      skipConversation: true,
      agentContext: { requesterUserId: "123456789012345678" },
    });
    expect(agentCall?.body).not.toHaveProperty("temperature");
  });

  it("lets a caller pass its own budget", async () => {
    const { calls } = stubPrism(sseStream([frame({ type: "done" })]));
    await PrismService.generateAgentResponse({
      ...baseParams,
      maxIterations: 3,
      maxCostDollars: 0.1,
      onEvent: () => {},
    });
    expect(calls[0].body).toMatchObject({ maxIterations: 3, maxCostDollars: 0.1 });
  });
});

describe("generateAgentResponse — stopping abandoned turns", () => {
  const openingFrames = [
    frame({ type: "hello", protocolVersion: 1 }),
    frame({ type: "user_message", conversationId: "conv-1", content: "hi" }),
    frame({ type: "thinking", content: "hm" }),
  ];

  it("stops the turn by the stream's conversation id when the trigger is deleted", async () => {
    const { calls } = stubPrism(sseStream(openingFrames, "hang"));
    const controller = new AbortController();
    const seen: string[] = [];
    const pending = PrismService.generateAgentResponse({
      ...baseParams,
      onEvent: (event) => {
        seen.push(event.type);
        if (event.type === "thinking") {
          controller.abort(new Error("trigger message 42 was deleted"));
        }
      },
      signal: controller.signal,
    });
    await expect(pending).rejects.toBeInstanceOf(AgentTurnAbortedError);
    await expect(pending).rejects.toThrow(/trigger message 42 was deleted/);
    expect(seen).toEqual(["hello", "user_message", "thinking"]);
    await vi.waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/agent/stop"))?.body).toEqual({
        conversationId: "conv-1",
      }),
    );
  });

  it("stops the turn when the stream times out mid-read", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const { calls } = stubPrism(sseStream(openingFrames, timeout));
    await expect(
      PrismService.generateAgentResponse({ ...baseParams, onEvent: () => {} }),
    ).rejects.toThrow(/timed out/);
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/agent/stop"))).toBe(true),
    );
  });

  it("stops the turn when an error event arrives after it started", async () => {
    const { calls } = stubPrism(
      sseStream([...openingFrames, frame({ type: "error", message: "provider exploded" })]),
    );
    await expect(
      PrismService.generateAgentResponse({ ...baseParams, onEvent: () => {} }),
    ).rejects.toThrow("provider exploded");
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/agent/stop"))).toBe(true),
    );
  });

  it("stops a turn whose stream closed before it finished", async () => {
    const { calls } = stubPrism(
      sseStream([...openingFrames, frame({ type: "chunk", content: "half a" })]),
    );
    const result = await PrismService.generateAgentResponse({
      ...baseParams,
      onEvent: () => {},
    });
    expect(result.text).toBe("half a");
    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/agent/stop"))).toBe(true),
    );
  });

  it("leaves a finished turn alone", async () => {
    const { calls } = stubPrism(
      sseStream([...openingFrames, frame({ type: "chunk", content: "done!" }), frame({ type: "done" })]),
    );
    await PrismService.generateAgentResponse({ ...baseParams, onEvent: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.map((call) => call.url)).toEqual(["http://prism.test/agent"]);
  });

  it("never calls Prism for a trigger deleted before the turn started", async () => {
    const { fetchMock } = stubPrism(sseStream([frame({ type: "done" })]));
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(
      PrismService.generateAgentResponse({
        ...baseParams,
        onEvent: () => {},
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AgentTurnAbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stopAgentTurn", () => {
  it("posts the conversation id to /agent/stop", async () => {
    const { calls } = stubPrism(sseStream([]));
    await expect(PrismService.stopAgentTurn("conv-9")).resolves.toBe(true);
    expect(calls).toEqual([
      { url: "http://prism.test/agent/stop", body: { conversationId: "conv-9" } },
    ]);
  });

  it("never throws — a 404 means the turn already ended", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubPrism(sseStream([]), 404);
    await expect(PrismService.stopAgentTurn("conv-gone")).resolves.toBe(false);
  });
});

describe("readSseEvents — abort", () => {
  it("rejects at once for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort("trigger deleted");
    await expect(
      readSseEvents(new Response(sseStream([frame({ type: "done" })])), undefined, controller.signal),
    ).rejects.toThrow(/trigger deleted/);
  });
});
