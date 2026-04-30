// ============================================================
// Lupos — Secrets Template
// ============================================================
// Secrets are resolved from (in priority order):
//   1. process.env (manual env vars, Docker --env)
//   2. Vault service (via boot.js → VAULT_SERVICE_URL + VAULT_SERVICE_TOKEN)
//   3. Fallback .env file (../vault-service/.env)
//
// See vault-service/.env.example for the full list of variables.
// Array fields use comma-separated values in .env.
// ============================================================

// LUPOS_BOT_PORT=1337
// UNDER_MAINTENANCE=true
// VENDER_TOKEN=
// LUPOS_TOKEN=
// PRISM_SERVICE_URL=http://localhost:7777
// MONGO_URI=mongodb://user:password@<host>:27017/?directConnection=true&replicaSet=rs0&authSource=admin
// LIGHTS_SERVICE_URL=http://localhost:4444
// TOOLS_SERVICE_URL=http://localhost:5590
// ROLES_IDS_IGNORE=id1,id2
// USER_IDS_IGNORE=id1,id2
// CHANNEL_IDS_JUKEBOX=id1
// GUILD_ID_PRIMARY=
// GUILD_ID_TESTING=
// GUILD_ID_GROBBULUS=
// GUILD_ID_CLOCK_CREW=
// ... (see vault-service/.env.example for all Discord IDs and model configs)

// MinIO (Optional — media archival disabled if not set)
// MINIO_ENDPOINT=http://<host>:9000
// MINIO_ACCESS_KEY=
// MINIO_SECRET_KEY=
// LUPOS_MINIO_BUCKET_NAME=discord-media
