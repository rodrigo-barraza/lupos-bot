// ============================================================
// HeartbeatService — dead-man's-switch heartbeat
// ============================================================
// Push-based liveness: ping an external monitor every minute and let the
// MONITOR alert when the pings stop. This catches what the pull-based
// /health probe cannot — a silently wedged process: one hung reply freezes
// the single global serial queue in every guild while HTTP still answers
// 200. The ping is gated on a queue-liveness self-check, so a WEDGE trips
// the switch the same way a crash does. The alert comes from the external
// watcher by design — a wedged bot can't report its own silence.
//
// Two monitor flavors are supported, detected from the URL shape:
// - Uptime Kuma push URLs (…/api/push/<token>) — GET only, with
//   status=up|down and msg query params
//   (https://github.com/louislam/uptime-kuma — our self-hosted instance).
// - Healthchecks.io semantics (https://healthchecks.io/docs/) — POST the
//   reason to HEARTBEAT_URL, or to <url>/fail on a detected wedge so the
//   monitor alerts immediately instead of waiting out the grace period.
// ============================================================

import config from "#root/config.js";
import DiscordState from "#root/services/discord/DiscordState.js";

const HEARTBEAT_INTERVAL_MILLISECONDS = 60_000;
const PING_TIMEOUT_MILLISECONDS = 10_000;

// A single reply can legitimately hold the queue for the full Prism call
// timeout (~120s) — only well past that is the queue considered wedged.
export const QUEUE_WEDGE_THRESHOLD_MILLISECONDS = 5 * 60_000;

export interface LivenessSnapshot {
  isProcessingQueue: boolean;
  lastQueueActivityAtMs: number;
  queueDepth: number;
}

export interface LivenessVerdict {
  alive: boolean;
  reason: string;
}

/**
 * Pure wedge check: the reply queue is wedged when it claims to be
 * processing but hasn't made progress (drain start or item completion)
 * within the threshold. An idle queue is always alive — the activity
 * stamp is refreshed when a drain starts, so a long quiet stretch
 * before a burst doesn't false-positive.
 */
export function evaluateLiveness(
  snapshot: LivenessSnapshot,
  nowMs: number,
  wedgeThresholdMs: number = QUEUE_WEDGE_THRESHOLD_MILLISECONDS,
): LivenessVerdict {
  const stalledMs = nowMs - snapshot.lastQueueActivityAtMs;
  if (snapshot.isProcessingQueue && stalledMs > wedgeThresholdMs) {
    return {
      alive: false,
      reason: `reply queue wedged: no progress for ${Math.round(stalledMs / 1000)}s with ${snapshot.queueDepth} message(s) queued`,
    };
  }
  return { alive: true, reason: "ok" };
}

export function getLivenessSnapshot(): LivenessSnapshot {
  return {
    isProcessingQueue: DiscordState.isProcessingQueue,
    lastQueueActivityAtMs: DiscordState.lastQueueActivityAtMs,
    queueDepth: DiscordState.queuedData.length,
  };
}

export interface PingRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
}

/**
 * Build the monitor ping from the verdict. Uptime Kuma push endpoints
 * accept GET only (POST 404s — verified against our instance), signalling
 * failure via status=down; Healthchecks-style monitors take a POST with
 * the reason as body and signal failure via the /fail URL variant.
 */
export function buildPingRequest(
  baseUrl: string,
  verdict: LivenessVerdict,
): PingRequest {
  const trimmedUrl = baseUrl.replace(/\/+$/, "");
  if (/\/api\/push\//.test(trimmedUrl)) {
    const status = verdict.alive ? "up" : "down";
    return {
      url: `${trimmedUrl}?status=${status}&msg=${encodeURIComponent(verdict.reason)}`,
      method: "GET",
    };
  }
  return {
    url: verdict.alive ? trimmedUrl : `${trimmedUrl}/fail`,
    method: "POST",
    body: verdict.reason,
  };
}

async function sendPing(): Promise<void> {
  const verdict = evaluateLiveness(getLivenessSnapshot(), Date.now());
  const ping = buildPingRequest(config.HEARTBEAT_URL as string, verdict);

  try {
    await fetch(ping.url, {
      method: ping.method,
      body: ping.body,
      signal: AbortSignal.timeout(PING_TIMEOUT_MILLISECONDS),
    });
    if (!verdict.alive) {
      console.warn(
        `💔 [HeartbeatService] Reported failure to monitor: ${verdict.reason}`,
      );
    }
  } catch (error: unknown) {
    // Monitor unreachable — nothing to do locally. Missing pings are the
    // monitor's own alert condition, so silence still raises the alarm.
    console.warn(
      `💔 [HeartbeatService] Ping failed: ${(error as Error).message}`,
    );
  }
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const HeartbeatService = {
  /**
   * Start the heartbeat loop. No-op when HEARTBEAT_URL isn't configured
   * or the loop is already running.
   */
  startHeartbeat(): void {
    if (!config.HEARTBEAT_URL || heartbeatInterval) return;
    void sendPing();
    heartbeatInterval = setInterval(() => {
      void sendPing();
    }, HEARTBEAT_INTERVAL_MILLISECONDS);
    // Don't let the heartbeat keep a shutting-down process alive
    heartbeatInterval.unref?.();
    console.log(
      `💓 [HeartbeatService] Dead-man's-switch heartbeat started (every ${HEARTBEAT_INTERVAL_MILLISECONDS / 1000}s)`,
    );
  },

  stopHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  },

  evaluateLiveness,
  getLivenessSnapshot,
  buildPingRequest,
};

export default HeartbeatService;
