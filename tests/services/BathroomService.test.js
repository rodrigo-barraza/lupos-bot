import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
jest.unstable_mockModule('../../services/DiscordService', () => ({ default: {
    generateTextFromSystemUserMessages: jest.fn().mockResolvedValue('Mocked response')
} }));

const BathroomService = (await import('../../services/BathroomService.js')).default;

describe('BathroomService', () => {
    beforeEach(() => {
        BathroomService.setBathroomLevel(0);
        jest.clearAllMocks();
    });

    test('should initialize with a bathroom level of 0', () => {
        expect(BathroomService.getBathroomLevel()).toBe(0);
    });

    test('setBathroomLevel should update the bathroom level', () => {
        BathroomService.setBathroomLevel(50);
        expect(BathroomService.getBathroomLevel()).toBe(50);
    });

    test('increaseBathroomLevel should increase the level by 1', () => {
        BathroomService.setBathroomLevel(50);
        const newLevel = BathroomService.increaseBathroomLevel();
        expect(newLevel).toBe(51);
        expect(BathroomService.getBathroomLevel()).toBe(51);
    });

    test('increaseBathroomLevel should not exceed 100', () => {
        BathroomService.setBathroomLevel(100);
        const newLevel = BathroomService.increaseBathroomLevel();
        expect(newLevel).toBe(100);
        expect(BathroomService.getBathroomLevel()).toBe(100);
    });

    test('decreaseBathroomLevel should decrease the level by 1', () => {
        BathroomService.setBathroomLevel(50);
        const newLevel = BathroomService.decreaseBathroomLevel();
        expect(newLevel).toBe(49);
        expect(BathroomService.getBathroomLevel()).toBe(49);
    });

    test('decreaseBathroomLevel should not fall below 0', () => {
        BathroomService.setBathroomLevel(0);
        const newLevel = BathroomService.decreaseBathroomLevel();
        expect(newLevel).toBe(0);
        expect(BathroomService.getBathroomLevel()).toBe(0);
    });

    test('drink method should decrease bathroom level and call DiscordService', async () => {
        BathroomService.setBathroomLevel(10);
        const mockMessage = { content: 'apple juice', reply: jest.fn() };

        await BathroomService.drink(mockMessage);

        expect(BathroomService.getBathroomLevel()).toBe(9);
        expect(mockMessage.reply).toHaveBeenCalledWith({ content: 'Mocked response' });
    });
});
