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

/**
 * Parse a comma-separated env var into an array of strings.
 */
function parseCommaSeparated(envKey) {
  const raw = process.env[envKey];
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}


const config = {
  // ─── Server ────────────────────────────────────────────────────
  SERVER_PORT: process.env.LUPOS_BOT_PORT,

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

  // ─── MinIO (Optional — media archival) ──────────────────────────
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  MINIO_BUCKET_NAME: process.env.LUPOS_BOT_MINIO_BUCKET_NAME || process.env.LUPOS_MINIO_BUCKET_NAME,

  // ─── Discord IDs — Ignore Lists ────────────────────────────────
  ROLES_IDS_IGNORE: parseCommaSeparated("ROLES_IDS_IGNORE"),
  USER_IDS_IGNORE: parseCommaSeparated("USER_IDS_IGNORE"),
  CHANNEL_IDS_JUKEBOX: parseCommaSeparated("CHANNEL_IDS_JUKEBOX"),

  // ─── Discord IDs — Guilds ──────────────────────────────────────
  GUILD_ID_PRIMARY: process.env.GUILD_ID_PRIMARY,
  GUILD_ID_TESTING: process.env.GUILD_ID_TESTING,
  GUILD_ID_GROBBULUS: process.env.GUILD_ID_GROBBULUS,
  GUILD_ID_CLOCK_CREW: process.env.GUILD_ID_CLOCK_CREW,

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

  // ─── Discord IDs — Users ───────────────────────────────────────
  USER_IDS_DISALLOWED: parseCommaSeparated("USER_IDS_DISALLOWED"),
  USER_IDS_TIMED_OUT: parseCommaSeparated("USER_IDS_TIMED_OUT"),
  USER_IDS_POLITICS_MUTED: parseCommaSeparated("USER_IDS_POLITICS_MUTED"),
  USER_IDS_NEW_ACCOUNT_WHITELIST: parseCommaSeparated("USER_IDS_NEW_ACCOUNT_WHITELIST"),

  // ─── Feature Flags ─────────────────────────────────────────────
  DEATHROLL_SEASON: process.env.DEATHROLL_SEASON,

  ASSISTANT_MESSAGE: process.env.ASSISTANT_MESSAGE,

  // ─── Home Automation ───────────────────────────────────────────
  PRIMARY_LIGHT_ID: process.env.PRIMARY_LIGHT_ID,

  // ─── Language Models ───────────────────────────────────────────
  LANGUAGE_MODEL_PERFORMANCE: process.env.LANGUAGE_MODEL_PERFORMANCE,

  ANTHROPIC_LANGUAGE_MODEL_SMART: process.env.ANTHROPIC_LANGUAGE_MODEL_SMART,
  ANTHROPIC_LANGUAGE_MODEL_FAST: process.env.ANTHROPIC_LANGUAGE_MODEL_FAST,

  OPENAI_LANGUAGE_MODEL_GPT4_1_NANO: process.env.OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,

  LANGUAGE_MODEL_OPENAI: process.env.LANGUAGE_MODEL_OPENAI,
  LANGUAGE_MODEL_LOCAL: process.env.LANGUAGE_MODEL_LOCAL,
  LANGUAGE_MODEL_TYPE: process.env.LANGUAGE_MODEL_TYPE,
  LANGUAGE_MODEL_MAX_TOKENS: process.env.LANGUAGE_MODEL_MAX_TOKENS,
  LANGUAGE_MODEL_TEMPERATURE: process.env.LANGUAGE_MODEL_TEMPERATURE,

  LANGUAGE_MODEL_OPENAI_LOW: process.env.LANGUAGE_MODEL_OPENAI_LOW,

  FAST_LANGUAGE_MODEL_OPENAI: process.env.FAST_LANGUAGE_MODEL_OPENAI,
  FAST_LANGUAGE_MODEL_LOCAL: process.env.FAST_LANGUAGE_MODEL_LOCAL,
};

export default config;
