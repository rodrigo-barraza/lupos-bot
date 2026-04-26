// ============================================================
// Vault Client — Secret Bootstrap Utility
// ============================================================
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const DEFAULT_VAULT_URL = "http://192.168.86.2:5599";
const FETCH_TIMEOUT_MS = 3_000;

function parseEnvFile(filePath) {
  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    console.warn(`⚠️  Env file not found: ${absolutePath}`);
    return {};
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

export function createVaultClient(options = {}) {
  const {
    vaultUrl = process.env.VAULT_URL || DEFAULT_VAULT_URL,
    vaultToken = process.env.VAULT_TOKEN || "",
    fallbackEnvFile,
    keys,
    prefix,
    exclude,
  } = options;

  return {
    async fetch() {
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
          if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
          const secrets = await res.json();
          console.warn(`🔐 Vault → loaded ${Object.keys(secrets).length} secrets`);
          return secrets;
        } catch (err) {
          console.warn(`⚠️  Vault unreachable (${err.message})`);
        }
      } else {
        console.warn("⚠️  No VAULT_TOKEN set — skipping Vault");
      }
      if (fallbackEnvFile) {
        console.warn("📄 Falling back to .env file");
        const parsed = parseEnvFile(fallbackEnvFile);
        console.warn(`📄 Loaded ${Object.keys(parsed).length} vars from ${fallbackEnvFile}`);
        return parsed;
      }
      console.warn("⚠️  No fallback .env configured — returning empty secrets");
      return {};
    },
  };
}
