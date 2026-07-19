// ============================================================
// Lupos — Runtime Configuration
// ============================================================
// Typed accessor layer over process.env. The Vault service is
// the single source of truth — boot.js hydrates process.env
// from the Vault before any module imports run.
//
// This file contains NO defaults and NO secrets.
//
// All consumers import: `import config from "#root/config.js"`
// ============================================================

import { assertRequiredEnvironment } from "@rodrigo-barraza/utilities-library";

/**
 * Parse a comma-separated env var into an array of strings.
 */
function parseCommaSeparated(envKey: string) {
  const raw = process.env[envKey];
  return raw
    ? raw
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean)
    : [];
}

const config = {
  // ─── Server ────────────────────────────────────────────────────
  SERVER_PORT: process.env.LUPOS_BOT_PORT,

  // ─── API Security (opt-in — unset preserves legacy behavior) ───
  // Comma-separated CORS allowlist. Unset ⇒ reflect any origin (legacy).
  ALLOWED_ORIGINS: parseCommaSeparated("ALLOWED_ORIGINS"),
  // Shared secret for mutating endpoints (x-api-key header). Unset ⇒ open.
  API_SHARED_SECRET: process.env.API_SHARED_SECRET,

  // ─── Boot Sweeps (fail-safe — must be explicitly "true") ───────
  ENABLE_BOOT_ACCOUNT_SWEEP: process.env.ENABLE_BOOT_ACCOUNT_SWEEP === "true",
  ENABLE_BOOT_ROLE_REVOKE: process.env.ENABLE_BOOT_ROLE_REVOKE === "true",

  // ─── Maintenance ───────────────────────────────────────────────
  UNDER_MAINTENANCE: process.env.UNDER_MAINTENANCE === "true",

  // ─── Discord Tokens ────────────────────────────────────────────
  VENDER_TOKEN: process.env.VENDER_TOKEN,
  LUPOS_TOKEN: process.env.LUPOS_TOKEN,

  // ─── Prism ─────────────────────────────────────────────────────
  PRISM_API_URL: process.env.PRISM_SERVICE_URL,

  // ─── Database ──────────────────────────────────────────────────
  DATABASE_URL: process.env.MONGO_URI,

  // ─── Service URLs ──────────────────────────────────────────────
  LIGHTS_SERVICE_URL: process.env.LIGHTS_SERVICE_URL,
  TOOLS_SERVICE_URL: process.env.TOOLS_SERVICE_URL,

  // ─── Monitoring (Optional — dead-man's-switch heartbeat) ────────
  // Healthchecks.io check URL or Uptime Kuma push URL; pinged every
  // minute by HeartbeatService (https://healthchecks.io/docs/).
  HEARTBEAT_URL: process.env.HEARTBEAT_URL,

  // ─── MinIO (Optional — media archival) ──────────────────────────
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  MINIO_BUCKET_NAME:
    process.env.LUPOS_BOT_MINIO_BUCKET_NAME ||
    process.env.LUPOS_MINIO_BUCKET_NAME,

  // ─── Discord IDs — Ignore Lists ────────────────────────────────
  ROLES_IDS_IGNORE: parseCommaSeparated("ROLES_IDS_IGNORE"),
  USER_IDS_IGNORE: parseCommaSeparated("USER_IDS_IGNORE"),
  CHANNEL_IDS_JUKEBOX: parseCommaSeparated("CHANNEL_IDS_JUKEBOX"),

  // ─── Discord IDs — Guilds ──────────────────────────────────────
  GUILD_ID_PRIMARY: process.env.GUILD_ID_PRIMARY,
  GUILD_ID_TESTING: process.env.GUILD_ID_TESTING,
  GUILD_ID_GROBBULUS: process.env.GUILD_ID_GROBBULUS,
  GUILD_ID_CLOCK_CREW: process.env.GUILD_ID_CLOCK_CREW,
  GUILD_ID_CRUSADER_STRIKE: process.env.GUILD_ID_CRUSADER_STRIKE,

  // ─── Discord IDs — Emojis ──────────────────────────────────────
  EMOJI_ID_FLAG: process.env.EMOJI_ID_FLAG,

  // ─── Discord IDs — Roles ───────────────────────────────────────
  ROLE_ID_BIRTHDAY_MONTH: process.env.ROLE_ID_BIRTHDAY_MONTH,
  ROLE_ID_YAPPER: process.env.ROLE_ID_YAPPER,
  ROLE_ID_REACTOR: process.env.ROLE_ID_REACTOR,
  ROLE_ID_BOT_CHATTER: process.env.ROLE_ID_BOT_CHATTER,
  ROLE_ID_STREAMER: process.env.ROLE_ID_STREAMER,
  ROLE_ID_VOICE_CHATTER: process.env.ROLE_ID_VOICE_CHATTER,
  ROLE_ID_FLAG: process.env.ROLE_ID_FLAG,
  ROLE_ID_POLITICS_MUTE: process.env.ROLE_ID_POLITICS_MUTE,
  ROLE_ID_SPOTIFY_LISTENER: process.env.ROLE_ID_SPOTIFY_LISTENER,

  // ─── Discord IDs — Channels ────────────────────────────────────
  CHANNEL_ID_POLITICS: process.env.CHANNEL_ID_POLITICS,
  CHANNEL_ID_SELF_ROLES: process.env.CHANNEL_ID_SELF_ROLES,
  CHANNEL_ID_LEAVERS: process.env.CHANNEL_ID_LEAVERS,
  CHANNEL_ID_HIGHLIGHTS: process.env.CHANNEL_ID_HIGHLIGHTS,
  CHANNEL_ID_BOOTY_BAE: process.env.CHANNEL_ID_BOOTY_BAE,
  CHANNEL_ID_STREAMERS: process.env.CHANNEL_ID_STREAMERS,
  CHANNEL_ID_DELETED_MESSAGES: process.env.CHANNEL_ID_DELETED_MESSAGES,
  CHANNEL_ID_BOT_STATUS: process.env.CHANNEL_ID_BOT_STATUS,
  CHANNEL_ID_JUKEBOX_EXCEPTION: process.env.CHANNEL_ID_JUKEBOX_EXCEPTION,
  // Optional override for the incoming-DM relay channel; when unset,
  // DmInboxService finds/creates #dm-inbox in GUILD_ID_TESTING.
  CHANNEL_ID_DM_INBOX: process.env.CHANNEL_ID_DM_INBOX,

  // ─── Discord IDs — Users ───────────────────────────────────────
  // Bot owner — gates owner-only surfaces (e.g. /dm-campaign).
  OWNER_USER_ID: process.env.OWNER_USER_ID,
  USER_IDS_DISALLOWED: parseCommaSeparated("USER_IDS_DISALLOWED"),
  USER_IDS_TIMED_OUT: parseCommaSeparated("USER_IDS_TIMED_OUT"),
  USER_IDS_POLITICS_MUTED: parseCommaSeparated("USER_IDS_POLITICS_MUTED"),
  USER_IDS_NEW_ACCOUNT_WHITELIST: parseCommaSeparated(
    "USER_IDS_NEW_ACCOUNT_WHITELIST",
  ),

  // ─── Countdown Icon ────────────────────────────────────────────
  COUNTDOWN_ICON_TARGET_DATE: process.env.COUNTDOWN_ICON_TARGET_DATE,
  COUNTDOWN_ICON_TARGET_DATE_CLOCK_CREW:
    process.env.COUNTDOWN_ICON_TARGET_DATE_CLOCK_CREW,

  // ─── Feature Flags ─────────────────────────────────────────────
  DEATHROLL_SEASON: process.env.DEATHROLL_SEASON,

  ASSISTANT_MESSAGE: process.env.ASSISTANT_MESSAGE,

  // ─── Home Automation ───────────────────────────────────────────
  PRIMARY_LIGHT_ID: process.env.PRIMARY_LIGHT_ID,

  // ─── Language Models ───────────────────────────────────────────
  LANGUAGE_MODEL_PERFORMANCE: process.env.LANGUAGE_MODEL_PERFORMANCE,

  ANTHROPIC_LANGUAGE_MODEL_SMART: process.env.ANTHROPIC_LANGUAGE_MODEL_SMART,
  ANTHROPIC_LANGUAGE_MODEL_FAST: process.env.ANTHROPIC_LANGUAGE_MODEL_FAST,

  GOOGLE_LANGUAGE_MODEL_FAST: process.env.GOOGLE_LANGUAGE_MODEL_FAST,
  GOOGLE_LANGUAGE_MODEL_SMART: process.env.GOOGLE_LANGUAGE_MODEL_SMART,

  OPENAI_LANGUAGE_MODEL_GPT4_1_NANO:
    process.env.OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,

  LANGUAGE_MODEL_OPENAI: process.env.LANGUAGE_MODEL_OPENAI,
  LANGUAGE_MODEL_LOCAL: process.env.LANGUAGE_MODEL_LOCAL,
  LANGUAGE_MODEL_TYPE: process.env.LANGUAGE_MODEL_TYPE,
  LANGUAGE_MODEL_MAX_TOKENS: process.env.LANGUAGE_MODEL_MAX_TOKENS,
  LANGUAGE_MODEL_TEMPERATURE: process.env.LANGUAGE_MODEL_TEMPERATURE,

  LANGUAGE_MODEL_OPENAI_LOW: process.env.LANGUAGE_MODEL_OPENAI_LOW,

  FAST_LANGUAGE_MODEL_OPENAI: process.env.FAST_LANGUAGE_MODEL_OPENAI,
  FAST_LANGUAGE_MODEL_LOCAL: process.env.FAST_LANGUAGE_MODEL_LOCAL,
};

/**
 * Fail-fast startup validation. Call before anything else boots.
 *
 * Throws a clear error naming the missing/invalid env var(s) instead of
 * letting the process fail deep at a use site (e.g. `app.listen(NaN)`).
 * Only vars the bot cannot run without are required — everything that is
 * optional today stays optional.
 */
export function validateConfig(cfg: typeof config = config): void {
  // Labels name the env var (annotated with the config key it feeds).
  assertRequiredEnvironment(
    {
      "LUPOS_TOKEN": cfg.LUPOS_TOKEN,
      "MONGO_URI (config.DATABASE_URL)": cfg.DATABASE_URL,
      "LUPOS_BOT_PORT (config.SERVER_PORT)": cfg.SERVER_PORT,
    },
    { prefix: "[config]" },
  );

  if (Number.isNaN(Number(cfg.SERVER_PORT))) {
    throw new Error(
      `[config] LUPOS_BOT_PORT (config.SERVER_PORT) must be a number — got "${cfg.SERVER_PORT}"`,
    );
  }

  // Notable optional vars — one-line notice when absent, never fatal.
  if (
    !cfg.MINIO_ENDPOINT ||
    !cfg.MINIO_ACCESS_KEY ||
    !cfg.MINIO_SECRET_KEY ||
    !cfg.MINIO_BUCKET_NAME
  ) {
    console.log(
      "[config] MINIO_* not fully configured — media archival disabled.",
    );
  }
  if (!cfg.PRISM_API_URL) {
    console.log(
      "[config] PRISM_SERVICE_URL not set — Prism integration disabled.",
    );
  }
  if (!cfg.HEARTBEAT_URL) {
    console.log(
      "[config] HEARTBEAT_URL not set — dead-man's-switch heartbeat disabled.",
    );
  }
}

export default config;
