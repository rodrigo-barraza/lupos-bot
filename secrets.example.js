// ============================================================
// Lupos — Secrets & Configuration Template
// ============================================================
// Copy this file to secrets.js and fill in your real values.
//   cp secrets.example.js secrets.js
// ============================================================

// ─── Server ────────────────────────────────────────────────────
export const LUPOS_PORT = 1337;

// ─── Maintenance ───────────────────────────────────────────────
export const UNDER_MAINTENANCE = true;

// ─── Discord Tokens ────────────────────────────────────────────
export const VENDER_TOKEN = "";
export const LUPOS_TOKEN = "";

// ─── Prism ─────────────────────────────────────────────────────
export const PRISM_URL = "http://localhost:7777";

// ─── Database ──────────────────────────────────────────────────
export const MONGO_URI = "mongodb://user:password@<host>:27017/?directConnection=true&replicaSet=rs0&authSource=admin";

// ─── Service URLs ──────────────────────────────────────────────
export const LIGHTS_URL = "http://localhost:4444";
export const TOOLS_API_URL = "http://localhost:5590";

// ─── Discord IDs — Ignore Lists ────────────────────────────────
export const ROLES_IDS_IGNORE = ["1394148043153997935"];
export const USER_IDS_IGNORE = [
	"123456789012345678",
	"1387618309071048745",
	"679626713310691358",
	"274558094896529408",
	"189874811240054785",
];
export const CHANNEL_IDS_JUKEBOX = ["1389725795869786284"];

// ─── Discord IDs — Guilds ──────────────────────────────────────
export const GUILD_ID_PRIMARY = "609471635308937237";
export const GUILD_ID_TESTING = "1357934319879979170";
export const GUILD_ID_GROBBULUS = "1388329197260505262";
export const GUILD_ID_CLOCK_CREW = "249010731910037507";

// ─── Discord IDs — Emojis ──────────────────────────────────────
export const EMOJI_ID_FLAG = "1377425518520959067";

// ─── Discord IDs — Roles ───────────────────────────────────────
export const ROLE_ID_BIRTHDAY_MONTH = "733730630935904276";
export const ROLE_ID_YAPPER = "1250937112493035561";
export const ROLE_ID_REACTOR = "1256806802465493022";
export const ROLE_ID_BOT_CHATTER = "1353101921681936456";
export const ROLE_ID_STREAMER = "1392951318951231629";
export const ROLE_ID_VOICE_CHATTER = "1392631838521954335";
export const ROLE_ID_FLAG = "1354926676714328154";
export const ROLE_ID_POLITICS_MUTE = "765201362358239252";
export const ROLE_ID_SPOTIFY_LISTENER = "1392632930957918239";

// ─── Discord IDs — Channels ────────────────────────────────────
export const CHANNEL_ID_POLITICS = "762734438375096380";
export const CHANNEL_ID_SELF_ROLES = "1392993431172681848";
export const CHANNEL_ID_LEAVERS = "1392636842645520415";
export const CHANNEL_ID_HIGHLIGHTS = "1295184997006708807";
export const CHANNEL_ID_BOOTY_BAE = "718520315721810030";
export const CHANNEL_ID_STREAMERS = "609498307626008576";
export const CHANNEL_ID_DELETED_MESSAGES = "1392636842645520416";
export const CHANNEL_ID_BOT_STATUS = "1198326193984913470";
export const CHANNEL_ID_JUKEBOX_EXCEPTION = "835237008691560528";

// ─── Discord IDs — Users ───────────────────────────────────────
export const USER_IDS_DISALLOWED = [
	"108079833283604480",
	"150025324095209472",
];
export const USER_IDS_TIMED_OUT = [
	"523687983417786379",
	"243173972743553024",
	"450668181359427584",
	"183511447924375552",
	"1021825192923779193",
];
export const USER_IDS_POLITICS_MUTED = ["1349125934506053722"];
export const USER_IDS_NEW_ACCOUNT_WHITELIST = [];

// ─── Feature Flags ─────────────────────────────────────────────
export const DEATHROLL_SEASON = 1;

export const ASSISTANT_MESSAGE = "";

// ─── Home Automation ───────────────────────────────────────────
export const PRIMARY_LIGHT_ID = "d073d523f763";

// ─── Language Models ───────────────────────────────────────────
export const LANGUAGE_MODEL_PERFORMANCE = "POWERFUL";

export const ANTHROPIC_LANGUAGE_MODEL_SMART = "claude-sonnet-4-6";
export const ANTHROPIC_LANGUAGE_MODEL_FAST = "claude-haiku-4-5-20251001";

export const OPENAI_LANGUAGE_MODEL_GPT4_1_NANO = "gpt-4.1-nano";

export const LANGUAGE_MODEL_OPENAI = "gpt-4";
export const LANGUAGE_MODEL_LOCAL = "deepseek-r1-distill-qwen-32b-abliterated@q3_k_s";
export const LANGUAGE_MODEL_TYPE = "ANTHROPIC";
export const LANGUAGE_MODEL_MAX_TOKENS = 1000;
export const LANGUAGE_MODEL_TEMPERATURE = 0.55;

export const LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";

export const FAST_LANGUAGE_MODEL_OPENAI = "gpt-4o";
export const FAST_LANGUAGE_MODEL_LOCAL = "deepseek-r1-distill-qwen-32b-abliterated@q3_k_s";
