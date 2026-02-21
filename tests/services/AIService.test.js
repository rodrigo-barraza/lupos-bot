const AIService = require('../../services/AIService');
const DiscordUtilityService = require('../../services/DiscordUtilityService');

jest.mock('../../services/DiscordUtilityService', () => ({
    getUsernameNoSpaces: jest.fn().mockReturnValue('TestUser')
}));

describe('AIService', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('generateTextSummaryFromMessage', () => {
        it('should call generateText and return a cropped summary', async () => {
            const generateTextSpy = jest.spyOn(AIService, 'generateText').mockResolvedValue('😀 A very long string that could potentially exceed one hundred and twenty eight characters just to make sure the substring logic works correctly as expected.');

            const mockMessage = { author: { username: 'test' } };
            const summary = await AIService.generateTextSummaryFromMessage(mockMessage, 'Test content');

            expect(generateTextSpy).toHaveBeenCalledTimes(1);
            expect(summary.length).toBeLessThanOrEqual(128);
            expect(summary).toContain('😀 A very long string');

            generateTextSpy.mockRestore();
        });
    });

    describe('generateTextCustomEmojiReactFromMessage', () => {
        it('should call generateText and format the result accurately when custom emoji', async () => {
            const generateTextSpy = jest.spyOn(AIService, 'generateText').mockResolvedValue(' customEmojiMock \n');

            const mockGuild = {
                id: '123',
            };
            const mockClient = {
                user: { id: 'bot123' },
                guilds: {
                    cache: {
                        get: jest.fn().mockReturnValue({
                            emojis: {
                                cache: new Map([
                                    ['1', { id: '111', name: 'customEmojiMock' }],
                                    ['2', { id: '222', name: 'other' }]
                                ])
                            }
                        })
                    }
                }
            };

            const mockMessage = {
                content: '<@bot123> Test Message',
                client: mockClient,
                guild: mockGuild
            };

            const result = await AIService.generateTextCustomEmojiReactFromMessage(mockMessage, null);

            expect(result).toBe('111'); // Because it is wrapped inside logic to find by name and return id
            expect(generateTextSpy).toHaveBeenCalledTimes(1);

            generateTextSpy.mockRestore();
        });
    });
});
