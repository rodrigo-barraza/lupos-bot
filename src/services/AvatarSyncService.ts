// ============================================================
// AvatarSyncService — mood portrait → Discord profile avatar
// ============================================================
// Keeps the bot account's actual Discord avatar (member list, profile
// popout, DMs) in sync with the mood-set portrait the dashboard already
// shows. Discord rate-limits PATCH /users/@me avatar changes hard
// (roughly two per hour, with long retry-afters when exceeded), so this
// deliberately tracks the slow timescale of the somatic engine rather
// than per-message mood swings:
// - re-resolve the portrait every CHECK interval,
// - only call setAvatar when the key actually changed AND the minimum
//   spacing since the last change has passed,
// - back off for an hour after any failure (the rate-limit error is the
//   expected one).
// Only live prism-service state drives a change — when prism is down we
// skip the tick entirely instead of letting the vestigial TraitRegistry
// stub flap the avatar to neutral.
//
// The last applied key is persisted in Mongo (lupos.BotState) so a
// restart doesn't burn one of the ~2/hour changes re-applying the
// portrait Discord already has.

import path from "path";
import { fileURLToPath } from "url";

import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import MongoService from "#root/services/MongoService.js";
import PrismService from "#root/services/PrismService.js";
import {
  formatSomaticStats,
  formatEmotionDetail,
  type PrismSomaticSnapshot,
} from "#root/formatters/SomaticStatsFormatter.js";
import { resolveAvatarState } from "#root/formatters/AvatarStateFormatter.js";

const CHECK_INTERVAL_MILLISECONDS = 5 * 60_000;
// Half of Discord's ~2 changes/hour budget, so a manual avatar change or
// a restart race never stacks into the limit.
export const MIN_CHANGE_INTERVAL_MILLISECONDS = 30 * 60_000;
const FAILURE_BACKOFF_MILLISECONDS = 60 * 60_000;

const MOOD_SET_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../images/mood-set",
);

export interface AvatarSyncState {
  /** Portrait key Discord is currently wearing; null when unknown. */
  lastAppliedKey: string | null;
  /** When the avatar was last changed; 0 when unknown (always eligible). */
  lastChangeAtMs: number;
  /** Skip all attempts until this time after a setAvatar failure. */
  backoffUntilMs: number;
}

export interface AvatarSyncDecision {
  apply: boolean;
  reason: string;
}

/**
 * Pure throttle decision: change the avatar only when the resolved
 * portrait differs from what Discord is wearing, outside both the
 * failure backoff and the minimum spacing between changes.
 */
export function evaluateAvatarSync(
  resolvedKey: string,
  state: AvatarSyncState,
  nowMs: number,
): AvatarSyncDecision {
  if (nowMs < state.backoffUntilMs) {
    const waitSeconds = Math.round((state.backoffUntilMs - nowMs) / 1000);
    return { apply: false, reason: `backing off after failure (${waitSeconds}s left)` };
  }
  if (resolvedKey === state.lastAppliedKey) {
    return { apply: false, reason: "already wearing this portrait" };
  }
  const sinceChangeMs = nowMs - state.lastChangeAtMs;
  if (sinceChangeMs < MIN_CHANGE_INTERVAL_MILLISECONDS) {
    const waitSeconds = Math.round(
      (MIN_CHANGE_INTERVAL_MILLISECONDS - sinceChangeMs) / 1000,
    );
    return { apply: false, reason: `throttled (${waitSeconds}s until next change)` };
  }
  return { apply: true, reason: "portrait changed" };
}

const state: AvatarSyncState = {
  lastAppliedKey: null,
  lastChangeAtMs: 0,
  backoffUntilMs: 0,
};
let stateLoaded = false;

interface BotStateDocument {
  _id: string;
  lastAppliedKey: string;
  lastChangeAt: Date;
}

function botStateCollection() {
  const client = MongoService.getClient("local");
  if (!client) return null;
  return client.db("lupos").collection<BotStateDocument>("BotState");
}

/** Restore the persisted key once, so restarts don't re-apply it. */
async function loadPersistedState(): Promise<void> {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const document = await botStateCollection()?.findOne({ _id: "avatarSync" });
    if (document) {
      state.lastAppliedKey = document.lastAppliedKey;
      state.lastChangeAtMs = document.lastChangeAt?.getTime() ?? 0;
    }
  } catch (error: unknown) {
    // Memory-only from here; worst case is one redundant change per restart.
    console.warn(
      `🖼️ [AvatarSyncService] Could not load persisted state: ${(error as Error).message}`,
    );
  }
}

async function persistState(): Promise<void> {
  try {
    await botStateCollection()?.updateOne(
      { _id: "avatarSync" },
      {
        $set: {
          lastAppliedKey: state.lastAppliedKey as string,
          lastChangeAt: new Date(state.lastChangeAtMs),
        },
      },
      { upsert: true },
    );
  } catch (error: unknown) {
    console.warn(
      `🖼️ [AvatarSyncService] Could not persist state: ${(error as Error).message}`,
    );
  }
}

async function syncOnce(): Promise<void> {
  let client;
  try {
    client = DiscordWrapper.getClient("lupos");
  } catch {
    return; // client not created yet
  }
  if (!client.isReady()) return;

  await loadPersistedState();

  // Live prism state only — same validity check as GET /bot/stats.
  let snapshot: PrismSomaticSnapshot;
  try {
    snapshot =
      (await PrismService.getSomaticSnapshot()) as unknown as PrismSomaticSnapshot;
    if (!snapshot?.emotion || !snapshot?.hunger) return;
  } catch {
    return; // prism down — leave the avatar alone
  }

  const avatar = resolveAvatarState(
    formatSomaticStats(snapshot),
    formatEmotionDetail(snapshot.emotion),
  );

  const decision = evaluateAvatarSync(avatar.key, state, Date.now());
  if (!decision.apply) return;

  try {
    await client.user.setAvatar(
      path.join(MOOD_SET_DIRECTORY, `${avatar.key}.png`),
    );
    state.lastAppliedKey = avatar.key;
    state.lastChangeAtMs = Date.now();
    await persistState();
    console.log(
      `🖼️ [AvatarSyncService] Avatar updated to ${avatar.key} (${avatar.label}, via ${avatar.source})`,
    );
  } catch (error: unknown) {
    // Most likely Discord's "changing your avatar too fast" rate limit;
    // either way, hold off long enough for the limit to clear.
    state.backoffUntilMs = Date.now() + FAILURE_BACKOFF_MILLISECONDS;
    console.warn(
      `🖼️ [AvatarSyncService] setAvatar(${avatar.key}) failed, backing off ${FAILURE_BACKOFF_MILLISECONDS / 60_000}m: ${(error as Error).message}`,
    );
  }
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

const AvatarSyncService = {
  /**
   * Start the sync loop. Safe to call before the Discord client exists —
   * every tick self-guards on client readiness and prism availability.
   * No-op when already running.
   */
  startAvatarSync(): void {
    if (syncInterval) return;
    void syncOnce();
    syncInterval = setInterval(() => {
      void syncOnce();
    }, CHECK_INTERVAL_MILLISECONDS);
    // Don't let the sync loop keep a shutting-down process alive
    syncInterval.unref?.();
    console.log(
      `🖼️ [AvatarSyncService] Mood avatar sync started (check every ${CHECK_INTERVAL_MILLISECONDS / 60_000}m, change at most every ${MIN_CHANGE_INTERVAL_MILLISECONDS / 60_000}m)`,
    );
  },

  stopAvatarSync(): void {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  },

  evaluateAvatarSync,
};

export default AvatarSyncService;
