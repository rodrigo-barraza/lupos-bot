import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import utilities from "#root/utilities.js";
import {
  overlayCountdownNumber,
  calculateDaysUntilTarget,
} from "#root/utilities/CountdownIconOverlay.js";
import type { Client } from "discord.js";

const { consoleLog } = utilities;

const BASE_ICON_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../images/countdown",
);
const BASE_ICON_FILENAME = "base-icon.gif";

// Fallback URL — used to auto-download the base icon on first boot
const BASE_ICON_FALLBACK_URL =
  "https://cdn.discordapp.com/attachments/634583290984136716/1523756103136055346/maga-lupos-animated.gif";

interface CountdownIconJobConfiguration {
  client: Client;
  guildId: string;
  targetDate: Date;
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

/**
 * Ensure the base icon exists locally. Downloads from the fallback
 * URL if the file is missing (e.g. fresh deployment before images
 * were copied in).
 */
async function ensureBaseIconExists(): Promise<string | null> {
  const baseIconPath = path.join(BASE_ICON_DIR, BASE_ICON_FILENAME);

  if (fs.existsSync(baseIconPath)) {
    return baseIconPath;
  }

  // Auto-download fallback
  consoleLog(
    "=",
    `[CountdownIconJob] Base icon not found locally — downloading…`,
  );

  try {
    if (!fs.existsSync(BASE_ICON_DIR)) {
      fs.mkdirSync(BASE_ICON_DIR, { recursive: true });
    }

    const response = await fetch(BASE_ICON_FALLBACK_URL);
    if (!response.ok) {
      consoleLog(
        "!",
        `[CountdownIconJob] Failed to download base icon: HTTP ${response.status}`,
      );
      return null;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(baseIconPath, imageBuffer);
    consoleLog(
      "=",
      `[CountdownIconJob] ✅ Base icon downloaded (${(imageBuffer.length / 1024).toFixed(0)} KB)`,
    );
    return baseIconPath;
  } catch (error: unknown) {
    consoleLog(
      "!",
      `[CountdownIconJob] Download error: ${(error as Error).message}`,
    );
    return null;
  }
}

// ─── Core Update ────────────────────────────────────────────────

async function updateCountdownIcon({
  client,
  guildId,
  targetDate,
}: CountdownIconJobConfiguration) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      consoleLog("!", `[CountdownIconJob] Guild ${guildId} not found in cache`);
      return;
    }

    const daysRemaining = calculateDaysUntilTarget(targetDate);
    const targetDateLabel = targetDate.toISOString().slice(0, 10);

    if (daysRemaining <= 0) {
      consoleLog(
        "=",
        `[CountdownIconJob] 📅 Target date ${targetDateLabel} reached — no overlay needed`,
      );
      return;
    }

    // Ensure we have the pristine base icon
    const baseIconPath = await ensureBaseIconExists();
    if (!baseIconPath) {
      consoleLog(
        "!",
        "[CountdownIconJob] Cannot proceed without base icon",
      );
      return;
    }

    const baseIconBuffer = fs.readFileSync(baseIconPath);

    consoleLog(
      "=",
      `[CountdownIconJob] 📅 ${daysRemaining} days until ${targetDateLabel} — generating overlay…`,
    );

    // Composite the countdown number onto the pristine base
    const overlaidBuffer = await overlayCountdownNumber({
      sourceImageBuffer: baseIconBuffer,
      countdownNumber: daysRemaining,
    });

    // Save a copy for debugging / history
    const generatedPath = path.join(
      BASE_ICON_DIR,
      `countdown-${daysRemaining}.gif`,
    );
    fs.writeFileSync(generatedPath, overlaidBuffer);

    // Update the Discord guild icon
    await guild.setIcon(
      overlaidBuffer,
      `Countdown: ${daysRemaining} days until ${targetDateLabel}`,
    );

    consoleLog(
      "=",
      `[CountdownIconJob] ✅ Guild icon updated → ${daysRemaining} days remaining`,
    );
  } catch (error: unknown) {
    consoleLog(
      "!",
      `[CountdownIconJob] Error: ${(error as Error).message}`,
    );
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
    `[CountdownIconJob] ⏰ Next update in ${hoursUntilMidnight}h (midnight)`,
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
      `[CountdownIconJob] 📅 Starting countdown to ${targetDateLabel} for guild ${jobConfiguration.guildId}`,
    );

    // Execute immediately on startup, then schedule midnight updates
    updateCountdownIcon(jobConfiguration).then(() => {
      scheduleNextMidnightUpdate(jobConfiguration);
    });
  },
};

export default CountdownIconJob;
