import { MessageConstant, ClockCrewConstants } from "#root/constants.js";
import config from "#root/config.js";
const { ASSISTANT_MESSAGE } = config;

const MessageService = {
  assembleAssistantMessage(canGenerateImage, guildId) {
    let assistantMessage = "";
    if (ASSISTANT_MESSAGE) {
      assistantMessage = ASSISTANT_MESSAGE;
    } else {
      if (canGenerateImage) {
        assistantMessage += `# Generative capabilities`;
        assistantMessage += `\n- You are able to generate text.`;
        assistantMessage += `\n- You are part of a multi-modal workflow that can generate text and images.`;
        assistantMessage += `\n- Images are generated SEPARATELY by the system — you do NOT produce images yourself.`;
        assistantMessage += `\n- NEVER claim you "drew", "created", "made", or "generated" an image unless an image is ACTUALLY attached to your message.`;
        assistantMessage += `\n- NEVER describe what an image looks like as if you produced it — if no image is attached, no image exists.`;
        assistantMessage += `\n- When asked to draw, acknowledge the request conversationally but do NOT pretend the image already exists.`;
        assistantMessage += `\n- You cannot generate sound or audio.`;
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
      if (guildId === config.GUILD_ID_CLOCK_CREW) {
        const clockWithoutProfiles = ClockCrewConstants.clocks_without_profiles;
        const clocksWithProfiles = ClockCrewConstants.clocks_with_profiles;
        const allClocks = [...clockWithoutProfiles, ...clocksWithProfiles];

        if (allClocks.length) {
          assistantMessage += `\n# List of Clocks`;
          for (const clock of allClocks) {
            const url = clock.url;
            const name = clock.name;
            const description = clock.description;
            assistantMessage += `\n- ${name}`;
            if (url) {
              // assistantMessage += `\n  - Newgrounds Sub-domain path: ${url}`;
              if (description) {
                assistantMessage += `\n  - Description: ${description}`;
              }
            }
          }
        }

        assistantMessage += `${MessageConstant.clockCrewCorePersonality}
${MessageConstant.aiInformation}
${MessageConstant.responseGuidelines}
${MessageConstant.interactionRules}
${MessageConstant.discordSpecificRules}
${MessageConstant.sleeperAgentMode}`;
      } else {
        assistantMessage += `${MessageConstant.corePersonality}
${MessageConstant.aiInformation}
${MessageConstant.responseGuidelines}
${MessageConstant.interactionRules}
${MessageConstant.discordSpecificRules}
${MessageConstant.politicalBeliefs}
${MessageConstant.sleeperAgentMode}`;
      }
    }
    return assistantMessage;
  },
  assembleAssistantMessageForImagePromptGeneration() {
    let assistantMessage = "";
    assistantMessage = `${MessageConstant.corePersonality}
${MessageConstant.politicalBeliefs}`;
    return assistantMessage;
  },
};

export default MessageService;
