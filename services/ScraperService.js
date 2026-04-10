
import fs from "fs";
import path from "path";
import os from "os";
const puppeteer = await import(
  process.platform === "win32" ? "puppeteer" : "puppeteer-core"
);
import { executablePath } from "puppeteer-core";

/**
 * Scan Puppeteer's cache directory for an installed Chrome executable.
 * Works across WSL, Ubuntu, and Raspberry Pi where puppeteer-core's
 * executablePath() may fail to resolve the bundled browser.
 */
function findCachedChrome() {
  const cacheDir = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  if (!fs.existsSync(cacheDir)) return null;

  try {
    const versions = fs.readdirSync(cacheDir);
    for (const version of versions) {
      const versionDir = path.join(cacheDir, version);
      if (!fs.statSync(versionDir).isDirectory()) continue;

      // Look for chrome binary inside nested directories (e.g. chrome-linux64/chrome)
      const subDirs = fs.readdirSync(versionDir);
      for (const sub of subDirs) {
        const chromeBin = path.join(versionDir, sub, "chrome");
        if (fs.existsSync(chromeBin)) return chromeBin;
      }
    }
  } catch {
    // Silently ignore scan errors
  }
  return null;
}

let puppeteerOptions = {};

if (process.platform === "win32") {
  puppeteerOptions = { headless: "shell" };
} else {
  // Find a usable Chromium/Chrome executable for Linux/WSL/Raspberry Pi
  const LINUX_CHROME_PATHS = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  let chromePath = LINUX_CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!chromePath) {
    // Try puppeteer-core's executablePath first
    try {
      chromePath = executablePath();
    } catch {
      // executablePath() failed — scan the Puppeteer cache manually
      chromePath = findCachedChrome();
    }
    if (!chromePath) {
      console.warn(
        "⚠️ [ScraperService] Could not find a Chrome/Chromium executable. Puppeteer may fail to launch.",
      );
    }
  }
  puppeteerOptions = {
    headless: "shell",
    executablePath: chromePath,
    args: ["--no-sandbox"],
  };
}

class ScraperService {
  static async scrapeTenor(url) {
    let browser;
    try {
      browser = await puppeteer.launch(puppeteerOptions);
      const page = await browser.newPage();
      // Set user agent to avoid bot detection
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url);

      const selectors = [
        { selector: "title", property: "title" },
        { selector: 'meta[itemprop="contentUrl"]', property: "image" },
        { selector: 'meta[itemprop="keywords"]', property: "keywords" },
      ];

      const result = {};

      await Promise.all(
        selectors.map(async ({ selector, property }) => {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });

            const value = await page.evaluate(
              (s, p) => {
                const element = document.querySelector(s);
                return element
                  ? element[p] || element.getAttribute("content")
                  : null;
              },
              selector,
              property,
            );

            if (value) {
              result[property] = value.trim();
            }
          } catch (error) {
            console.error(`Puppeteer Error on ${selector}:\n`, error);
          }
        }),
      );

      result.name = url
        .replace("https://tenor.com/view/", "")
        .replace(/-/g, " ")
        .replace(/%20/g, " ");

      await browser.close();
      return result;
    } catch (error) {
      console.error("Puppeteer Error:\n", error);
      return {};
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  static async scrapeTwitchUrl(url) {
    try {
      const browser = await puppeteer.launch(puppeteerOptions);
      const page = await browser.newPage();
      await page.goto(url, {
        timeout: 15000,
        waitUntil: "domcontentloaded",
      });

      const selectors = [
        { selector: "title", property: "title" },
        { selector: 'meta[name="description"]', property: "description" },
        { selector: 'meta[name="og:description"]', property: "description" },
        {
          selector: 'meta[name="twitter:description"]',
          property: "description",
        },
        { selector: 'meta[property="og:image"]', property: "image" },
        { selector: 'meta[property="og:video"]', property: "video" },
      ];

      const result = {};

      await Promise.all(
        selectors.map(async ({ selector, property }) => {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });

            const value = await page.evaluate(
              (s, p) => {
                const element = document.querySelector(s);
                return element
                  ? element[p] || element.getAttribute("content")
                  : null;
              },
              selector,
              property,
            );

            if (value) {
              result[property] = value.trim();
            }
          } catch {
            // Silently ignore — selector may not exist on this page
          }
        }),
      );

      await browser.close();
      return result;
    } catch (error) {
      console.error("Puppeteer Error:\n", error);
      return {};
    }
  }
}

export default ScraperService;
