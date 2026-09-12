// ============================================================
// CountdownIconJob.test.ts — Unit Tests
// ============================================================
// The last midnight before the target uploads a "1" badge; Discord
// keeps whatever was uploaded last. These pin that reaching the
// date is an upload of the pristine base icon, done once.
// ============================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  updateCountdownIcon,
  restoredMarkerPath,
  BASE_ICON_DIR,
} from "#root/jobs/scheduled/CountdownIconJob.ts";
import type { Client } from "discord.js";

const TEST_GUILD_ID = "countdown-icon-job-test-guild";
const TEST_BASE_ICON = `${TEST_GUILD_ID}-base.png`;

function buildFakeClient(setIcon: ReturnType<typeof vi.fn>): Client {
  const guild = { setIcon, iconURL: () => null };
  return {
    guilds: { cache: new Map([[TEST_GUILD_ID, guild]]) },
  } as unknown as Client;
}

async function writeTestBaseIcon(): Promise<Buffer> {
  const buffer = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(BASE_ICON_DIR, TEST_BASE_ICON), buffer);
  return buffer;
}

function cleanTestFiles() {
  for (const name of fs.readdirSync(BASE_ICON_DIR)) {
    if (name.includes(TEST_GUILD_ID)) {
      fs.rmSync(path.join(BASE_ICON_DIR, name));
    }
  }
}

describe("CountdownIconJob", () => {
  afterEach(cleanTestFiles);

  it("restores the pristine base icon once the target date is reached", async () => {
    const baseIconBuffer = await writeTestBaseIcon();
    const setIcon = vi.fn().mockResolvedValue(undefined);
    const today = new Date();

    const finished = await updateCountdownIcon({
      client: buildFakeClient(setIcon),
      guildId: TEST_GUILD_ID,
      targetDate: today,
      baseIconFilename: TEST_BASE_ICON,
    });

    expect(finished).toBe(true);
    expect(setIcon).toHaveBeenCalledTimes(1);
    const [uploaded, reason] = setIcon.mock.calls[0];
    expect(Buffer.compare(uploaded, baseIconBuffer)).toBe(0);
    expect(reason).toContain("base icon restored");
    expect(
      fs.existsSync(
        restoredMarkerPath(TEST_GUILD_ID, today.toISOString().slice(0, 10)),
      ),
    ).toBe(true);
  });

  it("does not re-upload the base icon on a later run for the same date", async () => {
    await writeTestBaseIcon();
    const setIcon = vi.fn().mockResolvedValue(undefined);
    const configuration = {
      client: buildFakeClient(setIcon),
      guildId: TEST_GUILD_ID,
      targetDate: new Date(2020, 0, 1),
      baseIconFilename: TEST_BASE_ICON,
    };

    expect(await updateCountdownIcon(configuration)).toBe(true);
    expect(await updateCountdownIcon(configuration)).toBe(true);
    expect(setIcon).toHaveBeenCalledTimes(1);
  });

  it("still overlays a number while the target date is ahead", async () => {
    const baseIconBuffer = await writeTestBaseIcon();
    const setIcon = vi.fn().mockResolvedValue(undefined);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const finished = await updateCountdownIcon({
      client: buildFakeClient(setIcon),
      guildId: TEST_GUILD_ID,
      targetDate: tomorrow,
      baseIconFilename: TEST_BASE_ICON,
    });

    expect(finished).toBe(false);
    expect(setIcon).toHaveBeenCalledTimes(1);
    const [uploaded, reason] = setIcon.mock.calls[0];
    expect(Buffer.compare(uploaded, baseIconBuffer)).not.toBe(0);
    expect(reason).toContain("1 days until");
  });
});

describe("CountdownIconJob restore failure", () => {
  afterEach(cleanTestFiles);

  it("keeps the schedule alive when the base icon cannot be found", async () => {
    const setIcon = vi.fn().mockResolvedValue(undefined);

    const finished = await updateCountdownIcon({
      client: buildFakeClient(setIcon),
      guildId: TEST_GUILD_ID,
      targetDate: new Date(2020, 0, 1),
      baseIconFilename: TEST_BASE_ICON, // never written, no fallback URL
    });

    expect(finished).toBe(false);
    expect(setIcon).not.toHaveBeenCalled();
  });
});
