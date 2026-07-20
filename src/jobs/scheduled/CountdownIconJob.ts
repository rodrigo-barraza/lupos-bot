import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import utilities from "#root/utilities.ts";
import {
  overlayCountdownNumber,
  calculateDaysUntilTarget,
} from "#root/utilities/CountdownIconOverlay.ts";
import type { Client, Guild } from "discord.js";

const { consoleLog } = utilities;

const BASE_ICON_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../images/countdown",
);

interface CountdownIconJobConfiguration {
  client: Client;
  guildId: string;
  targetDate: Date;
  /** Pristine (overlay-free) base icon filename inside images/countdown/ */
  baseIconFilename: string;
  /** Pinned URL to auto-download the pristine base icon if missing locally */
  baseIconFallbackUrl?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Calculate milliseconds until the next midnight in the local timezone.
 * Adds a 30-second buffer to avoid sub-second timing drift.
 */
function getMillisecondsUntilNextMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    30, // 30-second buffer past midnight
  );
  return nextMidnight.getTime() - now.getTime();
}

async function downloadToFile(
  url: string,
  destinationPath: string,
  logPrefix: string,
): Promise<string | null> {
  try {
    if (!fs.existsSync(BASE_ICON_DIR)) {
      fs.mkdirSync(BASE_ICON_DIR, { recursive: true });
    }

    const response = await fetch(url);
    if (!response.ok) {
      consoleLog(
        "!",
        `${logPrefix} Failed to download base icon: HTTP ${response.status}`,
      );
      return null;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destinationPath, imageBuffer);
    consoleLog(
      "=",
      `${logPrefix} ✅ Base icon downloaded (${(imageBuffer.length / 1024).toFixed(0)} KB)`,
    );
    return destinationPath;
  } catch (error: unknown) {
    consoleLog(
      "!",
      `${logPrefix} Download error: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Ensure the pristine base icon exists locally. Downloads from the
 * pinned fallback URL if configured, otherwise falls back to the
 * guild's current Discord icon (only safe before the first overlay
 * has been applied — the local cache prevents compounding badges).
 */
async function ensureBaseIconExists(
  { baseIconFilename, baseIconFallbackUrl }: CountdownIconJobConfiguration,
  guild: Guild,
  logPrefix: string,
): Promise<string | null> {
  const baseIconPath = path.join(BASE_ICON_DIR, baseIconFilename);

  if (fs.existsSync(baseIconPath)) {
    return baseIconPath;
  }

  consoleLog(
    "=",
    `${logPrefix} Base icon ${baseIconFilename} not found locally — downloading…`,
  );

  const downloadUrl =
    baseIconFallbackUrl ??
    guild.iconURL({ size: 512, forceStatic: false }) ??
    undefined;

  if (!downloadUrl) {
    consoleLog(
      "!",
      `${logPrefix} No fallback URL and guild has no icon — cannot build base`,
    );
    return null;
  }

  return downloadToFile(downloadUrl, baseIconPath, logPrefix);
}

function detectImageExtension(imageBuffer: Buffer): string {
  if (imageBuffer.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  if (imageBuffer.subarray(1, 4).toString("ascii") === "PNG") return "png";
  if (imageBuffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) return "jpg";
  return "png";
}

// ─── Core Update ────────────────────────────────────────────────

async function updateCountdownIcon(
  jobConfiguration: CountdownIconJobConfiguration,
) {
  const { client, guildId, targetDate } = jobConfiguration;
  const logPrefix = `[CountdownIconJob:${guildId}]`;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      consoleLog("!", `${logPrefix} Guild not found in cache`);
      return;
    }

    const daysRemaining = calculateDaysUntilTarget(targetDate);
    const targetDateLabel = targetDate.toISOString().slice(0, 10);

    if (daysRemaining <= 0) {
      consoleLog(
        "=",
        `${logPrefix} 📅 Target date ${targetDateLabel} reached — no overlay needed`,
      );
      return;
    }

    // Ensure we have the pristine base icon
    const baseIconPath = await ensureBaseIconExists(
      jobConfiguration,
      guild,
      logPrefix,
    );
    if (!baseIconPath) {
      consoleLog("!", `${logPrefix} Cannot proceed without base icon`);
      return;
    }

    const baseIconBuffer = fs.readFileSync(baseIconPath);

    consoleLog(
      "=",
      `${logPrefix} 📅 ${daysRemaining} days until ${targetDateLabel} — generating overlay…`,
    );

    // Composite the countdown number onto the pristine base
    const overlaidBuffer = await overlayCountdownNumber({
      sourceImageBuffer: baseIconBuffer,
      countdownNumber: daysRemaining,
    });

    // Save a copy for debugging / history (output format mirrors the
    // base icon's format — sniff magic bytes for the right extension)
    const overlaidExtension = detectImageExtension(overlaidBuffer);
    const generatedPath = path.join(
      BASE_ICON_DIR,
      `countdown-${guildId}-${daysRemaining}.${overlaidExtension}`,
    );
    fs.writeFileSync(generatedPath, overlaidBuffer);

    // Update the Discord guild icon
    await guild.setIcon(
      overlaidBuffer,
      `Countdown: ${daysRemaining} days until ${targetDateLabel}`,
    );

    consoleLog(
      "=",
      `${logPrefix} ✅ Guild icon updated → ${daysRemaining} days remaining`,
    );
  } catch (error: unknown) {
    consoleLog("!", `${logPrefix} Error: ${(error as Error).message}`);
    console.error(error);
  }
}

// ─── Scheduler ──────────────────────────────────────────────────

function scheduleNextMidnightUpdate(
  jobConfiguration: CountdownIconJobConfiguration,
) {
  const millisecondsUntilMidnight = getMillisecondsUntilNextMidnight();
  const hoursUntilMidnight = (
    millisecondsUntilMidnight /
    (1000 * 60 * 60)
  ).toFixed(1);

  consoleLog(
    "=",
    `[CountdownIconJob:${jobConfiguration.guildId}] ⏰ Next update in ${hoursUntilMidnight}h (midnight)`,
  );

  setTimeout(async () => {
    await updateCountdownIcon(jobConfiguration);
    scheduleNextMidnightUpdate(jobConfiguration);
  }, millisecondsUntilMidnight);
}

const CountdownIconJob = {
  startJob(jobConfiguration: CountdownIconJobConfiguration) {
    const targetDateLabel = jobConfiguration.targetDate
      .toISOString()
      .slice(0, 10);

    consoleLog(
      "=",
      `[CountdownIconJob:${jobConfiguration.guildId}] 📅 Starting countdown to ${targetDateLabel}`,
    );

    // Execute immediately on startup, then schedule midnight updates
    updateCountdownIcon(jobConfiguration).then(() => {
      scheduleNextMidnightUpdate(jobConfiguration);
    });
  },
};

export default CountdownIconJob;
