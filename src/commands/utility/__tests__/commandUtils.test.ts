import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getServerAgeYears,
  computeStartDate,
  formatTimePeriod,
  getMedal,
  shuffleArray,
} from "../commandUtils.js";
import type { Guild } from "discord.js";

describe("commandUtils", () => {
  describe("getServerAgeYears", () => {
    it("computes whole years from the guild creation timestamp", () => {
      const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000 - 1000;
      expect(
        getServerAgeYears({ createdTimestamp: threeYearsAgo } as Guild),
      ).toBe(3);
    });

    it("returns 0 for a brand-new server", () => {
      expect(getServerAgeYears({ createdTimestamp: Date.now() } as Guild)).toBe(
        0,
      );
    });
  });

  describe("computeStartDate", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // July 15 2026, local time
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("subtracts years, months, and days from now", () => {
      const { startDate } = computeStartDate(1, 2, 3);
      expect(startDate.getFullYear()).toBe(2025);
      expect(startDate.getMonth()).toBe(4); // May
      expect(startDate.getDate()).toBe(12);
    });

    it("returns a matching unix timestamp", () => {
      const { startDate, unixStartDate } = computeStartDate(0, 0, 7);
      expect(unixStartDate).toBe(Math.floor(startDate.getTime()));
    });

    it("returns now when all offsets are zero", () => {
      const { startDate } = computeStartDate(0, 0, 0);
      expect(startDate.getTime()).toBe(Date.now());
    });
  });

  describe("formatTimePeriod", () => {
    it("formats single units with correct pluralization", () => {
      expect(formatTimePeriod(1, 0, 0)).toBe("Last 1 year");
      expect(formatTimePeriod(2, 0, 0)).toBe("Last 2 years");
      expect(formatTimePeriod(0, 1, 0)).toBe("Last 1 month");
      expect(formatTimePeriod(0, 0, 5)).toBe("Last 5 days");
    });

    it("joins multiple units", () => {
      expect(formatTimePeriod(1, 2, 3)).toBe("Last 1 year, 2 months, 3 days");
    });

    it("uses the fallback when no units are given", () => {
      expect(formatTimePeriod(0, 0, 0)).toBe("All time");
      expect(formatTimePeriod(0, 0, 0, "Since server creation")).toBe(
        "Since server creation",
      );
    });
  });

  describe("getMedal", () => {
    it("awards podium medals, honorable mentions, then padding", () => {
      expect(getMedal(0)).toBe("🥇");
      expect(getMedal(1)).toBe("🥈");
      expect(getMedal(2)).toBe("🥉");
      expect(getMedal(3)).toBe("🏅");
      expect(getMedal(4)).toBe("🏅");
      expect(getMedal(5)).toBe("  ");
    });
  });

  describe("shuffleArray", () => {
    it("keeps the same elements (in-place permutation)", () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8];
      const copy = [...array];
      shuffleArray(array);
      expect(array.length).toBe(copy.length);
      expect([...array].sort((a, b) => a - b)).toEqual(copy);
    });

    it("handles empty and single-element arrays", () => {
      const empty: number[] = [];
      const single = [42];
      shuffleArray(empty);
      shuffleArray(single);
      expect(empty).toEqual([]);
      expect(single).toEqual([42]);
    });
  });
});
