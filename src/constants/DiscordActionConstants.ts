/**
 * DiscordActionConstants — limits for the Discord actions the Lupos
 * agent can take through tools-service (polls, threads, reminders, his
 * own nickname).
 *
 * These are the numbers of the cross-repo contract: tools-service
 * advertises the same bounds to the model in its tool definitions, so a
 * change here is a change there too. The caps are enforced here — no
 * prompt can reach past them.
 */

/** A Discord id — the same shape tools-service accepts in its headers. */
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/** One cooldown length for every per-channel / per-guild action window. */
const TEN_MINUTES_MS = 10 * 60_000;

// ─── Polls ────────────────────────────────────────────────────────────
export const POLL_QUESTION_MAX_LENGTH = 300;
export const POLL_ANSWER_MAX_LENGTH = 55;
export const POLL_ANSWERS_MIN = 2;
export const POLL_ANSWERS_MAX = 10;
export const POLL_DURATION_HOURS_MIN = 1;
export const POLL_DURATION_HOURS_MAX = 168;
export const POLL_DURATION_HOURS_DEFAULT = 24;
/** At most one poll per channel in this window. */
export const POLL_COOLDOWN_MS = TEN_MINUTES_MS;

// ─── Threads ──────────────────────────────────────────────────────────
export const THREAD_NAME_MAX_LENGTH = 100;
/** Discord's auto-archive choices, in minutes (1 h, 1 d, 3 d, 1 w). */
export const THREAD_AUTO_ARCHIVE_MINUTES = [60, 1440, 4320, 10080] as const;
export const THREAD_AUTO_ARCHIVE_MINUTES_DEFAULT = 1440;
/** At most one thread per channel in this window. */
export const THREAD_COOLDOWN_MS = TEN_MINUTES_MS;

// ─── Reminders ────────────────────────────────────────────────────────
export const REMINDERS_COLLECTION = "Reminders";
export const REMINDER_TEXT_MAX_LENGTH = 300;
export const REMINDER_DELAY_MINUTES_MIN = 1;
/** 30 days — also the furthest a `dueAt` may lie ahead. */
export const REMINDER_DELAY_MINUTES_MAX = 43_200;
export const REMINDER_MAX_PENDING_PER_USER = 5;
export const REMINDER_MAX_PENDING_PER_GUILD = 100;
/** How often the delivery job looks for due reminders. */
export const REMINDER_POLL_INTERVAL_MS = 30_000;
/** Past due by more than this (bot was down, Discord was slow) = say so. */
export const REMINDER_LATE_AFTER_MS = 2 * 60_000;
/**
 * A claimed reminder whose delivery never finished (the process died
 * mid-send) becomes claimable again after this long.
 */
export const REMINDER_CLAIM_TTL_MS = 5 * 60_000;
/** Transient send failures retried on later ticks before giving up. */
export const REMINDER_MAX_DELIVERY_ATTEMPTS = 5;
/** Deliveries per tick, so a backlog after downtime drains in steps. */
export const REMINDER_DELIVERIES_PER_TICK = 25;

// ─── Nickname ─────────────────────────────────────────────────────────
export const NICKNAME_MAX_LENGTH = 32;
/** At most one nickname change per guild in this window. */
export const NICKNAME_COOLDOWN_MS = TEN_MINUTES_MS;
