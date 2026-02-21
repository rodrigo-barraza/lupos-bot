// Mock the dependencies before importing MessageService
jest.mock('../../config.json', () => ({
    ASSISTANT_MESSAGE: null
}), { virtual: true });

jest.mock('../../constants/MessageConstants.js', () => ({
    clockCrewCorePersonality: 'CLOCK_CREW_PERSONALITY',
    aiInformation: 'AI_INFO',
    responseGuidelines: 'RESPONSE_GUIDELINES',
    interactionRules: 'INTERACTION_RULES',
    discordSpecificRules: 'DISCORD_RULES',
    sleeperAgentMode: 'SLEEPER_AGENT',
    corePersonality: 'CORE_PERSONALITY',
    politicalBeliefs: 'POLITICAL_BELIEFS'
}));

jest.mock('../../constants/ClockCrewConstants.js', () => ({
    clocks_without_profiles: [{ name: 'TestClock1' }],
    clocks_with_profiles: [{ name: 'TestClock2', url: 'http://test', description: 'desc' }]
}));

const MessageService = require('../../services/MessageService');

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
