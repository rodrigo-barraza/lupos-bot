/**
 * HeartbeatService.test.ts
 *
 * Unit tests for the dead-man's-switch liveness check (pure logic only —
 * the ping loop itself is integration-level). The wedge scenario is the
 * documented failure mode: one hung reply freezes the single global serial
 * queue while the HTTP server keeps answering 200.
 * Pattern: https://healthchecks.io/docs/
 */

import { describe, it, expect } from "vitest";
import {
  evaluateLiveness,
  QUEUE_WEDGE_THRESHOLD_MILLISECONDS,
} from "../HeartbeatService.js";

const NOW = 10 * 60_000;

describe("evaluateLiveness", () => {
  it("is alive when the queue is idle, however stale the activity stamp", () => {
    const verdict = evaluateLiveness(
      {
        isProcessingQueue: false,
        lastQueueActivityAtMs: 0, // hours-old stamp, but nothing is processing
        queueDepth: 0,
      },
      NOW,
    );
    expect(verdict.alive).toBe(true);
  });

  it("is alive while processing within the wedge threshold", () => {
    const verdict = evaluateLiveness(
      {
        isProcessingQueue: true,
        lastQueueActivityAtMs: NOW - QUEUE_WEDGE_THRESHOLD_MILLISECONDS / 2,
        queueDepth: 3,
      },
      NOW,
    );
    expect(verdict.alive).toBe(true);
  });

  it("reports a wedge when processing stalls past the threshold", () => {
    const verdict = evaluateLiveness(
      {
        isProcessingQueue: true,
        lastQueueActivityAtMs: NOW - QUEUE_WEDGE_THRESHOLD_MILLISECONDS - 1000,
        queueDepth: 4,
      },
      NOW,
    );
    expect(verdict.alive).toBe(false);
    expect(verdict.reason).toContain("wedged");
    expect(verdict.reason).toContain("4 message(s) queued");
  });

  it("respects a custom wedge threshold", () => {
    const snapshot = {
      isProcessingQueue: true,
      lastQueueActivityAtMs: NOW - 30_000,
      queueDepth: 1,
    };
    expect(evaluateLiveness(snapshot, NOW, 60_000).alive).toBe(true);
    expect(evaluateLiveness(snapshot, NOW, 10_000).alive).toBe(false);
  });
});
