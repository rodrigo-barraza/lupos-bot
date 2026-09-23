import { describe, it, expect } from "vitest";
import { DISCORD_USERS } from "@rodrigo-barraza/utilities-library/taxonomy";
import {
  AgentTurnRateLimiter,
  AGENT_TURN_RATE_LIMITS,
  RATE_LIMITED_REACTION,
} from "../AgentTurnRateLimiter.ts";

const MINUTE = 60 * 1000;
// 2026-09-22T12:00:00Z
const NOON = Date.UTC(2026, 8, 22, 12, 0, 0);

describe("AgentTurnRateLimiter", () => {
  it("ships the brief's limits: 4 per 2 minutes, 60 per UTC day, ⏳", () => {
    expect(AGENT_TURN_RATE_LIMITS).toEqual({
      burstTurns: 4,
      burstWindowMs: 2 * MINUTE,
      dailyTurns: 60,
    });
    expect(RATE_LIMITED_REACTION).toBe("⏳");
  });

  it("allows 4 turns in 2 minutes, refuses the 5th, then lets one through as the window slides", () => {
    const limiter = new AgentTurnRateLimiter();
    for (let i = 0; i < 4; i++) {
      expect(limiter.consume("u1", NOON + i * 1000)).toBeNull();
    }
    expect(limiter.consume("u1", NOON + 30 * 1000)).toBe("burst");
    // The first turn (at NOON) leaves the window at NOON + 2 min.
    expect(limiter.consume("u1", NOON + 2 * MINUTE - 1)).toBe("burst");
    expect(limiter.consume("u1", NOON + 2 * MINUTE)).toBeNull();
  });

  it("counts users separately", () => {
    const limiter = new AgentTurnRateLimiter();
    for (let i = 0; i < 4; i++) limiter.consume("u1", NOON);
    expect(limiter.consume("u1", NOON)).toBe("burst");
    expect(limiter.consume("u2", NOON)).toBeNull();
  });

  it("caps a user at 60 turns per UTC day and resets at UTC midnight", () => {
    const limiter = new AgentTurnRateLimiter();
    let now = NOON;
    for (let i = 0; i < 60; i++) {
      expect(limiter.consume("u1", now)).toBeNull();
      now += 3 * MINUTE; // never trips the burst limit
    }
    expect(limiter.consume("u1", now)).toBe("daily");
    const nextUtcDay = Date.UTC(2026, 8, 23, 0, 0, 0);
    expect(limiter.consume("u1", nextUtcDay)).toBeNull();
  });

  it("check() never records a turn", () => {
    const limiter = new AgentTurnRateLimiter();
    for (let i = 0; i < 10; i++) expect(limiter.check("u1", NOON)).toBeNull();
    for (let i = 0; i < 4; i++) limiter.consume("u1", NOON);
    expect(limiter.check("u1", NOON)).toBe("burst");
  });

  it("exempts the owner", () => {
    const limiter = new AgentTurnRateLimiter();
    for (let i = 0; i < 100; i++) {
      expect(limiter.consume(DISCORD_USERS.owner, NOON)).toBeNull();
    }
  });

  it("takes custom limits and exemptions", () => {
    const limiter = new AgentTurnRateLimiter(
      { burstTurns: 1, burstWindowMs: MINUTE, dailyTurns: 2 },
      ["vip"],
    );
    expect(limiter.consume("u1", NOON)).toBeNull();
    expect(limiter.consume("u1", NOON + 1)).toBe("burst");
    expect(limiter.consume("u1", NOON + MINUTE)).toBeNull();
    expect(limiter.consume("u1", NOON + 2 * MINUTE)).toBe("daily");
    expect(limiter.consume("vip", NOON)).toBeNull();
    expect(limiter.consume("vip", NOON)).toBeNull();
  });
});
