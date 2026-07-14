// ============================================================
// ImageIntent — image-request detection heuristics
// ============================================================
// Extracted from DiscordService.buildAndGenerateReply (R1 decomposition).
// Pure detection functions + regexes for:
//   1. mightBeImageRequest — cheap gate that activates the pipeline
//   2. Untagged-name matching — "draw Rodrigo" without @Rodrigo
//   3. Group-reference detection — "draw everyone" / "top 5" → count
//   4. Self-reference detection — regex tier + LLM-fallback tier
// The regexes are exported individually so tests can exercise the
// real source instead of hand-synced copies.
// ============================================================

import config from "#root/config.js";
import AIService from "#root/services/AIService.js";

// ─── 1. Image-request gate ───────────────────────────────────────
// Cheap heuristic: might the user be asking for image generation?
// This avoids two expensive AI calls (name extraction + group detection)
// on every message. The agent still decides autonomously — this just
// controls whether we pre-fetch avatars and detect group refs.

export const IMAGE_REQUEST_VERB_SUBJECT_REGEX =
  /\b(draw|paint|sketch|illustrate|render|generate|create|make|design|depict|redraw|reimagine)\b.*\b(image|picture|painting|illustration|art|artwork|portrait|scene|drawing|me|us|everyone|him|her|them)\b/i;

export const IMAGE_REQUEST_VERB_REGEX =
  /\b(draw|paint|sketch|illustrate|render|depict)\b/i;

/**
 * Text-only gate — the caller ORs this with `hasImageAttachments`.
 */
export function mightBeImageRequest(text: string): boolean {
  const messageText = (text || "").toLowerCase();
  return (
    IMAGE_REQUEST_VERB_SUBJECT_REGEX.test(messageText) ||
    IMAGE_REQUEST_VERB_REGEX.test(messageText)
  );
}

// ─── 2. Untagged-name matching ───────────────────────────────────

export interface KnownParticipant {
  id: string;
  username: string;
  displayName: string;
}

/**
 * Deterministic name matching — word-boundary check against the
 * pre-filtered participant list. `knownParticipants` should already
 * only contain names that appear in the message text, so this is a
 * refinement pass using word boundaries to avoid false positives.
 * Returns the matched participant IDs (one match per participant).
 */
export function findUntaggedNameMatches(
  messageText: string,
  knownParticipants: KnownParticipant[],
): string[] {
  const messageTextForMatch = (messageText || "").toLowerCase();
  const matchedIds: string[] = [];
  for (const participant of knownParticipants) {
    const names = [participant.username, participant.displayName]
      .filter((n: string) => n && n.length >= 3)
      .map((n: string) => n.toLowerCase());
    for (const name of names) {
      // Use word-boundary-aware check: the name must not be inside another word
      const index = messageTextForMatch.indexOf(name);
      if (index === -1) continue;
      const charBefore = index > 0 ? messageTextForMatch[index - 1] : " ";
      const charAfter =
        index + name.length < messageTextForMatch.length
          ? messageTextForMatch[index + name.length]
          : " ";
      const isBoundaryBefore = !/\w/.test(charBefore);
      const isBoundaryAfter = !/\w/.test(charAfter);
      if (isBoundaryBefore && isBoundaryAfter) {
        matchedIds.push(participant.id);
        break; // One match per participant is enough
      }
    }
  }
  return matchedIds;
}

// ─── 3. Group-reference detection ────────────────────────────────
// Deterministic keyword/regex matching replaces the old AI
// classification call. Handles mixed cases like
// "draw @Rodrigo surrounded by everyone" correctly.

export const GROUP_TOP_N_REGEX = /\btop\s+(\d+)\b/;
export const GROUP_N_OF_US_REGEX = /\bthe\s+(\d+)\s+of\s+us\b/;
export const GROUP_EVERYONE_REGEX =
  /\b(everyone|everybody|every\s*one|all\s+of\s+us|everyone\s+else|the\s+boys|the\s+squad|the\s+gang|the\s+server|us\s+all)\b/i;
export const GROUP_CHATTERS_REGEX =
  /\b(all\s+(?:the\s+)?)?(?:chatters|people|participants|members|peeps|folks|homies)\b/i;
export const GROUP_CHATTERS_VERB_REGEX =
  /\b(draw|paint|sketch|illustrate|render|depict|generate|create|make|design)\b/i;
export const GROUP_THE_CHAT_REGEX = /\bthe\s+chat\b/i;
export const GROUP_ALL_OF_THEM_REGEX = /\ball\s+of\s+(them|these)\b/i;
export const GROUP_DRAW_ALL_REGEX =
  /\b(draw|paint|sketch|illustrate|render|depict)\s+all\b/i;

/**
 * Detect group references (e.g. "draw the top 5 people here",
 * "draw everyone"). Returns the requested people count:
 *   - "top N" / "the N of us" → N
 *   - "everyone" variants → 99 (capped downstream)
 *   - no group reference → 0
 */
export function detectGroupReference(text: string): number {
  const groupText = (text || "").toLowerCase();

  // Check for "top N" pattern first (returns the specific number)
  const topNMatch = groupText.match(GROUP_TOP_N_REGEX);
  // Check for "the N of us" pattern
  const nOfUsMatch = groupText.match(GROUP_N_OF_US_REGEX);
  // Check for "everyone" / "all" / "everybody" / group slang
  const isEveryoneRef =
    GROUP_EVERYONE_REGEX.test(groupText) ||
    // "all the chatters", "the chatters", "all chatters", "all the people", "all participants", etc.
    (GROUP_CHATTERS_REGEX.test(groupText) &&
      GROUP_CHATTERS_VERB_REGEX.test(groupText)) ||
    // "the chat" as a standalone group reference (word boundary prevents matching "chatters" above)
    GROUP_THE_CHAT_REGEX.test(groupText) ||
    // "all of them" / "all of these people"
    GROUP_ALL_OF_THEM_REGEX.test(groupText) ||
    // bare "draw all" / "draw all ..." where "all" is the group quantifier
    GROUP_DRAW_ALL_REGEX.test(groupText);

  let groupCount = 0;
  if (topNMatch) {
    groupCount = parseInt(topNMatch[1], 10);
  } else if (nOfUsMatch) {
    groupCount = parseInt(nOfUsMatch[1], 10);
  } else if (isEveryoneRef) {
    groupCount = 99; // Capped downstream
  }
  return groupCount;
}

// ─── 4. Self-reference detection ─────────────────────────────────
// Two-tier detection:
//   1. Fast-path regex for common English patterns (zero latency, no API cost)
//   2. Lightweight LLM fallback for everything regex can't cover:
//      other languages, indirect refs, creative phrasings, slang
//      (~200ms Haiku call — negligible against the ~50s total flow)

// "draw me", "paint myself", "create me as...", etc.
export const SELF_REF_VERB_ME_REGEX =
  /\b(draw|paint|sketch|illustrate|render|depict|generate|create|make|design|reimagine|redraw|turn|put|do)\b.*\b(me|myself)\b/i;
// "my profile picture", "my pfp", "my cool avatar", etc.
// Allows up to 3 intermediate words between "my" and the visual noun
export const SELF_REF_MY_VISUAL_NOUN_REGEX =
  /\b(my)\s+(?:\w+\s+){0,3}(portrait|face|avatar|picture|photo|image|drawing|painting|illustration|likeness|selfie|caricature|pfp|dp|pic|profile)\b/i;
// "how would I look as...", "what would I look like..."
export const SELF_REF_HOW_WOULD_I_LOOK_REGEX =
  /\b(how|what)\s+would\s+I\s+look\b/i;
// "a portrait/painting/picture of me"
export const SELF_REF_NOUN_OF_ME_REGEX =
  /\b(portrait|painting|picture|photo|image|illustration|drawing|version|rendition|interpretation)\s+of\s+me\b/i;

/**
 * Tier 1: Fast-path regex (English) for self-referential image requests.
 */
export function hasSelfReferenceRegex(text: string): boolean {
  const selfText = (text || "").toLowerCase();
  return (
    SELF_REF_VERB_ME_REGEX.test(selfText) ||
    SELF_REF_MY_VISUAL_NOUN_REGEX.test(selfText) ||
    SELF_REF_HOW_WOULD_I_LOOK_REGEX.test(selfText) ||
    SELF_REF_NOUN_OF_ME_REGEX.test(selfText)
  );
}

/**
 * Tier 2: LLM fallback (multilingual, indirect refs).
 * Only runs when regex didn't match but image request is likely.
 * Uses the fastest model (~200ms) with a simple yes/no classification.
 * Returns false on classification failure (logged, non-fatal).
 */
export async function detectSelfReferenceViaLLM(
  messageText: string,
): Promise<boolean> {
  try {
    const classificationResult = await AIService.generateText({
      systemPrompt: `You are a classifier. Determine if the user's message is asking for an image that involves THEMSELVES — their own appearance, their own profile picture, their own avatar, or any visual depiction of themselves.

This includes:
- Direct self-references in ANY language: "draw me", "dibújame", "dessine-moi", "画我", "나를 그려줘", "нарисуй меня", etc.
- Possessive references to their own image: "my profile picture", "mi foto de perfil", "mein Profilbild", etc.
- Indirect self-references: "how would I look as...", "turn my pic into...", "make that a renaissance version" (when referring to their own image)
- Hypothetical self-references: "what would I look like as a knight"
- Shorthand: "my pfp", "my dp", "my avi"

Respond with ONLY "yes" or "no". Nothing else.`,
      conversation: [
        {
          role: "user",
          content: messageText,
        },
      ],
      type: "ANTHROPIC",
      model: config.ANTHROPIC_LANGUAGE_MODEL_FAST,
      temperature: 0,
      tokens: 4,
    });

    return classificationResult?.trim().toLowerCase() === "yes";
  } catch (classifyErr: unknown) {
    console.warn(
      `🪞 [DiscordService] Self-referential LLM classification failed: ${(classifyErr as Error).message}`,
    );
    return false;
  }
}

export default {
  mightBeImageRequest,
  findUntaggedNameMatches,
  detectGroupReference,
  hasSelfReferenceRegex,
  detectSelfReferenceViaLLM,
};
