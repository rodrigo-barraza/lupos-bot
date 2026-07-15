import { describe, it, expect, vi } from "vitest";
import DiscordUtilityService from "../DiscordUtilityService.js";
import type { Message } from "discord.js";

/**
 * Tests for the final hop of every bot reply: sendMessageInChunks.
 * Covers Discord's 2000-char chunking, attachment placement on the
 * last chunk, and the media-only path.
 */

interface SentPayload {
  content?: string;
  files?: { attachment: Buffer; name: string; description: string }[];
}

function makeFakeMessage() {
  const sent: SentPayload[] = [];
  const replied: SentPayload[] = [];
  const message = {
    channel: {
      send: vi.fn(async (payload: SentPayload) => {
        sent.push(payload);
        return { id: `sent-${sent.length}` };
      }),
    },
    reply: vi.fn(async (payload: SentPayload) => {
      replied.push(payload);
      return { id: `replied-${replied.length}` };
    }),
  };
  return { message: message as unknown as Message, sent, replied };
}

describe("sendMessageInChunks", () => {
  it("replies once for a short message", async () => {
    const { message, replied } = makeFakeMessage();
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      "hello world",
      null,
      null,
    );
    expect(replied).toHaveLength(1);
    expect(replied[0].content).toBe("hello world");
    expect(replied[0].files).toEqual([]);
  });

  it("splits long text into 2000-char chunks preserving all content", async () => {
    const { message, replied } = makeFakeMessage();
    const text = "a".repeat(2000) + "b".repeat(2000) + "c".repeat(500);
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      text,
      null,
      null,
    );
    expect(replied).toHaveLength(3);
    expect(replied[0].content).toBe("a".repeat(2000));
    expect(replied[1].content).toBe("b".repeat(2000));
    expect(replied[2].content).toBe("c".repeat(500));
    expect(replied.map((r) => r.content).join("")).toBe(text);
  });

  it("splits text exactly at the boundary without an empty trailing chunk", async () => {
    const { message, replied } = makeFakeMessage();
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      "x".repeat(4000),
      null,
      null,
    );
    expect(replied).toHaveLength(2);
    expect(replied.every((r) => r.content?.length === 2000)).toBe(true);
  });

  it("returns the first message of a multi-chunk reply", async () => {
    const { message } = makeFakeMessage();
    const result = await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      "y".repeat(4500),
      null,
      null,
    );
    expect(result).toEqual({ id: "replied-1" });
  });

  it("attaches the image only to the last chunk", async () => {
    const { message, replied } = makeFakeMessage();
    const imageBuffer = Buffer.from("fake-png-bytes");
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      "z".repeat(2500),
      imageBuffer,
      "a cool drawing",
    );
    expect(replied).toHaveLength(2);
    expect(replied[0].files).toEqual([]);
    expect(replied[1].files).toHaveLength(1);
    expect(replied[1].files![0].attachment).toBe(imageBuffer);
    expect(replied[1].files![0].name).toBe("a cool drawing.png");
  });

  it("sends a files-only message when there is an image but no text", async () => {
    const { message, replied } = makeFakeMessage();
    const imageBuffer = Buffer.from("only-image");
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      null,
      imageBuffer,
      null,
    );
    expect(replied).toHaveLength(1);
    expect(replied[0].content).toBeUndefined();
    expect(replied[0].files).toHaveLength(1);
  });

  it("uses channel.send instead of reply when told to send", async () => {
    const { message, sent, replied } = makeFakeMessage();
    const result = await DiscordUtilityService.sendMessageInChunks(
      "send",
      message,
      "broadcast",
      null,
      null,
    );
    expect(sent).toHaveLength(1);
    expect(replied).toHaveLength(0);
    expect(result).toEqual({ id: "sent-1" });
  });

  it("truncates very long image prompts in the filename and description", async () => {
    const { message, replied } = makeFakeMessage();
    const longPrompt = "p".repeat(2000);
    await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      "here",
      Buffer.from("img"),
      longPrompt,
    );
    const file = replied[0].files![0];
    expect(file.name).toBe("p".repeat(240) + ".png");
    expect(file.description).toBe("p".repeat(1000));
  });
});
