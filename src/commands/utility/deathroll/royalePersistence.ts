/**
 * Persistence for Deathroll Royale: crash-safe snapshots of in-flight
 * games, the finished-game history collection, and boot reconciliation.
 *
 * Royale games are not resumed after a restart (too much live collector
 * state) — reconciliation marks the game message as interrupted and
 * refunds every player's wager so no gold is ever eaten by a redeploy.
 */

import type { Client, GuildTextBasedChannel } from "discord.js";
import utilities from "#root/utilities.ts";
import config from "#root/config.ts";
import { getDeathrollDb } from "./repository.ts";
import { adjustGold } from "../gold/goldRepository.ts";
import { computeRoyalePot } from "../gold/goldMath.ts";
import type { RoyaleState } from "./royale.ts";

const ACTIVE_ROYALES_COLLECTION = "DeathrollRoyaleActiveGames";
const ROYALE_HISTORY_COLLECTION = "DeathRollRoyaleHistory";

let royaleIndexesEnsured = false;

function getActiveRoyalesCollection() {
  const collection = getDeathrollDb().collection(ACTIVE_ROYALES_COLLECTION);
  if (!royaleIndexesEnsured) {
    royaleIndexesEnsured = true;
    Promise.all([
      collection.createIndex({ gameId: 1 }, { unique: true }),
      getDeathrollDb()
        .collection(ROYALE_HISTORY_COLLECTION)
        .createIndex({ gameId: 1 }, { unique: true }),
    ]).catch((err: unknown) =>
      console.error(
        "Failed to ensure royale indexes:",
        utilities.errorMessage(err),
      ),
    );
  }
  return collection;
}

// ─── Snapshots ────────────────────────────────────────────────────────

/**
 * Upserts the compact snapshot needed to reconcile after a restart:
 * who's in, what they wagered, and where the live message is.
 * Fire-and-forget: never throws and never blocks game flow.
 */
export function persistRoyaleSnapshot(gameId: string, state: RoyaleState) {
  try {
    getActiveRoyalesCollection()
      .updateOne(
        { gameId },
        {
          $set: {
            gameId,
            guildId: state.guildId,
            channelId: state.channelId,
            currentMessageId: state.currentMessageId,
            hostId: state.hostId,
            wager: state.wager,
            phase: state.phase,
            players: state.players,
            updatedAt: Date.now(),
          },
        },
        { upsert: true },
      )
      .catch((err: unknown) =>
        console.error(
          `[royale] Failed to persist snapshot for ${gameId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[royale] Failed to persist snapshot for ${gameId}:`,
      utilities.errorMessage(err),
    );
  }
}

/** Deletes the snapshot for a resolved royale. Fire-and-forget. */
export function deleteRoyaleSnapshot(gameId: string) {
  try {
    getActiveRoyalesCollection()
      .deleteOne({ gameId })
      .catch((err: unknown) =>
        console.error(
          `[royale] Failed to delete snapshot for ${gameId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[royale] Failed to delete snapshot for ${gameId}:`,
      utilities.errorMessage(err),
    );
  }
}

// ─── History ──────────────────────────────────────────────────────────

/**
 * Records a finished royale. The unique gameId index makes a double
 * save a no-op, mirroring the 1v1 history collection.
 */
export async function saveRoyaleResult(
  gameId: string,
  state: RoyaleState,
  winnerId: string,
) {
  const now = Date.now();
  const placements = [
    winnerId,
    ...state.eliminated.map((e) => e.userId).reverse(),
  ];
  try {
    await getDeathrollDb()
      .collection(ROYALE_HISTORY_COLLECTION)
      .insertOne({
        gameId,
        guildId: state.guildId,
        channelId: state.channelId,
        hostId: state.hostId,
        startingNumber: state.startingNumber,
        wager: state.wager,
        pot: computeRoyalePot(state.wager, state.players.length),
        players: state.players,
        placements,
        winnerId,
        rolls: state.rolls,
        totalRolls: state.rolls.length,
        rounds: state.round,
        startedAt: state.startedAt,
        endedAt: now,
        duration: state.startedAt ? now - state.startedAt : null,
        season: config.DEATHROLL_SEASON,
      });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      console.warn(`[royale] Game ${gameId} already saved — skipping`);
      return;
    }
    throw error;
  }
}

// ─── Boot Reconciliation ──────────────────────────────────────────────

interface RoyaleSnapshotDoc {
  gameId: string;
  guildId: string;
  channelId: string;
  currentMessageId: string | null;
  wager: number;
  phase: string;
  players: { userId: string; username: string }[];
}

/**
 * On boot: sweep royales interrupted by a restart. Marks the live game
 * message, refunds every player's wager, and deletes the snapshot.
 * One bad doc never aborts the loop.
 */
export async function reconcileInterruptedRoyales(client: Client) {
  let docs: RoyaleSnapshotDoc[];
  try {
    docs = (await getActiveRoyalesCollection()
      .find({})
      .toArray()) as unknown as RoyaleSnapshotDoc[];
  } catch (err: unknown) {
    console.error(
      "[royale] Failed to fetch interrupted royales:",
      utilities.errorMessage(err),
    );
    return;
  }

  if (docs.length === 0) return;
  console.log(
    `⚔️ [royale] Reconciling ${docs.length} interrupted royale${docs.length !== 1 ? "s" : ""} after restart`,
  );

  for (const doc of docs) {
    try {
      const guild = await client.guilds.fetch(doc.guildId).catch(() => null);

      if (guild && doc.channelId && doc.currentMessageId) {
        const channel = (await guild.channels
          .fetch(doc.channelId)
          .catch(() => null)) as GuildTextBasedChannel | null;
        if (channel && channel.isTextBased()) {
          const message = await channel.messages
            .fetch(doc.currentMessageId)
            .catch(() => null);
          if (message) {
            await message
              .edit({
                content:
                  message.content +
                  "\n\n⚠️ This royale was interrupted by a bot restart." +
                  (doc.wager > 0 ? " All wagers have been refunded." : ""),
                components: [],
              })
              .catch(() => {});
          }
        }
      }

      if (doc.wager > 0) {
        for (const player of doc.players || []) {
          await adjustGold(
            doc.guildId,
            player.userId,
            doc.wager,
            "royale_refund",
            { meta: { gameId: doc.gameId, restart: true } },
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        `[royale] Error reconciling ${doc.gameId}:`,
        utilities.errorMessage(err),
      );
    } finally {
      await getActiveRoyalesCollection()
        .deleteOne({ gameId: doc.gameId })
        .catch((err: unknown) =>
          console.error(
            `[royale] Failed to delete reconciled royale ${doc.gameId}:`,
            utilities.errorMessage(err),
          ),
        );
    }
  }
}
