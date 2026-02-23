import 'dotenv/config';
import config from '#config.json' with { type: 'json' };
const {
    BARK_VOICE_MODEL_API_URL,
} = config;

const BarkAIWrapper = {
    async generateVoice(text) {
        try {
            const response = await fetch(BARK_VOICE_MODEL_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                })
            });
            if (!response.ok) {
                console.log('Error:', response.status);
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error('Error:', error);
            return null;
        }
    }
};

export default BarkAIWrapper;