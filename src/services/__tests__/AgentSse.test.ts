import { describe, expect, it, vi } from "vitest";
import { readSseEvents, aggregateAgentEvents } from "../PrismService.ts";
import type { PrismSseEvent } from "#root/types/prism.ts";

/** Build a Response streaming the given SSE frames in arbitrary chunks. */
function sseResponse(frames: string[], chunkSize = 7): Response {
  const raw = frames.join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < raw.length; i += chunkSize) {
        controller.enqueue(encoder.encode(raw.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("readSseEvents", () => {
  it("parses events split across arbitrary network chunks", async () => {
    const response = sseResponse([
      frame({ type: "thinking", content: "hm" }),
      frame({ type: "chunk", content: "Hello " }),
      frame({ type: "chunk", content: "world" }),
      frame({ type: "done", model: "m", provider: "p" }),
    ]);
    const events = await readSseEvents(response);
    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "chunk",
      "chunk",
      "done",
    ]);
  });

  it("invokes onEvent per event and survives a throwing callback", async () => {
    const seen: string[] = [];
    const onEvent = vi.fn((event: PrismSseEvent) => {
      seen.push(event.type);
      throw new Error("presence hiccup");
    });
    const events = await readSseEvents(
      sseResponse([frame({ type: "chunk", content: "a" }), frame({ type: "done" })]),
      onEvent,
    );
    expect(events).toHaveLength(2);
    expect(seen).toEqual(["chunk", "done"]);
  });

  it("skips malformed frames", async () => {
    const events = await readSseEvents(
      sseResponse([
        "data: {not json}\n\n",
        ": keep-alive comment\n\n",
        frame({ type: "done" }),
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });
});

describe("aggregateAgentEvents", () => {
  it("rebuilds the non-streaming JSON shape", () => {
    const events: PrismSseEvent[] = [
      { type: "thinking", content: "pondering" },
      {
        type: "tool_execution",
        status: "calling",
        tool: { name: "get_weather", args: { location: "Vancouver" } },
      },
      {
        type: "tool_execution",
        status: "done",
        tool: {
          name: "get_weather",
          args: { location: "Vancouver" },
          result: { temperature: 18 },
        },
      },
      { type: "image", mimeType: "image/png", minioRef: "minio://gen/a.png" },
      { type: "chunk", content: "It's " },
      { type: "chunk", content: "18°C" },
      {
        type: "done",
        model: "gemini",
        provider: "google",
        audioRef: "minio://gen/bark.wav",
      },
    ];
    const aggregated = aggregateAgentEvents(events);
    expect(aggregated.text).toBe("It's 18°C");
    expect(aggregated.toolCalls).toEqual([
      { name: "get_weather", args: { location: "Vancouver" } },
    ]);
    expect(aggregated.toolResults).toEqual([
      {
        name: "get_weather",
        args: { location: "Vancouver" },
        result: { temperature: 18 },
        status: "done",
      },
    ]);
    expect(aggregated.images).toEqual([
      { data: undefined, mimeType: "image/png", minioRef: "minio://gen/a.png" },
    ]);
    expect(aggregated.audioRef).toBe("minio://gen/bark.wav");
    expect(aggregated.model).toBe("gemini");
    expect(aggregated.provider).toBe("google");
  });

  it("returns null text when nothing streamed", () => {
    expect(aggregateAgentEvents([{ type: "done" }]).text).toBeNull();
  });

  it("keeps only the last pass's text when reasoning leaks mid-loop", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Let's see, what notes should " },
      { type: "chunk", content: "the trumpet play?" },
      { type: "tool_execution", status: "calling", tool: { name: "generate_audio" } },
      { type: "tool_execution", status: "done", tool: { name: "generate_audio" } },
      { type: "chunk", content: "Behold, " },
      { type: "chunk", content: "your anthem!" },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe("Behold, your anthem!");
  });

  it("falls back to text written before a silent trailing tool call", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Here you go, mortal." },
      {
        type: "tool_execution",
        status: "calling",
        tool: { name: "react_to_discord_message" },
      },
      {
        type: "tool_execution",
        status: "done",
        tool: { name: "react_to_discord_message" },
      },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe("Here you go, mortal.");
  });

  it("throws on an error event", () => {
    expect(() =>
      aggregateAgentEvents([{ type: "error", message: "provider exploded" }]),
    ).toThrow("provider exploded");
  });
});

// A follow-up folded into the running turn (POST /agent/input) is
// acknowledged on the stream with a `turn_input` event naming the
// boundary it was applied at.
describe("aggregateAgentEvents — folded follow-ups", () => {
  const folded = (boundary: string): PrismSseEvent => ({
    type: "turn_input",
    id: "input-1",
    kind: "user_update",
    boundary,
  });

  it("keeps the finished reply AND the follow-up's answer when it landed at before_end", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Ramen on main. " },
      folded("before_end"),
      { type: "chunk", content: "And yes, they do takeout." },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe(
      "Ramen on main. \n\nAnd yes, they do takeout.",
    );
  });

  it("still drops mid-loop planning around a before_end fold", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "let me look that up" },
      { type: "tool_execution", status: "calling", tool: { name: "search_web" } },
      { type: "tool_execution", status: "done", tool: { name: "search_web" } },
      { type: "chunk", content: "It opens at noon." },
      folded("before_end"),
      { type: "chunk", content: "checking hours again" },
      { type: "tool_execution", status: "calling", tool: { name: "search_web" } },
      { type: "tool_execution", status: "done", tool: { name: "search_web" } },
      { type: "chunk", content: "Sundays too." },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe(
      "It opens at noon.\n\nSundays too.",
    );
  });

  it("keeps only the last pass when the follow-up landed mid-loop", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "let me check" },
      { type: "tool_execution", status: "calling", tool: { name: "search_web" } },
      { type: "tool_execution", status: "done", tool: { name: "search_web" } },
      folded("after_tools"),
      { type: "chunk", content: "Noon, and they do takeout." },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe("Noon, and they do takeout.");
  });

  it("keeps one pass whole when the provider applied the follow-up mid-stream", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Ramen on main, " },
      folded("native_steer"),
      { type: "chunk", content: "and yes, they do takeout." },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe(
      "Ramen on main, and yes, they do takeout.",
    );
  });

  it("keeps the reply when the follow-up joined only as the turn ended", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Ramen on main." },
      folded("turn_end"),
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe("Ramen on main.");
  });

  it("does not repeat a finished reply when the follow-up got no words", () => {
    const events: PrismSseEvent[] = [
      { type: "chunk", content: "Ramen on main." },
      folded("before_end"),
      {
        type: "tool_execution",
        status: "calling",
        tool: { name: "react_to_discord_message" },
      },
      { type: "done" },
    ];
    expect(aggregateAgentEvents(events).text).toBe("Ramen on main.");
  });
});
