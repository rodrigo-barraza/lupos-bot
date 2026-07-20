// ============================================================
// DeletedMessageLogger — Deleted Message Audit Trail
// ============================================================
// Handles the Discord `messageDelete` event by:
// 1. Removing the message from the processing queue if pending
// 2. Marking it as cancelled for in-flight processing
// 3. Soft-deleting it in MongoDB (isDeleted + deletedAt) so the
//    Messages collection retains a full audit trail
// 4. Posting a rich embed in the #deleted-messages audit channel
// ============================================================

import type {
  Client,
  Message,
  PartialMessage,
  Attachment,
  Sticker,
  TextChannel,
} from "discord.js";
import type { MongoClient } from "mongodb";
import { EmbedBuilder } from "discord.js";
import config from "#root/config.ts";
import utilities from "#root/utilities.ts";
import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import DiscordState from "#root/services/discord/DiscordState.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";

/**
 * Handle a message deletion event.
 * - Removes from pending queue
 * - Marks as cancelled for in-flight processing
 * - Soft-deletes in MongoDB (sets isDeleted + deletedAt)
 * - Posts audit embed in #deleted-messages
 */
async function handleMessageDelete(
  client: Client,
  mongo: MongoClient,
  message: Message | PartialMessage,
) {
  // Fetch partial messages
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error: unknown) {
      console.error("Failed to fetch partial message:", error);
      return;
    }
  }

  // Cancel any pending or in-flight processing for this message
  const deletedMessageId = message.id;
  // Remove from pending queue
  const removedCount = DiscordState.queuedData.length;
  for (let i = DiscordState.queuedData.length - 1; i >= 0; i--) {
    if (DiscordState.queuedData[i].message?.id === deletedMessageId) {
      DiscordState.queuedData.splice(i, 1);
    }
  }
  if (DiscordState.queuedData.length < removedCount) {
    console.log(
      `🗑️ [DeletedMessageLogger] Removed deleted message ${deletedMessageId} from pending queue.`,
    );
  }
  // Mark as cancelled for in-flight processing
  DiscordState.markCancelled(deletedMessageId);

  // ── Soft-delete in MongoDB ──────────────────────────────────────
  // Tag the message as deleted rather than removing it, so the full
  // audit trail is preserved.  Live consumers filter on
  // { isDeleted: { $ne: true } } via EXCLUDE_SOFT_DELETED.
  try {
    const db = mongo.db(MONGO_DB_NAME);
    const result = await db
      .collection("Messages")
      .updateOne(
        { id: deletedMessageId },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );
    if (result.modifiedCount > 0) {
      console.log(
        `🗑️ [DeletedMessageLogger] Soft-deleted message ${deletedMessageId} in MongoDB (author: ${message.author?.id})`,
      );
    }
  } catch (dbError: unknown) {
    console.warn(
      `🗑️ [DeletedMessageLogger] MongoDB soft-delete failed for ${deletedMessageId}: ${(dbError as Error).message}`,
    );
  }

  // Early returns for invalid cases
  if (message.author?.bot) return;
  if (
    message.channelId === config.CHANNEL_ID_DELETED_MESSAGES ||
    message.channelId === config.CHANNEL_ID_HIGHLIGHTS
  )
    return;
  if (message.guildId !== config.GUILD_ID_PRIMARY) return;

  const deletedMessagesChannel = DiscordUtilityService.getChannelById(
    client,
    config.CHANNEL_ID_DELETED_MESSAGES || "",
  ) as TextChannel | undefined;
  if (!deletedMessagesChannel) return;

  // Extract message data
  const name = DiscordUtilityService.getDisplayNameFromUserOrMember({
    member: message.member ?? undefined,
    user: message.author ?? undefined,
  });
  if (!name) return;

  const avatarUrl = utilities.getDiscordAvatarUrl(
    message.author?.id || "",
    message.author?.avatar || "",
  );
  const channelName = DiscordUtilityService.getChannelName(
    client,
    message.channelId,
  );
  const messageURL = utilities.getDiscordMessageUrl(
    message.guildId,
    message.channelId,
    message.id,
  );

  // Build main embed
  const embed = new EmbedBuilder()
    .setTitle(`🗑️ Deleted Message in #${channelName}`)
    .setURL(messageURL)
    .setAuthor({
      name: name,
      iconURL: avatarUrl || undefined,
      url: messageURL,
    })
    .setColor(0xed4245) // Discord red color
    .setTimestamp(message.createdAt)
    .setFooter({ text: `ID: ${message.id} • User ID: ${message.author?.id}` });

  // Add message content
  if (message.content) {
    const content =
      message.content.length > 4096
        ? message.content.substring(0, 4093) + "..."
        : message.content;
    embed.setDescription(content);
  } else if (message.attachments.size === 0 && message.stickers.size === 0) {
    embed.setDescription("*No text content*");
  }

  // Handle replied-to message
  if (message.reference) {
    try {
      const referenceChannel = DiscordUtilityService.getChannelById(
        client,
        message.reference.channelId,
      ) as TextChannel | undefined;
      if (referenceChannel?.messages) {
        const referenceMessage = await referenceChannel.messages.fetch(
          message.reference.messageId!,
        );

        let replyText = referenceMessage.content || "*No text content*";
        if (replyText.length > 1024) {
          replyText = replyText.substring(0, 1021) + "...";
        }

        const replyAuthor = referenceMessage.author?.tag || "Unknown User";
        embed.addFields({
          name: `↩️ Replying to ${replyAuthor}`,
          value: replyText,
          inline: false,
        });
      }
    } catch (error: unknown) {
      console.error("Failed to fetch reference message:", error);
      embed.addFields({
        name: "↩️ Replying to",
        value: "*[Original message unavailable]*",
      });
    }
  }

  // Collect all embeds to send
  const embeds = [embed];

  // Handle attachments
  if (message.attachments.size > 0) {
    const attachmentArray: Attachment[] = Array.from(
      message.attachments.values(),
    );
    const attachmentInfo: string[] = [];

    attachmentArray.forEach((attachment: Attachment, index: number) => {
      const size = (attachment.size / 1024).toFixed(2);
      const type = attachment.contentType || "unknown";
      attachmentInfo.push(
        `**${index + 1}.** [${attachment.name}](${attachment.url}) • ${size} KB • ${type}`,
      );
    });

    embed.addFields({
      name: `📎 Attachments (${attachmentArray.length})`,
      value: attachmentInfo.join("\n").substring(0, 1024),
      inline: false,
    });

    // Display images (up to 4 total - 1 main + 3 additional)
    const imageAttachments = attachmentArray.filter((att: Attachment) =>
      att.contentType?.startsWith("image/"),
    );

    if (imageAttachments.length > 0) {
      embed.setImage(imageAttachments[0].url);

      // Add additional images as separate embeds (max 3 more)
      for (let i = 1; i < Math.min(imageAttachments.length, 4); i++) {
        embeds.push(
          new EmbedBuilder()
            .setURL(messageURL)
            .setImage(imageAttachments[i].url),
        );
      }
    }
  }

  // Handle stickers
  if (message.stickers.size > 0) {
    const stickerArray: Sticker[] = Array.from(message.stickers.values());
    const stickerInfo = stickerArray
      .map((sticker: Sticker) => `**${sticker.name}** • [View](${sticker.url})`)
      .join("\n");

    embed.addFields({
      name: `🎴 Stickers (${stickerArray.length})`,
      value: stickerInfo.substring(0, 1024),
      inline: false,
    });

    // Show first sticker if no attachments were shown
    if (!embed.data.image && stickerArray[0].url) {
      embed.setImage(stickerArray[0].url);
    }
  }

  // Send to deleted messages channel
  try {
    await deletedMessagesChannel.send({ embeds });
  } catch (error: unknown) {
    console.error("Failed to send deleted message log:", error);
  }
}

export default { handleMessageDelete };
