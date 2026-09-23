// ============================================================
// Agent Action Guards — shared checks for the agent's Discord actions
// ============================================================
// The Lupos agent reaches Discord through tools-service, which forwards
// to lupos-bot's HTTP routes with the TRUSTED context of the turn:
// `guildId`/`channelId` (the conversation), `requesterUserId` (whoever
// Lupos is answering) and `scopeGuildId` (the conversation's guild,
// from a header the model cannot touch). Every action route runs the
// same gauntlet before touching Discord:
//
//   inputs valid (400) → inside the conversation's guild (403) →
//   guild/channel exist (404) → the requester is a member who can view
//   and send there, plus the action's own permission (403) → Lupos has
//   the permissions too (403) → text passes the slur filter (400) →
//   the action's cooldown is free (429)
//
// Failures throw ActionError; runAgentAction turns them (and Discord
// API errors) into `{ ok: false, error }` with a status, where `error`
// is written for the model to relay to the user.
// ============================================================

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type {
  Client,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
} from "discord.js";
import CensorService from "#root/services/CensorService.ts";
import { DISCORD_SNOWFLAKE_PATTERN } from "#root/constants/DiscordActionConstants.ts";

/** The contract's wording for a guild outside the conversation. */
export const SCOPE_ERROR =
  "Lupos can only reach into the server this conversation is in.";

export class ActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ActionError";
    this.status = status;
  }
}

export type ActionBody = Record<string, unknown>;

export interface ActionResponse {
  status: number;
  body: Record<string, unknown>;
}

// ─── Input readers ────────────────────────────────────────────────────

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value);
}

/** A required Discord id field; 400 when missing or malformed. */
export function readSnowflake(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") {
    throw new ActionError(400, `${field} is required.`);
  }
  if (!isSnowflake(value)) {
    throw new ActionError(400, `${field} must be a Discord id.`);
  }
  return value;
}

/** An optional Discord id field; undefined when absent. */
export function readOptionalSnowflake(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return readSnowflake(value, field);
}

/** A required, trimmed, non-empty string of at most `maxLength` chars. */
export function readText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ActionError(400, `${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ActionError(
      400,
      `${field} is too long (${text.length} characters, the limit is ${maxLength}).`,
    );
  }
  return text;
}

// ─── Scope ────────────────────────────────────────────────────────────

/**
 * The conversation's guild (`scopeGuildId`, from tools-service's
 * trusted header) bounds every action: a different `guildId` is refused.
 * No `scopeGuildId` = a caller outside a Discord conversation; the
 * route's own rules decide what that caller may do.
 */
export function assertScope(guildId: string, scopeGuildId: unknown): void {
  if (scopeGuildId === undefined || scopeGuildId === null || scopeGuildId === "") {
    return;
  }
  if (String(scopeGuildId) !== guildId) {
    throw new ActionError(403, SCOPE_ERROR);
  }
}

// ─── Lookups ──────────────────────────────────────────────────────────

export function resolveGuild(client: Client, guildId: string): Guild {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new ActionError(404, "Lupos isn't in that server.");
  return guild;
}

/** A text channel (or thread) of `guild` that messages can be sent to. */
export async function resolveTextChannel(
  guild: Guild,
  channelId: string,
): Promise<GuildTextBasedChannel> {
  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || channel.guildId !== guild.id) {
    throw new ActionError(404, "That channel isn't in this server.");
  }
  if (!channel.isTextBased() || !channel.isSendable()) {
    throw new ActionError(400, "That channel doesn't take messages.");
  }
  return channel;
}

export async function fetchMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  return (
    guild.members.cache.get(userId) ??
    (await guild.members.fetch(userId).catch(() => null))
  );
}

/** The requester, who must be a member of the guild and not timed out. */
export async function resolveRequester(
  guild: Guild,
  requesterUserId: string,
): Promise<GuildMember> {
  const member = await fetchMember(guild, requesterUserId);
  if (!member) {
    throw new ActionError(
      403,
      "Only members of this server can ask Lupos to do that.",
    );
  }
  if (member.isCommunicationDisabled()) {
    throw new ActionError(
      403,
      "You're timed out in this server, so Lupos won't do that for you right now.",
    );
  }
  return member;
}

export async function resolveBotMember(guild: Guild): Promise<GuildMember> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) throw new ActionError(503, "Lupos can't find himself in this server.");
  return me;
}

// ─── Permissions ──────────────────────────────────────────────────────

/** Posting in a thread is its own permission. */
export function sendPermissionFor(channel: GuildTextBasedChannel): bigint {
  return channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
}

/** "SendPolls" → "Send Polls", for error messages. */
function permissionLabel(flag: bigint): string {
  const [name] = new PermissionsBitField(flag).toArray();
  return (name ?? "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Human names of the flags `permissions` lacks (all of them when null). */
export function missingPermissionLabels(
  permissions: Readonly<PermissionsBitField> | null | undefined,
  flags: readonly bigint[],
): string[] {
  return flags
    .filter((flag) => !permissions?.has(flag))
    .map((flag) => permissionLabel(flag));
}

function channelLabel(channel: GuildTextBasedChannel): string {
  return `#${channel.name}`;
}

/**
 * The requester must be able to view and send in the channel, plus
 * `extraFlags` (the action's own permission) — Lupos never does for
 * someone what they could not do themselves.
 */
export function assertRequesterCan(
  channel: GuildTextBasedChannel,
  requester: GuildMember,
  extraFlags: readonly bigint[],
  doing: string,
): void {
  const missing = missingPermissionLabels(channel.permissionsFor(requester), [
    PermissionFlagsBits.ViewChannel,
    sendPermissionFor(channel),
    ...extraFlags,
  ]);
  if (missing.length > 0) {
    throw new ActionError(
      403,
      `You don't have permission to ${doing} in ${channelLabel(channel)} (missing: ${missing.join(", ")}).`,
    );
  }
}

export function assertBotCan(
  channel: GuildTextBasedChannel,
  bot: GuildMember,
  flags: readonly bigint[],
  doing: string,
): void {
  const missing = missingPermissionLabels(channel.permissionsFor(bot), flags);
  if (missing.length > 0) {
    throw new ActionError(
      403,
      `Lupos doesn't have permission to ${doing} in ${channelLabel(channel)} (missing: ${missing.join(", ")}).`,
    );
  }
}

// ─── Content ──────────────────────────────────────────────────────────

/** Anything Lupos posts passes the same slur filter as his replies. */
export function assertClean(texts: readonly string[]): void {
  if (texts.some((text) => CensorService.containsFlaggedWords(text))) {
    throw new ActionError(
      400,
      "That contains language Lupos won't post. Rephrase it without the slur.",
    );
  }
}

// ─── Shared context for the conversation-bound actions ────────────────

export interface ActionContext {
  guild: Guild;
  channel: GuildTextBasedChannel;
  requester: GuildMember;
}

/**
 * Resolves the conversation an action runs in: `guildId` (defaulting to
 * `scopeGuildId`), `channelId` and `requesterUserId` are all required —
 * these actions only exist inside a Discord conversation with Lupos.
 */
export async function resolveActionContext(
  client: Client,
  body: ActionBody,
): Promise<ActionContext> {
  const guildId = readSnowflake(body.guildId ?? body.scopeGuildId, "guildId");
  assertScope(guildId, body.scopeGuildId);
  const channelId = readSnowflake(body.channelId, "channelId");
  const requesterUserId = readSnowflake(body.requesterUserId, "requesterUserId");

  const guild = resolveGuild(client, guildId);
  const channel = await resolveTextChannel(guild, channelId);
  const requester = await resolveRequester(guild, requesterUserId);
  return { guild, channel, requester };
}

/** Audit-log reason naming who asked, for actions Lupos takes on request. */
export function auditReason(requester: GuildMember): string {
  return `Requested by ${requester.user.username} (${requester.id}) via Lupos`;
}

// ─── Cooldowns (in-memory) ────────────────────────────────────────────

/**
 * One action per key per window. `tryClaim` reserves the key before the
 * Discord call (JS is single-threaded, so check-and-set is atomic);
 * `release` hands it back when the call failed, so only actions that
 * happened count.
 */
export class CooldownWindow {
  #windowMs: number;
  #claimedAt = new Map<string, number>();

  constructor(windowMs: number) {
    this.#windowMs = windowMs;
  }

  remainingMs(key: string, now = Date.now()): number {
    const claimedAt = this.#claimedAt.get(key);
    if (claimedAt === undefined) return 0;
    return Math.max(0, claimedAt + this.#windowMs - now);
  }

  /** The claim's timestamp (pass it to `release`), or null while cooling down. */
  tryClaim(key: string, now = Date.now()): number | null {
    if (this.remainingMs(key, now) > 0) return null;
    this.#prune(now);
    this.#claimedAt.set(key, now);
    return now;
  }

  release(key: string, claimedAt: number): void {
    if (this.#claimedAt.get(key) === claimedAt) this.#claimedAt.delete(key);
  }

  reset(): void {
    this.#claimedAt.clear();
  }

  #prune(now: number): void {
    for (const [key, claimedAt] of this.#claimedAt) {
      if (claimedAt + this.#windowMs <= now) this.#claimedAt.delete(key);
    }
  }
}

export function formatWait(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes <= 1) return "about a minute";
  return `${minutes} minutes`;
}

/**
 * Runs `action` under `window`'s key: 429 while cooling down, the claim
 * released again if the action throws.
 */
export async function withCooldown<Result>(
  window: CooldownWindow,
  key: string,
  refusal: (wait: string) => string,
  action: () => Promise<Result>,
): Promise<Result> {
  const claimedAt = window.tryClaim(key);
  if (claimedAt === null) {
    throw new ActionError(429, refusal(formatWait(window.remainingMs(key))));
  }
  try {
    return await action();
  } catch (error: unknown) {
    window.release(key, claimedAt);
    throw error;
  }
}

// ─── Error mapping ────────────────────────────────────────────────────

// Discord JSON error codes the actions can hit (discord-api-types
// RESTJSONErrorCodes); matched structurally, as DmCampaignService does.
const DISCORD_UNKNOWN_CHANNEL = 10003;
const DISCORD_UNKNOWN_MESSAGE = 10008;
const DISCORD_MISSING_ACCESS = 50001;
const DISCORD_MISSING_PERMISSIONS = 50013;
const DISCORD_INVALID_FORM_BODY = 50035;
const DISCORD_THREAD_ALREADY_CREATED = 160004;

/** The first line of a Discord error message (the rest is field detail). */
function discordReason(error: unknown): string {
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.split("\n")[0] : "unknown error";
}

/**
 * A Discord REST error (DiscordAPIError carries the HTTP `status` and the
 * JSON `code`) as a route response; null for anything else — a Mongo
 * error's numeric `code` alone is not Discord's.
 */
export function mapDiscordError(error: unknown): ActionResponse | null {
  const code = (error as { code?: unknown })?.code;
  const httpStatus = (error as { status?: unknown })?.status;
  if (typeof httpStatus !== "number") return null;

  const refuse = (status: number, message: string): ActionResponse => ({
    status,
    body: { ok: false, error: message },
  });
  switch (code) {
    case DISCORD_MISSING_PERMISSIONS:
    case DISCORD_MISSING_ACCESS:
      return refuse(403, "Discord refused: Lupos is missing a permission for that here.");
    case DISCORD_UNKNOWN_CHANNEL:
      return refuse(404, "That channel no longer exists.");
    case DISCORD_UNKNOWN_MESSAGE:
      return refuse(404, "That message no longer exists.");
    case DISCORD_THREAD_ALREADY_CREATED:
      return refuse(409, "That message already has a thread.");
    case DISCORD_INVALID_FORM_BODY:
      return refuse(400, `Discord rejected that: ${discordReason(error)}`);
  }
  if (httpStatus === 429) {
    return refuse(429, "Discord is rate limiting Lupos — try again in a minute.");
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return refuse(400, `Discord rejected that: ${discordReason(error)}`);
  }
  return refuse(502, "Discord had a problem with that — try again shortly.");
}

/**
 * Runs an action for a route: its result becomes `{ ok: true, ...result }`
 * (200), an ActionError or Discord API error becomes `{ ok: false, error }`
 * with a 4xx, and anything else a logged 500.
 */
export async function runAgentAction(
  label: string,
  action: () => Promise<Record<string, unknown>>,
): Promise<ActionResponse> {
  try {
    const result = await action();
    return { status: 200, body: { ok: true, ...result } };
  } catch (error: unknown) {
    if (error instanceof ActionError) {
      return { status: error.status, body: { ok: false, error: error.message } };
    }
    const mapped = mapDiscordError(error);
    console.error(`[${label}] Error:`, (error as Error)?.message ?? error);
    return (
      mapped ?? {
        status: 500,
        body: { ok: false, error: "Something went wrong on Lupos's side." },
      }
    );
  }
}
