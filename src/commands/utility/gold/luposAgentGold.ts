/**
 * The wolf's economy: gold operations exposed to the Lupos agent as
 * Discord tools (via tools-service → lupos-bot HTTP forwarding).
 *
 * Lupos has his own wallet (the hoard) and is closed-loop: gifts come
 * OUT of the hoard, mugged gold goes INTO it (or scatters to the
 * conversation, 50/50). Hard caps live here — no prompt can reach
 * past them: gift amounts 1-5g at most once per target per day,
 * mug amounts 1-3g at most three times per target per day, and whoever
 * Lupos is answering can set off at most five gold actions (gifts and
 * mugs together) per day in a guild.
 */

import type { Client, Guild, Message } from "discord.js";
import { getMongoDb } from "../commandUtils.ts";
import {
  adjustGold,
  fetchWallet,
  getGoldCollections,
} from "./goldRepository.ts";
import { computeScatterPileCount, formatGold, utcDay } from "./goldMath.ts";
import ActivityGold from "./activityGold.ts";
import {
  buildScatterAssignments,
  creditScatter,
  formatScatterLine,
  pickScatterTargets,
} from "./goldScatter.ts";
import type { ScatterTarget } from "./goldScatter.ts";

// ─── Hard Caps (enforced here, not in the persona prompt) ─────────────

// Gold amounts are one tenth of what gold first shipped with — see the
// header in goldMath.ts.
export const LUPOS_GIFT_MIN = 1;
export const LUPOS_GIFT_MAX = 5;
export const LUPOS_MUG_MIN = 1;
export const LUPOS_MUG_MAX = 3;
/** Chance a mug fumbles and the gold scatters instead of joining the hoard. */
export const LUPOS_MUG_DROP_CHANCE = 0.5;
export const LUPOS_GIFTS_PER_TARGET_PER_DAY = 1;
export const LUPOS_MUGS_PER_TARGET_PER_DAY = 3;
/**
 * Gold actions (gifts + mugs) one requester — the person Lupos is
 * answering — can set off per UTC day in a guild, whoever the targets.
 */
export const LUPOS_GOLD_ACTIONS_PER_REQUESTER_PER_DAY = 5;
/** Starting hoard for a guild the wolf has never operated in. */
export const LUPOS_HOARD_SEED_GOLD = 100;

const DAILY_ACTIONS_COLLECTION = "LuposGoldDailyActions";
// Its own collection: LuposGoldDailyActions is unique on
// (guildId, targetId, day), which requester documents do not have.
const REQUESTER_DAILY_ACTIONS_COLLECTION = "LuposGoldRequesterDailyActions";

let dailyActionsIndexEnsured = false;
let requesterActionsIndexEnsured = false;

function getDailyActionsCollection() {
  const collection = getMongoDb().collection(DAILY_ACTIONS_COLLECTION);
  if (!dailyActionsIndexEnsured) {
    dailyActionsIndexEnsured = true;
    collection
      .createIndex({ guildId: 1, targetId: 1, day: 1 }, { unique: true })
      .catch((err: unknown) =>
        console.error("Failed to ensure LuposGoldDailyActions index:", err),
      );
  }
  return collection;
}

/**
 * Atomically consumes one unit of today's gift/mug allowance for a
 * target. Returns false when the cap is already spent.
 */
async function tryConsumeDailyAllowance(
  guildId: string,
  targetId: string,
  kind: "gifts" | "mugs",
): Promise<boolean> {
  const collection = getDailyActionsCollection();
  const day = utcDay();
  const cap =
    kind === "gifts"
      ? LUPOS_GIFTS_PER_TARGET_PER_DAY
      : LUPOS_MUGS_PER_TARGET_PER_DAY;

  try {
    const doc = await collection.findOneAndUpdate(
      { guildId, targetId, day, [kind]: { $not: { $gte: cap } } },
      { $inc: { [kind]: 1 }, $set: { updatedAt: Date.now() } },
      { upsert: true, returnDocument: "after" },
    );
    return doc !== null;
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      // Doc exists but the filter rejected it (cap hit), or we lost an
      // upsert race — retry once without upsert to disambiguate.
      const doc = await collection.findOneAndUpdate(
        { guildId, targetId, day, [kind]: { $not: { $gte: cap } } },
        { $inc: { [kind]: 1 }, $set: { updatedAt: Date.now() } },
        { returnDocument: "after" },
      );
      return doc !== null;
    }
    throw error;
  }
}

function getRequesterActionsCollection() {
  const collection = getMongoDb().collection(
    REQUESTER_DAILY_ACTIONS_COLLECTION,
  );
  if (!requesterActionsIndexEnsured) {
    requesterActionsIndexEnsured = true;
    collection
      .createIndex({ guildId: 1, requesterId: 1, day: 1 }, { unique: true })
      .catch((err: unknown) =>
        console.error(
          "Failed to ensure LuposGoldRequesterDailyActions index:",
          err,
        ),
      );
  }
  return collection;
}

/**
 * Atomically consumes one of today's gold actions for a requester —
 * the same capped upsert as tryConsumeDailyAllowance. Returns false
 * when all five are spent.
 */
async function tryConsumeRequesterAllowance(
  guildId: string,
  requesterId: string,
  day: string,
): Promise<boolean> {
  const collection = getRequesterActionsCollection();
  const filter = {
    guildId,
    requesterId,
    day,
    actions: { $not: { $gte: LUPOS_GOLD_ACTIONS_PER_REQUESTER_PER_DAY } },
  };
  const update = { $inc: { actions: 1 }, $set: { updatedAt: Date.now() } };
  try {
    const doc = await collection.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: "after",
    });
    return doc !== null;
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      // Cap hit (the upsert collided with the capped doc) or a lost
      // upsert race — retry once without upsert to disambiguate.
      const doc = await collection.findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
      return doc !== null;
    }
    throw error;
  }
}

/** Hands back an action that moved no gold (so only real ones count). */
async function refundRequesterAllowance(
  guildId: string,
  requesterId: string,
  day: string,
): Promise<void> {
  await getRequesterActionsCollection()
    .updateOne(
      { guildId, requesterId, day, actions: { $gt: 0 } },
      { $inc: { actions: -1 }, $set: { updatedAt: Date.now() } },
    )
    .catch((err: unknown) =>
      console.error("Failed to refund a requester gold action:", err),
    );
}

export interface RequesterCapResult {
  ok: false;
  reason: "requester_cap";
  summary: string;
}

/**
 * Runs a gold action against the requester's daily allowance: refused
 * up front when it is spent, refunded when the action moves no gold.
 * No requester (a caller outside a Discord conversation) = no cap.
 */
async function withRequesterAllowance<Result extends { ok: boolean }>(
  guildId: string,
  requesterUserId: string | undefined,
  action: () => Promise<Result>,
): Promise<Result | RequesterCapResult> {
  if (!requesterUserId) return action();
  const day = utcDay();
  const allowed = await tryConsumeRequesterAllowance(
    guildId,
    requesterUserId,
    day,
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "requester_cap",
      summary: `You've already had Lupos move gold ${LUPOS_GOLD_ACTIONS_PER_REQUESTER_PER_DAY} times today — no more gifts or muggings on your say-so until tomorrow (UTC).`,
    };
  }
  let result: Result;
  try {
    result = await action();
  } catch (error: unknown) {
    await refundRequesterAllowance(guildId, requesterUserId, day);
    throw error;
  }
  if (!result.ok) {
    await refundRequesterAllowance(guildId, requesterUserId, day);
  }
  return result;
}

/**
 * Ensures the wolf's wallet exists in this guild, seeding the hoard on
 * first touch so the wolf has something to give before his first mug.
 * Exported for the heist (the hoard is the raid target).
 */
export async function ensureWolfWallet(guildId: string, botUserId: string) {
  const wallet = await fetchWallet(guildId, botUserId);
  if (wallet) return wallet;
  await adjustGold(
    guildId,
    botUserId,
    LUPOS_HOARD_SEED_GOLD,
    "lupos_hoard_seed",
    {
      userInfo: { username: "Lupos", displayName: "Lupos" },
    },
  );
  return fetchWallet(guildId, botUserId);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ─── Balance ──────────────────────────────────────────────────────────

/**
 * Wallet summary for the agent: balance, rank position, and the wolf's
 * own hoard for context.
 */
export async function luposGetGoldBalance(
  client: Client,
  guildId: string,
  userId: string,
) {
  const botUserId = client.user!.id;
  const [wallet, wolfWallet, todayActivity] = await Promise.all([
    fetchWallet(guildId, userId),
    ensureWolfWallet(guildId, botUserId),
    ActivityGold.fetchTodayActivity(guildId, userId),
  ]);

  let rank: number | null = null;
  if (wallet) {
    const { walletsCollection } = getGoldCollections();
    rank =
      (await walletsCollection.countDocuments({
        guildId,
        balance: { $gt: wallet.balance },
      })) + 1;
  }

  return {
    userId,
    hasWallet: wallet !== null,
    balance: wallet?.balance ?? 0,
    balanceDisplay: formatGold(wallet?.balance ?? 0),
    lifetimeEarned: wallet?.lifetimeEarned ?? 0,
    dailyStreak: wallet?.dailyStreak ?? 0,
    earnedTodayFromActivity: todayActivity.totalEarned,
    todayActivity,
    leaderboardRank: rank,
    wolfHoard: wolfWallet?.balance ?? 0,
    wolfHoardDisplay: formatGold(wolfWallet?.balance ?? 0),
  };
}

// ─── Gift ─────────────────────────────────────────────────────────────

export type LuposGiftResult =
  | {
      ok: true;
      amount: number;
      targetBalance: number;
      hoardBalance: number;
      summary: string;
    }
  | {
      ok: false;
      reason: "daily_cap" | "hoard_empty" | "target_is_bot" | "failed";
      summary: string;
    };

/**
 * Gives gold from the wolf's hoard to a member. Clamped to 1-5g and at
 * most once per target per UTC day, regardless of what the model asks;
 * with a `requesterUserId`, it also spends one of their five daily gold
 * actions (refunded if no gold moves).
 */
export async function luposGiveGold(
  client: Client,
  guild: Guild,
  targetUserId: string,
  requestedAmount: number,
  note: string | undefined,
  requesterUserId?: string,
): Promise<LuposGiftResult | RequesterCapResult> {
  return withRequesterAllowance(guild.id, requesterUserId, () =>
    giveGold(client, guild, targetUserId, requestedAmount, note),
  );
}

async function giveGold(
  client: Client,
  guild: Guild,
  targetUserId: string,
  requestedAmount: number,
  note: string | undefined,
): Promise<LuposGiftResult> {
  const botUserId = client.user!.id;
  const targetMember = await guild.members
    .fetch(targetUserId)
    .catch(() => null);
  if (!targetMember || targetMember.user.bot) {
    return {
      ok: false,
      reason: "target_is_bot",
      summary: "That target is a bot or not in this server — no gold moved.",
    };
  }

  const amount = clamp(
    requestedAmount || LUPOS_GIFT_MIN,
    LUPOS_GIFT_MIN,
    LUPOS_GIFT_MAX,
  );

  const allowed = await tryConsumeDailyAllowance(
    guild.id,
    targetUserId,
    "gifts",
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "daily_cap",
      summary: `Already gifted ${targetMember.displayName} today — one gift per person per day.`,
    };
  }

  await ensureWolfWallet(guild.id, botUserId);
  const debit = await adjustGold(guild.id, botUserId, -amount, "lupos_gift", {
    userInfo: { username: "Lupos", displayName: "Lupos" },
    meta: { to: targetUserId, note },
  });
  if (!debit.ok) {
    return {
      ok: false,
      reason: debit.error === "insufficient" ? "hoard_empty" : "failed",
      summary:
        debit.error === "insufficient"
          ? "The hoard is empty — the wolf has nothing left to give. Mug someone first."
          : "The gift failed — no gold moved.",
    };
  }

  const credit = await adjustGold(
    guild.id,
    targetUserId,
    amount,
    "lupos_gift",
    {
      userInfo: {
        username: targetMember.user.username,
        displayName: targetMember.displayName,
      },
      meta: { from: botUserId, note },
    },
  );
  const targetBalance = credit.ok ? credit.balance : 0;

  return {
    ok: true,
    amount,
    targetBalance,
    hoardBalance: debit.balance,
    summary: `Gave ${formatGold(amount)} from the hoard to ${targetMember.displayName} (their balance: ${formatGold(targetBalance)}, hoard: ${formatGold(debit.balance)}).`,
  };
}

// ─── Mug ──────────────────────────────────────────────────────────────

export type LuposMugResult =
  | {
      ok: true;
      outcome: "hoarded" | "scattered";
      amount: number;
      victimBalance: number;
      hoardBalance: number;
      /** Ready-to-quote mention line when the loot scattered. */
      scatterText: string | null;
      summary: string;
    }
  | {
      ok: false;
      reason: "daily_cap" | "broke" | "target_is_bot" | "failed";
      summary: string;
    };

/**
 * Mugs a member: 1-3g (never more than they carry), at most three times
 * per target per UTC day. Half the time the wolf fumbles and the loot
 * scatters across recent talkers in the channel — the wolf himself is in
 * that pool and may snatch a pile of his own stolen gold. With a
 * `requesterUserId`, it also spends one of their five daily gold actions
 * (refunded if no gold moves).
 */
export async function luposMugGold(
  client: Client,
  guild: Guild,
  channelId: string | undefined,
  targetUserId: string,
  requestedAmount: number,
  note: string | undefined,
  requesterUserId?: string,
): Promise<LuposMugResult | RequesterCapResult> {
  return withRequesterAllowance(guild.id, requesterUserId, () =>
    mugGold(client, guild, channelId, targetUserId, requestedAmount, note),
  );
}

async function mugGold(
  client: Client,
  guild: Guild,
  channelId: string | undefined,
  targetUserId: string,
  requestedAmount: number,
  note: string | undefined,
): Promise<LuposMugResult> {
  const botUserId = client.user!.id;
  const targetMember = await guild.members
    .fetch(targetUserId)
    .catch(() => null);
  if (!targetMember || targetMember.user.bot) {
    return {
      ok: false,
      reason: "target_is_bot",
      summary: "That target is a bot or not in this server — nothing to mug.",
    };
  }

  const victimWallet = await fetchWallet(guild.id, targetUserId);
  const requested = clamp(
    requestedAmount || LUPOS_MUG_MAX,
    LUPOS_MUG_MIN,
    LUPOS_MUG_MAX,
  );
  const amount = Math.min(requested, victimWallet?.balance ?? 0);
  if (amount <= 0) {
    return {
      ok: false,
      reason: "broke",
      summary: `${targetMember.displayName} is broke — pockets full of lint. Nothing to take.`,
    };
  }

  const allowed = await tryConsumeDailyAllowance(
    guild.id,
    targetUserId,
    "mugs",
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "daily_cap",
      summary: `${targetMember.displayName} has already been shaken down ${LUPOS_MUGS_PER_TARGET_PER_DAY} times today — even wolves have limits.`,
    };
  }

  const debit = await adjustGold(guild.id, targetUserId, -amount, "lupos_mug", {
    userInfo: {
      username: targetMember.user.username,
      displayName: targetMember.displayName,
    },
    meta: { by: botUserId, note },
  });
  if (!debit.ok) {
    return {
      ok: false,
      reason: "failed",
      summary: "The mugging failed — no gold moved.",
    };
  }

  await ensureWolfWallet(guild.id, botUserId);

  // 50/50: the loot joins the hoard, or the wolf fumbles it and it
  // scatters across the recent conversation.
  const fumbled = Math.random() < LUPOS_MUG_DROP_CHANCE;
  if (fumbled) {
    const pool = await buildChannelBystanderPool(
      guild,
      channelId,
      targetUserId,
      botUserId,
    );
    const targets = pickScatterTargets(
      pool,
      computeScatterPileCount(amount, pool.length),
    );
    if (targets.length > 0) {
      const assignments = buildScatterAssignments(amount, targets);
      await creditScatter(guild.id, assignments, "mug_pickup", {
        muggedFrom: targetUserId,
        muggedBy: botUserId,
        note,
      });
      const scatterText = formatScatterLine(assignments);
      const wolfPile = assignments.find(
        (assignment) => assignment.target.userId === botUserId,
      );
      const wolfWallet = await fetchWallet(guild.id, botUserId);
      return {
        ok: true,
        outcome: "scattered",
        amount,
        victimBalance: debit.balance,
        hoardBalance: wolfWallet?.balance ?? 0,
        scatterText,
        summary:
          `Mugged ${formatGold(amount)} from ${targetMember.displayName} but FUMBLED it — the loot scattered: ${scatterText}` +
          (wolfPile
            ? ` (the wolf snatched ${formatGold(wolfPile.amount)} back)`
            : ""),
      };
    }
    // Nobody around to catch the fumble — the wolf keeps it after all.
  }

  const hoard = await adjustGold(guild.id, botUserId, amount, "lupos_mug", {
    userInfo: { username: "Lupos", displayName: "Lupos" },
    meta: { from: targetUserId, note },
  });
  return {
    ok: true,
    outcome: "hoarded",
    amount,
    victimBalance: debit.balance,
    hoardBalance: hoard.ok ? hoard.balance : 0,
    scatterText: null,
    summary: `Mugged ${formatGold(amount)} from ${targetMember.displayName} straight into the hoard (their balance: ${formatGold(debit.balance)}, hoard: ${formatGold(hoard.ok ? hoard.balance : 0)}).`,
  };
}

/**
 * Recent talkers in the channel (last 25 messages), excluding the victim
 * and bots — except the wolf himself, who is always eligible to snatch.
 */
async function buildChannelBystanderPool(
  guild: Guild,
  channelId: string | undefined,
  victimId: string,
  botUserId: string,
): Promise<ScatterTarget[]> {
  if (!channelId) return [];
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return [];
  const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recent) return [];

  const pool = new Map<string, ScatterTarget>();
  for (const message of recent.values() as IterableIterator<Message>) {
    const author = message.author;
    if (author.id === victimId) continue;
    if (author.bot && author.id !== botUserId) continue;
    pool.set(author.id, {
      userId: author.id,
      username: author.username,
      displayName: message.member?.displayName ?? author.username,
    });
  }
  return Array.from(pool.values());
}
