// ============================================================
// API auth middleware — config-gated shared secret
// ============================================================
// When API_SHARED_SECRET is set, all mutating requests
// (POST/PUT/PATCH/DELETE) must carry `x-api-key: <secret>` or
// they get a 401. GET (and OPTIONS preflight) stay open, as
// does /health. When unset the middleware is a no-op and a
// one-time startup warning is logged — existing consumers keep
// working until the operator opts in.
// ============================================================

import { timingSafeEqual } from "node:crypto";
import { AUTH_HEADERS } from "@rodrigo-barraza/utilities-library/taxonomy";
import type { Request, Response, NextFunction } from "express";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function secretMatches(provided: unknown, secret: string): boolean {
  if (typeof provided !== "string") return false;
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);
  return (
    providedBuffer.length === secretBuffer.length &&
    timingSafeEqual(providedBuffer, secretBuffer)
  );
}

/**
 * Build the API auth middleware.
 *
 * @param sharedSecret Value of API_SHARED_SECRET. Undefined/empty ⇒ no-op
 *   middleware (a startup warning is logged).
 */
export function createApiAuthMiddleware(sharedSecret: string | undefined) {
  if (!sharedSecret) {
    console.warn(
      "⚠️ [auth] API_SHARED_SECRET is not set — mutating endpoints are " +
        "unauthenticated. Set API_SHARED_SECRET to require an x-api-key " +
        "header on POST/PUT/PATCH/DELETE requests.",
    );
    return function apiAuthNoop(
      _req: Request,
      _res: Response,
      next: NextFunction,
    ): void {
      next();
    };
  }

  return function apiAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.path === "/health" || !MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    if (secretMatches(req.headers[AUTH_HEADERS.apiKey], sharedSecret)) {
      next();
      return;
    }
    res.status(401).json({
      error: "Unauthorized — missing or invalid x-api-key header",
    });
  };
}
