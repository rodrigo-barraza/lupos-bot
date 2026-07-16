/**
 * AvatarSyncService.test.ts
 *
 * Unit tests for the avatar-change throttle (pure logic only — the sync
 * loop itself is integration-level). The constraint being modelled:
 * Discord rate-limits bot avatar changes to roughly two per hour, so a
 * change is only allowed when the portrait actually differs, outside
 * both the failure backoff and the minimum spacing between changes.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateAvatarSync,
  MIN_CHANGE_INTERVAL_MILLISECONDS,
  type AvatarSyncState,
} from "../AvatarSyncService.js";

const NOW = 100 * 60_000;

function makeState(overrides: Partial<AvatarSyncState> = {}): AvatarSyncState {
  return {
    lastAppliedKey: "mood-neutral",
    lastChangeAtMs: NOW - MIN_CHANGE_INTERVAL_MILLISECONDS - 1,
    backoffUntilMs: 0,
    ...overrides,
  };
}

describe("evaluateAvatarSync", () => {
  it("applies when the portrait changed and spacing has passed", () => {
    const decision = evaluateAvatarSync("mood-joy", makeState(), NOW);
    expect(decision.apply).toBe(true);
  });

  it("skips when Discord is already wearing the resolved portrait", () => {
    const decision = evaluateAvatarSync("mood-neutral", makeState(), NOW);
    expect(decision.apply).toBe(false);
    expect(decision.reason).toMatch(/already wearing/);
  });

  it("throttles a changed portrait inside the minimum spacing", () => {
    const decision = evaluateAvatarSync(
      "mood-joy",
      makeState({ lastChangeAtMs: NOW - MIN_CHANGE_INTERVAL_MILLISECONDS / 2 }),
      NOW,
    );
    expect(decision.apply).toBe(false);
    expect(decision.reason).toMatch(/throttled/);
  });

  it("skips everything during the failure backoff, even a changed portrait", () => {
    const decision = evaluateAvatarSync(
      "mood-joy",
      makeState({ backoffUntilMs: NOW + 60_000 }),
      NOW,
    );
    expect(decision.apply).toBe(false);
    expect(decision.reason).toMatch(/backing off/);
  });

  it("applies immediately when nothing is known yet (fresh state, no persistence)", () => {
    const decision = evaluateAvatarSync(
      "state-wasted",
      { lastAppliedKey: null, lastChangeAtMs: 0, backoffUntilMs: 0 },
      NOW,
    );
    expect(decision.apply).toBe(true);
  });
});
