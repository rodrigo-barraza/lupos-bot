// ============================================================
// CommandSyncService — boot-time slash-command registration
// ============================================================
// Registers slash commands with Discord automatically so a deploy
// is complete on its own — no separate deploy-commands step to
// forget (src/scripts/deploy-commands.ts remains as a manual
// force-push escape hatch).
//
// Per guild: build the command payload (honoring each command's
// optional guildIds restriction), hash it, and only call Discord's
// bulk-overwrite when the hash differs from the last one recorded
// in Mongo (lupos.BotState). Restarts with unchanged commands are
// no-ops; a deploy that changes any definition re-registers exactly
// once per guild. Failed guilds keep their old hash and are retried
// on the next boot. Also handles GuildCreate so a server the bot
// joins mid-run gets its commands immediately.

import crypto from "node:crypto";
import { Events } from "discord.js";
import type {
  Client,
  Guild,
  Collection,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  ApplicationCommandDataResolvable,
} from "discord.js";

import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import MongoService from "#root/services/MongoService.js";
import utilities from "#root/utilities.js";
import { MONGO_DB_NAME } from "#root/constants.js";
import type { Command } from "#root/commands/types.js";

// Commands load into client.commands during init while the gateway
// connects concurrently — poll until both are true before syncing.
const READY_POLL_MILLISECONDS = 5_000;
const MAX_READY_POLLS = 60;

type ClientWithCommands = Client & { commands?: Collection<string, Command> };

// ─── Pure helpers (exported for unit tests) ────────────────────

/** Commands to register in a guild — a guildIds list restricts a
 *  command to exactly those guilds; no list means everywhere. */
export function buildGuildCommandPayload(
  commands: Command[],
  guildId: string,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands
    .filter(
      (command) => !command.guildIds || command.guildIds.includes(guildId),
    )
    .map(
      (command) =>
        command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody,
    );
}

export function hashCommandPayload(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

// ─── Persisted per-guild hashes ────────────────────────────────

interface CommandSyncStateDocument {
  _id: string;
  guildHashes: Record<string, string>;
  updatedAt: Date;
}

function botStateCollection() {
  const client = MongoService.getClient("local");
  if (!client) return null;
  return client
    .db(MONGO_DB_NAME)
    .collection<CommandSyncStateDocument>("BotState");
}

async function loadGuildHashes(): Promise<Record<string, string>> {
  try {
    const document = await botStateCollection()?.findOne({
      _id: "commandSync",
    });
    return document?.guildHashes ?? {};
  } catch (error: unknown) {
    // Fail open: an empty map just re-registers everywhere (idempotent).
    console.warn(
      `📜 [CommandSyncService] Could not load sync state: ${utilities.errorMessage(error)}`,
    );
    return {};
  }
}

async function persistGuildHash(guildId: string, hash: string): Promise<void> {
  try {
    await botStateCollection()?.updateOne(
      { _id: "commandSync" },
      { $set: { [`guildHashes.${guildId}`]: hash, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (error: unknown) {
    console.warn(
      `📜 [CommandSyncService] Could not persist hash for guild ${guildId}: ${utilities.errorMessage(error)}`,
    );
  }
}

// ─── Sync ──────────────────────────────────────────────────────

function getLoadedCommands(client: ClientWithCommands): Command[] | null {
  const commands = client.commands;
  if (!commands || commands.size === 0) return null;
  return [...commands.values()];
}

/** Register one guild's commands when its payload hash changed. */
async function syncGuild(
  client: Client,
  guild: Guild,
  commands: Command[],
  guildHashes: Record<string, string>,
): Promise<void> {
  const payload = buildGuildCommandPayload(commands, guild.id);
  const hash = hashCommandPayload(payload);
  if (guildHashes[guild.id] === hash) return;

  try {
    await client.application!.commands.set(
      payload as ApplicationCommandDataResolvable[],
      guild.id,
    );
    guildHashes[guild.id] = hash;
    await persistGuildHash(guild.id, hash);
    console.log(
      `📜 [CommandSyncService] Registered ${payload.length} commands in ${guild.name}`,
    );
  } catch (error: unknown) {
    // Old hash is kept, so this guild retries on the next boot.
    console.error(
      `📜 [CommandSyncService] Failed to register commands in ${guild.name}: ${utilities.errorMessage(error)}`,
    );
  }
}

async function syncAllGuilds(client: ClientWithCommands): Promise<void> {
  const commands = getLoadedCommands(client);
  if (!commands) {
    console.warn(
      "📜 [CommandSyncService] No commands loaded — skipping registration",
    );
    return;
  }
  const guildHashes = await loadGuildHashes();
  let synced = 0;
  for (const guild of client.guilds.cache.values()) {
    const before = guildHashes[guild.id];
    await syncGuild(client, guild, commands, guildHashes);
    if (guildHashes[guild.id] !== before) synced++;
  }
  console.log(
    `📜 [CommandSyncService] Command sync complete — ${synced} guild(s) updated, ${client.guilds.cache.size - synced} already current`,
  );
}

// ─── Startup ───────────────────────────────────────────────────

let started = false;

const CommandSyncService = {
  /**
   * Start the one-shot boot sync (retries until the client is ready
   * and commands are loaded) and watch GuildCreate for servers the
   * bot joins later. Safe to call before the client exists; no-op
   * when already started.
   */
  startCommandSync(): void {
    if (started) return;
    started = true;

    let polls = 0;
    const attempt = () => {
      let client: ClientWithCommands;
      try {
        client = DiscordWrapper.getClient("lupos");
      } catch {
        client = undefined as unknown as ClientWithCommands;
      }

      if (client?.isReady() && getLoadedCommands(client)) {
        void syncAllGuilds(client).catch((error: unknown) =>
          console.error(
            `📜 [CommandSyncService] Sync failed: ${utilities.errorMessage(error)}`,
          ),
        );
        client.on(Events.GuildCreate, (guild: Guild) => {
          const commands = getLoadedCommands(client);
          if (!commands) return;
          void loadGuildHashes().then((guildHashes) =>
            syncGuild(client, guild, commands, guildHashes),
          );
        });
        return;
      }

      polls++;
      if (polls >= MAX_READY_POLLS) {
        console.error(
          "📜 [CommandSyncService] Gave up waiting for client readiness — commands not registered this boot",
        );
        return;
      }
      const timer = setTimeout(attempt, READY_POLL_MILLISECONDS);
      timer.unref?.();
    };
    attempt();
  },

  /** Test/maintenance hook — allows startCommandSync to run again. */
  resetForTesting(): void {
    started = false;
  },
};

export default CommandSyncService;
