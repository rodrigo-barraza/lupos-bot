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

import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
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

interface MessageProcessingData {
  index: number;
  recentMessage: Message;
  member: GuildMember | null;
  user: User;
  isBot: boolean;
  isLastMessage: boolean;
  userMessageXofY: number;
  sequentialUserMessages: number;
  dateIdFormat: string;
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
    const firstMessageDateTime = TemporalHelpers.fromMillis(
      recentXMessages[0].createdTimestamp,
    );
    const lastMessageDateTime = TemporalHelpers.fromMillis(
      recentXMessages[recentXMessages.length - 1].createdTimestamp,
    );
    let dateIdFormat = "yyMMddHHmmSSS";
    if (
      TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "hour")
    ) {
      dateIdFormat = "mSSS";
    } else if (
      TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "day")
    ) {
      dateIdFormat = "HmmSSS";
    } else if (
      TemporalHelpers.hasSame(
        firstMessageDateTime,
        lastMessageDateTime,
        "month",
      )
    ) {
      dateIdFormat = "dHHmmSSS";
    } else if (
      TemporalHelpers.hasSame(firstMessageDateTime, lastMessageDateTime, "year")
    ) {
      dateIdFormat = "MddHHmmSSS";
    }

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
        dateIdFormat,
      };

      if (isBot) {
        // Process bot messages synchronously as they don't need API calls
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
        for (const [hash, transcriptionObject] of transcriptionsMap.entries()) {
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
        isBot,
        isLastMessage,
        userMessageXofY,
        sequentialUserMessages,
        dateIdFormat,
      } = messageData;

      if (isBot) {
        let imageDescription: string | null = null,
          imageSize: number = 0,
          imageWidth: number = 0,
          imageHeight: number = 0;
        let attachmentContext: string | null = null;

        // Bot has attached an image to this message
        if (recentMessage?.attachments?.size > 0) {
          const imageAttached = recentMessage.attachments.find(
            (attachment: import("discord.js").Attachment) =>
              attachment.contentType &&
              attachment.contentType.includes("image"),
          );
          if (imageAttached) {
            if (imageAttached.description) {
              imageDescription = imageAttached.description;
            } else if (imageAttached.title) {
              imageDescription = imageAttached.title;
            } else {
              imageDescription = imageAttached.name.replace(/[_-]/g, " ");
            }

            if (imageAttached.size) {
              imageSize = imageAttached.size / 1024 / 1024;
            }

            if (imageAttached.width && imageAttached.height) {
              imageWidth = imageAttached.width;
              imageHeight = imageAttached.height;
            }
          }
        }

        // Append reactions to content
        let reactionsContent = "";
        if (recentMessage.reactions?.cache?.size > 0) {
          reactionsContent = `\n[REACTIONS]\n${utilities.formatReactions(recentMessage.reactions.cache, "list")}`;
        }

        let _replyContent = "";
        // Append reply context
        if (recentMessage.reference) {
          _replyContent = `\n[REPLYING TO]`;
          const _repliedMessage =
            messageData.repliedMessage || repliesMap[recentMessage.id];
        }

        // If recentMessage has embeds, add them to the content
        let newContent = "";
        if (recentMessage.embeds?.length > 0) {
          for (const embed of recentMessage.embeds) {
            newContent += `\n\n[MESSAGE EMBED]`;
            if (embed.title) {
              newContent += `\nTitle: ${embed.title}`;
            }
            if (embed.description) {
              newContent += `\nDescription: ${embed.description}`;
            }
            if (embed.fields?.length > 0) {
              for (const field of embed.fields) {
                newContent += `\n${field.name}: ${field.value}`;
              }
            }
            if (embed.footer) {
              newContent += `\nFooter: ${embed.footer.text}`;
            }
            if (embed.url) {
              newContent += `\nURL: ${embed.url}`;
            }
          }
        } else {
          newContent = recentMessage.content;
        }

        conversation.push({
          role: "assistant",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: newContent,
        });

        if (imageDescription || reactionsContent) {
          attachmentContext = `=== YOUR MESSAGE CONTEXT ===`;
          attachmentContext += `\nThis is additional context for your message above. Do not respond to this context directly, but use it as information to enhance your understanding of the situation.`;
          if (imageDescription) {
            attachmentContext += `\n[IMAGE ATTACHED]`;
            attachmentContext += `\nDimensions: ${imageWidth}x${imageHeight}`;
            attachmentContext += `\nFile size: ${imageSize.toFixed(2)} MB`;
            attachmentContext += `\nImage description: ${imageDescription}`;
          }
          if (reactionsContent) {
            attachmentContext += `\n[REACTIONS]`;
            attachmentContext += reactionsContent;
          }

          conversation.push({
            role: "user",
            name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
            content: attachmentContext,
          });
        }
      } else {
        // Build user message content with all collected data
        const recentMessageDateTime = TemporalHelpers.fromMillis(
          recentMessage.createdTimestamp,
        );
        const messageId = TemporalHelpers.toDateId(
          recentMessageDateTime,
          dateIdFormat,
        );
        const combinedNames = utilities.getCombinedNamesFromUserOrMember({
          member: recentMessage.member,
        });
        let modifiedContent = `=== MESSAGE ${userMessageXofY} of ${sequentialUserMessages} ${userMessageXofY === sequentialUserMessages && isLastMessage ? "(MOST RECENT)" : ""} ===`;
        modifiedContent += `\n[METADATA]`;
        modifiedContent += `\nFrom: ${combinedNames}`;
        modifiedContent += `\nMessage ID: ${messageId}`;

        // Add reply information
        const repliedMessage: Message | undefined =
          messageData.repliedMessage ||
          (repliesMap[recentMessage.id] as Message | undefined);
        if (recentMessage.reference?.messageId) {
          modifiedContent += `\n\n[REPLYING TO]`;
          if (!repliedMessage) {
            modifiedContent += `\nAuthor: Unknown (DELETED MESSAGE)`;
            modifiedContent += `\nMessage ID: ${recentMessage.reference.messageId}`;
          } else {
            const repliedMessageDateTime = TemporalHelpers.fromMillis(
              repliedMessage.createdTimestamp,
            );
            const replyMessageId = TemporalHelpers.toDateId(
              repliedMessageDateTime,
              dateIdFormat,
            );
            const combinedRepliedNames =
              utilities.getCombinedNamesFromUserOrMember({
                member: repliedMessage.member,
              });
            modifiedContent += `\nAuthor: ${combinedRepliedNames}`;
            modifiedContent += `\nTime: ${TemporalHelpers.format(repliedMessageDateTime, "LLLL dd, yyyy 'at' hh:mm:ss a")} (${TemporalHelpers.toRelative(repliedMessageDateTime)})`;
            modifiedContent += `\nMessage ID: ${replyMessageId}`;

            if (repliedMessage.cleanContent) {
              modifiedContent += `\nType: Text Message`;
              modifiedContent += `\nContent:`;
              modifiedContent += `\n<message_content>`;
              modifiedContent += `\n${repliedMessage.content}`;
              modifiedContent += `\n</message_content>`;
            }

            const repliedAttachmentResult = await generateAttachmentsResponse(
              repliedMessage,
              messagesTranscriptionsCollection,
              messagesImagesCollection,
              repliedMessage,
              modifiedContent,
              localMongo,
            );
            modifiedContent = repliedAttachmentResult.modifiedContent;
            // Reply image URLs will be collected but not attached separately
            // — they belong to context, not the current message

            modifiedContent += await generateEmojiResponse(
              repliedMessage,
              true,
            );
          }
        }

        modifiedContent += `\n\n[CURRENT MESSAGE]`;
        if (recentMessage.content) {
          modifiedContent += `\nType: Text Message`;
          modifiedContent += `\nContent:`;
          modifiedContent += `\n<message_content>`;
          modifiedContent += `\n${recentMessage.content}`;
          modifiedContent += `\n</message_content>`;
        }

        const attachmentResult = await generateAttachmentsResponse(
          recentMessage,
          messagesTranscriptionsCollection,
          messagesImagesCollection,
          recentMessage,
          modifiedContent,
          localMongo,
        );
        modifiedContent = attachmentResult.modifiedContent;

        // Add reactions
        const isCurrentMessage = recentMessage.id !== (message as Message).id;
        if (recentMessage.reactions?.cache?.size > 0 && !isCurrentMessage) {
          modifiedContent += `\nNumber of reactions in this message: ${recentMessage.reactions.cache.size}`;
          modifiedContent += `\nReaction list: ${utilities.formatReactions(recentMessage.reactions.cache, "inline")}`;
        }

        const msgEntry: ChatMessage = {
          role: "user",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: modifiedContent,
        };
        // Attach image URLs to this specific message for multimodal vision
        if (attachmentResult.messageImageUrls.length > 0) {
          msgEntry.images = attachmentResult.messageImageUrls;
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

export async function generateStickerResponse(
  message: Message,
  localMongo: import("mongodb").MongoClient,
) {
  // if sticker
  let content = "";
  if (message.stickers.size === 1) {
    const sticker = message.stickers.first();
    if (!sticker) return "";
    const url = sticker.url;
    const { images } = await AIService.captionImages(
      [url],
      localMongo,
      "STICKER",
    );
    const imageCaption = images[0];
    content += `\nType: Sticker Message`;
    content += `\nSticker Name: ${sticker.name}`;
    if (sticker.description) {
      content += `\nSticker Description: ${sticker.description}`;
    }
    if (imageCaption) {
      content += `\nSticker Caption: ${imageCaption}`;
    }
  }
  return content;
}

export async function generateAttachmentsResponse(
  message: Message,
  messagesTranscriptionsCollection: DiscordCollection<
    string,
    DiscordCollection<string, { transcription: string }>
  >,
  messagesImagesCollection: DiscordCollection<
    string,
    DiscordCollection<string, { url: string; caption: string }>
  >,
  userMessage: Message,
  modifiedContent: string,
  localMongo: import("mongodb").MongoClient,
) {
  const transcriptionsCollection = messagesTranscriptionsCollection.get(
    userMessage.id,
  );
  const imagesCollection = messagesImagesCollection.get(userMessage.id);
  const messageImageUrls: string[] = []; // Collect image URLs to attach to message

  if (!(message as Message).content) {
    if ((transcriptionsCollection?.size ?? 0) > 0) {
      // iterate through the first one only
      const audioTranscriptions =
        transcriptionsCollection!.values().next().value?.transcription || "";
      modifiedContent += `\nType: Voice Message`;
      modifiedContent += `\nAudio Content:`;
      modifiedContent += `\n<audio_transcription>`;
      modifiedContent += `\n${audioTranscriptions}`;
      modifiedContent += `\n</audio_transcription>`;
    }
    if (!(transcriptionsCollection?.size ?? 0) && imagesCollection?.size) {
      modifiedContent += `\nType: Image Message`;
      modifiedContent += `\n\n[ATTACHED REFERENCE IMAGES]`;
      let imgIndex = 0;
      for (const [, image] of imagesCollection.entries()) {
        imgIndex++;
        modifiedContent += `\n  ${imgIndex}. Attachment: ${image.caption}`;
        messageImageUrls.push(image.url);
      }
    }
  } else {
    if (transcriptionsCollection?.size ?? 0) {
      const audioTranscriptions =
        transcriptionsCollection!.values().next().value?.transcription || "";
      modifiedContent += `\nAudio Transcription: ${audioTranscriptions}`;
    }
    if (imagesCollection?.size) {
      modifiedContent += `\n\n[ATTACHED REFERENCE IMAGES]`;
      let imgIndex = 0;
      for (const [, image] of imagesCollection.entries()) {
        imgIndex++;
        modifiedContent += `\n  ${imgIndex}. Attachment: ${image.caption}`;
        messageImageUrls.push(image.url);
      }
    }
  }

  modifiedContent += await generateStickerResponse(userMessage, localMongo);
  return { modifiedContent, messageImageUrls };
}

export async function generateEmojiResponse(
  message: Message,
  _isReply: boolean = false,
) {
  if (!message.reactions?.cache?.size) return "";
  const names = utilities.formatReactions(message.reactions.cache, "names");
  return `\nReactions (${message.reactions.cache.size}):\n  • ${names}`;
}
