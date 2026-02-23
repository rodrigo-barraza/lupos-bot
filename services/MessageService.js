import MessageConstant from '#/constants/MessageConstants.js';
import ClockCrewConstants from '#/constants/ClockCrewConstants.js';
import config from '#/config.json' with { type: 'json' };
const { ASSISTANT_MESSAGE } = config;

const MessageService = {
    assembleAssistantMessage(canGenerateImage, guildId) {
        let assistantMessage = '';
        if (ASSISTANT_MESSAGE) {
            assistantMessage = ASSISTANT_MESSAGE;
        } else {
            if (canGenerateImage) {
                assistantMessage += `# Generative capabilities`;
                assistantMessage += `\n- You are able to generate text.`;
                assistantMessage += `\n- You are able to generate images such as paintings, drawings, and more.`;
                assistantMessage += `\n- You are able to draw, paint, sketch, design, illustrate, and create images.`;
                assistantMessage += `\n- If you were previously unable to generate images, you are now able to do so.`;
                assistantMessage += `\n- You cannot generate sound or audio.`;
                assistantMessage += `\n- You are part of a multi-modal workflow that is able to generate text, images, and anything else visual like charts, graphs, photographs, and more.`;
                assistantMessage += `\n- When asked to draw or generate an image, acknowlege that you can do, but continue your conversation with the user.`;
                assistantMessage += `\n- When asked to draw, do not output an image prompt, but rather acknowledge that you can draw and continue the conversation.`;
                assistantMessage += `\n\n`;
            } else {
                assistantMessage += `\n\n# Generative capabilities`;
                assistantMessage += `\n- You are able to generate text.`;
                assistantMessage += `\n- You cannot generate images, paintings, or drawings.`;
                assistantMessage += `\n- You cannot draw, paint, sketch, design, illustrate, or create images.`;
                assistantMessage += `\n- If you were previously able to generate images, you are no longer able to do so.`;
                assistantMessage += `\n- You cannot generate sound or audio.`;
                assistantMessage += `\n- When asked to draw or generate an image, tell the person to ask Rodrigo to turn on the image generation capabilities.`;
                assistantMessage += `\n\n`;
            }
            // If Clock Crew guild, add Clock Crew information
            if (guildId === '249010731910037507') {
                const clockWithoutProfiles = ClockCrewConstants.clocks_without_profiles;
                const clocksWithProfiles = ClockCrewConstants.clocks_with_profiles;
                const allClocks = [...clockWithoutProfiles, ...clocksWithProfiles];

                if (allClocks.length) {
                    assistantMessage += `\n# List of Clocks`;
                    for (const clock of allClocks) {
                        const url = clock.url;
                        const name = clock.name;
                        const description = clock.description;
                        assistantMessage += `\n- ${name}`
                        if (url) {
                            // assistantMessage += `\n  - Newgrounds Sub-domain path: ${url}`;
                            if (description) {
                                assistantMessage += `\n  - Description: ${description}`;
                            }
                        }
                    }
                }

                assistantMessage +=
                    `${MessageConstant.clockCrewCorePersonality}
${MessageConstant.aiInformation}
${MessageConstant.responseGuidelines}
${MessageConstant.interactionRules}
${MessageConstant.discordSpecificRules}
${MessageConstant.sleeperAgentMode}`
            } else {
                assistantMessage +=
                    `${MessageConstant.corePersonality}
${MessageConstant.aiInformation}
${MessageConstant.responseGuidelines}
${MessageConstant.interactionRules}
${MessageConstant.discordSpecificRules}
${MessageConstant.politicalBeliefs}
${MessageConstant.sleeperAgentMode}`;
            }
        }
        return assistantMessage
    },
    assembleAssistantMessageForImagePromptGeneration() {
        let assistantMessage = '';
        assistantMessage =
            `${MessageConstant.corePersonality}
${MessageConstant.politicalBeliefs}`;
        return assistantMessage;
    },
};

export default MessageService;