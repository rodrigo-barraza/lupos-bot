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

    res.json({ guildId, guildName: guild.name, channels });
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

    // Collect online members (online, idle, dnd — not offline)
    const onlineMembers = guild.members.cache.filter(
      (m) =>
        m.presence &&
        m.presence.status &&
        m.presence.status !== "offline" &&
        !m.user.bot,
    );

    // Build role hierarchy for grouping.
    // Only hoisted roles (role.hoist === true) appear as sidebar
    // category headers — mirrors Discord's own member list behavior.
    const roleMap = new Map();
    const ungrouped = [];

    for (const [, member] of onlineMembers) {
      // Get all non-@everyone roles sorted highest first
      const sortedRoles = member.roles.cache
        .filter((r) => r.id !== guild.id) // Exclude @everyone
        .sort((a, b) => b.position - a.position);

      // Find the highest hoisted role for sidebar grouping
      const hoistedRole = sortedRoles.find((r) => r.hoist);

      const memberData = {
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        avatarUrl: buildAvatarUrl(member.user, member),
        status: member.presence?.status || "offline",
        activity: member.presence?.activities?.[0]?.name || null,
        isBot: member.user.bot,
        roleColor: member.displayHexColor !== "#000000" ? member.displayHexColor : null,
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

    // Also count total members and bots
    const botMembers = guild.members.cache.filter(
      (m) =>
        m.user.bot &&
        m.presence &&
        m.presence.status !== "offline",
    );

    const bots = botMembers.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      username: m.user.username,
      avatarUrl: buildAvatarUrl(m.user, m),
      status: m.presence?.status || "offline",
      isBot: true,
      roleColor: m.displayHexColor !== "#000000" ? m.displayHexColor : null,
    }));

    res.json({
      guildId,
      guildName: guild.name,
      totalOnline: onlineMembers.size + botMembers.size,
      totalMembers: guild.memberCount,
      roles,
      bots,
    });
  } catch (error) {
    console.error("[guild/members] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch members", detail: error.message });
  }
});

// ─── POST /guild/rescrape ───────────────────────────────────────
// Triggers a targeted rescrape of specific channels to refresh
// embed data and other message fields in MongoDB.
// Body: { guildId?, channelIds: ["..."], dateLimit? }

router.post("/guild/rescrape", async (req, res) => {
  try {
    const guildId = req.body.guildId || config.GUILD_ID_CLOCK_CREW;
    const { channelIds, dateLimit = "2025-01-01" } = req.body;

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "channelIds array is required" });
    }

    const client = DiscordWrapper.getClient("lupos");
    const MongoService = (await import("#root/services/MongoService.js")).default;
    const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.js")).default;
    const localMongo = MongoService.getClient("local");

    // Respond immediately — the scrape runs in the background
    res.json({
      status: "started",
      guildId,
      channelIds,
      dateLimit,
      message: `Rescraping ${channelIds.length} channel(s) in the background`,
    });

    // Fire and forget
    DiscordUtilityService.fetchAndSaveAllServerMessages(
      client,
      localMongo,
      guildId,
      { channelIds, dateLimit, autoResume: false },
    ).then(() => {
      console.log(`[guild/rescrape] Completed rescrape of ${channelIds.length} channel(s)`);
    }).catch((err) => {
      console.error("[guild/rescrape] Error:", err.message);
    });
  } catch (error) {
    console.error("[guild/rescrape] Error:", error.message, error.stack);
    res.status(500).json({ error: "Failed to start rescrape", detail: error.message });
  }
});

export default router;
