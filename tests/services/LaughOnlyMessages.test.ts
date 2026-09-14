/**
 * LaughOnlyMessages.test.ts
 *
 * A listed member's laugh-only messages are deleted on arrival. These pin
 * what counts as "nothing but laughing" (src/services/discord/LaughOnlyMessages.ts)
 * and that the delete wrapper keeps anything it should not touch.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isLaughOnlyMessage,
  deleteIfLaughOnly,
} from "#root/services/discord/LaughOnlyMessages.ts";

const LAUGHS = [
  "lol",
  "LOL",
  "lool",
  "loool",
  "lolol",
  "lolll",
  "lolz",
  "lmao",
  "LMAO",
  "lmaooo",
  "lmfao",
  "LMFAOOOO",
  "lmaao",
  "haha",
  "hahaha",
  "HAHAHAHA",
  "hahah",
  "ahaha",
  "ahahaha",
  "ha",
  "hah",
  "heh",
  "hehe",
  "hehehe",
  "jaja",
  "jajaja",
  "jeje",
  "kek",
  "kekw",
  "KEKW",
  "kekek",
  "rofl",
  "ROFL",
  "rotfl",
  "roflmao",
  "xd",
  "XD",
  "xDD",
  "XDDDD",
  "lul",
  "lulz",
  "lel",
  "lawl",
  "😂",
  "🤣",
  "😆",
  "💀",
  "😂😂😂",
  "😂🤣",
  "<:kekw:123456789>",
  "<a:KEKW:123456789>",
  "<:OMEGALUL:1>",
  "<:PepeLaugh:1>",
];

const MIXED_LAUGHS = [
  "lol lmao",
  "lmao 😂",
  "hahaha lol",
  "LMAOOO 💀💀",
  "lol!!!",
  "lol.",
  "lol...",
  "~lol~",
  "**lol**",
  "||lol||",
  "lol\nlmao",
  "haha  haha",
  "lol lol lol",
  "🤣🤣 lmfao",
  "(lol)",
  '"lol"',
];

const NOT_LAUGHS = [
  "",
  "   ",
  "lol what",
  "lmao no way",
  "haha ok",
  "that's funny",
  "hello",
  "hi",
  "he",
  "lo",
  "lo lo",
  "ok",
  "kekw is my favourite emote",
  "lol 👍",
  "👍",
  "😭",
  "lol <:sadge:1>",
  "<:sadge:1>",
  "https://example.com lol",
  "lol @everyone",
  "lolita",
  "loll x",
  "hahaha!!! nice",
  "xdd right",
  "rofl copter",
  "lmfao'd",
  "l",
  "h",
  "a",
  "ha ha ha ha yes",
];

describe("isLaughOnlyMessage", () => {
  it.each(LAUGHS)("matches a lone laugh: %j", (content) => {
    expect(isLaughOnlyMessage(content)).toBe(true);
  });

  it.each(MIXED_LAUGHS)(
    "matches laughs mixed with laughs and padding: %j",
    (content) => {
      expect(isLaughOnlyMessage(content)).toBe(true);
    },
  );

  it.each(NOT_LAUGHS)(
    "keeps anything that is not only a laugh: %j",
    (content) => {
      expect(isLaughOnlyMessage(content)).toBe(false);
    },
  );

  it("keeps a laugh that carries media", () => {
    expect(isLaughOnlyMessage("lol", { hasMedia: true })).toBe(false);
  });

  it("keeps null and undefined content", () => {
    expect(isLaughOnlyMessage(null)).toBe(false);
    expect(isLaughOnlyMessage(undefined)).toBe(false);
  });
});

function fakeMessage(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: "1",
    content,
    author: { id: "469535087114059776", tag: "someone" },
    attachments: new Map(),
    stickers: new Map(),
    delete: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

describe("deleteIfLaughOnly", () => {
  it("deletes a laugh-only message and reports it", async () => {
    const message = fakeMessage("lmao");
    await expect(deleteIfLaughOnly(message as never)).resolves.toBe(true);
    expect(message.delete).toHaveBeenCalledTimes(1);
  });

  it("keeps a message with words in it", async () => {
    const message = fakeMessage("lmao that was wild");
    await expect(deleteIfLaughOnly(message as never)).resolves.toBe(false);
    expect(message.delete).not.toHaveBeenCalled();
  });

  it("keeps a laugh with an attachment or a sticker", async () => {
    const withAttachment = fakeMessage("lol", {
      attachments: new Map([["a", {}]]),
    });
    const withSticker = fakeMessage("lol", { stickers: new Map([["s", {}]]) });
    await expect(deleteIfLaughOnly(withAttachment as never)).resolves.toBe(
      false,
    );
    await expect(deleteIfLaughOnly(withSticker as never)).resolves.toBe(false);
    expect(withAttachment.delete).not.toHaveBeenCalled();
    expect(withSticker.delete).not.toHaveBeenCalled();
  });

  it("reports false when Discord refuses the delete", async () => {
    const message = fakeMessage("lol", {
      delete: vi.fn().mockRejectedValue(new Error("Missing Permissions")),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(deleteIfLaughOnly(message as never)).resolves.toBe(false);
    log.mockRestore();
  });
});
