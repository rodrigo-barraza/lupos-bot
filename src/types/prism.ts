/**
 * Type definitions for PrismService API method parameters.
 */

import type { ChatMessage } from "#root/services/AIService.js";

/** Options for PrismService._request() helper. */
export interface PrismRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  username?: string;
}

/** Params for PrismService.generateText(). */
export interface GenerateTextParams {
  messages: ChatMessage[];
  type: string;
  model: string;
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
