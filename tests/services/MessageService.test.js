import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
jest.unstable_mockModule('../../config.json', () => ({
    default: {
        ASSISTANT_MESSAGE: null
    }
}), { virtual: true });

jest.unstable_mockModule('../../constants/MessageConstants.js', () => ({
    default: {
        clockCrewCorePersonality: 'CLOCK_CREW_PERSONALITY',
        aiInformation: 'AI_INFO',
        responseGuidelines: 'RESPONSE_GUIDELINES',
        interactionRules: 'INTERACTION_RULES',
        discordSpecificRules: 'DISCORD_RULES',
        sleeperAgentMode: 'SLEEPER_AGENT',
        corePersonality: 'CORE_PERSONALITY',
        politicalBeliefs: 'POLITICAL_BELIEFS'
    }
}));
jest.unstable_mockModule('../../constants/ClockCrewConstants.js', () => ({
    default: {
        clocks_without_profiles: [{ name: 'TestClock1' }],
        clocks_with_profiles: [{ name: 'TestClock2', url: 'http://test', description: 'desc' }]
    }
}));

const MessageService = (await import('../../services/MessageService.js')).default;

describe('MessageService', () => {
    test('assembleAssistantMessage should include image generation string if canGenerateImage is true', () => {
        const message = MessageService.assembleAssistantMessage(true, '12345');
        expect(message).toContain('You are able to generate images');
        expect(message).not.toContain('You cannot generate images, paintings, or drawings.');
        expect(message).toContain('CORE_PERSONALITY');
    });

    test('assembleAssistantMessage should include no image generation string if canGenerateImage is false', () => {
        const message = MessageService.assembleAssistantMessage(false, '12345');
        expect(message).toContain('You cannot generate images, paintings, or drawings.');
        expect(message).not.toContain('You are able to generate images such as');
        expect(message).toContain('CORE_PERSONALITY');
    });

    test('assembleAssistantMessage should include clock crew information if specific guild is provided', () => {
        const message = MessageService.assembleAssistantMessage(true, '249010731910037507');
        expect(message).toContain('List of Clocks');
        expect(message).toContain('TestClock1');
        expect(message).toContain('TestClock2');
        expect(message).toContain('CLOCK_CREW_PERSONALITY');
        expect(message).not.toContain('CORE_PERSONALITY');
    });

    test('assembleAssistantMessageForImagePromptGeneration should combine core personality and political beliefs', () => {
        const message = MessageService.assembleAssistantMessageForImagePromptGeneration();
        expect(message).toContain('CORE_PERSONALITY');
        expect(message).toContain('POLITICAL_BELIEFS');
    });
});
