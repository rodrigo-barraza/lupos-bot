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
     * Generate text via Prism's /text-to-text endpoint.
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
    async generateText(conversation, type, model, tokens, temperature, username = "lupos") {
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

        const response = await fetch(`${PRISM_API_URL}/text-to-text`, {
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
     * Generate an image via Prism's /text-to-image endpoint.
     *
     * @param {string} prompt - Image generation prompt
     * @param {string} provider - Provider name for Prism (e.g. 'google', 'openai')
     * @param {string} model - Model name
     * @param {Array<string>} images - Array of base64 data URLs for image editing
     * @param {string} username - Username for tracking
     * @returns {Promise<{ imageData: string, mimeType: string, text: string }>}
     */
    async generateImage(prompt, provider = "google", model, images = [], username = "lupos") {
        const body = {
            provider,
            prompt,
        };

        if (model) body.model = model;
        if (images.length > 0) body.images = images;

        const response = await fetch(`${PRISM_API_URL}/text-to-image`, {
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
     * Caption an image via Prism's /image-to-text endpoint.
     *
     * @param {string} imageUrl - URL or base64 data URL of the image
     * @param {string} prompt - Caption prompt
     * @param {string} provider - Provider name for Prism
     * @param {string} model - Model name
     * @param {string} username - Username for tracking
     * @returns {Promise<{ text: string }>}
     */
    async captionImage(imageUrl, prompt, provider = "openai", model, username = "lupos") {
        const body = {
            provider,
            image: imageUrl,
            prompt,
        };

        if (model) body.model = model;

        const response = await fetch(`${PRISM_API_URL}/image-to-text`, {
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
     * Transcribe audio via Prism's /audio-to-text endpoint.
     *
     * @param {Buffer} audioBuffer - Audio file buffer
     * @param {string} mimeType - MIME type of the audio
     * @param {string} provider - Provider name for Prism
     * @param {string} model - Model name
     * @param {string} username - Username for tracking
     * @returns {Promise<{ text: string, usage: object }>}
     */
    async transcribeAudio(audioBuffer, mimeType, provider = "openai", model, username = "lupos") {
        const base64 = audioBuffer.toString("base64");
        const body = {
            provider,
            audio: `data:${mimeType};base64,${base64}`,
        };

        if (model) body.model = model;

        const response = await fetch(`${PRISM_API_URL}/audio-to-text`, {
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
    async saveConversation(id, title, messages, systemPrompt = "", settings = {}, username = "lupos") {
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
};

export default PrismWrapper;
