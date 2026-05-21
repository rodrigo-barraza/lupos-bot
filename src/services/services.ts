import type { Request, Response } from "express";
import express from "express";
const router = express.Router();

import AIService from "#root/services/AIService.js";
import guildRoutes from "#root/routes/GuildRoutes.js";

const routes = () => {

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

      const audioUrl = decodeURIComponent(req.params.audioUrl);

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
