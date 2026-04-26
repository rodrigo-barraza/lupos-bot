// ============================================================
// Lupos — Boot Sequence
// ============================================================
import { createVaultClient } from "./utils/vault-client.js";

const vault = createVaultClient({
  localEnvFile: "./.env",
  fallbackEnvFile: "../vault/.env",
});

const secrets = await vault.fetch();

for (const [key, value] of Object.entries(secrets)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

// Forward CLI args to lupos.js
await import("./lupos.js");
