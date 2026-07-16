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
    /** Live level (0-100) of every Plutchik primary — the full wheel. */
    all?: Record<string, number>;
    isDyad?: boolean;
    components?: string[];
  };
  hunger: { level: number; label?: string };
  thirst: { level: number; label?: string };
  energy: { level: number; label?: string };
  sickness: { level: number; label?: string };
  alcohol: { level: number; label?: string };
  substance: { level: number; label?: string };
  bathroom: { level: number; label?: string };
}

/**
 * Rich emotion detail for the dashboard — everything prism knows about the
 * current emotional state, plus the presentation (emoji/valence) this
 * formatter already derives for the mood bar.
 */
export interface EmotionDetail {
  /** Dominant emotion id, e.g. "joy" or a dyad like "love". */
  dominant: string;
  /** Title-cased display name of the dominant emotion. */
  label: string;
  /** 0-100 strength of the dominant emotion. */
  intensity: number;
  emoji: string;
  /** -1 (miserable) … 1 (elated) — how the emotion reads on a happy↔sad axis. */
  valence: number;
  /** True when the dominant is a Plutchik dyad of two primaries. */
  isDyad: boolean;
  /** The primary emotions a dyad blends, e.g. love → ["joy", "trust"]. */
  components: string[];
  /** Live level (0-100) of every Plutchik primary — the full wheel. */
  wheel: Record<string, number>;
}

/** Human labels prism assigns each physical stat (e.g. hunger → "Starving"). */
export type SomaticStatLabels = Partial<
  Record<
    | "hunger"
    | "thirst"
    | "energy"
    | "sickness"
    | "alcohol"
    | "substance"
    | "bathroom",
    string
  >
>;

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

/** Full emotion detail (wheel, dyad composition, valence) for the dashboard. */
export function formatEmotionDetail(
  emotion: PrismSomaticSnapshot["emotion"],
): EmotionDetail {
  const dominant = (emotion.dominant || "neutral").toLowerCase();
  return {
    dominant,
    label: titleCase(dominant),
    intensity: Math.max(0, Math.min(100, Math.round(emotion.intensity ?? 0))),
    emoji: resolveEmoji(dominant, emotion.components),
    valence: resolveValence(dominant, emotion.components),
    isDyad: emotion.isDyad ?? false,
    components: emotion.components ?? [],
    wheel: emotion.all ?? {},
  };
}

/**
 * One-line presence status for Lupos's current mood — takes over the bot's
 * Discord status a few seconds after a reply recap. Examples:
 * "😤 Feeling very angry", "🥰 Feeling a bit loved", "😶 Feeling nothing much".
 */
export function formatMoodStatusLine(emotion: EmotionDetail): string {
  if (!emotion.dominant || emotion.dominant === "neutral") {
    return "😶 Feeling nothing much";
  }
  const qualifier =
    emotion.intensity >= 70 ? "very " : emotion.intensity <= 30 ? "a bit " : "";
  return `${emotion.emoji} Feeling ${qualifier}${emotion.label.toLowerCase()}`;
}

/** Pull prism's per-stat human labels ("Starving", "Tipsy", …) through. */
export function formatSomaticLabels(
  snapshot: PrismSomaticSnapshot,
): SomaticStatLabels {
  return {
    hunger: snapshot.hunger.label,
    thirst: snapshot.thirst.label,
    energy: snapshot.energy.label,
    sickness: snapshot.sickness.label,
    alcohol: snapshot.alcohol.label,
    substance: snapshot.substance.label,
    bathroom: snapshot.bathroom.label,
  };
}
