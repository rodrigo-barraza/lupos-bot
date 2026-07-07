// ============================================================
// CountdownIconOverlay.test.ts — Unit Tests
// ============================================================
// Tests the countdown date calculation, SVG generation, and
// animated GIF overlay compositing logic.
// ============================================================

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  calculateDaysUntilTarget,
  parseTargetDateString,
  buildNumberOverlaySvg,
  overlayCountdownNumber,
} from "#root/utilities/CountdownIconOverlay.js";

describe("CountdownIconOverlay", () => {
  // ─── Date Calculation ─────────────────────────────────────────

  describe("calculateDaysUntilTarget", () => {
    it("returns positive days for a future date", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      expect(calculateDaysUntilTarget(futureDate)).toBe(30);
    });

    it("returns 0 for today", () => {
      const today = new Date();
      expect(calculateDaysUntilTarget(today)).toBe(0);
    });

    it("returns 0 for a past date (never negative)", () => {
      const pastDate = new Date(2020, 0, 1);
      expect(calculateDaysUntilTarget(pastDate)).toBe(0);
    });

    it("returns 1 for tomorrow", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(calculateDaysUntilTarget(tomorrow)).toBe(1);
    });

    it("handles year boundaries correctly", () => {
      const now = new Date();
      const nextYear = new Date(now.getFullYear() + 1, 0, 1);
      const daysRemaining = calculateDaysUntilTarget(nextYear);
      expect(daysRemaining).toBeGreaterThan(0);
      expect(daysRemaining).toBeLessThanOrEqual(366);
    });
  });

  // ─── Date Parsing ─────────────────────────────────────────────

  describe("parseTargetDateString", () => {
    it("parses YYYY-MM-DD format correctly", () => {
      const date = parseTargetDateString("2026-09-12");
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(8); // 0-indexed: September = 8
      expect(date.getDate()).toBe(12);
    });

    it("parses January 1st correctly (month boundary)", () => {
      const date = parseTargetDateString("2027-01-01");
      expect(date.getFullYear()).toBe(2027);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(1);
    });

    it("parses December 31st correctly", () => {
      const date = parseTargetDateString("2026-12-31");
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(31);
    });
  });

  // ─── SVG Generation ───────────────────────────────────────────

  describe("buildNumberOverlaySvg", () => {
    it("generates valid SVG with the correct dimensions", () => {
      const svg = buildNumberOverlaySvg(512, 512, 68);
      const svgString = svg.toString("utf-8");

      expect(svgString).toContain('width="512"');
      expect(svgString).toContain('height="512"');
      expect(svgString).toContain("68");
    });

    it("includes the countdown number in the SVG text", () => {
      const svg = buildNumberOverlaySvg(256, 256, 42);
      const svgString = svg.toString("utf-8");

      expect(svgString).toContain("42");
    });

    it("handles single-digit numbers", () => {
      const svg = buildNumberOverlaySvg(512, 512, 5);
      expect(svg.toString("utf-8")).toContain("5");
    });

    it("handles three-digit numbers with reduced font size", () => {
      const svg = buildNumberOverlaySvg(512, 512, 365);
      const svgString = svg.toString("utf-8");

      expect(svgString).toContain("365");
      // Reduced font-size of 120px (512 * 0.234375)
      expect(svgString).toContain('font-size="120"');
    });

    it("uses two-digit font scale for numbers under 100", () => {
      const svg = buildNumberOverlaySvg(512, 512, 68);
      const svgString = svg.toString("utf-8");

      // Normal scale font-size of 160px (512 * 0.3125)
      expect(svgString).toContain('font-size="160"');
    });

    it("contains a semi-transparent circle badge", () => {
      const svg = buildNumberOverlaySvg(512, 512, 10);
      const svgString = svg.toString("utf-8");

      expect(svgString).toContain("<circle");
      expect(svgString).toContain('fill-opacity="0.55"');
    });
  });

  // ─── GIF Overlay (Integration) ────────────────────────────────

  describe("overlayCountdownNumber", () => {
    it("produces a valid GIF buffer from a static image", async () => {
      // Create a minimal 64×64 red test image as GIF
      const testGifBuffer = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .gif()
        .toBuffer();

      const result = await overlayCountdownNumber({
        sourceImageBuffer: testGifBuffer,
        countdownNumber: 42,
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      // Verify it's a valid GIF (magic bytes: GIF89a or GIF87a)
      const gifMagic = result.subarray(0, 3).toString("ascii");
      expect(gifMagic).toBe("GIF");
    });

    it("preserves animation across multiple frames", async () => {
      // Create a 2-frame animated GIF (red then blue)
      const redFrame = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const blueFrame = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      // Stack frames into an animated GIF
      const animatedGif = await sharp(redFrame, { animated: true })
        .joinChannel([], {})
        .gif()
        .toBuffer();

      // Even with a single-frame fallback, overlay should succeed
      const result = await overlayCountdownNumber({
        sourceImageBuffer: animatedGif,
        countdownNumber: 7,
      });

      expect(result).toBeInstanceOf(Buffer);

      const metadata = await sharp(result, { animated: true }).metadata();
      expect(metadata.format).toBe("gif");
    });

    it("handles the number 0 (countdown complete)", async () => {
      const testGifBuffer = await sharp({
        create: {
          width: 128,
          height: 128,
          channels: 4,
          background: { r: 0, g: 128, b: 0, alpha: 1 },
        },
      })
        .gif()
        .toBuffer();

      const result = await overlayCountdownNumber({
        sourceImageBuffer: testGifBuffer,
        countdownNumber: 0,
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 3).toString("ascii")).toBe("GIF");
    });
  });
});
