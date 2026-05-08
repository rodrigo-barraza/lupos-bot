// ============================================================
// Lupos — Guild Data HTTP Routes
// ============================================================
// Exposes live Discord guild data (channels, members) via REST
// endpoints. Uses the Discord.js client's cache for real-time
// presence and member information.
// ============================================================

import { Router } from "express";
import { ChannelType } from "discord.js";
import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import config from "#root/config.js";

const router = Router();

/**
 * Middleware: reject requests if the Discord client isn't ready yet.
 * Prevents 500s from empty guild cache during the login→ready window.
 */
router.use((req, res, next) => {
  const client = DiscordWrapper.getClient("lupos");
  if (!client?.isReady()) {
    res.set("Retry-After", "5");
    return res.status(503).json({ error: "Discord client is not ready yet" });
  }
  next();
});

/**
 * Build a Discord CDN avatar URL from a User or GuildMember.
 */
function buildAvatarUrl(user, member) {
  // Guild-specific avatar takes precedence
  if (member?.avatar && user?.id) {
    const ext = member.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/guilds/${member.guild.id}/users/${user.id}/avatars/${member.avatar}.${ext}?size=128`;
  }
  if (user?.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  return user?.defaultAvatarURL || null;
}

// ─── GET /guild/channels ────────────────────────────────────────
// Returns text channels for a guild, sorted by position.
// Query: ?guildId=...

router.get("/guild/channels", (req, res) => {
  try {
    const guildId = req.query.guildId || config.GUILD_ID_CLOCK_CREW;
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const channels = guild.channels.cache
      .filter((ch) => ch.type === ChannelType.GuildText)
      .sort((a, b) => a.position - b.position)
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        topic: ch.topic || null,
        parentId: ch.parentId || null,
        parentName: ch.parent?.name || null,
        position: ch.position,
      }));

    res.json({
      guildId,
      guildName: guild.name,
      guildIcon: guild.iconURL({ extension: "png", size: 128 }),
      guildBanner: guild.bannerURL({ extension: "png", size: 480 }),
      guildSplash: guild.splashURL({ extension: "png", size: 480 }),
      channels,
    });
  } catch (error) {
    console.error("[guild/channels] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// ─── GET /guild/members ─────────────────────────────────────────
// Returns online/idle/dnd members for a guild, grouped by role.
// Query: ?guildId=...

router.get("/guild/members", async (req, res) => {
  try {
    const guildId = req.query.guildId || config.GUILD_ID_CLOCK_CREW;
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    // Fetch all members to populate presences (cache may be incomplete).
    // Gracefully fall back to cache if the fetch fails (rate-limit, timeout, etc.)
    try {
      await guild.members.fetch({ withPresences: true });
    } catch (fetchErr) {
      console.warn(
        `[guild/members] guild.members.fetch failed, falling back to cache: ${fetchErr.message}`,
      );
    }

    // ── Helper: pick a display-worthy activity from presence ─────
    // Discord ActivityType.Custom (4) has name="Custom Status" but the
    // real user text lives in .state. We prefer game/streaming/listening
    // activities, falling back to the custom status text if nothing else.
    function pickActivity(presence) {
      if (!presence?.activities?.length) return null;
      // Prefer non-custom-status activities (games, streaming, Spotify, etc.)
      const realActivity = presence.activities.find((a) => a.type !== 4);
      if (realActivity) return realActivity.name;
      // Fall back to custom status .state (the user-entered text)
      const customStatus = presence.activities.find((a) => a.type === 4);
      return customStatus?.state || null;
    }

    // Collect online members (online, idle, dnd — not offline).
    // Bots are included here so those with hoisted roles appear under
    // their role group (e.g. "Good Boy") — matching Discord's behavior.
    const onlineMembers = guild.members.cache.filter(
      (m) =>
        m.presence &&
        m.presence.status &&
        m.presence.status !== "offline",
    );

    // Bots without presence are still "online" — Discord doesn't track
    // their presence reliably, so we treat any cached bot as online.
    const offlineBots = guild.members.cache.filter(
      (m) => m.user.bot && (!m.presence || m.presence.status === "offline"),
    );

    // Build role hierarchy for grouping.
    // Only hoisted roles (role.hoist === true) appear as sidebar
    // category headers — mirrors Discord's own member list behavior.
    const roleMap = new Map();
    const ungrouped = [];
    const ungroupedBots = []; // bots with no hoisted role

    // Process both online members and offline bots together
    const allVisible = new Map([...onlineMembers, ...offlineBots]);

    for (const [, member] of allVisible) {
      // Get all non-@everyone roles sorted highest first
      const sortedRoles = member.roles.cache
        .filter((r) => r.id !== guild.id) // Exclude @everyone
        .sort((a, b) => b.position - a.position);

      // Find the highest hoisted role for sidebar grouping
      const hoistedRole = sortedRoles.find((r) => r.hoist);

      // ── Build role colors (gradient/holographic support) ───────
      // member.roles.color is the highest role with a non-zero color.
      // Its .colors object contains { primaryColor, secondaryColor, tertiaryColor }
      // from Discord's Enhanced Role Styles (ENHANCED_ROLE_COLORS guild feature).
      const colorRole = member.roles.color;
      let roleColors = null;
      if (colorRole?.colors) {
        const { primaryColor, secondaryColor, tertiaryColor } = colorRole.colors;
        // Only include if there's a non-zero primary color
        if (primaryColor) {
          roleColors = {
            primary: `#${primaryColor.toString(16).padStart(6, "0")}`,
            secondary: secondaryColor
              ? `#${secondaryColor.toString(16).padStart(6, "0")}`
              : null,
            tertiary: tertiaryColor
              ? `#${tertiaryColor.toString(16).padStart(6, "0")}`
              : null,
          };
        }
      }

      const memberData = {
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        avatarUrl: buildAvatarUrl(member.user, member),
        status: member.presence?.status || "online",
        activity: pickActivity(member.presence),
        isBot: member.user.bot,
        roleColor: member.displayHexColor !== "#000000" ? member.displayHexColor : null,
        // Enhanced Role Styles — gradient (secondary) / holographic (tertiary)
        ...(roleColors?.secondary && { roleColors }),
      };

      if (hoistedRole) {
        if (!roleMap.has(hoistedRole.id)) {
          roleMap.set(hoistedRole.id, {
            id: hoistedRole.id,
            name: hoistedRole.name,
            color: hoistedRole.hexColor !== "#000000" ? hoistedRole.hexColor : null,
            position: hoistedRole.position,
            members: [],
          });
        }
        roleMap.get(hoistedRole.id).members.push(memberData);
      } else if (member.user.bot) {
        ungroupedBots.push(memberData);
      } else {
        ungrouped.push(memberData);
      }
    }

    // Sort roles by position (highest first), members alphabetically
    const roles = Array.from(roleMap.values())
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        ...role,
        members: role.members.sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        ),
      }));

    if (ungrouped.length > 0) {
      roles.push({
        id: "online",
        name: "Online",
        color: null,
        position: -1,
        members: ungrouped.sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        ),
      });
    }

    // Bots without a hoisted role go into the flat "Bots" section
    const bots = ungroupedBots.sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );

    res.json({
      guildId,
      guildName: guild.name,
      totalOnline: onlineMembers.size + offlineBots.size,
      totalMembers: guild.memberCount,
      roles,
      bots,
    });
  } catch (error) {
    console.error("[guild/members] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch members", detail: error.message });
  }
});

// ─── Background Job Status Tracker ──────────────────────────────
// Lightweight in-memory map for tracking async job progress.
// Jobs auto-expire after 1 hour to prevent memory leaks.
const _jobStatus = new Map();
let _jobIdCounter = 0;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

function createJob(type, meta = {}) {
  const id = `${type}-${++_jobIdCounter}`;
  const job = {
    id,
    type,
    status: "running",
    startedAt: new Date().toISOString(),
    ...meta,
    result: null,
    error: null,
  };
  _jobStatus.set(id, job);
  // Auto-expire
  setTimeout(() => _jobStatus.delete(id), JOB_TTL_MS);
  return job;
}

function completeJob(id, result) {
  const job = _jobStatus.get(id);
  if (job) {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = result;
  }
}

function failJob(id, error) {
  const job = _jobStatus.get(id);
  if (job) {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = error;
  }
}

// ─── POST /guild/rescrape ───────────────────────────────────────
// Triggers a targeted rescrape of specific channels to refresh
// embed data and other message fields in MongoDB.
// Body: { guildId?, channelIds: [\"...\"], dateLimit?, forceUpdate? }

router.post("/guild/rescrape", async (req, res) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW;
    const { channelIds, dateLimit = "2025-01-01", forceUpdate = false } = req.body;

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "channelIds array is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.js")).default;
    const localMongo = MongoService.getClient("local");

    const job = createJob("rescrape", { guildId, channelIds, dateLimit, forceUpdate });

    // Respond immediately with job ID for status polling
    res.json({
      ...job,
      message: `Rescraping ${channelIds.length} channel(s) in the background${forceUpdate ? " (force update)" : ""}`,
      statusUrl: `/guild/rescrape/status?jobId=${job.id}`,
    });

    // Fire and forget
    DiscordUtilityService.fetchAndSaveAllServerMessages(
      client,
      localMongo,
      guildId,
      { channelIds, dateLimit, autoResume: false, forceUpdate },
    ).then((result) => {
      completeJob(job.id, result);
      console.log(`[guild/rescrape] Completed rescrape of ${channelIds.length} channel(s)`);
    }).catch((err) => {
      failJob(job.id, err.message);
      console.error("[guild/rescrape] Error:", err.message);
    });
  } catch (error) {
    console.error("[guild/rescrape] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to start rescrape", detail: error.message });
  }
});

// ─── GET /guild/rescrape/status ─────────────────────────────────
router.get("/guild/rescrape/status", (req, res) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all rescrape jobs
    const jobs = [..._jobStatus.values()].filter((j) => j.type === "rescrape");
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId);
  if (!job) return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── POST /guild/backfill-media ─────────────────────────────────
// Triggers media archival backfill for messages with expired Discord
// CDN URLs. Downloads fresh media from Discord and stores permanently
// in MinIO, then updates MongoDB documents with the MinIO URLs.
// Body: { guildId?, channelId?, forceRetry? }

router.post("/guild/backfill-media", async (req, res) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_PRIMARY;
    const { channelId, forceRetry = false } = req.body;

    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.js")).default;
    const localMongo = MongoService.getClient("local");

    const job = createJob("backfill-media", {
      guildId,
      channelId: channelId || "all",
      forceRetry,
    });

    // Respond immediately with job ID for status polling
    res.json({
      ...job,
      message: `Media backfill started${channelId ? ` for channel ${channelId}` : ""} (forceRetry: ${forceRetry})`,
      statusUrl: `/guild/backfill-media/status?jobId=${job.id}`,
    });

    // Fire and forget
    DiscordUtilityService.backfillMediaArchive(client, localMongo, {
      guildId,
      channelId: channelId || undefined,
      forceRetry,
    }).then((result) => {
      completeJob(job.id, result);
      console.log(`[guild/backfill-media] Completed — processed: ${result.processed}, archived: ${result.archived}, errors: ${result.errors}`);
    }).catch((err) => {
      failJob(job.id, err.message);
      console.error("[guild/backfill-media] Error:", err.message);
    });
  } catch (error) {
    console.error("[guild/backfill-media] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to start media backfill", detail: error.message });
  }
});

// ─── GET /guild/backfill-media/status ───────────────────────────
router.get("/guild/backfill-media/status", (req, res) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all backfill-media jobs
    const jobs = [..._jobStatus.values()].filter((j) => j.type === "backfill-media");
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId);
  if (!job) return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── GET /guild/emojis ──────────────────────────────────────────
// Returns all custom emojis for a guild (for the emoji picker).
// Query: ?guildId=...

router.get("/guild/emojis", (req, res) => {
  try {
    const guildId = req.query.guildId || config.GUILD_ID_CLOCK_CREW;
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const emojis = guild.emojis.cache.map((emoji) => ({
      id: emoji.id,
      name: emoji.name,
      animated: emoji.animated || false,
      url: emoji.imageURL({ extension: emoji.animated ? "gif" : "webp", size: 48 }),
    }));

    res.json({
      guildId,
      guildName: guild.name,
      emojis,
    });
  } catch (error) {
    console.error("[guild/emojis] Error:", error.message);
    res.status(500).json({ error: "Failed to fetch emojis" });
  }
});

// ─── POST /guild/react ──────────────────────────────────────────
// Adds an emoji reaction to a message via the Lupos bot account.
// Body: { guildId?, channelId, messageId, emoji }
// emoji is either a Unicode string ("👍") or "name:id" for custom.
//
// Returns:
//   200 { success: true }
//   409 { alreadyReacted: true }
//   429 { error: "Rate limited" }

const _reactCooldowns = new Map(); // guildId → last timestamp

router.post("/guild/react", async (req, res) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW;
    const { channelId, messageId, emoji } = req.body;

    if (!channelId || !messageId || !emoji) {
      return res.status(400).json({ error: "channelId, messageId, and emoji are required" });
    }

    // ── Rate limit: 1 reaction per 2s per guild ─────────────────
    const now = Date.now();
    const lastReact = _reactCooldowns.get(guildId) || 0;
    if (now - lastReact < 2000) {
      return res.status(429).json({ error: "Rate limited", retryAfterMs: 2000 - (now - lastReact) });
    }
    _reactCooldowns.set(guildId, now);

    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Fetch the message
    let message;
    try {
      message = await channel.messages.fetch(messageId);
    } catch {
      return res.status(404).json({ error: "Message not found" });
    }

    // ── Resolve the emoji identifier ────────────────────────────
    // Custom emoji comes as "name:id" → we need to check if the
    // bot already reacted with it, then call message.react().
    const isCustom = /^\w+:\d+$/.test(emoji);
    const reactionIdentifier = isCustom ? emoji : emoji;

    // ── Check if bot already reacted with this emoji ────────────
    const botId = client.user.id;
    const existingReaction = message.reactions.cache.find((r) => {
      if (isCustom) {
        return r.emoji.id === emoji.split(":")[1];
      }
      return r.emoji.name === emoji && !r.emoji.id;
    });

    if (existingReaction) {
      const users = await existingReaction.users.fetch();
      if (users.has(botId)) {
        return res.status(409).json({ alreadyReacted: true });
      }
    }

    // ── React ───────────────────────────────────────────────────
    await message.react(reactionIdentifier);

    // ── Sync reactions to MongoDB ───────────────────────────────
    // Re-fetch the message to get the updated reaction cache,
    // then write the fresh reaction data to the stored document.
    // This keeps the SSE stream (which reads from MongoDB) in sync.
    try {
      const freshMessage = await channel.messages.fetch(messageId);
      const MongoService = (await import("#root/services/MongoService.js")).default;
      const localMongo = MongoService.getClient("local");
      const db = localMongo.db("lupos");
      const col = db.collection("Messages");

      const transformedReactions = freshMessage.reactions.cache.map((r) => ({
        count: r.count,
        countDetails: {
          burst: r.countDetails?.burst || 0,
          normal: r.countDetails?.normal || 0,
        },
        emoji: {
          animated: r.emoji.animated || false,
          id: r.emoji.id || null,
          name: r.emoji.name || null,
        },
      }));

      await col.updateOne(
        { id: messageId },
        { $set: { reactions: transformedReactions } },
      );
    } catch (syncErr) {
      // Non-critical — the reaction was added on Discord, MongoDB sync can lag
      console.warn("[guild/react] MongoDB sync failed:", syncErr.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[guild/react] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to react", detail: error.message });
  }
});

export default router;
