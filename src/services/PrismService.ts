import config from "#root/config.ts";
import { PrismApiClient } from "@rodrigo-barraza/utilities-library/service";
import type {
  GenerateTextParams,
  AgentResponseParams,
  PrismSseEvent,
  GenerateImageParams,
  CaptionImageParams,
  TranscribeAudioParams,
  MemoryExtractParams,
  MemorySearchParams,
  EmbeddingParams,
} from "#root/types/prism.ts";

/** Map lupos provider types to Prism provider names */
const PROVIDER_MAP = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  LOCAL: "lm-studio",
  GOOGLE: "google",
};

// Lazy so a missing PRISM_API_URL fails at call time (matching the old
// fetch-time failure), not at module load — the bot must still boot for
// Discord features that don't touch Prism.
let client: PrismApiClient | null = null;
function prism(): PrismApiClient {
  if (!client) {
    client = new PrismApiClient({
      baseUrl: config.PRISM_API_URL as string,
      project: "lupos",
      defaultUsername: "lupos",
      // A hung Prism call must never hang Lupos — replies drain through a
      // serial queue, so an unbounded request freezes every channel.
      defaultTimeoutMs: 120_000,
    });
  }
  return client;
}

function resolveProvider(type: string): string {
  const provider = PROVIDER_MAP[type as keyof typeof PROVIDER_MAP];
  if (!provider) {
    throw new Error(`Unknown provider type: ${type}`);
  }
  return provider;
}

// Streaming agent turns can run far past the 120s default while tools
// execute — the abort signal covers the whole SSE read, so give it the
// same ceiling prism-service allows an agentic loop.
const AGENT_STREAM_TIMEOUT_MS = 600_000;

// POST /agent/stop is a registry lookup on Prism's side — a slow answer
// means Prism is struggling, and the stop is best effort anyway.
const AGENT_STOP_TIMEOUT_MS = 5_000;

// Every Discord agent turn carries a hard budget (contract §1): Prism
// ends the agentic loop at whichever ceiling it reaches first.
export const DEFAULT_AGENT_MAX_ITERATIONS = 10;
export const DEFAULT_AGENT_MAX_COST_DOLLARS = 0.5;

/**
 * The per-turn budget sent on every /agent call: AGENT_MAX_ITERATIONS /
 * AGENT_MAX_COST_DOLLARS when they hold a positive number, else the
 * defaults above.
 */
export function resolveAgentTurnBudget(
  settings: {
    AGENT_MAX_ITERATIONS?: string;
    AGENT_MAX_COST_DOLLARS?: string;
  } = config,
): { maxIterations: number; maxCostDollars: number } {
  const maxIterations = Number(settings.AGENT_MAX_ITERATIONS);
  const maxCostDollars = Number(settings.AGENT_MAX_COST_DOLLARS);
  return {
    maxIterations:
      Number.isInteger(maxIterations) && maxIterations > 0
        ? maxIterations
        : DEFAULT_AGENT_MAX_ITERATIONS,
    maxCostDollars:
      Number.isFinite(maxCostDollars) && maxCostDollars > 0
        ? maxCostDollars
        : DEFAULT_AGENT_MAX_COST_DOLLARS,
  };
}

/** Lupos gave up on an agent turn (e.g. its trigger message was deleted). */
export class AgentTurnAbortedError extends Error {
  constructor(reason: string) {
    super(`Agent turn abandoned: ${reason}`);
    this.name = "AgentTurnAbortedError";
  }
}

function abortReasonText(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" && reason ? reason : "aborted";
}

/**
 * The conversation id an /agent stream event carries. Prism mints one
 * for a new conversation and sends it on the stream's first events —
 * it is the handle POST /agent/stop takes.
 */
function conversationIdOf(event: PrismSseEvent): string | null {
  const conversationId = event.conversationId;
  return typeof conversationId === "string" && conversationId
    ? conversationId
    : null;
}

/**
 * Parse a Prism SSE stream (`data: {json}\n\n` frames), invoking
 * `onEvent` per event as it arrives and returning the full event list.
 * Malformed frames (keep-alives, partial writes) are skipped; a throwing
 * `onEvent` never breaks the read. Aborting `signal` cancels the read
 * and rejects with AgentTurnAbortedError.
 */
export async function readSseEvents(
  response: Response,
  onEvent?: (event: PrismSseEvent) => void,
  signal?: AbortSignal,
): Promise<PrismSseEvent[]> {
  if (!response.body) throw new Error("Prism SSE response has no body");
  if (signal?.aborted) {
    await response.body.cancel().catch(() => {});
    throw new AgentTurnAbortedError(abortReasonText(signal));
  }
  const events: PrismSseEvent[] = [];
  const reader = response.body.getReader();
  // Cancelling the reader settles the pending read() as done, which
  // ends the loop below; the abort check after it turns that into a
  // rejection instead of a normal (truncated) return.
  const cancelRead = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancelRead, { once: true });
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let frameEnd = buffered.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffered.slice(0, frameEnd);
        buffered = buffered.slice(frameEnd + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as PrismSseEvent;
            events.push(event);
            try {
              onEvent?.(event);
            } catch {
              // Status updates are cosmetic — never let them kill the reply.
            }
          } catch {
            // Skip non-JSON frames.
          }
        }
        frameEnd = buffered.indexOf("\n\n");
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelRead);
  }
  if (signal?.aborted) {
    throw new AgentTurnAbortedError(abortReasonText(signal));
  }
  return events;
}

/**
 * Rebuild the /agent?stream=false JSON shape from streamed events.
 * Mirrors prism-service SseUtilities.buildJsonResponseFromEvents for the
 * fields Lupos consumes, so both call paths return identical data.
 * NOTE: streamed image events are lightweight — base64 `data` is stripped
 * when a minioRef exists (createSseEmitter), so images usually arrive as
 * minioRef-only here.
 */
export function aggregateAgentEvents(events: PrismSseEvent[]) {
  const errorEvent = events.find((event) => event.type === "error");
  if (errorEvent) {
    throw new Error(errorEvent.message || "Prism agent stream error");
  }
  const doneEvent =
    events.find((event) => event.type === "done") ?? ({} as PrismSseEvent);

  // Split streamed text at tool-call boundaries: each agentic pass's
  // chunks form one segment. Only the LAST non-empty segment is the
  // reply — models sometimes leak planning/reasoning as content on
  // mid-loop passes, and joining every pass would prepend that noise
  // to the real answer. Last NON-EMPTY (not merely last) so a reply
  // written just before a trailing tool call (e.g.
  // react_to_discord_message) still counts when the final pass is
  // silent.
  const textSegments: string[] = [""];
  for (const event of events) {
    if (event.type === "chunk") {
      textSegments[textSegments.length - 1] += event.content ?? "";
    } else if (
      event.type === "tool_execution" &&
      event.status === "calling"
    ) {
      textSegments.push("");
    }
  }
  const lastText = textSegments
    .reverse()
    .find((segment) => segment.trim().length > 0);

  return {
    text: lastText || null,
    images: events
      .filter((event) => event.type === "image")
      .map((event) => ({
        data: event.data,
        mimeType: event.mimeType,
        minioRef: event.minioRef || null,
      })),
    toolCalls: events
      .filter(
        (event) =>
          event.type === "tool_execution" && event.status === "calling",
      )
      .map((event) => ({ name: event.tool?.name, args: event.tool?.args })),
    toolResults: events
      .filter(
        (event) =>
          event.type === "tool_execution" &&
          (event.status === "done" || event.status === "error"),
      )
      .map((event) => ({
        name: event.tool?.name,
        args: event.tool?.args,
        result: event.tool?.result,
        status: event.status,
      })),
    audioRef: doneEvent.audioRef || null,
    model: doneEvent.model,
    provider: doneEvent.provider,
  };
}

export default class PrismService {
  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /**
   * Generate text via Prism's /chat endpoint.
   */
  static async generateText({
    messages,
    type,
    model,
    systemPrompt,
    maxTokens,
    temperature,
    flatOptions,
    timeoutMs,
    username = "lupos",
    traceId,
  }: GenerateTextParams) {
    const options: Record<string, unknown> = {};
    if (maxTokens) options.maxTokens = maxTokens;
    if (temperature !== undefined) options.temperature = temperature;

    const data = await prism().chat({
      provider: resolveProvider(type),
      model,
      messages,
      options,
      ...flatOptions,
      systemPrompt,
      traceId,
      username,
      timeoutMs,
    });

    return {
      text: data.text,
      model: data.model,
      provider: data.provider,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent — autonomous agentic loop with tool calling
  // ---------------------------------------------------------------------------

  /**
   * Generate a response via Prism's /agent endpoint.
   * The agent autonomously decides which tools to call (e.g. generate_image, search_web)
   * and returns the final response after executing the full agentic loop.
   *
   * Prism assembles the personality system prompt server-side via
   * AgentPersonaRegistry — Lupos only sends structured runtime context
   * (Discord info, participants, trending data, etc.) via agentContext.
   */
  static async generateAgentResponse({
    messages,
    type,
    model,
    agentContext,
    maxTokens,
    thinkingEnabled,
    thinkingBudget,
    maxIterations,
    maxCostDollars,
    username = "lupos",
    traceId,
    onEvent,
    signal,
  }: AgentResponseParams) {
    const budget = resolveAgentTurnBudget();
    const requestBody = {
      provider: resolveProvider(type),
      model,
      messages,
      agent: "LUPOS",
      autoApprove: true, // Discord bot can't wait for human approval
      // enabledTools are defined by the LUPOS persona in AgentPersonaRegistry
      agentContext,
      maxTokens,
      thinkingEnabled,
      thinkingBudget,
      maxIterations: maxIterations ?? budget.maxIterations,
      maxCostDollars: maxCostDollars ?? budget.maxCostDollars,
      traceId,
    };

    let data;
    if (onEvent) {
      // Streaming path: consume /agent SSE so live events (thinking, tool
      // calls) can drive presence statuses, then rebuild the same JSON
      // shape the non-streaming path returns.
      if (signal?.aborted) {
        throw new AgentTurnAbortedError(abortReasonText(signal));
      }
      const response = await prism().requestRaw("/agent", {
        body: { ...requestBody, skipConversation: true },
        username,
        timeoutMs: AGENT_STREAM_TIMEOUT_MS,
      });
      // Prism runs /agent with persistOnDisconnect: a turn Lupos walks
      // away from keeps running (and spending) until it finishes. The
      // conversation id from the stream's first events is the handle to
      // stop it whenever Lupos gives up — timeout, trigger deleted, a
      // broken stream or an error after the turn started.
      let conversationId: string | null = null;
      let stopRequested = false;
      const stopTurn = () => {
        if (!conversationId || stopRequested) return;
        stopRequested = true;
        void PrismService.stopAgentTurn(conversationId, username);
      };
      try {
        const events = await readSseEvents(
          response,
          (event) => {
            conversationId ??= conversationIdOf(event);
            onEvent(event);
          },
          signal,
        );
        // A stream that closes without `done` lost its connection
        // mid-turn — nobody is reading that turn any more.
        if (!events.some((event) => event.type === "done")) stopTurn();
        // Throws on an `error` event.
        data = aggregateAgentEvents(events);
      } catch (error: unknown) {
        stopTurn();
        throw error;
      }
    } else {
      data = await prism().agent({ ...requestBody, username });
    }

    // finalText (non-streaming path) carries only the last agentic
    // pass's text — prefer it over the legacy all-passes join so
    // mid-loop reasoning leaks never reach Discord.
    const finalText = (data as { finalText?: string | null }).finalText;
    return {
      text: finalText || data.text || null,
      images: data.images || [],
      toolCalls: data.toolCalls || [],
      toolResults: data.toolResults || [],
      audioRef: data.audioRef || null,
      model: data.model,
      provider: data.provider,
    };
  }

  /**
   * Stop a running /agent turn (POST /agent/stop). Best effort — never
   * throws: a 404 only means the turn had already finished.
   */
  static async stopAgentTurn(
    conversationId: string,
    username = "lupos",
  ): Promise<boolean> {
    try {
      await prism().request("/agent/stop", {
        body: { conversationId },
        username,
        timeoutMs: AGENT_STOP_TIMEOUT_MS,
      });
      console.log(
        `🛑 [PrismService] Stopped abandoned agent turn ${conversationId}`,
      );
      return true;
    } catch (error: unknown) {
      console.warn(
        `🛑 [PrismService] Could not stop agent turn ${conversationId} (it may have finished): ${(error as Error)?.message ?? error}`,
      );
      return false;
    }
  }

  /**
   * Generate an image via Prism's /chat endpoint.
   */
  static async generateImage({
    prompt,
    provider = "google",
    model,
    images = [],
    username = "lupos",
    systemPrompt,
    traceId,
  }: GenerateImageParams) {
    const imageDataUrls = images.map((image) => {
      if (typeof image === "string") return image;
      return `data:${image.mimeType || "image/png"};base64,${image.imageData}`;
    });

    const result = await prism().chat({
      provider,
      model,
      messages: [
        {
          role: "user",
          content: prompt,
          ...(imageDataUrls.length > 0 && { images: imageDataUrls }),
        },
      ],
      systemPrompt,
      traceId,
      forceImageGeneration: true,
      username,
    });

    const firstImage = result.images?.[0];
    return {
      imageData: firstImage?.data || null,
      mimeType: firstImage?.mimeType || "image/png",
      minioRef: firstImage?.minioRef || null,
      text: result.text || null,
      model: result.model,
      provider: result.provider,
    };
  }

  /**
   * Fetch an agent's live somatic snapshot (Plutchik emotion + physical
   * stats) from prism-service's GET /somatic/:agentId. This is the REAL
   * mood/body state the agent reasons with — as opposed to lupos-bot's
   * vestigial in-memory TraitRegistry stub.
   */
  static async getSomaticSnapshot(agentId = "LUPOS") {
    return prism().request(`/somatic/${encodeURIComponent(agentId)}`, {
      method: "GET",
      username: "lupos",
    });
  }

  /**
   * Fetch an agent's emotion/physical time series from prism-service's
   * GET /somatic/:agentId/history — one point per somatic persist tick
   * ({at, dominant, intensity, wheel, physical}), ascending, 30-day TTL.
   */
  static async getSomaticHistory(hours = 24, agentId = "LUPOS") {
    return prism().request(
      `/somatic/${encodeURIComponent(agentId)}/history?hours=${encodeURIComponent(hours)}`,
      {
        method: "GET",
        username: "lupos",
      },
    );
  }

  /**
   * Caption / describe an image via Prism's /chat endpoint.
   */
  static async captionImage({
    images,
    prompt,
    provider = "openai",
    model,
    username = "lupos",
    systemPrompt,
    traceId,
  }: CaptionImageParams) {
    const normalizedImages = Array.isArray(images) ? images : [images];

    return prism().chat({
      provider,
      model,
      messages: [{ role: "user", content: prompt, images: normalizedImages }],
      systemPrompt,
      traceId,
      username,
    });
  }

  /**
   * Transcribe audio via Prism's /audio-to-text endpoint.
   */
  static async transcribeAudio({
    audio,
    mimeType = "audio/mpeg",
    provider = "openai",
    model,
    language,
    username = "lupos",
    traceId,
  }: TranscribeAudioParams) {
    const result = await prism().transcribeAudio({
      audio,
      mimeType,
      provider,
      model,
      language,
      traceId,
      username,
    });

    return {
      text: result.text,
    };
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  /**
   * Extract and store memories from a conversation chunk. Participants
   * travel as `{ id, username, displayName }` objects so Prism can
   * attribute each fact to a person — posted directly because the shared
   * client's extractMemories still types them as strings.
   */
  static async extractMemories({
    guildId,
    channelId,
    messages,
    participants,
    sourceMessageId,
    traceId,
  }: MemoryExtractParams) {
    const body: Record<string, unknown> = { guildId, channelId, messages };
    if (participants) body.participants = participants;
    if (sourceMessageId) body.sourceMessageId = sourceMessageId;
    if (traceId) body.traceId = traceId;
    return prism().request("/memory/extract", { body });
  }

  /**
   * Search for relevant memories using vector similarity.
   */
  static async searchMemories({
    guildId,
    userIds,
    queryText,
    limit = 10,
    traceId,
  }: MemorySearchParams) {
    return prism().searchMemories({
      guildId,
      userIds,
      queryText,
      limit,
      traceId,
    });
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  /**
   * Generate an embedding vector for text via Prism's /embed endpoint.
   */
  static async generateEmbedding({
    text,
    provider = "openai",
    model,
    traceId,
  }: EmbeddingParams) {
    return prism().embed({ text, provider, model, traceId });
  }
}
