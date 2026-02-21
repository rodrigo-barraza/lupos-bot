const YapperService = require('../../services/YapperService');

jest.mock('../../services/AIService', () => ({
    generateTextFromSystemUserMessages: jest.fn().mockResolvedValue('Mocked AI response')
}));

jest.mock('../../services/MoodService', () => ({
    decreaseMoodLevel: jest.fn()
}));

const AIService = require('../../services/AIService');
const MoodService = require('../../services/MoodService');

describe('YapperService', () => {
    beforeEach(() => {
        YapperService.setYappers([]);
        jest.clearAllMocks();
    });

    test('should handle setting and getting yappers', () => {
        const mockYappers = [
            { displayName: 'User1', count: 50 },
            { displayName: 'User2', count: 30 }
        ];

        YapperService.setYappers(mockYappers);
        expect(YapperService.getYappers()).toEqual(mockYappers);
    });

    test('yapperMessage should decrease mood call AI service with formatted prompt', async () => {
        const mockYappers = [
            { displayName: 'User1', count: 50 },
            { displayName: 'User2', count: 30 }
        ];
        YapperService.setYappers(mockYappers);

        const mockInteraction = { user: { id: '123' } };

        const response = await YapperService.yapperMessage(mockInteraction);

        expect(MoodService.decreaseMoodLevel).toHaveBeenCalledTimes(1);
        expect(AIService.generateTextFromSystemUserMessages).toHaveBeenCalledTimes(1);

        const callArgs = AIService.generateTextFromSystemUserMessages.mock.calls[0];
        const systemContent = callArgs[0];
        const userContent = callArgs[1];
        const interactionArg = callArgs[2];

        expect(systemContent).toContain('User1 with 50 recent yaps');
        expect(systemContent).toContain('User2 with 30 recent yaps');
        expect(userContent).toContain('top 5 yappers');
        expect(interactionArg).toBe(mockInteraction);

        expect(response).toBe('Mocked AI response');
    });
});
