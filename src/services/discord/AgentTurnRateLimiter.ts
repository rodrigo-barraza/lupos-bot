// ============================================================
// AgentTurnRateLimiter — per-user ceiling on agent turns
// ============================================================
// Every agent turn costs a Prism /agent run, and one member firing
// mentions (or replies, or "lupos, …") back to back can monopolise the
// single serial reply queue. Each user gets a short burst allowance and
// a daily allowance across every path — mention, reply, name, ambient.
// Over the limit the message gets one ⏳ reaction instead of a turn
// (ambient turns just stay silent). The owner is exempt.
//
// In memory: a restart forgives everyone, which is fine for a
// fairness/cost guard.
// ============================================================

import { DISCORD_USERS } from "@rodrigo-barraza/utilities-library/taxonomy";

/** Per-user agent-turn ceilings — the one place these numbers live. */
export const AGENT_TURN_RATE_LIMITS = {
  /** Turns a user may trigger inside one burst window… */
  burstTurns: 4,
  /** …of this length (sliding). */
  burstWindowMs: 2 * 60 * 1000,
  /** Turns a user may trigger per UTC day. */
  dailyTurns: 60,
} as const;

/** The reaction a rate-limited message gets instead of a reply. */
export const RATE_LIMITED_REACTION = "⏳";

export type AgentTurnLimits = {
  burstTurns: number;
  burstWindowMs: number;
  dailyTurns: number;
};

/** Which ceiling a user is at, or null when a turn is allowed. */
export type RateLimitVerdict = "burst" | "daily" | null;

interface UserUsage {
  /** Start times of the turns inside the current burst window. */
  recentTurnsAtMs: number[];
  /** "YYYY-MM-DD" (UTC) that dailyTurns counts. */
  utcDay: string;
  dailyTurns: number;
}

// Past this many tracked users, idle entries are swept on the next consume.
const SWEEP_THRESHOLD = 5_000;

function utcDayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export class AgentTurnRateLimiter {
  private readonly limits: AgentTurnLimits;
  private readonly exemptUserIds: ReadonlySet<string>;
  private readonly usage = new Map<string, UserUsage>();

  constructor(
    limits: AgentTurnLimits = AGENT_TURN_RATE_LIMITS,
    exemptUserIds: readonly string[] = [DISCORD_USERS.owner],
  ) {
    this.limits = limits;
    this.exemptUserIds = new Set(exemptUserIds);
  }

  /** The user's usage with expired turns/days dropped (not stored). */
  private currentUsage(userId: string, nowMs: number): UserUsage {
    const stored = this.usage.get(userId);
    const utcDay = utcDayOf(nowMs);
    return {
      recentTurnsAtMs: (stored?.recentTurnsAtMs ?? []).filter(
        (turnAtMs) => nowMs - turnAtMs < this.limits.burstWindowMs,
      ),
      utcDay,
      dailyTurns: stored?.utcDay === utcDay ? stored.dailyTurns : 0,
    };
  }

  /** Would a turn for this user be allowed right now? (Records nothing.) */
  check(userId: string, nowMs = Date.now()): RateLimitVerdict {
    if (this.exemptUserIds.has(userId)) return null;
    const usage = this.currentUsage(userId, nowMs);
    if (usage.dailyTurns >= this.limits.dailyTurns) return "daily";
    if (usage.recentTurnsAtMs.length >= this.limits.burstTurns) return "burst";
    return null;
  }

  /** Take a turn for this user if allowed; returns the verdict (null = taken). */
  consume(userId: string, nowMs = Date.now()): RateLimitVerdict {
    const verdict = this.check(userId, nowMs);
    if (verdict || this.exemptUserIds.has(userId)) return verdict;
    const usage = this.currentUsage(userId, nowMs);
    usage.recentTurnsAtMs.push(nowMs);
    usage.dailyTurns += 1;
    this.usage.set(userId, usage);
    if (this.usage.size > SWEEP_THRESHOLD) this.sweep(nowMs);
    return null;
  }

  private sweep(nowMs: number): void {
    const today = utcDayOf(nowMs);
    for (const [userId, usage] of this.usage) {
      const burstIdle = usage.recentTurnsAtMs.every(
        (turnAtMs) => nowMs - turnAtMs >= this.limits.burstWindowMs,
      );
      if (burstIdle && usage.utcDay !== today) this.usage.delete(userId);
    }
  }

  /** Test hook. */
  reset(): void {
    this.usage.clear();
  }
}

/** The limiter every reply path shares. */
export const agentTurnRateLimiter = new AgentTurnRateLimiter();
