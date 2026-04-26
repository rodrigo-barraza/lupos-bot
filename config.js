// ============================================================
// Lupos — Runtime Configuration
// ============================================================
// Re-exports named secrets as a single config object.
// All consumers import this file: `import config from "#root/config.js"`
// ============================================================

import {
  LUPOS_PORT,
  UNDER_MAINTENANCE,
  VENDER_TOKEN,
  LUPOS_TOKEN,
  PRISM_URL,
  MONGO_URI,
  LIGHTS_URL,
  TOOLS_API_URL,
  ROLES_IDS_IGNORE,
  USER_IDS_IGNORE,
  CHANNEL_IDS_JUKEBOX,
  GUILD_ID_PRIMARY,
  GUILD_ID_TESTING,
  GUILD_ID_GROBBULUS,
  GUILD_ID_CLOCK_CREW,
  EMOJI_ID_FLAG,
  ROLE_ID_BIRTHDAY_MONTH,
  ROLE_ID_YAPPER,
  ROLE_ID_REACTOR,
  ROLE_ID_BOT_CHATTER,
  ROLE_ID_STREAMER,
  ROLE_ID_VOICE_CHATTER,
  ROLE_ID_FLAG,
  ROLE_ID_POLITICS_MUTE,
  ROLE_ID_SPOTIFY_LISTENER,
  CHANNEL_ID_POLITICS,
  CHANNEL_ID_SELF_ROLES,
  CHANNEL_ID_LEAVERS,
  CHANNEL_ID_HIGHLIGHTS,
  CHANNEL_ID_BOOTY_BAE,
  CHANNEL_ID_STREAMERS,
  CHANNEL_ID_DELETED_MESSAGES,
  CHANNEL_ID_BOT_STATUS,
  CHANNEL_ID_JUKEBOX_EXCEPTION,
  USER_IDS_DISALLOWED,
  USER_IDS_TIMED_OUT,
  USER_IDS_POLITICS_MUTED,
  USER_IDS_NEW_ACCOUNT_WHITELIST,
  DEATHROLL_SEASON,
  ASSISTANT_MESSAGE,
  PRIMARY_LIGHT_ID,
  LANGUAGE_MODEL_PERFORMANCE,
  ANTHROPIC_LANGUAGE_MODEL_SMART,
  ANTHROPIC_LANGUAGE_MODEL_FAST,
  OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,
  LANGUAGE_MODEL_OPENAI,
  LANGUAGE_MODEL_LOCAL,
  LANGUAGE_MODEL_TYPE,
  LANGUAGE_MODEL_MAX_TOKENS,
  LANGUAGE_MODEL_TEMPERATURE,
  LANGUAGE_MODEL_OPENAI_LOW,
  FAST_LANGUAGE_MODEL_OPENAI,
  FAST_LANGUAGE_MODEL_LOCAL,
} from "./secrets.js";

const config = {
  // ─── Server ────────────────────────────────────────────────────
  SERVER_PORT: LUPOS_PORT || 1337,

  // ─── Maintenance ───────────────────────────────────────────────
  UNDER_MAINTENANCE,

  // ─── Discord Tokens ────────────────────────────────────────────
  VENDER_TOKEN,
  LUPOS_TOKEN,

  // ─── Prism ─────────────────────────────────────────────────────
  PRISM_API_URL: PRISM_URL || "http://localhost:7777",

  // ─── Database ──────────────────────────────────────────────────
  DATABASE_URL: MONGO_URI,

  // ─── Service URLs ──────────────────────────────────────────────
  LIGHTS_URL: LIGHTS_URL || "http://localhost:4444",
  TOOLS_API_URL: TOOLS_API_URL || "http://localhost:5590",

  // ─── Discord IDs — Ignore Lists ────────────────────────────────
  ROLES_IDS_IGNORE,
  USER_IDS_IGNORE,
  CHANNEL_IDS_JUKEBOX,

  // ─── Discord IDs — Guilds ──────────────────────────────────────
  GUILD_ID_PRIMARY,
  GUILD_ID_TESTING,
  GUILD_ID_GROBBULUS,
  GUILD_ID_CLOCK_CREW,

  // ─── Discord IDs — Emojis ──────────────────────────────────────
  EMOJI_ID_FLAG,

  // ─── Discord IDs — Roles ───────────────────────────────────────
  ROLE_ID_BIRTHDAY_MONTH,
  ROLE_ID_YAPPER,
  ROLE_ID_REACTOR,
  ROLE_ID_BOT_CHATTER,
  ROLE_ID_STREAMER,
  ROLE_ID_VOICE_CHATTER,
  ROLE_ID_FLAG,
  ROLE_ID_POLITICS_MUTE,
  ROLE_ID_SPOTIFY_LISTENER,

  // ─── Discord IDs — Channels ────────────────────────────────────
  CHANNEL_ID_POLITICS,
  CHANNEL_ID_SELF_ROLES,
  CHANNEL_ID_LEAVERS,
  CHANNEL_ID_HIGHLIGHTS,
  CHANNEL_ID_BOOTY_BAE,
  CHANNEL_ID_STREAMERS,
  CHANNEL_ID_DELETED_MESSAGES,
  CHANNEL_ID_BOT_STATUS,
  CHANNEL_ID_JUKEBOX_EXCEPTION,

  // ─── Discord IDs — Users ───────────────────────────────────────
  USER_IDS_DISALLOWED,
  USER_IDS_TIMED_OUT,
  USER_IDS_POLITICS_MUTED,
  USER_IDS_NEW_ACCOUNT_WHITELIST,

  // ─── Feature Flags ─────────────────────────────────────────────
  DEATHROLL_SEASON,

  ASSISTANT_MESSAGE,

  // ─── Home Automation ───────────────────────────────────────────
  PRIMARY_LIGHT_ID,

  // ─── Language Models ───────────────────────────────────────────
  LANGUAGE_MODEL_PERFORMANCE,

  ANTHROPIC_LANGUAGE_MODEL_SMART,
  ANTHROPIC_LANGUAGE_MODEL_FAST,

  OPENAI_LANGUAGE_MODEL_GPT4_1_NANO,

  LANGUAGE_MODEL_OPENAI,
  LANGUAGE_MODEL_LOCAL,
  LANGUAGE_MODEL_TYPE,
  LANGUAGE_MODEL_MAX_TOKENS,
  LANGUAGE_MODEL_TEMPERATURE,

  LANGUAGE_MODEL_OPENAI_LOW,

  FAST_LANGUAGE_MODEL_OPENAI,
  FAST_LANGUAGE_MODEL_LOCAL,
};

export default config;
