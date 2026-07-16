import { describe, expect, it } from "vitest";
import {
  formatEmotionDetail,
  formatMoodStatusLine,
} from "../SomaticStatsFormatter.js";

function detail(dominant: string, intensity: number) {
  return formatEmotionDetail({ dominant, intensity });
}

describe("formatMoodStatusLine", () => {
  it("formats a mid-intensity emotion without a qualifier", () => {
    const line = formatMoodStatusLine(detail("anger", 50));
    expect(line).toMatch(/Feeling anger$/);
    expect(line).not.toContain("very");
    expect(line).not.toContain("a bit");
  });

  it("adds 'very' at high intensity and 'a bit' at low intensity", () => {
    expect(formatMoodStatusLine(detail("anger", 85))).toContain(
      "Feeling very anger",
    );
    expect(formatMoodStatusLine(detail("joy", 20))).toContain(
      "Feeling a bit joy",
    );
  });

  it("uses the neutral line when nothing dominates", () => {
    expect(formatMoodStatusLine(detail("neutral", 0))).toBe(
      "😶 Feeling nothing much",
    );
    expect(formatMoodStatusLine(detail("", 0))).toBe("😶 Feeling nothing much");
  });

  it("starts with an emoji", () => {
    expect(formatMoodStatusLine(detail("joy", 60))).toMatch(/^\p{Emoji}/u);
  });
});
