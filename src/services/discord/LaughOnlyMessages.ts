// ============================================================
// LaughOnlyMessages — delete a listed member's laugh-only posts
// ============================================================
// A member on the USER_IDS_LAUGH_ONLY_DELETED list (Mongo-backed, edited
// through /bot/settings) has every NEW message that is nothing but
// laughter — "lmao", "lol", "haha", "kek", "rofl", "xd", 😂 … in any
// spelling, repetition or mix — deleted as it arrives. Anything with a
// word that is not a laugh, an attachment or a sticker is left alone.
// ============================================================

import type { Message } from "discord.js";

/** One token of laughter, whole-token match, case-insensitive. */
const LAUGH_TOKEN = new RegExp(
  "^(?:" +
    [
      "l+(?:o+l+)+[sz]?", // lol lool lolol lolll lolz
      "l+m+f*a+o+[sz]?", // lmao lmfao lmaooo lmaos
      "r+o+t?f+l+(?:m+f*a+o+)?", // rofl rotfl roflmao
      "k+(?:e+k+)+w?", // kek kekw kekek
      "a?(?:[hj][ae]+){2,}[hj]?", // haha hehe jaja ahaha hahah jeje
      "[hj]a+h?", // ha hah ja
      "heh+", // heh
      "x+d+", // xd xdd
      "l+u+l+z?", // lul lulz
      "l+e+l+z?", // lel
      "l+a+w+l+", // lawl
    ].join("|") +
    ")$",
  "i",
);

/** Custom Discord emotes (`<:KEKW:123>`) whose NAME reads as a laugh. */
const LAUGH_EMOTE_NAME = /(kek|lu+l|lmao|lol|rofl|laugh|haha|jaja|xd)/i;

/** Unicode emoji that mean "that was funny". */
const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F606}\u{1F639}\u{1F480}]/gu; // 😂 🤣 😆 😹 💀

const CUSTOM_EMOTE = /<a?:(\w+):\d+>/g;
const VARIATION_SELECTORS = /[\u{FE0F}\u{200D}]/gu;
/** Whitespace, punctuation and the ASCII symbols people pad laughs with. */
const SEPARATORS = /[\s\p{P}~^+=<>|$`]+/u;

/**
 * True when `content` is nothing but laughter (at least one laugh token,
 * and every token a laugh). Media attached to the message disqualifies it.
 */
export function isLaughOnlyMessage(
  content: string | null | undefined,
  options: { hasMedia?: boolean } = {},
): boolean {
  if (options.hasMedia) return false;
  if (!content) return false;

  const normalized = content
    .replace(CUSTOM_EMOTE, (_whole, name: string) =>
      LAUGH_EMOTE_NAME.test(name) ? " lol " : ` :${name}: `,
    )
    .replace(VARIATION_SELECTORS, "")
    .replace(LAUGH_EMOJI, " lol ");

  const tokens = normalized.split(SEPARATORS).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => LAUGH_TOKEN.test(token));
}

/**
 * Delete `message` if it is laugh-only. Returns true when it was deleted,
 * false when it was kept (not laugh-only, or Discord refused the delete —
 * the message then flows through the pipeline as usual).
 */
export async function deleteIfLaughOnly(message: Message): Promise<boolean> {
  const hasMedia =
    (message.attachments?.size ?? 0) > 0 || (message.stickers?.size ?? 0) > 0;
  if (!isLaughOnlyMessage(message.content, { hasMedia })) return false;
  try {
    await message.delete();
    console.log(
      `🤐 [LaughOnlyMessages] Deleted laugh-only message ${message.id} from ${message.author?.tag ?? message.author?.id}: ${JSON.stringify(message.content)}`,
    );
    return true;
  } catch (error: unknown) {
    console.log(
      `Error deleting laugh-only message ${message.id} from ${message.author?.id}:`,
      error,
    );
    return false;
  }
}

const LaughOnlyMessages = { isLaughOnlyMessage, deleteIfLaughOnly };
export default LaughOnlyMessages;
