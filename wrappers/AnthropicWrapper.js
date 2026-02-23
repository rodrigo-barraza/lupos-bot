import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import config from '../config.json' with { type: 'json' };
const {
    LANGUAGE_MODEL_TEMPERATURE,
    LANGUAGE_MODEL_MAX_TOKENS,
    LANGUAGE_MODEL_ANTHROPIC,
    ANTHROPIC_KEY
} = config;

const client = new Anthropic({ apiKey: ANTHROPIC_KEY })

const AnthrophicWrapper = {
    async generateAnthropicTextResponse(
        conversation,
        model = LANGUAGE_MODEL_ANTHROPIC,
        tokens = LANGUAGE_MODEL_MAX_TOKENS,
        temperature = LANGUAGE_MODEL_TEMPERATURE
    ) {
        let text;
        let systemMessage;
        if (conversation[0].role === 'system') {
            systemMessage = conversation.shift().content;
        }
        // remove name property from object in conversation
        conversation = conversation.map((message) => {
            if (message.name) {
                delete message.name;
            }
            return message;
        });

        const mergedData = conversation.reduce((acc, cur, index, array) => {
            if (cur.role === "user" || cur.role === "assistant") {
                if (acc.length && acc[acc.length - 1].role === cur.role) {
                    // Merge consecutive messages from the same role
                    if (cur.role === "user" && (index === array.length - 1 || array[index + 1].role !== "user")) {
                        // Special handling for the last user message in a sequence
                        acc[acc.length - 1].content += `\n\n${cur.content}`;
                    } else {
                        acc[acc.length - 1].content += `\n\n${cur.content}`;
                    }
                } else {
                    // Push a COPY of the message, not the reference
                    acc.push({ ...cur });
                }
            }
            return acc;
        }, []);

        if (mergedData[0].role === "assistant") {
            mergedData.shift();
        }

        const messagesBody = {
            system: systemMessage,
            temperature: temperature,
            model: model,
            messages: mergedData,
            max_tokens: tokens,
        };

        try {
            const response = await client.messages.create(messagesBody);
            if (response.content[0].text) {
                text = response.content[0].text;
            }
        } catch (error) {
            console.error('Anthropic Error:\n', error);
            return { text: null, error };
        }

        return { text, error: null };
    },
    async countTokens(
        conversation,
        model
    ) {
        let tokens;
        let system;
        if (conversation[0].role === 'system') {
            system = conversation.shift().content;
        }
        // remove name property from object in conversation
        conversation = conversation.map((message) => {
            if (message.name) {
                delete message.name;
            }
            return message;
        });
        const response = await client.messages.count_tokens({
            model: model,
            system: system,
            messages: conversation,
        }).catch((error) => console.error('Anthropic Error:\n', error));
        if (response.token_count) {
            tokens = response.token_count;
        }
        return tokens;
    },
};

export default AnthrophicWrapper;