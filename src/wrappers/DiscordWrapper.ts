import {
  Client,
  Events,
  GatewayIntentBits,
  IntentsBitField,
  Partials,
  Routes,
} from "discord.js";
import type { Guild, Message, PartialMessage } from "discord.js";
import { sleep } from "@rodrigo-barraza/utilities-library";
import type { DiscordClientEntry } from "#root/types/index.ts";

const clients: DiscordClientEntry[] = [];

/**
 * When each client's gateway connection was lost, by client name; null
 * while connected. A client counts as down from creation until its first
 * READY, so a login that never succeeds shows up too.
 */
const gatewayDownSince = new Map<string, number | null>();

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

/** Gateway close code for an IDENTIFY that asks for intents the app lacks. */
const CLOSE_CODE_DISALLOWED_INTENTS = 4014;

// Application flags that grant each privileged intent: the plain flag is
// set once Discord approves the intent through review, the _LIMITED one
// when the Developer Portal toggle is on below the review threshold
// (10,000 users since 2026-06-10). Discord clears both when it removes
// access, and from then on an IDENTIFY that asks for the intent is closed
// with 4014 — which is how Lupos went down on 2026-10-09.
// https://discord.com/developers/docs/resources/application#application-object-application-flags
const APPLICATION_FLAGS_GATEWAY_PRESENCE = (1 << 12) | (1 << 13);
const APPLICATION_FLAGS_GATEWAY_GUILD_MEMBERS = (1 << 14) | (1 << 15);
const APPLICATION_FLAGS_GATEWAY_MESSAGE_CONTENT = (1 << 18) | (1 << 19);

/** Every intent Lupos is written for; the privileged ones may be withheld. */
function wantedIntents(): number[] {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildVoiceStates,
    // Not privileged: AutoMod verdicts, which carry no content without
    // MessageContent — enough for the laugh-only rule (LaughOnlyAutoMod).
    GatewayIntentBits.AutoModerationExecution,
  ];
}

/**
 * The wanted intents minus the privileged ones the application flags do
 * not grant, plus the names of those withheld.
 */
export function resolveGrantedIntents(
  wanted: number[],
  applicationFlags: number,
): { granted: number[]; withheld: string[] } {
  const privileged = [
    {
      intent: GatewayIntentBits.GuildMembers,
      name: "GuildMembers",
      flags: APPLICATION_FLAGS_GATEWAY_GUILD_MEMBERS,
    },
    {
      intent: GatewayIntentBits.GuildPresences,
      name: "GuildPresences",
      flags: APPLICATION_FLAGS_GATEWAY_PRESENCE,
    },
    {
      intent: GatewayIntentBits.MessageContent,
      name: "MessageContent",
      flags: APPLICATION_FLAGS_GATEWAY_MESSAGE_CONTENT,
    },
  ];
  const missing = privileged.filter(
    (p) => wanted.includes(p.intent) && (applicationFlags & p.flags) === 0,
  );
  return {
    granted: wanted.filter((i) => !missing.some((p) => p.intent === i)),
    withheld: missing.map((p) => p.name),
  };
}

/**
 * Ask Discord which privileged intents the application holds right now and
 * connect with only those — an IDENTIFY with one it lacks is refused with
 * 4014 and the bot never comes up. Runs before every login attempt, so a
 * restart after Discord approves an intent picks it up with no code change.
 */
async function applyGrantedIntents(client: Client, token: string, name: string) {
  client.rest.setToken(token);
  const application = (await client.rest.get(Routes.currentApplication())) as {
    flags?: number;
  };
  const flags = application.flags ?? 0;
  const { granted, withheld } = resolveGrantedIntents(wantedIntents(), flags);
  client.options.intents = new IntentsBitField(granted).freeze();
  if (withheld.length > 0) {
    console.warn(
      `⚠️ [DiscordWrapper] Discord has not granted "${name}" the ${withheld.join(", ")} ` +
        `intent(s) (application flags ${flags}) — connecting without them. ` +
        `What they power stays off until Discord approves the privileged intent ` +
        `review; restart after approval to pick them up.`,
    );
  }
}

/**
 * Parse the session reset timestamp from Discord's "Not enough sessions"
 * error message. Returns null if not a session exhaustion error.
 */
function parseSessionResetTime(error: unknown): Date | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/resets at (.+)$/i);
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
async function loginWithRetry(client: Client, token: string, name: string) {
  for (let attempt = 0; attempt < MAX_LOGIN_RETRIES; attempt++) {
    try {
      await applyGrantedIntents(client, token, name);
      await client.login(token);
      return; // success
    } catch (error: unknown) {
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
        `failed for "${name}": ${(error as Error).message}. Retrying in ${delay}ms...`,
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

/**
 * Track the gateway connection and make its unrecoverable closes loud.
 * discord.js never reconnects after a 4014 or the other fatal codes — it
 * emits shardDisconnect and the process carries on without a gateway, as
 * it did for eight hours on 2026-10-09 with nothing in the log.
 */
function watchGateway(client: Client, name: string) {
  gatewayDownSince.set(name, Date.now());
  const markUp = () => gatewayDownSince.set(name, null);
  const markDown = () => {
    if (gatewayDownSince.get(name) == null) gatewayDownSince.set(name, Date.now());
  };
  client.on(Events.ShardReady, markUp);
  client.on(Events.ShardResume, markUp);
  client.on(Events.ShardReconnecting, markDown);
  client.on(Events.ShardDisconnect, (event, shardId) => {
    markDown();
    console.error(
      `🔌 [DiscordWrapper] "${name}" shard ${shardId} closed with code ${event.code} ` +
        `and will not reconnect.`,
    );
    // A 4014 after READY means Discord withdrew an intent mid-session.
    // Restart: the next boot asks Discord again and connects with what the
    // app still holds. Only after READY — at boot the same answer would
    // come back and the restarts would burn the daily session budget.
    if (event.code === CLOSE_CODE_DISALLOWED_INTENTS && client.readyAt) {
      console.error(
        `🔌 [DiscordWrapper] Discord withdrew a privileged intent from "${name}" — ` +
          `restarting to reconnect with the intents it still holds.`,
      );
      process.kill(process.pid, "SIGTERM");
    }
  });
}

/**
 * Whether this client connected with the given gateway intent. A client
 * without intent information (a test double) counts as having every
 * intent, which is how the code behaved before intents could be withheld.
 */
export function hasGatewayIntent(
  client: Client | null | undefined,
  intent: number,
): boolean {
  const intents = client?.options?.intents;
  return intents ? intents.has(intent) : true;
}

/**
 * Throw when the GuildMembers intent is withheld: Discord hands out a
 * whole-guild member list only with it (gateway and REST alike), and
 * discord.js would wait two minutes for member chunks that never come.
 */
export function assertGuildMembersIntent(guild: Guild): void {
  if (!hasGatewayIntent(guild.client, GatewayIntentBits.GuildMembers)) {
    throw new Error(
      `Discord has not granted the GuildMembers intent — the member list of "${guild.name}" is unavailable`,
    );
  }
}

/**
 * Whether Discord withheld this message's content. Without the
 * MessageContent intent, content, embeds, attachments, components and poll
 * arrive empty on every message that is not the bot's own, a DM, or one
 * that @-mentions the bot — over the gateway and over REST alike.
 */
export function isMessageContentWithheld(
  message: Message | PartialMessage,
): boolean {
  if (hasGatewayIntent(message.client, GatewayIntentBits.MessageContent)) {
    return false;
  }
  return (
    !message.content &&
    !message.attachments?.size &&
    !message.embeds?.length &&
    !message.poll
  );
}

const DiscordWrapper = {
  clients: clients,
  createClient(name: string, token: string): Client {
    const client = new Client({
      // Replaced before every login with the intents Discord grants
      // (applyGrantedIntents); this is the full set Lupos is written for.
      intents: wantedIntents(),
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

    watchGateway(client, name);
    // Fire-and-forget but won't crash the process on failure
    loginWithRetry(client, token, name);
    client.options.failIfNotExists = false;

    clients.push({
      name: name,
      client: client,
    });

    return client;
  },
  getClient(name: string): Client {
    const entry = clients.find((c) => c.name === name);
    if (!entry) throw new Error(`DiscordWrapper: no client named "${name}"`);
    return entry.client;
  },
  /**
   * When the named client's gateway connection was lost, or null while it
   * is connected (and for a name no client was created under).
   */
  getGatewayDownSinceMs(name: string): number | null {
    return gatewayDownSince.get(name) ?? null;
  },
};

export default DiscordWrapper;
