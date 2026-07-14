import { describe, it, expect } from "vitest";
import {
  BASE_MMR,
  MIN_MMR,
  MIN_RD,
  MAX_RD,
  RD_DECREASE_PER_GAME,
  computeLossStatsUpdate,
  computeWinStatsUpdate,
} from "../mmr.ts";
import type { UserStats } from "../types.ts";

describe("deathroll per-player stat updates", () => {
  describe("computeWinStatsUpdate", () => {
    it("starts a brand-new player above BASE_MMR with a 1-win streak", () => {
      const update = computeWinStatsUpdate(null, 1);
      expect(update.mmr).toBeGreaterThan(BASE_MMR);
      expect(update.rd).toBe(MAX_RD - RD_DECREASE_PER_GAME);
      expect(update.currentStreak).toBe(1);
      expect(update.bestStreak).toBe(1);
    });

    it("extends a win streak and tracks the best streak", () => {
      const stats: Partial<UserStats> = {
        mmr: 1100,
        rd: MIN_RD,
        currentStreak: 3,
        bestStreak: 5,
        lastPlayedAt: Date.now(),
      };
      const update = computeWinStatsUpdate(stats, 1);
      expect(update.currentStreak).toBe(4);
      expect(update.bestStreak).toBe(5);
    });

    it("resets a loss streak to a 1-win streak", () => {
      const stats: Partial<UserStats> = {
        mmr: 900,
        rd: MIN_RD,
        currentStreak: -4,
        bestStreak: 2,
        lastPlayedAt: Date.now(),
      };
      const update = computeWinStatsUpdate(stats, 1);
      expect(update.currentStreak).toBe(1);
      expect(update.bestStreak).toBe(2);
    });

    it("awards more MMR for higher timeout multipliers", () => {
      const stats: Partial<UserStats> = {
        mmr: 1000,
        rd: MIN_RD,
        lastPlayedAt: Date.now(),
      };
      const base = computeWinStatsUpdate(stats, 1);
      const doubled = computeWinStatsUpdate(stats, 4);
      expect(doubled.mmr).toBeGreaterThan(base.mmr);
    });

    it("never lets RD drop below MIN_RD", () => {
      const stats: Partial<UserStats> = {
        mmr: 1000,
        rd: MIN_RD,
        lastPlayedAt: Date.now(),
      };
      expect(computeWinStatsUpdate(stats, 1).rd).toBe(MIN_RD);
    });
  });

  describe("computeLossStatsUpdate", () => {
    it("drops a brand-new player below BASE_MMR with a 1-loss streak", () => {
      const update = computeLossStatsUpdate(null, 1);
      expect(update.mmr).toBeLessThan(BASE_MMR);
      expect(update.rd).toBe(MAX_RD - RD_DECREASE_PER_GAME);
      expect(update.currentStreak).toBe(-1);
    });

    it("floors MMR at MIN_MMR", () => {
      const stats: Partial<UserStats> = {
        mmr: 5,
        rd: MIN_RD,
        lastPlayedAt: Date.now(),
      };
      expect(computeLossStatsUpdate(stats, 1).mmr).toBe(MIN_MMR);
    });

    it("extends a loss streak and resets a win streak", () => {
      const now = Date.now();
      const losing = computeLossStatsUpdate(
        { mmr: 1000, rd: MIN_RD, currentStreak: -2, lastPlayedAt: now },
        1,
      );
      expect(losing.currentStreak).toBe(-3);

      const winning = computeLossStatsUpdate(
        { mmr: 1000, rd: MIN_RD, currentStreak: 6, lastPlayedAt: now },
        1,
      );
      expect(winning.currentStreak).toBe(-1);
    });

    it("is symmetric with the winner at the gravity center", () => {
      // At GRAVITY_CENTER both scales are 1.0, so win gain == loss cost.
      const stats: Partial<UserStats> = {
        mmr: 1050,
        rd: MIN_RD,
        lastPlayedAt: Date.now(),
      };
      const win = computeWinStatsUpdate(stats, 1);
      const loss = computeLossStatsUpdate(stats, 1);
      expect(win.mmr - 1050).toBe(1050 - loss.mmr);
    });
  });
});
