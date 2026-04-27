"use strict";

// Environment setup
process.env.NODE_NO_WARNINGS = "stream/web";

// Dependencies
// import { MongoClient } from 'mongodb';
import config from "./config.js";
// const utilities = require('./libraries/utilities.js');
import DiscordService from "./services/DiscordService.js";
import LogFormatter from "./formatters/LogFormatter.js";
// const MongoWrapper = require('./wrappers/MongoWrapper.js');
import MinioWrapper from "./wrappers/MinioWrapper.js";
import MediaArchivalService from "./services/MediaArchivalService.js";

import express from "express";
const app = express();
import services from "./services/services.js";

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args.find((arg) => arg.startsWith("mode="))?.split("=")[1];

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

    // DISCORD REPORTING: LUPOS

    // API SERVER
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, PUT, PATCH, DELETE",
      );
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Credentials", true);
      next();
    });
    app.get("/health", (_req, res) => {
      res.json({
        name: "Lupos",
        status: "ok",
        uptime: process.uptime(),
        mode: mode || "default",
        minioAvailable: MinioWrapper.isAvailable(),
      });
    });
    app.use("/", services());
    app.listen(config.SERVER_PORT, "0.0.0.0", () => {
      console.log(`Server listening on 0.0.0.0:${config.SERVER_PORT}`);
    });

    // HOME ASSISTANT
  } catch (error) {
    console.log(LogFormatter.errorInitialization(error));
    // utilities.consoleInfoColor([[`Initialization failed: \n${error}`, { bold: true, color: 'red' }]]);
    // process.exit(1);
  }
}

main();

