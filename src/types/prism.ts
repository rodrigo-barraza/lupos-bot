/**
 * Type definitions for PrismService API method parameters.
 */

import type { ChatMessage } from "#root/services/AIService.ts";

/** Options for PrismService._request() helper. */
export interface PrismRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  username?: string;
  /** Abort the request after this many milliseconds (default 120 000). */
  timeoutMs?: number;
}

/** Params for PrismService.generateText(). */
export interface GenerateTextParams {
  messages: ChatMessage[];
  type: string;
  model: string;
  systemPrompt?: string;
  // Generation options — sent flat at the top level of the /chat body,
  // which is where Prism reads them.
  maxTokens?: number;
  temperature?: number;
  /** false ⇒ Prism turns thinking down/off for thinking models. */
  thinkingEnabled?: boolean;
  /** "json_object" ⇒ provider JSON mode (OpenAI, Google, Moonshot). */
  responseFormat?: "json_object";
  /** Abort the call after this many milliseconds (default 120 000). */
  timeoutMs?: number;
  username?: string;
  traceId?: string;
}

/**
 * One parsed SSE event from Prism's /agent stream (`data: {json}` frames).
 * Field population depends on `type` — see prism-service SseUtilities.
 */
/** Prism's done-event `promptCache` (prism ModelProfiles.promptCacheWindow). */
export interface PromptCacheWindow {
  lifeSeconds: number;
  expiresAt: string;
}

export interface PrismSseEvent {
  type: string;
  content?: string;
  data?: string;
  mimeType?: string;
  minioRef?: string | null;
  message?: string;
  status?: string;
  provider?: string;
  model?: string;
  audioRef?: string;
  /**
   * done: how long the turn's prompt prefix stays cached on the model that
   * served it, and until when (ISO) — the channel session lives that long.
   */
  promptCache?: PromptCacheWindow;
  tool?: {
    name?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    durationMilliseconds?: number;
  };
  /**
   * Human-readable, argument-aware label stamped by prism-service on
   * tool_execution frames — "Searching Spotify for \"phonk\"" (calling)
   * / "Searched Spotify for \"phonk\"" (done). Prefer over tool.name.
   */
  toolLabel?: string;
  [key: string]: unknown;
}

/**
 * Params for PrismService.generateAgentResponse(). There is no
 * temperature: agent turns leave sampling to Prism (current Gemini
 * models ignore it anyway).
 */
export interface AgentResponseParams {
  messages: ChatMessage[];
  type: string;
  model: string;
  agentContext?: Record<string, unknown>;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  /**
   * Reasoning effort — "minimal" | "low" | "medium" | "high" (default:
   * resolveAgentThinkingLevel(), i.e. AGENT_THINKING_LEVEL or "medium").
   * There is no token budget: Prism maps the level per provider.
   */
  thinkingLevel?: string;
  /** Agentic-loop pass ceiling (default: resolveAgentTurnBudget()). */
  maxIterations?: number;
  /** Spend ceiling in dollars (default: resolveAgentTurnBudget()). */
  maxCostDollars?: number;
  username?: string;
  traceId?: string;
  /**
   * Routes the provider's prompt cache (OpenAI prompt_cache_key, Kimi
   * session affinity) across conversations that share a prefix — Lupos
   * sends one per channel, whose turns are a new conversation each.
   */
  promptCacheKey?: string;
  /**
   * When set, the call streams /agent SSE and invokes this per event as
   * the agent works (thinking, tool calls, chunks) — used for live
   * presence statuses. The final return value is identical either way.
   */
  onEvent?: (event: PrismSseEvent) => void;
  /**
   * Streaming path only: aborting gives up on the turn — the stream read
   * stops, Prism is told to stop the turn, and the call rejects with
   * AgentTurnAbortedError.
   */
  signal?: AbortSignal;
}

/** Image data object for Prism image generation. */
export interface PrismImageInput {
  imageData: string;
  mimeType: string;
}

/** Params for PrismService.generateImage(). */
export interface GenerateImageParams {
  prompt: string;
  provider?: string;
  model: string;
  images?: (string | PrismImageInput)[];
  username?: string;
  systemPrompt?: string;
  traceId?: string;
}

/** Params for PrismService.captionImage(). */
export interface CaptionImageParams {
  images: string | string[];
  prompt: string;
  provider?: string;
  model?: string;
  username?: string;
  systemPrompt?: string;
  traceId?: string;
}

/** Params for PrismService.transcribeAudio(). */
export interface TranscribeAudioParams {
  audio: Buffer | string;
  mimeType?: string;
  provider?: string;
  model?: string;
  language?: string;
  username?: string;
  traceId?: string;
}

/**
 * One conversation participant sent to Prism's /memory/extract. Prism
 * attributes each extracted fact to a participant by `id`/`username`,
 * so these travel as objects — never bare display-name strings.
 */
export interface MemoryParticipant {
  /** Discord user id (snowflake). */
  id: string;
  username: string;
  /** Server nickname > global name > username. */
  displayName: string;
}

/** Params for PrismService.extractMemories(). */
export interface MemoryExtractParams {
  guildId: string;
  channelId: string;
  messages: ChatMessage[];
  participants?: MemoryParticipant[];
  sourceMessageId?: string;
  traceId?: string;
}

/** Params for PrismService.searchMemories(). */
export interface MemorySearchParams {
  guildId: string;
  userIds?: string[];
  queryText: string;
  limit?: number;
  traceId?: string;
}

/** Params for PrismService.generateEmbedding(). */
export interface EmbeddingParams {
  text: string;
  provider?: string;
  model?: string;
  traceId?: string;
}

export interface PrismMemoryItem {
  content: string;
  createdAt: string | Date;
  aboutUsername?: string;
}

/** Represents a response from the Prism API. */
export interface TransformedPrismResponse {
  text?: string;
  model?: string;
  provider?: string;
  images?: Array<{
    data?: string;
    mimeType?: string;
    minioRef?: string;
  }>;
  audio?: Array<{
    data?: string;
    mimeType?: string;
    minioRef?: string;
  }>;
  audioRef?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  toolResults?: Array<{
    name?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    status?: string;
  }>;
  embedding?: number[];
  results?: unknown;
  memories?: PrismMemoryItem[];
  count?: number;
}
