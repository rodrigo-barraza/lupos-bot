/**
 * Unit tests for ImageIntent — image-request detection heuristics.
 *
 * Regression (Whitemane playground incident, 2026-07-21): additive edit
 * phrasings on replies to bot images ("Add me to this", "PUT MOIRE
 * CHATTERS IN THIS PLEASE") matched no draw-verb regex, so the requests
 * reached the model with zero avatar references and it invented
 * likenesses for the named people.
 */
import { describe, it, expect } from "vitest";
import {
  mightBeImageRequest,
  detectGroupReference,
  hasSelfReferenceRegex,
  isAdditiveEditRequest,
  hasAdditiveSelfReference,
} from "#root/services/discord/ImageIntent.ts";

describe("mightBeImageRequest", () => {
  it("fires on draw-verb requests", () => {
    expect(mightBeImageRequest("draw everyone as kawaii people")).toBe(true);
    expect(mightBeImageRequest("can you paint me as a knight")).toBe(true);
  });

  it("does not fire on plain chat", () => {
    expect(mightBeImageRequest("good morning chat")).toBe(false);
    expect(mightBeImageRequest("add that to the list")).toBe(false);
  });
});

describe("isAdditiveEditRequest (bot-image replies)", () => {
  it("fires on the incident phrasings", () => {
    expect(isAdditiveEditRequest("Add me to this")).toBe(true);
    expect(isAdditiveEditRequest("PUT MOIRE CHATTERS IN THIS PLEASE")).toBe(
      true,
    );
    expect(isAdditiveEditRequest("include Rodrigo too")).toBe(true);
    expect(isAdditiveEditRequest("stick kvz in there")).toBe(true);
  });

  it("does not fire without an additive verb", () => {
    expect(isAdditiveEditRequest("make it kawaii")).toBe(false);
    expect(isAdditiveEditRequest("lol nice")).toBe(false);
  });
});

describe("hasAdditiveSelfReference", () => {
  it("fires on self-additive phrasings", () => {
    expect(hasAdditiveSelfReference("Add me to this")).toBe(true);
    expect(hasAdditiveSelfReference("put me in it")).toBe(true);
    expect(hasAdditiveSelfReference("squeeze us in there")).toBe(true);
  });

  it("does not fire on transformative or third-party phrasings", () => {
    expect(hasAdditiveSelfReference("make me a bigger version")).toBe(false);
    expect(hasAdditiveSelfReference("add Rodrigo to this")).toBe(false);
  });
});

describe("detectGroupReference", () => {
  it("detects additive group phrasings", () => {
    expect(detectGroupReference("PUT MOIRE CHATTERS IN THIS PLEASE")).toBe(99);
    expect(detectGroupReference("add all the homies")).toBe(99);
  });

  it("still detects the classic draw phrasings", () => {
    expect(detectGroupReference("draw the top 5 people here")).toBe(5);
    expect(detectGroupReference("draw everyone")).toBe(99);
  });

  it("returns 0 without a group reference", () => {
    expect(detectGroupReference("draw me as a wizard")).toBe(0);
  });
});

describe("hasSelfReferenceRegex", () => {
  it("covers additive verbs now", () => {
    expect(hasSelfReferenceRegex("add me to the picture")).toBe(true);
    expect(hasSelfReferenceRegex("draw me as a samurai")).toBe(true);
  });

  it("does not fire on third-party requests", () => {
    expect(hasSelfReferenceRegex("draw Rodrigo as a samurai")).toBe(false);
  });
});
