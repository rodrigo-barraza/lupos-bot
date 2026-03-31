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
   * @param {string} [payload.conversationId] - Conversation ID for server-side accumulation
   * @param {object} [payload.userMessage] - User message for auto-append
   * @returns {Promise<{ text: string, usage: object, model: string, provider: string, estimatedCost: number|null }>}
   */
  static async generateText({
    messages,
    type,
    model,
    maxTokens,
    temperature,
    username = "lupos",
    conversationId,
    userMessage,
    conversationMeta,
    createSession,
    sessionId,
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
    };

    if (maxTokens) body.options.maxTokens = maxTokens;
    if (temperature !== undefined) body.options.temperature = temperature;
    if (conversationId) body.conversationId = conversationId;
    if (userMessage) body.userMessage = userMessage;
    if (conversationMeta) body.conversationMeta = conversationMeta;
    if (createSession) body.createSession = true;
    if (sessionId) body.sessionId = sessionId;


    const data = await PrismService._request("/chat?stream=false", {
      body,
      username,
    });

    return {
      text: data.text,
      usage: data.usage || { inputTokens: 0, outputTokens: 0 },
      model: data.model,
      provider: data.provider,
      estimatedCost: data.estimatedCost || null,
      sessionId: data.sessionId || null,
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
   * @param {string} [payload.conversationId]
   * @param {object} [payload.userMessage]
   * @param {string} [payload.systemPrompt]
   * @returns {Promise<{ imageData: string, mimeType: string, text: string, minioRef: string|null, usage: object|null, estimatedCost: number|null, model: string, provider: string }>}
   */
  static async generateImage({
    prompt,
    provider = "google",
    model,
    images = [],
    username = "lupos",
    conversationId,
    userMessage,
    conversationMeta,
    systemPrompt,
    createSession,
    sessionId,
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
    };

    if (systemPrompt) body.systemPrompt = systemPrompt;
    if (conversationId) body.conversationId = conversationId;
    if (userMessage) body.userMessage = userMessage;
    if (conversationMeta) body.conversationMeta = conversationMeta;
    if (createSession) body.createSession = true;
    if (sessionId) body.sessionId = sessionId;


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
      usage: result.usage || null,
      estimatedCost: result.estimatedCost ?? null,
      model: result.model,
      provider: result.provider,
      sessionId: result.sessionId || null,
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
   * @param {string} [payload.conversationId]
   * @param {object} [payload.userMessage]
   * @param {string} [payload.systemPrompt]
   * @returns {Promise<{ text: string }>}
   */
  static async captionImage({
    images,
    prompt,
    provider = "openai",
    model,
    username = "lupos",
    conversationId,
    userMessage,
    conversationMeta,
    systemPrompt,
    createSession,
    sessionId,
  }) {
    const normalizedImages = Array.isArray(images) ? images : [images];

    const body = {
      provider,
      messages: [{ role: "user", content: prompt, images: normalizedImages }],
    };

    if (model) body.model = model;
    if (systemPrompt) body.systemPrompt = systemPrompt;
    if (conversationId) body.conversationId = conversationId;
    if (userMessage) body.userMessage = userMessage;
    if (conversationMeta) body.conversationMeta = conversationMeta;
    if (createSession) body.createSession = true;
    if (sessionId) body.sessionId = sessionId;


    const result = await PrismService._request("/chat?stream=false", { body, username });
    return {
      ...result,
      sessionId: result.sessionId || null,
    };
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
   * @param {string} [payload.conversationId]
   * @param {object} [payload.conversationMeta]
   * @param {boolean} [payload.createSession]
   * @param {string} [payload.sessionId]
   * @returns {Promise<{ text: string, usage: object, estimatedCost: number|null, totalTime: number|null, sessionId: string|null }>}
   */
  static async transcribeAudio({
    audio,
    mimeType = "audio/mpeg",
    provider = "openai",
    model,
    language,
    username = "lupos",
    conversationId,
    conversationMeta,
    createSession,
    sessionId,
  }) {
    // Accept Buffer or base64 string
    const base64Audio = Buffer.isBuffer(audio)
      ? audio.toString("base64")
      : audio;
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    const body = { provider, audio: dataUrl };
    if (model) body.model = model;
    if (language) body.language = language;
    if (conversationId) body.conversationId = conversationId;
    if (conversationMeta) body.conversationMeta = conversationMeta;
    if (createSession) body.createSession = true;
    if (sessionId) body.sessionId = sessionId;

    const result = await PrismService._request("/audio-to-text", {
      body,
      username,
    });

    return {
      text: result.text,
      usage: result.usage || {},
      estimatedCost: result.estimatedCost ?? null,
      totalTime: result.totalTime ?? null,
      sessionId: result.sessionId || null,
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
  }) {
    const body = { guildId, channelId, messages, participants };
    if (sourceMessageId) body.sourceMessageId = sourceMessageId;

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
  static async searchMemories({ guildId, userIds, queryText, limit = 10 }) {
    const body = { guildId, queryText, limit };
    if (userIds?.length > 0) body.userIds = userIds;

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
  static async generateEmbedding({ text, provider = "openai", model }) {
    const body = { provider, text };
    if (model) body.model = model;

    return PrismService._request("/embed", { body });
  }

}
