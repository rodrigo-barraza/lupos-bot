import config from "#root/config.js";
import utilities from "#root/utilities.js";
import type {
  PrismRequestOptions,
  GenerateTextParams,
  AgentResponseParams,
  GenerateImageParams,
  CaptionImageParams,
  TranscribeAudioParams,
  MemoryExtractParams,
  MemorySearchParams,
  EmbeddingParams,
  TransformedPrismResponse,
} from "#root/types/prism.js";

const API_BASE = config.PRISM_API_URL;

/** Map lupos provider types to Prism provider names */
const PROVIDER_MAP = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  LOCAL: "lm-studio",
  GOOGLE: "google",
};

function getHeaders(username: string = "lupos") {
  return {
    "Content-Type": "application/json",
    "x-project": "lupos",
    "x-username": username,
  };
}

export default class PrismService {
  /**
   * Shared fetch helper — centralises request / error handling.


   */
  static async _request(
    endpoint: string,
    { method = "POST", body, username = "lupos" }: PrismRequestOptions = {},
  ): Promise<TransformedPrismResponse> {
    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: getHeaders(username),
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch (error: unknown) {
      const errorMessage = utilities.errorMessage(error);
      console.error(
        `[PrismService] Network error on ${endpoint}:`,
        errorMessage,
      );
      throw new Error(`Prism unreachable: ${errorMessage}`);
    }

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Prism API error: ${fetchResponse.status} ${errorText}`);
    }

    return await fetchResponse.json() as TransformedPrismResponse;
  }

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
    maxTokens,
    temperature,
    username = "lupos",
    traceId,
  }: GenerateTextParams) {
    const provider = PROVIDER_MAP[type as keyof typeof PROVIDER_MAP];
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`);
    }

    const options: Record<string, unknown> = {};
    if (maxTokens) options.maxTokens = maxTokens;
    if (temperature !== undefined) options.temperature = temperature;

    const body: Record<string, unknown> = {
      provider,
      model,
      messages,
      options,
      skipConversation: true,
    };
    if (traceId) body.traceId = traceId;


    const data = await PrismService._request("/chat?stream=false", {
      body,
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
   * The agent autonomously decides which tools to call (e.g. generate_image, web_search)
   * and returns the final response after executing the full agentic loop.
   *
   * Prism assembles the personality system prompt server-side via
   * AgentPersonaRegistry — Lupos only sends structured runtime context
   * (Discord info, participants, trending data, etc.) via agentContext.
   *


   * }>}
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
    const provider = PROVIDER_MAP[type as keyof typeof PROVIDER_MAP];
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`);
    }

    const body: Record<string, unknown> = {
      provider,
      model,
      messages,
      agent: "LUPOS",
      skipConversation: true,
      autoApprove: true, // Discord bot can't wait for human approval
      // enabledTools are now defined by the LUPOS persona in AgentPersonaRegistry
    };

    if (agentContext) body.agentContext = agentContext;
    if (maxTokens) body.maxTokens = maxTokens;
    if (temperature !== undefined) body.temperature = temperature;
    if (thinkingEnabled !== undefined) body.thinkingEnabled = thinkingEnabled;
    if (thinkingBudget) body.thinkingBudget = thinkingBudget;
    if (traceId) body.traceId = traceId;

    const data = await PrismService._request("/agent?stream=false", {
      body,
      username,
    });

    return {
      text: data.text || null,
      images: data.images || [],
      toolCalls: data.toolCalls || [],
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

    const body: Record<string, unknown> = {
      provider,
      model,
      messages: [
        {
          role: "user",
          content: prompt,
          ...(imageDataUrls.length > 0 && { images: imageDataUrls }),
        },
      ],
      skipConversation: true,
    };

    if (systemPrompt) body.systemPrompt = systemPrompt;
    if (traceId) body.traceId = traceId;
    body.forceImageGeneration = true;


    const result = await PrismService._request("/chat?stream=false", {
      body,
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

    const body: Record<string, unknown> = {
      provider,
      messages: [{ role: "user", content: prompt, images: normalizedImages }],
      skipConversation: true,
    };

    if (model) body.model = model;
    if (systemPrompt) body.systemPrompt = systemPrompt;
    if (traceId) body.traceId = traceId;


    return PrismService._request("/chat?stream=false", { body, username });
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
    // Accept Buffer or base64 string
    const base64Audio = Buffer.isBuffer(audio)
      ? audio.toString("base64")
      : audio;
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    const body: Record<string, unknown> = { provider, audio: dataUrl, skipConversation: true };
    if (model) body.model = model;
    if (language) body.language = language;
    if (traceId) body.traceId = traceId;

    const result = await PrismService._request("/audio-to-text", {
      body,
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
    const body: Record<string, unknown> = { guildId, channelId, messages, participants };
    if (sourceMessageId) body.sourceMessageId = sourceMessageId;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/memory/extract", { body });
  }

  /**
   * Search for relevant memories using vector similarity.


   */
  static async searchMemories({ guildId, userIds, queryText, limit = 10, traceId }: MemorySearchParams) {
    const body: Record<string, unknown> = { guildId, queryText, limit };
    if (userIds?.length && userIds.length > 0) body.userIds = userIds;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/memory/search", { body });
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  /**
   * Generate an embedding vector for text via Prism's /embed endpoint.


   */
  static async generateEmbedding({ text, provider = "openai", model, traceId }: EmbeddingParams) {
    const body: Record<string, unknown> = { provider, text };
    if (model) body.model = model;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/embed", { body });
  }

}
