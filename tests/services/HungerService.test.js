const HungerService = require('../../services/HungerService');

jest.mock('../../services/AIService', () => ({
    generateInCharacterResponse2Special: jest.fn().mockResolvedValue('Mocked response')
}));

describe('HungerService', () => {
    beforeEach(() => {
        HungerService.setHungerLevel(0);
        jest.clearAllMocks();
    });

    test('should initialize with a hunger level of 0', () => {
        expect(HungerService.getHungerLevel()).toBe(0);
    });

    test('setHungerLevel should update the hunger level', () => {
        HungerService.setHungerLevel(20);
        expect(HungerService.getHungerLevel()).toBe(20);
    });

    test('increaseHungerLevel should increase the level by 1', () => {
        HungerService.setHungerLevel(20);
        const newLevel = HungerService.increaseHungerLevel();
        expect(newLevel).toBe(21);
        expect(HungerService.getHungerLevel()).toBe(21);
    });

    test('increaseHungerLevel should not exceed 100', () => {
        HungerService.setHungerLevel(100);
        const newLevel = HungerService.increaseHungerLevel();
        expect(newLevel).toBe(100);
        expect(HungerService.getHungerLevel()).toBe(100);
    });

    test('decreaseHungerLevel should decrease the level by 1', () => {
        HungerService.setHungerLevel(50);
        const newLevel = HungerService.decreaseHungerLevel();
        expect(newLevel).toBe(49);
        expect(HungerService.getHungerLevel()).toBe(49);
    });

    test('decreaseHungerLevel should not fall below 0', () => {
        HungerService.setHungerLevel(0);
        const newLevel = HungerService.decreaseHungerLevel();
        expect(newLevel).toBe(0);
        expect(HungerService.getHungerLevel()).toBe(0);
    });
});
