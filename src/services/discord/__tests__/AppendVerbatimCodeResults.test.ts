import { describe, expect, it } from "vitest";
import { appendVerbatimCodeResults } from "../PromptBuilder.ts";

const BANNER =
  "   ____  __  ____   ______\n  / __ \\/  |/  / | / /  _/\n / / / / /|_/ /  |/ // /  ";

function bannerResult(overrides: Record<string, unknown> = {}) {
  return {
    name: "generate_ascii_banner",
    result: {
      banner: BANNER,
      font: "Slant",
      display: { kind: "code", sourceField: "banner", language: "text" },
      ...overrides,
    },
  };
}

describe("appendVerbatimCodeResults", () => {
  it("appends a fenced block when the reply lacks the verbatim payload", () => {
    const output = appendVerbatimCodeResults("Here you go!", [bannerResult()]);
    expect(output).toContain("Here you go!");
    expect(output).toContain("```");
    expect(output).toContain(BANNER.replace(/\s+$/, ""));
  });

  it("skips when the reply already contains the payload (server substitution)", () => {
    const inlined = `Here you go!\n\`\`\`\n${BANNER}\n\`\`\``;
    expect(appendVerbatimCodeResults(inlined, [bannerResult()])).toBe(inlined);
  });

  it("uses the language as fence info string when not plain text", () => {
    const output = appendVerbatimCodeResults("Diff:", [
      {
        name: "diff_text",
        result: {
          patch: "--- a\n+++ b\n-old\n+new",
          display: { kind: "code", sourceField: "patch", language: "diff" },
        },
      },
    ]);
    expect(output).toContain("```diff\n");
  });

  it("ignores results without a code display or with missing fields", () => {
    expect(
      appendVerbatimCodeResults("Reply", [
        { name: "get_weather", result: { temperature: 20 } },
        {
          name: "broken",
          result: { display: { kind: "code", sourceField: "missing" } },
        },
        { name: "stringy", result: "not an object" },
      ]),
    ).toBe("Reply");
  });

  it("skips payloads too large for a Discord message", () => {
    const huge = "x".repeat(2000);
    expect(
      appendVerbatimCodeResults("Reply", [
        {
          name: "convert_image_to_ascii",
          result: {
            ascii: huge,
            display: { kind: "code", sourceField: "ascii" },
          },
        },
      ]),
    ).toBe("Reply");
  });

  it("handles undefined toolResults", () => {
    expect(appendVerbatimCodeResults("Reply", undefined)).toBe("Reply");
  });
});
