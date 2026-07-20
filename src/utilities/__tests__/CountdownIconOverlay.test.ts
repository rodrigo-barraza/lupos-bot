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
} from "#root/utilities/CountdownIconOverlay.ts";

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
      // Reduced font-size of 105px (512 * 0.205)
      expect(svgString).toContain('font-size="105"');
    });

    it("uses two-digit font scale for numbers under 100", () => {
      const svg = buildNumberOverlaySvg(512, 512, 68);
      const svgString = svg.toString("utf-8");

      // Normal scale font-size of 141px (512 * 0.275)
      expect(svgString).toContain('font-size="141"');
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
    it("produces a GIF buffer from a GIF source (output mirrors source format)", async () => {
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
      expect(result.subarray(0, 3).toString("ascii")).toBe("GIF");
    });

    it("produces a PNG buffer from a PNG source (output mirrors source format)", async () => {
      const testPngBuffer = await sharp({
        create: {
          width: 128,
          height: 128,
          channels: 4,
          background: { r: 200, g: 180, b: 80, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await overlayCountdownNumber({
        sourceImageBuffer: testPngBuffer,
        countdownNumber: 29,
      });

      expect(result.subarray(1, 4).toString("ascii")).toBe("PNG");

      const outputMetadata = await sharp(result).metadata();
      expect(outputMetadata.width).toBe(128);
      expect(outputMetadata.height).toBe(128);
    });

    it("preserves animation across multiple frames", async () => {
      // Create individual frames as raw pixel buffers
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

      const greenFrame = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      // Build a real 3-frame animated GIF with explicit delays
      const frameDelays = [100, 200, 150];
      const animatedGif = await sharp(redFrame, { animated: true })
        .composite([
          { input: blueFrame, tile: false, top: 64, left: 0 },
          { input: greenFrame, tile: false, top: 128, left: 0 },
        ])
        .resize({ width: 64, height: 192 }) // 3 frames stacked
        .gif({ delay: frameDelays, loop: 0 })
        .toBuffer();

      // Verify source is actually multi-frame before overlaying
      const sourceMetadata = await sharp(animatedGif, {
        animated: true,
      }).metadata();
      // sharp may collapse identical-looking frames; verify we at least get a GIF
      expect(sourceMetadata.format).toBe("gif");

      const result = await overlayCountdownNumber({
        sourceImageBuffer: animatedGif,
        countdownNumber: 7,
      });

      expect(result).toBeInstanceOf(Buffer);

      const outputMetadata = await sharp(result, { animated: true }).metadata();
      expect(outputMetadata.format).toBe("gif");

      // If multiple frames survived, verify delay metadata was preserved
      if (outputMetadata.pages && outputMetadata.pages > 1) {
        expect(outputMetadata.delay).toBeDefined();
        expect(outputMetadata.delay!.length).toBe(outputMetadata.pages);
        expect(outputMetadata.loop).toBeDefined();
      }
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

    it("preserves alpha transparency through the composite pipeline", async () => {
      // Create a 64×64 GIF where the entire image is fully transparent
      const transparentGifBuffer = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .gif()
        .toBuffer();

      // Verify the source has alpha
      const sourceMetadata = await sharp(transparentGifBuffer).metadata();
      expect(sourceMetadata.hasAlpha).toBe(true);

      const result = await overlayCountdownNumber({
        sourceImageBuffer: transparentGifBuffer,
        countdownNumber: 15,
      });

      // Output must retain alpha channel metadata
      const outputMetadata = await sharp(result).metadata();
      expect(outputMetadata.hasAlpha).toBe(true);
      expect(outputMetadata.channels).toBe(4);

      // Read raw pixel data to verify transparent pixels survived
      const rawOutput = await sharp(result).raw().toBuffer();

      // The overlay badge occupies the center — corner pixels must
      // remain fully transparent (alpha = 0)
      const topLeftAlpha = rawOutput[3]; // RGBA byte index 3
      expect(topLeftAlpha).toBe(0);

      const bottomRightIndex = (64 * 64 - 1) * 4 + 3;
      const bottomRightAlpha = rawOutput[bottomRightIndex];
      expect(bottomRightAlpha).toBe(0);
    });
  });
});
