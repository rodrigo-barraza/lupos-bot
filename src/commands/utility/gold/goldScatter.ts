/**
 * Shared scatter mechanic: gold dropped by one player lands on several
 * others automatically — no buttons, no interruption, one punchline line
 * on an existing message. Used by shock backfires/fumbles and beatup loot.
 */

import { adjustGold } from "./goldRepository.ts";
import type { GoldReason } from "./goldRepository.ts";
import { formatGold, splitGoldPiles } from "./goldMath.ts";

export interface ScatterTarget {
  userId: string;
  username: string;
  displayName: string;
}

export interface ScatterAssignment {
  target: ScatterTarget;
  amount: number;
}

/** Pile-size verbs, biggest pile first. */
const SCATTER_VERBS = ["scoops", "grabs", "snags", "pockets"];

/**
 * Draws `count` distinct targets from the pool (Fisher-Yates on a copy).
 * `rand` is injectable for deterministic tests.
 */
export function pickScatterTargets(
  pool: ScatterTarget[],
  count: number,
  rand: () => number = Math.random,
) {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, count));
}

/**
 * Splits `amount` into loot piles and pairs them with distinct targets.
 * Pure aside from randomness — the credits happen in creditScatter.
 */
export function buildScatterAssignments(
  amount: number,
  targets: ScatterTarget[],
  rand: () => number = Math.random,
): ScatterAssignment[] {
  if (amount <= 0 || targets.length === 0) return [];
  // splitGoldPiles may return fewer piles than targets for tiny drops —
  // map over the piles so nobody is assigned 0g.
  const piles = splitGoldPiles(amount, targets.length, rand);
  return piles.map((pileAmount: number, index: number) => ({
    target: targets[index],
    amount: pileAmount,
  }));
}

/**
 * Credits every assignment. Failures are logged, never thrown — a game
 * must not fail on its economy garnish.
 */
export async function creditScatter(
  guildId: string,
  assignments: ScatterAssignment[],
  reason: GoldReason,
  meta?: Record<string, unknown>,
) {
  for (const assignment of assignments) {
    await adjustGold(
      guildId,
      assignment.target.userId,
      assignment.amount,
      reason,
      {
        userInfo: {
          username: assignment.target.username,
          displayName: assignment.target.displayName,
        },
        meta,
      },
    ).catch(() => {});
  }
}

/**
 * "🫳 <@a> scoops **65g**, <@b> grabs **45g**, <@c> snags **30g**!"
 * Assignments arrive biggest-pile-first from buildScatterAssignments.
 */
export function formatScatterLine(assignments: ScatterAssignment[]) {
  if (assignments.length === 0) return "";
  const parts = assignments.map(
    (assignment: ScatterAssignment, index: number) => {
      const verb = SCATTER_VERBS[Math.min(index, SCATTER_VERBS.length - 1)];
      return `<@${assignment.target.userId}> ${verb} **${formatGold(assignment.amount)}**`;
    },
  );
  return `🫳 ${parts.join(", ")}!`;
}
