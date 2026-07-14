// ============================================================
// Network utilities — URL fetching helpers.
// ============================================================

import crypto from "crypto";

/**
 * Fetch a URL and return the SHA-256 hash of its contents plus
 * its content-type. Returns null on 404 (stale Discord CDN URLs)
 * or on any error.
 */
export async function generateFileHash(url: string) {
  try {
    if (!url) {
      throw new Error(`generateFileHash called with invalid URL: ${url}`);
    }
    const response = await fetch(url);
    if (!response.ok) {
      // 404 is expected for stale Discord CDN URLs (changed avatars/banners)
      if (response.status === 404) return null;
      throw new Error(
        `generateFileHash received HTTP ${response.status} for URL: ${url}`,
      );
    }
    const bytes = await response.bytes();
    const buffer = Buffer.from(bytes);
    const fileType = response.headers.get("content-type");

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return { hash, fileType };
  } catch (error: unknown) {
    console.log(
      `❌ [utilities:generateFileHash] Error generating hash:\n`,
      `${error}`,
    );
    return null;
  }
}

/** Check whether a URL serves an image content-type. */
export async function isImageUrl(url: string) {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type");
    return contentType ? contentType.startsWith("image/") : false;
  } catch (error: unknown) {
    console.error(
      `❌ [utilities:isImageUrl] Error checking if URL is an image:\n`,
      `${error}`,
    );
    return false;
  }
}
