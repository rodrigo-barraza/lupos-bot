import { describe, it, expect } from "vitest";
import { collectMessageBodyParts } from "#root/services/discord/ConversationExtractor.ts";
import type { Message } from "discord.js";

// collectMessageBodyParts only touches: message.id, message.attachments
// (iterable of Attachment-likes), message.stickers.size, and the two
// per-message collections (Map-compatible). Mongo is only reached through
// collectStickerPart, which bails when stickers.size !== 1.
function fakeMessage(
  attachments: Array<{
    contentType: string | null;
    url: string;
    proxyURL?: string;
    name?: string;
    size?: number;
  }>,
): Message {
  return {
    id: "msg-1",
    attachments: { values: () => attachments.values() },
    stickers: { size: 0 },
  } as unknown as Message;
}

const emptyCollections = {
  transcriptions: new Map() as never,
  images: new Map() as never,
};

describe("collectMessageBodyParts — non-image attachments", () => {
  it("emits file parts with URL handles for text/PDF attachments", async () => {
    const { attachments } = await collectMessageBodyParts(
      fakeMessage([
        {
          contentType: "text/plain; charset=utf-8",
          url: "https://cdn.discordapp.com/attachments/1/2/notes.txt?ex=a&is=b",
          name: "notes.txt",
          size: 4096,
        },
        {
          contentType: "application/pdf",
          url: "https://cdn.discordapp.com/attachments/1/2/report.pdf",
          name: "report.pdf",
          size: 2 * 1024 * 1024,
        },
      ]),
      emptyCollections.transcriptions,
      emptyCollections.images,
      null as never,
    );

    expect(attachments).toEqual([
      {
        kind: "file",
        description: "notes.txt",
        sizeMb: "0.00",
        url: "https://cdn.discordapp.com/attachments/1/2/notes.txt?ex=a&is=b",
      },
      {
        kind: "file",
        description: "report.pdf",
        sizeMb: "2.00",
        url: "https://cdn.discordapp.com/attachments/1/2/report.pdf",
      },
    ]);
  });

  it("classifies video and audio, and skips images (captioned path owns them)", async () => {
    const { attachments } = await collectMessageBodyParts(
      fakeMessage([
        {
          contentType: "video/mp4",
          url: "https://cdn.discordapp.com/attachments/1/2/clip.mp4",
          name: "clip.mp4",
        },
        {
          contentType: "audio/ogg",
          url: "https://cdn.discordapp.com/attachments/1/2/voice.ogg",
          name: "voice.ogg",
        },
        {
          contentType: "image/png",
          url: "https://cdn.discordapp.com/attachments/1/2/pic.png",
          name: "pic.png",
        },
      ]),
      emptyCollections.transcriptions,
      emptyCollections.images,
      null as never,
    );

    expect(attachments.map((attachment) => attachment.kind)).toEqual([
      "video",
      "audio",
    ]);
    expect(attachments[0].url).toBe(
      "https://cdn.discordapp.com/attachments/1/2/clip.mp4",
    );
  });

  it("treats a missing contentType as a file", async () => {
    const { attachments } = await collectMessageBodyParts(
      fakeMessage([
        {
          contentType: null,
          url: "https://cdn.discordapp.com/attachments/1/2/mystery.bin",
          name: "mystery.bin",
        },
      ]),
      emptyCollections.transcriptions,
      emptyCollections.images,
      null as never,
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("file");
  });
});
