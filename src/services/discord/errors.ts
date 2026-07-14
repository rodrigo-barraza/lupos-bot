// ============================================================
// Discord error helpers — shared by DiscordUtilityService and
// the discord/ modules split out of it (MessageArchive,
// ChannelAnalytics). Extracted from DiscordUtilityService.ts.
// ============================================================

/** Extract a human-readable message from an unknown thrown value. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Extract a stack trace from an unknown thrown value. */
export const errorStack = (err: unknown): string | undefined =>
  err instanceof Error ? err.stack : undefined;
