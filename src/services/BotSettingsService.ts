// ============================================================
// Bot Settings — runtime-mutable moderation lists
//
// Mongo (BotSettings collection) is the source of truth for lists
// that change at runtime (ignores, timeouts, whitelists). Env values
// seed the collection exactly once ($setOnInsert); after that the
// lists are edited through /bot/settings without a redeploy.
//
// Reads are synchronous against an in-memory cache so hot paths
// (per-message filters) never touch Mongo; the cache refreshes on an
// interval and immediately after any mutation.
// ============================================================

import MongoService from "#root/services/MongoService.ts";
import config from "#root/config.ts";

const COLLECTION = "BotSettings";
const REFRESH_INTERVAL_MS = 60_000;

export const MANAGED_LIST_KEYS = [
  "ROLES_IDS_IGNORE",
  "USER_IDS_IGNORE",
  "USER_IDS_DISALLOWED",
  "USER_IDS_TIMED_OUT",
  "USER_IDS_POLITICS_MUTED",
  "USER_IDS_NEW_ACCOUNT_WHITELIST",
] as const;
export type ManagedListKey = (typeof MANAGED_LIST_KEYS)[number];

interface BotSettingsDocument {
  key: string;
  values: string[];
  updatedAt: Date;
}

const cache = new Map<ManagedListKey, string[]>();
let refreshTimer: NodeJS.Timeout | null = null;

function collection() {
  return MongoService.getDb("local").collection<BotSettingsDocument>(COLLECTION);
}

function isManagedKey(key: string): key is ManagedListKey {
  return (MANAGED_LIST_KEYS as readonly string[]).includes(key);
}

const BotSettingsService = {
  isManagedKey,

  /** Seed missing keys from env, warm the cache, start the refresh loop. */
  async initialize(): Promise<void> {
    await collection().createIndex({ key: 1 }, { unique: true });
    for (const key of MANAGED_LIST_KEYS) {
      await collection().updateOne(
        { key },
        {
          $setOnInsert: {
            key,
            values: (config[key] as string[]) ?? [],
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
    await BotSettingsService.refresh();
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        BotSettingsService.refresh().catch(() => {
          // Keep serving the last good cache on transient Mongo errors.
        });
      }, REFRESH_INTERVAL_MS);
      refreshTimer.unref?.();
    }
  },

  async refresh(): Promise<void> {
    const documents = await collection()
      .find({ key: { $in: [...MANAGED_LIST_KEYS] } })
      .toArray();
    for (const document of documents) {
      cache.set(
        document.key as ManagedListKey,
        (document.values as string[]) ?? [],
      );
    }
  },

  /** Synchronous cached read; env fallback before initialize() completes. */
  get(key: ManagedListKey): string[] {
    return cache.get(key) ?? ((config[key] as string[]) || []);
  },

  list(): Record<ManagedListKey, string[]> {
    return Object.fromEntries(
      MANAGED_LIST_KEYS.map((key) => [key, BotSettingsService.get(key)]),
    ) as Record<ManagedListKey, string[]>;
  },

  /** Add/remove ids on a list; returns the updated list. */
  async update(
    key: ManagedListKey,
    changes: { add?: string[]; remove?: string[] },
  ): Promise<string[]> {
    const add = (changes.add ?? []).map((value) => value.trim()).filter(Boolean);
    const remove = (changes.remove ?? []).map((value) => value.trim()).filter(Boolean);
    if (add.length) {
      await collection().updateOne(
        { key },
        { $addToSet: { values: { $each: add } }, $set: { updatedAt: new Date() } },
        { upsert: true },
      );
    }
    if (remove.length) {
      await collection().updateOne(
        { key },
        { $pull: { values: { $in: remove } }, $set: { updatedAt: new Date() } },
      );
    }
    await BotSettingsService.refresh();
    return BotSettingsService.get(key);
  },

  stop(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  },
};

export default BotSettingsService;
