// ============================================================
// MessageEnvelope — XML envelope rendering for Discord messages
// ============================================================
// Single source of truth for the wire format of Discord messages
// sent to the agent harness. One <discord-message> envelope per
// message, following Prism's canonical tag convention (kebab-case
// tags on their own lines, blank line between tag and content —
// see prism-service src/utils/SystemMessageTags.ts).
//
// Design rules:
//   - Scalar metadata lives in attributes (id, author, time, …).
//   - Untrusted user text is ONLY ever an element body, and is
//     passed through sanitizeUntrustedText() so a user can never
//     forge envelope structure or harness system tags.
//   - Message ids are real Discord snowflakes — stable across
//     requests (KV-cache friendly) and directly usable with tools
//     like react_to_discord_message.
//   - Timestamps are absolute ISO-8601 with offset. Never relative
//     ("2 minutes ago") — relative strings change every request and
//     bust the provider prompt cache.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.ts";

// ─── Sanitization ─────────────────────────────────────────────

// Tags the envelope itself uses that don't contain a hyphen or
// underscore. Any hyphenated/underscored tag name is reserved as a
// class (covers every current and future harness tag: <discord-message>,
// <system-context>, <agent-memory>, legacy <message_content>, …) —
// Discord's own angle-bracket syntax (<@id>, <:emoji:123>, <t:…:R>,
// <https://…>) never matches because it contains ':', '@' or '/'
// immediately after '<'.
const SINGLE_WORD_RESERVED = [
  "content",
  "reactions",
  "attachment",
  "transcription",
  "sticker",
  "embed",
];

const RESERVED_TAG_PATTERN = new RegExp(
  `<(?=/?(?:${SINGLE_WORD_RESERVED.join("|")}|[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)[\\s/>])`,
  "gi",
);

/**
 * Neutralize anything in untrusted text that could parse as an
 * envelope tag or harness system tag. Replaces the opening '<' with
 * a visually identical single guillemet so the text stays readable
 * but can never close/open a structural tag. Legitimate Discord
 * syntax (mentions, custom emojis, timestamps, bracketed links) is
 * untouched.
 */
export function sanitizeUntrustedText(text: string): string {
  if (!text) return text;
  return text.replace(RESERVED_TAG_PATTERN, "‹");
}

/** Escape a string for use inside a double-quoted XML attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escape a URL for a double-quoted attribute WITHOUT entity-encoding `&`.
 * Signed CDN URLs (`?ex=…&is=…&hm=…`) must survive the model copying them
 * verbatim into tool arguments — `&amp;` would break the signature.
 */
export function escapeUrlAttribute(value: string): string {
  return value
    .replace(/"/g, "%22")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s+/g, "")
    .trim();
}

/** Format epoch milliseconds as ISO-8601 with offset (second precision). */
export function toIsoTime(epochMs: number): string {
  const zdt = TemporalHelpers.fromMillis(epochMs);
  return zdt.toString({
    smallestUnit: "second",
    timeZoneName: "never",
    offset: "auto",
  });
}

// ─── Envelope data model ──────────────────────────────────────

export interface AttachmentPart {
  /** "image" | "video" | "audio" | "file" */
  kind: string;
  /** Vision caption or attachment description (untrusted-ish, sanitized). */
  caption?: string;
  /**
   * Uploader-provided description. For the bot's own generated images this
   * is the generate_image prompt — kept separate from the vision caption.
   */
  description?: string;
  /** "1024x768" */
  dimensions?: string;
  /** File size in MB, already formatted ("1.24"). */
  sizeMb?: string;
  /**
   * Direct http(s) link so the agent has a real handle to pass into
   * image tools (manipulate_image, scan_barcode, …) — it sees attached
   * images only as pixels otherwise. Omit data: URIs.
   */
  url?: string;
}

export interface StickerPart {
  name: string;
  description?: string;
  caption?: string;
  /** Direct http(s) link — handle for image tools (redraw, manipulate). */
  url?: string;
}

export interface EmbedPart {
  title?: string;
  description?: string;
  url?: string;
  /** "Field name: value" lines. */
  fields?: string[];
  footer?: string;
}

export interface ReactionsPart {
  count: number;
  /** Inline list, e.g. "👋 (by you, Lupos) 🍩 (4)". */
  list: string;
}

export interface MessageBodyParts {
  /** Raw message text (untrusted — sanitized at render time). */
  content?: string;
  /** Voice-message transcription (untrusted — sanitized at render time). */
  transcription?: string;
  attachments?: AttachmentPart[];
  sticker?: StickerPart;
  reactions?: ReactionsPart;
}

export interface ReplyToPart extends MessageBodyParts {
  /** Discord snowflake of the replied-to message. */
  id: string;
  author?: string;
  authorId?: string;
  /** ISO-8601 with offset. */
  time?: string;
  /** The replied-to message appears in full earlier in this conversation. */
  inContext?: boolean;
  /** The replied-to message was deleted. */
  deleted?: boolean;
}

export interface DiscordMessageEnvelope extends MessageBodyParts {
  /** Discord snowflake. */
  id: string;
  /** Display name (server nickname > global name > username). */
  author: string;
  /** Discord user id — mention the author with <@author-id>. */
  authorId: string;
  /** Username, included only when it differs from the display name. */
  authorUsername?: string;
  /** ISO-8601 with offset. */
  time: string;
  /** Position in a same-author burst, only when the burst has >1 message. */
  sequence?: { index: number; total: number };
  edited?: boolean;
  replyTo?: ReplyToPart;
}

// ─── Rendering ────────────────────────────────────────────────

function attr(name: string, value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${escapeAttribute(value)}"`;
}

function renderAttachment(attachment: AttachmentPart): string {
  const urlAttr =
    attachment.url && /^https?:\/\//.test(attachment.url)
      ? ` url="${escapeUrlAttribute(attachment.url)}"`
      : "";
  const attrs =
    attr("kind", attachment.kind) +
    attr("description", attachment.description) +
    attr("dimensions", attachment.dimensions) +
    attr("size-mb", attachment.sizeMb) +
    urlAttr;
  if (attachment.caption) {
    return `<attachment${attrs}>${sanitizeUntrustedText(attachment.caption)}</attachment>`;
  }
  return `<attachment${attrs} />`;
}

function renderSticker(sticker: StickerPart): string {
  const urlAttr =
    sticker.url && /^https?:\/\//.test(sticker.url)
      ? ` url="${escapeUrlAttribute(sticker.url)}"`
      : "";
  const attrs =
    attr("name", sticker.name) +
    attr("description", sticker.description) +
    urlAttr;
  if (sticker.caption) {
    return `<sticker${attrs}>${sanitizeUntrustedText(sticker.caption)}</sticker>`;
  }
  return `<sticker${attrs} />`;
}

function renderReactions(reactions: ReactionsPart): string {
  return `<reactions count="${reactions.count}">${sanitizeUntrustedText(reactions.list)}</reactions>`;
}

export function renderEmbed(embed: EmbedPart): string {
  // url uses the raw-& escape: signed/parameterized URLs must survive the
  // model copying them into tool arguments (`&amp;` breaks signatures).
  const urlAttr =
    embed.url && /^https?:\/\//.test(embed.url)
      ? ` url="${escapeUrlAttribute(embed.url)}"`
      : attr("url", embed.url);
  const attrs = attr("title", embed.title) + urlAttr;
  const bodyLines: string[] = [];
  if (embed.description) bodyLines.push(sanitizeUntrustedText(embed.description));
  for (const field of embed.fields ?? []) {
    bodyLines.push(sanitizeUntrustedText(field));
  }
  if (embed.footer) bodyLines.push(sanitizeUntrustedText(embed.footer));
  if (bodyLines.length === 0) return `<embed${attrs} />`;
  return `<embed${attrs}>\n${bodyLines.join("\n")}\n</embed>`;
}

/** Render the shared body parts (content, transcription, attachments, sticker, reactions). */
function renderBodyParts(parts: MessageBodyParts): string[] {
  const blocks: string[] = [];
  if (parts.content?.trim()) {
    blocks.push(`<content>\n${sanitizeUntrustedText(parts.content)}\n</content>`);
  }
  if (parts.transcription?.trim()) {
    blocks.push(
      `<transcription>\n${sanitizeUntrustedText(parts.transcription)}\n</transcription>`,
    );
  }
  for (const attachment of parts.attachments ?? []) {
    blocks.push(renderAttachment(attachment));
  }
  if (parts.sticker) {
    blocks.push(renderSticker(parts.sticker));
  }
  if (parts.reactions) {
    blocks.push(renderReactions(parts.reactions));
  }
  return blocks;
}

function renderReplyTo(replyTo: ReplyToPart): string {
  const attrs =
    attr("id", replyTo.id) +
    attr("author", replyTo.author) +
    attr("author-id", replyTo.authorId) +
    attr("time", replyTo.time) +
    (replyTo.inContext ? ` in-context="true"` : "") +
    (replyTo.deleted ? ` deleted="true"` : "");

  // Deleted or already-in-context replies need no body — the model
  // either can't see the original or already has it verbatim above.
  const bodyBlocks =
    replyTo.deleted || replyTo.inContext ? [] : renderBodyParts(replyTo);
  if (bodyBlocks.length === 0) {
    return `<replying-to${attrs} />`;
  }
  return `<replying-to${attrs}>\n${bodyBlocks.join("\n")}\n</replying-to>`;
}

/**
 * Render one Discord message as its XML envelope. This string is
 * the entire content of the user turn for this message.
 */
export function buildDiscordMessageEnvelope(
  envelope: DiscordMessageEnvelope,
): string {
  const usernameDiffers =
    envelope.authorUsername && envelope.authorUsername !== envelope.author;
  const attrs =
    attr("id", envelope.id) +
    attr("author", envelope.author) +
    (usernameDiffers ? attr("author-username", envelope.authorUsername) : "") +
    attr("author-id", envelope.authorId) +
    attr("time", envelope.time) +
    (envelope.sequence && envelope.sequence.total > 1
      ? ` sequence="${envelope.sequence.index}/${envelope.sequence.total}"`
      : "") +
    (envelope.edited ? ` edited="true"` : "");

  const blocks: string[] = [];
  if (envelope.replyTo) {
    blocks.push(renderReplyTo(envelope.replyTo));
  }
  blocks.push(...renderBodyParts(envelope));

  return `<discord-message${attrs}>\n\n${blocks.join("\n\n")}\n\n</discord-message>`;
}

// ─── Respond-to directive ─────────────────────────────────────

export interface RespondToDirective {
  /** Snowflake of the message the agent must answer. */
  id: string;
  author?: string;
  authorId?: string;
}

/**
 * Render the per-request directive that identifies which message the
 * agent must answer. This replaces the old most-recent="true" envelope
 * attribute: the directive is rebuilt for every request and appended
 * as the final (ephemeral) turn, so message envelopes stay byte-stable
 * across requests — a stale marker inside a cached/frozen envelope can
 * never contradict the current trigger.
 */
export function buildRespondToDirective(directive: RespondToDirective): string {
  const attrs =
    attr("id", directive.id) +
    attr("author", directive.author) +
    attr("author-id", directive.authorId);
  return `<respond-to${attrs} />`;
}

// ─── Bot message annotation ───────────────────────────────────

export interface MessageAnnotation {
  /** Snowflake of the bot message this annotation describes. */
  forId: string;
  attachments?: AttachmentPart[];
  embeds?: EmbedPart[];
  reactions?: ReactionsPart;
}

/**
 * Render platform-generated context about one of the bot's own
 * messages (image captions, embeds, reactions). Replaces the legacy
 * "=== YOUR MESSAGE CONTEXT ===" pseudo-message. Returns null when
 * there is nothing to annotate.
 */
export function buildMessageAnnotation(
  annotation: MessageAnnotation,
): string | null {
  const blocks: string[] = [];
  for (const attachment of annotation.attachments ?? []) {
    blocks.push(renderAttachment(attachment));
  }
  for (const embed of annotation.embeds ?? []) {
    blocks.push(renderEmbed(embed));
  }
  if (annotation.reactions) {
    blocks.push(renderReactions(annotation.reactions));
  }
  if (blocks.length === 0) return null;
  return `<message-annotation for="${escapeAttribute(annotation.forId)}">\n\n${blocks.join("\n\n")}\n\n</message-annotation>`;
}

// ─── Reference images block ───────────────────────────────────

export interface ReferenceImageEntry {
  label: string;
  caption?: string;
  /**
   * Direct http(s) link for this image — gives the agent a real handle to
   * pass into image tools (manipulate_image, scan_barcode, read_url, …).
   * data: URIs are omitted from the rendered block (too large for text).
   */
  url?: string;
}

/**
 * Render the indexed list of reference images attached to the
 * triggering message (avatars, replied-to images, emojis) for
 * multimodal grounding. Appended after the message envelope.
 */
export function buildReferenceImagesBlock(
  entries: ReferenceImageEntry[],
): string | null {
  if (!entries.length) return null;
  const lines = entries
    .map((entry, index) => {
      const caption = entry.caption
        ? `: ${sanitizeUntrustedText(entry.caption)}`
        : "";
      const url =
        entry.url && /^https?:\/\//.test(entry.url)
          ? `\n   URL: ${sanitizeUntrustedText(entry.url)}`
          : "";
      return `${index + 1}. ${sanitizeUntrustedText(entry.label)}${caption}${url}`;
    })
    .join("\n");
  return `<attached-reference-images>\n\n${lines}\n\n</attached-reference-images>`;
}

/**
 * Envelope/scaffolding tag names the model sees wrapped around incoming
 * messages and harness context. None of these may ever appear in the
 * bot's own outgoing chat text — a reply containing one is the model
 * mimicking its prompt scaffolding (observed live: a reply that was
 * nothing but an <attached-reference-images> block for its own
 * generated image instead of a sentence).
 */
const SCAFFOLDING_TAG_NAMES = [
  "attached-reference-images",
  "discord-message",
  "message-annotation",
  "replying-to",
  "respond-to",
  "platform-context",
  "self-context",
  "system-context",
  "agent-memory",
  "tool-update",
];

/**
 * Strip prompt-scaffolding XML the model mimicked from its context out
 * of a generated reply. Paired scaffolding blocks are dropped whole
 * (their bodies are metadata lists, not prose) — except a full
 * <discord-message> envelope, whose <content> body IS the reply and is
 * unwrapped instead. Stray unpaired tags are removed. Returns trimmed
 * text; empty string means the reply was scaffolding-only (callers
 * already handle empty text + media as a media-only post).
 */
export function stripScaffoldingTags(text: string): string {
  if (!text || !text.includes("<")) return text;
  let cleaned = text;

  // A mimicked full envelope: rescue the human text inside <content>
  // before the block-dropping pass would discard it.
  cleaned = cleaned.replace(
    /<discord-message\b[^>]*>([\s\S]*?)<\/discord-message>/gi,
    (_match, body: string) => {
      const contentMatch = /<content>([\s\S]*?)<\/content>/i.exec(body);
      return contentMatch ? contentMatch[1] : "";
    },
  );

  for (const tag of SCAFFOLDING_TAG_NAMES) {
    // Paired block (body dropped), then self-closing, then stray
    // opening/closing remnants.
    cleaned = cleaned
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\b[^>]*/>`, "gi"), "")
      .replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "");
  }

  // <content>/<transcription> hold real prose — unwrap, never drop.
  cleaned = cleaned.replace(/<\/?(?:content|transcription)>/gi, "");

  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}
