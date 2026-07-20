/**
 * MongoDB data access for the gold economy: per-guild wallets plus a
 * transaction ledger. Every balance change goes through adjustGold /
 * transferGold / claimDaily so the ledger stays complete and balances
 * can never go negative.
 */

import MongoService from "#root/services/MongoService.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";
import utilities from "#root/utilities.ts";
import type { Collection, Document } from "mongodb";
import { computeDailyClaim } from "./goldMath.ts";

// ─── Types ────────────────────────────────────────────────────────────

export interface GoldWallet {
  userId: string;
  guildId: string;
  balance: number;
  lifetimeEarned: number;
  dailyStreak: number;
  bestDailyStreak: number;
  lastDailyAt?: number;
  username?: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
}

/** Ledger reasons — one per gold source/sink so history stays queryable. */
export type GoldReason =
  | "daily"
  | "deathroll_win"
  | "deathroll_wager"
  | "deathroll_refund"
  | "deathroll_pot"
  | "guesswho_correct"
  | "shock_drop"
  | "shock_pickup"
  | "shock_crit_bonus"
  | "shock_consolation"
  | "beatup_drop"
  | "beatup_loot"
  | "lupos_gift"
  | "lupos_mug"
  | "lupos_hoard_seed"
  | "mug_pickup"
  | "heist_stake"
  | "heist_refund"
  | "heist_loot"
  | "royale_wager"
  | "royale_refund"
  | "royale_pot"
  | "gift_sent"
  | "gift_received"
  | "ransom";

export interface UserInfo {
  username: string;
  displayName: string;
}

export type AdjustGoldResult =
  | { ok: true; balance: number }
  | { ok: false; error: "insufficient" | "failed" };

// ─── Collections & Indexes ────────────────────────────────────────────

let goldIndexesEnsured = false;

function getGoldDb() {
  const localMongo = MongoService.getClient("local");
  if (!localMongo)
    throw new Error("MongoService: local client not initialized");
  return localMongo.db(MONGO_DB_NAME);
}

export function getGoldCollections() {
  const db = getGoldDb();
  const collections = {
    walletsCollection: db.collection("GoldWallets"),
    transactionsCollection: db.collection("GoldTransactions"),
  };

  if (!goldIndexesEnsured) {
    goldIndexesEnsured = true;
    ensureGoldIndexes(collections).catch((err: unknown) =>
      console.error(
        "Failed to ensure gold indexes:",
        utilities.errorMessage(err),
      ),
    );
  }

  return collections;
}

async function ensureGoldIndexes({
  walletsCollection,
  transactionsCollection,
}: {
  walletsCollection: Collection;
  transactionsCollection: Collection;
}) {
  await Promise.all([
    walletsCollection.createIndex({ userId: 1, guildId: 1 }, { unique: true }),
    walletsCollection.createIndex({ guildId: 1, balance: -1 }),
    transactionsCollection.createIndex({ guildId: 1, userId: 1, at: -1 }),
  ]);
  console.log("🪙 Gold collection indexes ensured");
}

// ─── Ledger ───────────────────────────────────────────────────────────

/**
 * Records a ledger entry. Fire-and-forget: the ledger is an audit trail,
 * never a dependency of game flow.
 */
function recordTransaction(
  guildId: string,
  userId: string,
  amount: number,
  balanceAfter: number,
  reason: GoldReason,
  meta?: Record<string, unknown>,
) {
  try {
    const { transactionsCollection } = getGoldCollections();
    transactionsCollection
      .insertOne({
        guildId,
        userId,
        amount,
        balanceAfter,
        reason,
        ...(meta ? { meta } : {}),
        at: Date.now(),
      })
      .catch((err: unknown) =>
        console.error(
          "[gold] Failed to record transaction:",
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      "[gold] Failed to record transaction:",
      utilities.errorMessage(err),
    );
  }
}

// ─── Wallet Operations ────────────────────────────────────────────────

export async function fetchWallet(
  guildId: string,
  userId: string,
): Promise<GoldWallet | null> {
  const { walletsCollection } = getGoldCollections();
  return (await walletsCollection.findOne({
    userId,
    guildId,
  })) as unknown as GoldWallet | null;
}

/**
 * Credits (amount > 0) or debits (amount < 0) a wallet atomically.
 * Debits are guarded by a balance filter so a wallet can never go
 * negative; a debit against a missing or too-poor wallet fails with
 * "insufficient". Credits upsert the wallet on first touch.
 */
export async function adjustGold(
  guildId: string,
  userId: string,
  amount: number,
  reason: GoldReason,
  opts?: { userInfo?: UserInfo; meta?: Record<string, unknown> },
): Promise<AdjustGoldResult> {
  const { walletsCollection } = getGoldCollections();
  const now = Date.now();
  const nameFields = opts?.userInfo
    ? {
        username: opts.userInfo.username,
        displayName: opts.userInfo.displayName,
      }
    : {};

  try {
    if (amount >= 0) {
      let doc: Document | null = null;
      const update = {
        $inc: { balance: amount, lifetimeEarned: amount },
        $set: { updatedAt: now, ...nameFields },
        $setOnInsert: {
          createdAt: now,
          dailyStreak: 0,
          bestDailyStreak: 0,
        },
      };
      try {
        doc = await walletsCollection.findOneAndUpdate(
          { userId, guildId },
          update,
          { upsert: true, returnDocument: "after" },
        );
      } catch (error: unknown) {
        // Concurrent upsert race — the wallet exists now, retry once.
        if ((error as { code?: number }).code !== 11000) throw error;
        doc = await walletsCollection.findOneAndUpdate(
          { userId, guildId },
          update,
          { upsert: true, returnDocument: "after" },
        );
      }
      const balance = (doc?.balance as number) ?? amount;
      recordTransaction(guildId, userId, amount, balance, reason, opts?.meta);
      return { ok: true, balance };
    }

    const doc = await walletsCollection.findOneAndUpdate(
      { userId, guildId, balance: { $gte: -amount } },
      { $inc: { balance: amount }, $set: { updatedAt: now, ...nameFields } },
      { returnDocument: "after" },
    );
    if (!doc) return { ok: false, error: "insufficient" };
    recordTransaction(
      guildId,
      userId,
      amount,
      doc.balance as number,
      reason,
      opts?.meta,
    );
    return { ok: true, balance: doc.balance as number };
  } catch (error: unknown) {
    console.error("[gold] adjustGold failed:", utilities.errorMessage(error));
    return { ok: false, error: "failed" };
  }
}

/**
 * Moves gold between two wallets (used by /gold give). Debits first;
 * if the credit somehow fails the debit is refunded.
 */
export async function transferGold(
  guildId: string,
  fromId: string,
  toId: string,
  amount: number,
  fromInfo: UserInfo,
  toInfo: UserInfo,
): Promise<AdjustGoldResult> {
  const debit = await adjustGold(guildId, fromId, -amount, "gift_sent", {
    userInfo: fromInfo,
    meta: { to: toId },
  });
  if (!debit.ok) return debit;

  const credit = await adjustGold(guildId, toId, amount, "gift_received", {
    userInfo: toInfo,
    meta: { from: fromId },
  });
  if (!credit.ok) {
    await adjustGold(guildId, fromId, amount, "gift_received", {
      userInfo: fromInfo,
      meta: { refundOfFailedGiftTo: toId },
    });
    return credit;
  }
  return debit;
}

export type DailyClaimResult =
  | {
      claimed: true;
      amount: number;
      streak: number;
      balance: number;
      nextClaimAt: number;
    }
  | { claimed: false; nextClaimAt: number };

/**
 * Claims the daily gold reward. The write is guarded on the previously
 * read lastDailyAt so a double-click can't pay out twice.
 */
export async function claimDaily(
  guildId: string,
  userId: string,
  userInfo: UserInfo,
): Promise<DailyClaimResult> {
  const { walletsCollection } = getGoldCollections();
  const now = Date.now();
  const wallet = await fetchWallet(guildId, userId);

  const claim = computeDailyClaim(
    wallet?.lastDailyAt,
    wallet?.dailyStreak ?? 0,
    now,
  );
  if (!claim.eligible) {
    return { claimed: false, nextClaimAt: claim.nextClaimAt };
  }

  const guard =
    wallet?.lastDailyAt === undefined ? { $exists: false } : wallet.lastDailyAt;
  const doc = await walletsCollection.findOneAndUpdate(
    { userId, guildId, lastDailyAt: guard },
    {
      $inc: { balance: claim.amount, lifetimeEarned: claim.amount },
      $set: {
        lastDailyAt: now,
        dailyStreak: claim.streak,
        updatedAt: now,
        username: userInfo.username,
        displayName: userInfo.displayName,
      },
      $max: { bestDailyStreak: claim.streak },
      $setOnInsert: { createdAt: now },
    },
    { upsert: wallet === null, returnDocument: "after" },
  );

  if (!doc) {
    // Lost a double-claim race — report the cooldown as if we'd seen it.
    return { claimed: false, nextClaimAt: now + 1 };
  }

  recordTransaction(
    guildId,
    userId,
    claim.amount,
    doc.balance as number,
    "daily",
    {
      streak: claim.streak,
    },
  );
  return {
    claimed: true,
    amount: claim.amount,
    streak: claim.streak,
    balance: doc.balance as number,
    nextClaimAt: claim.nextClaimAt,
  };
}

// ─── Leaderboard ──────────────────────────────────────────────────────

export interface GoldLeaderboardEntry {
  userId: string;
  balance: number;
  lifetimeEarned: number;
  dailyStreak: number;
}

export async function fetchGoldLeaderboard(
  guildId: string,
  limit: number = 15,
): Promise<{ entries: GoldLeaderboardEntry[]; totalWallets: number }> {
  const { walletsCollection } = getGoldCollections();
  const [docs, totalWallets] = await Promise.all([
    walletsCollection
      .find({ guildId, balance: { $gt: 0 } })
      .sort({ balance: -1 })
      .limit(limit)
      .toArray(),
    walletsCollection.countDocuments({ guildId }),
  ]);
  return {
    entries: docs.map((d: Document) => ({
      userId: d.userId as string,
      balance: d.balance as number,
      lifetimeEarned: (d.lifetimeEarned as number) ?? 0,
      dailyStreak: (d.dailyStreak as number) ?? 0,
    })),
    totalWallets,
  };
}
