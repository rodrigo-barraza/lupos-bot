const AlcoholService = require('../../services/AlcoholService');

jest.mock('../../services/DiscordService', () => ({
    generateInCharacterResponse2Special: jest.fn()
}));

describe('AlcoholService', () => {
    beforeEach(() => {
        AlcoholService.setAlcoholLevel(0);
        jest.clearAllMocks();
    });

    test('should initialize with an alcohol level of 0', () => {
        expect(AlcoholService.getAlcoholLevel()).toBe(0);
    });

    test('setAlcoholLevel should update the alcohol level', () => {
        AlcoholService.setAlcoholLevel(5);
        expect(AlcoholService.getAlcoholLevel()).toBe(5);
    });

    test('increaseAlcoholLevel should increase the level by 1', () => {
        AlcoholService.setAlcoholLevel(5);
        const newLevel = AlcoholService.increaseAlcoholLevel();
        expect(newLevel).toBe(6);
        expect(AlcoholService.getAlcoholLevel()).toBe(6);
    });

    test('increaseAlcoholLevel should not exceed 100', () => {
        AlcoholService.setAlcoholLevel(100);
        const newLevel = AlcoholService.increaseAlcoholLevel();
        expect(newLevel).toBe(100);
        expect(AlcoholService.getAlcoholLevel()).toBe(100);
    });

    test('decreaseAlcoholLevel should decrease the level by 1', () => {
        AlcoholService.setAlcoholLevel(5);
        const newLevel = AlcoholService.decreaseAlcoholLevel();
        expect(newLevel).toBe(4);
        expect(AlcoholService.getAlcoholLevel()).toBe(4);
    });

    test('decreaseAlcoholLevel should not fall below 0', () => {
        AlcoholService.setAlcoholLevel(0);
        const newLevel = AlcoholService.decreaseAlcoholLevel();
        expect(newLevel).toBe(0);
        expect(AlcoholService.getAlcoholLevel()).toBe(0);
    });

    test('generateAlcoholSystemPrompt should return a prompt with the correct alcohol level text', () => {
        AlcoholService.setAlcoholLevel(1);
        const prompt1 = AlcoholService.generateAlcoholSystemPrompt();
        expect(prompt1).toContain('1/10 drunk');

        AlcoholService.setAlcoholLevel(10);
        const prompt10 = AlcoholService.generateAlcoholSystemPrompt();
        expect(prompt10).toContain('10/10 drunk');
        expect(prompt10).toContain('You slur every single word');
    });

    test('generateAlcoholSystemPrompt should return empty string if level is 0', () => {
        AlcoholService.setAlcoholLevel(0);
        const prompt0 = AlcoholService.generateAlcoholSystemPrompt();
        expect(prompt0).toBe('');
    });
});
