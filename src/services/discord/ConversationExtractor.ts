// ============================================================
// ConversationExtractor — recent-message → conversation builder
// ============================================================
// Extracted from DiscordService (R1 decomposition). Owns the
// transformation of a Discord channel's recent messages into the
// ChatMessage conversation array sent to the agent, plus the
// per-message content formatters (stickers, attachments, emojis)
// and the per-user conversation-summary cache.
// ============================================================

import crypto from "crypto";
import { Collection } from "discord.js";
import type {
  Message,
  GuildMember,
  User,
  Collection as DiscordCollection,
} from "discord.js";

import AIService from "#root/services/AIService.js";
import type {
  ChatMessage,
  CaptionMapObject,
  TranscriptionMapObject,
} from "#root/services/AIService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import utilities from "#root/utilities.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import { MONGO_DB_NAME } from "#root/constants.js";
import {
  buildDiscordMessageEnvelope,
  buildMessageAnnotation,
  toIsoTime,
} from "#root/services/discord/MessageEnvelope.js";
import type {
  AttachmentPart,
  EmbedPart,
  ReactionsPart,
  ReplyToPart,
  StickerPart,
} from "#root/services/discord/MessageEnvelope.js";

interface MessageProcessingData {
  index: number;
  recentMessage: Message;
  member: GuildMember | null;
  user: User;
  isBot: boolean;
  isLastMessage: boolean;
  userMessageXofY: number;
  sequentialUserMessages: number;
  repliedMessage?: Message;
}
// function to split emoji name and id, example: <:monkaHmm:722280797025075271>
export async function splitEmojiNameAndId(emoji: string) {
  const match = emoji.match(/<(a)?:(.+):(\d+)>/);
  if (match) {
    return {
      animated: !!match[1],
      name: match[2],
      id: match[3],
    };
  }
  return null;
}

export async function extractEmojisFromAllMessage(
  message: Message,
  localMongo: import("mongodb").MongoClient,
  type: string = "EMOJI",
) {
  // Returns a Collection of emojis with their captions
  const messageEmojisCollection = new Collection<string, unknown>();
  const messageEmojis =
    (message as Message).content
      .split(" ")
      .filter((part: string) => /<(a)?:.+:\d+>/g.test(part)) || [];

  if (messageEmojis.length > 0) {
    // Prepare all emoji URLs and create a mapping
    const emojiUrls: string[] = [];
    const emojiMapping = new Map(); // Map URL to original emoji string

    for (const emoji of messageEmojis) {
      const parsedEmoji = emoji.replace(/[\n#]/g, "");
      const parts = parsedEmoji.split(":");
      const lastPart = parts[parts.length - 1] || "";
      const emojiId = lastPart.slice(0, -1);
      const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.png`;

      emojiUrls.push(emojiUrl);
      emojiMapping.set(emojiUrl, emoji);
    }

    // Caption all images at once
    const { imagesMap } = await AIService.captionImages(
      emojiUrls,
      localMongo,
      type,
    );

    // Map the results back to the original emojis
    for (const [_hash, emojiData] of imagesMap) {
      const originalEmoji = emojiMapping.get(emojiData.url);
      if (originalEmoji) {
        messageEmojisCollection.set(originalEmoji, emojiData);
      }
    }
  }

  return messageEmojisCollection;
}

export async function generateUserConversationAndHash(
  queuedDatum: {
    message: import("discord.js").Message;
    recentMessages: import("discord.js").Collection<
      string,
      import("discord.js").Message
    >;
    actionType?: string;
  },
  recentMessage: Message,
  localMongo: import("mongodb").MongoClient,
) {
  // Create a hash of all the this specific user's recent messages
  const { message, recentMessages } = queuedDatum;
  const userMessages = recentMessages.filter(
    (message: Message) =>
      message.author.id === (recentMessage as Message).author.id,
  );
  const userMessagesAsText = userMessages
    .map((message: Message) => (message as Message).content)
    .join("\n\n");
  const hash = crypto
    .createHash("sha256")
    .update(userMessagesAsText)
    .digest("hex");
  // Check if we already have a conversation for this hash
  const db = localMongo.db(MONGO_DB_NAME);
  const collection = db.collection("UserConversationSummaries");
  const existingConversation = await collection.findOne({ hash });
  if (existingConversation) {
    return existingConversation.conversation;
  }
  // If not, generate a new conversation
  const userName =
    DiscordUtilityService.getNameFromItem(recentMessage) || "Unknown";
  const cleanUserName = DiscordUtilityService.getCleanUsernameFromUser(
    message.author,
  );
  const conversation = await AIService.generateTextFromUserConversation(
    userName,
    cleanUserName,
    userMessagesAsText,
  );
  // Store the conversation and hash in the database
  await collection.insertOne({
    hash,
    userId: message.author.id,
    conversation,
    createdAt: new Date(),
  });
  return conversation;
}

export async function extractContentFromMessages(
  queuedDatum: {
    message: import("discord.js").Message;
    recentMessages: import("discord.js").Collection<
      string,
      import("discord.js").Message
    >;
    actionType?: string;
  },
  localMongo: import("mongodb").MongoClient,
  _maxSimultaneous: number = 50,
) {
  const functionName = "extractContentFromMessages";

  const { message, recentMessages } = queuedDatum;

  // All messages are kept as conversation context — bot messages, other users'
  // messages, and the current message. The agent needs the full channel history
  // to understand the ongoing discussion.
  const filteredRecentMessages = recentMessages;

  const totalMessages = filteredRecentMessages.size;

  // Determine how many messages to process — deterministic keyword heuristic
  // (no longer needs timing data or hourly breakdowns)
  const messagesToFetch =
    await AIService.generateTextDetermineHowManyMessagesToFetch(
      (message as Message).content,
      message,
      "",
    );

  console.log(
    `PROCESSING ${messagesToFetch} MESSAGES (out of ${totalMessages} available)`,
  );

  const recentXMessages = filteredRecentMessages.last(messagesToFetch);
  const client = message.client;

  // Initialize collections
  const participantsCollection = new Collection<
    string,
    { user: User; member: GuildMember | null; time?: number }
  >();
  const participantsAvatarsCollection = new Collection<string, string | null>();
  const participantsBannersCollection = new Collection<string, string | null>();
  const participantsUsersCollection = new Collection<string, User>();
  const participantsMembersCollection = new Collection<string, GuildMember>();
  let memberMentionsCollection = new Collection<string, GuildMember>();
  let userMentionsCollection = new Collection<string, User>();
  const messagesImagesCollection = new Collection<
    string,
    DiscordCollection<string, { url: string; caption: string }>
  >();
  const messagesTranscriptionsCollection = new Collection<
    string,
    DiscordCollection<string, { transcription: string }>
  >();
  const messagesEmojisCollection = new Collection<string, unknown>();
  const conversationsCollection = new Collection<string, unknown>();
  const conversation: ChatMessage[] = [];
  const newSystemPrompt = "";

  // Prepare all async operations
  const allPromises = {
    conversations: [] as { userId: string; promise: Promise<unknown> }[],
    emojis: [] as {
      messageId: string;
      promise: Promise<Collection<string, unknown>>;
    }[],
    audio: [] as {
      message: Message;
      promise: Promise<{
        transcriptionsMap: Map<string, TranscriptionMapObject>;
      }>;
    }[],
    images: [] as {
      message: Message;
      promise: Promise<{
        images: string[];
        imagesMap: Map<string, CaptionMapObject>;
      }>;
    }[],
    replies: [] as {
      messageId: string;
      referenceId: string;
      promise: Promise<Message | void | null>;
    }[],
  };

  // First pass: collect all async operations
  const messageProcessingData: MessageProcessingData[] = [];

  if ((message as Message).guild) {
    let index = 0;

    // Real Discord snowflake ids of every message in the fetched window —
    // used to emit compact <replying-to in-context="true" /> references
    // instead of re-quoting messages the model already has in full.
    const inContextMessageIds = new Set(
      recentXMessages.map((recentMessage: Message) => recentMessage.id),
    );

    // Pre-calculate message sequences
    const messageSequenceInfo = new Map();
    let currentSequenceAuthor = null;
    let _currentSequenceStart = -1;
    let currentSequenceMessages: number[] = [];

    for (let i = 0; i < recentXMessages.length; i++) {
      const message = recentXMessages[i];
      const isBot = message.author.id === client.user!.id;

      if (isBot) {
        // If we had a sequence going, finalize it
        if (currentSequenceMessages.length > 0) {
          const total = currentSequenceMessages.length;
          for (const [
            position,
            msgIndex,
          ] of currentSequenceMessages.entries()) {
            messageSequenceInfo.set(msgIndex, {
              xOfY: position + 1,
              total: total,
            });
          }
        }
        // Reset for bot message
        currentSequenceAuthor = null;
        _currentSequenceStart = -1;
        currentSequenceMessages = [];
        // Bot messages don't get sequence info
        messageSequenceInfo.set(i, { xOfY: 0, total: 0 });
      } else {
        // User message
        if (message.author.id !== currentSequenceAuthor) {
          // New author - finalize previous sequence if exists
          if (currentSequenceMessages.length > 0) {
            const total = currentSequenceMessages.length;
            for (const [
              position,
              msgIndex,
            ] of currentSequenceMessages.entries()) {
              messageSequenceInfo.set(msgIndex, {
                xOfY: position + 1,
                total: total,
              });
            }
          }
          // Start new sequence
          currentSequenceAuthor = message.author.id;
          _currentSequenceStart = i;
          currentSequenceMessages = [i];
        } else {
          // Same author - continue sequence
          currentSequenceMessages.push(i);
        }
      }
    }

    // Finalize the last sequence if it exists
    if (currentSequenceMessages.length > 0) {
      const total = currentSequenceMessages.length;
      for (const [position, msgIndex] of currentSequenceMessages.entries()) {
        messageSequenceInfo.set(msgIndex, {
          xOfY: position + 1,
          total: total,
        });
      }
    }

    // Now process messages with the correct counts
    for (const recentMessage of recentXMessages) {
      const member = recentMessage.member;
      const user = (recentMessage as Message).author;

      if (!user || !user.id) {
        console.warn(
          `❌ [DiscordService:getParticipants] User is null or missing ID in message: ${recentMessage.id}`,
        );
        index++;
        continue;
      }

      const isBot = user.id === client.user!.id;
      const isLastMessage = index === recentXMessages.length - 1;

      // Get the sequence info for this message
      const sequenceInfo = messageSequenceInfo.get(index) || {
        xOfY: 0,
        total: 0,
      };
      const userMessageXofY = sequenceInfo.xOfY;
      const sequentialUserMessages = sequenceInfo.total;

      const messageData: MessageProcessingData = {
        index,
        recentMessage,
        member: member ?? null,
        user,
        isBot,
        isLastMessage,
        userMessageXofY,
        sequentialUserMessages,
      };

      if (isBot) {
        // Queue image captioning for the bot's own attachments (generated
        // images). Captions are hash-cached in Mongo, so each image is only
        // vision-captioned once. Without this, the bot's generated images
        // reach the model as bare filenames ("lupos.png") and replies to
        // them carry no indication that an image exists at all.
        const botImageUrls =
          await DiscordUtilityService.extractImageUrlsFromMessage(
            recentMessage,
          );
        if (botImageUrls.length) {
          allPromises.images.push({
            message: recentMessage,
            promise: AIService.captionImages(botImageUrls, localMongo, "IMAGE"),
          });
        }

        messageProcessingData.push(messageData);
      } else {
        // Collect user data
        const userExists = participantsCollection.get(user.id);
        if (!userExists) {
          participantsCollection.set(user.id, { user, member });

          // Queue conversation generation
          allPromises.conversations.push({
            userId: user.id,
            promise: generateUserConversationAndHash(
              queuedDatum,
              recentMessage,
              localMongo,
            ),
          });

          // Store avatar/banner URLs — the agent calls describe_image on-demand
          // instead of pre-captioning every avatar on every message.
          let avatarUrl: string | null = null,
            bannerUrl: string | null = null;
          if (user) {
            avatarUrl = user.avatar
              ? utilities.getDiscordAvatarUrl(user.id, user.avatar)
              : null;
            bannerUrl = user.banner
              ? utilities.getDiscordBannerUrl(user.id, user.banner)
              : null;
          }
          if (member) {
            if (member.avatar) {
              avatarUrl = utilities.getDiscordAvatarUrl(
                member.id,
                member.avatar,
              );
            }
            if (member.banner) {
              bannerUrl = utilities.getDiscordBannerUrl(
                member.id,
                member.banner,
              );
            }
          }

          if (avatarUrl) {
            participantsAvatarsCollection.set(user.id, avatarUrl);
          }
          if (bannerUrl) {
            participantsBannersCollection.set(user.id, bannerUrl);
          }
        } else if (
          userExists.time !== undefined &&
          userExists.time < recentMessage.createdTimestamp
        ) {
          userExists.time = recentMessage.createdTimestamp;
        }

        // Queue emoji extraction
        allPromises.emojis.push({
          messageId: recentMessage.id,
          promise: extractEmojisFromAllMessage(recentMessage, localMongo),
        });

        // Queue audio transcription
        const audioUrls =
          await DiscordUtilityService.extractAudioUrlsFromMessage(
            recentMessage,
          );
        if (audioUrls?.length) {
          allPromises.audio.push({
            message: recentMessage,
            promise: AIService.transcribeAudioUrls(
              audioUrls,
              recentMessage.id,
              localMongo,
            ),
          });
        }

        // Queue image captioning
        const imageUrls =
          await DiscordUtilityService.extractImageUrlsFromMessage(
            recentMessage,
          );
        if (imageUrls.length) {
          allPromises.images.push({
            message: recentMessage,
            promise: AIService.captionImages(imageUrls, localMongo, "IMAGE"),
          });
        }

        // Queue reply fetching
        if (recentMessage.reference?.messageId) {
          const channel = recentMessage.channel || (message as Message).channel;
          const repliedMessage = channel?.messages.cache.get(
            recentMessage.reference.messageId,
          );
          if (!repliedMessage) {
            allPromises.replies.push({
              messageId: recentMessage.id,
              referenceId: recentMessage.reference!.messageId,
              promise: channel?.messages
                .fetch(recentMessage.reference!.messageId as string)
                .catch((error: Error) => {
                  console.log(
                    `Could not fetch replied message ${recentMessage.reference?.messageId}:`,
                    error.message,
                  );
                  return null;
                }),
            });
          } else {
            messageData.repliedMessage = repliedMessage;
          }
        }

        // Store participants
        participantsUsersCollection.set(user.id, user);
        if (member) {
          participantsMembersCollection.set(member.id, member);
        }

        // Store mentions
        const userMentions = recentMessage.mentions.users;
        const memberMentions = recentMessage.mentions.members;
        if (userMentions?.size) {
          userMentionsCollection = new Collection([
            ...userMentionsCollection,
            ...userMentions,
          ]);
        }
        if (memberMentions?.size) {
          memberMentionsCollection = new Collection([
            ...memberMentionsCollection,
            ...memberMentions,
          ]);
        }

        messageProcessingData.push(messageData);
      }

      index++;
    }

    // Rest of your code remains the same...
    // Execute all promises in parallel
    const results = await Promise.allSettled([
      ...allPromises.conversations.map(
        (item: { userId: string; promise: Promise<unknown> }) => item.promise,
      ),
      ...allPromises.emojis.map(
        (item: {
          messageId: string;
          promise: Promise<Collection<string, unknown>>;
        }) => item.promise,
      ),
      ...allPromises.audio.map(
        (item: {
          message: Message;
          promise: Promise<{
            transcriptionsMap: Map<string, TranscriptionMapObject>;
          }>;
        }) => item.promise,
      ),
      ...allPromises.images.map(
        (item: {
          message: Message;
          promise: Promise<{
            images: string[];
            imagesMap: Map<string, CaptionMapObject>;
          }>;
        }) => item.promise,
      ),
      ...allPromises.replies.map(
        (item: {
          messageId: string;
          referenceId: string;
          promise: Promise<Message | void | null>;
        }) => item.promise,
      ),
    ]);

    // Process results
    let resultIndex = 0;

    // Process conversations
    for (const item of allPromises.conversations) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        conversationsCollection.set(
          item.userId,
          (result as PromiseFulfilledResult<unknown>).value,
        );
      }
    }

    // Process emojis
    for (const _item of allPromises.emojis) {
      const result = results[resultIndex++] as PromiseSettledResult<
        Collection<string, unknown>
      >;
      if (result.status === "fulfilled" && result.value?.size) {
        for (const [emoji, emojiObject] of result.value.entries()) {
          messagesEmojisCollection.set(emoji, emojiObject);
        }
      }
    }

    // Process audio
    for (const item of allPromises.audio) {
      const result = results[resultIndex++] as PromiseSettledResult<{
        transcriptionsMap: Map<string, TranscriptionMapObject>;
      }>;
      if (result.status === "fulfilled") {
        const { transcriptionsMap } = result.value;
        messagesTranscriptionsCollection.set(
          item.message.id,
          new Collection(transcriptionsMap),
        );
        for (const [, transcriptionObject] of transcriptionsMap.entries()) {
          console.log(
            ...LogFormatter.transcribeSuccess({
              functionName,
              message: item.message,
              audioUrl: transcriptionObject.url,
              transcription: transcriptionObject.transcription,
              cached: transcriptionObject.cached,
            }),
          );
        }
      }
    }

    // Process images
    for (const item of allPromises.images) {
      const result = results[resultIndex++] as PromiseSettledResult<{
        images: string[];
        imagesMap: Map<string, CaptionMapObject>;
      }>;
      if (result.status === "fulfilled") {
        const { imagesMap } = result.value;
        messagesImagesCollection.set(
          item.message.id,
          new Collection(imagesMap),
        );
        for (const [hash, mapObject] of imagesMap.entries()) {
          console.log(
            ...LogFormatter.captionSuccess({
              functionName,
              hash,
              message: item.message,
              imageUrl: mapObject.url,
              caption: mapObject.caption,
              cached: mapObject.cached,
            }),
          );
        }
      }
    }

    // Process replies
    const repliesMap: Record<string, Message> = {};
    for (const item of allPromises.replies) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled" && result.value) {
        repliesMap[item.messageId] = result.value as Message;
      }
    }

    // Build conversation with all collected data
    for (const messageData of messageProcessingData) {
      const {
        recentMessage,
        user,
        isBot,
        userMessageXofY,
        sequentialUserMessages,
      } = messageData;

      if (isBot) {
        // Assistant turns carry exactly what the bot said. Platform-side
        // context (embeds, reactions, vision captions of the bot's own
        // attachments) goes into a separate <message-annotation> turn so
        // the model never sees structure it didn't author in its own turns.
        conversation.push({
          role: "assistant",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: recentMessage.content || "",
        });

        // Attachment metadata from the bot's own uploads
        const imageAttached = recentMessage.attachments?.find(
          (attachment: import("discord.js").Attachment) =>
            attachment.contentType?.includes("image"),
        );
        const dimensions =
          imageAttached?.width && imageAttached?.height
            ? `${imageAttached.width}x${imageAttached.height}`
            : undefined;
        const sizeMb = imageAttached?.size
          ? (imageAttached.size / 1024 / 1024).toFixed(2)
          : undefined;

        // Vision captions for the bot's own attachments (populated by the
        // captioning queued in the first pass, keyed by message id).
        const botImagesCollection = messagesImagesCollection.get(
          recentMessage.id,
        );
        const botImageCaptions: string[] = botImagesCollection?.size
          ? [...botImagesCollection.values()].map(
              (imageObject) => imageObject.caption,
            )
          : [];

        // Uploader-provided description — for the bot's own generated
        // images this is the generate_image prompt set at upload time.
        const imageDescription = imageAttached
          ? imageAttached.description ||
            imageAttached.title ||
            imageAttached.name.replace(/[_-]/g, " ")
          : undefined;

        const annotationAttachments: AttachmentPart[] = [];
        if (botImageCaptions.length) {
          botImageCaptions.forEach((caption: string, captionIndex: number) => {
            annotationAttachments.push({
              kind: "image",
              caption,
              ...(captionIndex === 0
                ? { description: imageDescription, dimensions, sizeMb }
                : {}),
            });
          });
        } else if (imageAttached) {
          annotationAttachments.push({
            kind: "image",
            caption: imageDescription,
            dimensions,
            sizeMb,
          });
        }

        const annotationEmbeds: EmbedPart[] = (recentMessage.embeds ?? []).map(
          (embed: import("discord.js").Embed) => ({
            title: embed.title || undefined,
            description: embed.description || undefined,
            url: embed.url || undefined,
            fields: embed.fields?.length
              ? embed.fields.map(
                  (field: { name: string; value: string }) =>
                    `${field.name}: ${field.value}`,
                )
              : undefined,
            footer: embed.footer?.text || undefined,
          }),
        );

        const annotation = buildMessageAnnotation({
          forId: recentMessage.id,
          attachments: annotationAttachments,
          embeds: annotationEmbeds,
          reactions: reactionsPartOf(recentMessage),
        });
        if (annotation) {
          conversation.push({
            role: "user",
            name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
            content: annotation,
          });
        }
      } else {
        // ── User message → <discord-message> envelope ─────────────
        const repliedMessage: Message | undefined =
          messageData.repliedMessage ||
          (repliesMap[recentMessage.id] as Message | undefined);

        let replyTo: ReplyToPart | undefined;
        if (recentMessage.reference?.messageId) {
          if (!repliedMessage) {
            replyTo = {
              id: recentMessage.reference.messageId,
              deleted: true,
            };
          } else if (inContextMessageIds.has(repliedMessage.id)) {
            // The quoted message is already in this window verbatim —
            // reference it by id instead of duplicating its content.
            replyTo = {
              id: repliedMessage.id,
              author: displayNameOf(repliedMessage),
              authorId: repliedMessage.author?.id,
              inContext: true,
            };
          } else {
            const repliedParts = await collectMessageBodyParts(
              repliedMessage,
              messagesTranscriptionsCollection,
              messagesImagesCollection,
              localMongo,
            );
            // Reply image URLs are context, not part of the current
            // message — captions are included, images not re-attached.
            replyTo = {
              id: repliedMessage.id,
              author: displayNameOf(repliedMessage),
              authorId: repliedMessage.author?.id,
              time: toIsoTime(repliedMessage.createdTimestamp),
              content: repliedMessage.content || undefined,
              transcription: repliedParts.transcription,
              attachments: repliedParts.attachments,
              sticker: repliedParts.sticker,
              reactions: reactionsPartOf(repliedMessage),
            };
          }
        }

        const bodyParts = await collectMessageBodyParts(
          recentMessage,
          messagesTranscriptionsCollection,
          messagesImagesCollection,
          localMongo,
        );

        // The triggering message is the one the agent must answer; it is
        // also the only one whose reactions matter (bribe detection).
        const isTriggeringMessage =
          recentMessage.id === (message as Message).id;

        const envelopeContent = buildDiscordMessageEnvelope({
          id: recentMessage.id,
          author: displayNameOf(recentMessage) || user.username,
          authorUsername: user.username,
          authorId: user.id,
          time: toIsoTime(recentMessage.createdTimestamp),
          sequence: { index: userMessageXofY, total: sequentialUserMessages },
          mostRecent: isTriggeringMessage,
          edited: !!recentMessage.editedTimestamp,
          replyTo,
          content: recentMessage.content || undefined,
          transcription: bodyParts.transcription,
          attachments: bodyParts.attachments,
          sticker: bodyParts.sticker,
          reactions: isTriggeringMessage
            ? reactionsPartOf(recentMessage)
            : undefined,
        });

        const msgEntry: ChatMessage = {
          role: "user",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: envelopeContent,
        };
        // Attach image URLs to this specific message for multimodal vision
        if (bodyParts.messageImageUrls.length > 0) {
          msgEntry.images = bodyParts.messageImageUrls;
        }
        conversation.push(msgEntry);
      }
    }
  }

  // Clean up collections
  userMentionsCollection = userMentionsCollection.filter(
    (user: User) => !memberMentionsCollection.has(user.id),
  );
  memberMentionsCollection.delete(client.user!.id);

  return {
    conversation,
    conversationsCollection,
    memberMentionsCollection,
    messagesEmojisCollection,
    messagesImagesCollection,
    messagesTranscriptionsCollection,
    newSystemPrompt,
    participantsAvatarsCollection,
    participantsBannersCollection,
    participantsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    userMentionsCollection,
  };
}

/** Display name of a message's author: server nickname > global name > username. */
export function displayNameOf(message: Message): string | undefined {
  return (
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    undefined
  );
}

/** Reactions on a message as a ReactionsPart, or undefined when there are none. */
export function reactionsPartOf(message: Message): ReactionsPart | undefined {
  if (!message.reactions?.cache?.size) return undefined;
  return {
    count: message.reactions.cache.size,
    list: utilities.formatReactions(message.reactions.cache, "inline"),
  };
}

/** Sticker on a message as a StickerPart (vision-captioned), or undefined. */
export async function collectStickerPart(
  message: Message,
  localMongo: import("mongodb").MongoClient,
): Promise<StickerPart | undefined> {
  if (message.stickers.size !== 1) return undefined;
  const sticker = message.stickers.first();
  if (!sticker) return undefined;
  const { images } = await AIService.captionImages(
    [sticker.url],
    localMongo,
    "STICKER",
  );
  return {
    name: sticker.name,
    description: sticker.description || undefined,
    caption: images[0] || undefined,
  };
}

/**
 * Collect the structured body parts of a message — voice transcription,
 * captioned image attachments, and sticker — from the pre-computed
 * per-message collections. Also returns the raw image URLs so the
 * caller can attach them to the ChatMessage for multimodal vision.
 */
export async function collectMessageBodyParts(
  message: Message,
  messagesTranscriptionsCollection: DiscordCollection<
    string,
    DiscordCollection<string, { transcription: string }>
  >,
  messagesImagesCollection: DiscordCollection<
    string,
    DiscordCollection<string, { url: string; caption: string }>
  >,
  localMongo: import("mongodb").MongoClient,
): Promise<{
  transcription?: string;
  attachments: AttachmentPart[];
  sticker?: StickerPart;
  messageImageUrls: string[];
}> {
  const transcriptionsCollection = messagesTranscriptionsCollection.get(
    message.id,
  );
  const imagesCollection = messagesImagesCollection.get(message.id);

  const transcription = transcriptionsCollection?.size
    ? transcriptionsCollection.values().next().value?.transcription ||
      undefined
    : undefined;

  const attachments: AttachmentPart[] = [];
  const messageImageUrls: string[] = [];
  if (imagesCollection?.size) {
    for (const [, image] of imagesCollection.entries()) {
      attachments.push({ kind: "image", caption: image.caption });
      messageImageUrls.push(image.url);
    }
  }

  const sticker = await collectStickerPart(message, localMongo);
  return { transcription, attachments, sticker, messageImageUrls };
}
