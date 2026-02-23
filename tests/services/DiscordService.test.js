import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

// DiscordService has many heavy transitive dependencies (puppeteer, sharp, etc.)
// Mock all heavyweight dependencies to allow the test to load
jest.unstable_mockModule('../../wrappers/PuppeteerWrapper', () => ({
    default: {}
}));
jest.unstable_mockModule('../../wrappers/ComfyUIWrapper', () => ({
    default: {}
}));
jest.unstable_mockModule('../../wrappers/MongoWrapper', () => ({
    default: {}
}));
jest.unstable_mockModule('../../wrappers/YouTubeWrapper', () => ({
    default: {}
}));
jest.unstable_mockModule('../../services/AIService', () => ({
    default: {}
}));

const DiscordService = (await import('../../services/DiscordService.js')).default;

describe('DiscordService', () => {
    it('should be defined', () => {
        expect(DiscordService).toBeDefined();
    });

    it('should have cloneMessages property', () => {
        expect(typeof DiscordService.cloneMessages).toBe('function');
    });
});
