/**
 * Persistence for Heist the Hoard: crash-safe snapshots (a restart
 * refunds every crew member's stake and voids the heist), the finished
 * heist history, and the per-guild cooldown check.
 */

import type { Client, GuildTextBasedChannel } from "discord.js";
import utilities from "#root/utilities.ts";
import { getMongoDb } from "../commandUtils.ts";
import { adjustGold } from "../gold/goldRepository.ts";
import { HEIST_COOLDOWN_MS } from "./heistMath.ts";
import type { HeistState } from "./heistGame.ts";

const ACTIVE_HEISTS_COLLECTION = "LuposActiveHeists";
const HEIST_HISTORY_COLLECTION = "LuposHeistHistory";

let heistIndexesEnsured = false;

function getActiveHeistsCollection() {
  const collection = getMongoDb().collection(ACTIVE_HEISTS_COLLECTION);
  if (!heistIndexesEnsured) {
    heistIndexesEnsured = true;
    Promise.all([
      collection.createIndex({ heistId: 1 }, { unique: true }),
      getMongoDb()
        .collection(HEIST_HISTORY_COLLECTION)
        .createIndex({ guildId: 1, endedAt: -1 }),
    ]).catch((err: unknown) =>
      console.error(
        "Failed to ensure heist indexes:",
        utilities.errorMessage(err),
      ),
    );
  }
  return collection;
}

// ─── Snapshots ────────────────────────────────────────────────────────

/** Fire-and-forget snapshot upsert for boot reconciliation. */
export function persistHeistSnapshot(heistId: string, state: HeistState) {
  try {
    getActiveHeistsCollection()
      .updateOne(
        { heistId },
        {
          $set: {
            heistId,
            guildId: state.guildId,
            channelId: state.channelId,
            currentMessageId: state.currentMessageId,
            hostId: state.hostId,
            buyin: state.buyin,
            phase: state.phase,
            crew: state.crew,
            updatedAt: Date.now(),
          },
        },
        { upsert: true },
      )
      .catch((err: unknown) =>
        console.error(
          `[heist] Failed to persist snapshot for ${heistId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[heist] Failed to persist snapshot for ${heistId}:`,
      utilities.errorMessage(err),
    );
  }
}

/** Fire-and-forget snapshot delete once the heist resolves. */
export function deleteHeistSnapshot(heistId: string) {
  try {
    getActiveHeistsCollection()
      .deleteOne({ heistId })
      .catch((err: unknown) =>
        console.error(
          `[heist] Failed to delete snapshot for ${heistId}:`,
          utilities.errorMessage(err),
        ),
      );
  } catch (err: unknown) {
    console.error(
      `[heist] Failed to delete snapshot for ${heistId}:`,
      utilities.errorMessage(err),
    );
  }
}

// ─── History & Cooldown ───────────────────────────────────────────────

/**
 * Records a finished heist. Also the data source for the guild cooldown.
 */
export async function saveHeistResult(
  heistId: string,
  state: HeistState,
  outcome: {
    tier: string;
    successes: number;
    loot: number;
    stageResults: { kind: string; pointId: string; success: boolean }[];
  },
) {
  const now = Date.now();
  try {
    await getMongoDb().collection(HEIST_HISTORY_COLLECTION).insertOne({
      heistId,
      guildId: state.guildId,
      channelId: state.channelId,
      hostId: state.hostId,
      buyin: state.buyin,
      crew: state.crew,
      tier: outcome.tier,
      successes: outcome.successes,
      loot: outcome.loot,
      stageResults: outcome.stageResults,
      startedAt: state.createdAt,
      endedAt: now,
    });
  } catch (err: unknown) {
    console.error(
      `[heist] Failed to save history for ${heistId}:`,
      utilities.errorMessage(err),
    );
  }
}

/**
 * Milliseconds until this guild may heist again (0 = ready now).
 * The cooldown runs from the END of the last completed heist.
 */
export async function getHeistCooldownRemaining(
  guildId: string,
): Promise<number> {
  try {
    const last = await getMongoDb()
      .collection(HEIST_HISTORY_COLLECTION)
      .find({ guildId })
      .sort({ endedAt: -1 })
      .limit(1)
      .toArray();
    if (last.length === 0) return 0;
    const elapsed = Date.now() - (last[0].endedAt as number);
    return Math.max(0, HEIST_COOLDOWN_MS - elapsed);
  } catch (err: unknown) {
    console.error(
      "[heist] Cooldown check failed:",
      utilities.errorMessage(err),
    );
    return 0;
  }
}

// ─── Boot Reconciliation ──────────────────────────────────────────────

interface HeistSnapshotDoc {
  heistId: string;
  guildId: string;
  channelId: string;
  currentMessageId: string | null;
  buyin: number;
  crew: { userId: string; username: string }[];
}

/**
 * On boot: mark interrupted heists and refund every crew member's
 * stake. A restart voids the heist — nobody loses gold to a redeploy.
 */
export async function reconcileInterruptedHeists(client: Client) {
  let docs: HeistSnapshotDoc[];
  try {
    docs = (await getActiveHeistsCollection()
      .find({})
      .toArray()) as unknown as HeistSnapshotDoc[];
  } catch (err: unknown) {
    console.error(
      "[heist] Failed to fetch interrupted heists:",
      utilities.errorMessage(err),
    );
    return;
  }

  if (docs.length === 0) return;
  console.log(
    `🏦 [heist] Reconciling ${docs.length} interrupted heist${docs.length !== 1 ? "s" : ""} after restart`,
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
                  "\n\n⚠️ The heist was interrupted by a bot restart — all stakes refunded. The wolf stirs, none the wiser.",
                components: [],
              })
              .catch(() => {});
          }
        }
      }

      for (const member of doc.crew || []) {
        await adjustGold(
          doc.guildId,
          member.userId,
          doc.buyin,
          "heist_refund",
          {
            meta: { heistId: doc.heistId, restart: true },
          },
        );
      }
    } catch (err: unknown) {
      console.error(
        `[heist] Error reconciling ${doc.heistId}:`,
        utilities.errorMessage(err),
      );
    } finally {
      await getActiveHeistsCollection()
        .deleteOne({ heistId: doc.heistId })
        .catch((err: unknown) =>
          console.error(
            `[heist] Failed to delete reconciled heist ${doc.heistId}:`,
            utilities.errorMessage(err),
          ),
        );
    }
  }
}
