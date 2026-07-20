import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiAuthMiddleware } from "../apiAuth.ts";
import type { Request, Response, NextFunction } from "express";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe("createApiAuthMiddleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when API_SHARED_SECRET is not configured", () => {
    it("is a no-op — mutating requests pass without a key", () => {
      const middleware = createApiAuthMiddleware(undefined);
      const res = makeRes();
      middleware(makeReq({ method: "POST", path: "/guild/react" }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("logs a one-time startup warning at creation", () => {
      createApiAuthMiddleware(undefined);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("API_SHARED_SECRET"),
      );
    });
  });

  describe("when API_SHARED_SECRET is configured", () => {
    const SECRET = "super-secret";

    it("rejects mutating requests without the header (401 JSON)", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(makeReq({ method: "POST", path: "/guild/react" }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it("rejects mutating requests with a wrong key", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(
        makeReq({
          method: "DELETE",
          path: "/guild/thing",
          headers: { "x-api-key": "wrong" },
        }),
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("allows mutating requests with the correct x-api-key", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(
        makeReq({
          method: "PUT",
          path: "/guild/thing",
          headers: { "x-api-key": SECRET },
        }),
        res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("leaves GET requests open (no key required)", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(makeReq({ method: "GET", path: "/guild/stats" }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("leaves OPTIONS preflight open", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(makeReq({ method: "OPTIONS", path: "/guild" }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("exempts /health regardless of method", () => {
      const middleware = createApiAuthMiddleware(SECRET);
      const res = makeRes();
      middleware(makeReq({ method: "POST", path: "/health" }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
