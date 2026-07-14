import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCorsMiddleware } from "../corsAllowlist.js";
import type { Request, Response, NextFunction } from "express";

function makeReq(origin?: string): Request {
  return { headers: origin ? { origin } : {} } as unknown as Request;
}

function makeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as unknown as Response & { headers: Record<string, string> };
}

describe("createCorsMiddleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when ALLOWED_ORIGINS is not configured (legacy mode)", () => {
    it("reflects any origin with credentials", () => {
      const middleware = createCorsMiddleware([]);
      const res = makeRes();
      middleware(makeReq("https://evil.example"), res, next);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe(
        "https://evil.example",
      );
      expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true");
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("falls back to * when there is no Origin header", () => {
      const middleware = createCorsMiddleware([]);
      const res = makeRes();
      middleware(makeReq(), res, next);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("logs a wide-open startup warning at creation", () => {
      createCorsMiddleware([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("ALLOWED_ORIGINS"),
      );
    });
  });

  describe("when ALLOWED_ORIGINS is configured", () => {
    const ALLOWED = ["https://site.example", "https://admin.example"];

    it("reflects allowed origins with credentials", () => {
      const middleware = createCorsMiddleware(ALLOWED);
      const res = makeRes();
      middleware(makeReq("https://site.example"), res, next);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe(
        "https://site.example",
      );
      expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true");
      expect(res.headers["Vary"]).toBe("Origin");
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("sets no CORS headers for disallowed origins but still calls next", () => {
      const middleware = createCorsMiddleware(ALLOWED);
      const res = makeRes();
      middleware(makeReq("https://evil.example"), res, next);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("sets no CORS headers for same-origin requests (no Origin header)", () => {
      const middleware = createCorsMiddleware(ALLOWED);
      const res = makeRes();
      middleware(makeReq(), res, next);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does not log the wide-open warning", () => {
      createCorsMiddleware(ALLOWED);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
