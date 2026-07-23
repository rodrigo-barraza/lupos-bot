/**
 * Silent activity gold: passive earnings for being present and engaged —
 * chatting (with length/attachment/link/first-howl bonuses), receiving
 * reactions, landing in #highlights, and hanging out in voice.
 *
 * All accrual is SILENT by design: never post to chat about it. Earnings
 * surface only through /gold balance and the wolf's balance tool.
 *
 * Every earn path is guarded by an atomic per-user-per-day document in
 * GoldActivityDaily (unique guildId+userId+day), so the doubled
 * messageCreate listeners in default mode, restarts, and races can never
 * double-pay. Amounts and caps live in goldMath.ts.
 */

import type { Client, Guild, GuildMember, Message, User } from "discord.js";
import type { Collection, Document } from "mongodb";
import { getMongoDb } from "../commandUtils.ts";
import utilities from "#root/utilities.ts";
import {
  adjustGold,
  GOLD_ACTIVITY_DAILY_COLLECTION,
} from "./goldRepository.ts";
import type { UserInfo } from "./goldRepository.ts";
import {
  CHAT_ATTACHMENT_BONUS_GOLD,
  CHAT_GOLD_COOLDOWN_MS,
  CHAT_LINK_BONUS_GOLD,
  FIRST_HOWL_GOLD,
  HIGHLIGHT_BONUS_GOLD,
  REACTION_RECEIVED_DAILY_CAP,
  REACTION_RECEIVED_GOLD,
  VOICE_GOLD_DAILY_CAP,
  VOICE_GOLD_PER_MINUTE,
  VOICE_MIN_HUMANS,
  computeChatEarn,
  utcDay,
} from "./goldMath.ts";

/** Unique-reactor credits per message; TTL'd — a reactor who returns
 * after expiry could in theory re-credit, but the daily cap bounds it. */
const REACTION_CREDITS_COLLECTION = "GoldReactionCredits";
const REACTION_CREDITS_TTL_SECONDS = 7 * 24 * 60 * 60;

export const VOICE_SWEEP_INTERVAL_MS = 60_000;

// ─── Collections & Indexes ────────────────────────────────────────────

let activityIndexesEnsured = false;

function getActivityCollections() {
  const db = getMongoDb();
  const collections = {
    activityCollection: db.collection(GOLD_ACTIVITY_DAILY_COLLECTION),
    reactionCreditsCollection: db.collection(REACTION_CREDITS_COLLECTION),
  };
  if (!activityIndexesEnsured) {
    activityIndexesEnsured = true;
    ensureActivityIndexes(collections).catch((err: unknown) =>
      console.error(
        "Failed to ensure activity gold indexes:",
        utilities.errorMessage(err),
      ),
    );
  }
  return collections;
}

async function ensureActivityIndexes({
  activityCollection,
  reactionCreditsCollection,
}: {
  activityCollection: Collection;
  reactionCreditsCollection: Collection;
}) {
  await Promise.all([
    activityCollection.createIndex(
      { guildId: 1, userId: 1, day: 1 },
      { unique: true },
    ),
    reactionCreditsCollection.createIndex(
      { messageId: 1, reactorId: 1 },
      { unique: true },
    ),
    reactionCreditsCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: REACTION_CREDITS_TTL_SECONDS },
    ),
  ]);
  console.log("🪙 Activity gold indexes ensured");
}

/** Zeroed counter fields for $setOnInsert, minus any being $inc'd. */
function insertDefaults(now: number, exclude: string[] = []) {
  const defaults: Record<string, number> = {
    createdAt: now,
    countedMessages: 0,
    chatEarned: 0,
    attachBonuses: 0,
    linkBonuses: 0,
    reactionEarned: 0,
    voiceEarned: 0,
    voiceMinutes: 0,
  };
  for (const key of exclude) delete defaults[key];
  return defaults;
}

/**
 * Atomically increments a capped daily counter, upserting the day doc.
 * Returns false when the cap is already spent. Same E11000-disambiguation
 * pattern as LuposGoldDailyActions.
 */
async function tryIncrementCapped(
  guildId: string,
  userId: string,
  increments: Record<string, number>,
  capField: string,
  cap: number,
): Promise<boolean> {
  const { activityCollection } = getActivityCollections();
  const now = Date.now();
  const day = utcDay(now);
  const filter = {
    guildId,
    userId,
    day,
    [capField]: { $not: { $gte: cap } },
  };
  const update = {
    $inc: increments,
    $set: { updatedAt: now },
    $setOnInsert: insertDefaults(now, Object.keys(increments)),
  };
  try {
    const doc = await activityCollection.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: "after",
    });
    return doc !== null;
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      // Doc exists but the filter rejected it (cap hit), or we lost an
      // upsert race — retry once without upsert to disambiguate.
      const doc = await activityCollection.findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
      return doc !== null;
    }
    throw error;
  }
}

function userInfoFromMember(member: GuildMember | null, user: User): UserInfo {
  return {
    username: user.username,
    displayName: member?.displayName ?? user.username,
  };
}

// ─── Chat Earn ────────────────────────────────────────────────────────

/**
 * Handles one guild message: consumes the 60s cooldown atomically, then
 * pays base + bonuses per goldMath.computeChatEarn. Called from the
 * messageCreate listener — silent, never replies.
 */
async function handleChatMessage(message: Message) {
  try {
    if (!message.guildId || message.author.bot || message.system) return;

    const { activityCollection } = getActivityCollections();
    const guildId = message.guildId;
    const userId = message.author.id;
    const now = Date.now();
    const day = utcDay(now);

    // Atomic cooldown consume: only one caller (of the two default-mode
    // listeners, or two rapid messages) passes the lastCountedAt filter.
    const filter = {
      guildId,
      userId,
      day,
      $or: [
        { lastCountedAt: { $exists: false } },
        { lastCountedAt: { $lte: now - CHAT_GOLD_COOLDOWN_MS } },
      ],
    };
    const update = {
      $inc: { countedMessages: 1 },
      $set: { lastCountedAt: now, updatedAt: now },
      $setOnInsert: insertDefaults(now, ["countedMessages"]),
    };
    let prior: Document | null;
    try {
      prior = await activityCollection.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: "before",
      });
      // Fresh insert returns null "before" — that IS a counted message.
    } catch (error: unknown) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // Doc exists but cooldown active, or lost an upsert race — retry
      // once without upsert; null now means "not counted".
      const retried = await activityCollection.findOneAndUpdate(
        filter,
        update,
        { returnDocument: "before" },
      );
      if (retried === null) return;
      prior = retried;
    }

    const earn = computeChatEarn(
      {
        chatEarned: (prior?.chatEarned as number) ?? 0,
        attachBonuses: (prior?.attachBonuses as number) ?? 0,
        linkBonuses: (prior?.linkBonuses as number) ?? 0,
        firstHowlPaid: Boolean(prior?.firstHowlAt),
      },
      (message.cleanContent ?? message.content ?? "").length,
      message.attachments.size > 0 || message.stickers.size > 0,
      /https?:\/\//i.test(message.content ?? ""),
    );
    if (earn.total <= 0) return;

    // Only the cooldown winner reaches this — no race on the counters.
    await activityCollection.updateOne(
      { guildId, userId, day },
      {
        $inc: {
          chatEarned: earn.base,
          ...(earn.attach > 0 ? { attachBonuses: 1 } : {}),
          ...(earn.link > 0 ? { linkBonuses: 1 } : {}),
        },
        ...(earn.firstHowl > 0 ? { $set: { firstHowlAt: now } } : {}),
      },
    );

    await adjustGold(guildId, userId, earn.total, "chat_activity", {
      userInfo: userInfoFromMember(message.member, message.author),
      meta: {
        base: earn.base,
        attach: earn.attach,
        link: earn.link,
        firstHowl: earn.firstHowl,
      },
    });
  } catch (error: unknown) {
    console.error(
      "[activityGold] Chat earn failed:",
      utilities.errorMessage(error),
    );
  }
}

// ─── Reaction Earn ────────────────────────────────────────────────────

/**
 * Credits a message author when a NEW unique (non-self, non-bot) reactor
 * reacts, capped per author per day. Called from the reaction pipeline
 * after partials are fetched.
 */
async function handleReactionReceived(reaction: {
  message: Message;
  reactor: User;
}) {
  try {
    const { message, reactor } = reaction;
    const guildId = message.guildId;
    const author = message.author;
    if (!guildId || !author || author.bot) return;
    if (reactor.bot || reactor.id === author.id) return;

    const { reactionCreditsCollection } = getActivityCollections();
    const credit = await reactionCreditsCollection.updateOne(
      { messageId: message.id, reactorId: reactor.id },
      {
        $setOnInsert: {
          guildId,
          authorId: author.id,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    if (credit.upsertedCount === 0) return; // this reactor already counted

    const allowed = await tryIncrementCapped(
      guildId,
      author.id,
      { reactionEarned: REACTION_RECEIVED_GOLD },
      "reactionEarned",
      REACTION_RECEIVED_DAILY_CAP,
    );
    if (!allowed) return;

    await adjustGold(
      guildId,
      author.id,
      REACTION_RECEIVED_GOLD,
      "reaction_received",
      {
        userInfo: userInfoFromMember(message.member, author),
        meta: { messageId: message.id, reactorId: reactor.id },
      },
    );
  } catch (error: unknown) {
    // Duplicate-key from a concurrent identical reaction event is a
    // benign "already counted".
    if ((error as { code?: number }).code === 11000) return;
    console.error(
      "[activityGold] Reaction earn failed:",
      utilities.errorMessage(error),
    );
  }
}

// ─── Highlight Bonus ──────────────────────────────────────────────────

/**
 * One-time bonus when a message first reaches #highlights. Idempotency
 * comes from the caller: ReactionHighlights only posts a highlight once
 * per source message (Mongo-backed dedup).
 */
async function grantHighlightBonus(message: Message) {
  try {
    const guildId = message.guildId;
    const author = message.author;
    if (!guildId || !author || author.bot) return;
    await adjustGold(guildId, author.id, HIGHLIGHT_BONUS_GOLD, "highlight_bonus", {
      userInfo: userInfoFromMember(message.member, author),
      meta: { messageId: message.id },
    });
  } catch (error: unknown) {
    console.error(
      "[activityGold] Highlight bonus failed:",
      utilities.errorMessage(error),
    );
  }
}

// ─── Voice Earn ───────────────────────────────────────────────────────

/** Undeafened humans outside the AFK channel, grouped by channel. */
function eligibleVoiceMembersByChannel(guild: Guild) {
  const byChannel = new Map<string, GuildMember[]>();
  for (const voiceState of guild.voiceStates.cache.values()) {
    const member = voiceState.member;
    const channelId = voiceState.channelId;
    if (!member || !channelId) continue;
    if (member.user.bot) continue;
    if (channelId === guild.afkChannelId) continue;
    if (voiceState.deaf) continue;
    const list = byChannel.get(channelId) ?? [];
    list.push(member);
    byChannel.set(channelId, list);
  }
  return byChannel;
}

async function sweepVoiceGold(client: Client) {
  for (const guild of client.guilds.cache.values()) {
    for (const members of eligibleVoiceMembersByChannel(guild).values()) {
      if (members.length < VOICE_MIN_HUMANS) continue;
      await Promise.all(
        members.map(async (member) => {
          const allowed = await tryIncrementCapped(
            guild.id,
            member.id,
            { voiceEarned: VOICE_GOLD_PER_MINUTE, voiceMinutes: 1 },
            "voiceEarned",
            VOICE_GOLD_DAILY_CAP,
          );
          if (!allowed) return;
          await adjustGold(
            guild.id,
            member.id,
            VOICE_GOLD_PER_MINUTE,
            "voice_activity",
            {
              userInfo: {
                username: member.user.username,
                displayName: member.displayName,
              },
            },
          );
        }),
      );
    }
  }
}

let voiceSweepStarted = false;

/**
 * Starts the once-a-minute voice payout sweep. Interval-based (not
 * voiceStateUpdate-based) so it's restart-safe with no in-memory state.
 * Must run in exactly one process — call from the services/default boot.
 */
function startVoiceGoldSweep(client: Client) {
  if (voiceSweepStarted) return;
  voiceSweepStarted = true;
  setInterval(() => {
    sweepVoiceGold(client).catch((error: unknown) =>
      console.error(
        "[activityGold] Voice sweep failed:",
        utilities.errorMessage(error),
      ),
    );
  }, VOICE_SWEEP_INTERVAL_MS);
  console.log("🪙 Voice gold sweep started (1g/min, ≥2 humans, 30g/day cap)");
}

// ─── Read Model ───────────────────────────────────────────────────────

export interface TodayActivity {
  chatEarned: number;
  attachBonuses: number;
  linkBonuses: number;
  firstHowl: boolean;
  reactionEarned: number;
  voiceEarned: number;
  voiceMinutes: number;
  totalEarned: number;
}

/** Today's silent earnings for /gold balance and the wolf's balance tool. */
async function fetchTodayActivity(
  guildId: string,
  userId: string,
): Promise<TodayActivity> {
  const { activityCollection } = getActivityCollections();
  const doc = await activityCollection.findOne({
    guildId,
    userId,
    day: utcDay(),
  });
  const chatEarned = (doc?.chatEarned as number) ?? 0;
  const attachBonuses = (doc?.attachBonuses as number) ?? 0;
  const linkBonuses = (doc?.linkBonuses as number) ?? 0;
  const firstHowl = Boolean(doc?.firstHowlAt);
  const reactionEarned = (doc?.reactionEarned as number) ?? 0;
  const voiceEarned = (doc?.voiceEarned as number) ?? 0;
  return {
    chatEarned,
    attachBonuses,
    linkBonuses,
    firstHowl,
    reactionEarned,
    voiceEarned,
    voiceMinutes: (doc?.voiceMinutes as number) ?? 0,
    totalEarned:
      chatEarned +
      attachBonuses * CHAT_ATTACHMENT_BONUS_GOLD +
      linkBonuses * CHAT_LINK_BONUS_GOLD +
      (firstHowl ? FIRST_HOWL_GOLD : 0) +
      reactionEarned +
      voiceEarned,
  };
}

export default {
  handleChatMessage,
  handleReactionReceived,
  grantHighlightBonus,
  startVoiceGoldSweep,
  fetchTodayActivity,
};
