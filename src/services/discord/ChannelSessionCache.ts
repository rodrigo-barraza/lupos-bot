// ============================================================
// ChannelSessionCache — per-channel prompt-prefix sessions
// ============================================================
// When a channel is busy, consecutive agent requests share almost all
// of their conversation history. Rebuilding that history from Discord
// on every trigger changes its bytes (sliding window, recomputed
// sequence counters, re-serialized bot replies), which busts the
// provider's prompt cache from token zero.
//
// This cache keeps, per channel, the EXACT ChatMessage[] sent on the
// previous request (frozen — never re-rendered), plus the assistant's
// raw reply. The next trigger inside the TTL appends only the messages
// newer than the watermark, so the provider sees a byte-identical
// prefix and serves the history from its prompt cache (Gemini implicit
// caching on gemini-3.5-flash needs a ≥4096-token identical prefix;
// Anthropic/vLLM prefix caches reward the same shape).
//
// Session TTL defaults to 1 hour — Google's documented default cache
// TTL; implicit caches are best-effort and evict sooner under load,
// but a stale piggyback costs only one cache miss, identical to a
// rebaseline.
//
// Invariants the rest of the pipeline must uphold:
//   - Frozen messages are never mutated or re-rendered.
//   - Per-request volatile signals (the <respond-to> directive) ride
//     in an ephemeral tail turn that is never committed here.
//   - The assistant turn stores the RAW agent text, not the
//     Discord-posted copy (chunking/uploads mangle it).
// ============================================================

import config from "#root/config.js";
import type { ChatMessage } from "#root/services/AIService.js";

export interface ChannelSession {
  channelId: string;
  /** Exact conversation as last sent (minus ephemeral tail), plus assistant turns. */
  frozenConversation: ChatMessage[];
  /** Discord snowflakes represented in frozenConversation (envelopes + annotations). */
  messageIds: Set<string>;
  /** Newest Discord message id represented — new slices start after this. */
  watermarkId: string;
  /** Bot-posted message ids already covered by stored assistant turns. */
  botPostedIds: Set<string>;
  /** Cumulative participant user ids, insertion-ordered (memory search scope). */
  participantUserIds: string[];
  /** Running character count of frozenConversation (≈ tokens × 4). */
  approxChars: number;
  /** Number of committed agent turns in this session. */
  turns: number;
  lastRequestAtMs: number;
}

export type SessionPlan =
  | {
      mode: "piggyback";
      session: ChannelSession;
      /** Ids to exclude from the new slice (already represented). */
      skipIds: Set<string>;
    }
  | { mode: "rebaseline"; reason: string };

// Bound memory: a Discord bot can sit in hundreds of channels, but only
// a handful are hot at once. Oldest-touched session evicts first.
const MAX_SESSIONS = 64;

const sessions = new Map<string, ChannelSession>();

function ttlMs(): number {
  const parsed = Number(config.PIGGYBACK_SESSION_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 1000;
}

function maxChars(): number {
  const parsed = Number(config.PIGGYBACK_SESSION_MAX_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 65_536;
}

function messageChars(message: ChatMessage): number {
  return (message.content?.length || 0) + (message.name?.length || 0);
}

/** Snowflake-safe "a is newer than b" (numeric compare via BigInt). */
export function isSnowflakeAfter(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

const ChannelSessionCache = {
  isEnabled(): boolean {
    return config.PIGGYBACK_SESSIONS !== "false";
  },

  get(channelId: string): ChannelSession | undefined {
    return sessions.get(channelId);
  },

  /**
   * Decide whether the next request for this channel can ride the
   * previous request's prompt-cache prefix, or must rebuild from
   * scratch. `recentMessages` is the freshly fetched channel window
   * (oldest → newest, trigger included); `windowSize` is the keyword
   * heuristic's requested context size for this trigger.
   */
  planFor({
    channelId,
    recentMessageIds,
    windowSize,
  }: {
    channelId: string;
    recentMessageIds: string[];
    windowSize: number;
  }): SessionPlan {
    if (!this.isEnabled()) return { mode: "rebaseline", reason: "disabled" };

    const session = sessions.get(channelId);
    if (!session) return { mode: "rebaseline", reason: "no session" };

    if (Date.now() - session.lastRequestAtMs > ttlMs()) {
      sessions.delete(channelId);
      return { mode: "rebaseline", reason: "ttl expired" };
    }

    if (session.approxChars > maxChars()) {
      sessions.delete(channelId);
      return { mode: "rebaseline", reason: "session over size budget" };
    }

    // The fetched window must reach back to the watermark — if more
    // messages arrived than the fetch limit covers, the gap between the
    // frozen history and the new slice would silently swallow messages.
    const watermarkVisible =
      recentMessageIds.includes(session.watermarkId) ||
      recentMessageIds.some((id) => !isSnowflakeAfter(id, session.watermarkId));
    if (!watermarkVisible) {
      sessions.delete(channelId);
      return { mode: "rebaseline", reason: "watermark outside fetch window" };
    }

    // "Recap everything"-style triggers ask for more history than the
    // session holds — rebuild with the full heuristic window instead of
    // silently answering from a smaller frozen slice.
    const newCount = recentMessageIds.filter(
      (id) =>
        isSnowflakeAfter(id, session.watermarkId) &&
        !session.botPostedIds.has(id),
    ).length;
    if (windowSize > session.messageIds.size + newCount) {
      sessions.delete(channelId);
      return { mode: "rebaseline", reason: "trigger wants larger window" };
    }

    return {
      mode: "piggyback",
      session,
      skipIds: new Set([...session.messageIds, ...session.botPostedIds]),
    };
  },

  /**
   * Freeze the conversation exactly as it was sent (minus the ephemeral
   * tail) plus the assistant's raw reply. Called after every successful
   * agent response — on both rebaseline and piggyback requests.
   */
  commit({
    channelId,
    piggyback,
    sentConversation,
    envelopeMessageIds,
    triggerMessageId,
    assistantText,
    assistantName,
    participantUserIds,
  }: {
    channelId: string;
    /** True when this request rode an existing session (merge its state). */
    piggyback: boolean;
    sentConversation: ChatMessage[];
    /** Discord ids of every message represented in sentConversation. */
    envelopeMessageIds: string[];
    triggerMessageId: string;
    assistantText: string | null;
    assistantName: string;
    participantUserIds: string[];
  }): void {
    if (!this.isEnabled()) return;

    // A rebaseline starts a fresh session — carrying ids or participants
    // over from a superseded session would mark live messages as
    // already-represented and silently drop them from future slices.
    const previous = piggyback ? sessions.get(channelId) : undefined;
    const frozenConversation = [...sentConversation];
    if (assistantText) {
      frozenConversation.push({
        role: "assistant",
        name: assistantName,
        content: assistantText,
      });
    }

    const messageIds = new Set(previous?.messageIds ?? []);
    for (const id of envelopeMessageIds) messageIds.add(id);
    messageIds.add(triggerMessageId);

    const cumulativeParticipants = [...(previous?.participantUserIds ?? [])];
    for (const id of participantUserIds) {
      if (!cumulativeParticipants.includes(id)) {
        cumulativeParticipants.push(id);
      }
    }

    const session: ChannelSession = {
      channelId,
      frozenConversation,
      messageIds,
      watermarkId: triggerMessageId,
      botPostedIds: new Set(previous?.botPostedIds ?? []),
      participantUserIds: cumulativeParticipants,
      approxChars: frozenConversation.reduce(
        (sum, message) => sum + messageChars(message),
        0,
      ),
      turns: (previous?.turns ?? 0) + 1,
      lastRequestAtMs: Date.now(),
    };

    sessions.delete(channelId);
    sessions.set(channelId, session);

    // Evict oldest-touched sessions beyond the cap (Map preserves
    // insertion order; re-setting on commit keeps hot channels last).
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  },

  /**
   * Record the Discord ids of the bot's own posted reply chunks so the
   * next slice skips them — the stored assistant turn already carries
   * the raw text they were chunked from.
   */
  recordBotPosts(channelId: string, postedMessageIds: string[]): void {
    const session = sessions.get(channelId);
    if (!session) return;
    for (const id of postedMessageIds) session.botPostedIds.add(id);
  },

  /**
   * Append already-rendered turns (bot media annotations) to the frozen
   * history. They become part of the stable prefix from the next
   * request onward — callers must never mutate them afterwards.
   */
  appendFrozenTurns(channelId: string, turns: ChatMessage[]): void {
    const session = sessions.get(channelId);
    if (!session || !turns.length) return;
    session.frozenConversation.push(...turns);
    session.approxChars += turns.reduce(
      (sum, message) => sum + messageChars(message),
      0,
    );
  },

  /**
   * Drop the session when a message it froze is edited or deleted —
   * the frozen bytes no longer match the channel and the next trigger
   * should rebuild from live history.
   */
  invalidateIfContains(channelId: string, messageId: string): void {
    const session = sessions.get(channelId);
    if (!session) return;
    if (session.messageIds.has(messageId) || session.botPostedIds.has(messageId)) {
      sessions.delete(channelId);
    }
  },

  invalidate(channelId: string): void {
    sessions.delete(channelId);
  },

  /** Test hook. */
  clearAll(): void {
    sessions.clear();
  },
};

export default ChannelSessionCache;
