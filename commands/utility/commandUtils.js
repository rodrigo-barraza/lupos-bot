/**
 * Shared utilities for slash commands.
 * Consolidates duplicated helpers from beatup, guesswho, heatmap,
 * leaderboard, mentions, shock, and wordcloud commands.
 */

import MongoService from "#root/services/MongoService.js";
import { MONGO_DB_NAME } from "#root/constants.js";

// ─── Database ─────────────────────────────────────────────────────────

/**
 * Returns the Lupos database instance from the local Mongo client.
 */
export function getMongoDb() {
  const localMongo = MongoService.getClient("local");
  return localMongo.db(MONGO_DB_NAME);
}

// ─── Time Helpers ─────────────────────────────────────────────────────

/**
 * Calculates the server's age in whole years from its creation timestamp.
 */
export function getServerAgeYears(guild) {
  const serverAgeInDays = Math.floor(
    (Date.now() - guild.createdTimestamp) / (1000 * 60 * 60 * 24),
  );
  return Math.floor(serverAgeInDays / 365);
}

/**
 * Computes a start date offset from now by the given years/months/days.
 * Returns { startDate: Date, unixStartDate: number }.
 */
export function computeStartDate(years, months, days) {
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);
  startDate.setMonth(startDate.getMonth() - months);
  startDate.setDate(startDate.getDate() - days);
  return { startDate, unixStartDate: Math.floor(startDate.getTime()) };
}

/**
 * Formats a human-readable time period string.
 * @param {string} [fallback] — text to return when all values are 0.
 */
export function formatTimePeriod(years, months, days, fallback = "All time") {
  const parts = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);

  if (parts.length === 0) return fallback;
  return "Last " + parts.join(", ");
}

// ─── Display Helpers ──────────────────────────────────────────────────

/**
 * Returns a medal emoji for leaderboard positions 0-4.
 */
export function getMedal(index) {
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

// ─── Puppeteer ────────────────────────────────────────────────────────

/**
 * Returns platform-aware Puppeteer launch options.
 * Windows uses the bundled Chromium; Linux uses the system chromium-browser.
 */
export function getPuppeteerOptions() {
  if (process.platform === "win32") {
    return { headless: true };
  }
  return {
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox"],
  };
}

// ─── Array Helpers ────────────────────────────────────────────────────

/**
 * Fisher-Yates in-place shuffle.
 */
export function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
