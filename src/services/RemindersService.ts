// ============================================================
// Reminders — "remind me in 2 hours to …", kept in Mongo
// ============================================================
// The agent's schedule/list/cancel_discord_reminder tools land here via
// tools-service → GuildRoutes. A reminder always belongs to the person
// who asked (`requesterUserId`) and fires in the channel the
// conversation happened in, pinging only them.
//
// Delivery (RemindersJob, every 30 s) claims one due reminder at a time
// with an atomic findOneAndUpdate, so overlapping ticks never send the
// same reminder twice. Reminders are in Mongo, so a restart loses
// nothing: whatever fell due while Lupos was down goes out on the first
// tick, marked late. A claim whose delivery never finished (the process
// died mid-send) expires after REMINDER_CLAIM_TTL_MS and is retried.
// ============================================================

import { randomBytes, randomUUID } from "node:crypto";
import { PermissionFlagsBits } from "discord.js";
import type { Client, GuildTextBasedChannel } from "discord.js";
import type { Collection } from "mongodb";
import MongoService from "#root/services/MongoService.ts";
import {
  ActionError,
  assertBotCan,
  assertClean,
  assertRequesterCan,
  assertScope,
  readSnowflake,
  readText,
  resolveActionContext,
  resolveBotMember,
  sendPermissionFor,
} from "#root/services/discord/AgentActionGuards.ts";
import type { ActionBody } from "#root/services/discord/AgentActionGuards.ts";
import {
  REMINDERS_COLLECTION,
  REMINDER_CLAIM_TTL_MS,
  REMINDER_DELAY_MINUTES_MAX,
  REMINDER_DELAY_MINUTES_MIN,
  REMINDER_DELIVERIES_PER_TICK,
  REMINDER_LATE_AFTER_MS,
  REMINDER_MAX_DELIVERY_ATTEMPTS,
  REMINDER_MAX_PENDING_PER_GUILD,
  REMINDER_MAX_PENDING_PER_USER,
  REMINDER_TEXT_MAX_LENGTH,
} from "#root/constants/DiscordActionConstants.ts";

export type ReminderStatus = "pending" | "sent" | "cancelled" | "failed";

export interface ReminderDocument {
  id: string;
  guildId: string;
  channelId: string;
  /** The requester — the only person a reminder ever pings. */
  userId: string;
  text: string;
  dueAt: Date;
  createdAt: Date;
  status: ReminderStatus;
  sentAt: Date | null;
  cancelledAt: Date | null;
  failedAt: Date | null;
  /** Set while a delivery tick owns the reminder. */
  claimedAt: Date | null;
  claimToken: string | null;
  attempts: number;
  lastError: string | null;
}

/** What the agent sees of a reminder. */
export interface PublicReminder {
  id: string;
  dueAt: string;
  text: string;
  channelId: string;
}

export interface DeliverySummary {
  sent: number;
  failed: number;
  retrying: number;
}

const MINUTE_MS = 60_000;
const MAX_AHEAD_MS = REMINDER_DELAY_MINUTES_MAX * MINUTE_MS;
/** ISO 8601 date-time WITH an offset — the bot runs in America/Los_Angeles,
 * so an offset-less time would silently mean Pacific. */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

// ─── Collection ───────────────────────────────────────────────────────

let indexesEnsured = false;

function collection(): Collection<ReminderDocument> {
  const reminders = MongoService.getDb("local").collection<ReminderDocument>(
    REMINDERS_COLLECTION,
  );
  if (!indexesEnsured) {
    indexesEnsured = true;
    ensureIndexes(reminders).catch((error: unknown) =>
      console.error("Failed to ensure Reminders indexes:", error),
    );
  }
  return reminders;
}

/**
 * `id` is unique only where it exists: the collection name was used by a
 * long-retired reminders job whose documents have no `id`.
 */
async function ensureIndexes(
  reminders: Collection<ReminderDocument>,
): Promise<void> {
  await reminders.createIndex(
    { id: 1 },
    { unique: true, partialFilterExpression: { id: { $type: "string" } } },
  );
  await reminders.createIndex({ status: 1, dueAt: 1 });
  await reminders.createIndex({ guildId: 1, status: 1, userId: 1 });
}

/** Test hook: the next collection() call re-ensures indexes. */
export function resetRemindersIndexState(): void {
  indexesEnsured = false;
}

export function toPublicReminder(reminder: ReminderDocument): PublicReminder {
  return {
    id: reminder.id,
    dueAt: reminder.dueAt.toISOString(),
    text: reminder.text,
    channelId: reminder.channelId,
  };
}

// ─── Per-guild lock (keeps the pending caps exact) ─────────────────────

const guildLocks = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for `guildId` has settled. */
async function withGuildLock<Result>(
  guildId: string,
  task: () => Promise<Result>,
): Promise<Result> {
  const previous = guildLocks.get(guildId) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.catch(() => undefined);
  guildLocks.set(guildId, settled);
  try {
    return await run;
  } finally {
    if (guildLocks.get(guildId) === settled) guildLocks.delete(guildId);
  }
}

// ─── Schedule ─────────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** `delayMinutes` (1–43200) OR `dueAt` (ISO 8601, 1 min–30 days ahead). */
export function readDueAt(body: ActionBody, nowMs: number): Date {
  const hasDelay = isPresent(body.delayMinutes);
  const hasDueAt = isPresent(body.dueAt);
  if (hasDelay && hasDueAt) {
    throw new ActionError(400, "Give either delayMinutes or dueAt, not both.");
  }
  if (!hasDelay && !hasDueAt) {
    throw new ActionError(
      400,
      `Give delayMinutes (${REMINDER_DELAY_MINUTES_MIN}–${REMINDER_DELAY_MINUTES_MAX}) or dueAt (an ISO 8601 time 1 minute to 30 days ahead).`,
    );
  }

  if (hasDelay) {
    const minutes =
      typeof body.delayMinutes === "number" ||
      typeof body.delayMinutes === "string"
        ? Number(body.delayMinutes)
        : NaN;
    if (
      !Number.isFinite(minutes) ||
      minutes < REMINDER_DELAY_MINUTES_MIN ||
      minutes > REMINDER_DELAY_MINUTES_MAX
    ) {
      throw new ActionError(
        400,
        `delayMinutes must be between ${REMINDER_DELAY_MINUTES_MIN} and ${REMINDER_DELAY_MINUTES_MAX} (30 days).`,
      );
    }
    return new Date(nowMs + Math.round(minutes * MINUTE_MS));
  }

  const raw = body.dueAt;
  const dueAtMs =
    typeof raw === "string" && ISO_WITH_OFFSET.test(raw.trim())
      ? Date.parse(raw.trim())
      : NaN;
  if (Number.isNaN(dueAtMs)) {
    throw new ActionError(
      400,
      "dueAt must be an ISO 8601 time with a timezone offset, e.g. 2026-09-23T17:00:00Z or 2026-09-23T10:00:00-07:00.",
    );
  }
  const aheadMs = dueAtMs - nowMs;
  if (aheadMs < MINUTE_MS) {
    throw new ActionError(
      400,
      `dueAt must be at least 1 minute from now (now is ${new Date(nowMs).toISOString()}).`,
    );
  }
  if (aheadMs > MAX_AHEAD_MS) {
    throw new ActionError(400, "dueAt can be at most 30 days from now.");
  }
  return new Date(dueAtMs);
}

function newReminderId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Schedules a reminder for the requester in the conversation's channel.
 * Both of them must be able to post there; ≤5 pending per user per
 * guild and ≤100 per guild.
 */
export async function createReminder(
  client: Client,
  body: ActionBody,
  nowMs = Date.now(),
): Promise<{ reminder: PublicReminder }> {
  const text = readText(body.text, "text", REMINDER_TEXT_MAX_LENGTH);
  const dueAt = readDueAt(body, nowMs);

  const { guild, channel, requester } = await resolveActionContext(client, body);
  assertRequesterCan(channel, requester, [], "set reminders");
  const bot = await resolveBotMember(guild);
  assertBotCan(
    channel,
    bot,
    [PermissionFlagsBits.ViewChannel, sendPermissionFor(channel)],
    "post reminders",
  );
  assertClean([text]);

  const reminders = collection();
  return withGuildLock(guild.id, async () => {
    const [userPending, guildPending] = await Promise.all([
      reminders.countDocuments({
        guildId: guild.id,
        userId: requester.id,
        status: "pending",
      }),
      reminders.countDocuments({ guildId: guild.id, status: "pending" }),
    ]);
    if (userPending >= REMINDER_MAX_PENDING_PER_USER) {
      throw new ActionError(
        429,
        `You already have ${REMINDER_MAX_PENDING_PER_USER} reminders pending in this server — cancel one or wait for one to go off.`,
      );
    }
    if (guildPending >= REMINDER_MAX_PENDING_PER_GUILD) {
      throw new ActionError(
        429,
        `This server already has ${REMINDER_MAX_PENDING_PER_GUILD} reminders pending — try again after some go off.`,
      );
    }

    const document: ReminderDocument = {
      id: newReminderId(),
      guildId: guild.id,
      channelId: channel.id,
      userId: requester.id,
      text,
      dueAt,
      createdAt: new Date(nowMs),
      status: "pending",
      sentAt: null,
      cancelledAt: null,
      failedAt: null,
      claimedAt: null,
      claimToken: null,
      attempts: 0,
      lastError: null,
    };
    // Eight hex chars collide rarely; the unique index catches it.
    for (let attempt = 0; ; attempt++) {
      try {
        await reminders.insertOne({ ...document });
        break;
      } catch (error: unknown) {
        if ((error as { code?: number }).code !== 11000 || attempt >= 2) {
          throw error;
        }
        document.id = newReminderId();
      }
    }
    console.log(
      `⏰ [RemindersService] Reminder ${document.id} set for ${requester.user.username} in #${channel.name}, due ${dueAt.toISOString()}`,
    );
    return { reminder: toPublicReminder(document) };
  });
}

/** Resolves `guildId` (defaulting to `scopeGuildId`) and the requester. */
function readOwner(body: ActionBody): { guildId: string; userId: string } {
  const guildId = readSnowflake(body.guildId ?? body.scopeGuildId, "guildId");
  assertScope(guildId, body.scopeGuildId);
  const userId = readSnowflake(body.requesterUserId, "requesterUserId");
  return { guildId, userId };
}

/** The requester's pending reminders in this guild, soonest first. */
export async function listReminders(
  body: ActionBody,
): Promise<{ reminders: PublicReminder[] }> {
  const { guildId, userId } = readOwner(body);
  const pending = await collection()
    .find({ guildId, userId, status: "pending" })
    .sort({ dueAt: 1 })
    .limit(REMINDER_MAX_PENDING_PER_GUILD)
    .toArray();
  return { reminders: pending.map(toPublicReminder) };
}

const FINISHED_PHRASES: Record<ReminderStatus, string> = {
  pending: "is still pending",
  sent: "already went off",
  cancelled: "was already cancelled",
  failed: "already failed to deliver",
};

/** Cancels one of the requester's own pending reminders. */
export async function cancelReminder(
  body: ActionBody,
  nowMs = Date.now(),
): Promise<{ reminder: PublicReminder & { status: ReminderStatus } }> {
  const { guildId, userId } = readOwner(body);
  const reminderId = readText(body.reminderId, "reminderId", 64);

  const reminders = collection();
  const cancelled = await reminders.findOneAndUpdate(
    { id: reminderId, guildId, userId, status: "pending" },
    { $set: { status: "cancelled", cancelledAt: new Date(nowMs) } },
    { returnDocument: "after" },
  );
  if (!cancelled) {
    // Only the requester's own reminders are ever described — someone
    // else's id reads exactly like one that does not exist.
    const own = await reminders.findOne({ id: reminderId, guildId, userId });
    if (own) {
      throw new ActionError(409, `That reminder ${FINISHED_PHRASES[own.status]}.`);
    }
    throw new ActionError(
      404,
      "You have no reminder with that id in this server — list your reminders to see their ids.",
    );
  }
  console.log(
    `⏰ [RemindersService] Reminder ${cancelled.id} cancelled by its owner ${userId}`,
  );
  return { reminder: { ...toPublicReminder(cancelled), status: "cancelled" } };
}

// ─── Delivery ─────────────────────────────────────────────────────────

/**
 * `⏰ <@user> text` — with a late note when it went out well after its
 * time (the bot was down, or Discord was failing).
 */
export function formatReminderMessage(
  reminder: Pick<ReminderDocument, "userId" | "text" | "dueAt">,
  nowMs: number,
): string {
  const message = `⏰ <@${reminder.userId}> ${reminder.text}`;
  if (nowMs - reminder.dueAt.getTime() <= REMINDER_LATE_AFTER_MS) {
    return message;
  }
  const dueUnixSeconds = Math.floor(reminder.dueAt.getTime() / 1000);
  return `${message}\n-# Sorry, this is late — it was due <t:${dueUnixSeconds}:R>.`;
}

/**
 * Atomically takes the most overdue unclaimed reminder (or a stale
 * claim), skipping `excludeIds` (already tried this tick).
 */
async function claimNextDue(
  nowMs: number,
  excludeIds: readonly string[],
): Promise<ReminderDocument | null> {
  return collection().findOneAndUpdate(
    {
      status: "pending",
      dueAt: { $lte: new Date(nowMs) },
      ...(excludeIds.length > 0 ? { id: { $nin: [...excludeIds] } } : {}),
      $or: [
        { claimedAt: null },
        { claimedAt: { $lt: new Date(nowMs - REMINDER_CLAIM_TTL_MS) } },
      ],
    },
    { $set: { claimedAt: new Date(nowMs), claimToken: randomUUID() } },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  );
}

// Discord answers that retrying cannot fix: unknown channel/guild, no
// access, no permission.
const PERMANENT_SEND_CODES = new Set([10003, 10004, 50001, 50013]);

function isPermanentSendError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const status = (error as { status?: unknown })?.status;
  return (
    (typeof code === "number" && PERMANENT_SEND_CODES.has(code)) ||
    status === 403 ||
    status === 404
  );
}

async function markFailed(
  reminder: ReminderDocument,
  reason: string,
  nowMs: number,
): Promise<"failed"> {
  await collection().updateOne(
    { id: reminder.id, claimToken: reminder.claimToken },
    {
      $set: {
        status: "failed",
        failedAt: new Date(nowMs),
        lastError: reason,
        claimedAt: null,
        claimToken: null,
      },
      $inc: { attempts: 1 },
    },
  );
  console.warn(
    `⏰ [RemindersService] Reminder ${reminder.id} failed: ${reason}`,
  );
  return "failed";
}

async function resolveDeliveryChannel(
  client: Client,
  reminder: ReminderDocument,
): Promise<GuildTextBasedChannel | string> {
  const guild = client.guilds.cache.get(reminder.guildId);
  if (!guild) return "Lupos is no longer in that server.";
  const channel =
    guild.channels.cache.get(reminder.channelId) ??
    (await guild.channels.fetch(reminder.channelId).catch(() => null));
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    return "The channel no longer exists.";
  }
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (
    !permissions?.has([
      PermissionFlagsBits.ViewChannel,
      sendPermissionFor(channel),
    ])
  ) {
    return "Lupos can no longer post in that channel.";
  }
  return channel;
}

async function deliverReminder(
  client: Client,
  reminder: ReminderDocument,
  nowMs: number,
): Promise<keyof DeliverySummary> {
  const target = await resolveDeliveryChannel(client, reminder);
  if (typeof target === "string") return markFailed(reminder, target, nowMs);

  try {
    await target.send({
      content: formatReminderMessage(reminder, nowMs),
      allowedMentions: { users: [reminder.userId] },
    });
  } catch (error: unknown) {
    const reason = (error as Error)?.message ?? String(error);
    const attempts = (reminder.attempts ?? 0) + 1;
    if (isPermanentSendError(error) || attempts >= REMINDER_MAX_DELIVERY_ATTEMPTS) {
      return markFailed(reminder, reason, nowMs);
    }
    // Transient — release the claim; the next tick tries again.
    await collection().updateOne(
      { id: reminder.id, claimToken: reminder.claimToken },
      {
        $set: { claimedAt: null, claimToken: null, lastError: reason },
        $inc: { attempts: 1 },
      },
    );
    console.warn(
      `⏰ [RemindersService] Reminder ${reminder.id} send failed (attempt ${attempts}/${REMINDER_MAX_DELIVERY_ATTEMPTS}), retrying: ${reason}`,
    );
    return "retrying";
  }

  await collection().updateOne(
    { id: reminder.id, claimToken: reminder.claimToken },
    {
      $set: {
        status: "sent",
        sentAt: new Date(nowMs),
        claimedAt: null,
        claimToken: null,
      },
      $inc: { attempts: 1 },
    },
  );
  return "sent";
}

/**
 * Delivers up to REMINDER_DELIVERIES_PER_TICK due reminders, most
 * overdue first. Each is claimed atomically before it is sent, so two
 * overlapping calls never deliver the same reminder.
 */
export async function deliverDueReminders(
  client: Client,
  nowMs = Date.now(),
): Promise<DeliverySummary> {
  const summary: DeliverySummary = { sent: 0, failed: 0, retrying: 0 };
  // A transient failure releases its claim; don't re-take it this tick.
  const retrying: string[] = [];
  for (let index = 0; index < REMINDER_DELIVERIES_PER_TICK; index++) {
    const reminder = await claimNextDue(nowMs, retrying);
    if (!reminder) break;
    const outcome = await deliverReminder(client, reminder, nowMs);
    summary[outcome]++;
    if (outcome === "retrying") retrying.push(reminder.id);
  }
  return summary;
}

const RemindersService = {
  createReminder,
  listReminders,
  cancelReminder,
  deliverDueReminders,
  formatReminderMessage,
  readDueAt,
};

export default RemindersService;
