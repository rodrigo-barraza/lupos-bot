// ============================================================
// GameActivity indexes — merge the duplicates, then index
//
// PresenceTracker counts "now playing" by upserting on `{ name }`. With no
// unique index, two presence updates racing on a new game each insert, so
// the collection held 81 duplicated names (2026-09-22) — and that made the
// unique `name_1` build fail on every boot. The failure threw out of the
// shared index block in luposOnReady, so GameActivity had NO index at all
// (every presence upsert scanned ~74K documents) and the ActiveStreamers
// index after it was never ensured either.
//
// Duplicates are merged into one document per name (counts summed) before
// the unique index is built; an upsert that races in a new duplicate
// between the merge and the build gets merged on the next attempt.
// ============================================================

import type { Collection, Document, ObjectId } from "mongodb";

const MAX_ATTEMPTS = 3;
const DUPLICATE_KEY_ERROR = 11000;

/** Fold every duplicated `name` into its first document, summing `count`. Returns documents removed. */
export async function mergeDuplicateGameActivity(
  collection: Collection<Document>,
): Promise<number> {
  const duplicates = await collection
    .aggregate<{ _id: string; ids: ObjectId[]; counts: unknown[] }>([
      { $sort: { _id: 1 } },
      {
        $group: {
          _id: "$name",
          ids: { $push: "$_id" },
          counts: { $push: "$count" },
          documents: { $sum: 1 },
        },
      },
      { $match: { documents: { $gt: 1 } } },
    ])
    .toArray();

  let removed = 0;
  for (const duplicate of duplicates) {
    const [keptId, ...extraIds] = duplicate.ids;
    const extraCount = duplicate.counts
      .slice(1)
      .reduce<number>(
        (sum, count) => sum + (typeof count === "number" ? count : 0),
        0,
      );
    if (extraCount > 0) {
      await collection.updateOne({ _id: keptId }, { $inc: { count: extraCount } });
    }
    const result = await collection.deleteMany({ _id: { $in: extraIds } });
    removed += result.deletedCount;
  }
  return removed;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY_ERROR;
}

/** Unique `name` + descending `count`, merging duplicates first. Throws only after MAX_ATTEMPTS. */
export async function ensureGameActivityIndexes(
  collection: Collection<Document>,
): Promise<{ mergedDocuments: number }> {
  const existingIndexes = await collection.indexes();
  const staleNameIndex = existingIndexes.find(
    (existingIndex) => existingIndex.name === "name_1" && !existingIndex.unique,
  );
  if (staleNameIndex) await collection.dropIndex("name_1");

  let mergedDocuments = 0;
  for (let attempt = 1; ; attempt++) {
    mergedDocuments += await mergeDuplicateGameActivity(collection);
    try {
      await collection.createIndex({ name: 1 }, { unique: true, background: true });
      break;
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
  await collection.createIndex({ count: -1 }, { background: true });
  return { mergedDocuments };
}
