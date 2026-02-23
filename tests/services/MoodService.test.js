import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
jest.unstable_mockModule('../../wrappers/DiscordWrapper', () => ({ default: {
    getClient: jest.fn().mockReturnValue({
        user: {
            setActivity: jest.fn()
        }
    })
} }));
jest.unstable_mockModule('../../services/DiscordUtilityService', () => ({ default: {
    generateMoodTemperature: jest.fn().mockResolvedValue(0)
} }));

const MoodService = (await import('../../services/MoodService.js')).default;
const DiscordWrapper = (await import('../../wrappers/DiscordWrapper.js')).default;
const DiscordUtilityService = (await import('../../services/DiscordUtilityService.js')).default;

describe('MoodService', () => {
    beforeEach(() => {
        MoodService.setMoodLevel(0);
        jest.clearAllMocks();
    });

    test('should initialize with a mood level of 0', () => {
        expect(MoodService.getMoodLevel()).toBe(0);
        expect(MoodService.getMoodName()).toBe('Neutral');
    });

    test('setMoodLevel should update mood level and set activity', () => {
        MoodService.setMoodLevel(5);
        expect(MoodService.getMoodLevel()).toBe(5);
        expect(MoodService.getMoodName()).toBe('Happy');

        const mockClient = DiscordWrapper.getClient();
        expect(mockClient.user.setActivity).toHaveBeenCalledWith('Mood: 😃 Happy (5)', expect.anything());
    });

    test('increaseMoodLevel should increase the level', () => {
        MoodService.setMoodLevel(5);
        const newLevel = MoodService.increaseMoodLevel(3);
        expect(newLevel).toBe(8);
        expect(MoodService.getMoodLevel()).toBe(8);
    });

    test('increaseMoodLevel should not exceed 10', () => {
        MoodService.setMoodLevel(9);
        const newLevel = MoodService.increaseMoodLevel(5);
        expect(newLevel).toBe(10);
        expect(MoodService.getMoodLevel()).toBe(10);
    });

    test('decreaseMoodLevel should decrease the level', () => {
        MoodService.setMoodLevel(5);
        const newLevel = MoodService.decreaseMoodLevel(3);
        expect(newLevel).toBe(2);
        expect(MoodService.getMoodLevel()).toBe(2);
    });

    test('decreaseMoodLevel should not fall below -10', () => {
        MoodService.setMoodLevel(-8);
        const newLevel = MoodService.decreaseMoodLevel(5);
        expect(newLevel).toBe(-10);
        expect(MoodService.getMoodLevel()).toBe(-10);
    });

    test('generateMoodMessage should correctly alter mood based on temperature', async () => {
        DiscordUtilityService.generateMoodTemperature.mockResolvedValueOnce(5);
        MoodService.setMoodLevel(0);
        const description = await MoodService.generateMoodMessage({ content: 'test message' });

        // 5 temperature -> increases mood by 3
        expect(MoodService.getMoodLevel()).toBe(3);
        expect(description).toContain('The harmony of your inner world hums a quiet tune'); // Content description
    });
});
