const BigNumber = require('bignumber.js');
const CurrentService = require('../../services/CurrentService');

describe('CurrentService', () => {
    beforeEach(() => {
        // Reset all states
        CurrentService.setUser(null);
        CurrentService.setMessage(null);
        CurrentService.setStartTime(null);
        CurrentService.setEndTime(null);
        CurrentService.clearTextTotalInputTokens();
        CurrentService.clearTextTotalInputCost();
        CurrentService.clearTextTotalOutputTokens();
        CurrentService.clearTextTotalOutputCost();
        CurrentService.clearModels();
        CurrentService.clearModelTypes();
        CurrentService.clearTextTotalCost();
    });

    test('should handle user and message getters/setters', () => {
        CurrentService.setUser('testUser');
        expect(CurrentService.getUser()).toBe('testUser');

        CurrentService.setMessage('testMessage');
        expect(CurrentService.getMessage()).toBe('testMessage');
    });

    test('should handle time getters/setters', () => {
        CurrentService.setStartTime('10:00');
        expect(CurrentService.getStartTime()).toBe('10:00');

        CurrentService.setEndTime('11:00');
        expect(CurrentService.getEndTime()).toBe('11:00');
    });

    test('should correctly add and retrieve input/output tokens', () => {
        CurrentService.addToTextTotalInputTokens(100);
        CurrentService.addToTextTotalInputTokens(50);
        expect(CurrentService.getTextTotalInputTokens()).toBe(150);

        CurrentService.addToTextTotalOutputTokens(200);
        CurrentService.addToTextTotalOutputTokens(25);
        expect(CurrentService.getTextTotalOutputTokens()).toBe(225);
    });

    test('should correctly compute costs utilizing BigNumber', () => {
        CurrentService.addToTextTotalInputCost(0.001);
        CurrentService.addToTextTotalInputCost(0.002);
        // 0.0030000000
        expect(CurrentService.getTextTotalInputCost()).toBe('0.0030000000');

        CurrentService.addToTextTotalOutputCost(0.004);
        expect(CurrentService.getTextTotalOutputCost()).toBe('0.0040000000');

        CurrentService.addToTextTotalCost(0.007);
        expect(CurrentService.getTextTotalCost()).toBe('0.0070000000');
    });

    test('should handle models and model types', () => {
        CurrentService.addModel('gpt-4');
        CurrentService.addModel('gpt-3.5-turbo');
        expect(CurrentService.getModels()).toEqual(['gpt-4', 'gpt-3.5-turbo']);

        CurrentService.addModelType('chat');
        expect(CurrentService.getModelTypes()).toEqual(['chat']);
    });
});
