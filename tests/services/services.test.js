import { jest, describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

jest.unstable_mockModule('express', () => {
    return {
        default: {
            Router: jest.fn(() => ({
                get: jest.fn()
            }))
        }
    };
});

jest.unstable_mockModule('../../services/AIService', () => ({
    default: {
        transcribeSpeech: jest.fn()
    }
}));

const routes = (await import('../../services/services.js')).default;
const AIService = (await import('../../services/AIService.js')).default;

describe('services.js (Express Routes)', () => {
    let mockRouter;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should register /transcribe/:audioUrl route', () => {
        mockRouter = routes();

        expect(mockRouter.get).toHaveBeenCalledTimes(1);
        expect(mockRouter.get.mock.calls[0][0]).toBe('/transcribe/:audioUrl');
    });

    test('route handler should reject if audioUrl is missing', async () => {
        mockRouter = routes();
        const routeHandler = mockRouter.get.mock.calls[0][1];

        const mockReq = { params: { audioUrl: undefined } };
        const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        await routeHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'audioUrl is required' });
    });

    test('route handler should call AIService and return transcription', async () => {
        mockRouter = routes();
        const routeHandler = mockRouter.get.mock.calls[0][1];

        AIService.transcribeSpeech.mockResolvedValue('Mocked transcription');

        const mockReq = { params: { audioUrl: encodeURIComponent('http://audio.mp3') } };
        const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        await routeHandler(mockReq, mockRes);

        expect(AIService.transcribeSpeech).toHaveBeenCalledWith('http://audio.mp3');
        expect(mockRes.json).toHaveBeenCalledWith({
            success: true,
            transcription: 'Mocked transcription'
        });
    });

    test('route handler should catch errors and return 500', async () => {
        mockRouter = routes();
        const routeHandler = mockRouter.get.mock.calls[0][1];

        AIService.transcribeSpeech.mockRejectedValue(new Error('Transcription failed'));

        const mockReq = { params: { audioUrl: encodeURIComponent('http://audio.mp3') } };
        const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        await routeHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            success: false,
            error: 'Transcription failed'
        });
    });
});
