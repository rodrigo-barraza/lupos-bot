import { GoogleGenAI } from '@google/genai';
import config from '#root/config.json' with { type: 'json' };
const {
    GOOGLE_KEY
} = config;

const googleGenAI = new GoogleGenAI({
    apiKey: GOOGLE_KEY,
});

const GoogleAIWrapper = {
    async generateGoogleAIImage(prompt, images = []) {
        const settings = {
            model: 'gemini-3.1-flash-image-preview',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: prompt,
                        },
                    ],
                },
            ],
        }
        if (images.length) {
            for (const image of images) {
                settings.contents[0].parts.push({
                    inlineData: {
                        data: image.data,
                        mimeType: image.type,
                    }
                })
            }
        }
        const response = await googleGenAI.models.generateContentStream(settings);
        const countTokensResponse = await googleGenAI.models.countTokens(settings);
        const allInputTokenCount = countTokensResponse.totalTokens;
        // console.log('Google AI Image Generation Prompt:', prompt);
        // console.log('Google AI Image Generation Settings:', settings);
        // console.log('Google AI Image Generation Has Input Images:', images.length);
        // console.log('Google AI Image Generation Response Stream:');
        let combinedChunkText = '';
        for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
                continue;
            }
            if (chunk.candidates?.[0]?.finishReason === 'PROHIBITED_CONTENT') {
                console.error('Content was flagged as PROHIBITED_CONTENT by Google AI.');
                return { response: null, error: true };
            }
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
                const inlineData = chunk.candidates[0].content.parts[0].inlineData;
                // Count combinedChunkText tokens
                const countTokensResponse = await googleGenAI.models.countTokens({
                    model: 'gemini-3.1-flash-image-preview',
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: combinedChunkText
                                }
                            ]
                        }
                    ]
                });
                const textOutputTokenCount = countTokensResponse.totalTokens || 0;

                const responseObject = {
                    imageData: inlineData.data,
                    text: combinedChunkText,
                    allInputTokenCount: allInputTokenCount,
                    textOutputTokenCount: textOutputTokenCount,
                }

                return { response: responseObject, error: null };
            }
            else {
                combinedChunkText += chunk.text;
                console.log(chunk.text);
            }
        }
    }
};

export default GoogleAIWrapper;