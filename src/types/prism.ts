/**
 * Type definitions for PrismService API method parameters.
 */

import type { ChatMessage } from "#root/services/AIService.js";

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
  maxTokens?: number;
  temperature?: number;
  username?: string;
  traceId?: string;
}

/** Params for PrismService.generateAgentResponse(). */
export interface AgentResponseParams {
  messages: ChatMessage[];
  type: string;
  model: string;
  agentContext?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  username?: string;
  traceId?: string;
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

/** Params for PrismService.extractMemories(). */
export interface MemoryExtractParams {
  guildId: string;
  channelId: string;
  messages: ChatMessage[];
  participants?: string[];
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

