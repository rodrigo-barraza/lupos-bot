"use strict";

// Environment setup
process.env.NODE_NO_WARNINGS = "stream/web";

import config from "./config.ts";
import DiscordService from "./services/DiscordService.ts";
import LogFormatter from "./formatters/LogFormatter.ts";
import MinioWrapper from "./wrappers/MinioWrapper.ts";
import MediaArchivalService from "./services/MediaArchivalService.ts";
import DiscordWrapper from "./wrappers/DiscordWrapper.ts";

import type { Request, Response, NextFunction } from "express";
import express from "express";
const app = express();
import services from "./services/services.ts";

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
        await DiscordService.purgeYoungAccounts();
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
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, PUT, PATCH, DELETE",
      );
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      next();
    });
    app.get("/health", (_req: Request, res: Response) => {
      res.json({
        name: "Lupos",
        status: "ok",
        uptime: process.uptime(),
        mode: mode || "default",
        minioAvailable: MinioWrapper.isAvailable(),
      });
    });
    app.use("/", services());
    httpServer = app.listen(Number(config.SERVER_PORT), "0.0.0.0", () => {
      console.log(`Server listening on 0.0.0.0:${config.SERVER_PORT}`);
    });
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
