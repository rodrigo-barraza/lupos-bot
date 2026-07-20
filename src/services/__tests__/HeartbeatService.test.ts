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
  buildPingRequest,
  QUEUE_WEDGE_THRESHOLD_MILLISECONDS,
} from "../HeartbeatService.ts";

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

describe("buildPingRequest", () => {
  const ALIVE = { alive: true, reason: "ok" };
  const WEDGED = { alive: false, reason: "reply queue wedged: no progress" };

  it("uses GET with status=up for Uptime Kuma push URLs", () => {
    const ping = buildPingRequest(
      "http://192.168.86.2:3999/api/push/abc123",
      ALIVE,
    );
    expect(ping.method).toBe("GET");
    expect(ping.url).toBe(
      "http://192.168.86.2:3999/api/push/abc123?status=up&msg=ok",
    );
    expect(ping.body).toBeUndefined();
  });

  it("signals Kuma failures via status=down with the encoded reason", () => {
    const ping = buildPingRequest(
      "http://192.168.86.2:3999/api/push/abc123/",
      WEDGED,
    );
    expect(ping.method).toBe("GET");
    expect(ping.url).toBe(
      "http://192.168.86.2:3999/api/push/abc123?status=down&msg=reply%20queue%20wedged%3A%20no%20progress",
    );
  });

  it("uses POST to the base URL for Healthchecks-style monitors", () => {
    const ping = buildPingRequest("https://hc-ping.com/uuid-here/", ALIVE);
    expect(ping).toEqual({
      url: "https://hc-ping.com/uuid-here",
      method: "POST",
      body: "ok",
    });
  });

  it("signals Healthchecks failures via the /fail variant", () => {
    const ping = buildPingRequest("https://hc-ping.com/uuid-here", WEDGED);
    expect(ping.url).toBe("https://hc-ping.com/uuid-here/fail");
    expect(ping.method).toBe("POST");
    expect(ping.body).toContain("wedged");
  });
});
