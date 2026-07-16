import config from "#root/config.js";
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
} from "#root/types/prism.js";

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

/**
 * Parse a Prism SSE stream (`data: {json}\n\n` frames), invoking
 * `onEvent` per event as it arrives and returning the full event list.
 * Malformed frames (keep-alives, partial writes) are skipped; a throwing
 * `onEvent` never breaks the read.
 */
export async function readSseEvents(
  response: Response,
  onEvent?: (event: PrismSseEvent) => void,
): Promise<PrismSseEvent[]> {
  if (!response.body) throw new Error("Prism SSE response has no body");
  const events: PrismSseEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
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
  return {
    text:
      events
        .filter((event) => event.type === "chunk")
        .map((event) => event.content ?? "")
        .join("") || null,
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
      systemPrompt,
      traceId,
      username,
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
    temperature,
    thinkingEnabled,
    thinkingBudget,
    username = "lupos",
    traceId,
    onEvent,
  }: AgentResponseParams) {
    const requestBody = {
      provider: resolveProvider(type),
      model,
      messages,
      agent: "LUPOS",
      autoApprove: true, // Discord bot can't wait for human approval
      // enabledTools are defined by the LUPOS persona in AgentPersonaRegistry
      agentContext,
      maxTokens,
      temperature,
      thinkingEnabled,
      thinkingBudget,
      traceId,
    };

    let data;
    if (onEvent) {
      // Streaming path: consume /agent SSE so live events (thinking, tool
      // calls) can drive presence statuses, then rebuild the same JSON
      // shape the non-streaming path returns.
      const response = await prism().requestRaw("/agent", {
        body: { ...requestBody, skipConversation: true },
        username,
        timeoutMs: AGENT_STREAM_TIMEOUT_MS,
      });
      const events = await readSseEvents(response, onEvent);
      data = aggregateAgentEvents(events);
    } else {
      data = await prism().agent({ ...requestBody, username });
    }

    return {
      text: data.text || null,
      images: data.images || [],
      toolCalls: data.toolCalls || [],
      toolResults: data.toolResults || [],
      audioRef: data.audioRef || null,
      model: data.model,
      provider: data.provider,
    };
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
   * Extract and store memories from a conversation chunk.
   */
  static async extractMemories({
    guildId,
    channelId,
    messages,
    participants,
    sourceMessageId,
    traceId,
  }: MemoryExtractParams) {
    return prism().extractMemories({
      guildId,
      channelId,
      messages,
      participants,
      sourceMessageId,
      traceId,
    });
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
