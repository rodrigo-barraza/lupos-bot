// ============================================================
// CORS middleware — config-gated allowlist
// ============================================================
// When ALLOWED_ORIGINS is unset the historical behavior is
// preserved (reflect any origin, with credentials) so the
// external site keeps working until the operator opts in.
// When set, only listed origins get CORS headers — everything
// else receives none (same-origin policy applies).
// ============================================================

import type { Request, Response, NextFunction } from "express";

function setSharedCorsHeaders(res: Response): void {
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  );
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

/**
 * Build the CORS middleware.
 *
 * @param allowedOrigins Origins allowed to make credentialed cross-origin
 *   requests. Empty array ⇒ legacy reflect-any-origin behavior (a startup
 *   warning is logged).
 */
export function createCorsMiddleware(allowedOrigins: string[]) {
  if (allowedOrigins.length === 0) {
    console.warn(
      "⚠️ [cors] ALLOWED_ORIGINS is not set — CORS is wide open (any origin " +
        "is reflected with credentials). Set ALLOWED_ORIGINS (comma-separated) " +
        "to restrict.",
    );
  }

  return function corsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const origin = req.headers.origin;
    if (allowedOrigins.length === 0) {
      // Legacy behavior — preserved until the operator configures a list.
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      setSharedCorsHeaders(res);
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      setSharedCorsHeaders(res);
    }
    // Disallowed origins get no CORS headers — the browser blocks the read.
    next();
  };
}
