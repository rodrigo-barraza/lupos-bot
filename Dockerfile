# ============================================================
# Lupos — Dockerfile (multi-stage)
# ============================================================
# Discord bot with voice support, Playwright browser automation,
# and an Express health API. Uses boot.ts to fetch secrets from
# Vault at startup.
# ============================================================

# ── Stage 1: Install ALL dependencies (incl. devDeps for tsc) ─
FROM node:26-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=ssh npm ci

# ── Stage 2: Compile TypeScript ───────────────────────────────
FROM deps AS build
COPY . .
RUN npx tsc

# ── Stage 3: Production dependencies only ─────────────────────
FROM node:26-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=ssh npm ci --omit=dev

# ── Stage 4: Runtime ──────────────────────────────────────────
FROM node:26-slim

# Chromium (Playwright), FFmpeg (voice/audio), wget (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
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
