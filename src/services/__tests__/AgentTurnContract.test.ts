import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import config from "#root/config.ts";
import PrismService, {
  AgentTurnAbortedError,
  DEFAULT_AGENT_MAX_COST_DOLLARS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  DEFAULT_AGENT_THINKING_LEVEL,
  readSseEvents,
  resolveAgentThinkingLevel,
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

// Round-2 contract §1 (least privilege) and §3 (thinking control): an
// unattended turn refuses what would ask — the LUPOS allow-list decides —
// and a reasoning LEVEL instead of a fixed token budget, on BOTH /agent
// paths. autoApprove rides along only for a Prism without that allow-list
// (the new one ignores it for LUPOS), so the two can deploy in any order.
describe("generateAgentResponse — least privilege and thinking", () => {
  afterEach(() => {
    delete (config as { AGENT_THINKING_LEVEL?: string }).AGENT_THINKING_LEVEL;
  });

  function expectLeastPrivilege(body: Record<string, unknown> | undefined) {
    expect(body).toMatchObject({
      unattended: true,
      autoApprove: true,
      thinkingLevel: "low",
    });
    expect(body).not.toHaveProperty("thinkingBudget");
    expect(body).not.toHaveProperty("permissionMode");
  }

  it("streaming path: unattended (+ transitional autoApprove), thinkingLevel medium", async () => {
    const { calls } = stubPrism(sseStream([frame({ type: "done" })]));
    await PrismService.generateAgentResponse({
      ...baseParams,
      thinkingEnabled: true,
      onEvent: () => {},
    });
    const body = calls.find((call) => call.url.endsWith("/agent"))?.body;
    expectLeastPrivilege(body);
    expect(body).toMatchObject({ thinkingEnabled: true });
  });

  it("non-streaming path (scheduled jobs): the same", async () => {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
        return new Response(JSON.stringify({ finalText: "hey" }), { status: 200 });
      }),
    );
    const result = await PrismService.generateAgentResponse({ ...baseParams, maxTokens: 1024 });
    expect(result.text).toBe("hey");
    expect(calls[0].url).toBe("http://prism.test/agent?stream=false");
    expectLeastPrivilege(calls[0].body);
  });

  it("takes the level from AGENT_THINKING_LEVEL", async () => {
    (config as { AGENT_THINKING_LEVEL?: string }).AGENT_THINKING_LEVEL = "high";
    const { calls } = stubPrism(sseStream([frame({ type: "done" })]));
    await PrismService.generateAgentResponse({ ...baseParams, onEvent: () => {} });
    expect(calls[0].body.thinkingLevel).toBe("high");
  });
});

describe("resolveAgentThinkingLevel", () => {
  it("defaults to medium", () => {
    expect(resolveAgentThinkingLevel({})).toBe(DEFAULT_AGENT_THINKING_LEVEL);
    expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: "" })).toBe(DEFAULT_AGENT_THINKING_LEVEL);
  });

  it("accepts the four levels, case-insensitively", () => {
    for (const level of ["minimal", "low", "medium", "high"]) {
      expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: level })).toBe(level);
    }
    expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: " HIGH " })).toBe("high");
  });

  it("falls back to medium on anything else, warning once per bad value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: "10000" })).toBe(DEFAULT_AGENT_THINKING_LEVEL);
    expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: "10000" })).toBe(DEFAULT_AGENT_THINKING_LEVEL);
    expect(resolveAgentThinkingLevel({ AGENT_THINKING_LEVEL: "max" })).toBe(DEFAULT_AGENT_THINKING_LEVEL);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("postAgentInput", () => {
  function stubInput(status: number, payload: Record<string, unknown>) {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
        return new Response(JSON.stringify(payload), { status });
      }),
    );
    return calls;
  }

  it("posts { conversationId, text, images } and returns the input id", async () => {
    const calls = stubInput(200, { ok: true, inputId: "input-7", position: 1 });
    await expect(
      PrismService.postAgentInput("conv-1", {
        text: "<discord-message …>",
        images: ["https://cdn.discordapp.com/a.png"],
      }),
    ).resolves.toBe("input-7");
    expect(calls).toEqual([
      {
        url: "http://prism.test/agent/input",
        body: {
          conversationId: "conv-1",
          text: "<discord-message …>",
          images: ["https://cdn.discordapp.com/a.png"],
        },
      },
    ]);
  });

  it("omits an empty image list", async () => {
    const calls = stubInput(200, { ok: true, inputId: "input-8" });
    await PrismService.postAgentInput("conv-1", { text: "hi", images: [] });
    expect(calls[0].body).toEqual({ conversationId: "conv-1", text: "hi" });
  });

  it("returns null (never throws) on 409 — the turn is over", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    stubInput(409, { error: "No active turn", reason: "no_active_turn" });
    await expect(PrismService.postAgentInput("conv-1", { text: "hi" })).resolves.toBeNull();
  });

  it("returns null when Prism is unreachable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(PrismService.postAgentInput("conv-1", { text: "hi" })).resolves.toBeNull();
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

// /chat reads generation options at the top level of its body. They used
// to ride in a nested `options` bag it never reads, so every maxTokens /
// temperature lupos-bot sent through generateText was dropped.
describe("PrismService.generateText", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubChat() {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
        return new Response(JSON.stringify({ text: "ok", model: "m" }), { status: 200 });
      }),
    );
    return calls;
  }

  it("sends generation options flat, where /chat reads them", async () => {
    const calls = stubChat();
    await PrismService.generateText({
      messages: [{ role: "user", content: "hi" }],
      type: "OPENAI",
      model: "gpt-test",
      maxTokens: 200,
      temperature: 0.3,
      thinkingEnabled: false,
      responseFormat: "json_object",
    });
    expect(calls[0].url).toContain("/chat");
    expect(calls[0].body).toMatchObject({
      maxTokens: 200,
      temperature: 0.3,
      thinkingEnabled: false,
      responseFormat: "json_object",
    });
    expect(calls[0].body).not.toHaveProperty("options");
  });

  it("sends none of them when the caller asks for none", async () => {
    const calls = stubChat();
    await PrismService.generateText({
      messages: [{ role: "user", content: "hi" }],
      type: "GOOGLE",
      model: "gemini-test",
    });
    for (const key of ["maxTokens", "temperature", "thinkingEnabled", "responseFormat", "options"]) {
      expect(calls[0].body).not.toHaveProperty(key);
    }
  });
});
