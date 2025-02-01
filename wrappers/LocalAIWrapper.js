require('dotenv/config');

const {
    LOCAL_LANGUAGE_MODEL_API_URL,
    LANGUAGE_MODEL_TEMPERATURE,
    LANGUAGE_MODEL_MAX_TOKENS,
    LANGUAGE_MODEL_LOCAL
} = require('../config.json');

const LocalAIWrapper = {
    async generateTextResponse(
        conversation,
        model=LANGUAGE_MODEL_LOCAL,
        tokens=LANGUAGE_MODEL_MAX_TOKENS,
        temperature=LANGUAGE_MODEL_TEMPERATURE
    ) {
        let text;

        // remove name property from object in conversation
        conversation = conversation.map((message) => {
            if (message.name) {
                delete message.name;
            }
            return message;
        });

        const mergedData = conversation.reduce((accumulator, value, index, array) => {
            if (value.role === 'system') {
                accumulator.push(value);
            } else if (["user", "assistant"].includes(value.role)) {
              if (accumulator.length && accumulator[accumulator.length - 1].role === value.role) {
                if (value.role === "user" && index === array.length - 1) {
                  accumulator[accumulator.length - 1].content = `${value.content}`;
                } else {
                  if(index < array.length - 1 && accumulator[accumulator.length - 1].role !== array[index + 1].role){
                    accumulator[accumulator.length - 1].content += `\n\n${value.content}`;
                  } else {
                    accumulator[accumulator.length - 1].content += `\n\n${value.content}`;
                  } 
                }
              } else {
                accumulator.push(value);
              }
            }
            return accumulator;
          }, []);

        if (mergedData[1].role === "assistant") {
          // remove assistant message
            mergedData.splice(1, 1);
        }

        const response = await fetch(`${LOCAL_LANGUAGE_MODEL_API_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: mergedData,
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
