// @ts-nocheck
// ─── Boot Sequence ──────────────────────────────────────────

import { bootstrapEnv } from "@rodrigo-barraza/utilities-library/vault";

await bootstrapEnv();

// Forward CLI args to lupos.js
await import("./lupos.js");
