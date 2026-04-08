/**
 * ImageDetection.test.js
 *
 * Comprehensive tests for the image detection pipeline regex logic
 * extracted from DiscordService.buildAndGenerateReply:
 *
 *   1. mightBeImageRequest  — gate that activates the entire pipeline
 *   2. Self-referential      — detects "draw me" / "my pfp" (regex tier 1)
 *   3. Group reference       — detects "draw everyone" / "top 5"
 *
 * NOTE: Tier 2 (LLM fallback) for self-ref is tested by documenting which
 * inputs fall through to it — actual LLM classification is integration-level.
 */

import { describe, test, expect } from "@jest/globals";

// ═══════════════════════════════════════════════════════════════════
// Extracted regexes — must be kept in sync with DiscordService.js
// ═══════════════════════════════════════════════════════════════════

// mightBeImageRequest (line ~684-687)
function mightBeImageRequest(text) {
  const t = text.toLowerCase();
  return (
    /\b(draw|paint|sketch|illustrate|render|generate|create|make|design|depict|redraw|reimagine)\b.*\b(image|picture|painting|illustration|art|artwork|portrait|scene|drawing|me|us|everyone|him|her|them)\b/i.test(t) ||
    /\b(draw|paint|sketch|illustrate|render|depict)\b/i.test(t)
  );
}

// Self-referential regex — Tier 1 fast-path (line ~939-948)
function hasSelfRefRegex(text) {
  const t = text.toLowerCase();
  return (
    // "draw me", "paint myself", "create me as...", "turn me into..."
    /\b(draw|paint|sketch|illustrate|render|depict|generate|create|make|design|reimagine|redraw|turn|put|do)\b.*\b(me|myself)\b/i.test(t) ||
    // "my profile picture", "my pfp", "my cool avatar"
    /\b(my)\s+(?:\w+\s+){0,3}(portrait|face|avatar|picture|photo|image|drawing|painting|illustration|likeness|selfie|caricature|pfp|dp|pic|profile)\b/i.test(t) ||
    // "how would I look as...", "what would I look like..."
    /\b(how|what)\s+would\s+I\s+look\b/i.test(t) ||
    // "a portrait/painting/picture of me"
    /\b(portrait|painting|picture|photo|image|illustration|drawing|version|rendition|interpretation)\s+of\s+me\b/i.test(t)
  );
}

// Group reference regexes (line ~841-845)
function detectGroupRef(text) {
  const t = text.toLowerCase();
  const topNMatch = t.match(/\btop\s+(\d+)\b/);
  const nOfUsMatch = t.match(/\bthe\s+(\d+)\s+of\s+us\b/);
  const isEveryoneRef = /\b(everyone|everybody|every\s*one|all\s+of\s+us|everyone\s+else|the\s+boys|the\s+squad|the\s+gang|the\s+chat|the\s+server|us\s+all)\b/i.test(t);

  if (topNMatch) return parseInt(topNMatch[1], 10);
  if (nOfUsMatch) return parseInt(nOfUsMatch[1], 10);
  if (isEveryoneRef) return 99;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════
// 1. mightBeImageRequest — the pipeline gate
// ═══════════════════════════════════════════════════════════════════

describe("mightBeImageRequest", () => {
  describe("should TRIGGER for image requests", () => {
    const positives = [
      // ── Direct draw verbs (standalone) ──
      ["draw a cat", "standalone draw verb"],
      ["paint something", "standalone paint verb"],
      ["sketch this", "standalone sketch verb"],
      ["illustrate a scene", "standalone illustrate verb"],
      ["render a landscape", "standalone render verb"],
      ["depict a battle", "standalone depict verb"],

      // ── Verb + subject combos ──
      ["draw me", "draw + me"],
      ["draw me as a samurai", "draw + me + context"],
      ["paint him as a knight", "paint + him"],
      ["sketch her portrait", "sketch + her"],
      ["draw them fighting", "draw + them"],
      ["generate an image of a dragon", "generate + image"],
      ["create a picture of sunset", "create + picture"],
      ["make me a painting", "make + painting"],
      ["design an illustration", "design + illustration"],
      ["draw everyone here", "draw + everyone"],
      ["draw us in a group", "draw + us"],
      ["reimagine this scene", "reimagine + scene"],
      ["redraw this art", "redraw + art"],

      // ── Creative phrasings ──
      ["can you draw something cool", "question form"],
      ["yo draw a dragon", "slang prefix"],
      ["@Lupos draw me bro", "mention with draw"],
      ["please paint a portrait of me", "polite request"],
      ["draw my profile picture in watercolor", "complex request"],

      // ── Edge cases that should still fire ──
      ["DRAW ME", "all caps"],
      ["DrAw Me", "mixed case"],
      ["  draw   me  ", "extra whitespace"],
    ];

    test.each(positives)("%s → true (%s)", (input) => {
      expect(mightBeImageRequest(input)).toBe(true);
    });
  });

  describe("should NOT trigger for non-image messages", () => {
    const negatives = [
      ["hello there", "greeting"],
      ["how are you", "question"],
      ["lmao that's funny", "reaction"],
      ["what's for dinner", "casual chat"],
      ["I love this server", "compliment"],
      ["can someone help me with my homework", "help request"],
      ["the weather is nice today", "weather"],
      ["who won the game", "sports question"],
      ["I made dinner", "non-art 'make'"],
      ["generate some ideas", "non-visual generate"],
      ["create a plan", "non-visual create"],
      ["nice picture!", "complimenting existing image"],
      ["that drawing is cool", "commenting on art"],
    ];

    test.each(negatives)("%s → false (%s)", (input) => {
      expect(mightBeImageRequest(input)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Self-referential detection (Tier 1 — regex fast-path)
// ═══════════════════════════════════════════════════════════════════

describe("Self-referential detection (Tier 1 regex)", () => {
  describe("should MATCH — verb + me/myself", () => {
    const cases = [
      ["draw me", "basic"],
      ["draw me as a samurai", "with context"],
      ["paint me like a french girl", "paint + me"],
      ["sketch me in pencil", "sketch + me"],
      ["illustrate me as a superhero", "illustrate + me"],
      ["render me in 3D", "render + me"],
      ["depict me as a wolf", "depict + me"],
      ["generate me as an anime character", "generate + me"],
      ["create me as a pixel art sprite", "create + me"],
      ["make me look like a viking", "make + me"],
      ["design me a logo with my face", "design + me"],
      ["reimagine me as a cyberpunk character", "reimagine + me"],
      ["redraw me as a cartoon", "redraw + me"],
      ["turn me into a renaissance painting", "turn + me"],
      ["put me in a fantasy world", "put + me"],
      ["do me in watercolor style", "do + me"],
      ["draw myself as a wizard", "verb + myself"],
      ["paint myself in oil", "paint + myself"],

      // Edge cases
      ["yo draw me bro", "slang prefix"],
      ["@Lupos draw me", "mention prefix"],
      ["can you draw me as a knight?", "question form"],
      ["please draw me", "polite"],
      ["DRAW ME", "all caps"],
      ["  draw   me  ", "extra whitespace"],
      ["draw me, but make it epic", "comma continuation"],
      ["draw me and Rodrigo", "compound request"],
    ];

    test.each(cases)("%s → true (%s)", (input) => {
      expect(hasSelfRefRegex(input)).toBe(true);
    });
  });

  describe("should MATCH — my + visual noun (with intermediate words)", () => {
    const cases = [
      ["draw my avatar", "my + avatar"],
      ["draw my pfp", "my + pfp"],
      ["draw my dp", "my + dp"],
      ["draw my pic", "my + pic"],
      ["draw my profile", "my + profile"],
      ["draw my face", "my + face"],
      ["draw my picture", "my + picture"],
      ["draw my photo", "my + photo"],
      ["draw my portrait", "my + portrait"],
      ["draw my selfie", "my + selfie"],
      ["draw my image", "my + image"],
      ["draw my likeness", "my + likeness"],
      ["draw my caricature", "my + caricature"],
      ["draw my illustration", "my + illustration"],

      // With intermediate words (up to 3)
      ["draw my profile picture", "1 intermediate word"],
      ["draw my profile pic", "1 intermediate: pic"],
      ["draw my cool avatar", "1 intermediate: adjective"],
      ["draw my really awesome pfp", "2 intermediate words"],
      ["draw my super cool profile picture", "3 intermediate words"],
      ["Draw a renaissance painting version of my profile picture", "the Quark case"],

      // Mixed with other patterns
      ["make my avatar into a painting", "make + my avatar"],
      ["turn my profile pic into Renaissance art", "turn + my profile pic"],
      ["what if my picture was in anime style", "hypothetical 'my picture'"],
    ];

    test.each(cases)("%s → true (%s)", (input) => {
      expect(hasSelfRefRegex(input)).toBe(true);
    });
  });

  describe("should MATCH — hypothetical self-references", () => {
    const cases = [
      ["how would I look as a samurai", "how would I look"],
      ["what would I look like as a knight", "what would I look"],
      ["how would I look in armor", "how + armor"],
      ["what would I look like with a beard", "what + beard"],
    ];

    test.each(cases)("%s → true (%s)", (input) => {
      expect(hasSelfRefRegex(input)).toBe(true);
    });
  });

  describe("should MATCH — noun of me", () => {
    const cases = [
      ["a portrait of me", "portrait of me"],
      ["a painting of me as Napoleon", "painting of me"],
      ["a picture of me in space", "picture of me"],
      ["a photo of me", "photo of me"],
      ["an illustration of me", "illustration of me"],
      ["a drawing of me as a wolf", "drawing of me"],
      ["a renaissance version of me", "version of me"],
      ["an artistic rendition of me", "rendition of me"],
      ["an artistic interpretation of me", "interpretation of me"],
      ["draw a renaissance version of me", "draw + version of me"],
    ];

    test.each(cases)("%s → true (%s)", (input) => {
      expect(hasSelfRefRegex(input)).toBe(true);
    });
  });

  describe("should NOT match — non-self-referential", () => {
    const negatives = [
      ["draw a cat", "generic subject"],
      ["draw everyone here", "group reference"],
      ["draw Rodrigo as a samurai", "other person by name"],
      ["paint a sunset", "landscape"],
      ["sketch a dragon", "creature"],
      ["make a meme", "non-visual 'make'"],
      ["show me a cool landscape", "show me = display, not depict"],
      ["my cat is cute", "my + non-visual noun"],
      ["draw his avatar", "his, not my"],
      ["draw her face", "her, not my"],
      ["tell me about art", "tell me ≠ draw me"],

      ["let me see it", "let me ≠ draw me"],
      ["remind me later", "remind me ≠ draw me"],
    ];

    test.each(negatives)("%s → false (%s)", (input) => {
      expect(hasSelfRefRegex(input)).toBe(false);
    });
  });

  describe("should FALL THROUGH to LLM tier — multilingual", () => {
    // These should NOT match regex (they need the LLM fallback)
    const multilingualCases = [
      // Spanish
      ["dibújame", "Spanish: draw me"],
      ["pintame como un guerrero", "Spanish: paint me as a warrior"],
      ["mi foto de perfil", "Spanish: my profile picture"],
      ["hazme un retrato", "Spanish: make me a portrait"],
      ["dibuja mi avatar", "Spanish: draw my avatar"],

      // French
      ["dessine-moi", "French: draw me"],
      ["peins-moi en chevalier", "French: paint me as knight"],
      ["mon avatar", "French: my avatar"],
      ["fais un portrait de moi", "French: make a portrait of me"],

      // German
      ["zeichne mich", "German: draw me"],
      ["mein Profilbild", "German: my profile picture"],
      ["male mich als Ritter", "German: paint me as knight"],

      // Chinese
      ["画我", "Chinese: draw me"],
      ["画我的头像", "Chinese: draw my avatar"],
      ["把我画成武士", "Chinese: draw me as samurai"],

      // Japanese
      ["私を描いて", "Japanese: draw me"],
      ["私のアバターを描いて", "Japanese: draw my avatar"],

      // Korean
      ["나를 그려줘", "Korean: draw me"],
      ["내 프로필 사진을 그려줘", "Korean: draw my profile picture"],

      // Russian
      ["нарисуй меня", "Russian: draw me"],
      ["мой аватар", "Russian: my avatar"],

      // Portuguese
      ["desenhe-me", "Portuguese: draw me"],
      ["minha foto de perfil", "Portuguese: my profile picture"],

      // Italian
      ["disegnami", "Italian: draw me"],
      ["il mio avatar", "Italian: my avatar"],

      // Turkish
      ["beni çiz", "Turkish: draw me"],

      // Arabic
      ["ارسمني", "Arabic: draw me"],

      // Indirect / creative English (regex can't reliably catch)
      ["give me advice", "non-visual give — falls to LLM"],
      ["give that cat pic the renaissance treatment", "indirect ref to own avatar"],

    ];

    test.each(multilingualCases)(
      "%s → false (falls to LLM) (%s)",
      (input) => {
        expect(hasSelfRefRegex(input)).toBe(false);
      },
    );
  });

  describe("edge cases — intermediate word limit", () => {
    test("4+ intermediate words should NOT match regex", () => {
      // 4 words between "my" and "picture" — exceeds {0,3} limit
      expect(
        hasSelfRefRegex("draw my very extremely long winded picture"),
      ).toBe(false);
    });

    test("3 intermediate words SHOULD match", () => {
      expect(
        hasSelfRefRegex("draw my super duper cool picture"),
      ).toBe(true);
    });

    test("0 intermediate words SHOULD match", () => {
      expect(hasSelfRefRegex("my picture")).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Group reference detection
// ═══════════════════════════════════════════════════════════════════

describe("Group reference detection", () => {
  describe("should detect 'everyone' variants → 99", () => {
    const cases = [
      ["draw everyone here", "everyone"],
      ["draw everybody", "everybody"],
      ["draw every one of us", "every one"],
      ["draw all of us", "all of us"],
      ["draw everyone else", "everyone else"],
      ["draw the boys", "the boys"],
      ["draw the squad", "the squad"],
      ["draw the gang", "the gang"],
      ["draw the chat", "the chat"],
      ["draw the server", "the server"],
      ["draw us all together", "us all"],
    ];

    test.each(cases)("%s → 99 (%s)", (input) => {
      expect(detectGroupRef(input)).toBe(99);
    });
  });

  describe("should detect 'top N' → specific count", () => {
    const cases = [
      ["draw the top 5 people", 5],
      ["draw the top 3 chatters", 3],
      ["draw the top 10 members", 10],
    ];

    test.each(cases)("%s → %d", (input, expected) => {
      expect(detectGroupRef(input)).toBe(expected);
    });
  });

  describe("should detect 'the N of us' → specific count", () => {
    const cases = [
      ["draw the 4 of us", 4],
      ["draw the 3 of us together", 3],
      ["draw the 7 of us as superheroes", 7],
    ];

    test.each(cases)("%s → %d", (input, expected) => {
      expect(detectGroupRef(input)).toBe(expected);
    });
  });

  describe("should NOT detect group reference → 0", () => {
    const negatives = [
      ["draw me", "self only"],
      ["draw Rodrigo", "single person"],
      ["draw a cat", "generic subject"],
      ["draw my avatar", "self avatar"],
      ["top quality art", "top without number"],
      ["all the colors", "all without 'of us'"],
    ];

    test.each(negatives)("%s → 0 (%s)", (input) => {
      expect(detectGroupRef(input)).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Pipeline integration — mightBeImageRequest gates self-ref
// ═══════════════════════════════════════════════════════════════════

describe("Pipeline integration", () => {
  describe("self-ref should only fire when gated by mightBeImageRequest", () => {
    test("'draw me' — both gate and self-ref fire", () => {
      const text = "draw me as a samurai";
      expect(mightBeImageRequest(text)).toBe(true);
      expect(hasSelfRefRegex(text)).toBe(true);
    });

    test("'my pfp' alone — self-ref matches but gate may not fire", () => {
      // "my pfp" has no draw verb, so mightBeImageRequest doesn't fire
      // This is correct — without a draw verb, it's not an image request
      const text = "my pfp looks cool";
      expect(mightBeImageRequest(text)).toBe(false);
      // Even though regex matches the possessive pattern
      expect(hasSelfRefRegex(text)).toBe(true);
    });

    test("'draw my profile picture' — both fire", () => {
      const text = "Draw a renaissance painting version of my profile picture";
      expect(mightBeImageRequest(text)).toBe(true);
      expect(hasSelfRefRegex(text)).toBe(true);
    });

    test("'draw everyone' — gate fires but self-ref does not", () => {
      const text = "draw everyone here";
      expect(mightBeImageRequest(text)).toBe(true);
      expect(hasSelfRefRegex(text)).toBe(false);
      expect(detectGroupRef(text)).toBe(99);
    });
  });
});
