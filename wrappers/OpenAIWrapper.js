require('dotenv/config');
const { OpenAI } = require('openai');
const {
    LANGUAGE_MODEL_TEMPERATURE,
    LANGUAGE_MODEL_PERFORMANCE,
    LANGUAGE_MODEL_MAX_TOKENS,
    LANGUAGE_MODEL_OPENAI,
    FAST_LANGUAGE_MODEL_OPENAI,
    LANGUAGE_MODEL_LOCAL,
    OPENAI_VISION_MODEL,
    VOICE_MODEL,
    VOICE_MODEL_VOICE,
    VOICE_MODEL_SPEED,
    VISION_MODEL_MAX_TOKENS,
    OPENAI_KEY
} = require('../config.json');

const openai = new OpenAI({apiKey: OPENAI_KEY})

const OpenAIWrapper = {
    async generateFunctionResponse(customFunction, customFunctionName) {
        const messages = [{ role: "user", content: "What's the weather like in San Francisco, Tokyo, and Paris?" }];
        const tools = [
            {
            type: "function",
            function: {
                name: "get_current_weather",
                description: "Get the current weather in a given location",
                parameters: {
                type: "object",
                properties: {
                    location: {
                        type: "string",
                        description: "The city and state, e.g. San Francisco, CA",
                    },
                    unit: { type: "string", enum: ["celsius", "fahrenheit"] },
                },
                required: ["location"],
                },
            },
            },
        ];

        let response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages,
            tools: tools,
            tool_choice: "auto",
        });
      
        let response_message = response.data.choices[0].message;
        
        let tool_calls = response.data.choices[0].tool_calls;
        if (tool_calls) {
          messages.push(response_message);
          const available_functions = {
            "get_current_weather": get_current_weather,
          };
          
          for (let tool_call of tool_calls) {
            let functionName = tool_call.function.name;
            let functionToCall = available_functions[functionName];
            let functionArgs = JSON.parse(tool_call.function.arguments);
            let functionResponse = functionToCall(functionArgs.location, functionArgs.unit);
            messages.push({
              tool_call_id: tool_call.id,
              role: "tool",
              name: functionName,
              content: functionResponse,
            });
          }
          let second_response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages,
          });
          return second_response;
        }

    },
    async generateVoiceResponse(text) {
        const response = await openai.audio.speech.create({
            model: VOICE_MODEL,
            voice: VOICE_MODEL_VOICE,
            speed: VOICE_MODEL_SPEED,
            input: text,
          }).catch((error) => console.error('OpenAI Error:\n', error));
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer;
    },
    async generateVisionResponse(imageUrl, text) {
        let response, error;
        try {
            const messages = [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": text ? text : "What's in this image?" },
                        {
                            "type": "image_url",
                            "image_url": {
                            "url": imageUrl,
                            },
                        },
                    ]
                }
            ];
            const completionObject = {
                model: OPENAI_VISION_MODEL,
                messages: messages,
                max_tokens: VISION_MODEL_MAX_TOKENS,
            };
            response = await openai.chat.completions.create(completionObject);
        } catch (err) {
            error = err;
        }
        return { response, error };
    },
    async generateTextResponse(
        conversation,
        model=LANGUAGE_MODEL_LOCAL,
        tokens=LANGUAGE_MODEL_MAX_TOKENS,
        temperature=LANGUAGE_MODEL_TEMPERATURE
    ) {
        let text;
        const response = await openai.chat.completions.create({
            temperature: temperature,
            model: model,
            messages: conversation,
            max_tokens: tokens,
        }).catch((error) => console.error('OpenAI Error:\n', error));
        if (response.choices[0].message.content) {
            text = response.choices[0].message.content;
        }
        return text;
    },
    async generateEmbeddingResponse(text) {
        return await openai.embedding.create({
            model: "text-embedding-ada-002",
            input: text,
        }).catch((error) => console.error('OpenAI Error:\n', error));
    },
};

module.exports = OpenAIWrapper;
