const DiscordUtilityService = require('../../services/DiscordUtilityService');

describe('DiscordUtilityService - Pure Functions', () => {
    describe('getUsernameNoSpaces', () => {
        test('should return the username if available', () => {
            const mockMessage = { author: { username: 'TestUser' } };
            expect(DiscordUtilityService.getUsernameNoSpaces(mockMessage)).toBe('TestUser');
        });

        test('should return default if author is undefined', () => {
            expect(DiscordUtilityService.getUsernameNoSpaces({})).toBe('default');
            expect(DiscordUtilityService.getUsernameNoSpaces(null)).toBe('default');
        });
    });

    describe('getNameFromUser', () => {
        test('should return displayName first', () => {
            const mockUser = { displayName: 'DisplayTest', username: 'TestUser', globalName: 'GlobalTest' };
            expect(DiscordUtilityService.getNameFromUser(mockUser)).toBe('DisplayTest');
        });

        test('should return username second if displayName missing', () => {
            const mockUser = { username: 'TestUser', globalName: 'GlobalTest' };
            expect(DiscordUtilityService.getNameFromUser(mockUser)).toBe('TestUser');
        });

        test('should return globalName third', () => {
            const mockUser = { globalName: 'GlobalTest' };
            expect(DiscordUtilityService.getNameFromUser(mockUser)).toBe('GlobalTest');
        });

        test('should return undefined if user is not provided', () => {
            expect(DiscordUtilityService.getNameFromUser(null)).toBeUndefined();
        });
    });

    describe('getDisplayNameFromUserOrMember', () => {
        test('should return user displayName', () => {
            const mockData = {
                user: { displayName: 'UserDisplay' }
            };
            expect(DiscordUtilityService.getDisplayNameFromUserOrMember(mockData)).toBe('UserDisplay');
        });

        test('should return member displayName if user is missing', () => {
            const mockData = {
                member: { displayName: 'MemberDisplay' }
            };
            expect(DiscordUtilityService.getDisplayNameFromUserOrMember(mockData)).toBe('MemberDisplay');
        });

        test('should return undefined if neither has displayName', () => {
            const mockData = {
                user: { username: 'TestUser' },
                member: { nickname: 'NickName' }
            };
            expect(DiscordUtilityService.getDisplayNameFromUserOrMember(mockData)).toBeUndefined();
        });

        test('should return undefined if input object is empty', () => {
            expect(DiscordUtilityService.getDisplayNameFromUserOrMember({})).toBeUndefined();
        });
    });
});
