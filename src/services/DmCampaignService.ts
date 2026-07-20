// ============================================================
// DmCampaignService — manual invite-DM campaign
// ============================================================
// Slowly DMs every member of a source guild (Crusader Strike) who
// is NOT also in the exclude guild (Whitemane) with an invite to
// join Whitemane. Built to never trip Discord's mass-DM anti-spam:
//   - one DM per DM_DELAY_BASE_MS + jitter, hard daily cap,
//   - message copy varies per user (identical rapid-fire DMs are
//     the strongest spam signal),
//   - auto-pause on error 40003 ("opening DMs too fast"), REST 429
//     storms, or MAX_CONSECUTIVE_FAILURES unknown errors.
//
// Everything is manually triggered over HTTP (see GuildRoutes):
//   POST /guild/dm-campaign/seed   — compute source − exclude, write
//                                    pending target rows, send NOTHING
//   POST /guild/dm-campaign/start  — begin/resume the paced sender
//   POST /guild/dm-campaign/pause  — kill switch
//   GET  /guild/dm-campaign/status — progress counts + ETA
//
// Crash safety: every target is a row in lupos.DmCampaignTargets
// (status pending → sending → sent/dms_closed/failed/...). A row is
// marked "sending" before the DM and "sent" right after, so a crash
// leaves at most ONE ambiguous row — start() retires it as
// "skipped_ambiguous" rather than risk double-DMing. The worker does
// NOT auto-start on boot; after a restart, hitting start again
// resumes exactly where it left off.

import type { Client, Guild, GuildMember } from "discord.js";

import DiscordWrapper from "#root/wrappers/DiscordWrapper.ts";
import MongoService from "#root/services/MongoService.ts";
import config from "#root/config.ts";
import utilities from "#root/utilities.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";
import { fetchMembersWithRetry } from "#root/services/discord/ModerationSweeps.ts";

export const CAMPAIGN_ID = "crusader-strike-to-whitemane";

export const DAILY_CAP = 500;
export const DM_DELAY_BASE_MS = 60_000;
export const DM_DELAY_JITTER_MS = 30_000;
export const MAX_CONSECUTIVE_FAILURES = 5;
// Accounts younger than this are skipped — throwaway/spam accounts are
// disproportionately likely to report the DM, and a real Classic player
// invited to a Classic+ server almost certainly has an older account.
export const MIN_ACCOUNT_AGE_MS = 365 * 24 * 60 * 60 * 1000;
// A target that never reached member.send (left guild, ignore list)
// doesn't touch the DM budget — advance quickly.
const NO_SEND_DELAY_MS = 5_000;
// When the daily cap is hit, poll for the UTC day rollover this often.
const CAP_RECHECK_DELAY_MS = 15 * 60_000;
const CLIENT_NOT_READY_DELAY_MS = 30_000;

const ERROR_CODE_DMS_CLOSED = 50007;
const ERROR_CODE_OPENING_DMS_TOO_FAST = 40003;

export const DEFAULT_INVITE_URL = "https://discord.gg/classicwhitemane";

// {name} → member display name, {invite} → invite URL. Variant picked
// deterministically per user so a retry never switches copy mid-user.
export const DEFAULT_MESSAGE_VARIANTS: string[] = [
  "Hey {name}! Lupos here — the bot from the Classic Crusader Strike (+ Lone Wolf) Discord. Classic+ is dropping soon, and everyone's getting ready over at **Classic+ Whitemane** — guild planning, class discussion, and launch prep: {invite}\n\nMost of the crowd hangs out in the #politics channel these days, so pop in there and say hi. This is a one-time message; you won't hear from me again.",
  "Hey {name}, it's Lupos from the Classic Crusader Strike (+ Lone Wolf) server. With Classic+ launching in a couple of months, the community is gathering at **Classic+ Whitemane** to get ready — leveling routes, professions, guild rosters, all of it: {invite}\n\nRight now most people hang out in the #politics channel, so that's the place to say hi. Would be great to have you in before day one. Either way, this is the only DM you'll get from me.",
  "{name} — Lupos here, from Classic Crusader Strike (+ Lone Wolf). Classic+ is almost here, and the prep is happening at **Classic+ Whitemane**: launch-day plans, guild recruitment, and plenty of theorycrafting: {invite}\n\nThe busiest spot at the moment is the #politics channel — head there first. Jump in so you're set when it drops. No more DMs after this one, promise.",
];

export type DmTargetStatus =
  | "pending"
  | "sending"
  | "sent"
  | "dms_closed"
  | "left_guild"
  | "failed"
  | "skipped_ambiguous"
  | "skipped_ignored"
  | "skipped_young_account";

export type DmCampaignStatus = "seeded" | "running" | "paused" | "done";

interface DmCampaignDocument {
  _id: string;
  sourceGuildId: string;
  excludeGuildId: string;
  status: DmCampaignStatus;
  inviteUrl: string;
  messageVariants: string[];
  seededAt: Date;
  startedAt: Date | null;
  pausedReason: string | null;
  daily: { date: string; sent: number };
  totalSent: number;
}

interface DmTargetDocument {
  _id: string; // `${campaignId}:${userId}`
  campaignId: string;
  userId: string;
  username: string;
  status: DmTargetStatus;
  error: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}

// ─── Pure helpers (exported for unit tests) ────────────────────

/** Deterministic variant pick — same user always gets the same copy. */
export function pickMessageVariant(
  userId: string,
  variants: string[],
): string {
  if (variants.length === 0) return "";
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return variants[hash % variants.length];
}

export function renderMessage(
  template: string,
  displayName: string,
  inviteUrl: string,
): string {
  return template
    .replaceAll("{name}", displayName)
    .replaceAll("{invite}", inviteUrl);
}

/** Spacing between DMs: base plus 0..jitter, driven by a [0,1) random. */
export function computeNextDelayMs(random: number): number {
  return DM_DELAY_BASE_MS + Math.floor(random * DM_DELAY_JITTER_MS);
}

export function utcDateString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

const DISCORD_EPOCH_MS = 1_420_070_400_000;

/** Account creation time from the snowflake — no API call needed. */
export function accountCreatedAtMs(userId: string): number {
  return Number(BigInt(userId) >> 22n) + DISCORD_EPOCH_MS;
}

export function isAccountTooYoung(userId: string, nowMs: number): boolean {
  return nowMs - accountCreatedAtMs(userId) < MIN_ACCOUNT_AGE_MS;
}

export interface DailyBudgetDecision {
  allowed: boolean;
  /** Daily counter to persist — resets when the UTC day rolled over. */
  daily: { date: string; sent: number };
}

export function evaluateDailyBudget(
  daily: { date: string; sent: number } | undefined,
  nowMs: number,
  cap: number,
): DailyBudgetDecision {
  const today = utcDateString(nowMs);
  const current =
    daily && daily.date === today ? daily : { date: today, sent: 0 };
  return { allowed: current.sent < cap, daily: current };
}

export interface SendErrorClassification {
  targetStatus: DmTargetStatus;
  /** Non-null → the whole campaign should pause with this reason. */
  pauseReason: string | null;
  /** Counts toward the consecutive-unknown-failure breaker. */
  countsAsFailure: boolean;
}

export function classifySendError(error: unknown): SendErrorClassification {
  const code = (error as { code?: number }).code;
  const httpStatus = (error as { status?: number }).status;
  if (code === ERROR_CODE_DMS_CLOSED) {
    return {
      targetStatus: "dms_closed",
      pauseReason: null,
      countsAsFailure: false,
    };
  }
  if (code === ERROR_CODE_OPENING_DMS_TOO_FAST) {
    // Discord's anti-spam tripwire — stop immediately, target stays
    // pending so it is retried after a manual restart.
    return {
      targetStatus: "pending",
      pauseReason: "Discord anti-spam triggered (40003: opening DMs too fast)",
      countsAsFailure: false,
    };
  }
  if (httpStatus === 429) {
    // discord.js retries REST 429s internally (retries: 3); one
    // surfacing here means we are being throttled hard.
    return {
      targetStatus: "pending",
      pauseReason: "Rate limited (HTTP 429 surfaced past REST retries)",
      countsAsFailure: false,
    };
  }
  return { targetStatus: "failed", pauseReason: null, countsAsFailure: true };
}

// ─── Mongo access ──────────────────────────────────────────────

function getDb() {
  const client = MongoService.getClient("local");
  if (!client) throw new Error("Mongo client 'local' not initialized");
  return client.db(MONGO_DB_NAME);
}

function campaignsCollection() {
  return getDb().collection<DmCampaignDocument>("DmCampaigns");
}

let targetsIndexEnsured = false;

function targetsCollection() {
  const collection = getDb().collection<DmTargetDocument>("DmCampaignTargets");
  if (!targetsIndexEnsured) {
    targetsIndexEnsured = true;
    collection
      .createIndex({ campaignId: 1, status: 1 })
      .catch((err: unknown) =>
        console.error(
          "🐺✉️ [DmCampaignService] Failed to ensure DmCampaignTargets index:",
          utilities.errorMessage(err),
        ),
      );
  }
  return collection;
}

// ─── Seeding ───────────────────────────────────────────────────

function getReadyClient(): Client {
  const client = DiscordWrapper.getClient("lupos");
  if (!client.isReady()) throw new Error("Discord client not ready");
  return client;
}

function resolveGuild(client: Client, guildId: string, label: string): Guild {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error(`${label} guild ${guildId} not in cache`);
  return guild;
}

export interface SeedOptions {
  inviteUrl?: string;
  messageVariants?: string[];
}

/**
 * Campaign-doc upsert for seeding. Pure — exported for unit tests.
 * Mongo rejects any path present in both $set and $setOnInsert, so
 * defaults go in $setOnInsert only when the caller didn't override
 * that field (overrides go in $set and must also apply to an
 * existing doc, e.g. updating the copy after seeding).
 */
export function buildCampaignUpsert(
  options: SeedOptions,
  context: { sourceGuildId: string; excludeGuildId: string; now: Date },
): { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> } {
  const set: Record<string, unknown> = {
    sourceGuildId: context.sourceGuildId,
    excludeGuildId: context.excludeGuildId,
    seededAt: context.now,
  };
  if (options.inviteUrl) set.inviteUrl = options.inviteUrl;
  if (options.messageVariants && options.messageVariants.length > 0) {
    set.messageVariants = options.messageVariants;
  }

  const setOnInsert: Record<string, unknown> = {
    status: "seeded" as DmCampaignStatus,
    startedAt: null,
    pausedReason: null,
    daily: { date: utcDateString(context.now.getTime()), sent: 0 },
    totalSent: 0,
  };
  if (!("inviteUrl" in set)) setOnInsert.inviteUrl = DEFAULT_INVITE_URL;
  if (!("messageVariants" in set)) {
    setOnInsert.messageVariants = DEFAULT_MESSAGE_VARIANTS;
  }
  return { $set: set, $setOnInsert: setOnInsert };
}

/**
 * Compute (source guild members − exclude guild members − bots − ignore
 * list) and upsert one pending row per user. Idempotent: re-seeding
 * only inserts users not already tracked — rows already sent/failed
 * are never reset — so it doubles as the crash-recovery entry point
 * and picks up members who joined since the last seed.
 */
async function seedCampaign(options: SeedOptions = {}) {
  const sourceGuildId = config.GUILD_ID_CRUSADER_STRIKE as string;
  const excludeGuildId = config.GUILD_ID_PRIMARY as string;
  if (!sourceGuildId || !excludeGuildId) {
    throw new Error(
      "GUILD_ID_CRUSADER_STRIKE and GUILD_ID_PRIMARY must be configured",
    );
  }

  const client = getReadyClient();
  const sourceGuild = resolveGuild(client, sourceGuildId, "Source");
  const excludeGuild = resolveGuild(client, excludeGuildId, "Exclude");

  console.log(
    `🐺✉️ [DmCampaignService] Seeding: fetching members of ${sourceGuild.name} and ${excludeGuild.name}...`,
  );
  const sourceMembers = await fetchMembersWithRetry(sourceGuild);
  const excludeMembers = await fetchMembersWithRetry(excludeGuild);

  const ignoreIds = new Set<string>(
    (config.USER_IDS_IGNORE as string[] | undefined) ?? [],
  );

  const now = new Date();
  const operations = [];
  let candidateCount = 0;
  for (const [userId, member] of sourceMembers) {
    if (member.user.bot) continue;
    if (excludeMembers.has(userId)) continue;
    if (ignoreIds.has(userId)) continue;
    if (isAccountTooYoung(userId, now.getTime())) continue;
    candidateCount++;
    operations.push({
      updateOne: {
        filter: { _id: `${CAMPAIGN_ID}:${userId}` },
        update: {
          $setOnInsert: {
            campaignId: CAMPAIGN_ID,
            userId,
            status: "pending" as DmTargetStatus,
            error: null,
            sentAt: null,
          },
          $set: { username: member.user.username, updatedAt: now },
        },
        upsert: true,
      },
    });
  }

  let newlyAdded = 0;
  if (operations.length > 0) {
    const result = await targetsCollection().bulkWrite(operations, {
      ordered: false,
    });
    newlyAdded = result.upsertedCount;
  }

  await campaignsCollection().updateOne(
    { _id: CAMPAIGN_ID },
    buildCampaignUpsert(options, { sourceGuildId, excludeGuildId, now }),
    { upsert: true },
  );

  const status = await getStatus();
  console.log(
    `🐺✉️ [DmCampaignService] Seeded: ${candidateCount} candidates (${newlyAdded} new). Nothing sent — POST /guild/dm-campaign/start to begin.`,
  );
  return { candidateCount, newlyAdded, ...status };
}

// ─── Worker ────────────────────────────────────────────────────

let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerActive = false;
let consecutiveFailures = 0;

function scheduleNext(delayMs: number): void {
  workerTimer = setTimeout(() => {
    void tick();
  }, delayMs);
  workerTimer.unref?.();
}

function stopWorker(): void {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  workerActive = false;
}

async function tick(): Promise<void> {
  let nextDelayMs: number | null;
  try {
    nextDelayMs = await tickOnce();
  } catch (err: unknown) {
    console.error(
      "🐺✉️ [DmCampaignService] Tick error:",
      utilities.errorMessage(err),
    );
    nextDelayMs = CLIENT_NOT_READY_DELAY_MS;
  }
  if (nextDelayMs === null) {
    stopWorker();
    return;
  }
  scheduleNext(nextDelayMs);
}

async function markTarget(
  targetId: string,
  fields: Partial<DmTargetDocument>,
): Promise<void> {
  await targetsCollection().updateOne(
    { _id: targetId },
    { $set: { ...fields, updatedAt: new Date() } },
  );
}

/** One send attempt. Returns the delay until the next tick, or null to stop. */
async function tickOnce(): Promise<number | null> {
  let client: Client;
  try {
    client = getReadyClient();
  } catch {
    return CLIENT_NOT_READY_DELAY_MS;
  }

  const campaign = await campaignsCollection().findOne({ _id: CAMPAIGN_ID });
  if (!campaign || campaign.status !== "running") return null;

  const budget = evaluateDailyBudget(campaign.daily, Date.now(), DAILY_CAP);
  if (budget.daily.date !== campaign.daily?.date) {
    await campaignsCollection().updateOne(
      { _id: CAMPAIGN_ID },
      { $set: { daily: budget.daily } },
    );
  }
  if (!budget.allowed) return CAP_RECHECK_DELAY_MS;

  // Claim the next pending target — "sending" is the crash marker.
  const target = await targetsCollection().findOneAndUpdate(
    { campaignId: CAMPAIGN_ID, status: "pending" },
    { $set: { status: "sending" as DmTargetStatus, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!target) {
    await campaignsCollection().updateOne(
      { _id: CAMPAIGN_ID },
      { $set: { status: "done" as DmCampaignStatus } },
    );
    console.log("🐺✉️ [DmCampaignService] All targets processed — campaign done.");
    return null;
  }

  // Safety net for rows seeded before the age filter existed.
  if (isAccountTooYoung(target.userId, Date.now())) {
    await markTarget(target._id, {
      status: "skipped_young_account",
      error: "account younger than minimum age",
    });
    return NO_SEND_DELAY_MS;
  }

  let guild: Guild;
  try {
    guild = resolveGuild(client, campaign.sourceGuildId, "Source");
  } catch (err: unknown) {
    await markTarget(target._id, {
      status: "pending",
      error: utilities.errorMessage(err),
    });
    return CLIENT_NOT_READY_DELAY_MS;
  }

  const member: GuildMember | null = await guild.members
    .fetch(target.userId)
    .catch(() => null);
  if (!member) {
    await markTarget(target._id, {
      status: "left_guild",
      error: "member no longer in source guild",
    });
    return NO_SEND_DELAY_MS;
  }

  const message = renderMessage(
    pickMessageVariant(target.userId, campaign.messageVariants),
    member.displayName,
    campaign.inviteUrl,
  );

  try {
    await member.send(message);
    await markTarget(target._id, {
      status: "sent",
      sentAt: new Date(),
      error: null,
    });
    await campaignsCollection().updateOne(
      { _id: CAMPAIGN_ID },
      { $inc: { "daily.sent": 1, totalSent: 1 } },
    );
    consecutiveFailures = 0;
    console.log(
      `🐺✉️ [DmCampaignService] DM sent to ${member.user.username} (${budget.daily.sent + 1}/${DAILY_CAP} today)`,
    );
  } catch (err: unknown) {
    const classification = classifySendError(err);
    await markTarget(target._id, {
      status: classification.targetStatus,
      error: utilities.errorMessage(err),
    });
    if (classification.pauseReason) {
      await pauseCampaign(classification.pauseReason);
      console.warn(
        `🐺✉️ [DmCampaignService] Auto-paused: ${classification.pauseReason}`,
      );
      return null;
    }
    if (classification.countsAsFailure) {
      consecutiveFailures++;
      console.warn(
        `🐺✉️ [DmCampaignService] DM to ${target.username} failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive): ${utilities.errorMessage(err)}`,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await pauseCampaign(
          `${MAX_CONSECUTIVE_FAILURES} consecutive send failures`,
        );
        return null;
      }
    }
  }

  return computeNextDelayMs(Math.random());
}

// ─── Control surface ───────────────────────────────────────────

/**
 * Start (or resume after pause/crash/restart). Retires rows stuck in
 * "sending" from a mid-send crash as skipped_ambiguous — at most one
 * per crash — because "maybe already DMed" must never become "DMed
 * twice".
 */
async function startCampaign() {
  const campaign = await campaignsCollection().findOne({ _id: CAMPAIGN_ID });
  if (!campaign) {
    throw new Error("Campaign not seeded — POST /guild/dm-campaign/seed first");
  }
  if (campaign.status === "done") {
    throw new Error("Campaign is already done");
  }

  const ambiguous = await targetsCollection().updateMany(
    { campaignId: CAMPAIGN_ID, status: "sending" },
    {
      $set: {
        status: "skipped_ambiguous" as DmTargetStatus,
        error: "was mid-send during a crash; not retried to avoid double-DM",
        updatedAt: new Date(),
      },
    },
  );
  if (ambiguous.modifiedCount > 0) {
    console.warn(
      `🐺✉️ [DmCampaignService] Retired ${ambiguous.modifiedCount} ambiguous mid-send row(s) from a previous crash`,
    );
  }

  // Retire pending rows for too-young accounts up front so the counts
  // and ETA are honest (the per-tick check would drain them slowly).
  const nowMs = Date.now();
  const pendingRows = await targetsCollection()
    .find(
      { campaignId: CAMPAIGN_ID, status: "pending" },
      { projection: { userId: 1 } },
    )
    .toArray();
  const youngIds = pendingRows
    .filter((row) => isAccountTooYoung(row.userId, nowMs))
    .map((row) => row._id);
  if (youngIds.length > 0) {
    await targetsCollection().updateMany(
      { _id: { $in: youngIds } },
      {
        $set: {
          status: "skipped_young_account" as DmTargetStatus,
          error: "account younger than minimum age",
          updatedAt: new Date(),
        },
      },
    );
    console.log(
      `🐺✉️ [DmCampaignService] Retired ${youngIds.length} pending target(s) with accounts younger than 1 year`,
    );
  }

  await campaignsCollection().updateOne(
    { _id: CAMPAIGN_ID },
    {
      $set: {
        status: "running" as DmCampaignStatus,
        pausedReason: null,
        ...(campaign.startedAt ? {} : { startedAt: new Date() }),
      },
    },
  );

  consecutiveFailures = 0;
  if (!workerActive) {
    workerActive = true;
    scheduleNext(1_000);
  }
  console.log("🐺✉️ [DmCampaignService] Campaign started");
  return getStatus();
}

async function pauseCampaign(reason: string = "manual") {
  await campaignsCollection().updateOne(
    { _id: CAMPAIGN_ID, status: { $ne: "done" } },
    { $set: { status: "paused" as DmCampaignStatus, pausedReason: reason } },
  );
  stopWorker();
  console.log(`🐺✉️ [DmCampaignService] Campaign paused (${reason})`);
  return getStatus();
}

async function getStatus() {
  const campaign = await campaignsCollection().findOne({ _id: CAMPAIGN_ID });
  const countRows = await targetsCollection()
    .aggregate<{ _id: DmTargetStatus; count: number }>([
      { $match: { campaignId: CAMPAIGN_ID } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ])
    .toArray();
  const counts: Record<string, number> = {};
  for (const row of countRows) counts[row._id] = row.count;
  const pending = counts.pending ?? 0;

  const budget = campaign
    ? evaluateDailyBudget(campaign.daily, Date.now(), DAILY_CAP)
    : null;
  const remainingToday = budget ? DAILY_CAP - budget.daily.sent : DAILY_CAP;

  return {
    campaignId: CAMPAIGN_ID,
    status: campaign?.status ?? "not_seeded",
    pausedReason: campaign?.pausedReason ?? null,
    workerActive,
    dailyCap: DAILY_CAP,
    sentToday: budget?.daily.sent ?? 0,
    remainingToday,
    totalSent: campaign?.totalSent ?? 0,
    counts,
    estimatedDaysRemaining: pending > 0 ? Math.ceil(pending / DAILY_CAP) : 0,
    inviteUrl: campaign?.inviteUrl ?? null,
    seededAt: campaign?.seededAt ?? null,
    startedAt: campaign?.startedAt ?? null,
  };
}

const DmCampaignService = {
  seedCampaign,
  startCampaign,
  pauseCampaign,
  getStatus,
  stopWorker,
};

export default DmCampaignService;
