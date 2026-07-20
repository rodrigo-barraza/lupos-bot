/**
 * Crash-safe persistence for in-flight deathroll games (P1.23).
 *
 * Every state change upserts a compact snapshot to the
 * `DeathrollActiveGames` collection; the doc is deleted when the game
 * resolves (result saved, declined, or expired). On boot,
 * `reconcileInterruptedGames` sweeps leftover docs: it marks the game
 * message as interrupted, applies any pending timeout, and saves the
 * result when the outcome was already determined (DoN-pending phase).
 */

import type { Client, GuildTextBasedChannel } from "discord.js";
import utilities from "#root/utilities.ts";
import { tryTimeoutMember } from "../commandUtils.ts";
import { adjustGold } from "../gold/goldRepository.ts";
import { getDeathrollDb, saveGameResult } from "./repository.ts";
import type {
  DeathrollGameSnapshot,
  GamePhase,
  GameState,
  PendingTimeoutData,
} from "./types.ts";

const ACTIVE_GAMES_COLLECTION = "DeathrollActiveGames";

let activeGamesIndexEnsured = false;

function getActiveGamesCollection() {
  const collection = getDeathrollDb().collection(ACTIVE_GAMES_COLLECTION);
  if (!activeGamesIndexEnsured) {
    activeGamesIndexEnsured = true;
    collection
      .createIndex({ gameId: 1 }, { unique: true })
      .catch((err: unknown) =>
        console.error(
          "Failed to ensure DeathrollActiveGames index:",
          utilities.errorMessage(err),
        ),
      );
  }
  return collection;
}

// ─── Snapshot Building & Writing ──────────────────────────────────────

/**
 * Builds the compact snapshot document for an in-flight game.
 * Pure — exported for unit tests.
 */
export function buildGameSnapshot(
  gameId: string,
  guildId: string,
  game: GameState,
  phase: GamePhase,
  extras?: {
    pendingTimeout?: PendingTimeoutData;
    pendingResult?: DeathrollGameSnapshot["pendingResult"];
  },
): DeathrollGameSnapshot {
  const snapshot: DeathrollGameSnapshot = {
    gameId,
    guildId,
    channelId: game.channelId,
    messageId: game.messageId,
    currentMessageId: game.currentMessageId,
    initiator: game.initiator,
    initiatorName: game.initiatorName,
    opponent: game.opponent,
    opponentName: game.opponentName,
    currentTurn: game.currentTurn,
    currentMax: game.currentNumber,
    startingNumber: game.startingNumber,
    timeoutMultiplier: game.timeoutMultiplier || 1,
    wager: game.wager || 0,
    phase,
    rolls: game.rolls,
    startedAt: game.startedAt,
    updatedAt: Date.now(),
  };
  if (extras?.pendingTimeout) snapshot.pendingTimeout = extras.pendingTimeout;
  if (extras?.pendingResult) snapshot.pendingResult = extras.pendingResult;
  return snapshot;
}

/**
 * Upserts the snapshot for a game. Fire-and-forget: never throws and never
 * blocks game flow on Mongo availability.
 */
export function persistGameSnapshot(
  gameId: string,
  guildId: string,
  game: GameState,
  phase: GamePhase,
  extras?: {
    pendingTimeout?: PendingTimeoutData;
    pendingResult?: DeathrollGameSnapshot["pendingResult"];
  },
): void {
  try {
    const snapshot = buildGameSnapshot(gameId, guildId, game, phase, extras);
    // pendingTimeout/pendingResult are cleared unless re-provided so a
    // phase rollback (e.g. DoN accepted) can't leave stale outcome data.
    const unset = buildUnsetFields(extras);
    const update =
      Object.keys(unset).length > 0
        ? { $set: snapshot, $unset: unset }
        : { $set: snapshot };
    getActiveGamesCollection()
      .updateOne({ gameId }, update, { upsert: true })
      .catch((err: unknown) =>
        console.error(
          `[deathroll] Failed to persist snapshot for ${gameId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[deathroll] Failed to persist snapshot for ${gameId}:`,
      utilities.errorMessage(err),
    );
  }
}

function buildUnsetFields(extras?: {
  pendingTimeout?: PendingTimeoutData;
  pendingResult?: DeathrollGameSnapshot["pendingResult"];
}) {
  const unset: Record<string, ""> = {};
  if (!extras?.pendingTimeout) unset.pendingTimeout = "";
  if (!extras?.pendingResult) unset.pendingResult = "";
  return unset;
}

/**
 * Deletes the snapshot for a resolved game (result saved, declined, or
 * expired). Fire-and-forget: never throws.
 */
export function deleteGameSnapshot(gameId: string): void {
  try {
    getActiveGamesCollection()
      .deleteOne({ gameId })
      .catch((err: unknown) =>
        console.error(
          `[deathroll] Failed to delete snapshot for ${gameId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[deathroll] Failed to delete snapshot for ${gameId}:`,
      utilities.errorMessage(err),
    );
  }
}

// ─── Boot Reconciliation ──────────────────────────────────────────────

/**
 * Rebuilds a GameState from a snapshot so saveGameResult can record it.
 */
function snapshotToGameState(doc: DeathrollGameSnapshot): GameState {
  return {
    initiator: doc.initiator,
    initiatorName: doc.initiatorName,
    opponent: doc.opponent,
    opponentName: doc.opponentName,
    targetUserId: null,
    currentNumber: doc.currentMax,
    currentTurn: doc.currentTurn,
    messageId: doc.messageId,
    channelId: doc.channelId,
    startingNumber: doc.startingNumber,
    rolls: doc.rolls || [],
    startedAt: doc.startedAt,
    currentMessageId: doc.currentMessageId,
    timeoutMultiplier: doc.timeoutMultiplier || 1,
    wager: doc.wager || 0,
  };
}

/**
 * On boot: sweep leftover DeathrollActiveGames docs from before a restart.
 * For each doc, best-effort:
 *  1. Edit the live game message to say the game was interrupted (and
 *     strip its buttons so stale collectors can't be clicked).
 *  2. Apply a pending timeout if one was recorded (DoN offer never resolved).
 *  3. Save the game result if the outcome was already determined.
 * Each doc is deleted after handling; one bad doc never aborts the loop.
 */
export async function reconcileInterruptedGames(client: Client) {
  let docs: DeathrollGameSnapshot[];
  try {
    docs = (await getActiveGamesCollection()
      .find({})
      .toArray()) as unknown as DeathrollGameSnapshot[];
  } catch (err: unknown) {
    console.error(
      "[deathroll] Failed to fetch interrupted games:",
      utilities.errorMessage(err),
    );
    return;
  }

  if (docs.length === 0) return;
  console.log(
    `🎲 [deathroll] Reconciling ${docs.length} interrupted game${docs.length !== 1 ? "s" : ""} after restart`,
  );

  for (const doc of docs) {
    try {
      const guild = await client.guilds.fetch(doc.guildId).catch(() => null);

      // 1. Mark the live game message as interrupted and remove buttons.
      const liveMessageId = doc.currentMessageId;
      if (guild && doc.channelId && liveMessageId) {
        const channel = (await guild.channels
          .fetch(doc.channelId)
          .catch(() => null)) as GuildTextBasedChannel | null;
        if (channel && channel.isTextBased()) {
          const message = await channel.messages
            .fetch(liveMessageId)
            .catch(() => null);
          if (message) {
            await message
              .edit({
                content:
                  message.content +
                  "\n\n⚠️ This deathroll game was interrupted by a bot restart.",
                components: [],
              })
              .catch(() => {});
          }
        }
      }

      // 2. Apply a recorded pending timeout (loser lost, DoN never resolved).
      if (guild && doc.pendingTimeout) {
        const member = await guild.members
          .fetch(doc.pendingTimeout.loserId)
          .catch(() => null);
        if (member) {
          const timeoutMinutes = doc.pendingTimeout.timeoutDuration / 60000;
          const result = await tryTimeoutMember(
            member,
            doc.pendingTimeout.timeoutDuration,
            `Lost a deathroll game (${timeoutMinutes}min) — applied after bot restart`,
          );
          if (!result.ok) {
            console.warn(
              `[deathroll] Could not apply post-restart timeout to ${doc.pendingTimeout.loserId}: ${result.error}`,
            );
          }
        }
      }

      // 3. Save the result when the outcome was already determined
      //    (saveGameResult also pays out any escrowed wager pot).
      if (doc.phase === "don_pending" && doc.pendingResult) {
        await saveGameResult(
          doc.guildId,
          snapshotToGameState(doc),
          doc.pendingResult.winnerId,
          doc.pendingResult.loserId,
          doc.pendingResult.winnerInfo,
          doc.pendingResult.loserInfo,
          "interrupted",
        ).catch((err: unknown) =>
          console.error(
            `[deathroll] Failed to save interrupted game ${doc.gameId}:`,
            utilities.errorMessage(err),
          ),
        );
      } else if ((doc.wager || 0) > 0) {
        // No result was ever determined — the game is voided, so return
        // the escrowed wagers to everyone who paid in.
        await adjustGold(
          doc.guildId,
          doc.initiator,
          doc.wager,
          "deathroll_refund",
          { meta: { gameId: doc.gameId, restart: true } },
        );
        if (doc.opponent) {
          await adjustGold(
            doc.guildId,
            doc.opponent,
            doc.wager,
            "deathroll_refund",
            { meta: { gameId: doc.gameId, restart: true } },
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        `[deathroll] Error reconciling game ${doc.gameId}:`,
        utilities.errorMessage(err),
      );
    } finally {
      await getActiveGamesCollection()
        .deleteOne({ gameId: doc.gameId })
        .catch((err: unknown) =>
          console.error(
            `[deathroll] Failed to delete reconciled game ${doc.gameId}:`,
            utilities.errorMessage(err),
          ),
        );
    }
  }
}
