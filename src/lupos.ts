"use strict";

// Environment setup
process.env.NODE_NO_WARNINGS = "stream/web";

import config, { validateConfig } from "./config.ts";
import { createCorsMiddleware } from "./middleware/corsAllowlist.ts";
import { createApiAuthMiddleware } from "./middleware/apiAuth.ts";
import DiscordService from "./services/DiscordService.ts";
import LogFormatter from "./formatters/LogFormatter.ts";
import MinioWrapper from "./wrappers/MinioWrapper.ts";
import MediaArchivalService from "./services/MediaArchivalService.ts";
import DiscordWrapper from "./wrappers/DiscordWrapper.ts";
import HeartbeatService from "./services/HeartbeatService.ts";
import AvatarSyncService from "./services/AvatarSyncService.ts";
import CommandSyncService from "./services/CommandSyncService.ts";

import type { Request, Response } from "express";
import express from "express";
const app = express();
import services from "./services/services.ts";

// ─── Config Validation (fail fast, before anything else) ────────
try {
  validateConfig();
} catch (error: unknown) {
  console.error(`❌ [lupos] ${(error as Error).message}`);
  process.exit(1);
}

// Parse command line arguments
let httpServer: import("node:http").Server | null = null;

const args = process.argv.slice(2);
const mode = args.find((arg: string) => arg.startsWith("mode="))?.split("=")[1];
const channelIdsArg = args
  .find((arg: string) => arg.startsWith("channels="))
  ?.split("=")[1];
const channelIds = channelIdsArg
  ? channelIdsArg.split(",").filter(Boolean)
  : null;
const guildIdsArg = args
  .find((arg: string) => arg.startsWith("guilds="))
  ?.split("=")[1];
const guildIds = guildIdsArg ? guildIdsArg.split(",").filter(Boolean) : null;
const dateLimit =
  args.find((arg: string) => arg.startsWith("dateLimit="))?.split("=")[1] ||
  null;
// Explicit confirmation flag for destructive modes (e.g. purge:youngAccounts).
// Only the literal "confirm=true" counts — anything else stays dry-run.
const confirm =
  args.find((arg: string) => arg.startsWith("confirm="))?.split("=")[1] ===
  "true";

async function main() {
  try {
    console.log(...LogFormatter.luposInitializing());

    // ─── MinIO initialization (optional — graceful degradation) ───
    if (
      config.MINIO_ENDPOINT &&
      config.MINIO_ACCESS_KEY &&
      config.MINIO_SECRET_KEY &&
      config.MINIO_BUCKET_NAME
    ) {
      await MinioWrapper.init(
        config.MINIO_ENDPOINT,
        config.MINIO_ACCESS_KEY,
        config.MINIO_SECRET_KEY,
        config.MINIO_BUCKET_NAME,
      );
      if (MinioWrapper.isAvailable()) {
        await MediaArchivalService.ensureIndexes();
      }
    } else {
      console.log("📦 MinIO not configured — media archival disabled");
    }

    // Mode initializers run concurrently with the API server below (some run
    // for hours and are monitored via the status routes), but their rejections
    // must be contained — an escaped rejection would kill the process.
    const runMode = async () => {
      if (mode === "clone:messages") {
        await DiscordService.cloneMessages();
      } else if (mode === "rescrape:channels") {
        await DiscordService.rescrapeChannels({
          channelIds,
          guildIds,
          dateLimit,
        });
      } else if (mode === "delete:duplicates") {
        await DiscordService.deleteDuplicateMessages();
      } else if (mode === "delete:newAccounts") {
        await DiscordService.deleteNewAccounts();
      } else if (mode === "purge:youngAccounts") {
        await DiscordService.purgeYoungAccounts({ confirm });
      } else if (mode === "reports") {
        await DiscordService.initializeBotLuposReports();
      } else {
        await DiscordService.initializeBotLupos();
      }
    };
    runMode().catch((error: unknown) => {
      console.error(
        `❌ [lupos] Initialization failed for mode "${mode ?? "default"}":`,
        error,
      );
    });

    // API SERVER
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    // CORS — allowlist when ALLOWED_ORIGINS is set, legacy reflect-any
    // behavior (with a warning) when it is not.
    app.use(createCorsMiddleware(config.ALLOWED_ORIGINS));
    // API auth — mutating endpoints require x-api-key when
    // API_SHARED_SECRET is set; no-op (with a warning) when it is not.
    app.use(createApiAuthMiddleware(config.API_SHARED_SECRET));
    app.get("/health", (_req: Request, res: Response) => {
      // Queue gauges surface the wedge the plain 200 can't: one hung reply
      // freezes the global serial drain while HTTP keeps answering.
      const queue = HeartbeatService.getLivenessSnapshot();
      const liveness = HeartbeatService.evaluateLiveness(queue, Date.now());
      res.json({
        name: "Lupos",
        status: liveness.alive ? "ok" : "wedged",
        reason: liveness.reason,
        uptime: process.uptime(),
        mode: mode || "default",
        minioAvailable: MinioWrapper.isAvailable(),
        queueDepth: queue.queueDepth,
        isProcessingQueue: queue.isProcessingQueue,
        lastQueueActivityAt: new Date(queue.lastQueueActivityAtMs).toISOString(),
      });
    });
    app.use("/", services());
    httpServer = app.listen(Number(config.SERVER_PORT), "0.0.0.0", () => {
      console.log(`Server listening on 0.0.0.0:${config.SERVER_PORT}`);
    });
    // Dead-man's-switch heartbeat — no-op unless HEARTBEAT_URL is set
    HeartbeatService.startHeartbeat();
    // Mood-portrait → Discord profile avatar sync; only the live bot
    // should touch the account avatar, not maintenance modes.
    if (!mode) {
      AvatarSyncService.startAvatarSync();
      // Slash-command registration (hash-guarded, per guild) — a deploy
      // is complete without a separate deploy-commands run.
      CommandSyncService.startCommandSync();
    }
  } catch (error: unknown) {
    console.log(LogFormatter.errorInitialization(error));
  }
}

main();

// ─── Graceful Shutdown ──────────────────────────────────────────
// Prevents data loss during Docker SIGTERM / redeployments.
// Ensures MongoDB writes complete and Discord sessions close cleanly.
const shutdown = async (signal: string, exitCode = 0) => {
  console.log(`\n🛑 ${signal} received — shutting down gracefully…`);
  try {
    // Stop accepting new HTTP requests
    if (httpServer) {
      httpServer.close();
      console.log("  ✓ HTTP server closed");
    }
    // Destroy all Discord client connections
    for (const { client, name } of DiscordWrapper.clients) {
      try {
        await client.destroy();
        console.log(`  ✓ Discord client "${name}" destroyed`);
      } catch {
        /* already closed */
      }
    }
    // Close all MongoDB connections (whatever names they were registered under)
    const MongoService = (await import("./services/MongoService.ts")).default;
    await MongoService.closeAll();
    console.log("  ✓ MongoDB connections closed");
  } catch (error: unknown) {
    console.error("  ⚠️ Error during shutdown:", (error as Error).message);
  }
  process.exit(exitCode);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Global Safety Nets ─────────────────────────────────────────
// Event handlers contain their own errors (see runEventHandler), but any
// rejection that still escapes must not silently kill the process.
process.on("unhandledRejection", (reason) => {
  console.error("❌ [lupos] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("❌ [lupos] Uncaught exception — shutting down:", error);
  void shutdown("uncaughtException", 1);
});
