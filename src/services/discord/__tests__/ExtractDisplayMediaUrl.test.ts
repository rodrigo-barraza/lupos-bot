import { describe, expect, it } from "vitest";
import { extractDisplayMediaUrl } from "../PromptBuilder.ts";

const CLIP_URL = "https://minio.example.com/trims/abc123.mp4";
const IMAGE_URL = "https://minio.example.com/generations/qr-xyz.png";

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

function qrResult() {
  return {
    name: "generate_qr_code",
    result: {
      display: { kind: "image", url: IMAGE_URL, title: "QR Code" },
    },
  };
}

describe("extractDisplayMediaUrl", () => {
  it("returns the url of a matching display envelope", () => {
    expect(extractDisplayMediaUrl([trimResult()], "video")).toBe(CLIP_URL);
    expect(extractDisplayMediaUrl([qrResult()], "image")).toBe(IMAGE_URL);
  });

  it("only matches the requested kind", () => {
    expect(extractDisplayMediaUrl([trimResult()], "image")).toBeNull();
    expect(extractDisplayMediaUrl([qrResult()], "video")).toBeNull();
    expect(extractDisplayMediaUrl([qrResult(), trimResult()], "video")).toBe(
      CLIP_URL,
    );
  });

  it("returns the first match when multiple tool results carry one", () => {
    const second = trimResult({
      display: { kind: "video", url: "https://example.com/other.mp4" },
    });
    expect(extractDisplayMediaUrl([trimResult(), second], "video")).toBe(
      CLIP_URL,
    );
  });

  it("ignores non-media displays and malformed results", () => {
    expect(
      extractDisplayMediaUrl(
        [
          { name: "get_weather", result: { temperature: 20 } },
          {
            name: "generate_ascii_banner",
            result: { display: { kind: "code", sourceField: "banner" } },
          },
          { name: "stringy", result: "not an object" },
          { name: "no_url", result: { display: { kind: "video" } } },
        ],
        "video",
      ),
    ).toBeNull();
  });

  it("returns null for empty or missing tool results", () => {
    expect(extractDisplayMediaUrl(undefined, "video")).toBeNull();
    expect(extractDisplayMediaUrl([], "image")).toBeNull();
  });
});
