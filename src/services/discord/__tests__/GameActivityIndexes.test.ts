import { describe, expect, it } from "vitest";
import type { Collection, Document } from "mongodb";
import {
  ensureGameActivityIndexes,
  mergeDuplicateGameActivity,
} from "../GameActivityIndexes.ts";

// PresenceTracker upserts GameActivity on `{ name }`; racing upserts left
// duplicate names, the unique index build failed on every boot, and the
// failure skipped every index after it. A tiny in-memory stand-in for the
// Mongo calls the helper makes — enough to hold it to the real semantics:
// a unique build fails with E11000 while a duplicate exists.

interface GameDocument {
  _id: number;
  name: string;
  count?: number;
}

function fakeCollection(
  documents: GameDocument[],
  { raceInOnFirstBuild }: { raceInOnFirstBuild?: GameDocument } = {},
) {
  let docs = documents.map((document) => ({ ...document }));
  const indexes: { name: string; unique?: boolean }[] = [{ name: "_id_" }];
  let builds = 0;
  const collection = {
    aggregate: () => ({
      toArray: async () => {
        const groups = new Map<string, GameDocument[]>();
        for (const document of [...docs].sort((a, b) => a._id - b._id)) {
          groups.set(document.name, [...(groups.get(document.name) ?? []), document]);
        }
        return [...groups.entries()]
          .filter(([, group]) => group.length > 1)
          .map(([name, group]) => ({
            _id: name,
            ids: group.map((document) => document._id),
            counts: group.map((document) => document.count),
          }));
      },
    }),
    updateOne: async (filter: { _id: number }, update: { $inc: { count: number } }) => {
      const document = docs.find((candidate) => candidate._id === filter._id)!;
      document.count = (document.count ?? 0) + update.$inc.count;
    },
    deleteMany: async (filter: { _id: { $in: number[] } }) => {
      const before = docs.length;
      docs = docs.filter((document) => !filter._id.$in.includes(document._id));
      return { deletedCount: before - docs.length };
    },
    indexes: async () => indexes,
    dropIndex: async (name: string) => {
      indexes.splice(indexes.findIndex((index) => index.name === name), 1);
    },
    createIndex: async (spec: Record<string, number>, options: { unique?: boolean } = {}) => {
      const name = `${Object.keys(spec)[0]}_${Object.values(spec)[0]}`;
      if (options.unique) {
        builds++;
        if (builds === 1 && raceInOnFirstBuild) docs.push({ ...raceInOnFirstBuild });
        const names = docs.map((document) => document.name);
        if (new Set(names).size !== names.length) {
          throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        }
      }
      indexes.push({ name, unique: options.unique });
    },
  };
  return {
    collection: collection as unknown as Collection<Document>,
    docs: () => docs,
    indexes,
  };
}

describe("mergeDuplicateGameActivity", () => {
  it("keeps the first document per name with the counts summed", async () => {
    const { collection, docs } = fakeCollection([
      { _id: 1, name: "Dota 2", count: 10 },
      { _id: 2, name: "Dota 2", count: 5 },
      { _id: 3, name: "Chess", count: 7 },
      { _id: 4, name: "Dota 2" },
    ]);

    expect(await mergeDuplicateGameActivity(collection)).toBe(2);
    expect(docs()).toEqual([
      { _id: 1, name: "Dota 2", count: 15 },
      { _id: 3, name: "Chess", count: 7 },
    ]);
  });
});

describe("ensureGameActivityIndexes", () => {
  it("merges duplicates, then builds the unique name and count indexes", async () => {
    const { collection, indexes } = fakeCollection([
      { _id: 1, name: "Dota 2", count: 1 },
      { _id: 2, name: "Dota 2", count: 1 },
    ]);

    expect(await ensureGameActivityIndexes(collection)).toEqual({ mergedDocuments: 1 });
    expect(indexes).toContainEqual({ name: "name_1", unique: true });
    expect(indexes.map((index) => index.name)).toContain("count_-1");
  });

  it("replaces a stale non-unique name index", async () => {
    const { collection, indexes } = fakeCollection([{ _id: 1, name: "Chess" }]);
    indexes.push({ name: "name_1", unique: false });

    await ensureGameActivityIndexes(collection);
    expect(indexes.filter((index) => index.name === "name_1")).toEqual([
      { name: "name_1", unique: true },
    ]);
  });

  it("merges again when an upsert races a duplicate in before the build", async () => {
    const { collection, docs } = fakeCollection([{ _id: 1, name: "Chess", count: 3 }], {
      raceInOnFirstBuild: { _id: 9, name: "Chess", count: 1 },
    });

    expect(await ensureGameActivityIndexes(collection)).toEqual({ mergedDocuments: 1 });
    expect(docs()).toEqual([{ _id: 1, name: "Chess", count: 4 }]);
  });
});
