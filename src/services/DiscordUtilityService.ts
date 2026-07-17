import utilities from "#root/utilities.js";
const { consoleLog } = utilities;
import config from "#root/config.js";
import { Collection, Events, ActivityType } from "discord.js";
import ScraperService from "#root/services/ScraperService.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import {
  Message,
  Guild,
  User,
  Client,
  TextChannel,
  GuildEmoji,
  Presence,
  VoiceState,
  Interaction,
  GuildMember,
  PartialGuildMember,
  PartialMessage,
  Role,
  PresenceStatusData,
} from "discord.js";
import MessageArchive, {
  type FetchMessagesOptions,
} from "#root/services/discord/MessageArchive.js";
import ChannelAnalytics from "#root/services/discord/ChannelAnalytics.js";
import { errorMessage } from "#root/services/discord/errors.js";

/** Options for MongoDB-backed operations. */
interface MongoConnections {
  mongo: import("mongodb").MongoClient;
  localMongo?: import("mongodb").MongoClient;
}

/**
 * Run an event handler, awaiting it and containing any error so a rejection
 * in one handler can never become an unhandled promise rejection that kills
 * the process. Used by all onEvent* registration wrappers below.
 */
async function runEventHandler(
  eventName: string,
  handler: (...args: unknown[]) => void | Promise<void>,
  ...args: unknown[]
) {
  try {
    await handler(...args);
  } catch (error: unknown) {
    console.error(
      `❌ [DiscordUtilityService:${eventName}] Unhandled error in event handler:`,
      error,
    );
  }
}

const DiscordUtilityService = {
  // Bulk scraping/archival + Mongo persistence — implementation moved to
  // discord/MessageArchive.ts (R1 split); delegated here so existing
  // callers of the DiscordUtilityService facade keep working unchanged.
  fetchAndSaveAllServerMessages: MessageArchive.fetchAndSaveAllServerMessages,
  purgeDeletedMessagesForUsers: MessageArchive.purgeDeletedMessagesForUsers,
  backfillMediaArchive: MessageArchive.backfillMediaArchive,
  deleteDuplicateMessagesByID: MessageArchive.deleteDuplicateMessagesByID,
  /**
   * Shared username sanitization: replaces spaces with underscores,
   * removes non-word characters.


   */
  _sanitizeUsername(name: string) {
    if (!name) return "default";
    return name.replace(/\s+/g, "_").replace(/[^\w]/gi, "") || "default";
  },
  getUsernameNoSpaces(message: Message) {
    const name =
      message?.author?.displayName ||
      message?.author?.username ||
      (message as Message & { user?: User })?.user?.username;
    return DiscordUtilityService._sanitizeUsername(name ?? "");
  },

  // Mongo message persistence — moved to discord/MessageArchive.ts (R1 split).
  saveMessageToMongo: MessageArchive.saveMessageToMongo,
  updateMessageInMongo: MessageArchive.updateMessageInMongo,
  syncReactionsToMongo: MessageArchive.syncReactionsToMongo,

  async extractAudioUrlsFromMessage(message: Message) {
    const audioUrls: string[] = [];
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isAudio = attachment.contentType?.includes("audio/ogg");
        if (isAudio) {
          audioUrls.push(attachment.url);
        }
      }
    }
    return audioUrls;
  },
  async extractImageUrlsFromMessage(message: Message) {
    const imageUrls: string[] = [];
    // Attachments
    if (message?.attachments?.size) {
      for (const attachment of message.attachments.values()) {
        const isImage = attachment.contentType?.includes("image/");
        if (isImage) {
          imageUrls.push(attachment.url);
        }
      }
    }
    // Content
    if (message?.content) {
      // Process URLs in message content
      const urls = message.content.match(/(https?:\/\/[^\s]+)/g);
      if (urls?.length) {
        for (const url of urls) {
          if (!url.includes("https://tenor.com/view/")) {
            const isImage = await utilities.isImageUrl(url);
            if (isImage) {
              imageUrls.push(url);
            }
          } else {
            const tenorImage = await ScraperService.scrapeTenor(url);
            if (tenorImage?.image) {
              imageUrls.push(tenorImage.image);
            } else {
              console.warn(
                `⚠️ [extractImageUrlsFromMessage] Could not extract image from Tenor URL: ${url}`,
              );
            }
          }
        }
      }
    }

    return imageUrls;
  },
  async retrieveMessageReferenceFromMessage(message: Message) {
    let messageReference: Message | null;
    if (message?.reference && message.reference.messageId) {
      messageReference =
        message.channel.messages.cache.get(message.reference.messageId) ?? null;
      if (!messageReference) {
        try {
          messageReference = await message.channel.messages.fetch(
            message.reference.messageId,
          );
        } catch (error: unknown) {
          console.error("Error fetching message reference:", error);
        }
      }
    }
    return messageReference!;
  },
  getDisplayNameFromUserOrMember({
    user,
    member,
  }: {
    user?: User;
    member?: GuildMember;
  }) {
    let displayName: string | null = null;
    if (user || member) {
      displayName = user?.displayName || member?.displayName || null;
    }
    return displayName;
  },
  getCleanUsernameFromUser(user: User) {
    // Replaces periods/hashes with underscores first, then delegates to shared sanitizer
    const raw = user?.username?.replace(/[.#]/g, "_");
    return DiscordUtilityService._sanitizeUsername(raw);
  },
  async getDisplayName(message: Message, userId: string) {
    let displayName: string | null = null;
    if (message && message.guild && userId) {
      const member = await DiscordUtilityService.retrieveMemberFromGuildById(
        message.guild,
        userId,
      );
      if (member) {
        displayName = member.displayName;
      } else {
        const user = await DiscordUtilityService.getUserFromClientAndId(
          message.client,
          userId,
        );
        if (user) {
          displayName = user.displayName;
        }
      }
    }
    return displayName;
  },
  /**
   * Resolve display name from a user object.
   * Priority: displayName → globalName → username.
   */
  getNameFromUser(user: User) {
    return user?.displayName || user?.globalName || user?.username || undefined;
  },
  getUserMentionFromMessage(message: Message) {
    if (message) {
      // Find out why author and why user are different
      const userId =
        message?.author?.id || (message as Message & { user?: User })?.user?.id;
      return `<@${userId}>`;
    }
  },
  getDiscordTagFromMessage(message: Message) {
    if (message) {
      const userTag =
        message?.author?.tag ||
        (message as Message & { user?: User })?.user?.tag;
      return userTag;
    }
  },
  async printOutAllRoles(client: Client) {
    // print out all roles in the order that they are in the server
    consoleLog("<", "printOutAllRoles");
    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) return;
    const roles = guild.roles.cache;
    const orderedRoles = roles
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .reverse();
    consoleLog(
      "=",
      `Printing out all roles in the order that they are in the server`,
    );
    for (const role of orderedRoles.values()) {
      console.log(`${role.name} - ${role.id}`);
    }
    consoleLog(">", "printOutAllRoles");
  },
  async printOutAllEmojis(client: Client) {
    consoleLog("<", "printOutAllEmojis");
    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) return;
    const emojis = guild.emojis.cache;
    consoleLog("=", `Printing out all emojis in the server`);
    for (const emoji of emojis.values()) {
      console.log(`${emoji.name} - ${emoji.id}`);
    }
    consoleLog(">", "printOutAllEmojis");
  },
  async retrieveMemberFromGuildById(guild: Guild, userId: string) {
    if (guild && userId) {
      let member = guild.members.cache.get(userId);
      if (!member) {
        try {
          member = await guild.members.fetch(userId);
        } catch {
          return null;
        }
      }
      return member;
    }
  },
  // Canonical user-fetch: cache → fetch with optional force
  async getUserFromClientAndId(
    client: Client,
    userId: string,
    force: boolean = false,
  ) {
    let user = client.users.cache.get(userId);
    if (!user) {
      try {
        user = await client.users.fetch(userId, { force });
      } catch (error: unknown) {
        consoleLog(
          "!",
          `Could not fetch user with ID ${userId}. Error: ${errorMessage(error)}`,
        );
        return null;
      }
    }
    return user;
  },
  // Sync cache-only lookup (no fetch)
  getUserByClientAndId(client: Client, userId: string) {
    return client.users.cache.get(userId);
  },
  // Convenience wrapper for message context
  async getUserFromMessage(message: Message, force: boolean = false) {
    return DiscordUtilityService.getUserFromClientAndId(
      message.client,
      message.author.id,
      force,
    );
  },
  // Event Handlers
  onEventClientReady(
    client: Client,
    options: Record<string, unknown>,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.ClientReady, () => {
      void runEventHandler("clientReady", customFunction, client, options);
    });
  },
  onEventMessageCreate(
    client: Client,
    { mongo, localMongo }: MongoConnections,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.MessageCreate, (message: Message) => {
      void runEventHandler(
        "messageCreate",
        customFunction,
        client,
        { mongo, localMongo },
        message,
      );
    });
  },
  onEventMessageUpdate(
    client: Client,
    { mongo, localMongo }: MongoConnections,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(
      Events.MessageUpdate,
      (
        oldMessage: Message | PartialMessage,
        newMessage: Message | PartialMessage,
      ) => {
        void runEventHandler(
          "messageUpdate",
          customFunction,
          client,
          { mongo, localMongo },
          oldMessage,
          newMessage,
        );
      },
    );
  },
  onEventMessageDelete(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.MessageDelete, (message) => {
      void runEventHandler(
        "messageDelete",
        customFunction,
        client,
        mongo,
        message,
      );
    });
  },
  onEventMessageReactionAdd(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.MessageReactionAdd, (reaction, user) => {
      void runEventHandler(
        "messageReactionAdd",
        customFunction,
        client,
        mongo,
        reaction,
        user,
      );
    });
  },
  onEventMessageReactionRemove(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.MessageReactionRemove, (reaction, user) => {
      void runEventHandler(
        "messageReactionRemove",
        customFunction,
        client,
        mongo,
        reaction,
        user,
      );
    });
  },
  onEventGuildMemberAdd(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.GuildMemberAdd, (member: GuildMember) => {
      void runEventHandler(
        "guildMemberAdd",
        customFunction,
        client,
        mongo,
        member,
      );
    });
  },
  onEventGuildMemberAvailable(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.GuildMemberAvailable, (member) => {
      void runEventHandler(
        "guildMemberAvailable",
        customFunction,
        client,
        mongo,
        member,
      );
    });
  },
  onEventInteractionCreate(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.InteractionCreate, (interaction: Interaction) => {
      void runEventHandler(
        "interactionCreate",
        customFunction,
        client,
        mongo,
        interaction,
      );
    });
  },
  onEventPresenceUpdate(
    client: Client,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(
      Events.PresenceUpdate,
      (oldPresence: Presence | null, newPresence: Presence) => {
        void runEventHandler(
          "presenceUpdate",
          customFunction,
          client,
          oldPresence,
          newPresence,
        );
      },
    );
  },
  onEventVoiceStateUpdate(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(
      Events.VoiceStateUpdate,
      (oldState: VoiceState, newState: VoiceState) => {
        void runEventHandler(
          "voiceStateUpdate",
          customFunction,
          client,
          mongo,
          oldState,
          newState,
        );
      },
    );
  },
  onEventGuildMemberRemove(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(Events.GuildMemberRemove, (member) => {
      void runEventHandler(
        "guildMemberRemove",
        customFunction,
        client,
        mongo,
        member,
      );
    });
  },
  onEventGuildMemberUpdate(
    client: Client,
    mongo: import("mongodb").MongoClient,
    customFunction: (...args: unknown[]) => void,
  ) {
    return client.on(
      Events.GuildMemberUpdate,
      (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
        void runEventHandler(
          "guildMemberUpdate",
          customFunction,
          client,
          mongo,
          oldMember,
          newMember,
        );
      },
    );
  },
  async getAllServerEmojisFromMessage(
    message: Message,
    format: "string" | "array" = "string",
  ) {
    // format can be: array, string
    if (message.guild?.emojis.cache.size) {
      const emojis = message.guild.emojis.cache.map((emoji: GuildEmoji) => {
        return {
          id: emoji.id,
          name: emoji.name,
          url: emoji.url,
        };
      });
      if (format === "array") {
        return emojis;
      } else if (format === "string") {
        return emojis
          .map(
            (emoji: { name: string; id: string }) =>
              `<${emoji.name}:${emoji.id}>`,
          )
          .join(", ");
      }
    } else {
      return [];
    }
  },
  // Special functions
  async fetchMessages(
    client: Client,
    channelId: string,
    options: FetchMessagesOptions = {},
  ) {
    const channel = client.channels.cache.find((ch) => ch.id === channelId) as
      | TextChannel
      | undefined;

    if (!channel) return null;

    const { limit = 10, before, after, around, cache = true } = options;

    let allMessages = new Collection<string, Message>();

    // Metrics tracking
    const _startTime = Date.now();

    // If 'around' is specified, fetch once and return (Discord API behavior)
    if (around) {
      const messages = await channel!.messages.fetch({
        limit: Math.min(100, limit),
        around,
        cache,
      });
      return messages;
    }

    // Determine pagination direction and cursor
    const isAfterMode = after && !before;
    let cursor: string | undefined;

    // Initial fetch
    const initialFetchOptions: FetchMessagesOptions = {
      limit: Math.min(100, limit),
      cache,
    };

    if (before) initialFetchOptions.before = before;
    if (after) initialFetchOptions.after = after;

    let messages = await channel!.messages.fetch(
      initialFetchOptions as import("discord.js").FetchMessagesOptions,
    );
    allMessages = allMessages.concat(messages);

    // Continue fetching if we need more messages
    while (allMessages.size < limit && messages.size !== 0) {
      // Update cursor based on direction
      if (isAfterMode) {
        // When using 'after', get the newest message ID for next fetch
        cursor = messages.first()?.id;
      } else {
        // When using 'before' or default, get the oldest message ID
        cursor = messages.last()?.id;
      }

      if (!cursor) break;

      const additionalMessagesNeeded = limit - allMessages.size;

      const fetchOptions: FetchMessagesOptions = {
        limit: Math.min(100, additionalMessagesNeeded),
        cache,
      };

      // Set the appropriate cursor
      if (isAfterMode) {
        fetchOptions.after = cursor;
      } else {
        fetchOptions.before = cursor;
      }

      messages = await channel!.messages.fetch(
        fetchOptions as import("discord.js").FetchMessagesOptions,
      );

      // Avoid duplicates (Discord API might return overlapping messages)
      const uniqueMessages = messages.filter(
        (message: Message) => !allMessages.has(message.id),
      );
      allMessages = allMessages.concat(uniqueMessages);

      // Break if no new messages were added (to prevent infinite loops)
      if (uniqueMessages.size === 0) break;
    }

    // Trim collection if we fetched more than needed
    if (allMessages.size > limit) {
      const trimmedCollection = new Collection<string, Message>();
      let count = 0;

      // Maintain message order based on fetch direction
      const messageArray: Message[] = Array.from(allMessages.values());
      if (isAfterMode) {
        // For 'after' mode, keep the oldest messages first
        messageArray.reverse();
      }

      for (const message of messageArray) {
        if (count >= limit) break;
        trimmedCollection.set(message.id, message);
        count++;
      }

      return trimmedCollection;
    }

    return allMessages;
  },
  async getOrFetchChannelByChannelId(client: Client, channelId: string) {
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = (await client.channels.fetch(channelId)) ?? undefined;
      } catch (error: unknown) {
        consoleLog(
          "!",
          `Could not fetch channel with ID ${channelId}. Error: ${errorMessage(error)}`,
        );
        return null;
      }
    }
    return channel;
  },
  // User functions
  getBotName(client: Client) {
    return client.user?.tag;
  },
  setUserActivity(client: Client, message: string) {
    return client.user?.setActivity(message, { type: ActivityType.Custom });
  },
  // Channel functions
  getChannelById(client: Client, channelId: string) {
    return client.channels.cache.get(channelId);
  },
  getChannelName(client: Client, channelId: string) {
    return (client.channels.cache.get(channelId) as TextChannel | undefined)
      ?.name;
  },
  // Guilds functions
  getGuildById(client: Client, guildId: string) {
    return client.guilds.cache.get(guildId);
  },
  getAllGuilds(client: Client) {
    let guildsCollection:
      | import("discord.js").Collection<string, Guild>
      | undefined;
    if (client) {
      guildsCollection = client.guilds.cache;
    }
    return guildsCollection;
  },
  getNameFromItem(item: Message | Interaction) {
    const discordMessage = item as Message & { user?: User };
    return (
      discordMessage?.author?.displayName ||
      discordMessage?.author?.username ||
      discordMessage?.user?.globalName ||
      discordMessage?.user?.username
    );
  },
  // REST functions
  async patchBanner(client: Client, imageUrl: string) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," + Buffer.from(imageUrl).toString("base64"),
      },
    });
  },
  async patchBannerFromImageUrl(client: Client, imageUrl: string) {
    return await client.rest.patch("/users/@me", {
      body: {
        banner:
          "data:image/gif;base64," +
          Buffer.from(await (await fetch(imageUrl)).bytes()).toString("base64"),
      },
    });
  },
  async getBannerFromUserId(client: Client, userId: string) {
    const getUser = (await client.rest.get(`/users/${userId}`)) as Record<
      string,
      unknown
    >;
    return getUser.banner;
  },
  // Typing functions
  async startTypingInterval(channel: TextChannel) {
    // Fire-and-forget — never await sendTyping(). Its promise can hang
    // indefinitely if discord.js's internal rate limit queue is stuck
    // (e.g., after a Discord API outage). Typing is cosmetic.
    channel.sendTyping().catch((error: Error) => {
      console.warn(
        `⚠️ [startTypingInterval] Initial sendTyping failed: ${error.message}`,
      );
    });
    // Refresh typing every 5s (Discord auto-clears after 10s)
    const sendTypingInterval = setInterval(() => {
      channel.sendTyping().catch((error: Error) => {
        // Self-clear so a dead channel doesn't spam failing requests —
        // and say so, otherwise "typing never shows" is undebuggable.
        console.warn(
          `⚠️ [startTypingInterval] sendTyping failed in #${channel.name}, stopping refresh: ${error.message}`,
        );
        if (sendTypingInterval) {
          clearInterval(sendTypingInterval);
        }
      });
    }, 5000);
    return sendTypingInterval;
  },
  clearTypingInterval(sendTypingInterval: NodeJS.Timeout) {
    if (sendTypingInterval) clearInterval(sendTypingInterval);
    return null;
  },
  // Message functions
  /**
   * Discord's per-attachment upload cap for the message's destination.
   * Bots inherit the guild's boost tier: 10 MB base, 50 MB at tier 2,
   * 100 MB at tier 3. DMs get the base cap.
   */
  getUploadLimitBytes(message: Message): number {
    const premiumTier = message.guild?.premiumTier ?? 0;
    const limitMegabytes = premiumTier >= 3 ? 100 : premiumTier >= 2 ? 50 : 10;
    return limitMegabytes * 1024 * 1024;
  },
  /**
   * Resolve a tool-result media reference to a fetchable URL. Display
   * envelopes usually carry public MinIO URLs, but raw-payload promotions
   * stamp `minio://` refs — those are served by Prism's file endpoint.
   */
  resolveMediaUrl(reference: string): string {
    if (reference.startsWith("minio://")) {
      return `${config.PRISM_API_URL}/files/${reference.replace("minio://", "")}`;
    }
    return reference;
  },
  /**
   * Download tool-result media for attaching to a Discord message.
   * Returns the bytes + content type when the file fits under
   * `uploadLimitBytes`; returns `fallbackUrl` (the original reference)
   * when it is too large or the fetch fails, so the caller can post the
   * link instead.
   */
  async fetchAttachableMedia(
    mediaUrl: string,
    uploadLimitBytes: number,
  ): Promise<
    | { buffer: Buffer; contentType: string; fallbackUrl: null }
    | { buffer: null; contentType: null; fallbackUrl: string }
  > {
    const fallback = {
      buffer: null,
      contentType: null,
      fallbackUrl: mediaUrl,
    } as const;
    try {
      const response = await fetch(
        DiscordUtilityService.resolveMediaUrl(mediaUrl),
        { signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok) {
        console.error(
          `[fetchAttachableMedia] Failed to fetch ${mediaUrl}: ${response.status}`,
        );
        return fallback;
      }
      const contentLengthBytes = parseInt(
        response.headers.get("content-length") || "0",
        10,
      );
      if (contentLengthBytes > uploadLimitBytes) return fallback;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > uploadLimitBytes) return fallback;
      return {
        buffer,
        contentType: response.headers.get("content-type") || "",
        fallbackUrl: null,
      };
    } catch (fetchError) {
      console.error(
        `[fetchAttachableMedia] Error fetching ${mediaUrl}:`,
        fetchError,
      );
      return fallback;
    }
  },
  async sendMessageInChunks(
    sendOrReply: "send" | "reply",
    message: Message,
    generatedTextResponse: string | null,
    encodedImageDataBase64: Buffer | null,
    imagePrompt: string | null,
    audioRef?: string | null,
    videoUrl?: string | null,
    imageUrl?: string | null,
  ) {
    const messageChunkSizeLimit = 2000;
    let fileName = "lupos.png";
    let imageDescription = "";
    let returnedFirstMessage: Message | null = null;

    if (imagePrompt) {
      fileName = `${imagePrompt.substring(0, 240)}.png`;
      imageDescription = imagePrompt.substring(0, 1000);
    }

    // Fetch audio binary from Prism file service if audioRef is provided
    let audioBuffer: Buffer | null = null;
    let audioExtension = "wav";
    if (audioRef) {
      try {
        const audioFileKey = audioRef.startsWith("minio://")
          ? audioRef.replace("minio://", "")
          : audioRef;
        const audioUrl = `${config.PRISM_API_URL}/files/${audioFileKey}`;
        const audioResponse = await fetch(audioUrl, {
          signal: AbortSignal.timeout(10000),
        });
        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuffer);
          const contentType = audioResponse.headers.get("content-type");
          if (contentType) {
            if (contentType.includes("mpeg") || contentType.includes("mp3")) {
              audioExtension = "mp3";
            } else if (contentType.includes("ogg")) {
              audioExtension = "ogg";
            } else if (contentType.includes("webm")) {
              audioExtension = "webm";
            } else if (
              contentType.includes("wav") ||
              contentType.includes("wave")
            ) {
              audioExtension = "wav";
            }
          }
        } else {
          console.error(
            `[sendMessageInChunks] Failed to fetch audio from ${audioUrl}: ${audioResponse.status}`,
          );
        }
      } catch (audioFetchError) {
        console.error(
          "[sendMessageInChunks] Error fetching audio:",
          audioFetchError,
        );
      }
    }

    // Fetch tool-result media from their display-envelope URLs
    // (display.kind === "video" from trim_video, kind === "image" from
    // emoji kitchen / QR / charts / GIF conversions, …). When a file
    // exceeds the guild's upload cap — or the fetch fails — fall back to
    // posting the URL itself as a follow-up message.
    const uploadLimitBytes = DiscordUtilityService.getUploadLimitBytes(message);
    let videoBuffer: Buffer | null = null;
    let videoExtension = "mp4";
    let videoFallbackUrl: string | null = null;
    if (videoUrl) {
      const media = await DiscordUtilityService.fetchAttachableMedia(
        videoUrl,
        uploadLimitBytes,
      );
      videoBuffer = media.buffer;
      videoFallbackUrl = media.fallbackUrl;
      if (media.contentType?.includes("webm")) videoExtension = "webm";
      else if (media.contentType?.includes("quicktime")) videoExtension = "mov";
    }
    let toolImageBuffer: Buffer | null = null;
    let toolImageExtension = "png";
    let toolImageFallbackUrl: string | null = null;
    if (imageUrl) {
      const media = await DiscordUtilityService.fetchAttachableMedia(
        imageUrl,
        uploadLimitBytes,
      );
      toolImageBuffer = media.buffer;
      toolImageFallbackUrl = media.fallbackUrl;
      if (media.contentType?.includes("gif")) toolImageExtension = "gif";
      else if (media.contentType?.includes("jpeg")) toolImageExtension = "jpg";
      else if (media.contentType?.includes("webp")) toolImageExtension = "webp";
      else if (media.contentType?.includes("svg")) toolImageExtension = "svg";
    }

    const mediaFallbackUrls = [videoFallbackUrl, toolImageFallbackUrl].filter(
      (url): url is string => !!url,
    );

    // Handle media-only response (image/audio/video but no text)
    if (
      (!generatedTextResponse || generatedTextResponse.length === 0) &&
      (encodedImageDataBase64 ||
        audioBuffer ||
        videoBuffer ||
        toolImageBuffer ||
        mediaFallbackUrls.length > 0)
    ) {
      const files: import("discord.js").AttachmentPayload[] = [];
      if (encodedImageDataBase64) {
        files.push({
          attachment: encodedImageDataBase64,
          name: fileName,
          description: imageDescription,
        });
      }
      if (audioBuffer) {
        const audioTimestamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 14);
        files.push({
          attachment: audioBuffer,
          name: `${audioTimestamp}.${audioExtension}`,
          description: "Generated audio",
        });
      }
      if (videoBuffer) {
        files.push({
          attachment: videoBuffer,
          name: `clip.${videoExtension}`,
          description: "Video clip",
        });
      }
      if (toolImageBuffer) {
        files.push({
          attachment: toolImageBuffer,
          // Prompt-derived name/description when this is a streamed
          // generate_image (raw buffer absent) — context rebuilds read it.
          name: imagePrompt
            ? `${imagePrompt.substring(0, 240)}.${toolImageExtension}`
            : `image.${toolImageExtension}`,
          description: imagePrompt ? imageDescription : "Generated image",
        });
      }
      const mediaOnlyOptions: Record<string, unknown> = { files };
      // Oversized/unfetchable media with no text: URLs become the body.
      if (mediaFallbackUrls.length > 0) {
        mediaOnlyOptions.content = mediaFallbackUrls.join("\n");
      }
      if (sendOrReply === "send") {
        return await (message.channel as TextChannel).send(mediaOnlyOptions);
      } else {
        return await message.reply(mediaOnlyOptions);
      }
    }

    for (
      let i = 0;
      i < generatedTextResponse!.length;
      i += messageChunkSizeLimit
    ) {
      const chunk = generatedTextResponse!.substring(
        i,
        i + messageChunkSizeLimit,
      );
      let messageReplyOptions: Record<string, unknown> = { content: chunk };
      const files: import("discord.js").AttachmentPayload[] = [];

      const isLastChunk =
        i + messageChunkSizeLimit >= generatedTextResponse!.length;

      if (encodedImageDataBase64 && isLastChunk) {
        files.push({
          attachment: encodedImageDataBase64,
          name: fileName,
          description: imageDescription,
        });
      }
      if (audioBuffer && isLastChunk) {
        const audioTimestamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 14);
        files.push({
          attachment: audioBuffer,
          name: `${audioTimestamp}.${audioExtension}`,
          description: "Generated audio",
        });
      }
      if (videoBuffer && isLastChunk) {
        files.push({
          attachment: videoBuffer,
          name: `clip.${videoExtension}`,
          description: "Video clip",
        });
      }
      if (toolImageBuffer && isLastChunk) {
        files.push({
          attachment: toolImageBuffer,
          name: imagePrompt
            ? `${imagePrompt.substring(0, 240)}.${toolImageExtension}`
            : `image.${toolImageExtension}`,
          description: imagePrompt ? imageDescription : "Generated image",
        });
      }
      messageReplyOptions = { ...messageReplyOptions, files: files };
      if (sendOrReply === "send") {
        const sentMessage = await (message.channel as TextChannel).send(
          messageReplyOptions,
        );
        if (!returnedFirstMessage) {
          returnedFirstMessage = sentMessage;
        }
      } else if (sendOrReply === "reply") {
        const repliedMessage = await message.reply(messageReplyOptions);
        if (!returnedFirstMessage) {
          returnedFirstMessage = repliedMessage;
        }
      }
    }
    // Oversized/unfetchable media alongside text: post the URLs as their
    // own follow-up message so they never push a chunk past the
    // 2000-char cap.
    if (mediaFallbackUrls.length > 0) {
      await (message.channel as TextChannel).send({
        content: mediaFallbackUrls.join("\n"),
      });
    }
    return returnedFirstMessage!;
  },
  // Utility functions — reports-mode analytics moved to
  // discord/ChannelAnalytics.ts (R1 split). These are thin wrappers rather
  // than bare property references because ChannelAnalytics imports
  // DiscordUtilityService back (for fetchMessages); deferring the property
  // access to call time keeps the circular import safe under any load order.
  async displayAllChannelActivity(client: Client) {
    return ChannelAnalytics.displayAllChannelActivity(client);
  },
  async calculateMessagesSentOnAveragePerDayInChannel(
    client: Client,
    channelId: string,
  ) {
    return ChannelAnalytics.calculateMessagesSentOnAveragePerDayInChannel(
      client,
      channelId,
    );
  },
  async addRoleToMember(member: GuildMember, roleId: string) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: Role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        !member.roles.cache.some((r: Role) => r.id === roleId)
      ) {
        if (!role) return;
        await member.roles.add(role);
        console.log(...LogFormatter.roleAdded(member, role));
      }
    } catch (error: unknown) {
      if (!role) return;
      console.error(
        ...LogFormatter.roleFailedToAdd(
          member,
          role,
          error instanceof Error ? error : new Error(errorMessage(error)),
        ),
      );
    }
  },
  async removeRoleFromMember(member: GuildMember, roleId: string) {
    const guild = member.guild;
    const role = guild.roles.cache.find((role: Role) => role.id === roleId);

    try {
      if (
        !member.user.bot &&
        member.roles.cache.some((r: Role) => r.id === roleId)
      ) {
        if (!role) return;
        await member.roles.remove(role);
        console.log(...LogFormatter.roleRemoved(member, role));
      }
    } catch (error: unknown) {
      if (!role) return;
      console.error(
        ...LogFormatter.roleFailedToRemove(
          member.user.id,
          role,
          error instanceof Error ? error : new Error(errorMessage(error)),
        ),
      );
    }
  },
  async setUserStatus(client: Client, status: PresenceStatusData) {
    try {
      if (!client.user) return;
      await client.user.setStatus(status);
      console.log(`Set bot status to ${status}`);
    } catch (error: unknown) {
      console.error(
        `Failed to set bot status to ${status}:`,
        errorMessage(error),
      );
    }
  },
};

export default DiscordUtilityService;
