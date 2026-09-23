import { describe, it, expect, vi } from "vitest";
import { MessageType } from "discord.js";
import type { Message, User } from "discord.js";
import {
  isAddressedByName,
  repliesToUser,
  resolveAddressing,
  LUPOS_NAME_ALIASES,
} from "../Addressee.ts";

describe("isAddressedByName", () => {
  it.each([
    "lupos, what do you think?",
    "Lupos: draw me a cat",
    "LUPOS!!!",
    "lupos?",
    "lupos",
    "hey lupos",
    "hey lupos what's the weather",
    "yo lupos you up?",
    "ok lupos settle this",
    "okay, lupos, settle this",
    "hey hey lupos",
    "thanks lupos",
    "thank you lupos 🐺",
    "gn lupos",
    "what do you think, lupos?",
    "is this true, Lupos?",
    "that's enough, lupos <:kek:123456789012345678>",
    "lupos what do you think",
    "lupos draw me a wolf",
    "lupos can you roast him",
    "lupos you're so dumb",
    "lupos u there",
    "Lupos how are you",
    "@lupos, hi",
  ])("addressed: %s", (text) => {
    expect(isAddressedByName(text)).toBe(true);
  });

  it.each([
    "i think lupos is broken",
    "lupos is broken again",
    "lupos can't draw",
    "lupos will be back later",
    "lupos's drawings are cursed",
    "luposs, hi",
    "i love lupos",
    "blame lupos",
    "did you ask lupos?",
    "lupos said something weird earlier",
    "lupos made this yesterday",
    "the lupos bot",
    "",
    "   ",
  ])("not addressed: %s", (text) => {
    expect(isAddressedByName(text)).toBe(false);
  });

  it("ships with lupos as the only alias", () => {
    expect(LUPOS_NAME_ALIASES).toEqual(["lupos"]);
  });

  it("takes other aliases", () => {
    expect(isAddressedByName("hey wolfie", ["lupos", "wolfie"])).toBe(true);
    expect(isAddressedByName("hey wolfie", ["lupos"])).toBe(false);
  });

  it("is null-safe", () => {
    expect(isAddressedByName(undefined)).toBe(false);
    expect(isAddressedByName(null)).toBe(false);
  });
});

const BOT_ID = "900000000000000001";
const HUMAN_ID = "900000000000000002";

/** A reply message; `repliedUser` mirrors discord.js (set from referenced_message). */
function replyMessage({
  type = MessageType.Reply,
  repliedUserId,
  cachedAuthorId,
  fetchedAuthorId,
  mentionsBot = false,
  content = "",
}: {
  type?: MessageType;
  repliedUserId?: string;
  cachedAuthorId?: string;
  fetchedAuthorId?: string;
  mentionsBot?: boolean;
  content?: string;
}) {
  const cache = new Map<string, { author: { id: string } }>();
  if (cachedAuthorId) cache.set("ref-1", { author: { id: cachedAuthorId } });
  const fetchReference = vi.fn(async () => {
    if (!fetchedAuthorId) throw new Error("Unknown Message");
    return { author: { id: fetchedAuthorId } };
  });
  return {
    message: {
      type,
      content,
      reference: { messageId: "ref-1", channelId: "c1" },
      mentions: {
        repliedUser: repliedUserId ? { id: repliedUserId } : null,
        // discord.js: a reply counts via has() only with the ping ON.
        has: vi.fn(() => mentionsBot),
      },
      channel: { messages: { cache } },
      fetchReference,
    } as unknown as Message,
    fetchReference,
  };
}

describe("repliesToUser", () => {
  it("counts a reply with the ping OFF (repliedUser set, not in mentions)", async () => {
    const { message } = replyMessage({ repliedUserId: BOT_ID });
    expect(await repliesToUser(message, BOT_ID)).toBe(true);
  });

  it("is false for a reply to someone else", async () => {
    const { message, fetchReference } = replyMessage({ repliedUserId: HUMAN_ID });
    expect(await repliesToUser(message, BOT_ID)).toBe(false);
    expect(fetchReference).not.toHaveBeenCalled();
  });

  it("resolves the author from the channel cache when repliedUser is missing", async () => {
    const { message, fetchReference } = replyMessage({ cachedAuthorId: BOT_ID });
    expect(await repliesToUser(message, BOT_ID)).toBe(true);
    expect(fetchReference).not.toHaveBeenCalled();
  });

  it("fetches the referenced message as a last resort", async () => {
    const { message, fetchReference } = replyMessage({ fetchedAuthorId: BOT_ID });
    expect(await repliesToUser(message, BOT_ID)).toBe(true);
    expect(fetchReference).toHaveBeenCalledOnce();
  });

  it("is false when the referenced message is gone", async () => {
    const { message } = replyMessage({});
    expect(await repliesToUser(message, BOT_ID)).toBe(false);
  });

  it("ignores pin notices, thread starters and forwards", async () => {
    for (const type of [
      MessageType.ChannelPinnedMessage,
      MessageType.ThreadStarterMessage,
      MessageType.Default,
    ]) {
      const { message } = replyMessage({ type, repliedUserId: BOT_ID });
      expect(await repliesToUser(message, BOT_ID)).toBe(false);
    }
  });
});

describe("resolveAddressing", () => {
  const bot = { id: BOT_ID } as User;

  it("prefers the @-mention", async () => {
    const { message } = replyMessage({ mentionsBot: true, repliedUserId: BOT_ID });
    expect(await resolveAddressing(message, bot)).toBe("mention");
  });

  it("then the reply to one of his messages", async () => {
    const { message } = replyMessage({ repliedUserId: BOT_ID, content: "lol" });
    expect(await resolveAddressing(message, bot)).toBe("reply");
  });

  it("then his name used vocatively", async () => {
    const { message } = replyMessage({
      repliedUserId: HUMAN_ID,
      content: "lupos, back me up here",
    });
    expect(await resolveAddressing(message, bot)).toBe("name");
  });

  it("is null for talk about him", async () => {
    const { message } = replyMessage({
      repliedUserId: HUMAN_ID,
      content: "honestly lupos is the worst bot",
    });
    expect(await resolveAddressing(message, bot)).toBeNull();
  });
});
