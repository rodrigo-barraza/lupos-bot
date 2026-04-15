
// ============================================================
// Scraper Service — Tools API Client
// ============================================================
// Lightweight HTTP client that delegates all scraping to the
// centralized tools-api CrawlerService (Crawlee + Cheerio).
//
// Replaces the previous Puppeteer-based implementation.
// No local browser dependencies required.
// ============================================================

import config from "#root/secrets.js";
import utilities from "#root/utilities.js";

const TOOLS_API_URL = config.TOOLS_API_URL || "http://localhost:5590";
const SCRAPE_TIMEOUT_MS = 15_000;

/**
 * Fetch page metadata from tools-api's /utility/scrape/metadata endpoint.
 *
 * @param {string} url - Target URL to scrape
 * @returns {Promise<object>} Metadata object ({ title, description, image, video, keywords, ... })
 */
async function fetchMetadata(url) {
  const endpoint = `${TOOLS_API_URL}/utility/scrape/metadata?url=${encodeURIComponent(url)}`;
  const result = await utilities.fetchWithTimeout(endpoint, SCRAPE_TIMEOUT_MS);
  return result ?? {};
}

class ScraperService {
  /**
   * Extract Tenor GIF metadata (image URL, title, keywords).
   * Previously used Puppeteer to render the page — now delegates
   * to tools-api Cheerio extraction.
   *
   * @param {string} url - Tenor URL (https://tenor.com/view/...)
   * @returns {Promise<object>} { title, image, keywords, name }
   */
  static async scrapeTenor(url) {
    const metadata = await fetchMetadata(url);

    // Build the same shape as the old Puppeteer-based response
    const result = {};

    if (metadata.title) result.title = metadata.title;
    if (metadata.image) result.image = metadata.image;
    if (metadata.keywords) result.keywords = metadata.keywords;

    // Derive name from URL (same logic as before)
    result.name = url
      .replace("https://tenor.com/view/", "")
      .replace(/-/g, " ")
      .replace(/%20/g, " ");

    return result;
  }

  /**
   * Extract Twitch stream metadata (title, description, image).
   * Previously used Puppeteer to render the page — now delegates
   * to tools-api Cheerio extraction.
   *
   * @param {string} url - Twitch URL (https://twitch.tv/...)
   * @returns {Promise<object>} { title, description, image, video }
   */
  static async scrapeTwitchUrl(url) {
    return await fetchMetadata(url);
  }
}

export default ScraperService;
