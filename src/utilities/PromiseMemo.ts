// ============================================================
// PromiseMemo — share one in-flight or recent async result per key
// ============================================================
// Two callers asking for the same thing at once (the history extraction
// and the reference-image step both hashing one image) share a single
// request, and a result stays reusable for a TTL (the next turn in the
// channel re-reads the same window). A null result means "nothing
// definitive" (a failure, a transient error) and a rejection is a
// failure too: either is handed to whoever was waiting and then
// forgotten, so the next caller tries afresh — exactly as without the
// memo.
// ============================================================

import BoundedMap from "#root/utilities/BoundedMap.ts";

/**
 * Start background work whose result only warms a memo: a failure —
 * thrown synchronously or rejected — is dropped, never surfaced.
 */
export function prefetch(start: () => Promise<unknown>): void {
  try {
    void start().catch(() => {});
  } catch {
    // A prefetch never breaks its caller.
  }
}

export default class PromiseMemo<V> {
  private readonly entries: BoundedMap<string, Promise<V | null>>;

  constructor(maxSize: number, ttlMs: number) {
    this.entries = new BoundedMap(maxSize, ttlMs);
  }

  /** The memoized result for `key`, or `produce()`'s (shared while pending). */
  async get(key: string, produce: () => Promise<V | null>): Promise<V | null> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const pending = produce();
    this.entries.set(key, pending);
    const forget = () => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    };
    try {
      const value = await pending;
      if (value === null) forget();
      return value;
    } catch (error: unknown) {
      forget();
      throw error;
    }
  }

  /** Test hook. */
  clear(): void {
    this.entries.clear();
  }
}
