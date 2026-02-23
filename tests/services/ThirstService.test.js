import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
jest.unstable_mockModule('../../services/DiscordService', () => ({ default: {
    generateTextFromSystemUserMessages: jest.fn().mockResolvedValue('Mocked response')
} }));

const ThirstService = (await import('../../services/ThirstService.js')).default;

describe('ThirstService', () => {
    beforeEach(() => {
        ThirstService.setThirstLevel(0);
        jest.clearAllMocks();
    });

    test('should initialize with a thirst level of 0', () => {
        expect(ThirstService.getThirstLevel()).toBe(0);
    });

    test('setThirstLevel should update the thirst level', () => {
        ThirstService.setThirstLevel(50);
        expect(ThirstService.getThirstLevel()).toBe(50);
    });

    test('increaseThirstLevel should increase the level by 1', () => {
        ThirstService.setThirstLevel(50);
        const newLevel = ThirstService.increaseThirstLevel();
        expect(newLevel).toBe(51);
        expect(ThirstService.getThirstLevel()).toBe(51);
    });

    test('increaseThirstLevel should not exceed 100', () => {
        ThirstService.setThirstLevel(100);
        const newLevel = ThirstService.increaseThirstLevel();
        expect(newLevel).toBe(100);
        expect(ThirstService.getThirstLevel()).toBe(100);
    });

    test('decreaseThirstLevel should decrease the level by 1', () => {
        ThirstService.setThirstLevel(50);
        const newLevel = ThirstService.decreaseThirstLevel();
        expect(newLevel).toBe(49);
        expect(ThirstService.getThirstLevel()).toBe(49);
    });

    test('decreaseThirstLevel should not fall below 0', () => {
        ThirstService.setThirstLevel(0);
        const newLevel = ThirstService.decreaseThirstLevel();
        expect(newLevel).toBe(0);
        expect(ThirstService.getThirstLevel()).toBe(0);
    });

    test('drink method should decrease thirst level and call DiscordService', async () => {
        ThirstService.setThirstLevel(10);
        const mockMessage = { content: 'water', reply: jest.fn() };

        await ThirstService.drink(mockMessage);

        expect(ThirstService.getThirstLevel()).toBe(9);
        expect(mockMessage.reply).toHaveBeenCalledWith({ content: 'Mocked response' });
    });
});
