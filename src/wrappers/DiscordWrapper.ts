import { Client, GatewayIntentBits, Partials } from "discord.js";
import { sleep } from "@rodrigo-barraza/utilities-library";

const clients: any[] = [];

/**
 * Maximum number of login retry attempts before giving up.
 * Covers transient network errors and temporary Discord outages.
 */
const MAX_LOGIN_RETRIES = 5;

/**
 * Base delay in ms for exponential backoff between retries.
 * Actual delay = BASE_RETRY_DELAY * 2^attempt (1s, 2s, 4s, 8s, 16s).
 */
const BASE_RETRY_DELAY = 1000;

/**
 * Parse the session reset timestamp from Discord's "Not enough sessions"
 * error message. Returns null if not a session exhaustion error.
 */
function parseSessionResetTime(error: any) {
  const match = error?.message?.match(/resets at (.+)$/i);
  if (!match) return null;
  const resetDate = new Date(match[1]);
  return isNaN(resetDate.getTime()) ? null : resetDate;
}

/**
 * Attempt client.login() with retry logic and session exhaustion detection.
 *
 * - Session exhaustion ("Not enough sessions remaining"): sleeps until
 *   Discord's advertised reset time + 30s buffer, then retries once.
 * - Transient errors: exponential backoff up to MAX_LOGIN_RETRIES.
 * - Fatal/unknown errors after retries: keeps the process alive but
 *   logs the failure — prevents Docker restart loops from burning sessions.
 */
async function loginWithRetry(client: any, token: any, name: any) {
  for (let attempt = 0; attempt < MAX_LOGIN_RETRIES; attempt++) {
    try {
      await client.login(token);
      return; // success
    } catch (error: any) {
      // ── Session exhaustion — sleep until reset ──────────────
      const resetTime = parseSessionResetTime(error);
      if (resetTime) {
        const waitMs = resetTime.getTime() - Date.now() + 30_000; // +30s buffer
        const waitMin = Math.ceil(waitMs / 60_000);
        console.error(
          `🚫 [DiscordWrapper] Session limit exhausted for "${name}". ` +
          `Sleeping ${waitMin} minutes until reset at ${resetTime.toISOString()}...`,
        );
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        // After sleeping, retry login (counts as next attempt)
        continue;
      }

      // ── Transient error — exponential backoff ──────────────
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      console.error(
        `⚠️ [DiscordWrapper] Login attempt ${attempt + 1}/${MAX_LOGIN_RETRIES} ` +
        `failed for "${name}": ${error.message}. Retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }

  // All retries exhausted — keep process alive to prevent restart loop
  console.error(
    `❌ [DiscordWrapper] All ${MAX_LOGIN_RETRIES} login attempts failed for "${name}". ` +
    `Process will stay alive to prevent restart loop. Manual intervention required.`,
  );
}

const DiscordWrapper = {
  clients: clients,
  createClient(name: any, token: any) {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
      ],
      rest: {
        retries: 3,
        timeout: 60000,
      },
    });

    // Fire-and-forget but won't crash the process on failure
    loginWithRetry(client, token, name);
    client.options.failIfNotExists = false;

    clients.push({
      name: name,
      client: client,
    });

    return client;
  },
  getClient(name: any) {
    return clients.find((client: any) => client.name === name).client;
  },
};

export default DiscordWrapper;
