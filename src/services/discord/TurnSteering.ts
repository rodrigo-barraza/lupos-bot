// ============================================================
// TurnSteering — fold a follow-up into the agent turn that is running
// ============================================================
// Round-2 contract §4. Replies drain through one serial queue, so a
// follow-up ("oh and also…") sent while Lupos is still answering used to
// wait behind that turn and get a second, separate reply. Now, while a
// turn for (channel C, author A) is streaming and Prism has sent its
// conversation id, a NEW addressed message by A in C is handed to that
// turn through Prism's steering mailbox (POST /agent/input) instead:
//   - 200 ⇒ folded: Lupos reacts 👀 once and posts nothing else for it —
//     the turn's reply answers both;
//   - 409 / any error ⇒ queued as its own turn, exactly as before.
// Only the same author, the same channel and the same turn; never a
// message that reached Lupos on the ambient path, never an ambient turn
// (it may end in silence), and never a turn that has already produced
// its reply (the stream's `done` closes it).
//
// A fold Prism took but the turn did not act on — acknowledged only as
// the turn ended (`turn_end`), never acknowledged, or its turn failed,
// was abandoned, or never got its reply posted — is handed back by
// settle() to be queued as its own turn: 👀 never means "ignored".
// ============================================================

import type { Message } from "discord.js";

import PrismService, { conversationIdOf } from "#root/services/PrismService.ts";
import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import type { ChatMessage } from "#root/services/AIService.ts";
import type { PrismSseEvent } from "#root/types/prism.ts";
import DiscordState from "#root/services/discord/DiscordState.ts";
import type { ReplyMode } from "#root/services/discord/Addressee.ts";
import { displayNameOf } from "#root/services/discord/ConversationExtractor.ts";
import {
  buildDiscordMessageEnvelope,
  toIsoTime,
} from "#root/services/discord/MessageEnvelope.ts";
import type { AttachmentPart } from "#root/services/discord/MessageEnvelope.ts";

/** The one reaction a folded follow-up gets. */
export const FOLDED_REACTION = "👀";

// Boundaries at which Prism applies a mailbox entry BEFORE the model's
// next pass — the reply that follows has seen it. `turn_end` only files
// it into the transcript of a turn that is ending anyway.
const ANSWERING_BOUNDARIES = new Set([
  "iteration_start",
  "after_tools",
  "before_end",
  "native_steer",
]);

/** A follow-up handed to a running turn. */
export interface FoldedMessage {
  message: Message;
  replyMode: ReplyMode;
  /** What Prism was handed, as the conversation turn it stands for. */
  turn: ChatMessage;
  /** Settles with Prism's input id, or null when the turn didn't take it. */
  posted: Promise<string | null>;
  /** The settled value of `posted` (undefined while in flight). */
  inputId?: string | null;
}

function keyOf(channelId: string, authorId: string): string {
  return `${channelId}:${authorId}`;
}

const activeTurns = new Map<string, SteerableTurn>();

/** An addressed agent turn that follow-ups by its author may join. */
export class SteerableTurn {
  readonly channelId: string;
  readonly authorId: string;
  readonly triggerMessageId: string;
  /** Prism username the turn runs under (the trigger author's). */
  readonly username: string;
  conversationId: string | null = null;
  closed = false;
  /** The model finished the turn without error. */
  modelReplied = false;
  /** Its reply reached Discord. */
  delivered = false;
  readonly folds: FoldedMessage[] = [];
  /** Prism input id → the boundary it was applied at. */
  readonly applied = new Map<string, string>();

  constructor(trigger: Message) {
    this.channelId = trigger.channelId;
    this.authorId = trigger.author.id;
    this.triggerMessageId = trigger.id;
    this.username = trigger.author?.username || "unknown";
  }

  /** Feed every /agent stream event of this turn through here. */
  observe(event: PrismSseEvent): void {
    this.conversationId ??= conversationIdOf(event);
    if (event.type === "turn_input" && typeof event.id === "string") {
      this.applied.set(event.id, String(event.boundary ?? ""));
    }
    // The reply exists — nothing may join it any more.
    if (event.type === "done") this.close();
  }

  /** Stop accepting follow-ups. Idempotent. */
  close(): void {
    this.closed = true;
    const key = keyOf(this.channelId, this.authorId);
    if (activeTurns.get(key) === this) activeTurns.delete(key);
  }

  /** Whether the model saw this fold before the pass that wrote its reply. */
  private wasAnsweredInTurn(fold: FoldedMessage): boolean {
    if (!fold.inputId) return false;
    const boundary = this.applied.get(fold.inputId);
    return boundary !== undefined && ANSWERING_BOUNDARIES.has(boundary);
  }

  /**
   * Folds the model answered in this turn's reply, as conversation turns
   * — the channel session freezes them ahead of the assistant turn, in
   * the order Discord shows them.
   */
  answeredFoldTurns(): { id: string; turn: ChatMessage }[] {
    return this.folds
      .filter((fold) => this.wasAnsweredInTurn(fold))
      .map((fold) => ({ id: fold.message.id, turn: fold.turn }));
  }

  /**
   * Close the turn, wait for any fold still being posted, and return the
   * folds Prism took but this turn's delivered reply did not answer —
   * the caller queues those as their own turns.
   */
  async settle(): Promise<FoldedMessage[]> {
    this.close();
    const inputIds = await Promise.all(this.folds.map((fold) => fold.posted));
    inputIds.forEach((inputId, index) => {
      this.folds[index].inputId = inputId;
    });
    const replied = this.modelReplied && this.delivered;
    return this.folds.filter(
      (fold) => fold.inputId && !(replied && this.wasAnsweredInTurn(fold)),
    );
  }
}

/**
 * Register the addressed turn about to run for this trigger. Ambient
 * turns are never registered — a turn that may end in [[pass]] must not
 * swallow a message someone addressed to him.
 */
export function openSteerableTurn(trigger: Message): SteerableTurn {
  const turn = new SteerableTurn(trigger);
  activeTurns.get(keyOf(turn.channelId, turn.authorId))?.close();
  activeTurns.set(keyOf(turn.channelId, turn.authorId), turn);
  return turn;
}

/**
 * The follow-up as Prism receives it: the same <discord-message> envelope
 * the conversation uses (so the model knows who said it and which id to
 * react to), plus its image attachments for vision. No captioning or
 * reply-quoting round trips — speed is the point.
 */
export function buildFoldInput(message: Message): {
  text: string;
  images: string[];
} {
  const attachments: AttachmentPart[] = [];
  const images: string[] = [];
  for (const attachment of message.attachments?.values() ?? []) {
    const contentType = attachment.contentType ?? "";
    const kind = contentType.startsWith("image/")
      ? "image"
      : contentType.startsWith("video/")
        ? "video"
        : contentType.startsWith("audio/")
          ? "audio"
          : "file";
    const url = kind === "image" ? attachment.url : attachment.proxyURL || attachment.url;
    if (kind === "image" && url) images.push(url);
    attachments.push({
      kind,
      ...(kind === "image" ? {} : { description: attachment.name || undefined }),
      ...(attachment.size
        ? { sizeMb: (attachment.size / 1024 / 1024).toFixed(2) }
        : {}),
      ...(url?.startsWith("http") ? { url } : {}),
    });
  }
  const sticker = message.stickers?.size === 1 ? message.stickers.first() : undefined;
  const referenceId = message.reference?.messageId;
  const text = buildDiscordMessageEnvelope({
    id: message.id,
    author: displayNameOf(message) || message.author.username,
    authorUsername: message.author.username,
    authorId: message.author.id,
    time: toIsoTime(message.createdTimestamp),
    ...(referenceId && {
      replyTo: {
        id: referenceId,
        authorId: message.mentions?.repliedUser?.id,
      },
    }),
    content: message.content || undefined,
    attachments,
    ...(sticker && {
      sticker: {
        name: sticker.name,
        ...(sticker.url?.startsWith("http") ? { url: sticker.url } : {}),
      },
    }),
  });
  return { text, images };
}

/**
 * Hand an addressed follow-up to its author's running turn in the same
 * channel. True ⇒ folded (reacted 👀; the caller must NOT queue it).
 * False ⇒ no such turn, it can't take input yet or any more, or Prism
 * refused — queue it as today.
 */
export async function tryFoldIntoRunningTurn(
  message: Message,
  replyMode: ReplyMode,
): Promise<boolean> {
  if (replyMode === "ambient") return false;
  const turn = activeTurns.get(keyOf(message.channelId, message.author.id));
  if (!turn || turn.closed || !turn.conversationId) return false;
  if (message.id === turn.triggerMessageId) return false;

  let text: string;
  let images: string[];
  let name: string;
  try {
    ({ text, images } = buildFoldInput(message));
    name = DiscordUtilityService.getUsernameNoSpaces(message);
  } catch (error: unknown) {
    console.warn(
      `⚠️ [TurnSteering] Could not build follow-up ${message.id} for its turn — queueing it instead: ${(error as Error).message}`,
    );
    return false;
  }

  // Taken for a reply from here on: an edit while the post is in flight
  // must not queue a second one (same rule as acceptAndQueueReply).
  DiscordState.markAcceptedForReply(message.id);
  const fold: FoldedMessage = {
    message,
    replyMode,
    turn: { role: "user", name, content: text },
    // postAgentInput never throws — null is "not taken".
    posted: PrismService.postAgentInput(
      turn.conversationId,
      { text, images },
      turn.username,
    ),
  };
  // Registered before the post settles so settle() waits for it.
  turn.folds.push(fold);
  fold.inputId = await fold.posted;

  if (!fold.inputId) {
    DiscordState.forgetAcceptedForReply(message.id);
    return false;
  }
  console.log(
    `🧵 [TurnSteering] Folded ${message.author.username}'s follow-up ${message.id} into running turn ${turn.conversationId} (input ${fold.inputId}).`,
  );
  try {
    await message.react(FOLDED_REACTION);
  } catch (error: unknown) {
    console.warn(
      `⚠️ [TurnSteering] Could not react ${FOLDED_REACTION} to ${message.id}: ${(error as Error).message}`,
    );
  }
  return true;
}

/** Test hook. */
export function resetTurnSteering(): void {
  activeTurns.clear();
}
