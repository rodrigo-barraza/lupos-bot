vi.mock("express", () => {
  const routerInstance = {
    get: vi.fn(),
    use: vi.fn(),
  };
  // Must be a real function so `new express.Router()` works
  function RouterConstructor() {
    return routerInstance;
  }
  const express = {
    Router: RouterConstructor,
  };
  return {
    default: express,
    Router: RouterConstructor,
  };
});

vi.mock("../../services/AIService", () => ({
  default: {
    transcribeSpeech: vi.fn(),
  },
}));

// Mock GuildRoutes — services.js imports it via #root/routes/GuildRoutes.js
vi.mock("../../routes/GuildRoutes", () => ({
  default: vi.fn(),
}));

const routes = (await import("../../services/services.js")).default;
const AIService = (await import("../../services/AIService.js")).default;

describe("services.js (Express Routes)", () => {
  let mockRouter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should register /transcribe/:audioUrl route", () => {
    mockRouter = routes();

    expect(mockRouter.get).toHaveBeenCalledTimes(1);
    expect(mockRouter.get.mock.calls[0][0]).toBe("/transcribe/:audioUrl");
  });

  test("should register guild routes via router.use", () => {
    mockRouter = routes();

    expect(mockRouter.use).toHaveBeenCalled();
  });

  test("route handler should reject if audioUrl is missing", async () => {
    mockRouter = routes();
    const routeHandler = mockRouter.get.mock.calls[0][1];

    const mockReq = { params: { audioUrl: undefined } };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await routeHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "audioUrl is required",
    });
  });

  test("route handler should call AIService and return transcription", async () => {
    mockRouter = routes();
    const routeHandler = mockRouter.get.mock.calls[0][1];

    AIService.transcribeSpeech.mockResolvedValue("Mocked transcription");

    const mockReq = {
      params: { audioUrl: encodeURIComponent("http://audio.mp3") },
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await routeHandler(mockReq, mockRes);

    expect(AIService.transcribeSpeech).toHaveBeenCalledWith("http://audio.mp3");
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      transcription: "Mocked transcription",
    });
  });

  test("route handler should catch errors and return 500", async () => {
    mockRouter = routes();
    const routeHandler = mockRouter.get.mock.calls[0][1];

    AIService.transcribeSpeech.mockRejectedValue(
      new Error("Transcription failed"),
    );

    const mockReq = {
      params: { audioUrl: encodeURIComponent("http://audio.mp3") },
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await routeHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "Transcription failed",
    });

    consoleSpy.mockRestore();
  });
});
