# ============================================================
# Lupos — Dockerfile (multi-stage)
# ============================================================
# Discord bot with voice support, Puppeteer browser automation,
# and an Express health API. Uses boot.ts to fetch secrets from
# Vault at startup.
# ============================================================

# ── Stage 1: Install ALL dependencies (incl. devDeps for tsc) ─
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci

# ── Stage 2: Compile TypeScript ───────────────────────────────
FROM deps AS build
COPY . .
RUN npx tsc

# ── Stage 3: Production dependencies only ─────────────────────
FROM node:22-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

# ── Stage 4: Runtime ──────────────────────────────────────────
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
ENV TZ=America/Los_Angeles

WORKDIR /app

# Copy production-only node_modules (no devDeps)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled JS output
COPY --from=build /app/dist ./dist

# Copy package.json (needed for "imports" and "type": "module")
COPY package.json ./

# Copy static assets needed at runtime
COPY clocks_data.json messages.json ./
COPY images ./images
COPY voices ./voices

# Non-root user for security
RUN groupadd --system --gid 1001 lupos && \
    useradd --system --uid 1001 --gid lupos lupos && \
    chown -R lupos:lupos /app
USER lupos

EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:1337/health || exit 1

CMD ["node", "dist/boot.js"]
