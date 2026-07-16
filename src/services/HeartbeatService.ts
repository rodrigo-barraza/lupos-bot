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
// Ping semantics follow Healthchecks.io (https://healthchecks.io/docs/):
// success pings HEARTBEAT_URL, detected failures ping <url>/fail so the
// monitor alerts immediately instead of waiting out the grace period.
// An Uptime Kuma push URL also works for the success path (missed-ping
// alerting); its /fail variant is Healthchecks-specific.
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

async function sendPing(): Promise<void> {
  const verdict = evaluateLiveness(getLivenessSnapshot(), Date.now());
  const baseUrl = (config.HEARTBEAT_URL as string).replace(/\/+$/, "");
  const pingUrl = verdict.alive ? baseUrl : `${baseUrl}/fail`;

  try {
    await fetch(pingUrl, {
      method: "POST",
      body: verdict.reason,
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
};

export default HeartbeatService;
