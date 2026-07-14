# Lupos Improvement Plan

Comprehensive audit of the codebase (2026-07-13): bugs to fix, refactors into reusable
components, agentic-harness-inspired upgrades, and a testing strategy. Findings are grouped
by priority; every item cites `file:line` as of commit `184d7e2`.

Guiding constraint: **no behavior changes users would notice**, except where the current
behavior is itself a bug.

---

## P0 — Stability bugs (crash vectors & broken safety mechanisms)

These are the "fix before touching anything else" items. Each is small.

### P0.1 Split-brain queue state: message-delete cancellation is dead code

`src/services/DiscordService.ts:118-124` declares module-local `queuedData`,
`cancelledMessageIds`, `repliedMessagesCollection` — but the Phase-1 extraction moved the
_consumer_ to `src/services/discord/DiscordState.ts:17-18`. `DeletedMessageLogger.ts:43-54`
cancels via `DiscordState.markCancelled()`, while all four `isMessageCancelled` guards in
DiscordService (`:1568, :1669, :1736, :1790`) read the module-local set that **nothing ever
adds to**. Net effect: deleting a message never cancels the ~50 s reply pipeline; the bot
replies to deleted messages.
**Fix:** delete the module-local copies; route all reads/writes through `DiscordState`.
(`repliedMessagesCollection` at `:1807` is write-only — delete it.)

### P0.2 Floating promises in every event handler + no global rejection handler

All 13 `onEvent*` wrappers (`src/services/DiscordUtilityService.ts:2160-2227`) invoke async
handlers without `await`/`.catch()`. There is no `process.on("unhandledRejection")` anywhere.
On modern Node, any rejection (member left mid-event, expired interaction token, DM reaction —
see P1 list) **terminates the process**.
**Fix:** `await` + try/catch/log inside each wrapper; add `unhandledRejection` +
`uncaughtException` handlers in `lupos.ts` as a safety net (log + continue / log + graceful exit).

### P0.3 Graceful shutdown never closes Mongo and races process.exit

- `lupos.ts:119` closes client `"lupos"`, but every client is registered as `"local"`
  (`DiscordService.ts:3740` etc.) — Mongo is never closed on SIGTERM.
- `MongoService.ts:39` doesn't await `client.close()`; `client.destroy()` (`lupos.ts:113`)
  isn't awaited; `process.exit(0)` at `lupos.ts:124` races both → in-flight writes can be cut off.
- The Express server handle is never captured/closed.
  **Fix:** await destroy/close chain, close HTTP server, then exit.

### P0.4 Un-awaited mode initializers at boot

`lupos.ts:51-65` fires `cloneMessages()` / `rescrapeChannels()` etc. without `await`;
rejections escape the surrounding try/catch. Also `initializeBotLuposReports()`
(`DiscordService.ts:3891`) calls `MongoService.getClient("local")` before any client exists →
guaranteed crash in `reports` mode.
**Fix:** await the mode dispatch; create the Mongo client before reports mode runs.

### P0.5 No timeout on any Prism call + single global serial reply queue

`PrismService._request` (`src/services/PrismService.ts:40-66`) is a bare `fetch` — no
`AbortSignal.timeout`, no retry. Replies drain through one global queue
(`DiscordService.ts:3264-3301`), so **one hung `/agent` call freezes the bot in every guild**.
`utilities.fetchWithTimeout` (`src/utilities.ts:520`) already exists — use it in
`PrismService`/`AIService` (also `AIService.ts:114-118` and `:369-370` — unchecked, untimed
fetches that buffer unbounded bodies). Add a modest jittered retry (1 retry) for transient
failures — no retry storms.

### P0.6 ReactJob queue wedges permanently on first error

`src/jobs/event-driven/ReactJob.ts:89-99`: `queueIsProcessing` is only reset after the loop;
one throw (e.g. `guild.members.fetch` rejection at `:36`) leaves it `true` forever → reaction
processing silently dead until restart. **Fix:** try/finally.

### P0.7 Typing-interval leak

`DiscordService.ts:3221-3257`: typing starts, but the early-return when `fetchMessages`
returns null (`:3254`) never clears `typingIntervals[channelId]` — the 5 s sendTyping interval
spins until an API error kills it, and the stale key blocks future typing in that channel.
Same family: `updateLastMessageSentTime` (`:189-199`) starts a 1 s interval that is never
cleared **and resets its own value every 30 s, making the metric garbage** — delete or rewrite.

---

## P1 — Correctness bugs (wrong behavior, silent failures)

### Reply pipeline

1. **`guild.bans.fetch()` on every reply** (`DiscordService.ts:627`) — REST call per message
   just to print a count; throws without BanMembers permission → caught by the blanket catch →
   user gets `"..."`. Cache it or drop it.
2. **Blanket catch → `"..."` replies** (`DiscordService.ts:1636-1639`, `:1776-1786`): every
   internal failure in ~1,100 lines surfaces as a literal `"..."` message. Narrow the catch,
   log with cause, and send a friendlier "something broke" only for genuine generation failures.
3. **Empty-history crash** (`DiscordService.ts:2041-2045`): `recentXMessages[0]` unchecked;
   `:2066` reads `message.author.id` unguarded while the second pass (`:2131`) guards the same
   condition.
4. **`minioRef` corrupts image attachments** (`DiscordService.ts:1611-1614` +
   `DiscordUtilityService.ts:2510-2512`): a `"minio://…"` string is base64-decoded into a
   garbage file instead of being fetched like audio is (`:2476-2482`).
5. **Dead LOCAL image fallback** (`src/services/AIService.ts:243-294`): recursion with type
   `"LOCAL"` matches no branch → always `null` while logging "falling back". Remove or implement.
6. **Webhook/system messages**: `message.member!` assertions (`DiscordService.ts:3183-3187`,
   `:3232-3243`) throw for webhooks or members who just left; the delayed role-removal
   `setTimeout` (`:3237-3245`) rejects unhandled.
7. **DM reaction crash**: `ReactionHighlights.ts:231` uses `guild!.id` (remove-path at `:276`
   correctly uses `guild?.id`). Also `:192-193` unguarded `scrapeTenor(...).image`, `:126-128`
   unguarded fetch of a possibly-deleted referenced message, and `setImage` inside loops
   (`:152-160`, `:196-206`) keeps only the last attachment.
8. **Highlight duplicates after restart**: message→embed dedup map is in-memory with 4 h TTL
   (`DiscordState`, used at `ReactionHighlights.ts:215-222`) — persist the mapping to Mongo.
9. **`retrieveMessageReferenceFromMessage`** (`DiscordUtilityService.ts:2011-2028`) returns
   `undefined` typed as `Message` (`return messageReference!`). Make it `Message | null`.
10. **Timezone**: `new Date("2025-01-01")` parses UTC midnight vs local-time message stamps
    (`DiscordUtilityService.ts:1002`, `DiscordService.ts:2906`).

### Commands & games

11. **Post-defer command errors silently swallowed** (`DiscordService.ts:3538-3541`): user
    stares at "thinking…" forever and nothing is logged. Log + `editReply` an error message.
12. **Deathroll shows the wrong stake** (`deathrollUtils.ts:1537`): message says
    `multiplier × 15` min; `handleTimeoutLoss` (`:1924`) applies `multiplier × 5`
    (`BASE_TIMEOUT`). Use `BASE_TIMEOUT_MINUTES`.
13. **`handleLoss` fetches outside try** (`deathrollUtils.ts:1862-1865`): loser left the
    server → throw → `saveGameResult` never runs → game vanishes.
14. **MMR/streak lost-update race** (`deathrollUtils.ts:805-887`): `findOne` → compute →
    `$set`; two near-simultaneous game-ends drop one update. Also nothing prevents one user
    being in N concurrent games. Use an atomic update or per-user mutex; add a **unique index
    on `gameId`** (`:362-374`) to kill the double-save path.
15. **Double-or-Nothing collector abuse** (`deathrollUtils.ts:1135-1137`): `idle: 10s` with no
    `time` cap — bystander clicks reset the idle timer indefinitely, postponing the loser's
    timeout forever; the 1 s countdown edit loop (`:1145-1162`) is a rate-limit hazard.
16. **Unbounded DoN multiplier** (`deathrollUtils.ts:1109`): past multiplier 8192 the timeout
    exceeds Discord's 28-day cap; `member.timeout()` throws and the loser escapes punishment.
    Clamp at the cap.
17. **Ephemeral flags lost** (`deathrollUtils.ts:1174, 1181, 1587, 1594, 1617, 1625`, …):
    dangling commas where `ephemeral: true` was stripped — "not your turn" replies now spam the
    channel publicly.
18. **Deathroll leaderboard can exceed the 4096-char embed limit** (`:2333-2416`, limit 0 =
    all players, no truncation) → API error 50035 on a big guild.
19. **Guess-who answer embedded in button customId** (`guesswho.ts:384`, trusted at `:443`) —
    inspectable cheating vector; keep the answer server-side keyed by message id. Also the
    double-guess TOCTOU at `:435-467` (guard set after an awaited DB write).
20. **Beatup vote race** (`beatup.ts:167-228`): read-modify-write on the votes array; use
    `$pull` + `$addToSet`. Vote expiry and cooldown also share one constant (`:77` vs comment).
21. **Label/behavior mismatches**: `mentions.ts:159` says "Last 30 days (default)" but default
    is server age (`:72-76`); same in `wordcloud.ts:136`; `guesswho.ts:92-93` reads a channel
    option that's never defined in the builder.
22. **Wordcloud memory blowup** (`wordcloud.ts:101-108`): entire multi-year message history
    `.toArray()` with no projection/limit. Aggregate server-side or project `content` only.
23. **Restart loses all active deathroll games** (`activeGames`/`activeCollectors` maps,
    `deathrollUtils.ts:70-72`): stale live buttons, unpersisted results, unapplied timeouts.
    Snapshot pending games to Mongo; reconcile on boot.

### Routes, jobs, infra

24. **Heatmap day-of-week off-by-one** (`GuildRoutes.ts:1900-1908` vs `:1169-1178`):
    `$dayOfWeek − 1` yields 0=Sunday but `DAYS[0]="Monday"` → `mostActiveDay` shifted.
25. **Not-ready guard throws instead of 503** (`GuildRoutes.ts:96-103`):
    `DiscordWrapper.getClient` throws when absent (`DiscordWrapper.ts:120`), so `client?.` never
    null-guards.
26. **LightsService `||` clobbers falsy values** (`LightsService.ts:58-70`): `fast` is always
    `true`; `brightness`/`saturation` `0` becomes `1`. Use `??`.
27. **PM2 config is stale** (`ecosystem.config.cjs:6,16`): points at nonexistent `lupos.js`;
    both apps bind the same port. Fix or delete (Docker is the real deploy).
28. **Job overlap**: `ActivityRoleAssignmentJob` (60 s interval, potentially >60 s of rate-limited
    fetches, `:104-120`) piles up; `setInterval` async callbacks unawaited
    (`BirthdayJob.ts:80`, `PermanentTimeOutJob.ts:52`, `ReactJob.ts:86`). Add an `isRunning`
    guard or move all jobs to a tiny shared scheduler (see R6).
29. **BirthdayJob drift**: "every 24 h from boot" — align to midnight (TZ already pinned).
30. **`MediaArchivalService.hashCache`** (`:90`) unbounded — use the existing `BoundedMap`.
    Same for `GuildRoutes._membersCache` (`:174`) and `_reactCooldowns` (`:628`).
31. **PresenceTracker counts events, not sessions** (`PresenceTracker.ts:50-56`): every status
    flip increments the game counter — stats are inflated garbage.
32. **CountdownIconJob** runs in _all_ modes (`DiscordService.ts:2863-2871`) → two PM2/Docker
    processes both write `images/countdown/` and both call `guild.setIcon`. Gate by mode. The
    fallback base icon is an expiring Discord CDN URL (`CountdownIconJob.ts:20-21`).
33. **StatService NaN poisoning** (`StatService.ts:63-67`): `setLevel(NaN)` sticks forever
    (Math.min/max propagate NaN). Validate input. Also `MoodService.ts:58` calls
    `DiscordUtilityService.generateMoodTemperature` which **does not exist** (hidden by a cast).

---

## P2 — Security & exposure

1. **Unauthenticated API on `0.0.0.0:1337` with credentialed reflected-origin CORS**
   (`lupos.ts:71-92`): `Access-Control-Allow-Origin: <any origin>` + `Allow-Credentials: true`
   defeats same-origin entirely, and mutating/expensive endpoints (`POST /guild/rescrape`
   `GuildRoutes.ts:457`, `/guild/backfill-media` `:521`, `/guild/react` `:630` — makes the bot
   react as itself) are open. **Fix:** shared-secret header middleware for POSTs, CORS
   allowlist from config, param validation (years/days/limit are un-validated parseInts in 4+
   places).
   ✅ **Done (2026-07, config-gated):** `src/middleware/corsAllowlist.ts` (set `ALLOWED_ORIGINS`,
   comma-separated — unset preserves legacy reflect-any with a startup warning) and
   `src/middleware/apiAuth.ts` (set `API_SHARED_SECRET` — mutating methods then require
   `x-api-key`; unset = no-op with warning). Param validation still open.
2. **Prompt injection surface**: nicknames, custom statuses, activity names, channel topics,
   guild description, emoji captions, and second-order per-user summaries are interpolated
   into the system-prompt block unfenced (`DiscordService.ts:347-390, :631-663, :1128-1136,
:527-533`; also `RandomTagJob.ts:165,185`). Message content is already fenced in
   `<message_content>` tags (`:2551-2553`) — fence these fields the same way.
3. **Destructive sweeps run unconditionally at boot** (`DiscordService.ts:2797-2800`):
   `luposOnReadyDeleteNewAccounts` (mass-kick) and `revokeRoleFromAllMembers` (bulk role strip
   on hardcoded guild/role `:2966-2967`) run on every `services` start. Put behind config flags.
   ✅ **Done (2026-07):** gated behind `ENABLE_BOOT_ACCOUNT_SWEEP` / `ENABLE_BOOT_ROLE_REVOKE`
   (must be the literal `"true"`; default OFF — deliberate fail-safe behavior change, skips logged).
4. **Secrets path**: `src/scripts/measure-performance.ts:8` reads an absolute-path secrets JSON
   outside the vault bootstrap.
   ✅ **Done (2026-07):** path overridable via `VAULT_SECRETS_PATH`, falls back to the old path.
5. **Config validation**: `src/config.ts` has zero required-var checking; missing
   `LUPOS_TOKEN`/`MONGO_URI`/`LUPOS_BOT_PORT` fail deep at use sites (`app.listen(NaN)`,
   `lupos.ts:92`). Add a fail-fast `validateConfig()`.
   ✅ **Done (2026-07):** `validateConfig()` in `src/config.ts`, called at the top of `lupos.ts` —
   requires `LUPOS_TOKEN`/`MONGO_URI`/`LUPOS_BOT_PORT` (must be numeric), notices for
   optional `MINIO_*`/`PRISM_SERVICE_URL`.

---

## R — Refactors into reusable components

Ordered so each step is mechanical and independently shippable. Run the full test suite after
each.

### R1. Kill the god objects (DiscordService 3,904 / DiscordUtilityService 3,187 lines)

Extract along existing seams (a `discord/` folder already exists from Phase 1):

- `discord/transformers/` — DiscordUtilityService `:29-982` is pure types + Mongo-document
  transformers; zero-risk move that halves the file.
- `discord/MessageArchive.ts` — scrape/backfill/save/sync (`:988-1959`).
- `discord/ChannelAnalytics.ts` — reports-mode console analytics (`:2583-3135`).
- `discord/ConversationExtractor.ts` — `extractContentFromMessages` + content formatters
  (DiscordService `:1932-2611, :3620-3705`).
- `discord/PromptBuilder.ts` — `generateDescription` + prompt-assembly half of
  `buildAndGenerateReply` (`:260-1509`).
- `discord/ImageRequestDetection.ts` — the regex heuristics (`:731-1013`); **export the
  regexes** so `tests/services/ImageDetection.test.ts` stops testing copy-pasted duplicates
  (its header admits they must be kept in sync by hand).
- `discord/MessageQueue.ts` — queue + gating + typing lifecycle, merged with `DiscordState`
  (fixes P0.1 structurally).
- `discord/RolePicker.ts`, `discord/ModerationSweeps.ts`, `discord/EventRouter.ts` — the rest.

### R2. Command framework (middleware pipeline)

One `Command` interface + a dispatcher that centralizes what all 11 commands copy-paste today:
auto-`deferReply`, guild-only guard, bot-permission check, a single cooldown store (currently
three mechanisms: in-memory `shock.ts:5-6`, Mongo `beatup.ts:120-165`, none), and one error
tail that logs + `editReply`s (fixes P1.11 and removes the 8 identical catch blocks). Add a
`customId`-prefix button-handler registry to replace the inline role-picker/YouTube branches
in `luposOnInteractionCreate` (`DiscordService.ts:3445-3553`).

### R3. Split `deathrollUtils.ts` (2,455 lines) into `deathroll/`

`mmr.ts` (pure math, `:158-331`), `repository.ts` (Mongo + aggregations, `:333-1031`),
`gameState.ts` (a real PENDING→ACTIVE→ENDED→DON state machine owning the maps — removes the
~250 duplicated lines of error-recovery re-posting), `render.ts` (messages/buttons/embeds),
`commands.ts`. Delete the duplicated `getMedal` (`:320-331` vs `commandUtils.ts:65`).

### R4. Shared helpers (each removes 3–6 copies)

- `getOrFetch(cacheGet, fetch)` — 6 cache-then-fetch variants.
- `sendEmbedToChannel(client, channelId, embeds)` — ≥5 fetch-cast-send sites.
- `renderHtmlToPng(html, opts)` — Playwright pipeline duplicated in heatmap/wordcloud; keep a
  long-lived browser and **vendor d3/d3-cloud locally** (both currently load from CDN at
  runtime — image gen has a hard external dependency, `heatmap.ts:476`, `wordcloud.ts:273`).
- `addTimePeriodOptions(builder)` + `resolvePeriod(interaction)` — the years/months/days
  triplet duplicated across 5 commands (also fixes the default-label mismatches).
- `buildLeaderboardEmbed({entries, formatLine, topN, bottomN})` — 3 implementations; natural
  home for the missing 4096-char truncation.
- `tryTimeoutMember(member, ms, reason)` — 6 slightly-different timeout flows; home for the
  28-day clamp (P1.16).
- `formatAbsoluteAndRelative(ts)` — the Luxon triplet repeated 5×.
- One message-pagination function (`fetchMessages` vs `fetchMessagesWithOptionalLastId`,
  `DiscordUtilityService.ts:450-497` vs `:2248-2358` — the former has divergent, buggier
  trimming).
- One Mongo message-upsert helper (the transform→archive→`$setOnInsert`/`$set` block is
  triplicated and already diverging: `:1145-1235`, `:1870-1916`, `:1917-1940`).
- `resolveGuild(req)` for routes (12 copies of the guildId-default expression) + a single
  Express error middleware; standardize on `getMongoDb()` instead of 6 dynamic imports.

### R5. Consolidate the three utility trees

`src/utils/` contains only `__tests__` for modules living in `src/utilities/` — move tests to
`tests/utilities/` (currently an empty dir), delete `src/utils/`. Split the 551-line
`src/utilities.ts` grab-bag into `src/utilities/{strings,discord-format,net,console}.ts`.
Delete pure pass-throughs (`capitalize`, `fetchWithTimeout`) in favor of direct library
imports. Merge `GuildRoutes.buildAvatarUrl` (`:108-119`) with `utilities.getDiscordAvatarUrl`
(`:452`). Delete the 0-byte `src/api/services/VendingService/routes/PostSessionEnd.ts`.

### R6. One tiny job scheduler

Replace the four hand-rolled patterns (bare `setInterval`, recursive `setTimeout`,
midnight-aligned, random-delay) with one `scheduleJob({name, cadence, jitter?, alignToMidnight?})`
that provides: overlap guard, try/catch + logging, handle retention for shutdown, and one
place where the timezone lives (currently pinned in three places).

### R7. Structured logging

Three parallel systems today: 501 raw `console.*` sites, 93 `LogFormatter` sites (777-line
formatter), 52 `utilities.consoleLog` sites (parses `new Error().stack` on every call).
Adopt pino behind a thin `logger.ts`; migrate by (1) re-pointing `consoleLog` internals,
(2) making `LogFormatter` emit structured objects, (3) codemodding raw calls. Levels via env.

### R8. Decide the trait-services question (biggest deletion opportunity)

**DECIDED 2026-07: option (a) shipped** — the 8 wrapper services + `SomaticAdaptationService`
and their tests were deleted; `src/services/TraitRegistry.ts` now feeds `GET /bot/stats`
(same response shape) from the same `StatService` configs; root `bot_stats.json` removed.

The somatic trait layer is **mostly dead code**: no production caller ever starts the decay
timers (`instantiate()` is never invoked from boot), `MoodService.generateMoodMessage`,
`AlcoholService.generateAlcoholSystemPrompt`, and `SomaticAdaptationService.adaptFromMessage`
have test-only callers, and persona/somatic state now lives server-side in Prism
(`DiscordService.ts:1470-1475`). The only live consumer is `GET /bot/stats`
(`GuildRoutes.ts:734-762`). Trait state is memory-only; every restart resets it. Two options:

- **(a) Shrink** (recommended): keep `StatService` + a config-driven registry feeding
  `/bot/stats`; delete the 8 wrapper files, dead tick loops, `generateMoodMessage` (calls a
  nonexistent method), and the orphaned root `bot_stats.json`.
- **(b) Revive**: build the generic `TraitEngine` (config: name/range/step/tick/threshold/
  describe) and actually wire `start()` into boot with handle retention. The full per-trait
  quirk table is in the audit notes; ~75-80 % of the 9 files is mechanically derivable config.
  Either way fix StatService NaN validation (P1.33).

### R9. Dead weight removal

Root `bot_stats.json` (0 bytes), `clocks_data.json`, `messages.json`, `chunks.json` are read
by nothing (data duplicated in `src/constants/`), yet `Dockerfile:74` copies two of them into
the image. `MessageService.assembleAssistantMessage` duplicates the persona now owned by Prism
(sole caller `RandomTagJob.ts:202` can switch to `generateAgentResponse`). Update the stale
sections of `docs/agentic_integration_plan.md` (JS line refs, "eliminated" per-user summaries
that still exist, `/chat`+`functionCallingEnabled` design that shipped differently).

---

## A — Agentic-harness-inspired improvements

The big migration (waterfall → single server-side agent loop) already shipped. What remains,
in order of leverage:

### A1. Finish tool-ification of the remaining client-side heuristics

Still hardcoded intent branching: image-request regex tiers + one residual LLM yes/no
classifier (`DiscordService.ts:731-1013`), fetch-count heuristic (`AIService.ts:640-696`,
stale LLM-era name), music `!play/!stop` prefix routing (`DiscordService.ts:3162-3169` →
`YouTubeService`), serial pre-call emoji reaction (`:1699-1709`). The TODO.md "CRAZY IDEAS"
list is literally a Discord tool catalog — register `play_music`, `react_with_emoji`,
`get_server_stats` (the `/bot/stats` endpoint already exists), `resolve_discord_user`/
`get_avatar` (replaces the avatar pre-guessing at `:1400-1449`) as Prism tools and delete the
heuristics as each tool proves out.

> **Shipped 2026-07-14 — image-context repair:** bot-message attachments are now captioned
> into the conversation (synthetic context turn + `[REPLYING TO]` block), the generate_image
> prompt is propagated into the posted attachment's filename/description, replies to bot
> images bind the replied-to image with its caption inline (labeled "THE IMAGE BEING
> DISCUSSED"), and the self-reference avatar tier is suppressed when replying to a bot image
> (fixes "make it bigger" latching onto a user's avatar).

### A2. Context compaction (Claude-Code-style)

Nothing exists: fixed 5–100 message window, no token counting anywhere, dossiers for every
participant injected wholesale. Add: keep last N raw messages; roll older history into a
stored per-channel summary (Mongo, keyed by channelId + last-message-id, refreshed
incrementally); budget dossiers (the per-user summaries at `:1932-1974` are a proto-compaction
already hash-cached — reuse them as the compact form instead of _additional_ context).
This directly attacks cost: today "draw everyone" adds ~10 dossiers + base64 avatars to an
already 8K+-token context with `maxTokens: 16384` + 10K thinking budget per reply.

### A3. Agent-curated memory

Memory today is extraction-only fire-and-forget (`/memory/extract` post-reply,
`DiscordService.ts:1864`). Expose `read_memory`/`append_memory` tools over the existing Prism
memory store so the agent reads and writes memory in-loop (the model this harness uses:
memory files consulted at recall time, updated deliberately, not scraped after the fact).

### A4. Structured outputs for the residual classifiers

Self-ref classifier string-matches `"yes"` (`DiscordService.ts:1000`); emoji-react
post-processes free text (`AIService.ts:619-636`); summaries substring-truncate (`:561`).
Use schema-constrained outputs; tighten `TransformedPrismResponse` typing
(`PrismService.ts:176-184` null-fallback soup).

### A5. Queue + streaming ergonomics

Move from one global serial queue to per-channel queues (a slow reply in one guild shouldn't
block all guilds) with a small global concurrency cap. Streaming (`stream=false` everywhere)
stays optional — the typing indicator is a fine substitute — but per-channel queuing plus the
P0.5 timeout are the availability fixes that matter.

### A6. Subagent-style background work

Precedent exists (fire-and-forget rescrape/backfill jobs with status polling,
`GuildRoutes.ts:463-511`). Candidates for a second cheap agent call instead of inflating the
main reply context: "deep lookup" requests over channel history, RandomTagJob persona work.

---

## T — Testing strategy

Suite today: 382 tests / 22 files, <1 s, all passing — but concentrated on trait services,
censoring, and message-context logic. Biggest uncovered surfaces, in value order:

1. **Deathroll** — zero tests despite being the most complex user-facing feature; the module
   already exports `_testHelpers` (MMR math, rank tiers, profiles, formatting) that nothing
   imports. → **Written as part of this plan.**
2. **`BoundedMap`** — the memory-safety primitive under other caches; untested TTL/eviction
   semantics. → **Written.**
3. **`commandUtils`** — shared time-period/medal/shuffle helpers about to gain more callers
   in R4. → **Written.**
4. **`sendMessageInChunks`** — the final hop of every reply (chunk boundaries, attachment on
   last chunk, media-only path). → **Written.**
5. Next wave (post-refactor, cheap once exported): image-detection regexes imported from
   source instead of copy-pasted; `GuildRoutes.formatMembersData` + a regression pin for the
   day-of-week fix; `MediaArchivalService.inferExtension`/`rewriteDocumentUrls`;
   `StatService` NaN guard (with the P1.33 fix); route-level supertest for the 503 guard,
   auth middleware, and param validation; deathroll `saveGameResult` atomicity against
   `mongodb-memory-server`.
6. Remove `--passWithNoTests` from `package.json` once trees are consolidated — it currently
   hides test-discovery breakage.

### Tooling breakage found while verifying

`pnpm lint` currently **crashes on every file** (`TypeError: Cannot read properties of
undefined (reading 'Cjs')` inside `@typescript-eslint/typescript-estree`): `package.json` pins
`typescript: "next"` (7.1.0-dev), which typescript-eslint 8.x cannot initialize against.
Pin TypeScript to a stable release (or add a `typescript-eslint` version that supports the dev
build) — until then the lint script is dead and CI-style checks silently rely on `tsc` alone.
Also note vitest 4 removed the `basic` reporter; any tooling/scripts passing
`--reporter=basic` will fail.

---

## Suggested sequencing

| Phase | Content                                                                                              | Risk                  |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| 1     | P0.1–P0.7 + safety-net tests (this PR)                                                               | Low — small, surgical |
| 2     | P1 one-liners (LightsService, ReactJob, day-of-week, deathroll `:1537`, ephemeral flags, `??` fixes) | Low                   |
| 3     | P2 security batch (auth middleware, CORS allowlist, config validation, boot-sweep flags)             | Low-medium            |
| 4     | R2 command framework + R4 shared helpers, migrating commands one at a time                           | Medium                |
| 5     | R1/R3 god-object and deathroll splits (mechanical moves, suite after each)                           | Medium                |
| 6     | R5–R9 consolidation + deletion (incl. trait-services decision)                                       | Low                   |
| 7     | A1–A6 agentic upgrades, one tool at a time behind config flags                                       | Medium                |
