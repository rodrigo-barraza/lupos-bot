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
  Guild,
} from "discord.js";

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
import { MOODS, EXCLUDE_SOFT_DELETED } from "#root/constants.js";
import type { MoodEntry } from "#root/types/index.js";
import {
  getMongoDb,
  getServerAgeYears,
  computeStartDate,
  formatTimePeriod,
} from "#root/commands/utility/commandUtils.js";

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
  roleColors?: {
    primary: string;
    secondary: string | null;
    tertiary: string | null;
  };
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

/** Hoisted and flat sections for transformed guild members. */
interface TransformedGuildMembers {
  guildId: string;
  guildName: string;
  totalOnline: number;
  totalMembers: number;
  roles: RoleGroup[];
  bots: MemberData[];
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
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const channels = guild.channels.cache
      .filter((ch) => ch.type === ChannelType.GuildText)
      .sort(
        (a, b) => (a as GuildChannel).position - (b as GuildChannel).position,
      )
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
  data: TransformedGuildMembers;
  timestamp: number;
}

const _membersCache = new Map<string, CachedMembers>();
const MEMBERS_CACHE_TTL_MS = 60 * 1000; // Cache duration: 1 minute

/**
 * Transforms, groups, and formats raw guild members data into hoist roles & flat sections.
 * Optimized to be a pure, high-performance CPU-bound operation.
 */
function formatMembersData(guild: Guild): TransformedGuildMembers {
  // ── Helper: pick a display-worthy activity from presence ─────
  function pickActivity(presence: Presence | null | undefined): string | null {
    if (!presence?.activities?.length) return null;
    const realActivity = presence.activities.find(
      (activity: Activity) => activity.type !== 4,
    );
    if (realActivity) return realActivity.name;
    const customStatus = presence.activities.find(
      (activity: Activity) => activity.type === 4,
    );
    return customStatus?.state || null;
  }

  // Collect online members (online, idle, dnd — not offline).
  const onlineMembers = guild.members.cache.filter(
    (member: GuildMember) =>
      member.presence &&
      member.presence.status &&
      member.presence.status !== "offline",
  );

  // Bots without presence are treated as online sidebar elements per Discord behavior
  const offlineBots = guild.members.cache.filter(
    (member: GuildMember) =>
      member.user.bot &&
      (!member.presence || member.presence.status === "offline"),
  );

  const roleMap = new Map<string, RoleGroup>();
  const ungrouped: MemberData[] = [];
  const ungroupedBots: MemberData[] = [];

  const allVisible = new Map<string, GuildMember>([
    ...onlineMembers,
    ...offlineBots,
  ]);

  for (const [, member] of allVisible) {
    try {
      let sortedRoles: Role[] = [];
      try {
        sortedRoles = [
          ...member.roles.cache
            .filter((r: Role) => r.id !== guild.id) // Exclude @everyone
            .sort((a: Role, b: Role) => b.position - a.position)
            .values(),
        ];
      } catch {
        /* roles cache unavailable */
      }

      const hoistedRole = sortedRoles.find((r: Role) => r.hoist);

      let roleColors: {
        primary: string;
        secondary: string | null;
        tertiary: string | null;
      } | null = null;
      try {
        const colorRole = member.roles.color;
        if (colorRole?.colors) {
          const { primaryColor, secondaryColor, tertiaryColor } =
            colorRole.colors;
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
      } catch {
        /* role colors unavailable */
      }

      const badges: string[] = [];
      try {
        const userFlags = member.user.flags?.bitfield;
        if (userFlags) {
          const BADGE_MAP: [number, string][] = [
            [1, "staff"],
            [2, "partner"],
            [4, "hypesquad"],
            [8, "bug_hunter_1"],
            [64, "hypesquad_bravery"],
            [128, "hypesquad_brilliance"],
            [256, "hypesquad_balance"],
            [512, "early_supporter"],
            [16384, "bug_hunter_2"],
            [65536, "verified_bot"],
            [131072, "verified_developer"],
            [262144, "certified_moderator"],
            [4194304, "active_developer"],
          ];
          for (const [bit, id] of BADGE_MAP) {
            if ((userFlags & bit) === bit) badges.push(id);
          }
        }
      } catch {
        /* user flags unavailable */
      }

      let roleTags: {
        name: string;
        color: string | null;
        iconUrl: string | null;
      }[] = [];
      try {
        roleTags = sortedRoles.slice(0, 3).map((r: Role) => ({
          name: r.name,
          color: r.hexColor && r.hexColor !== "#000000" ? r.hexColor : null,
          iconUrl: r.iconURL?.() || null,
        }));
      } catch {
        /* role tags unavailable */
      }

      const memberData: MemberData = {
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        avatarUrl: buildAvatarUrl(member.user, member),
        status: member.presence?.status || "online",
        activity: pickActivity(member.presence),
        isBot: member.user.bot,
        roleColor:
          member.displayHexColor !== "#000000" ? member.displayHexColor : null,
        ...(roleColors?.secondary && { roleColors }),
        ...(badges.length > 0 && { badges }),
        ...(roleTags.length > 0 && { roleTags }),
      };

      if (hoistedRole) {
        if (!roleMap.has(hoistedRole.id)) {
          roleMap.set(hoistedRole.id, {
            id: hoistedRole.id,
            name: hoistedRole.name,
            color:
              hoistedRole.hexColor !== "#000000" ? hoistedRole.hexColor : null,
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
      console.warn(
        `[guild/members] Skipping member ${member?.id}: ${(memberErr as Error).message}`,
      );
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
async function refreshMembersCache(
  guildId: string,
): Promise<TransformedGuildMembers | null> {
  const client = DiscordWrapper.getClient("lupos");
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  try {
    // Only invoke heavy fetch call if local cache is dry or extremely small to avoid gateway overload
    if (guild.members.cache.size < 100) {
      console.log(
        `[members-cache] Cache is small (${guild.members.cache.size}). Syncing from Discord API...`,
      );
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

router.get(
  "/guild/members",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId =
        (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
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
          console.error(
            `[guild/members] Background cache refresh failed: ${err.message}`,
          ),
        );
        return res.json(cached.data);
      }

      // No cache exists yet (cold start). Fetch and generate synchronously to seed cache
      console.log(
        `[guild/members] Cold start for ${guildId}. Seeding cache synchronously...`,
      );
      const data = await refreshMembersCache(guildId);
      return res.json(data);
    } catch (error: unknown) {
      console.error(
        "[guild/members] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({
          error: "Failed to fetch members",
          detail: (error as Error).message,
        });
    }
  }),
);

// ─── Background Job Status Tracker ──────────────────────────────
// Lightweight in-memory map for tracking async job progress.
// Jobs auto-expire after 1 hour to prevent memory leaks.
const _jobStatus = new Map<string, JobStatus>();
let _jobIdCounter = 0;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

function createJob(
  type: string,
  meta: Record<string, unknown> = {},
): JobStatus {
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

router.post(
  "/guild/rescrape",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW || "";
      const {
        channelIds,
        dateLimit = "2025-01-01",
        forceUpdate = false,
      } = req.body;

      if (
        !channelIds ||
        !Array.isArray(channelIds) ||
        channelIds.length === 0
      ) {
        return res.status(400).json({ error: "channelIds array is required" });
      }

      const client = DiscordWrapper.getClient("lupos");
      const MongoService = (await import("#root/services/MongoService.js"))
        .default;
      const DiscordUtilityService = (
        await import("#root/services/DiscordUtilityService.js")
      ).default;
      const localMongo = MongoService.getClient("local");
      if (!localMongo) {
        return res.status(500).json({ error: "Database not initialized" });
      }

      const job = createJob("rescrape", {
        guildId,
        channelIds,
        dateLimit,
        forceUpdate,
      });

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
      )
        .then((result: unknown) => {
          completeJob(job.id, result);
          console.log(
            `[guild/rescrape] Completed rescrape of ${channelIds.length} channel(s)`,
          );
        })
        .catch((error: Error) => {
          failJob(job.id, error.message);
          console.error("[guild/rescrape] Error:", error.message);
        });
    } catch (error: unknown) {
      console.error(
        "[guild/rescrape] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({
          error: "Failed to start rescrape",
          detail: (error as Error).message,
        });
    }
  }),
);

// ─── GET /guild/rescrape/status ─────────────────────────────────
router.get("/guild/rescrape/status", (req: Request, res: Response) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all rescrape jobs
    const jobs = [..._jobStatus.values()].filter(
      (j: JobStatus) => j.type === "rescrape",
    );
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId as string);
  if (!job)
    return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── POST /guild/backfill-media ─────────────────────────────────
// Triggers media archival backfill for messages with expired Discord
// CDN URLs. Downloads fresh media from Discord and stores permanently
// in MinIO, then updates MongoDB documents with the MinIO URLs.
// Body: { guildId?, channelId?, forceRetry? }

router.post(
  "/guild/backfill-media",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId = req.body.guildId || config.GUILD_ID_PRIMARY || "";
      const { channelId, forceRetry = false } = req.body;

      const client = DiscordWrapper.getClient("lupos");
      const MongoService = (await import("#root/services/MongoService.js"))
        .default;
      const DiscordUtilityService = (
        await import("#root/services/DiscordUtilityService.js")
      ).default;
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
      })
        .then(
          (result: { processed: number; archived: number; errors: number }) => {
            completeJob(job.id, result);
            console.log(
              `[guild/backfill-media] Completed — processed: ${result.processed}, archived: ${result.archived}, errors: ${result.errors}`,
            );
          },
        )
        .catch((error: Error) => {
          failJob(job.id, error.message);
          console.error("[guild/backfill-media] Error:", error.message);
        });
    } catch (error: unknown) {
      console.error(
        "[guild/backfill-media] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({
          error: "Failed to start media backfill",
          detail: (error as Error).message,
        });
    }
  }),
);

// ─── GET /guild/backfill-media/status ───────────────────────────
router.get("/guild/backfill-media/status", (req: Request, res: Response) => {
  const { jobId } = req.query;
  if (!jobId) {
    // Return all backfill-media jobs
    const jobs = [..._jobStatus.values()].filter(
      (j: JobStatus) => j.type === "backfill-media",
    );
    return res.json({ jobs });
  }
  const job = _jobStatus.get(jobId as string);
  if (!job)
    return res.status(404).json({ error: "Job not found (may have expired)" });
  res.json(job);
});

// ─── GET /guild/emojis ──────────────────────────────────────────
// Returns all custom emojis for a guild (for the emoji picker).
// Query: ?guildId=...

router.get("/guild/emojis", (req: Request, res: Response) => {
  try {
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const emojis: {
      id: string;
      name: string | null;
      animated: boolean;
      url: string;
    }[] = [];
    for (const [, emoji] of guild.emojis.cache) {
      if (!emoji.id) continue;
      try {
        emojis.push({
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated || false,
          url: emoji.imageURL({
            extension: emoji.animated ? "gif" : "webp",
            size: 48,
          }),
        });
      } catch (emojiErr: unknown) {
        console.warn(
          `[guild/emojis] Skipping emoji ${emoji.id} (${emoji.name}): ${(emojiErr as Error).message}`,
        );
      }
    }

    res.json({
      guildId,
      guildName: guild.name,
      emojis,
    });
  } catch (error: unknown) {
    console.error(
      "[guild/emojis] Error:",
      (error as Error).message,
      (error as Error).stack,
    );
    res
      .status(500)
      .json({
        error: "Failed to fetch emojis",
        detail: (error as Error).message,
      });
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

router.post(
  "/guild/react",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW;
      const { channelId, messageId, emoji } = req.body;

      if (!channelId || !messageId || !emoji) {
        return res
          .status(400)
          .json({ error: "channelId, messageId, and emoji are required" });
      }

      // ── Rate limit: 1 reaction per 2s per guild ─────────────────
      const now = Date.now();
      const lastReact = _reactCooldowns.get(guildId) || 0;
      if (now - lastReact < 2000) {
        return res
          .status(429)
          .json({
            error: "Rate limited",
            retryAfterMs: 2000 - (now - lastReact),
          });
      }
      _reactCooldowns.set(guildId, now);

      const client = DiscordWrapper.getClient("lupos");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      const channel = guild.channels.cache.get(channelId) as
        | TextChannel
        | undefined;
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
      const existingReaction = message.reactions.cache.find(
        (r: MessageReaction) => {
          if (isCustom) {
            return r.emoji.id === emoji.split(":")[1];
          }
          return r.emoji.name === emoji && !r.emoji.id;
        },
      );

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
        const MongoService = (await import("#root/services/MongoService.js"))
          .default;
        const localMongo = MongoService.getClient("local");
        if (!localMongo)
          throw new Error("MongoService: local client not initialized");
        const db = localMongo.db("lupos");
        const collection = db.collection("Messages");

        const transformedReactions = freshMessage.reactions.cache.map(
          (r: MessageReaction) => ({
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
          }),
        );

        await collection.updateOne(
          { id: messageId },
          { $set: { reactions: transformedReactions } },
        );
      } catch (syncErr: unknown) {
        // Non-critical — the reaction was added on Discord, MongoDB sync can lag
        console.warn(
          "[guild/react] MongoDB sync failed:",
          (syncErr as Error).message,
        );
      }

      res.json({ success: true });
    } catch (error: unknown) {
      console.error(
        "[guild/react] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({ error: "Failed to react", detail: (error as Error).message });
    }
  }),
);

// ─── GET /bot/stats ─────────────────────────────────────────────
// Returns live bot somatic status, database counts, and active server stats
router.get(
  "/bot/stats",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const client = DiscordWrapper.getClient("lupos");
      const MongoService = (await import("#root/services/MongoService.js"))
        .default;
      const localMongo = MongoService.getClient("local");
      const db = localMongo ? localMongo.db("lupos") : null;

      // 1. Somatic Status
      const moodLevel = MoodService.getMoodLevel();
      const currentMood = MOODS.find(
        (m: MoodEntry) => m.level === moodLevel,
      ) || {
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
      };

      if (db) {
        try {
          const primaryGuildId =
            config.GUILD_ID_PRIMARY || config.GUILD_ID_CLOCK_CREW || "";
          const primaryGuild = client?.guilds?.cache?.get(primaryGuildId);
          let memberCount = 0;
          if (primaryGuild) {
            memberCount = primaryGuild.memberCount;
          } else if (client?.guilds?.cache) {
            for (const [, guild] of client.guilds.cache) {
              memberCount += guild.memberCount || 0;
            }
          }

          const msgCount = await db
            .collection("Messages")
            .estimatedDocumentCount()
            .catch(() => 0);

          database = {
            totalMessages: msgCount,
            totalUniqueUsers: memberCount,
          };
        } catch (dbErr: unknown) {
          console.warn(
            "[bot/stats] Failed to fetch database metrics:",
            (dbErr as Error).message,
          );
        }
      }

      // 3. Top Games — names and play counts only
      let topGames: { name: string; players: number }[] = [];
      if (db) {
        try {
          const rawGames = await db
            .collection("GameActivity")
            .find({}, { projection: { _id: 0, name: 1, count: 1 } })
            .sort({ count: -1 })
            .limit(10)
            .toArray();
          topGames = rawGames.map((game) => ({
            name: (game.name as string) || "Unknown",
            players: (game.count as number) || 0,
          }));
        } catch (gameErr: unknown) {
          console.warn(
            "[bot/stats] Failed to fetch game activity:",
            (gameErr as Error).message,
          );
        }
      }

      // 4. Active Streamers — names only
      let activeStreamers: string[] = [];
      if (db) {
        try {
          const rawStreamers = await db
            .collection("ActiveStreamers")
            .find(
              { isStreaming: true },
              {
                projection: {
                  _id: 0,
                  userName: 1,
                  username: 1,
                  displayName: 1,
                },
              },
            )
            .toArray();
          activeStreamers = rawStreamers
            .map(
              (streamer) =>
                (streamer.displayName as string) ||
                (streamer.userName as string) ||
                (streamer.username as string) ||
                "",
            )
            .filter((name) => name && name !== "Unknown");
        } catch (streamErr: unknown) {
          console.warn(
            "[bot/stats] Failed to fetch active streamers:",
            (streamErr as Error).message,
          );
        }
      }

      // 5. Compact Discord summary
      const uptimeMilliseconds = client?.uptime || 0;
      const uptimeHours = Math.floor(uptimeMilliseconds / 3_600_000);
      const uptimeMinutes = Math.floor(
        (uptimeMilliseconds % 3_600_000) / 60_000,
      );

      const discord = {
        isReady: client?.isReady() || false,
        guilds: client?.guilds?.cache?.size || 0,
        uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      };

      res.json({
        somatic,
        database,
        topGames,
        activeStreamers,
        discord,
      });
    } catch (error: unknown) {
      console.error(
        "[bot/stats] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({
          error: "Failed to fetch bot stats",
          detail: (error as Error).message,
        });
    }
  }),
);

// ─── GET /bot/guilds ──────────────────────────────────────────────
// Returns detailed information about every Discord server the bot is in.
router.get("/bot/guilds", (req: Request, res: Response) => {
  try {
    const client = DiscordWrapper.getClient("lupos");

    const guilds = client.guilds.cache.map((guild: Guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ extension: "png", size: 128 }),
      banner: guild.bannerURL({ extension: "png", size: 480 }),
      splash: guild.splashURL({ extension: "png", size: 480 }),
      memberCount: guild.memberCount,
      channelCount: guild.channels?.cache?.size || 0,
      emojiCount: guild.emojis?.cache?.size || 0,
      roleCount: guild.roles?.cache?.size || 0,
      boostCount: guild.premiumSubscriptionCount || 0,
      boostTier: guild.premiumTier || 0,
      ownerId: guild.ownerId,
      createdAt: guild.createdAt?.toISOString() || null,
      description: guild.description || null,
      vanityURLCode: guild.vanityURLCode || null,
      verified: guild.verified || false,
      partnered: guild.partnered || false,
    }));

    res.json({
      count: guilds.length,
      guilds,
    });
  } catch (error: unknown) {
    console.error("[bot/guilds] Error:", (error as Error).message);
    res.status(500).json({ error: "Failed to fetch guilds" });
  }
});

// ─── GET /bot/activity ────────────────────────────────────────────
// Returns hourly activity metrics for the past 24 hours.
// Aggregates: messages replied, image generations, image captions,
// transcriptions, unique users, and total interactions — bucketed by hour.
router.get(
  "/bot/activity",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const MongoService = (await import("#root/services/MongoService.js"))
        .default;
      const localMongo = MongoService.getClient("local");
      if (!localMongo) {
        return res.status(500).json({ error: "Database not initialized" });
      }

      const db = localMongo.db("lupos");
      const prismDb = localMongo.db("prism");
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // MetricsMessageGeneration uses MongoDB ObjectId for timestamps
      // (no explicit createdAt field), so we filter by _id >= ObjectId(24h ago)
      const { ObjectId } = await import("mongodb");
      const cutoffObjectId = ObjectId.createFromTime(
        Math.floor(twentyFourHoursAgo.getTime() / 1000),
      );

      // 1. Message reply activity + unique users per hour (MetricsMessageGeneration)
      const messageActivity = (await db
        .collection("MetricsMessageGeneration")
        .aggregate([
          { $match: { _id: { $gte: cutoffObjectId } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%dT%H:00:00",
                  date: { $toDate: "$_id" },
                },
              },
              count: { $sum: 1 },
              uniqueUserIds: { $addToSet: "$userId" },
            },
          },
          {
            $project: {
              count: 1,
              uniqueUsers: { $size: "$uniqueUserIds" },
            },
          },
        ])
        .toArray()) as unknown as {
        _id: string;
        count: number;
        uniqueUserIds?: string[];
      }[];

      // 2. Audio transcription activity
      const transcriptionActivity = (await db
        .collection("AudioTranscriptions")
        .aggregate([
          { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%dT%H:00:00",
                  date: "$createdAt",
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray()) as unknown as { _id: string; count: number }[];

      // 3. Image caption activity (ImageCaptions collection)
      const imageCaptionActivity = (await db
        .collection("ImageCaptions")
        .aggregate([
          { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%dT%H:00:00",
                  date: "$createdAt",
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray()) as unknown as { _id: string; count: number }[];

      // 4. Image generation activity + unique IPs per hour (Prism requests for lupos)
      const imageGenActivity = (await prismDb
        .collection("requests")
        .aggregate([
          {
            $match: {
              project: "lupos",
              "modalities.imageOut": true,
              success: true,
              timestamp: { $gte: twentyFourHoursAgo.toISOString() },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%dT%H:00:00",
                  date: { $dateFromString: { dateString: "$timestamp" } },
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray()) as unknown as { _id: string; count: number }[];

      // 5. Unique users — union of Discord userIds + client IPs (pseudo-users)
      //    Discord userIds come from MetricsMessageGeneration (already aggregated above).
      //    Client IPs come from prism requests for the lupos project.
      //    Prefixing prevents namespace collisions (uid:123 vs ip:1.2.3.4).

      // 5a. Unique client IPs per hour from prism requests (all lupos API interactions)
      const prismUniqueIps = (await prismDb
        .collection("requests")
        .aggregate([
          {
            $match: {
              project: "lupos",
              success: true,
              clientIp: { $ne: null },
              timestamp: { $gte: twentyFourHoursAgo.toISOString() },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%dT%H:00:00",
                  date: { $dateFromString: { dateString: "$timestamp" } },
                },
              },
              uniqueIps: { $addToSet: "$clientIp" },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray()) as unknown as { _id: string; uniqueIps: string[] }[];
      const prismIpMap = new Map<string, string[]>(
        prismUniqueIps.map((r: { _id: string; uniqueIps: string[] }) => [
          r._id,
          r.uniqueIps,
        ]),
      );

      // 5b. Total 24h unique users (union of Discord userIds + client IPs)
      const totalUniqueUserIds = await db
        .collection("MetricsMessageGeneration")
        .distinct("userId", { _id: { $gte: cutoffObjectId } });
      const totalUniqueIps = await prismDb
        .collection("requests")
        .distinct("clientIp", {
          project: "lupos",
          success: true,
          clientIp: { $ne: null },
          timestamp: { $gte: twentyFourHoursAgo.toISOString() },
        });
      // Merge into a single deduplicated set using namespace prefixes
      const totalUniqueSet = new Set<string>();
      for (const uid of totalUniqueUserIds) totalUniqueSet.add(`uid:${uid}`);
      for (const ip of totalUniqueIps) totalUniqueSet.add(`ip:${ip}`);

      // ── Build 24-hour timeline buckets ──────────────────────────
      const hours: string[] = [];
      for (let i = 23; i >= 0; i--) {
        const hourTimestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
        hourTimestamp.setMinutes(0, 0, 0);
        hours.push(hourTimestamp.toISOString().slice(0, 13) + ":00:00");
      }

      // ── Transform aggregation results into fast lookup Maps ─────
      const messageMap = new Map<string, number>(
        messageActivity.map((r: { _id: string; count: number }) => [
          r._id,
          r.count,
        ]),
      );
      const transcriptionMap = new Map<string, number>(
        transcriptionActivity.map((r: { _id: string; count: number }) => [
          r._id,
          r.count,
        ]),
      );
      const imageCaptionMap = new Map<string, number>(
        imageCaptionActivity.map((r: { _id: string; count: number }) => [
          r._id,
          r.count,
        ]),
      );
      const imageGenMap = new Map<string, number>(
        imageGenActivity.map((r: { _id: string; count: number }) => [
          r._id,
          r.count,
        ]),
      );

      // ── Per-hour unique users: merge Discord userIds + Prism IPs ─
      const msgUserMap = new Map<string, string[]>(
        messageActivity.map(
          (r: { _id: string; count: number; uniqueUserIds?: string[] }) => [
            r._id,
            (r.uniqueUserIds || []).map((id: string) => `uid:${id}`),
          ],
        ),
      );
      const uniqueUsersMap = new Map<string, number>();
      for (const hour of hours) {
        const merged = new Set<string>();
        for (const uid of msgUserMap.get(hour) || []) merged.add(uid);
        for (const ip of prismIpMap.get(hour) || []) merged.add(`ip:${ip}`);
        uniqueUsersMap.set(hour, merged.size);
      }

      const timeline = hours.map((hour: string) => ({
        hour,
        messages: messageMap.get(hour) || 0,
        transcriptions: transcriptionMap.get(hour) || 0,
        imageCaptions: imageCaptionMap.get(hour) || 0,
        imageGenerations: imageGenMap.get(hour) || 0,
        uniqueUsers: uniqueUsersMap.get(hour) || 0,
        total:
          (messageMap.get(hour) || 0) +
          (transcriptionMap.get(hour) || 0) +
          (imageCaptionMap.get(hour) || 0) +
          (imageGenMap.get(hour) || 0),
      }));

      // Summary totals
      const totals = {
        messages: timeline.reduce((sum, h) => sum + h.messages, 0),
        transcriptions: timeline.reduce((sum, h) => sum + h.transcriptions, 0),
        imageCaptions: timeline.reduce((sum, h) => sum + h.imageCaptions, 0),
        imageGenerations: timeline.reduce(
          (sum, h) => sum + h.imageGenerations,
          0,
        ),
        uniqueUsers: totalUniqueUserIds.length,
        total: timeline.reduce((sum, h) => sum + h.total, 0),
      };

      res.json({ timeline, totals });
    } catch (error: unknown) {
      console.error(
        "[bot/activity] Error:",
        (error as Error).message,
        (error as Error).stack,
      );
      res
        .status(500)
        .json({
          error: "Failed to fetch activity metrics",
          detail: (error as Error).message,
        });
    }
  }),
);

// ─── GET /guild/heatmap ──────────────────────────────────────────
// Returns activity heatmap by day/hour for a user.
// Query: ?guildId=...&userId=...&channelId=...&years=...&months=...&days=...
router.get(
  "/guild/heatmap",
  asyncHandler(async (req: Request, res: Response) => {
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const userId = req.query.userId as string;
    const channelId = req.query.channelId as string;
    let years = req.query.years ? parseInt(req.query.years as string, 10) : 0;
    const months = req.query.months
      ? parseInt(req.query.months as string, 10)
      : 0;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 0;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    if (years === 0 && months === 0 && days === 0) {
      years = getServerAgeYears(guild) + 1;
    }

    const now = new Date();
    const { startDate, unixStartDate } = computeStartDate(years, months, days);
    const actualDays = Math.ceil(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    const matchQuery: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId,
      "author.id": userId,
      "author.bot": { $ne: true },
    };

    if (channelId) {
      matchQuery.channelId = channelId;
    }

    try {
      const database = getMongoDb();
      const messagesCollection = database.collection("Messages");

      const [hourlyResult] = await messagesCollection
        .aggregate([
          { $match: matchQuery },
          {
            $project: {
              date: { $toDate: "$createdTimestamp" },
            },
          },
          {
            $group: {
              _id: {
                // $dayOfWeek is 1 (Sunday) … 7 (Saturday); remap to
                // 0 (Monday) … 6 (Sunday) to match the DAYS label array.
                dayOfWeek: {
                  $mod: [
                    {
                      $add: [
                        {
                          $dayOfWeek: {
                            date: "$date",
                            timezone: "America/Los_Angeles",
                          },
                        },
                        5,
                      ],
                    },
                    7,
                  ],
                },
                hour: {
                  $hour: { date: "$date", timezone: "America/Los_Angeles" },
                },
                minute: {
                  $minute: { date: "$date", timezone: "America/Los_Angeles" },
                },
              },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              dayOfWeek: "$_id.dayOfWeek",
              block: {
                $add: [
                  { $multiply: ["$_id.hour", 2] },
                  { $cond: [{ $gte: ["$_id.minute", 30] }, 1, 0] },
                ],
              },
              count: 1,
            },
          },
          {
            $group: {
              _id: {
                dayOfWeek: "$dayOfWeek",
                block: "$block",
              },
              count: { $sum: "$count" },
            },
          },
          {
            $group: {
              _id: null,
              messages: {
                $push: {
                  day: "$_id.dayOfWeek",
                  block: "$_id.block",
                  count: "$count",
                },
              },
              totalMessages: { $sum: "$count" },
            },
          },
        ])
        .toArray();

      const [monthlyResult] = await messagesCollection
        .aggregate([
          { $match: matchQuery },
          {
            $project: {
              date: { $toDate: "$createdTimestamp" },
            },
          },
          {
            $group: {
              _id: {
                year: {
                  $year: { date: "$date", timezone: "America/Los_Angeles" },
                },
                month: {
                  $month: { date: "$date", timezone: "America/Los_Angeles" },
                },
              },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: null,
              messages: {
                $push: {
                  year: "$_id.year",
                  month: "$_id.month",
                  count: "$count",
                },
              },
            },
          },
        ])
        .toArray();

      if (!hourlyResult || hourlyResult.totalMessages === 0) {
        return res.json({
          totalMessages: 0,
          actualDays,
          hourlyMessages: [],
          monthlyMessages: [],
          heatmapData: [],
        });
      }

      const hourlyMessages = hourlyResult.messages as HourlyMessageEntry[];
      const totalMessages = hourlyResult.totalMessages as number;
      const monthlyMessages = (monthlyResult?.messages ||
        []) as MonthlyMessageEntry[];

      const heatmapData = Array(7)
        .fill(null)
        .map(() => Array<number>(48).fill(0));

      hourlyMessages.forEach((message) => {
        heatmapData[message.day][message.block] = message.count;
      });

      let maxCount = 0;
      let peakDay = 0;
      let peakBlock = 0;

      heatmapData.forEach((dayData, dayIndex) => {
        dayData.forEach((count, blockIndex) => {
          if (count > maxCount) {
            maxCount = count;
            peakDay = dayIndex;
            peakBlock = blockIndex;
          }
        });
      });

      const averagePerHour =
        actualDays > 0
          ? (totalMessages / (actualDays * 24)).toFixed(2)
          : "0.00";

      const dayCounts = heatmapData.map((dayData) =>
        dayData.reduce((sum, count) => sum + count, 0),
      );
      const maxDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
      const mostActiveDay = `${DAYS[maxDayIndex]} (${dayCounts[maxDayIndex]} messages)`;

      const blockCounts = Array<number>(48).fill(0);
      heatmapData.forEach((dayData) => {
        dayData.forEach((count, blockIndex) => {
          blockCounts[blockIndex] += count;
        });
      });
      const topActiveTimes = blockCounts
        .map((count, blockIndex) => ({ blockIndex, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((item) => `${formatTimeBlock(item.blockIndex)} (${item.count})`)
        .join(", ");

      res.json({
        totalMessages,
        actualDays,
        averagePerHour,
        mostActiveDay,
        mostActiveTimes: topActiveTimes,
        peakActivity: {
          day: DAYS[peakDay],
          time: formatTimeBlock(peakBlock),
          count: maxCount,
        },
        hourlyMessages,
        monthlyMessages,
        heatmapData,
      });
    } catch (error: unknown) {
      console.error("[guild/heatmap] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch heatmap data" });
    }
  }),
);

// ─── GET /guild/mentions ─────────────────────────────────────────
// Shows top 5 users who have mentioned a specific user.
// Query: ?guildId=...&userId=...&years=...&months=...&days=...&channelId=...
router.get(
  "/guild/mentions",
  asyncHandler(async (req: Request, res: Response) => {
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const userId = req.query.userId as string;
    const channelId = req.query.channelId as string;
    let years = req.query.years ? parseInt(req.query.years as string, 10) : 0;
    const months = req.query.months
      ? parseInt(req.query.months as string, 10)
      : 0;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 0;

    if (!userId) {
      return res
        .status(400)
        .json({ error: "userId query parameter is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    if (years === 0 && months === 0 && days === 0) {
      years = getServerAgeYears(guild);
    }

    const { startDate, unixStartDate } = computeStartDate(years, months, days);

    const matchQuery: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId,
      "mentions.users": {
        $elemMatch: { id: userId },
      },
    };

    if (channelId) {
      matchQuery.channelId = channelId;
    }

    try {
      const database = getMongoDb();
      const messagesCollection = database.collection("Messages");

      const [result] = await messagesCollection
        .aggregate([
          { $match: matchQuery },
          {
            $facet: {
              topMentioners: [
                {
                  $match: {
                    "author.bot": { $ne: true },
                    "author.id": { $ne: userId },
                  },
                },
                {
                  $group: {
                    _id: "$author.id",
                    username: { $first: "$author.username" },
                    avatar: { $first: "$author.defaultAvatarURL" },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
              ],
              stats: [
                {
                  $match: {
                    "author.bot": { $ne: true },
                  },
                },
                {
                  $group: {
                    _id: null,
                    totalMentions: { $sum: 1 },
                    uniqueMentioners: { $addToSet: "$author.id" },
                  },
                },
                {
                  $project: {
                    totalMentions: 1,
                    uniqueMentioners: { $size: "$uniqueMentioners" },
                  },
                },
              ],
            },
          },
        ])
        .toArray();

      const topMentioners = (result?.topMentioners || []) as MentionerEntry[];
      const stats = (result?.stats[0] || {
        totalMentions: 0,
        uniqueMentioners: 0,
      }) as { totalMentions: number; uniqueMentioners: number };

      const averageMentionsPerUser =
        stats.uniqueMentioners > 0
          ? (stats.totalMentions / stats.uniqueMentioners).toFixed(1)
          : "0.0";

      const formattedMentioners = topMentioners.map(
        (mentionerItem, indexIndex) => {
          const percentage =
            stats.totalMentions > 0
              ? ((mentionerItem.count / stats.totalMentions) * 100).toFixed(1)
              : "0.0";
          return {
            rank: indexIndex + 1,
            userId: mentionerItem._id,
            username: mentionerItem.username,
            count: mentionerItem.count,
            percentage: parseFloat(percentage),
          };
        },
      );

      res.json({
        targetUserId: userId,
        timePeriod: formatTimePeriod(years, months, days),
        totalMentions: stats.totalMentions,
        uniqueMentioners: stats.uniqueMentioners,
        averageMentionsPerUser: parseFloat(averageMentionsPerUser),
        topMentioners: formattedMentioners,
      });
    } catch (error: unknown) {
      console.error("[guild/mentions] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch mentions leaderboard" });
    }
  }),
);

// ─── GET /guild/leaderboard ──────────────────────────────────────
// Shows message leaderboard for a specified time period.
// Query: ?guildId=...&years=...&months=...&days=...&channelId=...
router.get(
  "/guild/leaderboard",
  asyncHandler(async (req: Request, res: Response) => {
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const channelId = req.query.channelId as string;
    const years = req.query.years ? parseInt(req.query.years as string, 10) : 0;
    const months = req.query.months
      ? parseInt(req.query.months as string, 10)
      : 0;
    let days = req.query.days ? parseInt(req.query.days as string, 10) : 0;

    if (years === 0 && months === 0 && days === 0) {
      days = 7;
    }

    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const { startDate, unixStartDate } = computeStartDate(years, months, days);

    const matchQuery: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId,
    };

    if (channelId) {
      matchQuery.channelId = channelId;
    }

    try {
      const database = getMongoDb();
      const messagesCollection = database.collection("Messages");

      const [totalMessages, allUsers] = await Promise.all([
        messagesCollection.countDocuments(matchQuery),
        messagesCollection
          .aggregate([
            { $match: { ...matchQuery, "author.bot": { $ne: true } } },
            {
              $group: {
                _id: "$author.id",
                username: { $first: "$author.username" },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ])
          .toArray() as unknown as Promise<LeaderboardUser[]>,
      ]);

      const totalUsers = allUsers.length;
      const totalUserMessages = allUsers.reduce(
        (sum, userItem) => sum + userItem.count,
        0,
      );
      const averageMessagesPerUser =
        totalUsers > 0 ? totalUserMessages / totalUsers : 0;

      const topContributors = allUsers
        .slice(0, 20)
        .map((userItem, indexIndex) => ({
          rank: indexIndex + 1,
          userId: userItem._id,
          username: userItem.username,
          count: userItem.count,
        }));

      res.json({
        timePeriod: formatTimePeriod(years, months, days),
        totalMessages,
        activeUsers: totalUsers,
        averageMessagesPerUser: parseFloat(averageMessagesPerUser.toFixed(1)),
        topContributors,
      });
    } catch (error: unknown) {
      console.error("[guild/leaderboard] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch message leaderboard" });
    }
  }),
);

// ─── GET /guild/word-frequencies ─────────────────────────────────
// Generate word frequency analysis for a user.
// Query: ?guildId=...&userId=...&years=...&months=...&days=...&limit=...
//
// Uses cursor-based streaming with content-only projection to avoid
// OOM crashes — the original .toArray() approach loaded 664K+ full
// message documents into heap simultaneously, exhausting the V8 heap
// when 10 parallel calls hit this endpoint.
router.get(
  "/guild/word-frequencies",
  asyncHandler(async (req: Request, res: Response) => {
    const guildId =
      (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
    const userId = req.query.userId as string;
    let years = req.query.years ? parseInt(req.query.years as string, 10) : 0;
    const months = req.query.months
      ? parseInt(req.query.months as string, 10)
      : 0;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 0;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 150;

    if (!userId) {
      return res
        .status(400)
        .json({ error: "userId query parameter is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    if (years === 0 && months === 0 && days === 0) {
      years = getServerAgeYears(guild);
    }

    const { startDate, unixStartDate } = computeStartDate(years, months, days);

    try {
      const database = getMongoDb();
      const messagesCollection = database.collection("Messages");

      const STOP_WORDS = new Set([
        "the",
        "be",
        "to",
        "of",
        "and",
        "a",
        "in",
        "that",
        "have",
        "i",
        "it",
        "for",
        "not",
        "on",
        "with",
        "he",
        "as",
        "you",
        "do",
        "at",
        "this",
        "but",
        "his",
        "by",
        "from",
        "they",
        "we",
        "say",
        "her",
        "she",
        "or",
        "an",
        "will",
        "my",
        "one",
        "all",
        "would",
        "there",
        "their",
        "what",
        "so",
        "up",
        "out",
        "if",
        "about",
        "who",
        "get",
        "which",
        "go",
        "me",
        "when",
        "make",
        "can",
        "like",
        "time",
        "no",
        "just",
        "him",
        "know",
        "take",
        "into",
        "year",
        "your",
        "some",
        "could",
        "them",
        "than",
        "then",
        "now",
        "only",
        "its",
        "also",
        "back",
        "after",
        "use",
        "how",
        "our",
        "even",
        "want",
        "any",
        "these",
        "give",
        "most",
        "us",
        "is",
        "was",
        "are",
        "been",
        "has",
        "had",
        "were",
        "did",
        "am",
        "im",
        "youre",
        "dont",
      ]);

      const frequencyMap: Record<string, number> = {};
      let totalMessages = 0;

      // Stream documents one at a time with content-only projection.
      // This keeps heap usage at O(1) instead of O(n × doc_size).
      const cursor = messagesCollection.find(
        {
          ...EXCLUDE_SOFT_DELETED,
          guildId,
          "author.id": userId,
          createdTimestamp: { $gte: unixStartDate },
        },
        { projection: { content: 1 } },
      );

      for await (const messageItem of cursor) {
        totalMessages++;
        if (!messageItem.content) continue;

        const cleanContent = (messageItem.content as string)
          .replace(/https?:\/\/\S+/g, "")
          .replace(/<@!?\d+>/g, "")
          .replace(/<#\d+>/g, "")
          .replace(/<@&\d+>/g, "")
          .replace(/<a?:\w+:\d+>/g, "")
          .replace(/[^\w\s'-]/g, " ")
          .toLowerCase();

        const words = cleanContent.split(/\s+/).filter((wordItem: string) => {
          const trimmed = wordItem.trim();
          return (
            trimmed.length > 2 &&
            !STOP_WORDS.has(trimmed) &&
            !/^\d+$/.test(trimmed) &&
            /[a-z]/.test(trimmed)
          );
        });

        for (const wordItem of words) {
          frequencyMap[wordItem] = (frequencyMap[wordItem] || 0) + 1;
        }
      }

      if (totalMessages === 0) {
        return res.json({
          totalMessages: 0,
          words: [],
        });
      }

      const sortedWords = Object.entries(frequencyMap)
        .map(([text, value]) => ({ text, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);

      res.json({
        totalMessages,
        timePeriod: formatTimePeriod(years, months, days),
        words: sortedWords,
      });
    } catch (error: unknown) {
      console.error(
        "[guild/word-frequencies] Error:",
        (error as Error).message,
      );
      res.status(500).json({ error: "Failed to fetch word frequencies" });
    }
  }),
);

// ─── GET /guild/voice-members ────────────────────────────────────
router.get(
  "/guild/voice-members",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId =
        (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
      const client = DiscordWrapper.getClient("lupos");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      const voiceChannelMembers = guild.channels.cache.filter(
        (channel) =>
          (channel.type === ChannelType.GuildVoice ||
            (channel.type as unknown as number) === 13) &&
          (channel as import("discord.js").VoiceChannel).members &&
          (channel as import("discord.js").VoiceChannel).members.size > 0,
      );

      const channels = voiceChannelMembers.map((channel) => {
        const voiceChannel = channel as
          | import("discord.js").VoiceChannel
          | import("discord.js").StageChannel;
        return {
          id: voiceChannel.id,
          name: voiceChannel.name,
          memberCount: voiceChannel.members.size,
          members: voiceChannel.members.map((member) => ({
            id: member.id,
            displayName: member.displayName,
            username: member.user.username,
            status: member.presence?.status || "offline",
            voiceState: {
              mute: member.voice.mute || false,
              deaf: member.voice.deaf || false,
              selfMute: member.voice.selfMute || false,
              selfDeaf: member.voice.selfDeaf || false,
              streaming:
                (member.voice as unknown as { streaming?: boolean })
                  .streaming || false,
              cameraOn: member.voice.selfVideo || false,
            },
          })),
        };
      });

      res.json({
        guildId,
        guildName: guild.name,
        channels,
      });
    } catch (error: unknown) {
      console.error("[guild/voice-members] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch voice channel members" });
    }
  }),
);

// ─── GET /guild/user-profile ─────────────────────────────────────
router.get(
  "/guild/user-profile",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId, guildId = config.GUILD_ID_CLOCK_CREW || "" } =
        req.query as { userId?: string; guildId?: string };
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const client = DiscordWrapper.getClient("lupos");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      let member: GuildMember | null = guild.members.cache.get(userId) || null;
      if (!member) {
        try {
          member = await guild.members.fetch(userId);
        } catch {
          // member not in guild or failed to fetch
        }
      }

      let user: User | null = client.users.cache.get(userId) || null;
      if (!user) {
        try {
          user = await client.users.fetch(userId);
        } catch {
          // user failed to fetch
        }
      }

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const accentColor = user.accentColor;
      const toHex = (colorValue: number) =>
        "#" + colorValue.toString(16).padStart(6, "0").toUpperCase();
      const hexColor = accentColor ? toHex(accentColor) : null;

      // Get presence & activities
      const presence = member?.presence;
      const customStatus =
        presence?.activities?.find((activity) => activity.type === 4)?.state ||
        null;
      const activities =
        presence?.activities
          ?.filter((activity) => activity.type !== 4)
          ?.map((activity) => {
            const types = [
              "Playing",
              "Streaming",
              "Listening to",
              "Watching",
              "Custom",
              "Competing",
            ];
            const state = activity.state ? `: (${activity.state})` : "";
            return `${types[activity.type]} ${activity.name}${state}`;
          }) || [];

      // Permissions
      const administrator = member
        ? member.permissions.has("Administrator")
        : false;
      const moderationPermissionsList = [
        "ManageMessages",
        "KickMembers",
        "BanMembers",
        "ManageRoles",
      ] as const;
      const moderationPermissions = member
        ? moderationPermissionsList.filter((permission) =>
            member.permissions.has(permission),
          )
        : [];

      // Manageable
      const kickable = member?.kickable || false;
      const manageable = member?.manageable || false;

      // Roles
      const roles = member
        ? member.roles.cache
            .filter((role) => role.name !== "@everyone")
            .map((role) => role.name)
        : [];
      const highestRole = member?.roles?.highest?.name || null;
      const displayColor =
        member && member.displayHexColor !== "#000000"
          ? member.displayHexColor
          : null;

      // Voice state
      const voiceState = member?.voice?.channel
        ? {
            channelName: member.voice.channel.name,
            deaf: member.voice.deaf || member.voice.selfDeaf || false,
            mute: member.voice.mute || member.voice.selfMute || false,
            streaming:
              (member.voice as unknown as { streaming?: boolean }).streaming ||
              false,
            cameraOn: member.voice.selfVideo || false,
            suppress: member.voice.suppress || false,
          }
        : null;

      const profileData = {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.globalName || user.username,
        nickname: member?.nickname || null,
        globalName: user.globalName || null,
        avatarUrl: member ? member.displayAvatarURL() : user.displayAvatarURL(),
        bannerUrl: user.bannerURL() || null,
        profileColor: hexColor,
        status: presence?.status || "offline",
        activePlatforms:
          presence?.status === "online" && presence.clientStatus
            ? Object.keys(presence.clientStatus)
            : [],
        customStatus,
        activities,
        accountCreatedAt: user.createdAt.toISOString(),
        joinedAt: member?.joinedTimestamp
          ? new Date(member.joinedTimestamp).toISOString()
          : null,
        boostingSince: member?.premiumSinceTimestamp
          ? new Date(member.premiumSinceTimestamp).toISOString()
          : null,
        administrator,
        moderationPermissions,
        kickable,
        manageable,
        roles,
        highestRole,
        displayColor,
        voiceState,
        isBot: user.bot,
      };

      res.json(profileData);
    } catch (error: unknown) {
      console.error("[guild/user-profile] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  }),
);

// ─── GET /guild/channel-stats ────────────────────────────────────
router.get(
  "/guild/channel-stats",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const guildId =
        (req.query.guildId as string) || config.GUILD_ID_CLOCK_CREW || "";
      let days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
      if (isNaN(days) || days < 1) days = 7;
      if (days > 90) days = 90; // Cap to prevent massive database scan

      const client = DiscordWrapper.getClient("lupos");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      const { unixStartDate } = computeStartDate(0, 0, days);
      const database = getMongoDb();
      const messagesCollection = database.collection("Messages");

      const channelStatistics = await messagesCollection
        .aggregate([
          {
            $match: {
              ...EXCLUDE_SOFT_DELETED,
              guildId,
              createdTimestamp: { $gte: unixStartDate },
              "author.bot": { $ne: true },
            },
          },
          {
            $group: {
              _id: "$channelId",
              messageCount: { $sum: 1 },
              uniqueUsers: { $addToSet: "$author.id" },
              users: { $push: { id: "$author.id", name: "$author.username" } },
            },
          },
        ])
        .toArray();

      const formattedStatistics = channelStatistics
        .map((channelEntry) => {
          const channelId = channelEntry._id;
          const channel = guild.channels.cache.get(channelId);
          const channelName = channel ? channel.name : "unknown-channel";

          // Calculate top contributor/yapper
          const userCounts: Record<string, { count: number; name: string }> =
            {};
          for (const userItem of channelEntry.users) {
            if (!userCounts[userItem.id]) {
              userCounts[userItem.id] = {
                count: 0,
                name: userItem.name || "Unknown",
              };
            }
            userCounts[userItem.id].count++;
          }

          let topUser: { id: string; name: string; count: number } | null =
            null;
          for (const [id, info] of Object.entries(userCounts)) {
            if (!topUser || info.count > topUser.count) {
              topUser = { id, name: info.name, count: info.count };
            }
          }

          const uniqueUsersCount = channelEntry.uniqueUsers.length;
          const messagesPerDay = channelEntry.messageCount / days;

          return {
            channelId,
            channelName,
            messageCount: channelEntry.messageCount,
            uniqueUsersCount,
            messagesPerDay: parseFloat(messagesPerDay.toFixed(1)),
            topUser,
          };
        })
        .sort((a, b) => b.messageCount - a.messageCount);

      res.json({
        guildId,
        guildName: guild.name,
        days,
        channels: formattedStatistics,
      });
    } catch (error: unknown) {
      console.error("[guild/channel-stats] Error:", (error as Error).message);
      res.status(500).json({ error: "Failed to fetch channel activity stats" });
    }
  }),
);

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatTimeBlock(block: number): string {
  const hour = Math.floor(block / 2);
  const minute = (block % 2) * 30;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minute === 0 ? "00" : minute} ${period}`;
}

interface MentionerEntry {
  _id: string;
  username: string;
  avatar: string;
  count: number;
}

interface LeaderboardUser {
  _id: string;
  username: string;
  count: number;
}

interface HourlyMessageEntry {
  day: number;
  block: number;
  count: number;
}

interface MonthlyMessageEntry {
  year: number;
  month: number;
  count: number;
}

export default router;
