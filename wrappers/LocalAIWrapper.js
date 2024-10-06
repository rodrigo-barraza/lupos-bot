require('dotenv/config');

const {
    LOCAL_LANGUAGE_MODEL_API_URL,
    LANGUAGE_MODEL_TEMPERATURE,
    LANGUAGE_MODEL_MAX_TOKENS,
    LANGUAGE_MODEL_LOCAL
} = require('../config.json');

const LocalAIWrapper = {
    async generateText(
        conversation,
        model=LANGUAGE_MODEL_LOCAL,
        tokens=LANGUAGE_MODEL_MAX_TOKENS,
        temperature=LANGUAGE_MODEL_TEMPERATURE
    ) {
        let text;
        const response = await fetch(`${LOCAL_LANGUAGE_MODEL_API_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: conversation,
                model: model,
                temperature: temperature,
                max_tokens: tokens,
                stream: false
            })
        }).catch(error => console.error('Error:', error));
        let responseJson = await response.json();
        if (responseJson.choices[0].message.content) {
            text = responseJson.choices[0].message.content;
        }
        return text;
    },
    async generateEmbedding(text) {
        return await fetch(`${LOCAL_LANGUAGE_MODEL_API_URL}/v1/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // model: "text-embedding-ada-002",
                input: text
            })
        }).catch(error => console.error('Error:', error));
    },
};

module.exports = LocalAIWrapper;
