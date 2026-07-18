// ============================================================
// DmInboxService — incoming-DM relay to the dm-inbox channel
// ============================================================
// Lupos never converses over DMs, so replies people send it (e.g.
// responses to the invite-DM campaign) used to vanish unseen. This
// relays every incoming human DM as an embed to a #dm-inbox channel
// in the testing guild (Lupos Logs):
//   - channel resolution order: CHANNEL_ID_DM_INBOX config override →
//     existing #dm-inbox in GUILD_ID_TESTING → auto-create it,
//   - when the sender is a DM-campaign target, the embed says so
//     (status + when their invite was sent) for instant context.
// Fire-and-forget: never throws into the message pipeline.

import { ChannelType, EmbedBuilder } from "discord.js";
import type { Client, Guild, Message, TextChannel } from "discord.js";

import config from "#root/config.js";
import MongoService from "#root/services/MongoService.js";
import utilities from "#root/utilities.js";
import { MONGO_DB_NAME } from "#root/constants.js";
import { CAMPAIGN_ID } from "#root/services/DmCampaignService.js";

const INBOX_CHANNEL_NAME = "dm-inbox";
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_LIMIT = 1024;
const EMBED_COLOR = 0x5865f2;

// ─── Pure embed builder (exported for unit tests) ──────────────

export interface InboxMessageData {
  authorTag: string;
  authorId: string;
  authorAvatarUrl: string | null;
  content: string;
  attachmentUrls: string[];
  stickerNames: string[];
  campaignTarget: { status: string; sentAt: Date | null } | null;
  createdAt: Date;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function buildInboxEmbed(data: InboxMessageData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({
      name: `${data.authorTag} (${data.authorId})`,
      ...(data.authorAvatarUrl ? { iconURL: data.authorAvatarUrl } : {}),
    })
    .setDescription(
      truncate(data.content || "*(no text content)*", EMBED_DESCRIPTION_LIMIT),
    )
    .setTimestamp(data.createdAt);

  if (data.attachmentUrls.length > 0) {
    embed.addFields({
      name: "Attachments",
      value: truncate(data.attachmentUrls.join("\n"), EMBED_FIELD_LIMIT),
    });
  }
  if (data.stickerNames.length > 0) {
    embed.addFields({
      name: "Stickers",
      value: truncate(data.stickerNames.join(", "), EMBED_FIELD_LIMIT),
    });
  }
  if (data.campaignTarget) {
    const sentAt = data.campaignTarget.sentAt
      ? ` — invite sent <t:${Math.floor(data.campaignTarget.sentAt.getTime() / 1000)}:R>`
      : "";
    embed.addFields({
      name: "DM campaign",
      value: `Target status: **${data.campaignTarget.status}**${sentAt}`,
    });
  }
  return embed;
}

// ─── Channel resolution ────────────────────────────────────────

let cachedChannelId: string | null = null;
let warnedNoChannel = false;

function asTextChannel(channel: unknown): TextChannel | null {
  const candidate = channel as { type?: ChannelType } | null;
  return candidate?.type === ChannelType.GuildText
    ? (candidate as TextChannel)
    : null;
}

async function resolveInboxChannel(client: Client): Promise<TextChannel | null> {
  if (cachedChannelId) {
    const channel = asTextChannel(
      client.channels.cache.get(cachedChannelId) ??
        (await client.channels.fetch(cachedChannelId).catch(() => null)),
    );
    if (channel) return channel;
    cachedChannelId = null;
  }

  if (config.CHANNEL_ID_DM_INBOX) {
    const channel = asTextChannel(
      await client.channels
        .fetch(config.CHANNEL_ID_DM_INBOX as string)
        .catch(() => null),
    );
    if (channel) {
      cachedChannelId = channel.id;
      return channel;
    }
  }

  const guild: Guild | undefined = client.guilds.cache.get(
    (config.GUILD_ID_TESTING as string) ?? "",
  );
  if (!guild) return null;

  let channel = asTextChannel(
    guild.channels.cache.find(
      (guildChannel) =>
        guildChannel.type === ChannelType.GuildText &&
        guildChannel.name === INBOX_CHANNEL_NAME,
    ),
  );
  if (!channel) {
    channel = await guild.channels
      .create({
        name: INBOX_CHANNEL_NAME,
        type: ChannelType.GuildText,
        reason: "Lupos DM inbox — relays incoming direct messages",
      })
      .catch((error: unknown) => {
        console.warn(
          `📥 [DmInboxService] Could not create #${INBOX_CHANNEL_NAME}: ${utilities.errorMessage(error)}`,
        );
        return null;
      });
  }
  if (channel) cachedChannelId = channel.id;
  return channel;
}

// ─── Campaign context lookup ───────────────────────────────────

async function lookupCampaignTarget(
  userId: string,
): Promise<{ status: string; sentAt: Date | null } | null> {
  try {
    const document = await MongoService.getClient("local")
      ?.db(MONGO_DB_NAME)
      .collection("DmCampaignTargets")
      .findOne({ _id: `${CAMPAIGN_ID}:${userId}` as never });
    if (!document) return null;
    return {
      status: (document.status as string) ?? "unknown",
      sentAt: (document.sentAt as Date | null) ?? null,
    };
  } catch {
    return null; // context is nice-to-have; never block the relay
  }
}

// ─── Relay ─────────────────────────────────────────────────────

async function relayDirectMessage(
  client: Client,
  message: Message,
): Promise<void> {
  try {
    const channel = await resolveInboxChannel(client);
    if (!channel) {
      if (!warnedNoChannel) {
        warnedNoChannel = true;
        console.warn(
          "📥 [DmInboxService] No inbox channel available — incoming DMs are not being relayed",
        );
      }
      return;
    }

    const embed = buildInboxEmbed({
      authorTag: message.author.tag,
      authorId: message.author.id,
      authorAvatarUrl: message.author.displayAvatarURL(),
      content: message.content,
      attachmentUrls: [...message.attachments.values()].map(
        (attachment) => attachment.url,
      ),
      stickerNames: [...message.stickers.values()].map(
        (sticker) => sticker.name,
      ),
      campaignTarget: await lookupCampaignTarget(message.author.id),
      createdAt: message.createdAt,
    });
    await channel.send({ embeds: [embed] });
  } catch (error: unknown) {
    console.warn(
      `📥 [DmInboxService] Failed to relay DM from ${message.author?.tag}: ${utilities.errorMessage(error)}`,
    );
  }
}

const DmInboxService = {
  relayDirectMessage,
  buildInboxEmbed,
};

export default DmInboxService;
