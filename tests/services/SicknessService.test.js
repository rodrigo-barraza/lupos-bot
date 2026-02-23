import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

const SicknessService = (await import('../../services/SicknessService.js')).default;

describe('SicknessService', () => {
    beforeEach(() => {
        SicknessService.setSicknessLevel(0);
    });

    test('should initialize with a sickness level of 0', () => {
        expect(SicknessService.getSicknessLevel()).toBe(0);
    });

    test('setSicknessLevel should update the sickness level', () => {
        SicknessService.setSicknessLevel(20);
        expect(SicknessService.getSicknessLevel()).toBe(20);
    });

    test('increaseSicknessLevel should increase the level by 10', () => {
        SicknessService.setSicknessLevel(20);
        const newLevel = SicknessService.increaseSicknessLevel();
        expect(newLevel).toBe(30);
        expect(SicknessService.getSicknessLevel()).toBe(30);
    });

    test('increaseSicknessLevel should not exceed 100', () => {
        SicknessService.setSicknessLevel(95);
        const newLevel = SicknessService.increaseSicknessLevel();
        expect(newLevel).toBe(100);
        expect(SicknessService.getSicknessLevel()).toBe(100);
    });

    test('decreaseSicknessLevel should decrease the level by 10', () => {
        SicknessService.setSicknessLevel(50);
        const newLevel = SicknessService.decreaseSicknessLevel();
        expect(newLevel).toBe(40);
        expect(SicknessService.getSicknessLevel()).toBe(40);
    });

    test('decreaseSicknessLevel should not fall below 0', () => {
        SicknessService.setSicknessLevel(5);
        const newLevel = SicknessService.decreaseSicknessLevel();
        expect(newLevel).toBe(0);
        expect(SicknessService.getSicknessLevel()).toBe(0);
    });
});
