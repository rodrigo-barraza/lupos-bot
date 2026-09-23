// ============================================================
// Network utilities — URL fetching helpers.
// ============================================================

import crypto from "crypto";

import PromiseMemo from "#root/utilities/PromiseMemo.ts";

// Every turn re-reads its channel window, and every image, emoji and
// sticker in it used to be downloaded again just to hash it for the
// caption cache. These hosts serve immutable bytes per URL (attachment,
// emoji and sticker ids, avatar hashes and Tenor media ids are in the
// path; a resized variant has its own query string), so a URL's hash is
// kept for an hour instead. Discord's /external/ proxy mirrors other
// sites and is left out.
const IMMUTABLE_MEDIA_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "media.tenor.com",
]);
const MEMO_TTL_MS = 60 * 60 * 1000;
const fileHashMemo = new PromiseMemo<{ hash: string; fileType: string | null }>(
  2_000,
  MEMO_TTL_MS,
);

// A link probe only needs the response headers. Unbounded, one slow host
// held the whole reply pipeline (undici waits up to 300 s for headers).
export const IMAGE_PROBE_TIMEOUT_MS = 10_000;
// A hash reads the whole file; bounded for the same reason.
export const FILE_HASH_TIMEOUT_MS = 30_000;
// Whether a link is an image doesn't change between turns — kept an hour.
const imageProbeMemo = new PromiseMemo<boolean>(2_000, MEMO_TTL_MS);

/** Whether a URL's bytes can never change (see IMMUTABLE_MEDIA_HOSTS). */
export function isImmutableMediaUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      IMMUTABLE_MEDIA_HOSTS.has(hostname) && !pathname.startsWith("/external/")
    );
  } catch {
    return false;
  }
}

async function downloadFileHash(url: string) {
  try {
    if (!url) {
      throw new Error(`generateFileHash called with invalid URL: ${url}`);
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FILE_HASH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
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

/**
 * Fetch a URL and return the SHA-256 hash of its contents plus
 * its content-type. Returns null on 404 (stale Discord CDN URLs)
 * or on any error. Immutable media URLs are hashed once an hour.
 */
export async function generateFileHash(url: string) {
  if (!isImmutableMediaUrl(url)) return downloadFileHash(url);
  return fileHashMemo.get(url, () => downloadFileHash(url));
}

async function probeImageUrl(url: string): Promise<boolean | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS),
    });
    // Only the headers matter — don't keep downloading the page.
    await response.body?.cancel().catch(() => {});
    const contentType = response.headers.get("content-type");
    const isImage = contentType ? contentType.startsWith("image/") : false;
    // An error page says nothing lasting about the link: answer, don't keep.
    return response.ok ? isImage : isImage || null;
  } catch (error: unknown) {
    console.error(
      `❌ [utilities:isImageUrl] Error checking if URL is an image:\n`,
      `${error}`,
    );
    return null;
  }
}

/** Check whether a URL serves an image content-type. */
export async function isImageUrl(url: string) {
  return (await imageProbeMemo.get(url, () => probeImageUrl(url))) ?? false;
}

/** Test hook. */
export function clearNetMemos(): void {
  fileHashMemo.clear();
  imageProbeMemo.clear();
}
