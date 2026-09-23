// ============================================================
// Addressee — is a guild message talking TO Lupos?
// ============================================================
// Lupos used to answer only @-mentions, so a reply to one of his own
// messages with the ping switched off, or a plain "lupos, what do you
// think?", went unanswered. A message is addressed to him when it:
//   - @-mentions him (message.mentions.has — unchanged semantics);
//   - replies to one of his messages, ping on OR off. discord.js's
//     mentions.has() counts the replied-to author only when the ping is
//     on (MessageMentions.has requires them in mentions.users, which
//     Discord fills only for a pinging reply), so the reply is resolved
//     from mentions.repliedUser — set from referenced_message either way
//     — or, when that is missing, from the referenced message itself;
//   - uses his name vocatively: at the start ("lupos, …", "hey lupos …",
//     "lupos what do you think") or at the end after a comma or a
//     greeting ("…, lupos?", "thanks lupos"). A name in the middle of a
//     sentence ("i think lupos is broken") is talk ABOUT him — that is
//     the ambient path's business, not an address.
// ============================================================

import { MessageType } from "discord.js";
import type { Message, User } from "discord.js";

/** The names that address Lupos (matched whole-word, case-insensitive). */
export const LUPOS_NAME_ALIASES: readonly string[] = ["lupos"];

/** How a message reached Lupos. */
export type AddressingMode = "mention" | "reply" | "name";
/** How a queued reply was triggered — "ambient" = nobody addressed him. */
export type ReplyMode = AddressingMode | "ambient";

// Words that put a following name in the vocative: greetings, thanks,
// sign-offs, pleas. "ok lupos", "thanks lupos", "gn lupos".
const GREETINGS = [
  "hey",
  "hi",
  "hello",
  "hiya",
  "howdy",
  "yo",
  "ok",
  "okay",
  "oi",
  "ayo",
  "sup",
  "dear",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "gm",
  "gn",
  "good morning",
  "good night",
  "please",
  "pls",
  "plz",
];

// A name that opens a message with no comma is only an address when the
// next word turns to him: a second-person word, a question word or an
// imperative ("lupos what do you think", "lupos draw me a cat") —
// never a third-person verb ("lupos is broken", "lupos can't draw").
const SECOND_PERSON = ["you", "u", "ya", "ur", "your", "youre", "you're", "yall", "y'all"];
const QUESTION_WORDS = [
  "what",
  "whats",
  "what's",
  "why",
  "how",
  "who",
  "whos",
  "who's",
  "when",
  "where",
  "which",
  "wyd",
  "wya",
];
const IMPERATIVES = [
  "tell",
  "draw",
  "make",
  "show",
  "give",
  "say",
  "help",
  "explain",
  "roast",
  "rate",
  "sing",
  "write",
  "generate",
  "create",
  "paint",
  "find",
  "search",
  "play",
  "pick",
  "describe",
  "translate",
  "summarize",
  "summarise",
  "check",
  "look",
  "come",
  "stop",
  "shut",
  "please",
  "pls",
  "plz",
];
// Auxiliaries count only when "you" follows: "lupos can you …" is an
// address, "lupos can draw" / "lupos will be back" are not.
const AUXILIARIES = ["can", "could", "would", "will", "do", "did", "are", "should", "have"];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(words: readonly string[]): string {
  return words
    .map((word) => escapeRegex(word).replace(/\\?'/g, "['’]").replace(/ /g, "\\s+"))
    .join("|");
}

// Not followed by more of a word (so "luposs" and "lupos's" don't count).
const WORD_END = "(?![\\p{L}\\p{N}_'’])";
// Trailing decoration after a closing name: punctuation, whitespace,
// unicode or custom Discord emoji.
const TRAILING_DECORATION =
  "(?:[\\s?!.…~]|\\p{Extended_Pictographic}|\\u{FE0F}|\\u{200D}|<a?:\\w+:\\d+>)*$";

interface AddressPatterns {
  leading: RegExp;
  trailing: RegExp;
}

const patternCache = new Map<string, AddressPatterns>();

function patternsFor(aliases: readonly string[]): AddressPatterns {
  const key = aliases.join("\u0000");
  const cached = patternCache.get(key);
  if (cached) return cached;
  const name = `@?(?:${alternation(aliases)})${WORD_END}`;
  const greeting = `(?:${alternation(GREETINGS)})${WORD_END}`;
  const cue =
    `(?:${alternation([...SECOND_PERSON, ...QUESTION_WORDS, ...IMPERATIVES])})${WORD_END}` +
    `|(?:${alternation(AUXILIARIES)})\\s+(?:${alternation(["you", "u", "ya", "ye"])})${WORD_END}`;
  const patterns = {
    // "hey lupos …" (anything may follow), or "lupos" followed by the
    // end, punctuation, or a word that turns to him.
    leading: new RegExp(
      `^\\s*(?:(?:${greeting})[\\s,!.]+){1,2}${name}` +
        `|^\\s*${name}(?:\\s*$|\\s*[,:;!?.…]|\\s+(?:${cue}))`,
      "iu",
    ),
    // "…, lupos?" / "thanks lupos" / "gn lupos 🐺" at the very end.
    trailing: new RegExp(
      `(?:,\\s*|(?:^|\\s)(?:${greeting})[\\s,]+)${name}${TRAILING_DECORATION}`,
      "iu",
    ),
  };
  patternCache.set(key, patterns);
  return patterns;
}

/**
 * Whether the text addresses Lupos by name — vocatively, at its start or
 * its end. A name mid-sentence is not an address.
 */
export function isAddressedByName(
  text: string | null | undefined,
  aliases: readonly string[] = LUPOS_NAME_ALIASES,
): boolean {
  if (!text || !aliases.length) return false;
  const { leading, trailing } = patternsFor(aliases);
  const trimmed = text.trim();
  return leading.test(trimmed) || trailing.test(trimmed);
}

/**
 * Whether the message is a reply to one of `userId`'s messages — with the
 * reply ping on or off. Resolution order: mentions.repliedUser (from the
 * gateway's referenced_message), the channel's message cache, then a
 * fetch of the referenced message. Anything unresolvable is "no".
 */
export async function repliesToUser(
  message: Message,
  userId: string,
): Promise<boolean> {
  // Only a real reply — a pin notice, thread starter or forward carries
  // a reference too.
  if (message.type !== MessageType.Reply) return false;
  const referencedMessageId = message.reference?.messageId;
  if (!referencedMessageId) return false;

  const repliedUser = message.mentions?.repliedUser;
  if (repliedUser) return repliedUser.id === userId;

  const cachedReference =
    message.channel?.messages?.cache?.get(referencedMessageId);
  if (cachedReference) return cachedReference.author?.id === userId;

  try {
    const referencedMessage = await message.fetchReference();
    return referencedMessage.author?.id === userId;
  } catch {
    // Deleted or inaccessible — nothing to reply to.
    return false;
  }
}

/**
 * How (if at all) a guild message addresses Lupos: "mention", "reply"
 * or "name", checked in that order; null when it doesn't.
 */
export async function resolveAddressing(
  message: Message,
  botUser: User,
): Promise<AddressingMode | null> {
  if (message.mentions.has(botUser)) return "mention";
  if (await repliesToUser(message, botUser.id)) return "reply";
  if (isAddressedByName(message.content)) return "name";
  return null;
}
