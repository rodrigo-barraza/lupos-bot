// ============================================================
// TemporalHelpers.test.ts — Unit Tests
// ============================================================
// Validates the TemporalHelpers bridge module that replaces
// Luxon DateTime with native Temporal API.
// ============================================================

import { describe, it, expect, beforeAll } from "vitest";
import TemporalHelpers from "#root/utilities/TemporalHelpers.js";

describe("TemporalHelpers", () => {
  // ─── Construction ───────────────────────────────────────────

  describe("now()", () => {
    it("returns a ZonedDateTime in America/Los_Angeles", () => {
      const now = TemporalHelpers.now();
      expect(now.timeZoneId).toBe("America/Los_Angeles");
    });

    it("returns a value close to the current system time", () => {
      const now = TemporalHelpers.now();
      const epochMs = now.toInstant().epochMilliseconds;
      const systemMs = Date.now();
      // Within 1 second
      expect(Math.abs(Number(epochMs) - systemMs)).toBeLessThan(1000);
    });
  });

  describe("nowISO()", () => {
    it("returns a valid ISO 8601 string", () => {
      const iso = TemporalHelpers.nowISO();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(iso).toContain("Z");
    });
  });

  describe("fromMillis()", () => {
    it("converts epoch milliseconds to ZonedDateTime", () => {
      // 2024-01-15T12:00:00Z
      const ms = 1705320000000;
      const zdt = TemporalHelpers.fromMillis(ms);
      expect(zdt.timeZoneId).toBe("America/Los_Angeles");
      expect(zdt.year).toBe(2024);
      expect(zdt.month).toBe(1);
      expect(zdt.day).toBe(15);
    });

    it("preserves epoch milliseconds through roundtrip", () => {
      const original = 1626307200000;
      const zdt = TemporalHelpers.fromMillis(original);
      expect(Number(zdt.toInstant().epochMilliseconds)).toBe(original);
    });
  });

  describe("fromJSDate()", () => {
    it("converts a JS Date to ZonedDateTime", () => {
      const date = new Date("2024-06-15T18:30:00Z");
      const zdt = TemporalHelpers.fromJSDate(date);
      expect(zdt.timeZoneId).toBe("America/Los_Angeles");
      expect(zdt.year).toBe(2024);
      expect(zdt.month).toBe(6);
      expect(zdt.day).toBe(15);
    });
  });

  describe("fromISO()", () => {
    it("parses an ISO string to ZonedDateTime", () => {
      const zdt = TemporalHelpers.fromISO("2024-03-20T10:30:00Z");
      expect(zdt.timeZoneId).toBe("America/Los_Angeles");
      expect(zdt.year).toBe(2024);
      expect(zdt.month).toBe(3);
      expect(zdt.day).toBe(20);
    });

    it("roundtrips through nowISO()", () => {
      const iso = TemporalHelpers.nowISO();
      const zdt = TemporalHelpers.fromISO(iso);
      expect(zdt.timeZoneId).toBe("America/Los_Angeles");
    });
  });

  // ─── Formatting ─────────────────────────────────────────────

  describe("format()", () => {
    // Use a fixed UTC timestamp: 2024-07-04T20:30:45.000Z
    // In PST/PDT (America/Los_Angeles) = 2024-07-04T13:30:45 PDT
    const fixedMs = Date.UTC(2024, 6, 4, 20, 30, 45); // July 4, 2024 20:30:45 UTC
    let zdt: Temporal.ZonedDateTime;

    beforeAll(() => {
      zdt = TemporalHelpers.fromMillis(fixedMs);
    });

    it("formats 'h:mm:ss a' (time only, no leading zero)", () => {
      const result = TemporalHelpers.format(zdt, "h:mm:ss a");
      expect(result).toMatch(/1:30:45 PM/);
    });

    it("formats 'hh:mm:ss a' (time only, 12-hour)", () => {
      const result = TemporalHelpers.format(zdt, "hh:mm:ss a");
      // Intl.DateTimeFormat with hour12 doesn't leading-zero pad the hour
      expect(result).toMatch(/1:30:45 PM/);
    });

    it("formats 'LLLL dd, yyyy' (long month + date)", () => {
      const result = TemporalHelpers.format(zdt, "LLLL dd, yyyy");
      expect(result).toContain("July");
      expect(result).toContain("2024");
    });

    it("formats 'yyyy-MM-dd HH:mm:ss' (sortable)", () => {
      const result = TemporalHelpers.format(zdt, "yyyy-MM-dd HH:mm:ss");
      expect(result).toBe("2024-07-04 13:30:45");
    });

    it("formats 'yyyy-MM-dd HH:mm' (sortable, no seconds)", () => {
      const result = TemporalHelpers.format(zdt, "yyyy-MM-dd HH:mm");
      expect(result).toBe("2024-07-04 13:30");
    });

    it("formats 'yyyy-MM-dd' (date only)", () => {
      const result = TemporalHelpers.format(zdt, "yyyy-MM-dd");
      expect(result).toBe("2024-07-04");
    });

    it("formats 'cccc, LLLL dd, yyyy at h:mm a' (full with weekday)", () => {
      const result = TemporalHelpers.format(
        zdt,
        "cccc, LLLL dd, yyyy 'at' h:mm a",
      );
      expect(result).toContain("Thursday");
      expect(result).toContain("July");
      expect(result).toContain("2024");
      expect(result).toMatch(/at/);
    });
  });

  describe("formatDateTimeHugeWithSeconds()", () => {
    it("returns a human-readable locale string with timezone", () => {
      const zdt = TemporalHelpers.fromMillis(Date.UTC(2024, 9, 14, 13, 30, 33));
      const result = TemporalHelpers.formatDateTimeHugeWithSeconds(zdt);
      expect(result).toContain("October");
      expect(result).toContain("14");
      expect(result).toContain("2024");
      expect(result).toContain("Pacific");
    });
  });

  // ─── Relative Time ──────────────────────────────────────────

  describe("toRelative()", () => {
    it("returns 'X hours ago' for a past ZonedDateTime", () => {
      const threeHoursAgo = TemporalHelpers.fromMillis(
        Date.now() - 3 * 60 * 60 * 1000,
      );
      const result = TemporalHelpers.toRelative(threeHoursAgo);
      expect(result).toContain("hour");
      expect(result).toContain("ago");
    });

    it("returns relative time for very recent timestamps", () => {
      const fiveSecondsAgo = TemporalHelpers.fromMillis(Date.now() - 5000);
      const result = TemporalHelpers.toRelative(fiveSecondsAgo);
      expect(result).toContain("second");
    });

    it("returns relative time for timestamps days ago", () => {
      const threeDaysAgo = TemporalHelpers.fromMillis(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      );
      const result = TemporalHelpers.toRelative(threeDaysAgo);
      expect(result).toContain("day");
      expect(result).toContain("ago");
    });

    it("handles months in the past", () => {
      const twoMonthsAgo = TemporalHelpers.fromMillis(
        Date.now() - 60 * 24 * 60 * 60 * 1000,
      );
      const result = TemporalHelpers.toRelative(twoMonthsAgo);
      expect(result).toContain("month");
    });
  });

  // ─── Comparison & Arithmetic ────────────────────────────────

  describe("diffIn()", () => {
    it("calculates difference in days", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 10));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1));
      const diff = TemporalHelpers.diffIn(a, b, "days");
      expect(diff).toBeCloseTo(9, 0);
    });

    it("calculates difference in hours", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1, 12, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1, 6, 0, 0));
      const diff = TemporalHelpers.diffIn(a, b, "hours");
      expect(diff).toBeCloseTo(6, 0);
    });

    it("calculates difference in seconds", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1, 0, 1, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1, 0, 0, 0));
      const diff = TemporalHelpers.diffIn(a, b, "seconds");
      expect(diff).toBe(60);
    });

    it("returns negative for reversed order", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 1));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 10));
      const diff = TemporalHelpers.diffIn(a, b, "days");
      expect(diff).toBeLessThan(0);
    });
  });

  describe("hasSame()", () => {
    it("detects same hour", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15, 14, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15, 14, 30, 0));
      expect(TemporalHelpers.hasSame(a, b, "hour")).toBe(true);
    });

    it("detects different hours", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15, 14, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15, 15, 0, 0));
      expect(TemporalHelpers.hasSame(a, b, "hour")).toBe(false);
    });

    it("detects same day", () => {
      // Use times solidly within the same LA day
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15, 10, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 16, 5, 0, 0)); // Still June 15 in LA (UTC-7)
      expect(TemporalHelpers.hasSame(a, b, "day")).toBe(true);
    });

    it("detects same month", () => {
      // Use times that are solidly within the same month in LA timezone
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 2, 12, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 28, 12, 0, 0));
      expect(TemporalHelpers.hasSame(a, b, "month")).toBe(true);
    });

    it("detects different months", () => {
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 1));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 6, 1));
      expect(TemporalHelpers.hasSame(a, b, "month")).toBe(false);
    });

    it("detects same year", () => {
      // Use midday times so LA timezone doesn't roll back to previous year
      const a = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 2, 12, 0, 0));
      const b = TemporalHelpers.fromMillis(Date.UTC(2024, 11, 30, 12, 0, 0));
      expect(TemporalHelpers.hasSame(a, b, "year")).toBe(true);
    });
  });

  describe("minus()", () => {
    it("subtracts months", () => {
      const now = TemporalHelpers.fromMillis(Date.UTC(2024, 5, 15));
      const result = TemporalHelpers.minus(now, { months: 3 });
      expect(result.month).toBe(3); // June - 3 = March
    });

    it("subtracts days", () => {
      // Use midday UTC so LA timezone doesn't shift the day
      const now = TemporalHelpers.fromMillis(Date.UTC(2024, 0, 15, 20, 0, 0));
      const result = TemporalHelpers.minus(now, { days: 10 });
      expect(result.day).toBe(5);
    });
  });

  describe("toEpochMs()", () => {
    it("roundtrips through fromMillis", () => {
      const original = 1705320000000;
      const zdt = TemporalHelpers.fromMillis(original);
      expect(TemporalHelpers.toEpochMs(zdt)).toBe(original);
    });
  });

  // ─── Date ID Formatting ─────────────────────────────────────

  describe("toDateId()", () => {
    // Fixed: 2024-03-15 14:25:00.123 in local timezone
    let zdt: Temporal.ZonedDateTime;

    beforeAll(() => {
      // Create a ZDT with known local-time fields
      zdt = Temporal.ZonedDateTime.from({
        year: 2024,
        month: 3,
        day: 15,
        hour: 14,
        minute: 25,
        second: 0,
        millisecond: 123,
        timeZone: "America/Los_Angeles",
      });
    });

    it("generates yyMMddHHmmSSS pattern", () => {
      const result = TemporalHelpers.toDateId(zdt, "yyMMddHHmmSSS");
      expect(result).toBe("2403151425123");
    });

    it("generates mSSS pattern", () => {
      const result = TemporalHelpers.toDateId(zdt, "mSSS");
      expect(result).toBe("25123");
    });

    it("generates HmmSSS pattern", () => {
      const result = TemporalHelpers.toDateId(zdt, "HmmSSS");
      expect(result).toBe("1425123");
    });

    it("generates dHHmmSSS pattern", () => {
      const result = TemporalHelpers.toDateId(zdt, "dHHmmSSS");
      expect(result).toBe("151425123");
    });

    it("generates MddHHmmSSS pattern", () => {
      const result = TemporalHelpers.toDateId(zdt, "MddHHmmSSS");
      expect(result).toBe("03151425123");
    });
  });

  // ─── ISO Roundtrip ──────────────────────────────────────────

  describe("ISO roundtrip", () => {
    it("nowISO -> fromISO produces same instant", () => {
      const iso = TemporalHelpers.nowISO();
      const zdt = TemporalHelpers.fromISO(iso);
      // Compare the epoch ms values (ISO strings may have different precision)
      const originalMs = Temporal.Instant.from(iso).epochMilliseconds;
      const roundtripMs = zdt.toInstant().epochMilliseconds;
      expect(roundtripMs).toBe(originalMs);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles epoch zero (Unix epoch)", () => {
      const zdt = TemporalHelpers.fromMillis(0);
      expect(zdt.year).toBe(1969); // Dec 31, 1969 in LA timezone
      expect(zdt.month).toBe(12);
    });

    it("handles future dates", () => {
      const futureMs = Date.UTC(2099, 11, 31, 23, 59, 59);
      const zdt = TemporalHelpers.fromMillis(futureMs);
      expect(zdt.year).toBe(2099);
    });

    it("handles DST transition dates", () => {
      // March 10, 2024 — spring forward in US
      const beforeDST = TemporalHelpers.fromMillis(
        Date.UTC(2024, 2, 10, 9, 0, 0),
      ); // 1am PST
      const afterDST = TemporalHelpers.fromMillis(
        Date.UTC(2024, 2, 10, 11, 0, 0),
      ); // 4am PDT
      // Both should have valid timezone IDs
      expect(beforeDST.timeZoneId).toBe("America/Los_Angeles");
      expect(afterDST.timeZoneId).toBe("America/Los_Angeles");
      // The offset should differ
      const beforeOffset = beforeDST.offsetNanoseconds;
      const afterOffset = afterDST.offsetNanoseconds;
      // PST is -8, PDT is -7 — offset should change by 1 hour
      expect(afterOffset - beforeOffset).toBe(3600_000_000_000);
    });
  });
});
