import { describe, it, expect } from "vitest";
import {
  buildScatterAssignments,
  formatScatterLine,
  pickScatterTargets,
} from "../goldScatter.ts";
import type { ScatterTarget } from "../goldScatter.ts";

function target(id: string): ScatterTarget {
  return { userId: id, username: id, displayName: id };
}

const POOL = ["a", "b", "c", "d", "e"].map(target);

describe("pickScatterTargets", () => {
  it("draws the requested number of distinct targets", () => {
    const picked = pickScatterTargets(POOL, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((t) => t.userId)).size).toBe(3);
  });

  it("never draws more than the pool holds", () => {
    expect(pickScatterTargets(POOL.slice(0, 2), 4)).toHaveLength(2);
    expect(pickScatterTargets([], 3)).toHaveLength(0);
  });

  it("does not mutate the pool", () => {
    const pool = [...POOL];
    pickScatterTargets(pool, 3);
    expect(pool).toEqual(POOL);
  });
});

describe("buildScatterAssignments", () => {
  it("pairs every pile with a distinct target and conserves the total", () => {
    const assignments = buildScatterAssignments(137, POOL.slice(0, 4));
    expect(assignments).toHaveLength(4);
    expect(assignments.reduce((sum, a) => sum + a.amount, 0)).toBe(137);
    for (const assignment of assignments) {
      expect(assignment.amount).toBeGreaterThanOrEqual(1);
    }
  });

  it("drops surplus targets for tiny amounts instead of assigning 0g", () => {
    const assignments = buildScatterAssignments(2, POOL.slice(0, 3));
    expect(assignments).toHaveLength(2);
  });

  it("is empty with no gold or no targets", () => {
    expect(buildScatterAssignments(0, POOL)).toEqual([]);
    expect(buildScatterAssignments(100, [])).toEqual([]);
  });
});

describe("formatScatterLine", () => {
  it("mentions each recipient with a verb and amount", () => {
    const line = formatScatterLine([
      { target: target("a"), amount: 65 },
      { target: target("b"), amount: 45 },
      { target: target("c"), amount: 30 },
    ]);
    expect(line).toBe(
      "🫳 <@a> scoops **🪙 65g**, <@b> grabs **🪙 45g**, <@c> snags **🪙 30g**!",
    );
  });

  it("is empty for no assignments", () => {
    expect(formatScatterLine([])).toBe("");
  });
});
