require('dotenv/config');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    LANGUAGE_MODEL_TEMPERATURE,
    LANGUAGE_MODEL_MAX_TOKENS,
    GOOGLE_KEY
} = require('../config.json');

const generativeAI = new GoogleGenerativeAI(GOOGLE_KEY);

const GoogleAIWrapper = {
    async generateChat(
        history,
        systemInstruction,
        model="gemini-1.5-flash",
        maxTokens=LANGUAGE_MODEL_MAX_TOKENS,
        temperature=LANGUAGE_MODEL_TEMPERATURE
    ) {
        let text;

        const model = generativeAI.getGenerativeModel({
            model: model,
            systemInstruction: systemInstruction
        });

        model.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: temperature,
            },
        });

        text = result.response.text()

        return text;
    },
};

module.exports = GoogleAIWrapper;
