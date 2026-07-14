import config from "#root/config.js";
import { PrismApiClient } from "@rodrigo-barraza/utilities-library/service";
import type {
  GenerateTextParams,
  AgentResponseParams,
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
  }: AgentResponseParams) {
    const data = await prism().agent({
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
      username,
    });

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
