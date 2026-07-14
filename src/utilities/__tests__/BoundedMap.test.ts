import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BoundedMap from "../BoundedMap.js";

describe("BoundedMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic map behavior", () => {
    it("stores and retrieves values", () => {
      const map = new BoundedMap<string, number>();
      map.set("a", 1);
      expect(map.get("a")).toBe(1);
      expect(map.has("a")).toBe(true);
      expect(map.size).toBe(1);
    });

    it("returns undefined for missing keys", () => {
      const map = new BoundedMap<string, number>();
      expect(map.get("missing")).toBeUndefined();
      expect(map.has("missing")).toBe(false);
    });

    it("overwrites on repeated set", () => {
      const map = new BoundedMap<string, number>();
      map.set("a", 1);
      map.set("a", 2);
      expect(map.get("a")).toBe(2);
      expect(map.size).toBe(1);
    });

    it("deletes keys and clears everything", () => {
      const map = new BoundedMap<string, number>();
      map.set("a", 1);
      map.set("b", 2);
      expect(map.delete("a")).toBe(true);
      expect(map.get("a")).toBeUndefined();
      map.clear();
      expect(map.size).toBe(0);
    });
  });

  describe("size-based eviction", () => {
    it("evicts the oldest entry when over capacity", () => {
      const map = new BoundedMap<string, number>(3);
      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);
      map.set("d", 4);
      expect(map.size).toBe(3);
      expect(map.get("a")).toBeUndefined();
      expect(map.get("b")).toBe(2);
      expect(map.get("d")).toBe(4);
    });

    it("treats a re-set key as most recently used", () => {
      const map = new BoundedMap<string, number>(3);
      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);
      map.set("a", 10); // refresh "a" — "b" is now oldest
      map.set("d", 4);
      expect(map.get("b")).toBeUndefined();
      expect(map.get("a")).toBe(10);
    });
  });

  describe("TTL-based expiry", () => {
    it("expires entries lazily on get", () => {
      const map = new BoundedMap<string, number>(100, 1000);
      map.set("a", 1);
      vi.advanceTimersByTime(999);
      expect(map.get("a")).toBe(1);
      vi.advanceTimersByTime(2);
      expect(map.get("a")).toBeUndefined();
      expect(map.has("a")).toBe(false);
    });

    it("refreshes the TTL clock on re-set", () => {
      const map = new BoundedMap<string, number>(100, 1000);
      map.set("a", 1);
      vi.advanceTimersByTime(900);
      map.set("a", 2);
      vi.advanceTimersByTime(900);
      expect(map.get("a")).toBe(2);
    });

    it("sweep() proactively removes only expired entries", () => {
      const map = new BoundedMap<string, number>(100, 1000);
      map.set("old", 1);
      vi.advanceTimersByTime(600);
      map.set("fresh", 2);
      vi.advanceTimersByTime(500); // "old" is 1100ms old, "fresh" is 500ms old
      map.sweep();
      expect(map.size).toBe(1);
      expect(map.get("fresh")).toBe(2);
    });
  });

  describe("getOrInsert / getOrInsertComputed", () => {
    it("returns existing values without replacing them", () => {
      const map = new BoundedMap<string, number>();
      map.set("a", 1);
      expect(map.getOrInsert("a", 99)).toBe(1);
      expect(map.getOrInsert("b", 99)).toBe(99);
      expect(map.get("b")).toBe(99);
    });

    it("only runs the factory on a miss", () => {
      const map = new BoundedMap<string, number>();
      const factory = vi.fn(() => 42);
      expect(map.getOrInsertComputed("a", factory)).toBe(42);
      expect(map.getOrInsertComputed("a", factory)).toBe(42);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("re-inserts through the factory after TTL expiry", () => {
      const map = new BoundedMap<string, number>(100, 1000);
      const factory = vi.fn(() => 7);
      map.getOrInsertComputed("a", factory);
      vi.advanceTimersByTime(1001);
      map.getOrInsertComputed("a", factory);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });
});
