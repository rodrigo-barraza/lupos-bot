# ============================================================
# Lupos — Dockerfile (multi-stage)
# ============================================================
# Discord bot with voice support, Puppeteer browser automation,
# and an Express health API. Uses boot.js to fetch secrets from
# Vault at startup.
# ============================================================

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./

# Skip Puppeteer's bundled Chromium — we use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-slim

# Chromium (Puppeteer), FFmpeg (voice/audio), wget (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy pre-built node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Non-root user for security
RUN groupadd --system --gid 1001 lupos && \
    useradd --system --uid 1001 --gid lupos lupos && \
    chown -R lupos:lupos /app
USER lupos

EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:1337/health || exit 1

CMD ["node", "boot.js"]
