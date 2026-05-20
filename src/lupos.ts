"use strict";

// Environment setup
process.env.NODE_NO_WARNINGS = "stream/web";

import config from "./config.ts";
import DiscordService from "./services/DiscordService.ts";
import LogFormatter from "./formatters/LogFormatter.ts";
import MinioWrapper from "./wrappers/MinioWrapper.ts";
import MediaArchivalService from "./services/MediaArchivalService.ts";
import DiscordWrapper from "./wrappers/DiscordWrapper.ts";

import express from "express";
const app = express();
import services from "./services/services.ts";

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args.find((arg: any) => arg.startsWith("mode="))?.split("=")[1];
const channelIdsArg = args.find((arg: any) => arg.startsWith("channels="))?.split("=")[1];
const channelIds = channelIdsArg ? channelIdsArg.split(",").filter(Boolean) : null;
const guildIdsArg = args.find((arg: any) => arg.startsWith("guilds="))?.split("=")[1];
const guildIds = guildIdsArg ? guildIdsArg.split(",").filter(Boolean) : null;
const dateLimit = args.find((arg: any) => arg.startsWith("dateLimit="))?.split("=")[1] || null;

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

    if (mode === "clone:messages") {
      DiscordService.cloneMessages();
    } else if (mode === "rescrape:channels") {
      DiscordService.rescrapeChannels({ channelIds, guildIds, dateLimit });
    } else if (mode === "delete:duplicates") {
      DiscordService.deleteDuplicateMessages();
    } else if (mode === "delete:newAccounts") {
      DiscordService.deleteNewAccounts();
    } else if (mode === "purge:youngAccounts") {
      DiscordService.purgeYoungAccounts();
    } else if (mode === "reports") {
      DiscordService.initializeBotLuposReports();
    } else {
      DiscordService.initializeBotLupos();
    }


    // API SERVER
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use((req: any, res: any, next: any) => {
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
    app.get("/health", (_req: any, res: any) => {
      res.json({
        name: "Lupos",
        status: "ok",
        uptime: process.uptime(),
        mode: mode || "default",
        minioAvailable: MinioWrapper.isAvailable(),
      });
    });
    app.use("/", services());
    app.listen(Number(config.SERVER_PORT), "0.0.0.0", () => {
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
const shutdown = async (signal: string) => {
  console.log(`\n🛑 ${signal} received — shutting down gracefully…`);
  try {
    // Destroy all Discord client connections
    for (const { client, name } of DiscordWrapper.clients) {
      try {
        client.destroy();
        console.log(`  ✓ Discord client "${name}" destroyed`);
      } catch { /* already closed */ }
    }
    // Close MongoDB connections
    const MongoService = (await import("./services/MongoService.ts")).default;
    MongoService.closeClient("lupos");
    console.log("  ✓ MongoDB connections closed");
  } catch (error: unknown) {
    console.error("  ⚠️ Error during shutdown:", (error as Error).message);
  }
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
