// ============================================================
// Scraper Service — Tools API Client
// ============================================================
// Lightweight HTTP client that delegates all scraping to the
// centralized tools-api CrawlerService (Crawlee + Cheerio).
//
// Replaces the previous Puppeteer-based implementation.
// No local browser dependencies required.
// ============================================================

import { fetchWithTimeout } from "@rodrigo-barraza/utilities-library";

import config from "#root/config.ts";

const TOOLS_SERVICE_URL = config.TOOLS_SERVICE_URL;
const SCRAPE_TIMEOUT_MS = 15_000;

interface ScrapedMetadata {
  title?: string;
  image?: string;
  keywords?: string;
  description?: string;
  [key: string]: string | undefined;
}

/**
 * Fetch page metadata from tools-api's /utility/scrape/metadata endpoint.
 */
async function fetchMetadata(url: string): Promise<ScrapedMetadata> {
  const endpoint = `${TOOLS_SERVICE_URL}/utility/scrape/metadata?url=${encodeURIComponent(url)}`;
  const result = await fetchWithTimeout<ScrapedMetadata>(endpoint, SCRAPE_TIMEOUT_MS);
  return result ?? {};
}

class ScraperService {
  /**
   * Extract Tenor GIF metadata (image URL, title, keywords).
   * Previously used Puppeteer to render the page — now delegates
   * to tools-api Cheerio extraction.
   */
  static async scrapeTenor(url: string) {
    const metadata = await fetchMetadata(url);

    // Build the same shape as the old Puppeteer-based response
    const result: Record<string, string | undefined> = {};

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
   */
  static async scrapeTwitchUrl(url: string) {
    return await fetchMetadata(url);
  }
}

export default ScraperService;
