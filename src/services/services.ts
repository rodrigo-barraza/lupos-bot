import type { Request, Response } from "express";
import express from "express";
const router = express.Router();

import AIService from "#root/services/AIService.ts";
import guildRoutes from "#root/routes/GuildRoutes.ts";
import settingsRoutes from "#root/routes/SettingsRoutes.ts";

const routes = () => {

  // ── Bot settings routes (Mongo-backed moderation lists) ─────────
  // Mounted before guildRoutes so they work even while the Discord
  // client is still logging in.
  router.use("/", settingsRoutes);

  // ── Guild data routes (channels, members) ───────────────────────
  router.use("/", guildRoutes);

  router.get("/transcribe/:audioUrl", async (req: Request, res: Response) => {
    try {
      console.log("hit");
      if (!req.params.audioUrl) {
        return res.status(400).json({
          error: "audioUrl is required",
        });
      }

      const audioUrl = decodeURIComponent(req.params.audioUrl as string);

      const transcription = await AIService.transcribeSpeech(audioUrl, "", 0);

      res.json({
        success: true,
        transcription: transcription,
      });
    } catch (error: unknown) {
      console.error("Transcription error:", error);
      res.status(500).json({
        error: (error as Error).message || "Transcription failed",
        success: false,
      });
    }
  });

  console.log("✅ /transcribe route registered");
  return router;
};

export default routes;
