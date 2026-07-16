import { describe, expect, it } from "vitest";
import { extractVideoDisplayUrl } from "../PromptBuilder.js";

const CLIP_URL = "https://minio.example.com/trims/abc123.mp4";

function trimResult(overrides: Record<string, unknown> = {}) {
  return {
    name: "trim_video",
    result: {
      downloadUrl: CLIP_URL,
      durationSeconds: 12,
      display: {
        kind: "video",
        url: CLIP_URL,
        title: "Trimmed video (0:10 → 0:22)",
      },
      ...overrides,
    },
  };
}

describe("extractVideoDisplayUrl", () => {
  it("returns the url of a video display envelope", () => {
    expect(extractVideoDisplayUrl([trimResult()])).toBe(CLIP_URL);
  });

  it("returns the first video when multiple tool results carry one", () => {
    const second = trimResult({
      display: { kind: "video", url: "https://example.com/other.mp4" },
    });
    expect(extractVideoDisplayUrl([trimResult(), second])).toBe(CLIP_URL);
  });

  it("ignores non-video displays and malformed results", () => {
    expect(
      extractVideoDisplayUrl([
        { name: "get_weather", result: { temperature: 20 } },
        {
          name: "generate_ascii_banner",
          result: { display: { kind: "code", sourceField: "banner" } },
        },
        { name: "stringy", result: "not an object" },
        { name: "no_url", result: { display: { kind: "video" } } },
      ]),
    ).toBeNull();
  });

  it("returns null for empty or missing tool results", () => {
    expect(extractVideoDisplayUrl(undefined)).toBeNull();
    expect(extractVideoDisplayUrl([])).toBeNull();
  });
});
