// ============================================================
// BoundedMap — Time + Size Bounded Map for Memory Safety
// ============================================================
// Prevents unbounded growth of in-memory lookup tables by
// auto-evicting entries that exceed a TTL or max size limit.
//
// Drop-in replacement for plain objects `{}` used as maps.
// ============================================================

class BoundedMap {
  constructor(maxSize = 5000, ttlMs = 2 * 60 * 60 * 1000) {
    this._map = new Map();       // key → { value, timestamp }
    this._maxSize = maxSize;
    this._ttlMs = ttlMs;
  }

  /**
   * Get a value, returning undefined if expired or missing.
   */
  get(key: any) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this._ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: any) {
    return this.get(key) !== undefined;
  }

  /**
   * Set a key-value pair. Evicts oldest entries if over capacity.
   */
  set(key: any, value: any) {
    // Delete first so re-inserts move to end (Map insertion order)
    this._map.delete(key);
    this._map.set(key, { value, timestamp: Date.now() });
    this._evictIfNeeded();
    return this;
  }

  /**
   * Delete a key.
   */
  delete(key: any) {
    return this._map.delete(key);
  }

  /**
   * Number of entries (including potentially expired ones).
   * Use sparingly — does not trigger cleanup.
   */
  get size() {
    return this._map.size;
  }

  /**
   * Clear all entries.
   */
  clear() {
    this._map.clear();
  }

  /**
   * Evict oldest entries when over max size.
   * @private
   */
  _evictIfNeeded() {
    while (this._map.size > this._maxSize) {
      // Map iteration order is insertion order — first key is oldest
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
  }

  /**
   * Run a periodic sweep of expired entries.
   * Call this on a setInterval if you want proactive cleanup.
   */
  sweep() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now - entry.timestamp > this._ttlMs) {
        this._map.delete(key);
      }
    }
  }
}

export default BoundedMap;
