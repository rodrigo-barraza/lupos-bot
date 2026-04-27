// ============================================================
// MediaArchivalService — Content-Addressable Storage (CAS)
// ============================================================
// Archives Discord message media (attachments, stickers, embeds,
// Tenor GIFs) to MinIO using SHA-256 content hashing for dedup.
//
// Identical files are stored exactly once regardless of how many
// messages reference them. Each message document gains a
// `mediaArchive` map: { originalUrl → archiveRef }.
// ============================================================

import crypto from "crypto";
import MinioWrapper from "#root/wrappers/MinioWrapper.js";
import ScraperService from "#root/services/ScraperService.js";
import utilities from "#root/utilities.js";
import MongoService from "#root/services/MongoService.js";

// ─── Constants ──────────────────────────────────────────────────
const COLLECTION_NAME = "MediaHashes";
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const FETCH_TIMEOUT_MS = 30_000;
const CONCURRENCY_LIMIT = 3;

/**
 * MIME type → file extension map for common media types.
 */
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/apng": "apng",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "application/pdf": "pdf",
};

/**
 * Infer file extension from content-type header or URL.
 * @param {string} contentType
 * @param {string} url
 * @returns {string}
 */
function inferExtension(contentType, url) {
  if (contentType) {
    // Strip parameters (e.g. "image/png; charset=utf-8" → "image/png")
    const mimeBase = contentType.split(";")[0].trim().toLowerCase();
    if (MIME_TO_EXT[mimeBase]) return MIME_TO_EXT[mimeBase];
  }
  // Fall back to URL extension
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
  } catch { /* ignore */ }
  return "bin";
}

// ─── In-memory hash cache ───────────────────────────────────────
// Prevents redundant MongoDB lookups within the same process lifetime.
// Maps hash → archiveRef. Safe because hashes are immutable (CAS).
const hashCache = new Map();

const MediaArchivalService = {
  /**
   * Whether media archival is available (MinIO connected).
   * @returns {boolean}
   */
  isAvailable() {
    return MinioWrapper.isAvailable();
  },

  /**
   * Get or create the MediaHashes collection reference.
   * @returns {import('mongodb').Collection|null}
   */
  _getCollection() {
    try {
      const db = MongoService.getDb("local");
      return db.collection(COLLECTION_NAME);
    } catch {
      return null;
    }
  },

  /**
   * Ensure the MediaHashes collection has required indexes.
   * Called once at boot.
   */
  async ensureIndexes() {
    const col = this._getCollection();
    if (!col) return;
    try {
      await col.createIndex({ hash: 1 }, { unique: true, background: true });
      console.log(`📦 MediaArchivalService: MediaHashes index ensured`);
    } catch (err) {
      console.warn(`📦 MediaArchivalService: index warning: ${err.message}`);
    }
  },

  /**
   * Look up an existing archive ref by SHA-256 hash.
   * Checks in-memory cache first, then MongoDB.
   * @param {string} hash
   * @returns {Promise<object|null>}
   */
  async _findByHash(hash) {
    // In-memory cache hit
    if (hashCache.has(hash)) return hashCache.get(hash);

    // MongoDB lookup
    const col = this._getCollection();
    if (!col) return null;

    const doc = await col.findOne({ hash });
    if (doc) {
      const ref = {
        hash: doc.hash,
        minioKey: doc.minioKey,
        publicUrl: doc.publicUrl,
        contentType: doc.contentType,
        size: doc.size,
      };
      hashCache.set(hash, ref);
      return ref;
    }
    return null;
  },

  /**
   * Register a new hash → MinIO mapping in MongoDB.
   * @param {object} archiveRef
   * @param {string} originalUrl
   */
  async _registerHash(archiveRef, originalUrl) {
    const col = this._getCollection();
    if (!col) return;

    try {
      await col.updateOne(
        { hash: archiveRef.hash },
        {
          $setOnInsert: {
            hash: archiveRef.hash,
            minioKey: archiveRef.minioKey,
            publicUrl: archiveRef.publicUrl,
            contentType: archiveRef.contentType,
            size: archiveRef.size,
            archivedAt: new Date(),
          },
          $addToSet: { originalUrls: originalUrl },
        },
        { upsert: true },
      );
      hashCache.set(archiveRef.hash, archiveRef);
    } catch (err) {
      // Duplicate key is fine — another concurrent write won
      if (err.code !== 11000) {
        console.error(`📦 MediaArchivalService: register error: ${err.message}`);
      }
    }
  },

  /**
   * Download a URL, hash it, and store in MinIO if unique.
   * Returns the archive reference object (same shape for new or existing).
   *
   * @param {string} url - Source URL to archive
   * @returns {Promise<{ hash: string, minioKey: string, publicUrl: string, contentType: string, size: number } | null>}
   */
  async archiveFromUrl(url) {
    if (!MinioWrapper.isAvailable() || !url) return null;

    try {
      // ── 1. Fetch the resource ──────────────────────────────────
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        console.warn(`📦 Archive fetch failed (${response.status}): ${url}`);
        return null;
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";

      // ── 2. Read buffer ─────────────────────────────────────────
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Skip files that exceed size limit
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        console.warn(`📦 Archive skipped (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 25MB): ${url}`);
        return null;
      }

      // Skip empty responses
      if (buffer.length === 0) return null;

      // ── 3. SHA-256 hash ────────────────────────────────────────
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const ext = inferExtension(contentType, url);
      const minioKey = `media/${hash}.${ext}`;

      // ── 4. Check if already archived (CAS dedup) ──────────────
      const existing = await this._findByHash(hash);
      if (existing) {
        // Dedup hit — just register this URL as another source
        await this._registerHash(existing, url);
        return existing;
      }

      // ── 5. Upload to MinIO ─────────────────────────────────────
      await MinioWrapper.upload(minioKey, buffer, contentType);
      const publicUrl = MinioWrapper.getPublicUrl(minioKey);

      const archiveRef = {
        hash,
        minioKey,
        publicUrl,
        contentType,
        size: buffer.length,
      };

      // ── 6. Register in MongoDB ─────────────────────────────────
      await this._registerHash(archiveRef, url);

      return archiveRef;
    } catch (err) {
      // Non-fatal — don't let archival failures break message processing
      console.warn(`📦 Archive error for ${url}: ${err.message}`);
      return null;
    }
  },

  /**
   * Archive all media from a Discord.js message object.
   * Processes: attachments, stickers, embed images/thumbnails/videos, Tenor GIFs.
   *
   * @param {import('discord.js').Message} message - Discord.js message
   * @returns {Promise<Object<string, object>>} Map of { originalUrl → archiveRef }
   */
  async archiveMessageMedia(message) {
    if (!MinioWrapper.isAvailable()) return {};

    // ── Collect all archivable URLs ────────────────────────────────
    const urlsToArchive = new Set();

    // Attachments (images, GIFs, audio, files)
    if (message.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        if (attachment.url) urlsToArchive.add(attachment.url);
      }
    }

    // Stickers
    if (message.stickers?.size) {
      for (const sticker of message.stickers.values()) {
        if (sticker.url) urlsToArchive.add(sticker.url);
      }
    }

    // Embeds — image, thumbnail, video
    if (message.embeds?.length) {
      for (const embed of message.embeds) {
        if (embed.image?.url) urlsToArchive.add(embed.image.url);
        if (embed.image?.proxyURL) urlsToArchive.add(embed.image.proxyURL);
        if (embed.thumbnail?.url) urlsToArchive.add(embed.thumbnail.url);
        if (embed.thumbnail?.proxyURL) urlsToArchive.add(embed.thumbnail.proxyURL);
        // Video proxy URLs are often playable media
        if (embed.video?.proxyURL) urlsToArchive.add(embed.video.proxyURL);
      }
    }

    // Tenor GIFs in message content
    if (message.content) {
      const tenorUrls = message.content.match(/https:\/\/tenor\.com\/view\/\S+/g);
      if (tenorUrls) {
        for (const tenorUrl of tenorUrls) {
          try {
            const tenorImage = await ScraperService.scrapeTenor(tenorUrl);
            if (tenorImage?.image) urlsToArchive.add(tenorImage.image);
          } catch (err) {
            console.warn(`📦 Tenor scrape failed: ${err.message}`);
          }
        }
      }

      // Direct image URLs in content
      const contentUrls = message.content.match(/https?:\/\/[^\s]+/g);
      if (contentUrls) {
        for (let contentUrl of contentUrls) {
          // Strip trailing angle brackets, parens, punctuation from Discord markdown
          contentUrl = contentUrl.replace(/[>)}\].,;:!?]+$/, "");
          if (contentUrl.includes("tenor.com/view/")) continue; // Already handled
          try {
            const isImage = await utilities.isImageUrl(contentUrl);
            if (isImage) urlsToArchive.add(contentUrl);
          } catch { /* skip non-images */ }
        }
      }
    }

    if (urlsToArchive.size === 0) return {};

    // ── Archive with concurrency limiter ───────────────────────────
    const results = {};
    const urls = [...urlsToArchive];

    // Process in chunks of CONCURRENCY_LIMIT
    for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
      const chunk = urls.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (url) => {
          const ref = await this.archiveFromUrl(url);
          if (ref) results[url] = ref;
        }),
      );

      // Log any unexpected rejections
      for (const result of chunkResults) {
        if (result.status === "rejected") {
          console.warn(`📦 Archive chunk error: ${result.reason?.message}`);
        }
      }
    }

    return results;
  },

  /**
   * Rewrite ephemeral Discord CDN URLs in a transformed message document
   * with permanent MinIO public URLs from the archive map.
   *
   * Mutates the document in-place. Only rewrites URLs that were
   * successfully archived (present in archiveMap).
   *
   * @param {object} doc - Transformed message document (from transformMessageRoot)
   * @param {Object<string, object>} archiveMap - { originalUrl → { publicUrl, ... } }
   */
  rewriteDocumentUrls(doc, archiveMap) {
    if (!archiveMap || Object.keys(archiveMap).length === 0) return;

    const rewrite = (url) => archiveMap[url]?.publicUrl || url;

    // Attachments
    if (doc.attachments?.length) {
      for (const att of doc.attachments) {
        if (att.url) att.url = rewrite(att.url);
        if (att.proxyURL) att.proxyURL = rewrite(att.proxyURL);
      }
    }

    // Stickers
    if (doc.stickers?.length) {
      for (const sticker of doc.stickers) {
        if (sticker.url) sticker.url = rewrite(sticker.url);
      }
    }

    // Embeds
    if (doc.embeds?.length) {
      for (const embed of doc.embeds) {
        if (embed.image?.url) embed.image.url = rewrite(embed.image.url);
        if (embed.image?.proxyURL) embed.image.proxyURL = rewrite(embed.image.proxyURL);
        if (embed.thumbnail?.url) embed.thumbnail.url = rewrite(embed.thumbnail.url);
        if (embed.thumbnail?.proxyURL) embed.thumbnail.proxyURL = rewrite(embed.thumbnail.proxyURL);
        if (embed.video?.proxyURL) embed.video.proxyURL = rewrite(embed.video.proxyURL);
      }
    }
  },
};

export default MediaArchivalService;
