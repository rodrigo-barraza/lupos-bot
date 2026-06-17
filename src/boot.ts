// ─── Boot Sequence ──────────────────────────────────────────

import { bootstrapEnvironment } from "@rodrigo-barraza/utilities-library/vault";

await bootstrapEnvironment();

// Forward CLI args to lupos.js
await import("./lupos.ts");
