#!/usr/bin/env node

// ============================================================
// Backfill Media Archive
// ============================================================
// Processes existing messages in MongoDB that have attachments,
// stickers, or embeds with media, and archives them to MinIO
// using content-addressable storage (SHA-256 dedup).
//
// Usage:
//   node scripts/backfill-media-archive.js                      # full run
//   node scripts/backfill-media-archive.js --dry-run             # preview only
//   node scripts/backfill-media-archive.js --limit 1000          # test batch
//   node scripts/backfill-media-archive.js --channel-id 12345    # single channel
//   node scripts/backfill-media-archive.js --skip-expired        # skip 403/404 URLs
// ============================================================

import { MongoClient } from "mongodb";
import crypto from "crypto";
import { createVaultClient } from "@rodrigo-barraza/utilities/vault";

// ─── Boot: resolve secrets ──────────────────────────────────────
const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault-service/.env",
});
const secrets = await vault.fetch();
for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// Now import config (relies on process.env being populated)
const { default: MinioWrapper } = await import("../wrappers/MinioWrapper.js");

// ─── CLI args ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_EXPIRED = args.includes("--skip-expired");
const LIMIT = (() => {
  const idx = args.indexOf("--limit");
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 0;
})();
const CHANNEL_ID = (() => {
  const idx = args.indexOf("--channel-id");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Constants ──────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = "lupos";
const BATCH_SIZE = 100;
const CONCURRENCY = 3;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const FETCH_TIMEOUT_MS = 30_000;

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

function inferExtension(contentType, url) {
  if (contentType) {
    const mimeBase = contentType.split(";")[0].trim().toLowerCase();
    if (MIME_TO_EXT[mimeBase]) return MIME_TO_EXT[mimeBase];
  }
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
  } catch { /* ignore */ }
  return "bin";
}

// ─── Stats ──────────────────────────────────────────────────────
const stats = {
  messagesProcessed: 0,
  messagesSkipped: 0,
  urlsProcessed: 0,
  urlsArchived: 0,
  urlsDeduplicated: 0,
  urlsExpired: 0,
  urlsFailed: 0,
  bytesStored: 0,
};

// ─── In-memory hash cache ───────────────────────────────────────
const hashCache = new Map();

// ─── Archive a single URL ───────────────────────────────────────
async function archiveUrl(url, mediaHashesCol) {
  stats.urlsProcessed++;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        stats.urlsExpired++;
        return { status: "expired", statusCode: response.status };
      }
      stats.urlsFailed++;
      return null;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) return null;
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      console.log(`  ⏭️  Skipped (${(buffer.length / 1024 / 1024).toFixed(1)}MB): ${url.substring(0, 80)}`);
      return null;
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const ext = inferExtension(contentType, url);
    const minioKey = `media/${hash}.${ext}`;

    // Check cache / DB
    if (hashCache.has(hash)) {
      stats.urlsDeduplicated++;
      // Register this URL as another source
      if (!DRY_RUN) {
        await mediaHashesCol.updateOne(
          { hash },
          { $addToSet: { originalUrls: url } },
        );
      }
      return hashCache.get(hash);
    }

    const existing = await mediaHashesCol.findOne({ hash });
    if (existing) {
      stats.urlsDeduplicated++;
      const ref = {
        hash: existing.hash,
        minioKey: existing.minioKey,
        publicUrl: existing.publicUrl,
        contentType: existing.contentType,
        size: existing.size,
      };
      hashCache.set(hash, ref);
      if (!DRY_RUN) {
        await mediaHashesCol.updateOne(
          { hash },
          { $addToSet: { originalUrls: url } },
        );
      }
      return ref;
    }

    // New file — upload to MinIO
    const publicUrl = MinioWrapper.getPublicUrl(minioKey);
    const archiveRef = { hash, minioKey, publicUrl, contentType, size: buffer.length };

    if (!DRY_RUN) {
      await MinioWrapper.upload(minioKey, buffer, contentType);
      await mediaHashesCol.updateOne(
        { hash },
        {
          $setOnInsert: {
            hash, minioKey, publicUrl, contentType,
            size: buffer.length,
            archivedAt: new Date(),
          },
          $addToSet: { originalUrls: url },
        },
        { upsert: true },
      );
    }

    hashCache.set(hash, archiveRef);
    stats.urlsArchived++;
    stats.bytesStored += buffer.length;
    return archiveRef;
  } catch (err) {
    stats.urlsFailed++;
    console.warn(`  ❌ ${err.message}: ${url.substring(0, 80)}`);
    return null;
  }
}

// ─── Collect archivable URLs from a stored message doc ──────────
function collectUrlsFromDoc(doc) {
  const urls = new Set();

  // Attachments
  if (doc.attachments?.length) {
    for (const att of doc.attachments) {
      if (att.url) urls.add(att.url);
      if (att.proxyURL) urls.add(att.proxyURL);
    }
  }

  // Stickers
  if (doc.stickers?.length) {
    for (const sticker of doc.stickers) {
      if (sticker.url) urls.add(sticker.url);
    }
  }

  // Embeds
  if (doc.embeds?.length) {
    for (const embed of doc.embeds) {
      if (embed.image?.url) urls.add(embed.image.url);
      if (embed.image?.proxyURL) urls.add(embed.image.proxyURL);
      if (embed.thumbnail?.url) urls.add(embed.thumbnail.url);
      if (embed.thumbnail?.proxyURL) urls.add(embed.thumbnail.proxyURL);
      if (embed.video?.proxyURL) urls.add(embed.video.proxyURL);
    }
  }

  // Tenor GIFs in content (these are just URLs, we can't re-scrape easily in backfill)
  // They'll be handled on new messages going forward

  return [...urls].filter(Boolean);
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  📦 Media Archive Backfill${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`═══════════════════════════════════════════════════════════`);
  if (LIMIT) console.log(`  Limit: ${LIMIT} messages`);
  if (CHANNEL_ID) console.log(`  Channel: ${CHANNEL_ID}`);
  if (SKIP_EXPIRED) console.log(`  Skipping expired URLs`);
  console.log();

  // ── Connect ─────────────────────────────────────────────────
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI not set");
    process.exit(1);
  }

  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db(MONGO_DB_NAME);
  const messagesCol = db.collection("Messages");
  const mediaHashesCol = db.collection("MediaHashes");

  // Ensure index
  await mediaHashesCol.createIndex({ hash: 1 }, { unique: true, background: true });

  // ── Init MinIO ──────────────────────────────────────────────
  const minioEndpoint = process.env.MINIO_ENDPOINT;
  const minioAccessKey = process.env.MINIO_ACCESS_KEY;
  const minioSecretKey = process.env.MINIO_SECRET_KEY;
  const minioBucket = process.env.LUPOS_MINIO_BUCKET_NAME || "discord-media";

  if (!minioEndpoint || !minioAccessKey || !minioSecretKey) {
    console.error("❌ MinIO credentials not configured");
    process.exit(1);
  }

  if (!DRY_RUN) {
    await MinioWrapper.init(minioEndpoint, minioAccessKey, minioSecretKey, minioBucket);
    if (!MinioWrapper.isAvailable()) {
      console.error("❌ MinIO connection failed");
      process.exit(1);
    }
  }

  // ── Query: messages with media but no archive ───────────────
  const query = {
    mediaArchive: { $exists: false },
    $or: [
      { "attachments.0": { $exists: true } },
      { "stickers.0": { $exists: true } },
      { "embeds.0.image": { $exists: true } },
      { "embeds.0.thumbnail": { $exists: true } },
      { "embeds.0.video": { $exists: true } },
    ],
  };

  if (CHANNEL_ID) {
    query.channelId = CHANNEL_ID;
  }

  const totalCount = await messagesCol.countDocuments(query);
  console.log(`  📊 Messages to process: ${totalCount.toLocaleString()}`);
  if (LIMIT) console.log(`  📊 Processing first: ${LIMIT.toLocaleString()}`);
  console.log();

  // ── Process in batches ──────────────────────────────────────
  const cursor = messagesCol.find(query).sort({ createdTimestamp: -1 });
  if (LIMIT) cursor.limit(LIMIT);

  let batch = [];
  let batchNumber = 0;

  for await (const doc of cursor) {
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      batchNumber++;
      await processBatch(batch, batchNumber, messagesCol, mediaHashesCol);
      batch = [];
    }
  }

  // Final partial batch
  if (batch.length > 0) {
    batchNumber++;
    await processBatch(batch, batchNumber, messagesCol, mediaHashesCol);
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  📦 Backfill Complete${DRY_RUN ? " (DRY RUN — no changes)" : ""}`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  Messages processed:  ${stats.messagesProcessed.toLocaleString()}`);
  console.log(`  Messages skipped:    ${stats.messagesSkipped.toLocaleString()}`);
  console.log(`  URLs processed:      ${stats.urlsProcessed.toLocaleString()}`);
  console.log(`  URLs archived (new): ${stats.urlsArchived.toLocaleString()}`);
  console.log(`  URLs deduplicated:   ${stats.urlsDeduplicated.toLocaleString()}`);
  console.log(`  URLs expired:        ${stats.urlsExpired.toLocaleString()}`);
  console.log(`  URLs failed:         ${stats.urlsFailed.toLocaleString()}`);
  console.log(`  Bytes stored:        ${(stats.bytesStored / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Unique hashes:       ${hashCache.size.toLocaleString()}`);
  console.log();

  await mongoClient.close();
  process.exit(0);
}

async function processBatch(batch, batchNumber, messagesCol, mediaHashesCol) {
  const batchStart = Date.now();
  console.log(`  [Batch ${batchNumber}] Processing ${batch.length} messages...`);

  for (const doc of batch) {
    const urls = collectUrlsFromDoc(doc);
    if (urls.length === 0) {
      stats.messagesSkipped++;
      continue;
    }

    const mediaArchive = {};


    // Process URLs with concurrency limit
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const chunk = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (url) => {
          const result = await archiveUrl(url, mediaHashesCol);
          if (result) {
            if (result.status === "expired") {
              if (!SKIP_EXPIRED) {
                mediaArchive[url] = { status: "expired", statusCode: result.statusCode };
              }
            } else {
              mediaArchive[url] = result;

            }
          }
        }),
      );

      for (const r of results) {
        if (r.status === "rejected") {
          console.warn(`  ⚠️  ${r.reason?.message}`);
        }
      }
    }

    // Update the message document
    if (Object.keys(mediaArchive).length > 0 && !DRY_RUN) {
      await messagesCol.updateOne(
        { _id: doc._id },
        { $set: { mediaArchive } },
      );
    }

    stats.messagesProcessed++;

    // Progress logging every 50 messages
    if (stats.messagesProcessed % 50 === 0) {
      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.log(
        `    ${stats.messagesProcessed} msgs | ` +
        `${stats.urlsArchived} new | ${stats.urlsDeduplicated} dedup | ` +
        `${stats.urlsExpired} expired | ${elapsed}s`,
      );
    }
  }

  const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
  console.log(`  [Batch ${batchNumber}] Done in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
