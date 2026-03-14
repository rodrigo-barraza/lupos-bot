import config from "#root/config.json" with { type: "json" };

const PRISM_API_URL = config.PRISM_API_URL;
const PRISM_API_SECRET = config.PRISM_API_SECRET;

// Map lupos provider types to Prism provider names
const PROVIDER_MAP = {
    OPENAI: "openai",
    ANTHROPIC: "anthropic",
    LOCAL: "lm-studio",
    GOOGLE: "google",
};

function getHeaders(username = "lupos") {
    return {
        "Content-Type": "application/json",
        "x-api-secret": PRISM_API_SECRET,
        "x-project": "lupos",
        "x-username": username,
    };
}

const PrismWrapper = {
    /**
     * Generate text via Prism's /chat endpoint.
     * Maps lupos's provider types (OPENAI, ANTHROPIC, LOCAL) to Prism provider names.
     *
     * @param {Array} conversation - Array of { role, name?, content } message objects
     * @param {string} type - Provider type: 'OPENAI', 'ANTHROPIC', 'LOCAL', 'GOOGLE'
     * @param {string} model - Model name
     * @param {number} tokens - Max tokens
     * @param {number} temperature - Temperature
     * @param {string} username - Username for tracking
     * @returns {Promise<{ text: string, usage: object }>}
     */
    async generateText(
        conversation,
        type,
        model,
        tokens,
        temperature,
        username = "lupos",
        { conversationId, userMessage } = {},
    ) {
        const provider = PROVIDER_MAP[type];
        if (!provider) {
            throw new Error(`Unknown provider type: ${type}`);
        }

        const body = {
            provider,
            model,
            messages: conversation,
            options: {},
        };

        if (tokens) body.options.maxTokens = tokens;
        if (temperature !== undefined) body.options.temperature = temperature;
        if (conversationId) body.conversationId = conversationId;
        if (userMessage) body.userMessage = userMessage;

        const response = await fetch(`${PRISM_API_URL}/chat?stream=false`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        return {
            text: data.text,
            usage: data.usage || { inputTokens: 0, outputTokens: 0 },
            model: data.model,
            provider: data.provider,
            estimatedCost: data.estimatedCost || null,
        };
    },

    /**
     * Generate an image via Prism's /chat endpoint.
     *
     * @param {string} prompt - Image generation prompt
     * @param {string} provider - Provider name for Prism (e.g. 'google', 'openai')
     * @param {string} model - Model name
     * @param {Array<string>} images - Array of base64 data URLs for image editing
     * @param {string} username - Username for tracking
     * @returns {Promise<{ imageData: string, mimeType: string, text: string }>}
     */
    async generateImage(
        prompt,
        provider = "google",
        model,
        images = [],
        username = "lupos",
        { conversationId, userMessage, systemPrompt } = {},
    ) {
        // Convert images from { imageData, mimeType } objects to data URLs
        const imageDataUrls = images.map((img) => {
            if (typeof img === "string") return img;
            return `data:${img.mimeType || "image/png"};base64,${img.imageData}`;
        });

        // Build a messages array — the /chat endpoint requires it
        const messages = [
            {
                role: "user",
                content: prompt,
                ...(imageDataUrls.length > 0 && { images: imageDataUrls }),
            },
        ];

        const body = {
            provider,
            model,
            messages,
        };

        if (systemPrompt) body.systemPrompt = systemPrompt;
        if (conversationId) body.conversationId = conversationId;
        if (userMessage) body.userMessage = userMessage;

        const response = await fetch(`${PRISM_API_URL}/chat?stream=false`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        const result = await response.json();

        // Flatten the response to match what Lupos expects:
        // { imageData, mimeType, text, estimatedCost, ... }
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
        };
    },

    /**
     * Caption an image via Prism's /chat endpoint.
     *
     * @param {string|string[]} imageUrlOrArray - URL/base64 string or array of them
     * @param {string} prompt - Caption prompt
     * @param {string} provider - Provider name for Prism
     * @param {string} model - Model name
     * @param {string} username - Username for tracking
     * @returns {Promise<{ text: string }>}
     */
    async captionImage(
        imageUrlOrArray,
        prompt,
        provider = "openai",
        model,
        username = "lupos",
        { conversationId, userMessage, systemPrompt } = {},
    ) {
        // Normalize to array
        const images = Array.isArray(imageUrlOrArray) ? imageUrlOrArray : [imageUrlOrArray];

        // Build a messages array — the /chat endpoint requires it
        const messages = [
            {
                role: "user",
                content: prompt,
                images,
            },
        ];

        const body = {
            provider,
            messages,
        };

        if (model) body.model = model;
        if (systemPrompt) body.systemPrompt = systemPrompt;
        if (conversationId) body.conversationId = conversationId;
        if (userMessage) body.userMessage = userMessage;

        const response = await fetch(`${PRISM_API_URL}/chat?stream=false`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Transcribe audio via Prism's /chat endpoint.
     *
     * @param {Buffer} audioBuffer - Audio file buffer
     * @param {string} mimeType - MIME type of the audio
     * @param {string} provider - Provider name for Prism
     * @param {string} model - Model name
     * @param {string} username - Username for tracking
     * @returns {Promise<{ text: string, usage: object }>}
     */
    async transcribeAudio(
        audioBuffer,
        mimeType,
        provider = "openai",
        model,
        username = "lupos",
    ) {
        const base64 = audioBuffer.toString("base64");
        const audioDataUrl = `data:${mimeType};base64,${base64}`;

        // Build a messages array — the /chat endpoint requires it
        const messages = [
            {
                role: "user",
                content: "Transcribe this audio.",
                audio: audioDataUrl,
            },
        ];

        const body = {
            provider,
            messages,
        };

        if (model) body.model = model;

        const response = await fetch(`${PRISM_API_URL}/chat?stream=false`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },
    /**
     * Save or update a conversation via Prism's /conversations endpoint.
     * This makes conversations visible in the admin/conversations UI.
     *
     * @param {string} id - Unique conversation identifier (e.g. Discord channel ID)
     * @param {string} title - Conversation title
     * @param {Array} messages - Array of { role, name?, content } messages
     * @param {string} systemPrompt - System prompt used
     * @param {object} settings - Optional settings (model, provider, etc.)
     * @param {string} username - Username for tracking
     * @returns {Promise<object>}
     */
    async saveConversation(
        id,
        title,
        messages,
        systemPrompt = "",
        settings = {},
        username = "lupos",
    ) {
        const body = {
            id,
            title,
            messages,
            systemPrompt,
            settings,
        };

        const response = await fetch(`${PRISM_API_URL}/conversations`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Start a new conversation shell via Prism.
     * Returns { id } that can be passed to generation endpoints.
     */
    async startConversation(title, systemPrompt = "", settings = {}, username = "lupos") {
        const response = await fetch(`${PRISM_API_URL}/conversations/start`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify({ title, systemPrompt, settings }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Finalize a conversation — update metadata only (messages already saved server-side).
     */
    async finalizeConversation(id, title, systemPrompt = "", settings = {}, username = "lupos") {
        const response = await fetch(`${PRISM_API_URL}/conversations/${id}/finalize`, {
            method: "POST",
            headers: getHeaders(username),
            body: JSON.stringify({ title, systemPrompt, settings }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Extract and store memories from a conversation chunk.
     *
     * @param {string} guildId - Discord guild ID
     * @param {string} channelId - Discord channel ID
     * @param {Array} messages - Recent conversation messages [{ role, name?, content }]
     * @param {Array} participants - Array of { id, username, displayName }
     * @param {string} [sourceMessageId] - Message that triggered extraction
     * @returns {Promise<{ memories: Array, count: number }>}
     */
    async extractMemories(guildId, channelId, messages, participants, sourceMessageId = null) {
        const body = {
            guildId,
            channelId,
            messages,
            participants,
        };
        if (sourceMessageId) body.sourceMessageId = sourceMessageId;

        const response = await fetch(`${PRISM_API_URL}/memory/extract`, {
            method: "POST",
            headers: getHeaders("lupos"),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Search for relevant memories using vector similarity.
     *
     * @param {string} guildId - Discord guild ID
     * @param {string[]} [userIds] - Filter to memories about these users
     * @param {string} queryText - Text to search for
     * @param {number} [limit=10] - Max results
     * @returns {Promise<{ memories: Array, count: number }>}
     */
    async searchMemories(guildId, userIds = null, queryText, limit = 10) {
        const body = { guildId, queryText, limit };
        if (userIds && userIds.length > 0) body.userIds = userIds;

        const response = await fetch(`${PRISM_API_URL}/memory/search`, {
            method: "POST",
            headers: getHeaders("lupos"),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },

    /**
     * Generate an embedding vector for text via Prism's /embed endpoint.
     *
     * @param {string} text - Text to embed
     * @param {string} [provider="openai"] - Embedding provider
     * @param {string} [model] - Embedding model (defaults to provider default)
     * @returns {Promise<{ embedding: number[], dimensions: number }>}
     */
    async generateEmbedding(text, provider = "openai", model = null) {
        const body = { provider, text };
        if (model) body.model = model;

        const response = await fetch(`${PRISM_API_URL}/embed`, {
            method: "POST",
            headers: getHeaders("lupos"),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },
    /**
     * Save a workflow document via Prism's /workflows endpoint.
     *
     * @param {object} workflow - Workflow document with nodes, connections, steps, and metadata
     * @returns {Promise<object>}
     */
    async saveWorkflow(workflow) {
        const response = await fetch(`${PRISM_API_URL}/workflows`, {
            method: "POST",
            headers: getHeaders("lupos"),
            body: JSON.stringify(workflow),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Prism API error: ${response.status} ${errorText}`);
        }

        return response.json();
    },
};

export default PrismWrapper;
