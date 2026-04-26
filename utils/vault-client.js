// ============================================================
// Vault Client — Secret Bootstrap Utility
// ============================================================
// Fetches secrets from multiple sources and merges them with
// clear precedence rules for flexible deployment.
//
// Resolution order (first wins per key):
//   1. process.env (manual env vars, Docker --env)
//   2. Local .env  (project-level overrides for local dev)
//   3. Vault       (production secret server)
//   4. Fallback    (shared vault/.env for offline dev)
//
// Usage (in any service's boot.js):
//
//   import { createVaultClient } from "./utils/vault-client.js";
//
//   const vault = createVaultClient({
//     localEnvFile: "./.env",           // project-level overrides
//     fallbackEnvFile: "../vault/.env", // shared fallback
//   });
//   const secrets = await vault.fetch();
//
// For local development:
//   cp .env.example .env
//   Fill in only the values you need to override.
//
// Configuration:
//   The client reads VAULT_URL and VAULT_TOKEN from process.env
//   (or from the local .env), or you can pass them directly.
// ============================================================

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Default Configuration ──────────────────────────────────────
const DEFAULT_VAULT_URL = "http://192.168.86.2:5599";
const FETCH_TIMEOUT_MS = 3_000;

/**
 * Parse a .env file into a key-value object.
 * Supports quoted values, comments, and blank lines.
 */
function parseEnvFile(filePath) {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    return null;
  }

  const content = readFileSync(absolutePath, "utf-8");
  const parsed = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

/**
 * Create a Vault client instance.
 *
 * @param {object} options
 * @param {string} [options.localEnvFile]      - Project-level .env for local dev overrides (highest priority)
 * @param {string} [options.vaultUrl]          - Vault service URL (default: http://192.168.86.2:5599)
 * @param {string} [options.vaultToken]        - Bearer token for Vault auth
 * @param {string} [options.fallbackEnvFile]   - Path to shared .env file for offline fallback (lowest priority)
 * @param {string[]} [options.keys]            - Specific keys to request from Vault (omit for all)
 * @param {string} [options.prefix]            - Filter Vault keys by prefix
 * @param {string} [options.exclude]           - Exclude Vault keys matching these prefixes (comma-separated)
 */
export function createVaultClient(options = {}) {
  const {
    localEnvFile,
    fallbackEnvFile,
    keys,
    prefix,
    exclude,
  } = options;

  return {
    /**
     * Fetch and merge secrets from all sources.
     *
     * Merge order (later sources fill in gaps, never overwrite):
     *   1. Local .env       → project-level overrides
     *   2. Vault service    → production secrets
     *   3. Fallback .env    → shared vault/.env for offline dev
     *
     * Returns: plain object of { KEY: "value" } pairs.
     */
    async fetch() {
      const merged = {};

      // ── 1. Local .env (highest priority) ────────────────────
      if (localEnvFile) {
        const local = parseEnvFile(localEnvFile);
        if (local) {
          Object.assign(merged, local);
          console.warn(`📋 Local .env → loaded ${Object.keys(local).length} overrides`);
        }
      }

      // Resolve vault connection from local overrides or process.env
      const vaultUrl = options.vaultUrl || merged.VAULT_URL || process.env.VAULT_URL || DEFAULT_VAULT_URL;
      const vaultToken = options.vaultToken || merged.VAULT_TOKEN || process.env.VAULT_TOKEN || "";

      // ── 2. Vault service ────────────────────────────────────
      if (vaultToken) {
        try {
          const params = new URLSearchParams();
          if (keys?.length) params.set("keys", keys.join(","));
          if (prefix) params.set("prefix", prefix);
          if (exclude) params.set("exclude", exclude);

          const queryString = params.toString();
          const url = `${vaultUrl}/secrets${queryString ? "?" + queryString : ""}`;

          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${vaultToken}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status} — ${res.statusText}`);
          }

          const secrets = await res.json();

          // Merge — local .env values take precedence
          for (const [key, value] of Object.entries(secrets)) {
            if (merged[key] === undefined) {
              merged[key] = value;
            }
          }

          console.warn(`🔐 Vault → loaded ${Object.keys(secrets).length} secrets`);
        } catch (err) {
          console.warn(`⚠️  Vault unreachable (${err.message})`);
        }
      } else {
        console.warn("⚠️  No VAULT_TOKEN set — skipping Vault");
      }

      // ── 3. Fallback: shared .env file ───────────────────────
      if (fallbackEnvFile) {
        const fallback = parseEnvFile(fallbackEnvFile);
        if (fallback) {
          let filled = 0;
          for (const [key, value] of Object.entries(fallback)) {
            if (merged[key] === undefined) {
              merged[key] = value;
              filled++;
            }
          }
          if (filled > 0) {
            console.warn(`📄 Fallback .env → filled ${filled} remaining vars`);
          }
        }
      }

      if (Object.keys(merged).length === 0) {
        console.warn("⚠️  No secrets loaded from any source");
      }

      return merged;
    },
  };
}
