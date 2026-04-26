import config from "#root/config.js";

const API_BASE = config.PRISM_API_URL;

/** Map lupos provider types to Prism provider names */
const PROVIDER_MAP = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  LOCAL: "lm-studio",
  GOOGLE: "google",
};

function getHeaders(username = "lupos") {
  return {
    "Content-Type": "application/json",
    "x-project": "lupos",
    "x-username": username,
  };
}

export default class PrismService {
  /**
   * Shared fetch helper — centralises request / error handling.
   * @param {string} endpoint - URL path (e.g. "/chat?stream=false")
   * @param {object} [options]
   * @param {string} [options.method="POST"]
   * @param {object} [options.body]
   * @param {string} [options.username="lupos"]
   * @returns {Promise<any>}
   */
  static async _request(
    endpoint,
    { method = "POST", body, username = "lupos" } = {},
  ) {
    let res;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: getHeaders(username),
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      console.error(
        `[PrismService] Network error on ${endpoint}:`,
        error.message,
      );
      throw new Error(`Prism unreachable: ${error.message}`);
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Prism API error: ${res.status} ${errorText}`);
    }

    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /**
   * Generate text via Prism's /chat endpoint.
   * @param {object} payload
   * @param {Array}  payload.messages - Array of { role, name?, content } message objects
   * @param {string} payload.type - Provider type: "OPENAI" | "ANTHROPIC" | "LOCAL" | "GOOGLE"
   * @param {string} payload.model - Model name
   * @param {number} [payload.maxTokens] - Max tokens
   * @param {number} [payload.temperature] - Temperature
   * @param {string} [payload.username="lupos"] - Username for tracking
   * @param {string} [payload.traceId] - Trace ID for request grouping
   * @returns {Promise<{ text: string, model: string, provider: string }>}
   */
  static async generateText({
    messages,
    type,
    model,
    maxTokens,
    temperature,
    username = "lupos",
    traceId,
  }) {
    const provider = PROVIDER_MAP[type];
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`);
    }

    const body = {
      provider,
      model,
      messages,
      options: {},
      skipConversation: true,
    };

    if (maxTokens) body.options.maxTokens = maxTokens;
    if (temperature !== undefined) body.options.temperature = temperature;
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
   * @param {object} payload
   * @param {Array}  payload.messages      - Conversation messages [{ role, name?, content, images? }]
   * @param {string} payload.type          - Provider type: "OPENAI" | "ANTHROPIC" | "LOCAL" | "GOOGLE"
   * @param {string} payload.model         - Model name
   * @param {object} [payload.agentContext] - Runtime context for Prism's assembler (Discord info, trends, etc.)
   * @param {number} [payload.maxTokens]   - Max output tokens
   * @param {number} [payload.temperature] - Temperature
   * @param {boolean} [payload.thinkingEnabled] - Enable extended thinking (chain-of-thought)
   * @param {number} [payload.thinkingBudget] - Max thinking tokens budget
   * @param {string} [payload.username="lupos"] - Username for tracking
   * @param {string} [payload.traceId]   - Trace ID for request grouping
   * @returns {Promise<{
   *   text: string|null,
   *   images: Array<{ data: string, mimeType: string, minioRef: string|null }>,
   *   toolCalls: Array<object>,
   *   model: string,
   *   provider: string,
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
  }) {
    const provider = PROVIDER_MAP[type];
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`);
    }

    const body = {
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
   * @param {object} payload
   * @param {string} payload.prompt - Image generation prompt
   * @param {string} [payload.provider="google"] - Provider name
   * @param {string} payload.model - Model name
   * @param {Array}  [payload.images=[]] - Array of base64 data URLs or { imageData, mimeType } objects
   * @param {string} [payload.username="lupos"] - Username for tracking
   * @param {string} [payload.systemPrompt]
   * @param {string} [payload.traceId] - Trace ID for request grouping
   * @returns {Promise<{ imageData: string, mimeType: string, text: string, minioRef: string|null, model: string, provider: string }>}
   */
  static async generateImage({
    prompt,
    provider = "google",
    model,
    images = [],
    username = "lupos",
    systemPrompt,
    traceId,
  }) {
    const imageDataUrls = images.map((img) => {
      if (typeof img === "string") return img;
      return `data:${img.mimeType || "image/png"};base64,${img.imageData}`;
    });

    const body = {
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
   * @param {object} payload
   * @param {string|string[]} payload.images - URL/base64 string or array of them
   * @param {string} payload.prompt - Caption prompt
   * @param {string} [payload.provider="openai"] - Provider name
   * @param {string} [payload.model]
   * @param {string} [payload.username="lupos"]
   * @param {string} [payload.systemPrompt]
   * @param {string} [payload.traceId] - Trace ID for request grouping
   * @returns {Promise<{ text: string }>}
   */
  static async captionImage({
    images,
    prompt,
    provider = "openai",
    model,
    username = "lupos",
    systemPrompt,
    traceId,
  }) {
    const normalizedImages = Array.isArray(images) ? images : [images];

    const body = {
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
   * @param {object} payload
   * @param {Buffer|string} payload.audio - Audio file buffer or base64 string
   * @param {string} payload.mimeType - MIME type of the audio
   * @param {string} [payload.provider="openai"]
   * @param {string} [payload.model]
   * @param {string} [payload.language]
   * @param {string} [payload.username="lupos"]
   * @param {string} [payload.traceId]
   * @returns {Promise<{ text: string }>}
   */
  static async transcribeAudio({
    audio,
    mimeType = "audio/mpeg",
    provider = "openai",
    model,
    language,
    username = "lupos",
    traceId,
  }) {
    // Accept Buffer or base64 string
    const base64Audio = Buffer.isBuffer(audio)
      ? audio.toString("base64")
      : audio;
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    const body = { provider, audio: dataUrl, skipConversation: true };
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
   * @param {object} payload
   * @param {string} payload.guildId
   * @param {string} payload.channelId
   * @param {Array}  payload.messages - Recent conversation messages
   * @param {Array}  payload.participants - Array of { id, username, displayName }
   * @param {string} [payload.sourceMessageId]
   * @returns {Promise<{ memories: Array, count: number }>}
   */
  static async extractMemories({
    guildId,
    channelId,
    messages,
    participants,
    sourceMessageId,
    traceId,
  }) {
    const body = { guildId, channelId, messages, participants };
    if (sourceMessageId) body.sourceMessageId = sourceMessageId;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/memory/extract", { body });
  }

  /**
   * Search for relevant memories using vector similarity.
   * @param {object} payload
   * @param {string} payload.guildId
   * @param {string[]} [payload.userIds]
   * @param {string} payload.queryText
   * @param {number} [payload.limit=10]
   * @returns {Promise<{ memories: Array, count: number }>}
   */
  static async searchMemories({ guildId, userIds, queryText, limit = 10, traceId }) {
    const body = { guildId, queryText, limit };
    if (userIds?.length > 0) body.userIds = userIds;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/memory/search", { body });
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  /**
   * Generate an embedding vector for text via Prism's /embed endpoint.
   * @param {object} payload
   * @param {string} payload.text
   * @param {string} [payload.provider="openai"]
   * @param {string} [payload.model]
   * @returns {Promise<{ embedding: number[], dimensions: number }>}
   */
  static async generateEmbedding({ text, provider = "openai", model, traceId }) {
    const body = { provider, text };
    if (model) body.model = model;
    if (traceId) body.traceId = traceId;

    return PrismService._request("/embed", { body });
  }

}
