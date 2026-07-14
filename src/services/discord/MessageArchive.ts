// ============================================================
// MessageArchive — Bulk scraping/archival + Mongo persistence
// ============================================================
// fetchAndSaveAllServerMessages, purgeDeletedMessagesForUsers,
// backfillMediaArchive, deleteDuplicateMessagesByID,
// saveMessageToMongo, updateMessageInMongo, syncReactionsToMongo
// moved verbatim from DiscordUtilityService.ts (R1 split).
// DiscordUtilityService keeps delegating facade methods, so all
// existing callers continue to work unchanged.
// ============================================================

import { ChannelType } from "discord.js";
import type { Client, Message, TextChannel, MessageReaction } from "discord.js";
import { MONGO_DB_NAME, EXCLUDE_SOFT_DELETED } from "#root/constants.js";
import MediaArchivalService from "#root/services/MediaArchivalService.js";
import {
  transformMessageRoot,
  transformReaction,
} from "#root/services/discord/transformers.js";
import { errorMessage } from "#root/services/discord/errors.js";

/** Resume point for message scraping. */
interface ResumePoint {
  channelId: string;
  lastMessageId: string;
}

/** Options for fetchAndSaveAllServerMessages */
interface FetchAndSaveOptions {
  collectionName?: string;
  concurrencyLimit?: number;
  resumePoints?: ResumePoint[] | null;
  batchSize?: number;
  dateLimit?: string;
  categoryIds?: string[] | null;
  channelIds?: string[] | null;
  forceUpdate?: boolean;
  autoResume?: boolean;
}

/** Options for purgeDeletedMessagesForUsers */
interface PurgeOptions {
  collectionName?: string;
  concurrencyLimit?: number;
}

/** Options for backfillMediaArchive */
interface BackfillOptions {
  collectionName?: string;
  authorIds?: string[] | null;
  guildId?: string | null;
  channelId?: string | null;
  forceRetry?: boolean;
  batchSize?: number;
}

/** Options for fetchMessages */
export interface FetchMessagesOptions {
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
  cache?: boolean;
}

/** Result of a bulk save operation */
interface BulkSaveResult {
  saved: number;
  duplicates: number;
  errors: number;
  _lastDate?: string;
}

/** Result of channel processing */
interface ChannelProcessResult {
  saved: number;
  duplicates: number;
  errors: number;
}

const MessageArchive = {
  // Fetches and saves all messages from a Discord server to MongoDB.
  // Supports category filtering, date limits, auto-resume via checkpoints,
  // and concurrent channel processing with bulk upserts.
  async fetchAndSaveAllServerMessages(
    client: Client,
    mongo: import("mongodb").MongoClient,
    guildId: string,
    options: FetchAndSaveOptions = {},
  ) {
    const {
      collectionName = "Messages",
      concurrencyLimit = 10,
      resumePoints = null,
      batchSize = 100,
      dateLimit = "2025-11-01",
      categoryIds = null,
      channelIds = null,
      forceUpdate = false,
      autoResume = true,
    } = options;

    const startTime = Date.now();
    const limitDate = dateLimit ? new Date(dateLimit) : null;

    console.log(`[START] Beginning message fetch for guild: ${guildId}`);
    if (limitDate) {
      console.log(
        `[CONFIG] Date limit: ${limitDate.toISOString().split("T")[0]}`,
      );
    }

    // Get the guild
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`[ERROR] Guild with ID ${guildId} not found`);
      return;
    }

    console.log(`[GUILD] Found guild: ${guild.name}`);

    // ── Database setup ──────────────────────────────────────────────
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const checkpointCollection = db.collection("MessageScrapeCheckpoints");

    // Ensure unique index on `id` — turns upsert lookups from O(n) → O(log n)
    // If duplicates exist from previous runs, clean them first then retry.
    try {
      await collection.createIndex(
        { id: 1 },
        { unique: true, background: true },
      );
      console.log(`[INDEX] Ensured unique index on "${collectionName}.id"`);
    } catch (indexError: unknown) {
      if (
        indexError instanceof Error &&
        "code" in indexError &&
        (indexError as Error & { code: number }).code === 11000
      ) {
        console.log(
          `[INDEX] Duplicate keys found — deduplicating before indexing...`,
        );
        await MessageArchive.deleteDuplicateMessagesByID(
          mongo,
          collectionName as string,
        );
        await collection.createIndex(
          { id: 1 },
          { unique: true, background: true },
        );
        console.log(`[INDEX] Unique index created after deduplication`);
      } else {
        throw indexError;
      }
    }

    try {
      await collection.createIndex(
        { guildId: 1, createdTimestamp: -1 },
        { background: true },
      );
      await collection.createIndex(
        { guildId: 1, channelId: 1, createdTimestamp: -1 },
        { background: true },
      );
      await collection.createIndex(
        { guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 },
        { background: true },
      );
      await collection.createIndex(
        { guildId: 1, "author.id": 1, createdTimestamp: -1 },
        { background: true },
      );
      console.log(`[INDEX] Ensured compound indexes on "${collectionName}"`);
    } catch (indexError: unknown) {
      console.error(
        `[INDEX] Failed to create compound indexes on "${collectionName}":`,
        indexError,
      );
    }

    // ── Resume logic ────────────────────────────────────────────────
    const resumeMap = new Map<string, string>();
    const completedChannelIds = new Set<string>();

    if (resumePoints && Array.isArray(resumePoints)) {
      // Explicit resume points take priority
      resumePoints.forEach((point: ResumePoint) => {
        if (point.channelId && point.lastMessageId) {
          resumeMap.set(point.channelId, point.lastMessageId);
        }
      });
      console.log(`[RESUME] Using ${resumeMap.size} explicit checkpoint(s)`);
    } else if (autoResume) {
      // Load checkpoints from previous runs
      const checkpoints = await checkpointCollection
        .find({ guildId })
        .toArray();
      for (const cp of checkpoints) {
        if (cp.completed) {
          completedChannelIds.add(cp.channelId);
        } else if (cp.lastMessageId) {
          resumeMap.set(cp.channelId, cp.lastMessageId);
        }
      }
      if (completedChannelIds.size > 0) {
        console.log(
          `[AUTO-RESUME] Skipping ${completedChannelIds.size} already-completed channel(s)`,
        );
      }
      if (resumeMap.size > 0) {
        console.log(
          `[AUTO-RESUME] Resuming ${resumeMap.size} in-progress channel(s)`,
        );
      }
    }

    // ── Channel filtering ───────────────────────────────────────────
    let textChannels = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildText,
    );

    // Filter by specific channel IDs if provided (takes precedence)
    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      textChannels = textChannels.filter((channel) =>
        channelIds.includes(channel.id),
      );
      console.log(
        `[CHANNELS] Filtering to ${channelIds.length} specific channel(s) — ${textChannels.size} matched`,
      );
    }
    // Otherwise filter by category IDs if provided
    else if (
      categoryIds &&
      Array.isArray(categoryIds) &&
      categoryIds.length > 0
    ) {
      textChannels = textChannels.filter(
        (channel) => channel.parentId && categoryIds.includes(channel.parentId),
      );
      console.log(
        `[CATEGORIES] Filtering to ${categoryIds.length} category/ies — ${textChannels.size} channel(s) matched`,
      );
    }

    // If explicit resumePoints provided, only process those channels
    if (resumePoints && resumeMap.size > 0) {
      textChannels = textChannels.filter((channel) =>
        resumeMap.has(channel.id),
      );
      console.log(
        `[CHANNELS] Will resume ${resumeMap.size} channel(s) from their last position`,
      );
    }

    // Skip channels completed in a previous run
    if (completedChannelIds.size > 0) {
      textChannels = textChannels.filter(
        (channel) => !completedChannelIds.has(channel.id),
      );
    }

    console.log(`[CHANNELS] ${textChannels.size} text channel(s) to process`);

    // ── Statistics ──────────────────────────────────────────────────
    let totalMessagesSaved = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;
    let channelsProcessed = 0;

    // ── Bulk save helper (no pre-check — let bulkWrite + index handle dedup) ──
    const bulkSaveNewMessages = async (
      messages: Message[],
    ): Promise<BulkSaveResult> => {
      if (!messages || messages.length === 0) {
        return { saved: 0, duplicates: 0, errors: 0, _lastDate: "" };
      }

      const documents: Record<string, unknown>[] = [];
      let transformErrorCount = 0;

      for (const message of messages) {
        try {
          const document = transformMessageRoot(message);

          // Archive media to MinIO (content-addressable, deduped by SHA-256)
          if (MediaArchivalService.isAvailable()) {
            try {
              const archiveMap =
                await MediaArchivalService.archiveMessageMedia(message);
              if (Object.keys(archiveMap).length > 0) {
                document.mediaArchive = archiveMap;
                MediaArchivalService.rewriteDocumentUrls(document, archiveMap);
              }
            } catch (archiveErr: unknown) {
              console.warn(
                `  [ARCHIVE] Media archival failed for ${message.id}: ${errorMessage(archiveErr)}`,
              );
            }
          }

          documents.push(document);
        } catch (transformError: unknown) {
          console.error(
            `  [ERROR] Failed to transform message ${message.id}: ${errorMessage(transformError)}`,
          );
          transformErrorCount++;
        }
      }

      if (documents.length === 0) {
        return { saved: 0, duplicates: 0, errors: transformErrorCount };
      }

      try {
        const bulkOps = documents.map((document) => {
          // Force update mode: overwrite entire document (for rescraping)
          if (forceUpdate) {
            return {
              updateOne: {
                filter: { id: document.id },
                update: { $set: document },
                upsert: true,
              },
            };
          }

          // Normal mode: only insert new, backfill dynamic fields on existing
          const backfill = {
            // Reactions, embeds, attachments, and content can all change
            // after initial scrape — always update to latest values.
            reactions: document.reactions,
            embeds: document.embeds,
            attachments: document.attachments,
            content: document.content,
            cleanContent: document.cleanContent,
            editedAt: document.editedAt,
            editedTimestamp: document.editedTimestamp,
            pinned: document.pinned,
            "member.displayHexColor":
              (document.member as Record<string, unknown> | undefined)
                ?.displayHexColor || null,
            "member.displayName":
              (document.member as Record<string, unknown> | undefined)
                ?.displayName || null,
            "member.avatar":
              (document.member as Record<string, unknown> | undefined)
                ?.avatar || null,
            // Enhanced Role Styles (gradient/holographic) — always update to latest
            ...((document.member as Record<string, unknown> | undefined)
              ?.roleColors
              ? {
                  "member.roleColors": (
                    document.member as Record<string, unknown>
                  ).roleColors,
                }
              : { "member.roleColors": null }),
          };

          // Clone for $setOnInsert and strip backfill paths to avoid conflict
          const insertDoc = { ...document };
          delete insertDoc.reactions;
          delete insertDoc.embeds;
          delete insertDoc.attachments;
          delete insertDoc.content;
          delete insertDoc.cleanContent;
          delete insertDoc.editedAt;
          delete insertDoc.editedTimestamp;
          delete insertDoc.pinned;
          if (insertDoc.member) {
            const memberObj = insertDoc.member as Record<string, unknown>;
            const {
              displayHexColor: _dhc,
              displayName: _dn,
              avatar: _av,
              roleColors: _rc,
              ...restMember
            } = memberObj;
            insertDoc.member = restMember;
          }

          return {
            updateOne: {
              filter: { id: document.id },
              update: {
                $setOnInsert: insertDoc,
                $set: backfill,
              },
              upsert: true,
            },
          };
        });

        const result = await collection.bulkWrite(bulkOps, { ordered: false });

        // When forceUpdate is true, matchedCount = docs that existed and were
        // updated via $set. modifiedCount = subset that actually changed.
        // Report modified docs as "saved" so the progress log is accurate.
        const updated = forceUpdate ? result.modifiedCount || 0 : 0;

        return {
          saved: result.upsertedCount + updated,
          duplicates: (result.matchedCount || 0) - updated,
          errors: transformErrorCount,
        };
      } catch (error: unknown) {
        if (error instanceof Error && "writeErrors" in error) {
          const bulkError = error as Error & {
            writeErrors: unknown[];
            result?: { nUpserted?: number };
          };
          const savedCount = bulkError.result?.nUpserted || 0;
          console.error(
            `  [ERROR] Bulk write partial failure: ${savedCount} saved, ${bulkError.writeErrors.length} errors`,
          );
          return {
            saved: savedCount,
            duplicates: 0,
            errors: bulkError.writeErrors.length + transformErrorCount,
          };
        }

        console.error(`  [ERROR] Bulk save failed: ${errorMessage(error)}`);
        return { saved: 0, duplicates: 0, errors: messages.length };
      }
    };

    // ── Concurrency limiter ─────────────────────────────────────────
    const createConcurrencyLimiter = (limit: number) => {
      let activeCount = 0;
      const queue: (() => void)[] = [];

      const run = async <T>(fn: () => Promise<T>): Promise<T> => {
        while (activeCount >= limit) {
          await new Promise<void>((resolve) => queue.push(resolve));
        }
        activeCount++;
        try {
          return await fn();
        } finally {
          activeCount--;
          const resolve = queue.shift();
          if (resolve) resolve();
        }
      };

      return { run };
    };

    const limiter = createConcurrencyLimiter(concurrencyLimit); // ── User IDs for deleted message cleanup ────────────────────────
    // After scraping each channel, remove messages from these users
    // that exist in MongoDB but were deleted from Discord.
    const CLEANUP_USER_IDS = [
      "166745313258897409", // Rodrigo
      "1198099566088699904", // Lupos (bot)
    ];

    // ── Process a single channel ────────────────────────────────────
    const processChannel = async (channel: TextChannel) => {
      const channelStartTime = Date.now();
      let channelMessageCount = 0;
      let channelDuplicates = 0;
      let channelErrors = 0;

      // Track message IDs from the target users found on Discord
      const discordUserMessageIds = new Set<string>();

      // Use checkpoint (auto or explicit) if available
      let lastId = resumeMap.get(channel.id) || null;

      if (lastId) {
        console.log(
          `[CHANNEL] Resuming: #${channel.name} (${channel.id}) from message ${lastId}`,
        );
      } else {
        console.log(`[CHANNEL] Processing: #${channel.name} (${channel.id})`);
      }

      let hasMoreMessages = true;
      let lastMessageDate = null;

      // Pending write promise from previous iteration (pipelined)
      let pendingWrite = null;

      while (hasMoreMessages) {
        try {
          // Direct Discord.js fetch — simpler than the general-purpose wrapper
          const fetchOptions: FetchMessagesOptions = {
            limit: batchSize,
            cache: false,
          };
          if (lastId) fetchOptions.before = lastId;

          const messages = await channel.messages.fetch(fetchOptions);

          // Wait for previous batch's write to complete before accumulating stats
          if (pendingWrite) {
            const result = await pendingWrite;
            channelMessageCount += result.saved;
            channelDuplicates += result.duplicates;
            channelErrors += result.errors;
            totalMessagesSaved += result.saved;
            totalDuplicates += result.duplicates;
            totalErrors += result.errors;

            // Log progress for previously written batch
            if (result.saved > 0) {
              console.log(
                `  [PROGRESS] #${channel.name}: +${result.saved} saved (${result.duplicates} skipped) | Date: ${result._lastDate}`,
              );
            } else if (result.duplicates > 0) {
              console.log(
                `  [SKIP] #${channel.name}: ${result.duplicates} messages already exist | Date: ${result._lastDate}`,
              );
            }
            pendingWrite = null;
          }

          if (!messages || messages.size === 0) {
            hasMoreMessages = false;
            break;
          }

          // Track message IDs from the target users
          for (const message of messages.values()) {
            if (CLEANUP_USER_IDS.includes(message.author?.id)) {
              discordUserMessageIds.add(message.id);
            }
          }

          // Update pagination cursor immediately (sync — no waiting)
          const lastMessage = messages.last();
          if (lastMessage) {
            lastId = lastMessage.id;
            lastMessageDate = lastMessage.createdAt;
          }

          // Check date limit
          if (limitDate && lastMessageDate && lastMessageDate < limitDate) {
            console.log(
              `  [DATE LIMIT] #${channel.name}: Reached date limit (${limitDate.toISOString().split("T")[0]}), stopping | Last message: ${lastMessageDate.toISOString()}`,
            );
            hasMoreMessages = false;
          }

          // End of channel history
          if (messages.size < batchSize) {
            hasMoreMessages = false;
          }

          // Fire bulkWrite + checkpoint as a pipeline — next fetch starts immediately
          const messageBatch = Array.from(messages.values());
          const batchDate = lastMessageDate;
          pendingWrite = (async () => {
            const result = await bulkSaveNewMessages(messageBatch);

            // Persist checkpoint for crash recovery
            if (autoResume && lastId) {
              await checkpointCollection.updateOne(
                { guildId, channelId: channel.id },
                {
                  $set: {
                    lastMessageId: lastId,
                    lastMessageDate: batchDate,
                    channelName: channel.name,
                    updatedAt: new Date(),
                  },
                },
                { upsert: true },
              );
            }

            // Attach date for logging
            result._lastDate = batchDate
              ? batchDate.toISOString().split("T")[0]
              : "unknown";
            return result;
          })();

          // discord.js handles rate limiting internally — no artificial delay needed
        } catch (fetchError: unknown) {
          console.error(
            `  [ERROR] Failed to fetch messages from #${channel.name}: ${errorMessage(fetchError)}`,
          );
          channelErrors++;
          totalErrors++;
          hasMoreMessages = false;
        }
      }

      // Drain the final pipelined write
      if (pendingWrite) {
        try {
          const result = await pendingWrite;
          channelMessageCount += result.saved;
          channelDuplicates += result.duplicates;
          channelErrors += result.errors;
          totalMessagesSaved += result.saved;
          totalDuplicates += result.duplicates;
          totalErrors += result.errors;
          if (result.saved > 0) {
            console.log(
              `  [PROGRESS] #${channel.name}: +${result.saved} saved (${result.duplicates} skipped) | Date: ${result._lastDate}`,
            );
          }
        } catch (writeError: unknown) {
          console.error(
            `  [ERROR] Final batch write failed for #${channel.name}: ${errorMessage(writeError)}`,
          );
          channelErrors++;
          totalErrors++;
        }
      }

      // ── Cleanup: soft-delete orphaned messages from target users ──
      // Compare MongoDB messages by these users in this channel against
      // what was found on Discord — soft-delete any orphans.
      if (discordUserMessageIds.size > 0 || !limitDate) {
        try {
          const mongoUserMessages = await collection
            .find(
              {
                ...EXCLUDE_SOFT_DELETED,
                channelId: channel.id,
                "author.id": { $in: CLEANUP_USER_IDS },
              },
              { projection: { id: 1 } },
            )
            .toArray();

          const orphanIds = mongoUserMessages
            .filter(
              (document: import("mongodb").Document) =>
                !discordUserMessageIds.has(document.id),
            )
            .map((document: import("mongodb").Document) => document.id);

          if (orphanIds.length > 0) {
            const softDeleteResult = await collection.updateMany(
              { id: { $in: orphanIds } },
              { $set: { isDeleted: true, deletedAt: new Date() } },
            );
            console.log(
              `  [CLEANUP] #${channel.name}: Soft-deleted ${softDeleteResult.modifiedCount} orphaned message(s) from tracked users`,
            );
          }
        } catch (cleanupErr: unknown) {
          console.warn(
            `  [CLEANUP] #${channel.name}: cleanup failed: ${errorMessage(cleanupErr)}`,
          );
        }
      }

      // Mark channel as completed so future runs skip it
      if (autoResume) {
        await checkpointCollection.updateOne(
          { guildId, channelId: channel.id },
          {
            $set: {
              completed: true,
              channelName: channel.name,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
      }

      channelsProcessed++;
      const duration = ((Date.now() - channelStartTime) / 1000).toFixed(2);
      console.log(
        `  [COMPLETE] #${channel.name}: ${channelMessageCount} saved, ${channelDuplicates} duplicates, ${channelErrors} errors (${duration}s)`,
      );

      return {
        saved: channelMessageCount,
        duplicates: channelDuplicates,
        errors: channelErrors,
      };
    };

    // ── Dispatch all channels ───────────────────────────────────────
    const channelPromises: Promise<ChannelProcessResult | undefined>[] = [];
    for (const channel of textChannels.values()) {
      channelPromises.push(
        limiter.run(() => processChannel(channel as TextChannel)),
      );
    }

    await Promise.all(channelPromises);

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n[FINISHED] Message fetch complete for guild: ${guild.name}`);
    console.log(`  - Channels processed: ${channelsProcessed}`);
    console.log(`  - Messages saved: ${totalMessagesSaved}`);
    console.log(`  - Duplicates skipped: ${totalDuplicates}`);
    console.log(`  - Errors: ${totalErrors}`);
    console.log(`  - Duration: ${totalDuration}s`);

    return {
      guildId,
      guildName: guild.name,
      channelsProcessed,
      totalMessagesSaved,
      totalDuplicates,
      totalErrors,
      totalDuration: parseFloat(totalDuration),
    };
  },

  /**
   * Soft-delete orphaned messages for specific users.
   * Queries MongoDB for all messages by the given user IDs, then verifies
   * each one against Discord. Messages that no longer exist (404/10008)
   * are soft-deleted in MongoDB (isDeleted + deletedAt).
   */
  async purgeDeletedMessagesForUsers(
    client: Client,
    mongo: import("mongodb").MongoClient,
    guildId: string,
    userIds: string[],
    options: PurgeOptions = {},
  ) {
    const { collectionName = "Messages", concurrencyLimit = 5 } = options;

    const startTime = Date.now();
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName as string);
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      console.error(`[CLEANUP] Guild ${guildId} not found`);
      return { verified: 0, deleted: 0, errors: 0 };
    }

    // Find all messages in MongoDB by these users in this guild
    const mongoMessages = await collection
      .find(
        { ...EXCLUDE_SOFT_DELETED, guildId, "author.id": { $in: userIds } },
        { projection: { id: 1, channelId: 1, "author.id": 1 } },
      )
      .toArray();

    console.log(
      `[CLEANUP] Found ${mongoMessages.length} message(s) from ${userIds.length} tracked user(s) to verify`,
    );
    if (mongoMessages.length === 0)
      return { verified: 0, deleted: 0, errors: 0 };

    // Group by channel for efficient processing
    const byChannel = new Map<string, string[]>();
    for (const document of mongoMessages) {
      const chId = document.channelId as string;
      if (!byChannel.has(chId)) {
        byChannel.set(chId, []);
      }
      byChannel.get(chId)!.push(document.id as string);
    }

    let totalVerified = 0;
    let totalDeleted = 0;
    let totalErrors = 0;

    for (const [channelId, messageIds] of byChannel) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.warn(
          `  [CLEANUP] Channel ${channelId} not in cache — skipping ${messageIds.length} message(s)`,
        );
        totalErrors += messageIds.length;
        continue;
      }

      const orphanIds: string[] = [];

      // Process in concurrency-limited chunks
      for (let i = 0; i < messageIds.length; i += concurrencyLimit) {
        const chunk = messageIds.slice(i, i + concurrencyLimit);
        const results = await Promise.allSettled(
          chunk.map(async (msgId: string) => {
            try {
              await (channel as TextChannel).messages.fetch(msgId);
              return { exists: true, id: msgId };
            } catch (error: unknown) {
              const discordError = error as Error & { code?: number };
              if (discordError.code === 10008) {
                return { exists: false, id: msgId };
              }
              // Other errors (permissions, rate limit) — don't assume deleted
              throw error;
            }
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            if (result.value.exists) {
              totalVerified++;
            } else {
              orphanIds.push(result.value.id);
            }
          } else {
            totalErrors++;
            console.warn(
              `  [CLEANUP] Error checking message in #${channel.name}: ${result.reason?.message}`,
            );
          }
        }
      }

      if (orphanIds.length > 0) {
        const softDeleteResult = await collection.updateMany(
          { id: { $in: orphanIds } },
          { $set: { isDeleted: true, deletedAt: new Date() } },
        );
        totalDeleted += softDeleteResult.modifiedCount;
        console.log(
          `  [CLEANUP] #${channel.name}: Soft-deleted ${softDeleteResult.modifiedCount} message(s)`,
        );
      } else {
        console.log(
          `  [CLEANUP] #${channel.name}: All ${messageIds.length} message(s) still exist`,
        );
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[CLEANUP] Complete — verified: ${totalVerified}, deleted: ${totalDeleted}, errors: ${totalErrors} (${duration}s)`,
    );

    return {
      verified: totalVerified,
      deleted: totalDeleted,
      errors: totalErrors,
    };
  },

  /**
   * Backfill media archive for messages that still have Discord CDN URLs.
   * Finds messages missing `mediaArchive` that have attachments, downloads
   * the media to MinIO, and updates the document with permanent URLs.
   */
  async backfillMediaArchive(
    client: Client,
    mongo: import("mongodb").MongoClient,
    options: BackfillOptions = {},
  ) {
    const {
      collectionName = "Messages",
      authorIds = null,
      guildId = null,
      channelId = null,
      forceRetry = false,
      batchSize = 50,
    } = options;

    if (!MediaArchivalService.isAvailable()) {
      console.error("[BACKFILL] MinIO not available — cannot backfill media");
      return { processed: 0, archived: 0, errors: 0 };
    }

    const startTime = Date.now();
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName as string);

    // Build query: messages with media but no/empty mediaArchive
    const archiveConditions: import("mongodb").Filter<
      import("mongodb").Document
    >[] = [{ mediaArchive: { $exists: false } }];
    // forceRetry: also re-process messages that were previously marked
    // with empty mediaArchive (e.g. URLs were expired during prior attempts)
    if (forceRetry) {
      archiveConditions.push({ mediaArchive: { $eq: {} } });
    }

    const query: import("mongodb").Filter<import("mongodb").Document> = {
      ...EXCLUDE_SOFT_DELETED,
      $and: [
        { $or: archiveConditions },
        {
          $or: [
            { "attachments.0": { $exists: true } },
            { "stickers.0": { $exists: true } },
            { "embeds.0": { $exists: true } },
          ],
        },
      ],
    };
    if (authorIds) query["author.id"] = { $in: authorIds };
    if (guildId) query.guildId = guildId;
    if (channelId) query.channelId = channelId;

    const totalCount = await collection.countDocuments(query);
    console.log(
      `[BACKFILL] Found ${totalCount} message(s) needing media archival`,
    );
    if (totalCount === 0) return { processed: 0, archived: 0, errors: 0 };

    // Load all docs, group by channel
    const docs = await collection.find(query).batchSize(batchSize).toArray();
    const byChannel = new Map<string, import("mongodb").Document[]>();
    for (const document of docs) {
      const chId = document.channelId as string;
      if (!byChannel.has(chId)) {
        byChannel.set(chId, []);
      }
      byChannel.get(chId)!.push(document);
    }

    const guild = guildId ? client.guilds.cache.get(guildId as string) : null;
    let processed = 0;
    let archived = 0;
    let errors = 0;

    for (const [channelId, channelDocs] of byChannel) {
      // Resolve channel from guild cache or client channels
      const channel = guild
        ? guild.channels.cache.get(channelId)
        : client.channels.cache.get(channelId);

      if (!channel) {
        console.warn(
          `  [BACKFILL] Channel ${channelId} not in cache — skipping ${channelDocs.length} message(s)`,
        );
        // Mark as empty mediaArchive so we don't retry endlessly
        for (const document of channelDocs) {
          await collection.updateOne(
            { _id: document._id },
            { $set: { mediaArchive: {} } },
          );
          processed++;
        }
        continue;
      }

      for (const document of channelDocs) {
        processed++;

        try {
          // Fetch the live message from Discord to get fresh CDN URLs
          let liveMessage: Message | null;
          try {
            liveMessage = await (channel as TextChannel).messages.fetch(
              document.id,
            );
          } catch (fetchErr: unknown) {
            const discordError = fetchErr as Error & { code?: number };
            if (discordError.code === 10008) {
              // Message was deleted — mark and skip
              console.log(
                `  [BACKFILL] Message ${document.id} deleted from Discord — marking empty`,
              );
              await collection.updateOne(
                { _id: document._id },
                { $set: { mediaArchive: {} } },
              );
              continue;
            }
            throw fetchErr;
          }

          // Use the standard archival pipeline on the live message
          const archiveMap = await MediaArchivalService.archiveMessageMedia(
            liveMessage!,
          );

          if (Object.keys(archiveMap).length > 0) {
            // Transform fresh doc and rewrite URLs
            const freshDoc = transformMessageRoot(liveMessage!);
            MediaArchivalService.rewriteDocumentUrls(freshDoc, archiveMap);

            await collection.updateOne(
              { _id: document._id },
              {
                $set: {
                  mediaArchive: archiveMap,
                  attachments: freshDoc.attachments,
                  stickers: freshDoc.stickers,
                  embeds: freshDoc.embeds,
                },
              },
            );
            archived++;
          } else {
            // No media found on live message — mark as processed
            await collection.updateOne(
              { _id: document._id },
              { $set: { mediaArchive: {} } },
            );
          }

          if (processed % 25 === 0) {
            console.log(
              `  [BACKFILL] Progress: ${processed}/${totalCount} processed, ${archived} archived`,
            );
          }
        } catch (error: unknown) {
          errors++;
          console.error(
            `  [BACKFILL] Error processing message ${document.id}: ${errorMessage(error)}`,
          );
          // Mark failed so we don't retry on next run (can be cleared manually)
          await collection.updateOne(
            { _id: document._id },
            { $set: { mediaArchive: {} } },
          );
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[BACKFILL] Complete — processed: ${processed}, archived: ${archived}, errors: ${errors} (${duration}s)`,
    );

    return { processed, archived, errors };
  },
  async deleteDuplicateMessagesByID(
    mongo: import("mongodb").MongoClient,
    collectionName: string = "Messages",
  ) {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);

    console.log("[START] Finding and deleting duplicate messages...");

    // Find all duplicate IDs using aggregation
    const duplicates = await collection
      .aggregate([
        {
          $group: {
            _id: "$id",
            count: { $sum: 1 },
            docs: { $push: "$_id" },
          },
        },
        {
          $match: {
            count: { $gt: 1 },
          },
        },
      ])
      .toArray();

    console.log(
      `[INFO] Found ${duplicates.length} message IDs with duplicates`,
    );

    let totalDeleted = 0;

    for (const duplicate of duplicates) {
      // Keep the first document, delete the rest
      const docsToDelete = duplicate.docs.slice(1);

      if (docsToDelete.length > 0) {
        const result = await collection.deleteMany({
          _id: { $in: docsToDelete },
        });
        totalDeleted += result.deletedCount;
        console.log(
          `[DELETE] Deleted ${result.deletedCount} duplicate(s) for message ID: ${duplicate._id}`,
        );
      }
    }

    console.log(`[COMPLETE] Total duplicates deleted: ${totalDeleted}`);

    return {
      duplicateIdsFound: duplicates.length,
      totalDeleted: totalDeleted,
    };
  },

  async saveMessageToMongo(
    message: Message,
    mongo: import("mongodb").MongoClient,
    collectionName: string = "Messages",
  ) {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const messageObject = transformMessageRoot(message);

    // Archive media to MinIO (content-addressable, deduped by SHA-256)
    if (MediaArchivalService.isAvailable()) {
      try {
        const archiveMap =
          await MediaArchivalService.archiveMessageMedia(message);
        if (Object.keys(archiveMap).length > 0) {
          messageObject.mediaArchive = archiveMap;
          MediaArchivalService.rewriteDocumentUrls(messageObject, archiveMap);
        }
      } catch (error: unknown) {
        console.warn(
          `📦 Media archival failed for message ${message.id}: ${errorMessage(error)}`,
        );
      }
    }

    // Dynamic fields that can change over a message's lifetime.
    // These use $set so they stay current even if the document already exists.
    const dynamicFields = {
      reactions: messageObject.reactions,
      embeds: messageObject.embeds,
      attachments: messageObject.attachments,
      content: messageObject.content,
      cleanContent: messageObject.cleanContent,
      editedAt: messageObject.editedAt,
      editedTimestamp: messageObject.editedTimestamp,
      pinned: messageObject.pinned,
      member: messageObject.member,
    };

    // Clone for $setOnInsert and strip dynamic paths to avoid conflict
    const insertDoc = { ...messageObject };
    for (const key of Object.keys(dynamicFields)) {
      delete insertDoc[key];
    }

    await collection.updateOne(
      { id: messageObject.id },
      {
        $setOnInsert: insertDoc,
        $set: dynamicFields,
      },
      { upsert: true },
    );
  },
  async updateMessageInMongo(
    message: Message,
    mongo: import("mongodb").MongoClient,
    collectionName: string = "Messages",
  ) {
    const db = mongo.db(MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    const messageObject = transformMessageRoot(message);

    // Archive media to MinIO (content-addressable, deduped by SHA-256)
    if (MediaArchivalService.isAvailable()) {
      try {
        const archiveMap =
          await MediaArchivalService.archiveMessageMedia(message);
        if (Object.keys(archiveMap).length > 0) {
          messageObject.mediaArchive = archiveMap;
          MediaArchivalService.rewriteDocumentUrls(messageObject, archiveMap);
        }
      } catch (error: unknown) {
        console.warn(
          `📦 Media archival failed for message ${message.id}: ${errorMessage(error)}`,
        );
      }
    }

    await collection.updateOne(
      { id: messageObject.id },
      { $set: messageObject },
      { upsert: false },
    );
  },
  /**
   * Sync only the reactions field for a message to MongoDB.
   * Called from Discord reaction add/remove event handlers.
   */
  async syncReactionsToMongo(
    reactionMessage: Message,
    mongo: import("mongodb").MongoClient,
    collectionName: string = "Messages",
  ) {
    try {
      const db = mongo.db(MONGO_DB_NAME);
      const collection = db.collection(collectionName);
      const transformedReactions = reactionMessage.reactions.cache.map(
        (r: MessageReaction) => transformReaction(r),
      );
      await collection.updateOne(
        { id: reactionMessage.id },
        { $set: { reactions: transformedReactions } },
      );
    } catch (error: unknown) {
      console.warn(
        `[syncReactionsToMongo] Failed for message ${reactionMessage.id}: ${errorMessage(error)}`,
      );
    }
  },
};

export default MessageArchive;
