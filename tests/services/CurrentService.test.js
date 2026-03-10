import {
  _jest,
  describe,
  test,
  _it,
  expect,
  beforeEach,
  _afterEach,
  _beforeAll,
  _afterAll,
} from "@jest/globals";

const CurrentService = (await import("../../services/CurrentService.js"))
  .default;

describe("CurrentService", () => {
  beforeEach(() => {
    // Reset all states
    CurrentService.setUser(null);
    CurrentService.setMessage(null);
    CurrentService.setStartTime(null);
    CurrentService.setEndTime(null);
    CurrentService.clearModels();
    CurrentService.clearModelTypes();
  });

  test("should handle user and message getters/setters", () => {
    CurrentService.setUser("testUser");
    expect(CurrentService.getUser()).toBe("testUser");

    CurrentService.setMessage("testMessage");
    expect(CurrentService.getMessage()).toBe("testMessage");
  });

  test("should handle time getters/setters", () => {
    CurrentService.setStartTime("10:00");
    expect(CurrentService.getStartTime()).toBe("10:00");

    CurrentService.setEndTime("11:00");
    expect(CurrentService.getEndTime()).toBe("11:00");
  });

  test("should handle models and model types", () => {
    CurrentService.addModel("gpt-4");
    CurrentService.addModel("gpt-3.5-turbo");
    expect(CurrentService.getModels()).toEqual(["gpt-4", "gpt-3.5-turbo"]);

    CurrentService.addModelType("chat");
    expect(CurrentService.getModelTypes()).toEqual(["chat"]);
  });
});
