// ─── Bot Settings Routes ─────────────────────────────────────
// Admin surface for the Mongo-backed moderation lists. Protected by
// the same shared-secret API middleware as every other route.

import { Router, type Request, type Response } from "express";
import BotSettingsService from "#root/services/BotSettingsService.ts";

const router = Router();

// GET /bot/settings — all managed lists and their current values
router.get("/bot/settings", (_req: Request, res: Response) => {
  res.json({ settings: BotSettingsService.list() });
});

// POST /bot/settings/:key — { add?: string[], remove?: string[] }
router.post("/bot/settings/:key", async (req: Request, res: Response) => {
  const key = String(req.params.key || "").toUpperCase();
  if (!BotSettingsService.isManagedKey(key)) {
    return res.status(404).json({
      error: `Unknown settings key "${key}"`,
      managedKeys: BotSettingsService.list(),
    });
  }

  const { add, remove } = (req.body ?? {}) as { add?: unknown; remove?: unknown };
  const toStringArray = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
    return value as string[];
  };
  const addList = toStringArray(add);
  const removeList = toStringArray(remove);
  if (addList === null || removeList === null) {
    return res.status(400).json({ error: "add/remove must be arrays of strings" });
  }

  const values = await BotSettingsService.update(key, {
    add: addList,
    remove: removeList,
  });
  res.json({ key, values });
});

export default router;
