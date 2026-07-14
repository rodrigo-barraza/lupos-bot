// ============================================================
// Miscellaneous utilities — array comparison, random intervals.
// ============================================================

/** Deep-compare two arrays of flat objects, ignoring order. */
export function areArraysEqual(
  array1: Record<string, unknown>[],
  array2: Record<string, unknown>[],
) {
  return (
    array1.length === array2.length &&
    array1.every((item1) =>
      array2.some(
        (item2) =>
          Object.keys(item1).length === Object.keys(item2).length &&
          Object.entries(item1).every(
            ([key, value]) =>
              Object.prototype.hasOwnProperty.call(item2, key) &&
              item2[key] === value,
          ),
      ),
    ) &&
    array2.every((item1) =>
      array1.some(
        (item2) =>
          Object.keys(item1).length === Object.keys(item2).length &&
          Object.entries(item1).every(
            ([key, value]) =>
              Object.prototype.hasOwnProperty.call(item2, key) &&
              item2[key] === value,
          ),
      ),
    )
  );
}

/**
 * Return a random integer between minMs and maxMs (inclusive).
 */
export function getRandomInterval(minMs: number, maxMs: number) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}
