// ============================================================
// SomaticStatsFormatter — real Prism somatic state → client shape
// ============================================================
// Maps prism-service's SomaticStateService.getSnapshot() output into the
// SomaticStats contract the lupos-client dashboard renders. The physical
// stats pass through at their native ranges (0-100, alcohol/substance
// 0-10) to match the historical /bot/stats contract. The emotion wheel
// is projected onto the client's single-axis mood bar as a 0-100
// VALENCE (50 = neutral, higher = happier) so its label/percentage/color
// stay meaningful, plus a per-emotion emoji.
// ============================================================

import type { SomaticStats } from "#root/services/TraitRegistry.js";

/** Shape of prism-service GET /somatic/:agentId (the fields we consume). */
export interface PrismSomaticSnapshot {
  emotion: {
    dominant: string;
    intensity: number;
    isDyad?: boolean;
    components?: string[];
  };
  hunger: { level: number };
  thirst: { level: number };
  energy: { level: number };
  sickness: { level: number };
  alcohol: { level: number };
  substance: { level: number };
  bathroom: { level: number };
}

// Valence of each Plutchik primary: how positive the mood reads on the
// client's happy↔sad bar. Dyads average their components' valences.
const EMOTION_VALENCE: Record<string, number> = {
  joy: 1.0,
  trust: 0.5,
  anticipation: 0.25,
  surprise: 0.0,
  neutral: 0.0,
  disgust: -0.6,
  anger: -0.6,
  fear: -0.65,
  sadness: -0.9,
};

const EMOTION_EMOJI: Record<string, string> = {
  joy: "😊",
  trust: "🤝",
  anticipation: "👀",
  surprise: "😲",
  neutral: "😑",
  disgust: "🤢",
  anger: "😠",
  fear: "😨",
  sadness: "😢",
};

// A few dyads read better with their own face than a component's.
const DYAD_EMOJI: Record<string, string> = {
  love: "❤️",
  submission: "🙇",
  awe: "🤩",
  disapproval: "😤",
  remorse: "😔",
  contempt: "😒",
  aggressiveness: "😡",
  optimism: "🌅",
  guilt: "😅",
  curiosity: "🤔",
  despair: "😖",
  unbelief: "🤨",
  envy: "😖",
  cynicism: "🙄",
  pride: "😤",
  hope: "🙏",
  delight: "😄",
  sentimentality: "🥹",
  shame: "😳",
  outrage: "🤬",
  pessimism: "😒",
  morbidness: "😈",
  dominance: "😤",
  anxiety: "😰",
};

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Resolve a dominant emotion (primary OR dyad) to a valence in [-1, 1].
 * Dyads without a direct entry average their component valences.
 */
function resolveValence(
  dominant: string,
  components: string[] | undefined,
): number {
  if (dominant in EMOTION_VALENCE) return EMOTION_VALENCE[dominant];
  const parts = (components || []).filter((name) => name in EMOTION_VALENCE);
  if (parts.length === 0) return 0;
  const sum = parts.reduce((total, name) => total + EMOTION_VALENCE[name], 0);
  return sum / parts.length;
}

/**
 * Resolve the emoji for a dominant emotion: dyad override → primary emoji →
 * the strongest-valence component's emoji → neutral.
 */
function resolveEmoji(
  dominant: string,
  components: string[] | undefined,
): string {
  if (dominant in DYAD_EMOJI) return DYAD_EMOJI[dominant];
  if (dominant in EMOTION_EMOJI) return EMOTION_EMOJI[dominant];
  const strongest = (components || [])
    .filter((name) => name in EMOTION_EMOJI)
    .sort(
      (a, b) => Math.abs(EMOTION_VALENCE[b]) - Math.abs(EMOTION_VALENCE[a]),
    )[0];
  return strongest ? EMOTION_EMOJI[strongest] : EMOTION_EMOJI.neutral;
}

/**
 * Project the emotion wheel onto the client's 0-100 mood bar. Intensity
 * (0-100) scales how far a mood pushes from the neutral midpoint (50).
 */
export function moodFromEmotion(emotion: PrismSomaticSnapshot["emotion"]): {
  level: number;
  name: string;
  emoji: string;
} {
  const valence = resolveValence(emotion.dominant, emotion.components);
  const intensity = Math.max(0, Math.min(100, emotion.intensity ?? 0));
  const level = Math.round(50 + valence * (intensity / 100) * 50);
  return {
    level: Math.max(0, Math.min(100, level)),
    name: titleCase(emotion.dominant || "neutral"),
    emoji: resolveEmoji(emotion.dominant, emotion.components),
  };
}

/** Map a full Prism somatic snapshot into the client's SomaticStats shape. */
export function formatSomaticStats(
  snapshot: PrismSomaticSnapshot,
): SomaticStats {
  return {
    mood: moodFromEmotion(snapshot.emotion),
    hunger: snapshot.hunger.level,
    thirst: snapshot.thirst.level,
    energy: snapshot.energy.level,
    sickness: snapshot.sickness.level,
    alcohol: snapshot.alcohol.level,
    bathroom: snapshot.bathroom.level,
    substance: snapshot.substance.level,
  };
}
