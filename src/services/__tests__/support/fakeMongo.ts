// ============================================================
// fakeMongo — a tiny in-memory stand-in for a Mongo collection
// ============================================================
// Supports exactly what the agent-action code uses: equality (null
// matches missing), $lt/$lte/$gt/$gte/$in/$nin/$ne/$not/$or, $set/$inc
// updates, upserts, sort/limit, async-iterable find cursors, and UNIQUE
// indexes registered through createIndex (so the capped-upsert 11000
// path is exercised for real). aggregate() only records its pipeline.
// ============================================================

type Document = Record<string, unknown>;
type Filter = Record<string, unknown>;

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if ((a as number) < (b as number)) return -1;
  if ((a as number) > (b as number)) return 1;
  return 0;
}

function isEqual(left: unknown, right: unknown): boolean {
  if (right === null) return left === null || left === undefined;
  if (left instanceof Date || right instanceof Date) return compare(left, right) === 0;
  return left === right;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => key.startsWith("$"))
  );
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (!isOperatorObject(condition)) return isEqual(value, condition);
  return Object.entries(condition).every(([operator, operand]) => {
    const present = value !== undefined && value !== null;
    switch (operator) {
      case "$lt":
        return present && compare(value, operand) < 0;
      case "$lte":
        return present && compare(value, operand) <= 0;
      case "$gt":
        return present && compare(value, operand) > 0;
      case "$gte":
        return present && compare(value, operand) >= 0;
      case "$ne":
        return !isEqual(value, operand);
      case "$in":
        return (operand as unknown[]).some((item) => isEqual(value, item));
      case "$nin":
        return !(operand as unknown[]).some((item) => isEqual(value, item));
      case "$not":
        return !matchesCondition(value, operand);
      case "$type":
        return operand === "string" ? typeof value === "string" : present;
      default:
        throw new Error(`fakeMongo: unsupported operator ${operator}`);
    }
  });
}

/** `author.id` → document.author.id */
function valueAt(document: Document, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Document)[key] : undefined,
      document,
    );
}

export function matches(document: Document, filter: Filter): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") {
      return (condition as Filter[]).some((branch) => matches(document, branch));
    }
    return matchesCondition(valueAt(document, key), condition);
  });
}

function applyUpdate(document: Document, update: Document): void {
  for (const [operator, fields] of Object.entries(update)) {
    for (const [key, value] of Object.entries(fields as Document)) {
      if (operator === "$set") document[key] = value;
      else if (operator === "$inc") {
        document[key] = ((document[key] as number) ?? 0) + (value as number);
      } else throw new Error(`fakeMongo: unsupported update ${operator}`);
    }
  }
}

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

export class FakeCollection {
  documents: Document[] = [];
  uniqueIndexes: string[][] = [];
  createdIndexes: { spec: Document; options?: Document }[] = [];

  async createIndex(spec: Document, options?: Document) {
    this.createdIndexes.push({ spec, options });
    if (options?.unique) this.uniqueIndexes.push(Object.keys(spec));
    return Object.keys(spec).join("_");
  }

  #violatesUnique(candidate: Document, ignore?: Document): boolean {
    return this.uniqueIndexes.some((keys) => {
      if (keys.some((key) => candidate[key] === undefined)) return false;
      return this.documents.some(
        (existing) =>
          existing !== ignore &&
          keys.every((key) => isEqual(existing[key], candidate[key])),
      );
    });
  }

  #sorted(documents: Document[], sort?: Record<string, 1 | -1>): Document[] {
    if (!sort) return documents;
    const [[key, direction]] = Object.entries(sort);
    return [...documents].sort((a, b) => compare(a[key], b[key]) * direction);
  }

  async insertOne(document: Document) {
    if (this.#violatesUnique(document)) throw duplicateKeyError();
    this.documents.push(structuredClone(document));
    return { acknowledged: true };
  }

  async countDocuments(filter: Filter = {}) {
    return this.documents.filter((document) => matches(document, filter)).length;
  }

  async findOne(filter: Filter) {
    const found = this.documents.find((document) => matches(document, filter));
    return found ? structuredClone(found) : null;
  }

  find(filter: Filter = {}) {
    let sort: Record<string, 1 | -1> | undefined;
    let limit = Infinity;
    const results = () =>
      this.#sorted(
        this.documents.filter((document) => matches(document, filter)),
        sort,
      )
        .slice(0, limit)
        .map((document) => structuredClone(document));
    const cursor = {
      sort: (spec: Record<string, 1 | -1>) => {
        sort = spec;
        return cursor;
      },
      limit: (count: number) => {
        limit = count;
        return cursor;
      },
      toArray: async () => results(),
      async *[Symbol.asyncIterator]() {
        yield* results();
      },
    };
    return cursor;
  }

  /** Pipelines are recorded, not run — tests assert on their $match. */
  aggregatePipelines: Document[][] = [];

  aggregate(pipeline: Document[]) {
    this.aggregatePipelines.push(pipeline);
    return { toArray: async () => [] };
  }

  async findOneAndUpdate(
    filter: Filter,
    update: Document,
    options: { upsert?: boolean; sort?: Record<string, 1 | -1> } = {},
  ) {
    const [target] = this.#sorted(
      this.documents.filter((document) => matches(document, filter)),
      options.sort,
    );
    if (target) {
      const updated = structuredClone(target);
      applyUpdate(updated, update);
      if (this.#violatesUnique(updated, target)) throw duplicateKeyError();
      Object.assign(target, updated);
      return structuredClone(target);
    }
    if (!options.upsert) return null;
    const created: Document = {};
    for (const [key, condition] of Object.entries(filter)) {
      if (!key.startsWith("$") && !isOperatorObject(condition)) created[key] = condition;
    }
    applyUpdate(created, update);
    if (this.#violatesUnique(created)) throw duplicateKeyError();
    this.documents.push(created);
    return structuredClone(created);
  }

  async updateOne(filter: Filter, update: Document) {
    const target = this.documents.find((document) => matches(document, filter));
    if (!target) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(target, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

/** A `Db`-shaped object handing out one FakeCollection per name. */
export function createFakeDb() {
  const collections = new Map<string, FakeCollection>();
  return {
    collections,
    collection(name: string) {
      if (!collections.has(name)) collections.set(name, new FakeCollection());
      return collections.get(name)!;
    },
    /**
     * Drops every document but keeps the indexes — modules ensure their
     * indexes once per process, as they would against a real database.
     */
    reset() {
      for (const collection of collections.values()) {
        collection.documents = [];
        collection.aggregatePipelines = [];
      }
    },
  };
}
