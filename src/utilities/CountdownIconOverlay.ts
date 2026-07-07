import sharp from "sharp";

// ─── Types ──────────────────────────────────────────────────────

interface CountdownOverlayConfiguration {
  sourceImageBuffer: Buffer;
  countdownNumber: number;
}

// ─── SVG Generation ─────────────────────────────────────────────

/**
 * Build a single-frame SVG overlay containing the countdown number
 * centered inside a translucent dark badge. Uses the "double-text"
 * SVG technique (thick stroke underneath, clean white fill on top)
 * for maximum legibility over any background.
 */
function buildNumberOverlaySvg(
  frameWidth: number,
  frameHeight: number,
  countdownNumber: number,
): Buffer {
  const displayText = countdownNumber.toString();

  // Scale font size dynamically — shrink for 3+ digit numbers
  const smallestDimension = Math.min(frameWidth, frameHeight);
  const fontSizeMultiplier = displayText.length >= 3 ? 0.234375 : 0.3125;
  const fontSize = Math.round(smallestDimension * fontSizeMultiplier);
  const strokeWidth = Math.round(smallestDimension * 0.012);
  const badgeRadius = Math.round(smallestDimension * 0.15);
  const centerX = Math.round(frameWidth / 2);
  const centerY = Math.round(frameHeight * 0.3);

  return Buffer.from(`<svg width="${frameWidth}" height="${frameHeight}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${centerX}" cy="${centerY}" r="${badgeRadius}"
          fill="black" fill-opacity="0.55" />
  <text x="${centerX}" y="${centerY}"
        text-anchor="middle" dominant-baseline="central"
        font-family="Liberation Sans, Arial, Helvetica, sans-serif"
        font-size="${fontSize}" font-weight="900"
        fill="none" stroke="black" stroke-width="${strokeWidth * 2}"
        stroke-linejoin="round">
    ${displayText}
  </text>
  <text x="${centerX}" y="${centerY}"
        text-anchor="middle" dominant-baseline="central"
        font-family="Liberation Sans, Arial, Helvetica, sans-serif"
        font-size="${fontSize}" font-weight="900"
        fill="white">
    ${displayText}
  </text>
</svg>`);
}

// ─── GIF Overlay ────────────────────────────────────────────────

/**
 * Composites a countdown number onto every frame of an animated GIF.
 *
 * Sharp loads animated GIFs as a single tall image (all frames stacked
 * vertically). The SVG overlay is sized to a single frame and tiled
 * vertically so every frame receives the same number badge.
 */
async function overlayCountdownNumber({
  sourceImageBuffer,
  countdownNumber,
}: CountdownOverlayConfiguration): Promise<Buffer> {
  const image = sharp(sourceImageBuffer, { animated: true });
  const metadata = await image.metadata();

  const frameWidth = metadata.width!;
  const frameHeight = metadata.pageHeight || metadata.height!;

  const svgOverlay = buildNumberOverlaySvg(
    frameWidth,
    frameHeight,
    countdownNumber,
  );

  return image
    .composite([
      {
        input: svgOverlay,
        tile: true,
        gravity: "northwest",
      },
    ])
    .gif()
    .toBuffer();
}

// ─── Date Helpers ───────────────────────────────────────────────

/**
 * Calculate the number of calendar days remaining until the target date.
 * Returns 0 if the target date is today or in the past.
 */
function calculateDaysUntilTarget(targetDate: Date): number {
  const now = new Date();
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const targetMidnight = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
  );
  const differenceMilliseconds =
    targetMidnight.getTime() - todayMidnight.getTime();
  return Math.max(0, Math.ceil(differenceMilliseconds / (1000 * 60 * 60 * 24)));
}

/**
 * Parse a YYYY-MM-DD date string into a Date object.
 */
function parseTargetDateString(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export {
  overlayCountdownNumber,
  calculateDaysUntilTarget,
  parseTargetDateString,
  buildNumberOverlaySvg,
};
export type { CountdownOverlayConfiguration };
