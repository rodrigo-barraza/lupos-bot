import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import config from "#root/config.ts";
import PrismService from "../PrismService.ts";

// Prism admits a server only when it presents the service secret as
// x-api-secret; without it every call Lupos makes is refused. The client
// is built once, on the first call, so the secret is set before any.

const SECRET = "test-service-secret";

interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
}

/** Stub global fetch: /agent streams one done frame, everything else is JSON. */
function stubPrism(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
      });
      if (url.endsWith("/agent")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response(
        JSON.stringify({ text: "ok", ok: true, inputId: "input-1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return calls;
}

beforeAll(() => {
  config.PRISM_API_URL = "http://prism.test";
  config.PRISM_SERVICE_API_SECRET = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PrismService — service credential", () => {
  it("sends x-api-secret on JSON, streaming and GET calls alike", async () => {
    const calls = stubPrism();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await PrismService.generateText({
      messages: [{ role: "user", content: "hi" }],
      type: "GOOGLE",
      model: "gemini-test",
    });
    await PrismService.generateAgentResponse({
      messages: [{ role: "user", content: "hi" }],
      type: "GOOGLE",
      model: "gemini-test",
      onEvent: () => {},
    });
    await PrismService.postAgentInput("conversation-1", { text: "and also" });
    await PrismService.stopAgentTurn("conversation-1");
    await PrismService.getSomaticSnapshot();
    await PrismService.searchMemories({ guildId: "guild-1", queryText: "q" });

    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toEqual([
      "POST /chat",
      "POST /agent",
      "POST /agent/input",
      "POST /agent/stop",
      "GET /somatic/LUPOS",
      "POST /memory/search",
    ]);
    for (const call of calls) {
      expect(call.headers.get("x-api-secret")).toBe(SECRET);
    }
  });

  it("keeps naming the member it speaks for beside the secret", async () => {
    const calls = stubPrism();
    await PrismService.generateText({
      messages: [{ role: "user", content: "hi" }],
      type: "GOOGLE",
      model: "gemini-test",
      username: "some-member",
    });
    expect(calls[0].headers.get("x-api-secret")).toBe(SECRET);
    expect(calls[0].headers.get("x-username")).toBe("some-member");
    expect(calls[0].headers.get("x-project")).toBe("lupos");
  });
});
