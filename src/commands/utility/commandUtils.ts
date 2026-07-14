/**
 * Shared utilities for slash commands.
 * Consolidates duplicated helpers from beatup, guesswho, heatmap,
 * leaderboard, mentions, shock, and wordcloud commands.
 */

import MongoService from "#root/services/MongoService.js";
import { MONGO_DB_NAME } from "#root/constants.js";
import { EmbedBuilder, Guild } from "discord.js";
import type {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
  SlashCommandIntegerOption,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { Db } from "mongodb";
import { chromium } from "playwright";

// ─── Database ─────────────────────────────────────────────────────────

/**
 * Returns the Lupos database instance from the local Mongo client.
 */
export function getMongoDb(): Db {
  const localMongo = MongoService.getClient("local");
  if (!localMongo)
    throw new Error("MongoService: local client not initialized");
  return localMongo.db(MONGO_DB_NAME);
}

// ─── Time Helpers ─────────────────────────────────────────────────────

/**
 * Calculates the server's age in whole years from its creation timestamp.
 */
export function getServerAgeYears(guild: Guild): number {
  const serverAgeInDays = Math.floor(
    (Date.now() - guild.createdTimestamp) / (1000 * 60 * 60 * 24),
  );
  return Math.floor(serverAgeInDays / 365);
}

/**
 * Computes a start date offset from now by the given years/months/days.
 * Returns { startDate: Date, unixStartDate: number }.
 */
export function computeStartDate(
  years: number,
  months: number,
  days: number,
): { startDate: Date; unixStartDate: number } {
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);
  startDate.setMonth(startDate.getMonth() - months);
  startDate.setDate(startDate.getDate() - days);
  return { startDate, unixStartDate: Math.floor(startDate.getTime()) };
}

/**
 * Formats a human-readable time period string.
 */
export function formatTimePeriod(
  years: number,
  months: number,
  days: number,
  fallback = "All time",
): string {
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);

  if (parts.length === 0) return fallback;
  return "Last " + parts.join(", ");
}

// ─── Slash-Command Time Period Options ────────────────────────────────

/**
 * Appends the standard years/months/days look-back integer options to a
 * slash-command builder. Ranges are normalized across all commands:
 * years 0-7, months 0-12, days 0-31.
 */
export function addTimePeriodOptions(
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
): SlashCommandOptionsOnlyBuilder {
  return builder
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("years")
        .setDescription("Number of years to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7),
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("months")
        .setDescription("Number of months to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(12),
    )
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName("days")
        .setDescription("Number of days to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(31),
    );
}

export interface ResolvedPeriod {
  years: number;
  months: number;
  days: number;
  startDate: Date;
  unixStartDate: number;
  label: string;
}

/**
 * Reads the years/months/days options (see addTimePeriodOptions) and resolves
 * the look-back window plus a human-readable label.
 *
 * When all three options are zero the window defaults to the server's
 * lifetime (`getServerAgeYears + 1`, so servers younger than a year don't
 * collapse to a zero-length window) with the label "Server lifetime (default)".
 * Outside a guild the fallback is 1 year. A command can override that default
 * via `defaultPeriod` (e.g. leaderboard's "Last 7 days (default)").
 */
export function resolvePeriod(
  interaction: ChatInputCommandInteraction,
  defaultPeriod?: {
    years?: number;
    months?: number;
    days?: number;
    label?: string;
  },
): ResolvedPeriod {
  let years = interaction.options.getInteger("years") ?? 0;
  let months = interaction.options.getInteger("months") ?? 0;
  let days = interaction.options.getInteger("days") ?? 0;
  let label: string;

  if (years === 0 && months === 0 && days === 0) {
    if (defaultPeriod) {
      years = defaultPeriod.years ?? 0;
      months = defaultPeriod.months ?? 0;
      days = defaultPeriod.days ?? 0;
      label = defaultPeriod.label ?? formatTimePeriod(years, months, days);
    } else {
      // Default to the server's lifetime; +1 so servers younger than 1 year
      // don't collapse to a zero-length window.
      years = interaction.guild ? getServerAgeYears(interaction.guild) + 1 : 1;
      label = "Server lifetime (default)";
    }
  } else {
    label = formatTimePeriod(years, months, days);
  }

  const { startDate, unixStartDate } = computeStartDate(years, months, days);
  return { years, months, days, startDate, unixStartDate, label };
}

// ─── Display Helpers ──────────────────────────────────────────────────

/**
 * Returns a medal emoji for leaderboard positions 0-4.
 */
export function getMedal(index: number): string {
  switch (index) {
    case 0:
      return "🥇";
    case 1:
      return "🥈";
    case 2:
      return "🥉";
    case 3:
    case 4:
      return "🏅";
    default:
      return "  ";
  }
}

/** Discord's maximum embed description length. */
export const EMBED_DESCRIPTION_LIMIT = 4096;

/**
 * Truncates text to `max` characters at a line boundary, appending "…"
 * when anything was cut.
 */
export function truncateAtLineBoundary(
  text: string,
  max = EMBED_DESCRIPTION_LIMIT,
): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1); // leave room for the ellipsis
  const lastNewline = slice.lastIndexOf("\n");
  const cut = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  return cut + "…";
}

export interface LeaderboardEmbedOptions<T> {
  title: string;
  color: number;
  /** Preamble text rendered above the ranked lines. */
  description?: string;
  /** Entries already sorted by the caller (best first). */
  entries: T[];
  /**
   * Formats one ranked line. `index` is the entry's position in `entries`
   * (0-based), `medal` comes from getMedal, and `section` says whether the
   * line is being rendered in the top list or the bottom list.
   */
  formatLine: (
    entry: T,
    index: number,
    medal: string,
    section: "top" | "bottom",
  ) => string;
  /** How many leading entries to render (default: all). */
  topN?: number;
  /**
   * When set and there are more entries than `topN`, also renders the last
   * `bottomN` entries (worst first), each formatted with its original index.
   */
  bottomN?: number;
  /** Bold header line above the top section. */
  topHeader?: string;
  /** Bold header line above the bottom section. */
  bottomHeader?: string;
  footer?: string;
}

/**
 * Builds a leaderboard embed from pre-sorted entries: medal/rank lines for
 * the top N and (optionally) a bottom-N "hall of shame" section. The total
 * description is truncated to Discord's 4096-character embed limit at a
 * line boundary.
 */
export function buildLeaderboardEmbed<T>(
  options: LeaderboardEmbedOptions<T>,
): EmbedBuilder {
  const {
    title,
    color,
    description,
    entries,
    formatLine,
    topN,
    bottomN,
    topHeader,
    bottomHeader,
    footer,
  } = options;

  const sections: string[] = [];
  if (description) sections.push(description.replace(/\n+$/, ""));

  const topCount = topN ?? entries.length;
  const topEntries = entries.slice(0, topCount);
  if (topEntries.length > 0) {
    const topLines = topEntries.map((entry: T, index: number) =>
      formatLine(entry, index, getMedal(index), "top"),
    );
    sections.push(
      topHeader
        ? `**${topHeader}**\n${topLines.join("\n")}`
        : topLines.join("\n"),
    );
  }

  if (bottomN && entries.length > topCount) {
    const bottomEntries = entries.slice(-bottomN).reverse();
    const bottomLines = bottomEntries.map((entry: T) => {
      const index = entries.indexOf(entry);
      return formatLine(entry, index, getMedal(index), "bottom");
    });
    sections.push(
      bottomHeader
        ? `**${bottomHeader}**\n${bottomLines.join("\n")}`
        : bottomLines.join("\n"),
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();

  if (sections.length > 0) {
    embed.setDescription(truncateAtLineBoundary(sections.join("\n\n")));
  }
  if (footer) {
    embed.setFooter({ text: footer });
  }

  return embed;
}

// ─── Moderation Helpers ───────────────────────────────────────────────

/** Discord's maximum timeout duration (28 days). */
export const MAX_TIMEOUT_DURATION_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Times out a guild member, clamping the duration to Discord's 28-day
 * maximum. Never throws: returns `{ ok: false, error }` when the member
 * isn't moderatable or the API call fails ("missing permissions" for
 * Discord error 50013).
 */
export async function tryTimeoutMember(
  member: GuildMember,
  durationMs: number,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!member.moderatable) {
    return { ok: false, error: "missing permissions" };
  }

  const clampedDuration = Math.min(durationMs, MAX_TIMEOUT_DURATION_MS);

  try {
    await member.timeout(clampedDuration, reason);
    return { ok: true };
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 50013) {
      return { ok: false, error: "missing permissions" };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── Playwright ───────────────────────────────────────────────────────

/**
 * Returns platform-aware Playwright launch options.
 * Windows uses the bundled Chromium; Linux uses the system chromium.
 */
export function getPlaywrightOptions(): Record<string, unknown> {
  if (process.platform === "win32") {
    return { headless: true };
  }
  return {
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  };
}

/**
 * Renders an HTML document to a PNG buffer via headless Chromium.
 * Launches a browser per call (no shared instance yet), waits for the
 * network to go idle plus a small settle delay, screenshots the viewport,
 * and always closes the browser.
 */
export async function renderHtmlToPng(
  html: string,
  {
    width,
    height,
    omitBackground = false,
    settleDelayMs = 500,
  }: {
    width: number;
    height: number;
    omitBackground?: boolean;
    settleDelayMs?: number;
  },
): Promise<Buffer> {
  const browser = await chromium.launch(getPlaywrightOptions());

  try {
    const page = await browser.newPage({ viewport: { width, height } });

    await page.setContent(html, { waitUntil: "networkidle" });

    // Wait for client-side rendering (d3 layouts etc.) to settle
    await new Promise((resolve: (value: void) => void) =>
      setTimeout(resolve, settleDelayMs),
    );

    return await page.screenshot({
      type: "png",
      fullPage: false,
      omitBackground,
    });
  } finally {
    await browser.close();
  }
}

// ─── Array Helpers ────────────────────────────────────────────────────

/**
 * Fisher-Yates in-place shuffle.
 */
export function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
