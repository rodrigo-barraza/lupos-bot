// ============================================================
// AvatarStateFormatter — somatic state → mood-set portrait key
// ============================================================
// Picks which images/mood-set/*.png portrait Lupos should wear right
// now. Physical extremes win over emotion (a wasted wolf looks wasted
// no matter how joyful he feels); below the extreme tier, moderate
// physical states only pre-empt the mood when they'd be the salient
// thing you'd notice meeting him. Otherwise the portrait follows the
// dominant Plutchik emotion (primary or dyad) from prism-service.
//
// Threshold provenance: the severe tier mirrors prism-service's
// top label boundaries (SomaticStateService HUNGER_LABELS etc. —
// Wasted ≥7, Starving ≥80, Severely Ill ≥70); the moderate tier is
// deliberately stricter than prism's mid labels so passive drift
// (hunger creeping past 40) doesn't permanently mask the mood.

import type { SomaticStats } from "#root/services/TraitRegistry.ts";

export interface AvatarState {
  /** mood-set filename without extension, e.g. "mood-love" | "state-wasted" */
  key: string;
  /** What drove the pick: a physical state extreme or the dominant emotion. */
  source: "state" | "mood";
  /** Human-readable label for the portrait, e.g. "Love", "Wasted". */
  label: string;
}

/** Every portrait that exists in images/mood-set (34 moods + 13 states). */
export const AVATAR_KEYS: ReadonlySet<string> = new Set([
  // 8 Plutchik primaries + neutral + high-intensity anger variant
  "mood-joy",
  "mood-trust",
  "mood-fear",
  "mood-surprise",
  "mood-sadness",
  "mood-disgust",
  "mood-anger",
  "mood-anger-furious",
  "mood-anticipation",
  "mood-neutral",
  // 24 Plutchik dyads
  "mood-love",
  "mood-submission",
  "mood-awe",
  "mood-disapproval",
  "mood-remorse",
  "mood-contempt",
  "mood-aggressiveness",
  "mood-optimism",
  "mood-guilt",
  "mood-curiosity",
  "mood-despair",
  "mood-unbelief",
  "mood-envy",
  "mood-cynicism",
  "mood-pride",
  "mood-hope",
  "mood-delight",
  "mood-sentimentality",
  "mood-shame",
  "mood-outrage",
  "mood-pessimism",
  "mood-morbidness",
  "mood-dominance",
  "mood-anxiety",
  // 13 physical-state extremes
  "state-wasted",
  "state-drunk",
  "state-tipsy",
  "state-tripping",
  "state-high",
  "state-severely-ill",
  "state-nauseous",
  "state-starving",
  "state-hungry",
  "state-parched",
  "state-exhausted",
  "state-tired",
  "state-gotta-go",
]);

interface StateRule {
  key: string;
  label: string;
  matches: (stats: SomaticStats) => boolean;
}

// Ordered ladder — first match wins. Severe tier first (overrides any
// mood), then moderate tier. hunger/thirst/sickness/bathroom are 0-100
// where HIGHER IS WORSE; energy is 0-100 where LOWER is worse;
// alcohol/substance are 0-10.
const STATE_RULES: StateRule[] = [
  // ── Severe: mirrors prism-service's top label thresholds ──
  { key: "state-wasted", label: "Wasted", matches: (s) => s.alcohol >= 7 },
  { key: "state-tripping", label: "Tripping", matches: (s) => s.substance >= 7 },
  { key: "state-severely-ill", label: "Severely Ill", matches: (s) => s.sickness >= 70 },
  { key: "state-starving", label: "Starving", matches: (s) => s.hunger >= 80 },
  { key: "state-parched", label: "Parched", matches: (s) => s.thirst >= 80 },
  { key: "state-gotta-go", label: "Gotta Go", matches: (s) => s.bathroom >= 80 },
  { key: "state-exhausted", label: "Exhausted", matches: (s) => s.energy <= 10 },
  // ── Moderate: stricter than prism's mid labels (see header) ──
  { key: "state-drunk", label: "Drunk", matches: (s) => s.alcohol >= 4 },
  { key: "state-high", label: "High", matches: (s) => s.substance >= 4 },
  { key: "state-nauseous", label: "Nauseous", matches: (s) => s.sickness >= 40 },
  { key: "state-hungry", label: "Hungry", matches: (s) => s.hunger >= 65 },
  { key: "state-tired", label: "Tired", matches: (s) => s.energy <= 25 },
  { key: "state-tipsy", label: "Tipsy", matches: (s) => s.alcohol >= 2 },
];

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Resolve the portrait Lupos should currently wear. `emotion` is the live
 * dominant emotion from prism-service when available; without it (prism
 * down, local stub) the mood side falls back to the neutral portrait.
 */
export function resolveAvatarState(
  stats: SomaticStats,
  emotion?: { dominant: string; intensity: number } | null,
): AvatarState {
  for (const rule of STATE_RULES) {
    if (rule.matches(stats)) {
      return { key: rule.key, source: "state", label: rule.label };
    }
  }

  const dominant = (emotion?.dominant || "neutral").toLowerCase();
  if (dominant === "anger" && (emotion?.intensity ?? 0) >= 80) {
    return { key: "mood-anger-furious", source: "mood", label: "Furious" };
  }

  const moodKey = `mood-${dominant}`;
  if (AVATAR_KEYS.has(moodKey)) {
    return { key: moodKey, source: "mood", label: titleCase(dominant) };
  }
  return { key: "mood-neutral", source: "mood", label: "Neutral" };
}
