const DiscordService = require('../../services/DiscordService');

describe('DiscordService', () => {
    it('should be defined', () => {
        expect(DiscordService).toBeDefined();
    });

    it('should have cloneMessages property', () => {
        expect(typeof DiscordService.cloneMessages).toBe('function');
    });
});
