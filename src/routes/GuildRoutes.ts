// ============================================================
// Lupos — Guild Data HTTP Routes
// ============================================================
// Exposes live Discord guild data (channels, members) via REST
// endpoints. Uses the Discord.js client's cache for real-time
// presence and member information.
// ============================================================

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "@rodrigo-barraza/utilities-library/express";
import { ChannelType } from "discord.js";
import type {
  GuildMember,
  GuildChannel,
  TextChannel,
  Role,
  User,
  Presence,
  Activity,
  MessageReaction,
  } from "discord.js";
import type { WithId, Document } from "mongodb";
import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import config from "#root/config.js";
import MoodService from "#root/services/MoodService.js";
import HungerService from "#root/services/HungerService.js";
import ThirstService from "#root/services/ThirstService.js";
import EnergyService from "#root/services/EnergyService.js";
import SicknessService from "#root/services/SicknessService.js";
import AlcoholService from "#root/services/AlcoholService.js";
import BathroomService from "#root/services/BathroomService.js";
import SubstanceService from "#root/services/SubstanceService.js";
import { MOODS } from "#root/constants.js";
import type { MoodEntry } from "#root/types/index.js";

const router = Router();

/** Job status tracking interface. */
interface JobStatus {
  id: string;
  type: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  result: unknown;
  error: string | null;
  [key: string]: unknown;
}

/** Member data for the /guild/members endpoint. */
interface MemberData {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  status: string;
  activity: string | null;
  isBot: boolean;
  roleColor: string | null;
  roleColors?: { primary: string; secondary: string | null; tertiary: string | null };
  badges?: string[];
  roleTags?: { name: string; color: string | null; iconUrl: string | null }[];
}

/** Role group for the /guild/members endpoint. */
interface RoleGroup {
  id: string;
  name: string;
  color: string | null;
  position: number;
  members: MemberData[];
}

/**
 * Middleware: reject requests if the Discord client isn't ready yet.
 * Prevents 500s from empty guild cache during the login→ready window.
 */
router.use((req: Request, res: Response, next: NextFunction) => {
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
function buildAvatarUrl(user: User, member: GuildMember) {
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

router.get("/guild/channels", (req: Request, res: Response) => {
  try {
    const guildId = (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const channels = guild.channels.cache
      .filter((ch) => ch.type === ChannelType.GuildText)
      .sort((a, b) => (a as GuildChannel).position - (b as GuildChannel).position)
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        topic: "topic" in ch ? (ch as TextChannel).topic || null : null,
        parentId: ch.parentId || null,
        parentName: ch.parent?.name || null,
        position: (ch as GuildChannel).position,
      }));

    res.json({
      guildId,
      guildName: guild.name,
      guildIcon: guild.iconURL({ extension: "png", size: 128 }),
      guildBanner: guild.bannerURL({ extension: "png", size: 480 }),
      guildSplash: guild.splashURL({ extension: "png", size: 480 }),
      channels,
    });
  } catch (error: unknown) {
    console.error("[guild/channels] Error:", (error as Error).message);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// ─── GET /guild/members ─────────────────────────────────────────
// Returns online/idle/dnd members for a guild, grouped by role.
// Optimizations:
// 1. Employs a Stale-While-Revalidate (SWR) pattern via an in-memory cache to return cached state immediately (0ms response).
// 2. Performs background cache refresh asynchronously so the HTTP request-response cycle is never blocked.
// 3. Avoids expensive guild.members.fetch gateway calls if the Discord.js internal cache is already populated.
// Query: ?guildId=...

interface CachedMembers {
  data: any;
  timestamp: number;
}

const _membersCache = new Map<string, CachedMembers>();
const MEMBERS_CACHE_TTL_MS = 60 * 1000; // Cache duration: 1 minute

/**
 * Transforms, groups, and formats raw guild members data into hoist roles & flat sections.
 * Optimized to be a pure, high-performance CPU-bound operation.
 */
function formatMembersData(guild: any): any {
  // ── Helper: pick a display-worthy activity from presence ─────
  function pickActivity(presence: Presence | null | undefined): string | null {
    if (!presence?.activities?.length) return null;
    const realActivity = presence.activities.find((a: Activity) => a.type !== 4);
    if (realActivity) return realActivity.name;
    const customStatus = presence.activities.find((a: Activity) => a.type === 4);
    return customStatus?.state || null;
  }

  // Collect online members (online, idle, dnd — not offline).
  const onlineMembers = guild.members.cache.filter(
    (m: GuildMember) =>
      m.presence &&
      m.presence.status &&
      m.presence.status !== "offline",
  );

  // Bots without presence are treated as online sidebar elements per Discord behavior
  const offlineBots = guild.members.cache.filter(
    (m: GuildMember) => m.user.bot && (!m.presence || m.presence.status === "offline"),
  );

  const roleMap = new Map<string, RoleGroup>();
  const ungrouped: MemberData[] = [];
  const ungroupedBots: MemberData[] = [];

  const allVisible = new Map<string, GuildMember>([...onlineMembers, ...offlineBots]);

  for (const [, member] of allVisible) {
    try {
      let sortedRoles: Role[] = [];
      try {
        sortedRoles = [...member.roles.cache
          .filter((r: Role) => r.id !== guild.id) // Exclude @everyone
          .sort((a: Role, b: Role) => b.position - a.position)
          .values()];
      } catch { /* roles cache unavailable */ }

      const hoistedRole = sortedRoles.find((r: Role) => r.hoist);

      let roleColors: { primary: string; secondary: string | null; tertiary: string | null } | null = null;
      try {
        const colorRole = member.roles.color;
        if (colorRole?.colors) {
          const { primaryColor, secondaryColor, tertiaryColor } = colorRole.colors;
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
      } catch { /* role colors unavailable */ }

      const badges: string[] = [];
      try {
        const userFlags = member.user.flags?.bitfield;
        if (userFlags) {
          const BADGE_MAP: [number, string][] = [
            [1,       "staff"],
            [2,       "partner"],
            [4,       "hypesquad"],
            [8,       "bug_hunter_1"],
            [64,      "hypesquad_bravery"],
            [128,     "hypesquad_brilliance"],
            [256,     "hypesquad_balance"],
            [512,     "early_supporter"],
            [16384,   "bug_hunter_2"],
            [65536,   "verified_bot"],
            [131072,  "verified_developer"],
            [262144,  "certified_moderator"],
            [4194304, "active_developer"],
          ];
          for (const [bit, id] of BADGE_MAP) {
            if ((userFlags & bit) === bit) badges.push(id);
          }
        }
      } catch { /* user flags unavailable */ }

      let roleTags: { name: string; color: string | null; iconUrl: string | null }[] = [];
      try {
        roleTags = sortedRoles.slice(0, 3).map((r: Role) => ({
          name: r.name,
          color: r.hexColor && r.hexColor !== "#000000" ? r.hexColor : null,
          iconUrl: r.iconURL?.() || null,
        }));
      } catch { /* role tags unavailable */ }

      const memberData: MemberData = {
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        avatarUrl: buildAvatarUrl(member.user, member),
        status: member.presence?.status || "online",
        activity: pickActivity(member.presence),
        isBot: member.user.bot,
        roleColor: member.displayHexColor !== "#000000" ? member.displayHexColor : null,
        ...(roleColors?.secondary && { roleColors }),
        ...(badges.length > 0 && { badges }),
        ...(roleTags.length > 0 && { roleTags }),
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
        roleMap.get(hoistedRole.id)!.members.push(memberData);
      } else if (member.user.bot) {
        ungroupedBots.push(memberData);
      } else {
        ungrouped.push(memberData);
      }
    } catch (memberErr: unknown) {
      console.warn(`[guild/members] Skipping member ${member?.id}: ${(memberErr as Error).message}`);
    }
  }

  const roles: RoleGroup[] = Array.from(roleMap.values())
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

  const bots = ungroupedBots.sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return {
    guildId: guild.id,
    guildName: guild.name,
    totalOnline: onlineMembers.size + offlineBots.size,
    totalMembers: guild.memberCount,
    roles,
    bots,
  };
}

/**
 * Re-scrapes/fetches members from Discord gateway only if cache is sparse or unpopulated,
 * compiles the formatted result, and updates the in-memory SWR cache.
 */
async function refreshMembersCache(guildId: string): Promise<any> {
  const client = DiscordWrapper.getClient("lupos");
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  try {
    // Only invoke heavy fetch call if local cache is dry or extremely small to avoid gateway overload
    if (guild.members.cache.size < 100) {
      console.log(`[members-cache] Cache is small (${guild.members.cache.size}). Syncing from Discord API...`);
      await guild.members.fetch({ withPresences: true });
    }
  } catch (fetchErr: unknown) {
    console.warn(
      `[members-cache] guild.members.fetch failed: ${(fetchErr as Error).message}`,
    );
  }

  const data = formatMembersData(guild);
  _membersCache.set(guildId, {
    data,
    timestamp: Date.now(),
  });
  return data;
}

router.get("/guild/members", asyncHandler(async (req: Request, res: Response) => {
  try {
    const guildId = (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const now = Date.now();
    const cached = _membersCache.get(guildId);

    // Return immediately if cache is fresh (under 1 min)
    if (cached && now - cached.timestamp < MEMBERS_CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    // If cache is stale, trigger asynchronous background refresh (SWR) and return stale immediately (0ms latency)
    if (cached) {
      refreshMembersCache(guildId).catch((err) =>
        console.error(`[guild/members] Background cache refresh failed: ${err.message}`)
      );
      return res.json(cached.data);
    }

    // No cache exists yet (cold start). Fetch and generate synchronously to seed cache
    console.log(`[guild/members] Cold start for ${guildId}. Seeding cache synchronously...`);
    const data = await refreshMembersCache(guildId);
    return res.json(data);
  } catch (error: unknown) {
    console.error("[guild/members] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to fetch members", detail: (error as Error).message });
  }
}));

// ─── Background Job Status Tracker ──────────────────────────────
// Lightweight in-memory map for tracking async job progress.
// Jobs auto-expire after 1 hour to prevent memory leaks.
const _jobStatus = new Map<string, JobStatus>();
let _jobIdCounter = 0;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

function createJob(type: string, meta: Record<string, unknown> = {}): JobStatus {
  const id = `${type}-${++_jobIdCounter}`;
  const job: JobStatus = {
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

function completeJob(id: string, result: unknown) {
  const job = _jobStatus.get(id);
  if (job) {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = result;
  }
}

function failJob(id: string, error: string) {
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
// Body: { guildId?, channelIds: ["..."], dateLimit?, forceUpdate? }

router.post("/guild/rescrape", asyncHandler(async (req: Request, res: Response) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW || "";
    const { channelIds, dateLimit = "2025-01-01", forceUpdate = false } = req.body;

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "channelIds array is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.js")).default;
    const localMongo = MongoService.getClient("local");
    if (!localMongo) {
      return res.status(500).json({ error: "Database not initialized" });
    }

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
    ).then((result: unknown) => {
      completeJob(job.id, result);
      console.log(`[guild/rescrape] Completed rescrape of ${channelIds.length} channel(s)`);
    }).catch((error: Error) => {
      failJob(job.id, error.message);
      console.error("[guild/rescrape] Error:", error.message);
    });
  } catch (error: unknown) {
    console.error("[guild/rescrape] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to start rescrape", detail: (error as Error).message });
  }
}));

// ─── GET /guild/rescrape/status ─────────────────────────────────
router.get("/guild/rescrape/status", (req: Request, res: Response) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all rescrape jobs
    const jobs = [..._jobStatus.values()].filter((j: JobStatus) => j.type === "rescrape");
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId as string);
  if (!job) return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── POST /guild/backfill-media ─────────────────────────────────
// Triggers media archival backfill for messages with expired Discord
// CDN URLs. Downloads fresh media from Discord and stores permanently
// in MinIO, then updates MongoDB documents with the MinIO URLs.
// Body: { guildId?, channelId?, forceRetry? }

router.post("/guild/backfill-media", asyncHandler(async (req: Request, res: Response) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_PRIMARY || "";
    const { channelId, forceRetry = false } = req.body;

    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.js")).default;
    const localMongo = MongoService.getClient("local");
    if (!localMongo) {
      return res.status(500).json({ error: "Database not initialized" });
    }

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
    }).then((result: { processed: number; archived: number; errors: number }) => {
      completeJob(job.id, result);
      console.log(`[guild/backfill-media] Completed — processed: ${result.processed}, archived: ${result.archived}, errors: ${result.errors}`);
    }).catch((error: Error) => {
      failJob(job.id, error.message);
      console.error("[guild/backfill-media] Error:", error.message);
    });
  } catch (error: unknown) {
    console.error("[guild/backfill-media] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to start media backfill", detail: (error as Error).message });
  }
}));

// ─── GET /guild/backfill-media/status ───────────────────────────
router.get("/guild/backfill-media/status", (req: Request, res: Response) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all backfill-media jobs
    const jobs = [..._jobStatus.values()].filter((j: JobStatus) => j.type === "backfill-media");
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId as string);
  if (!job) return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── GET /guild/emojis ──────────────────────────────────────────
// Returns all custom emojis for a guild (for the emoji picker).
// Query: ?guildId=...

router.get("/guild/emojis", (req: Request, res: Response) => {
  try {
    const guildId = (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const emojis: { id: string; name: string | null; animated: boolean; url: string }[] = [];
    for (const [, emoji] of guild.emojis.cache) {
      if (!emoji.id) continue;
      try {
        emojis.push({
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated || false,
          url: emoji.imageURL({ extension: emoji.animated ? "gif" : "webp", size: 48 }),
        });
      } catch (emojiErr: unknown) {
        console.warn(`[guild/emojis] Skipping emoji ${emoji.id} (${emoji.name}): ${(emojiErr as Error).message}`);
      }
    }

    res.json({
      guildId,
      guildName: guild.name,
      emojis,
    });
  } catch (error: unknown) {
    console.error("[guild/emojis] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to fetch emojis", detail: (error as Error).message });
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

const _reactCooldowns = new Map<string, number>(); // guildId → last timestamp

router.post("/guild/react", asyncHandler(async (req: Request, res: Response) => {
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

    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
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
    const botId = client.user!.id;
    const existingReaction = message.reactions.cache.find((r: MessageReaction) => {
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
      if (!localMongo) throw new Error("MongoService: local client not initialized");
      const db = localMongo.db("lupos");
      const col = db.collection("Messages");

      const transformedReactions = freshMessage.reactions.cache.map((r: MessageReaction) => ({
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
    } catch (syncErr: unknown) {
      // Non-critical — the reaction was added on Discord, MongoDB sync can lag
      console.warn("[guild/react] MongoDB sync failed:", (syncErr as Error).message);
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error("[guild/react] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to react", detail: (error as Error).message });
  }
}));

// ─── GET /bot/stats ─────────────────────────────────────────────
// Returns live bot somatic status, database counts, and active server stats
router.get("/bot/stats", asyncHandler(async (req: Request, res: Response) => {
  try {
    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const localMongo = MongoService.getClient("local");
    const db = localMongo ? localMongo.db("lupos") : null;

    // 1. Somatic Status
    const moodLevel = MoodService.getMoodLevel();
    const currentMood = MOODS.find((m: MoodEntry) => m.level === moodLevel) || {
      name: "Unknown",
      emoji: "😐",
    };

    const somatic = {
      mood: {
        level: moodLevel,
        name: currentMood.name,
        emoji: currentMood.emoji,
      },
      hunger: HungerService.getHungerLevel(),
      thirst: ThirstService.getThirstLevel(),
      energy: EnergyService.getEnergyLevel(),
      sickness: SicknessService.getSicknessLevel(),
      alcohol: AlcoholService.getAlcoholLevel(),
      bathroom: BathroomService.getBathroomLevel(),
      substance: SubstanceService.getSubstanceLevel(),
    };

    // 2. Database Stats
    let database = {
      totalMessages: 0,
      totalUniqueUsers: 0,
      totalTranscriptions: 0,
      totalArchivedMedia: 0,
    };

    if (db) {
      try {
        const primaryGuildId = config.GUILD_ID_CLOCK_CREW || config.GUILD_ID_PRIMARY || "";
        const primaryGuild = client?.guilds?.cache?.get(primaryGuildId);
        const memberCount = primaryGuild ? primaryGuild.memberCount : 0;

        const [msgCount, transcriberCount, mediaCount] = await Promise.all([
          db.collection("Messages").estimatedDocumentCount().catch(() => 0),
          db.collection("AudioTranscriptions").estimatedDocumentCount().catch(() => 0),
          db.collection("MediaMetadata").estimatedDocumentCount().catch(() => 0),
        ]);

        database = {
          totalMessages: msgCount,
          totalUniqueUsers: memberCount,
          totalTranscriptions: transcriberCount,
          totalArchivedMedia: mediaCount,
        };
      } catch (dbErr: unknown) {
        console.warn("[bot/stats] Failed to fetch database metrics:", (dbErr as Error).message);
      }
    }

    // 3. Game Activity
    let topGames: WithId<Document>[] = [];
    if (db) {
      try {
        topGames = await db
          .collection("GameActivity")
          .find({})
          .sort({ count: -1 })
          .limit(5)
          .toArray();
      } catch (gameErr: unknown) {
        console.warn("[bot/stats] Failed to fetch game activity:", (gameErr as Error).message);
      }
    }

    // 4. Active Streamers
    let activeStreamers: WithId<Document>[] = [];
    if (db) {
      try {
        activeStreamers = await db
          .collection("ActiveStreamers")
          .find({ isStreaming: true })
          .toArray();
      } catch (streamErr: unknown) {
        console.warn("[bot/stats] Failed to fetch active streamers:", (streamErr as Error).message);
      }
    }

    // 5. Discord connection info
    const discordInfo = {
      isReady: client?.isReady() || false,
      guildsCount: client?.guilds?.cache?.size || 0,
      username: client?.user?.username || null,
      avatarUrl: client?.user?.displayAvatarURL() || null,
      uptime: client?.uptime || 0,
    };

    res.json({
      somatic,
      database,
      topGames,
      activeStreamers,
      discordInfo,
    });
  } catch (error: unknown) {
    console.error("[bot/stats] Error:", (error as Error).message, (error as Error).stack);
    res.status(500).json({ error: "Failed to fetch bot stats", detail: (error as Error).message });
  }
}));

export default router;
