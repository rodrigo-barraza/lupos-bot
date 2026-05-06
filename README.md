# Lupos — Discord Bot

AI-powered Discord bot for a gaming community server. Generates context-aware responses and images via the Prism AI gateway, features simulated personality traits (mood, hunger, energy) that influence chat behavior, handles community management (roles, moderation, account guard), plays media in voice channels, and archives all Discord media to MinIO.

**Port:** `1337` · **Runtime:** Node.js (ES Modules) · **Framework:** Express 5 · **DB:** MongoDB · **Storage:** MinIO (S3-compat) · **Process Manager:** PM2

## Features

- **Context-Aware AI Responses** — Generates personalized responses via the Prism gateway with full conversation history context
- **Image Generation & Vision** — Creates images from prompts and analyzes uploaded images
- **Simulated Personality** — Dynamic traits (mood, hunger, thirst, energy, sickness, alcohol, bathroom) influence chat tone and behavior
- **Community Management** — Role assignment, content moderation/censoring, account guard (new account detection), and active chatter tracking
- **Slash Commands** — Death roll gambling, beat up, shock, roll, guess who, word cloud, heatmap, leaderboard, and mentions
- **Voice & Media** — Joins voice channels, plays YouTube audio, and TTS via @discordjs/voice
- **Media Archival** — Archives all Discord media (attachments, avatars, banners) to MinIO with MongoDB metadata tracking
- **Scheduled Jobs** — Birthday announcements, activity-based role assignment, server icon rotation, random member tagging, permanent timeout enforcement
- **Web Scraping** — URL content extraction via Puppeteer for AI context enrichment
- **Transcription API** — Express HTTP endpoint for speech-to-text via Prism
- **Smart Lighting** — Controls Philips Hue lights via the Lights Service API

## Architecture

```
lupos-bot/
├── api/                    # Express route handlers (vending webhooks)
│   └── services/
├── arrays/                 # Static data (birthdays, channels, roles, users)
├── commands/               # Discord slash commands
│   └── utility/            # Game commands (deathroll, guesswho, wordcloud, heatmap, etc.)
├── constants/              # Domain constants (Clock Crew, games, messages, mood, guess who)
├── docs/                   # Design documents (agentic integration plan)
├── formatters/             # Styled console log formatting
├── images/                 # Static image assets (April Fools, etc.)
├── jobs/
│   ├── event-driven/       # Reaction-triggered event handlers
│   └── scheduled/          # Cron jobs (birthdays, roles, server icon, random tags, timeouts)
├── routes/                 # Express REST routes (guild API)
├── scripts/                # Migration and backfill scripts (media archive)
├── services/               # Core business logic (23 services)
│   └── WebHookService/     # Webhook event handlers
├── tests/                  # Vitest test suites
├── utils/                  # Shared utility helpers
├── voices/                 # Sample voice message assets
└── wrappers/               # Low-level client wrappers (Discord.js, MinIO)
```

### Service Layer

| Service | Purpose |
|---|---|
| `DiscordService` | Primary Discord event handler and bot lifecycle (~156KB) |
| `DiscordUtilityService` | Discord helper utilities — channel stats, member ops (~90KB) |
| `AIService` | AI proxy — text, image, vision, TTS, STT via Prism |
| `PrismService` | HTTP client for the Prism AI gateway |
| `MongoService` | MongoDB connection wrapper |
| `MessageService` | Message processing, history, and formatting |
| `MediaArchivalService` | Discord media archival to MinIO with metadata |
| `AccountGuardService` | New account detection and auto-kicking |
| `CensorService` | Content moderation and word filtering |
| `MoodService` | Simulated mood state machine |
| `HungerService` | Simulated hunger trait |
| `ThirstService` | Simulated thirst trait |
| `EnergyService` | Simulated energy trait |
| `SicknessService` | Simulated sickness trait |
| `AlcoholService` | Simulated alcohol trait |
| `BathroomService` | Simulated bathroom need trait |
| `CurrentService` | Current state/context tracking |
| `LightsService` | HTTP client for the Lights API |
| `ScraperService` | Puppeteer-based web scraping |
| `StatService` | User/server statistics |
| `YapperService` | Top chatter ranking and role assignment |
| `YouTubeService` | YouTube audio streaming and transcripts |

### Slash Commands

| Command | Description |
|---|---|
| `/deathroll` | Death roll gambling game with leaderboard and stats |
| `/beatup` | Beat up another user (animated combat) |
| `/shock` | Shock another user |
| `/roll` | Simple dice roll |
| `/guesswho` | Guess who game with leaderboard |
| `/wordcloud` | Generate word cloud from channel history |
| `/heatmap` | Generate activity heatmap visualization |
| `/leaderboard` | Message leaderboard for the server |
| `/mentions` | See who mentions you the most |

## Prerequisites

- **Node.js** v20+ (ES Modules)
- **Discord Bot Token** — with Message Content and Server Members privileged intents
- **MongoDB** — for tracking users, messages, and personality state
- **MinIO** — for media archival (optional — graceful degradation)
- **Prism Service** — accessible on the local network for AI capabilities
- **Tools Service** — accessible on the local network for context pulling

## Tech Stack

| Dependency | Purpose |
|---|---|
| discord.js | Discord API interaction and gateway events |
| @discordjs/voice | Voice channel audio (music, TTS playback) |
| mongodb | Persistent storage (messages, users, state) |
| minio | S3-compatible media archival |
| puppeteer | Headless browser for web scraping |
| sharp / jimp | Image processing and manipulation |
| luxon | Date/time handling |
| play-dl / @distube/ytdl-core | YouTube audio streaming |
| express | Internal HTTP API for transcription and webhooks |
| @rodrigo-barraza/utilities | Shared ecosystem utility library |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure secrets

```bash
cp secrets.example.js secrets.js
```

Edit `secrets.js` with your Discord bot token, MongoDB URI, MinIO credentials, and Prism/Tools API URLs.

### 3. Start the bot

```bash
npm run dev        # Normal mode (messages)
```

### Operation Modes

```bash
npm run dev                    # Default — message processing mode
npm run clone:messages         # Clone/backfill message history
npm run rescrape:channels      # Re-scrape channel data
```

Additional modes available via `node boot.js mode=<mode>`:
- `delete:duplicates` — Remove duplicate messages
- `delete:newAccounts` — Remove flagged new accounts
- `purge:youngAccounts` — Purge accounts under age threshold
- `reports` — Generate server reports

## Scripts

```bash
npm run dev              # Run Lupos (messages mode)
npm test                 # Run tests (Vitest)
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix lint issues
npm run format           # Format with Prettier
npm run format:check     # Check formatting
npm run deploy           # Deploy to Synology NAS
npm run deploy:dry       # Validate without deploying
```

## Ecosystem Dependencies

```
lupos-bot
├── prism-service (required) — AI gateway for chat, image gen, vision, TTS, STT
├── mongodb (required)       — Message storage, user tracking, personality state
├── minio (optional)         — Media archival (avatars, attachments, banners)
├── tools-service (optional) — Context pulling, data enrichment
└── vault-service (optional) — Centralized secret management
```
