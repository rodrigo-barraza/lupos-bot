import { describe, expect, it, vi } from "vitest";
import { readSseEvents, aggregateAgentEvents } from "../PrismService.js";
import type { PrismSseEvent } from "#root/types/prism.js";

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

  it("throws on an error event", () => {
    expect(() =>
      aggregateAgentEvents([{ type: "error", message: "provider exploded" }]),
    ).toThrow("provider exploded");
  });
});
