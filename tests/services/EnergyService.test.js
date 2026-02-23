import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
jest.unstable_mockModule('../../services/DiscordService', () => ({ default: {
    generateInCharacterResponse2Special: jest.fn()
} }));

const EnergyService = (await import('../../services/EnergyService.js')).default;

describe('EnergyService', () => {
    beforeEach(() => {
        // Reset the energy level to 100 before each test
        EnergyService.setEnergyLevel(100);
        jest.clearAllMocks();
    });

    test('should initialize with an energy level of 100', () => {
        expect(EnergyService.getEnergyLevel()).toBe(100);
    });

    test('getEnergyLevel should return the current level', () => {
        EnergyService.setEnergyLevel(50);
        expect(EnergyService.getEnergyLevel()).toBe(50);
    });

    test('setEnergyLevel should update the energy level', () => {
        EnergyService.setEnergyLevel(75);
        expect(EnergyService.getEnergyLevel()).toBe(75);
    });

    test('increaseEnergyLevel should increase the level by 1', () => {
        EnergyService.setEnergyLevel(50);
        const newLevel = EnergyService.increaseEnergyLevel();
        expect(newLevel).toBe(51);
        expect(EnergyService.getEnergyLevel()).toBe(51);
    });

    test('increaseEnergyLevel should not exceed 100', () => {
        EnergyService.setEnergyLevel(100);
        const newLevel = EnergyService.increaseEnergyLevel();
        expect(newLevel).toBe(100);
        expect(EnergyService.getEnergyLevel()).toBe(100);
    });

    test('decreaseEnergyLevel should decrease the level by 1', () => {
        EnergyService.setEnergyLevel(50);
        const newLevel = EnergyService.decreaseEnergyLevel();
        expect(newLevel).toBe(49);
        expect(EnergyService.getEnergyLevel()).toBe(49);
    });

    test('decreaseEnergyLevel should not fall below 0', () => {
        EnergyService.setEnergyLevel(0);
        const newLevel = EnergyService.decreaseEnergyLevel();
        expect(newLevel).toBe(0);
        expect(EnergyService.getEnergyLevel()).toBe(0);
    });
});
