// ============================================================
// TemporalHelpers — Native Temporal API Utilities
// ============================================================
// Bridge utilities that provide Luxon-equivalent convenience
// methods using the native TC39 Temporal API (Node 26+).
//
// Replaces:  import { DateTime } from "luxon"
// With:      import { TemporalHelpers } from "#root/utilities/TemporalHelpers.js"
// ============================================================

const TIMEZONE = "America/Los_Angeles";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Thresholds for choosing the best relative time unit.
 * Ordered from largest to smallest for greedy matching.
 */
const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; divisor: number }> = [
  { unit: "year",   divisor: 365.25 * 24 * 60 * 60 },
  { unit: "month",  divisor: 30.44 * 24 * 60 * 60 },
  { unit: "week",   divisor: 7 * 24 * 60 * 60 },
  { unit: "day",    divisor: 24 * 60 * 60 },
  { unit: "hour",   divisor: 60 * 60 },
  { unit: "minute", divisor: 60 },
  { unit: "second", divisor: 1 },
];

const TemporalHelpers = {
  // ─── Construction ─────────────────────────────────────────────

  /** Current instant as a ZonedDateTime in the configured timezone. */
  now(): Temporal.ZonedDateTime {
    return Temporal.Now.zonedDateTimeISO(TIMEZONE);
  },

  /** Current instant as an ISO string. Replaces `DateTime.now().toISO()`. */
  nowISO(): string {
    return Temporal.Now.instant().toString();
  },

  /** From epoch milliseconds → ZonedDateTime. Replaces `DateTime.fromMillis()`. */
  fromMillis(ms: number): Temporal.ZonedDateTime {
    return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(TIMEZONE);
  },

  /** From a JS Date → ZonedDateTime. Replaces `DateTime.fromJSDate()`. */
  fromJSDate(date: Date): Temporal.ZonedDateTime {
    return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(TIMEZONE);
  },

  /** From an ISO string → ZonedDateTime. Replaces `DateTime.fromISO()`. */
  fromISO(iso: string): Temporal.ZonedDateTime {
    return Temporal.Instant.from(iso).toZonedDateTimeISO(TIMEZONE);
  },

  // ─── Formatting ───────────────────────────────────────────────

  /**
   * Format a ZonedDateTime using Intl.DateTimeFormat.
   * Replaces `dateTime.toFormat(pattern)`.
   *
   * Common patterns mapped:
   * - "yyyy-MM-dd HH:mm:ss a" → full date+time with AM/PM
   * - "LLLL dd, yyyy 'at' hh:mm:ss a" → long month + time
   * - "h:mm:ss a" → time only
   * - "cccc, LLLL dd, yyyy 'at' h:mm a" → weekday + full date + time
   * - "yyyy-MM-dd HH:mm:ss" → sortable date+time
   * - "yyyy-MM-dd HH:mm" → sortable date+time (no seconds)
   * - "yyyy-MM-dd" → date only
   */
  format(zdt: Temporal.ZonedDateTime, pattern: string): string {
    switch (pattern) {
      case "yyyy-MM-dd HH:mm:ss a":
        return zdt.toLocaleString("en-US", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true,
        }).replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2");

      case "LLLL dd, yyyy 'at' hh:mm:ss a":
        return zdt.toLocaleString("en-US", {
          year: "numeric", month: "long", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true,
        }).replace(",", " at").replace(/,/, "");

      case "h:mm:ss a":
        return zdt.toLocaleString("en-US", {
          hour: "numeric", minute: "2-digit", second: "2-digit",
          hour12: true,
        });

      case "hh:mm:ss a":
        return zdt.toLocaleString("en-US", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true,
        });

      case "LLLL dd, yyyy":
        return zdt.toLocaleString("en-US", {
          year: "numeric", month: "long", day: "2-digit",
        });

      case "cccc, LLLL dd, yyyy 'at' h:mm a":
        return zdt.toLocaleString("en-US", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
          hour12: true,
        }).replace(/,\s*(\d)/, " at $1");

      case "yyyy-MM-dd HH:mm:ss": {
        const pd = zdt.toPlainDateTime();
        const hours = String(pd.hour).padStart(2, "0");
        const minutes = String(pd.minute).padStart(2, "0");
        const seconds = String(pd.second).padStart(2, "0");
        return `${pd.toPlainDate().toString()} ${hours}:${minutes}:${seconds}`;
      }

      case "yyyy-MM-dd HH:mm": {
        const pd2 = zdt.toPlainDateTime();
        const h2 = String(pd2.hour).padStart(2, "0");
        const m2 = String(pd2.minute).padStart(2, "0");
        return `${pd2.toPlainDate().toString()} ${h2}:${m2}`;
      }

      case "yyyy-MM-dd":
        return zdt.toPlainDate().toString();

      default:
        // Fallback: use the localeString with basic formatting
        return zdt.toLocaleString("en-US", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true,
        });
    }
  },

  /**
   * Format with Intl.DateTimeFormat options directly.
   * Replaces `dateTime.toLocaleString(DateTime.DATETIME_HUGE_WITH_SECONDS)`.
   */
  formatLocale(
    zdt: Temporal.ZonedDateTime,
    options: Intl.DateTimeFormatOptions = {},
  ): string {
    // Convert ZonedDateTime to a legacy Date for Intl (the toInstant roundtrip is lossless)
    const epochMs = zdt.toInstant().epochMilliseconds;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      ...options,
    }).format(epochMs);
  },

  /**
   * Equivalent to Luxon's `DateTime.DATETIME_HUGE_WITH_SECONDS`.
   * e.g., "Friday, October 14, 1983 at 9:30:33 AM Pacific Daylight Time"
   */
  formatDateTimeHugeWithSeconds(zdt: Temporal.ZonedDateTime): string {
    return TemporalHelpers.formatLocale(zdt, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "long",
      hour12: true,
    });
  },

  // ─── Relative Time ────────────────────────────────────────────

  /**
   * Human-readable relative time string.
   * Replaces `dateTime.toRelative()`.
   *
   * @example
   *   toRelative(TemporalHelpers.fromMillis(Date.now() - 3600000))
   *   // → "1 hour ago"
   */
  toRelative(zdt: Temporal.ZonedDateTime): string {
    const nowInstant = Temporal.Now.instant();
    const targetInstant = zdt.toInstant();
    const diffSeconds = Number(nowInstant.epochMilliseconds - targetInstant.epochMilliseconds) / 1000;

    for (const { unit, divisor } of RELATIVE_UNITS) {
      const value = diffSeconds / divisor;
      if (Math.abs(value) >= 1 || unit === "second") {
        return rtf.format(-Math.round(value), unit);
      }
    }
    return rtf.format(0, "second");
  },

  // ─── Comparison & Arithmetic ──────────────────────────────────

  /**
   * Difference between two ZonedDateTimes in the given unit.
   * Replaces `a.diff(b, "days").days`.
   */
  diffIn(
    a: Temporal.ZonedDateTime,
    b: Temporal.ZonedDateTime,
    unit: "days" | "hours" | "minutes" | "seconds",
  ): number {
    const aMs = a.toInstant().epochMilliseconds;
    const bMs = b.toInstant().epochMilliseconds;
    const diffMs = aMs - bMs;
    switch (unit) {
      case "days":    return diffMs / (24 * 60 * 60 * 1000);
      case "hours":   return diffMs / (60 * 60 * 1000);
      case "minutes": return diffMs / (60 * 1000);
      case "seconds": return diffMs / 1000;
    }
  },

  /**
   * Check if two ZonedDateTimes share the same calendar unit.
   * Replaces `a.hasSame(b, "hour")`.
   */
  hasSame(
    a: Temporal.ZonedDateTime,
    b: Temporal.ZonedDateTime,
    unit: "year" | "month" | "day" | "hour",
  ): boolean {
    switch (unit) {
      case "year":  return a.year === b.year;
      case "month": return a.year === b.year && a.month === b.month;
      case "day":   return a.year === b.year && a.month === b.month && a.day === b.day;
      case "hour":  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour;
    }
  },

  /**
   * Subtract a duration from a ZonedDateTime.
   * Replaces `dateTime.minus({ months: 36 })`.
   */
  minus(
    zdt: Temporal.ZonedDateTime,
    duration: Temporal.DurationLike,
  ): Temporal.ZonedDateTime {
    return zdt.subtract(Temporal.Duration.from(duration));
  },

  /**
   * Epoch milliseconds from a ZonedDateTime.
   */
  toEpochMs(zdt: Temporal.ZonedDateTime): number {
    return Number(zdt.toInstant().epochMilliseconds);
  },

  // ─── Compact ID Format ────────────────────────────────────────

  /**
   * Generate a compact date-based ID from a ZonedDateTime.
   * Replaces `dateTime.toFormat("yyMMddHHmmSSS")` etc.
   *
   * The format patterns map to zero-padded numeric fields:
   * - y=year, M=month, d=day, H=hour, m=minute, S=millisecond
   */
  toDateId(zdt: Temporal.ZonedDateTime, pattern: string): string {
    const pd = zdt.toPlainDateTime();
    const y2 = String(pd.year % 100).padStart(2, "0");
    const M2 = String(pd.month).padStart(2, "0");
    const d2 = String(pd.day).padStart(2, "0");
    const H2 = String(pd.hour).padStart(2, "0");
    const m2 = String(pd.minute).padStart(2, "0");
    const ms = String(pd.millisecond).padStart(3, "0");

    switch (pattern) {
      case "yyMMddHHmmSSS": return `${y2}${M2}${d2}${H2}${m2}${ms}`;
      case "mSSS":          return `${m2}${ms}`;
      case "HmmSSS":        return `${H2}${m2}${ms}`;
      case "dHHmmSSS":      return `${d2}${H2}${m2}${ms}`;
      case "MddHHmmSSS":    return `${M2}${d2}${H2}${m2}${ms}`;
      default:              return `${y2}${M2}${d2}${H2}${m2}${ms}`;
    }
  },
};

export default TemporalHelpers;
