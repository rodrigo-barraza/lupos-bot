// ============================================================
// ReactionHighlights — Reaction-Based Highlight System
// ============================================================
// When a message accumulates enough unique reactors, it gets
// posted (or updated) as an embed in the #highlights channel.
// Uses a BoundedMap-backed queue to prevent memory leaks from
// tracking reaction data for every message ever reacted to.
// ============================================================

import type { Client, MessageReaction, PartialMessageReaction, User, PartialUser, TextChannel, Message } from "discord.js";
import type { MongoClient } from "mongodb";
import { EmbedBuilder, DiscordAPIError } from "discord.js";
import config from "#root/config.js";
import utilities from "#root/utilities.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import ScraperService from "#root/services/ScraperService.js";
import DiscordState from "#root/services/discord/DiscordState.js";
import EventReactJob from "#root/jobs/event-driven/ReactJob.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import MongoService from "#root/services/MongoService.js";

interface QueuedReaction {
  reaction: MessageReaction | PartialMessageReaction;
  user: User | PartialUser;
}

interface HighlightPostDocument {
  messageId: string;
  highlightMessageId: string;
  guildId: string;
  channelId: string;
  createdAt: Date;
}

const HIGHLIGHT_POSTS_COLLECTION = "HighlightPosts";

/**
 * Look up the highlight-channel message already posted for a source
 * message. The in-memory map only survives 4 hours (BoundedMap TTL) and
 * dies on restart, so Mongo is the durable source of truth — without it
 * a late reaction re-posts the highlight instead of editing it.
 */
async function findExistingHighlightId(messageId: string): Promise<string | null> {
  const cached = DiscordState.reactionMessages.get(messageId);
  if (cached) return cached;
  try {
    const doc = await MongoService.getDb("local")
      .collection<HighlightPostDocument>(HIGHLIGHT_POSTS_COLLECTION)
      .findOne({ messageId });
    return doc?.highlightMessageId ?? null;
  } catch (lookupErr: unknown) {
    console.warn(
      `[ReactionHighlights] Highlight lookup failed for ${messageId}: ${(lookupErr as Error).message}`,
    );
    return null;
  }
}

/**
 * Persist the source-message → highlight-message mapping so dedup
 * survives restarts and in-memory TTL eviction.
 */
async function saveHighlightPost(doc: HighlightPostDocument): Promise<void> {
  try {
    await MongoService.getDb("local")
      .collection<HighlightPostDocument>(HIGHLIGHT_POSTS_COLLECTION)
      .updateOne(
        { messageId: doc.messageId },
        { $set: doc },
        { upsert: true },
      );
  } catch (saveErr: unknown) {
    console.warn(
      `[ReactionHighlights] Highlight save failed for ${doc.messageId}: ${(saveErr as Error).message}`,
    );
  }
}

/**
 * Process a single reaction event — check unique reactor count,
 * build/update highlight embed if threshold is met.
 */
async function processCreateReaction(client: Client, queuedReaction: QueuedReaction) {
  const functionName = "processCreateReaction";
  const { reaction, user } = queuedReaction;

  const highlightsChannel = config.CHANNEL_ID_HIGHLIGHTS;
  const uniqueUserLengthTrigger = 5;

  // Fetch partial messages/reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error: unknown) {
      console.error("Error fetching partial reaction:", error);
      return;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error: unknown) {
      console.error("Error fetching partial reaction message:", error);
      return;
    }
  }

  const messageId = reaction.message.id;
  const channelId = reaction.message.channelId;
  const channelName = (reaction.message.channel as TextChannel).name;
  const guildId = reaction.message.guild!.id;
  const userId = user.id;
  const content = reaction.message.content;

  // Skip highlights and NSFW channels
  if (
    channelId === config.CHANNEL_ID_HIGHLIGHTS ||
    channelId === config.CHANNEL_ID_BOOTY_BAE
  )
    return;

  DiscordState.allUniqueUsers.getOrInsert(messageId, new Set<string>()).add(userId);

  let users;
  try {
    users = await reaction.users.fetch();
  } catch (fetchErr: unknown) {
    // Message was deleted between the reaction event and this fetch — non-critical
    if (fetchErr instanceof DiscordAPIError && (fetchErr.code === 10008 || fetchErr.code === 10003)) {
      console.warn(`[ReactionHighlights] Skipping deleted message ${messageId} (code ${fetchErr.code})`);
      return;
    }
    throw fetchErr;
  }
  const uniqueUsers = DiscordState.allUniqueUsers.getOrInsert(messageId, new Set<string>());
  users.forEach((reactUser: User) => uniqueUsers.add(reactUser.id));
  console.log(...LogFormatter.reactionAdded(functionName, user as User, reaction as MessageReaction));
  if (uniqueUsers.size >= uniqueUserLengthTrigger) {
    const attachments = reaction.message.attachments;
    const stickers = reaction.message.stickers;
    const name = DiscordUtilityService.getDisplayNameFromUserOrMember({
      member: reaction.message.member as import("discord.js").GuildMember | undefined,
      user: reaction.message.author as import("discord.js").User | undefined,
    });
    const avatarUrl = utilities.getDiscordAvatarUrl(reaction.message.author?.id ?? "", reaction.message.author?.avatar ?? "") || "";

    const emojiId = reaction.emoji.id;
    const emojiName = reaction.emoji.name;
    const isEmojiAnimated = reaction.emoji.animated;
    let emojiUrl: string | undefined;

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
    let referenceMessage: Message | undefined;

    if (referenceChannelId) {
      const currentReferenceChannel = DiscordUtilityService.getChannelById(
        client,
        referenceChannelId,
      ) as TextChannel | undefined;

      if (currentReferenceChannel?.messages) {
        referenceMessage =
          await currentReferenceChannel.messages.fetch(referenceMessageId!);
      }
    }

    const targetChannel = DiscordUtilityService.getChannelById(
      client,
      highlightsChannel!,
    ) as TextChannel;

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

    const uniqueUserCount = DiscordState.allUniqueUsers.get(messageId)?.size ?? 0;
    const totalReactions =
      uniqueUserCount > reaction.message.reactions.cache.size
        ? uniqueUserCount
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
      const match = content!.match(regex);
      const url = match ? match[0] : "";
      const tenorImage = await ScraperService.scrapeTenor(url);
      embed.setImage(tenorImage.image ?? null);
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

    const existingMessageId = await findExistingHighlightId(messageId);
    if (existingMessageId) {
      try {
        const message = await targetChannel.messages.fetch(existingMessageId);
        await message.edit({ embeds: [embed] });
        DiscordState.reactionMessages.set(messageId, existingMessageId);
        return;
      } catch (fetchErr: unknown) {
        // Highlight message was deleted from the channel — fall through
        // and post a fresh one. Anything else is a real failure.
        if (!(fetchErr instanceof DiscordAPIError) || fetchErr.code !== 10008) {
          throw fetchErr;
        }
      }
    }

    const message = await targetChannel.send({ embeds: [embed] });
    DiscordState.reactionMessages.set(messageId, message.id);
    await saveHighlightPost({
      messageId,
      highlightMessageId: message.id,
      guildId,
      channelId,
      createdAt: new Date(),
    });
  }
}

/**
 * Queue a reaction event for sequential processing.
 * Runs EventReactJob first, then queues for highlight processing.
 */
async function handleReactionCreate(client: Client, mongo: MongoClient, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (reaction.message.guild!.id !== config.GUILD_ID_PRIMARY) return;

  await EventReactJob.processJob(client, mongo, reaction as MessageReaction, user as User);
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
    const localMongo = MongoService.getClient("local")!;
    await DiscordUtilityService.syncReactionsToMongo(reaction.message as Message<boolean>, localMongo);
  } catch (syncErr: unknown) {
    console.warn(`[ReactionHighlights] MongoDB reaction sync failed: ${(syncErr as Error).message}`);
  }

  if (isHighlightChannel) return;
  if (isNSFWChannel) return;

  DiscordState.reactionQueue.push({ reaction, user });

  if (!DiscordState.isProcessingOnReactionQueue) {
    DiscordState.isProcessingOnReactionQueue = true;
    while (DiscordState.reactionQueue.length > 0) {
      const queuedReaction = DiscordState.reactionQueue.shift() as QueuedReaction;
      try {
        await processCreateReaction(client, queuedReaction);
      } catch (err: unknown) {
        const code = err instanceof DiscordAPIError ? err.code : "N/A";
        console.error(`[ReactionHighlights] Queue item failed (code ${code}): ${(err as Error).message}`);
      }
    }
    DiscordState.isProcessingOnReactionQueue = false;
    return;
  }
}

/**
 * Handle a reaction removal — sync updated reactions to MongoDB.
 */
async function handleReactionRemove(client: Client, _mongo: MongoClient, reaction: MessageReaction | PartialMessageReaction, _user: User | PartialUser) {
  if (reaction.message.guild?.id !== config.GUILD_ID_PRIMARY) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const localMongo = MongoService.getClient("local")!;
    await DiscordUtilityService.syncReactionsToMongo(reaction.message as Message<boolean>, localMongo);
  } catch (syncErr: unknown) {
    // Partial fetch can fail if the message was deleted — non-critical
    if (!(syncErr instanceof DiscordAPIError) || syncErr.code !== 10008) {
      console.warn(`[ReactionHighlights] MongoDB reaction remove sync failed: ${(syncErr as Error).message}`);
    }
  }
}

export default { handleReactionCreate, handleReactionRemove, processCreateReaction };
