// ============================================================
// ReactionHighlights — Reaction-Based Highlight System
// ============================================================
// When a message accumulates enough unique reactors, it gets
// posted (or updated) as an embed in the #highlights channel.
// Uses a BoundedMap-backed queue to prevent memory leaks from
// tracking reaction data for every message ever reacted to.
// ============================================================

import { EmbedBuilder } from "discord.js";
import config from "#root/config.js";
import utilities from "#root/utilities.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import ScraperService from "#root/services/ScraperService.js";
import DiscordState from "#root/services/discord/DiscordState.js";
import EventReactJob from "#root/jobs/event-driven/ReactJob.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import MongoService from "#root/services/MongoService.js";

/**
 * Process a single reaction event — check unique reactor count,
 * build/update highlight embed if threshold is met.
 */
async function processCreateReaction(client: any, queuedReaction: any) {
  const functionName = "processCreateReaction";
  const { reaction, user } = queuedReaction;

  const highlightsChannel = config.CHANNEL_ID_HIGHLIGHTS;
  const uniqueUserLengthTrigger = 5;

  // Fetch partial messages/reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error: any) {
      console.error("Error fetching partial reaction:", error);
      return;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error: any) {
      console.error("Error fetching partial reaction message:", error);
      return;
    }
  }

  const messageId = reaction.message.id;
  const channelId = reaction.message.channelId;
  const channelName = reaction.message.channel.name;
  const guildId = reaction.message.guild.id;
  const userId = user.id;
  const content = reaction.message.content;

  // Skip highlights and NSFW channels
  if (
    channelId === config.CHANNEL_ID_HIGHLIGHTS ||
    channelId === config.CHANNEL_ID_BOOTY_BAE
  )
    return;

  if (!DiscordState.allUniqueUsers.has(messageId)) {
    DiscordState.allUniqueUsers.set(messageId, new Set());
  } else {
    DiscordState.allUniqueUsers.get(messageId).add(userId);
  }

  const users = await reaction.users.fetch();
  users.map((user: any) => DiscordState.allUniqueUsers.get(messageId).add(user.id));
  console.log(...LogFormatter.reactionAdded(functionName, user, reaction));
  if ([...DiscordState.allUniqueUsers.get(messageId)].length >= uniqueUserLengthTrigger) {
    const attachments = reaction.message.attachments;
    const stickers = reaction.message.stickers;
    const name = DiscordUtilityService.getDisplayNameFromUserOrMember({
      member: reaction.message.member,
      user: reaction.message.author,
    });
    const avatarUrl = utilities.getDiscordAvatarUrl(reaction.message.author?.id, reaction.message.author?.avatar) || "";

    const emojiId = reaction._emoji.id;
    const emojiName = reaction._emoji.name;
    const isEmojiAnimated = reaction._emoji.animated;
    let emojiUrl: any;

    const doesContentContainTenorText = content?.includes(
      "https://tenor.com/view/",
    );

    if (!name) return;

    if (emojiId && isEmojiAnimated) {
      emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.gif`;
    } else if (emojiId && !isEmojiAnimated) {
      emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.png`;
    }

    const _banner = reaction.message.author?.banner;
    const reference = reaction.message.reference;
    const referenceChannelId = reference?.channelId;
    const _referenceGuildId = reference?.guildId;
    const referenceMessageId = reference?.messageId;
    let referenceMessage: any;

    const currentReferenceChannel = DiscordUtilityService.getChannelById(
      client,
      referenceChannelId,
    );

    if (currentReferenceChannel?.messages) {
      referenceMessage =
        await currentReferenceChannel.messages.fetch(referenceMessageId);
    }

    const targetChannel = DiscordUtilityService.getChannelById(
      client,
      highlightsChannel,
    );

    const messageURL = utilities.getDiscordMessageUrl(guildId, channelId, messageId);

    const embed = new EmbedBuilder()
      .setTitle(`#${channelName}`)
      .setURL(messageURL);

    if (referenceMessage) {
      const referenceAttachments = referenceMessage.attachments;
      const referenceStickers = referenceMessage.stickers;
      if (referenceMessage.content) {
        embed.addFields({
          name: "Replying To",
          value: referenceMessage.content,
        });
      }
      if (referenceAttachments) {
        for (const attachment of referenceAttachments.values()) {
          embed.setImage(attachment.url);
        }
      }
      if (referenceStickers) {
        for (const sticker of referenceStickers.values()) {
          embed.setImage(sticker.url);
        }
      }
    }

    const totalReactions =
      [...DiscordState.allUniqueUsers.get(messageId)].length >
      reaction.message.reactions.cache.size
        ? [...DiscordState.allUniqueUsers.get(messageId)].length
        : reaction.message.reactions.cache.size;

    embed.addFields({
      name: "Reactions",
      value: `${emojiId ? "❤️" : emojiName} ${totalReactions}`,
    });

    if (emojiUrl) {
      embed.setThumbnail(emojiUrl);
    }

    if (avatarUrl) {
      embed.setAuthor({ name: name, iconURL: avatarUrl, url: messageURL });
    } else {
      embed.setAuthor({ name: name, url: messageURL });
    }

    if (content) {
      embed.setDescription(content);
    }

    if (doesContentContainTenorText) {
      const regex = /(https:\/\/tenor\.com\/view\/\S*)/;
      const match = content.match(regex);
      const url = match ? match[0] : "";
      const tenorImage = await ScraperService.scrapeTenor(url);
      embed.setImage(tenorImage.image);
    }

    if (attachments) {
      for (const attachment of attachments.values()) {
        embed.setImage(attachment.url);
      }
    }

    if (stickers) {
      for (const sticker of stickers.values()) {
        embed.setImage(sticker.url);
      }
    }

    embed.setTimestamp(new Date(reaction.message.createdTimestamp));
    embed.setFooter({
      text: messageId,
      iconURL:
        "https://cdn.discordapp.com/icons/609471635308937237/cfeccc9c5372c8ae8130b184fd1c5346.png?size=256",
    });

    if (!DiscordState.reactionMessages.has(messageId)) {
      const message = await targetChannel.send({ embeds: [embed] });
      DiscordState.reactionMessages.set(messageId, message.id);
    } else {
      const message = await targetChannel.messages.fetch(
        DiscordState.reactionMessages.get(messageId),
      );
      await message.edit({ embeds: [embed] });
    }
  }
}

/**
 * Queue a reaction event for sequential processing.
 * Runs EventReactJob first, then queues for highlight processing.
 */
async function handleReactionCreate(client: any, mongo: any, reaction: any, user: any) {
  if (reaction.message.guild.id !== config.GUILD_ID_PRIMARY) return;

  await EventReactJob.processJob(client, mongo, reaction, user);
  const isHighlightChannel =
    reaction.message.channelId === config.CHANNEL_ID_HIGHLIGHTS;
  const isNSFWChannel =
    reaction.message.channelId === config.CHANNEL_ID_BOOTY_BAE;

  // ── Sync reactions to MongoDB ─────────────────────────────────
  // Always sync regardless of channel — keeps the Messages
  // collection current for the SSE-powered DiscordChatComponent.
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const localMongo = MongoService.getClient("local");
    await DiscordUtilityService.syncReactionsToMongo(reaction.message, localMongo);
  } catch (syncErr: any) {
    console.warn(`[ReactionHighlights] MongoDB reaction sync failed: ${syncErr.message}`);
  }

  if (isHighlightChannel) return;
  if (isNSFWChannel) return;

  DiscordState.reactionQueue.push({ reaction, user });

  if (!DiscordState.isProcessingOnReactionQueue) {
    DiscordState.isProcessingOnReactionQueue = true;
    while (DiscordState.reactionQueue.length > 0) {
      const queuedReaction = DiscordState.reactionQueue.shift();
      await processCreateReaction(client, queuedReaction);
    }
    DiscordState.isProcessingOnReactionQueue = false;
    return;
  }
}

/**
 * Handle a reaction removal — sync updated reactions to MongoDB.
 */
async function handleReactionRemove(client: any, mongo: any, reaction: any, _user: any) {
  if (reaction.message.guild?.id !== config.GUILD_ID_PRIMARY) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const localMongo = MongoService.getClient("local");
    await DiscordUtilityService.syncReactionsToMongo(reaction.message, localMongo);
  } catch (syncErr: any) {
    // Partial fetch can fail if the message was deleted — non-critical
    if (syncErr.code !== 10008) {
      console.warn(`[ReactionHighlights] MongoDB reaction remove sync failed: ${syncErr.message}`);
    }
  }
}

export default { handleReactionCreate, handleReactionRemove, processCreateReaction };
