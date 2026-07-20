import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import { Collection, ChannelType, EmbedBuilder } from "discord.js";
import type {
  Message,
  Client,
  GuildMember,
  User,
  Presence,
  VoiceState,
  MessageReaction,
  PartialMessageReaction,
  PartialMessage,
  Interaction,
  Guild,
  TextChannel,
  Collection as DiscordCollection,
} from "discord.js";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import config from "#root/config.js";

import { DISCORD_GUILDS, DISCORD_USERS } from "@rodrigo-barraza/utilities-library/taxonomy";

import channels from "#root/arrays/channels.js";

import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import YouTubeService from "#root/services/YouTubeService.js";
import MongoService from "#root/services/MongoService.js";
import PrismService from "#root/services/PrismService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import type { ChatMessage } from "#root/services/AIService.js";
import CurrentService from "#root/services/CurrentService.js";

import BirthdayJob from "#root/jobs/scheduled/BirthdayJob.js";
import ActivityRoleAssignmentJob from "#root/jobs/scheduled/ActivityRoleAssignmentJob.js";

import PermanentTimeOutJob from "#root/jobs/scheduled/PermanentTimeOutJob.js";
import RandomTagJob from "#root/jobs/scheduled/RandomTagJob.js";
import ServerIconJob from "#root/jobs/scheduled/ServerIconJob.js";
import CountdownIconJob from "#root/jobs/scheduled/CountdownIconJob.js";
import EventReactJob from "#root/jobs/event-driven/ReactJob.js";
import { reconcileInterruptedGames } from "#root/commands/utility/deathroll/persistence.js";
import { reconcileInterruptedRoyales } from "#root/commands/utility/deathroll/royalePersistence.js";
import { reconcileInterruptedHeists } from "#root/commands/utility/heist/heistPersistence.js";

import utilities from "#root/utilities.js";
import type { TransformedPrismResponse } from "#root/types/prism.js";
// EXTRACTED MODULES (Phase 1 decomposition)
import DeletedMessageLogger from "#root/services/discord/DeletedMessageLogger.js";
import DiscordState from "#root/services/discord/DiscordState.js";
import type { QueuedMessageData } from "#root/services/discord/DiscordState.js";
import ButtonRouter from "#root/services/discord/ButtonRouter.js";
import DmInboxService from "#root/services/discord/DmInboxService.js";
import { extractContentFromMessages } from "#root/services/discord/ConversationExtractor.js";
import type { ExtractContentOptions } from "#root/services/discord/ConversationExtractor.js";
import ChannelSessionCache from "#root/services/discord/ChannelSessionCache.js";
import AIService from "#root/services/AIService.js";
import { buildMessageAnnotation } from "#root/services/discord/MessageEnvelope.js";
import type { AttachmentPart } from "#root/services/discord/MessageEnvelope.js";
import { buildAndGenerateReply } from "#root/services/discord/PromptBuilder.js";
import { AgentStatusTracker } from "#root/services/discord/AgentStatusTracker.js";
import {
  formatEmotionDetail,
  formatMoodStatusLine,
  type PrismSomaticSnapshot,
} from "#root/formatters/SomaticStatsFormatter.js";
import {
  luposOnReadyDeleteNewAccounts,
  luposOnReadyPurgeYoungAccounts,
  revokeRoleFromAllMembers,
} from "#root/services/discord/ModerationSweeps.js";
// Importing BirthdayOnboarding also registers its "birthday-month-" button handler
import BirthdayOnboarding from "#root/services/discord/BirthdayOnboarding.js";
import { luposOnChannelCreate } from "#root/services/discord/OnboardingDefaults.js";
// Importing RolePicker also registers its "pick-role-" button handler
// with ButtonRouter at module load.
import { generateRolesEmbedMessage } from "#root/services/discord/RolePicker.js";
import BoundedMap from "#root/utilities/BoundedMap.js";
import type { Command } from "#root/commands/types.js";
import ReactionHighlights from "#root/services/discord/ReactionHighlights.js";
import PresenceTracker from "#root/services/discord/PresenceTracker.js";

import LogFormatter from "#root/formatters/LogFormatter.js";

import {
  APRIL_FOOLS_MODE,
  EXPLOSION_GIFS,
  YOUTUBE_BUTTON_ACTIONS,
  MONGO_DB_NAME,
} from "#root/constants.js";
import CensorService from "#root/services/CensorService.js";
import {
  kickIfTooNew,
  kickIfForbiddenCombo,
} from "#root/services/AccountGuardService.js";

const args = process.argv.slice(2);
const mode = args.find((arg: string) => arg.startsWith("mode="))?.split("=")[1];

/**
 * Session bookkeeping after the bot's reply lands in Discord: mark the
 * posted message ids as already-represented (the frozen assistant turn
 * carries their raw text), and freeze a <message-annotation> turn for
 * any posted media so its URL handles stay reachable for follow-up
 * tool chains (rotate/trim/remix) without re-processing the message.
 */
function recordSessionReplyPosts(
  channelId: string,
  sentMessages: Message[],
): void {
  if (!sentMessages.length) return;
  ChannelSessionCache.recordBotPosts(
    channelId,
    sentMessages.map((sentMessage) => sentMessage.id),
  );

  const annotationTurns: ChatMessage[] = [];
  for (const sentMessage of sentMessages) {
    const attachments: AttachmentPart[] = [];
    for (const attachment of sentMessage.attachments?.values() ?? []) {
      const kind = attachment.contentType?.startsWith("image/")
        ? "image"
        : attachment.contentType?.startsWith("video/")
          ? "video"
          : attachment.contentType?.startsWith("audio/")
            ? "audio"
            : "file";
      const mediaUrl = attachment.proxyURL || attachment.url;
      attachments.push({
        kind,
        description: attachment.description || attachment.name || undefined,
        ...(attachment.size
          ? { sizeMb: (attachment.size / 1024 / 1024).toFixed(2) }
          : {}),
        ...(mediaUrl?.startsWith("http") ? { url: mediaUrl } : {}),
      });
    }
    if (!attachments.length) continue;
    const annotation = buildMessageAnnotation({
      forId: sentMessage.id,
      attachments,
    });
    if (annotation) {
      annotationTurns.push({ role: "system", content: annotation });
    }
  }
  if (annotationTurns.length) {
    ChannelSessionCache.appendFrozenTurns(channelId, annotationTurns);
  }
}

async function replyMessage(
  queuedDatum: {
    message: import("discord.js").Message;
    recentMessages: import("discord.js").Collection<
      string,
      import("discord.js").Message
    >;
    actionType?: string;
  },
  localMongo: import("mongodb").MongoClient,
) {
  // Handles incoming Discord messages and message updates
  const message = queuedDatum.message;
  const _messages = queuedDatum.recentMessages;
  const actionType = queuedDatum.actionType;

  const client = message.client;
  const guild = (message as Message).guild;
  const channel = (message as Message).channel;
  const member = (message as Message).member;
  const user = message.author;
  const combinedNames = utilities.getCombinedNamesFromUserOrMember({
    member,
    user,
  });

  CurrentService.setUser(user);
  CurrentService.setMessage(message);
  CurrentService.setStartTime(Date.now());
  CurrentService.clearTraceId();

  // Check if message was deleted before we start processing
  if (DiscordState.isMessageCancelled((message as Message).id)) {
    console.log(
      `🗑️ [DiscordService] Message ${(message as Message).id} was deleted before processing started, skipping.`,
    );
    DiscordState.cancelledMessageIds.delete((message as Message).id);
    return;
  }

  let combinedGuildInformation: string | null = null;
  let combinedChannelInformation: string | null = null;

  // Live presence statuses for the whole reply lifecycle — "👀 Reading…",
  // "🤔 Thinking…", tool-by-tool progress, then a recap that yields
  // to his current mood after a few seconds.
  const statusTracker = new AgentStatusTracker({
    pushStatus: (status) =>
      DiscordUtilityService.setUserActivity(client, status),
    username: user?.username || "someone",
    fetchIdleStatus: async () => {
      const snapshot =
        (await PrismService.getSomaticSnapshot()) as unknown as PrismSomaticSnapshot;
      if (!snapshot?.emotion) return null;
      return formatMoodStatusLine(formatEmotionDetail(snapshot.emotion));
    },
  });

  const start = performance.now();

  if (guild) {
    combinedGuildInformation =
      utilities.getCombinedGuildInformationFromGuild(guild) || null;
    combinedChannelInformation =
      utilities.getCombinedChannelInformationFromChannel(
        channel as import("discord.js").TextChannel,
      ) || null;
    console.log(
      ...LogFormatter.receivedGuildMessage(
        message as Message,
        actionType || "",
      ),
    );
  } else {
    console.log(
      ...LogFormatter.receivedDirectMessage(
        message as Message,
        actionType || "",
      ),
    );
  }

  // Emoji reactions are no longer pre-generated here — the agent reacts
  // autonomously via the react_to_discord_message tool (message ids ride
  // in the <discord-message> envelopes).

  // Image detection is no longer needed — the agent decides autonomously
  // whether to generate images via the generate_image tool.

  // Extract content from recent messages — either the full heuristic
  // window (rebaseline) or only the slice newer than the piggyback
  // session's watermark, so the frozen history keeps its exact bytes
  // and the provider's prompt cache stays warm across rapid triggers.
  const sessionChannelId = (message as Message).channel.id;
  const heuristicWindowSize =
    await AIService.generateTextDetermineHowManyMessagesToFetch(
      (message as Message).content,
      message,
      "",
    );
  const sessionPlan = ChannelSessionCache.planFor({
    channelId: sessionChannelId,
    recentMessageIds: [...queuedDatum.recentMessages.keys()],
    windowSize: heuristicWindowSize,
  });
  const piggybackPlan = sessionPlan.mode === "piggyback" ? sessionPlan : null;
  if (!piggybackPlan) {
    console.log(
      `🧩 [DiscordService] Session rebaseline for channel ${sessionChannelId}: ${sessionPlan.mode === "rebaseline" ? sessionPlan.reason : ""}`,
    );
  }
  const extractOptions: ExtractContentOptions = piggybackPlan
    ? {
        afterId: piggybackPlan.session.watermarkId,
        skipMessageIds: piggybackPlan.skipIds,
        extraInContextIds: piggybackPlan.session.messageIds,
      }
    : { windowSize: heuristicWindowSize };

  const {
    conversation: extractedConversation,
    newSystemPrompt,
    memberMentionsCollection,
    messagesEmojisCollection,
    messagesImagesCollection,
    messagesTranscriptionsCollection: _messagesTranscriptionsCollection,
    participantsAvatarsCollection,
    participantsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    representedMessageIds,
    userMentionsCollection,
  } = await extractContentFromMessages(queuedDatum, localMongo, extractOptions);

  const conversation = piggybackPlan
    ? [...piggybackPlan.session.frozenConversation, ...extractedConversation]
    : extractedConversation;

  // Check if message was deleted during content extraction
  if (DiscordState.isMessageCancelled((message as Message).id)) {
    console.log(
      `🗑️ [DiscordService] Message ${(message as Message).id} was deleted during content extraction, aborting.`,
    );
    DiscordState.cancelledMessageIds.delete((message as Message).id);
    return;
  }

  const { generatedText, image, audioRef, videoUrl, imageUrl, imagePrompt } =
    await buildAndGenerateReply({
      conversation: conversation as unknown as Record<string, unknown>[],
      memberMentionsCollection,
      messagesEmojisCollection,
      messagesImagesCollection,
      newSystemPrompt,
      participantsAvatarsCollection:
        participantsAvatarsCollection as import("discord.js").Collection<
          string,
          string
        >,
      participantsCollection:
        participantsCollection as unknown as import("discord.js").Collection<
          string,
          GuildMember | User | { id: string }
        >,
      participantsMembersCollection,
      participantsUsersCollection,
      queuedDatum,
      userMentionsCollection,
      localMongo,
      statusTracker,
      session: {
        channelId: sessionChannelId,
        piggyback: !!piggybackPlan,
        representedMessageIds,
        cumulativeParticipantUserIds:
          piggybackPlan?.session.participantUserIds ?? [],
      },
    });

  const generatedTextResponse = generatedText;
  const generatedImage = image;
  const generatedAudioRef = audioRef;
  const generatedVideoUrl = videoUrl;
  const generatedImageUrl = imageUrl;

  // (Image conversations are already saved per-call inside generateImage)

  if (
    !generatedTextResponse &&
    !generatedImage &&
    !generatedAudioRef &&
    !generatedVideoUrl &&
    !generatedImageUrl
  ) {
    // The committed session expects this turn's reply to exist in the
    // channel — without one, the frozen history would drift from Discord.
    ChannelSessionCache.invalidate(sessionChannelId);
    statusTracker.finishError();
    await message.reply("...");
    DiscordState.lastMessageSentTime = TemporalHelpers.nowISO();

    console.error(`❌ [DiscordService:replyMessage] NO RESPONSE GENERATED
${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild?.id || "", channel?.id || "", (message as Message).id)}` : ""}`);
    return;
  }
  // SEND THE REPLY
  try {
    // Check if message was deleted during reply generation
    if (DiscordState.isMessageCancelled((message as Message).id)) {
      console.log(
        `🗑️ [DiscordService] Message ${(message as Message).id} was deleted during reply generation, not sending reply.`,
      );
      DiscordState.cancelledMessageIds.delete((message as Message).id);
      ChannelSessionCache.invalidate(sessionChannelId);
      statusTracker.finishCancelled();
      return;
    }
    await message.fetch();

    const { sentMessages } = await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      generatedTextResponse,
      generatedImage as Buffer | null,
      // The generate_image prompt (when one exists) becomes the attachment's
      // filename/description, so future context rebuilds can describe the
      // image instead of falling back to the meaningless "lupos.png".
      imagePrompt ?? null,
      generatedAudioRef,
      generatedVideoUrl,
      generatedImageUrl,
    );
    recordSessionReplyPosts(sessionChannelId, sentMessages);
    // Reply landed — replace the live status with the persistent recap.
    statusTracker.finishSuccess();
  } catch (error: unknown) {
    ChannelSessionCache.invalidate(sessionChannelId);
    statusTracker.finishError();
    console.warn(`❌ [DiscordService:replyMessage] MESSAGE NOT FOUND (OR DELETED)
            ${error}
    ${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
    ${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
    ${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
    ${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild?.id || "", channel?.id || "", (message as Message).id)}` : ""}`);

    return;
  }

  DiscordState.lastMessageSentTime = TemporalHelpers.nowISO();
  CurrentService.setEndTime(Date.now());

  // Fire-and-forget memory extraction from the conversation
  const guildId = (message as Message).guildId;
  if (guildId && conversation?.length > 0) {
    const memoryParticipants: {
      id: string;
      displayName?: string;
      username?: string;
    }[] = [];
    // Collect participant info for extraction
    if (participantsCollection?.size) {
      for (const participant of participantsCollection.values()) {
        const pId = participant?.user?.id;
        const pUser = participant?.user || participant;
        if (pId) {
          memoryParticipants.push({
            id: pId,
            username: pUser?.username || "",
            displayName: pUser?.globalName || pUser?.username || "",
          });
        }
      }
    }
    // Include mentioned users
    if (memberMentionsCollection?.size) {
      for (const member of memberMentionsCollection.values()) {
        const alreadyAdded = memoryParticipants.some(
          (p: { id: string }) => p.id === member.id,
        );
        if (!alreadyAdded) {
          memoryParticipants.push({
            id: member.id,
            username: member.user?.username || "",
            displayName:
              member.displayName ||
              member.user?.globalName ||
              member.user?.username,
          });
        }
      }
    }
    if (memoryParticipants.length > 0) {
      // Only send the last ~10 user messages for extraction (skip system/assistant)
      const recentUserMessages = conversation
        .filter((m: ChatMessage) => m.role === "user")
        .slice(-10);

      PrismService.extractMemories({
        guildId,
        channelId: (message as Message).channel?.id || "",
        messages: recentUserMessages,
        participants: memoryParticipants.map(
          (p: { id: string; displayName?: string; username?: string }) =>
            p.displayName || p.username || p.id,
        ),
        sourceMessageId: (message as Message).id,
        traceId: CurrentService.getTraceId() || undefined,
      })
        .then((result: TransformedPrismResponse) => {
          if (result?.count && result.count > 0) {
            console.log(
              `🧠 [DiscordService] Extracted ${result.count} memory/memories from conversation.`,
            );
          }
        })
        .catch((error: Error) => {
          console.warn(
            `🧠 [DiscordService] Memory extraction failed: ${error.message}`,
          );
        });
    }
  }

  const end = performance.now();
  const duration = end - start;

  if (guild) {
    console.log(
      ...LogFormatter.replyGuildMessageSuccess(
        message,
        generatedTextResponse || "",
        duration,
      ),
    );
  } else {
    console.log(
      ...LogFormatter.replyDirectMessageSuccess(
        message,
        generatedTextResponse || "",
        duration,
      ),
    );
  }

  const models = CurrentService.getModels();
  const modelTypes = CurrentService.getModelTypes();

  const db = localMongo.db(MONGO_DB_NAME);
  const collection2 = db.collection("MetricsMessageGeneration");
  await collection2.insertOne({
    models: models.join(", "),
    modelTypes: modelTypes.join(", "),
    guildId: (message as Message).guild?.id || "DM",
    guildName: (message as Message).guild?.name || "DM",
    channel: ((message as Message).channel as TextChannel)?.name || "DM",
    channelId: (message as Message).channel?.id || "DM",
    messageId: (message as Message).id,
    userId: message.author?.id,
    userName: message.author?.username,
    content: message.cleanContent,
  });
  CurrentService.clearModels();
  CurrentService.clearModelTypes();
  CurrentService.clearTraceId();

  return;
}

async function luposOnReady(
  client: Client,
  { mongo }: { mongo: import("mongodb").MongoClient },
) {
  console.log(...LogFormatter.botReady(client));
  consoleLogAllGuilds(client);

  try {
    const db = mongo.db(MONGO_DB_NAME);
    const messagesCollection = db.collection("Messages");
    await messagesCollection.createIndex(
      { guildId: 1, createdTimestamp: -1 },
      { background: true },
    );
    await messagesCollection.createIndex(
      { guildId: 1, channelId: 1, createdTimestamp: -1 },
      { background: true },
    );
    await messagesCollection.createIndex(
      { guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 },
      { background: true },
    );
    await messagesCollection.createIndex(
      { guildId: 1, "author.id": 1, createdTimestamp: -1 },
      { background: true },
    );
    await messagesCollection.createIndex(
      { isDeleted: 1 },
      { background: true, partialFilterExpression: { isDeleted: true } },
    );
    console.log("🔌 [DiscordService] Messages compound indexes ensured");

    const guessWhoScoresCollection = db.collection("GuessWhoGameScore");
    await guessWhoScoresCollection.createIndex(
      { userId: 1, guildId: 1 },
      { unique: true, background: true },
    );
    await guessWhoScoresCollection.createIndex(
      { guildId: 1, score: -1 },
      { background: true },
    );
    console.log(
      "🔌 [DiscordService] GuessWhoGameScore compound indexes ensured",
    );

    const beatUpVotesCollection = db.collection("BeatUpGameVotes");
    await beatUpVotesCollection.createIndex(
      { targetId: 1, guildId: 1 },
      { unique: true, background: true },
    );
    console.log("🔌 [DiscordService] BeatUpGameVotes unique index ensured");

    const beatUpCooldownsCollection = db.collection("BeatUpGameCooldowns");
    await beatUpCooldownsCollection.createIndex(
      { userId: 1, guildId: 1, type: 1 },
      { unique: true, background: true },
    );
    console.log("🔌 [DiscordService] BeatUpGameCooldowns unique index ensured");

    const shockStatisticsCollection = db.collection("ShockGameStatistics");
    await shockStatisticsCollection.createIndex(
      { userId: 1, guildId: 1 },
      { unique: true, background: true },
    );
    console.log("🔌 [DiscordService] ShockGameStatistics unique index ensured");

    const gameActivityCollection = db.collection("GameActivity");
    const existingGameActivityIndexes = await gameActivityCollection.indexes();
    const conflictingNameIndex = existingGameActivityIndexes.find(
      (existingIndex) =>
        existingIndex.name === "name_1" && !existingIndex.unique,
    );
    if (conflictingNameIndex) {
      await gameActivityCollection.dropIndex("name_1");
      console.log(
        "🔌 [DiscordService] GameActivity dropped stale non-unique name_1 index",
      );
    }
    await gameActivityCollection.createIndex(
      { name: 1 },
      { unique: true, background: true },
    );
    await gameActivityCollection.createIndex(
      { count: -1 },
      { background: true },
    );
    console.log("🔌 [DiscordService] GameActivity indexes ensured");

    const activeStreamersCollection = db.collection("ActiveStreamers");
    await activeStreamersCollection.createIndex(
      { userId: 1 },
      { unique: true, background: true },
    );
    console.log("🔌 [DiscordService] ActiveStreamers index ensured");
  } catch (indexError: unknown) {
    console.error(
      "⚠️ [DiscordService] Failed to create database indexes:",
      indexError,
    );
  }

  // Warm up the Discord REST connection pool — the first REST call after
  // gateway connect can stall on DNS/TLS in Docker (Synology bridge network).
  // Issuing a lightweight call here primes the pool so sendTyping() doesn't hang.
  try {
    if (client.application) {
      await client.application.fetch();
      console.log("🔌 [DiscordService] REST connection pool warmed up");
    }
  } catch (error: unknown) {
    console.warn(
      `⚠️ [DiscordService] REST warmup failed: ${(error as Error).message}`,
    );
  }

  // ─── Maintenance Gate ──────────────────────────────────────────
  if (config.UNDER_MAINTENANCE) {
    if (client.user) {
      client.user.setPresence({
        activities: [{ name: "🚧 Under maintenance 🚧", type: 4 }],
        status: "idle",
      });
    }
    console.log(
      "🚧 Lupos is under maintenance — skipping normal initialization.",
    );
    return;
  }

  DiscordUtilityService.setUserActivity(
    client,
    APRIL_FOOLS_MODE ? `:3` : `Don't @ me...`,
  );

  if (mode === "services" || !mode) {
    // Reconcile deathroll games interrupted by the previous shutdown/restart
    try {
      await reconcileInterruptedGames(client);
    } catch (error: unknown) {
      console.error(
        "⚠️ [DiscordService] Failed to reconcile interrupted deathroll games:",
        error,
      );
    }

    // Same sweep for interrupted royales (marks the message, refunds wagers)
    try {
      await reconcileInterruptedRoyales(client);
    } catch (error: unknown) {
      console.error(
        "⚠️ [DiscordService] Failed to reconcile interrupted royales:",
        error,
      );
    }

    // And for interrupted heists (voids the job, refunds all stakes)
    try {
      await reconcileInterruptedHeists(client);
    } catch (error: unknown) {
      console.error(
        "⚠️ [DiscordService] Failed to reconcile interrupted heists:",
        error,
      );
    }

    await generateRolesEmbedMessage(client);

    // ─── Boot sweeps (config-gated, default OFF) ──────────────────
    // These used to run unconditionally on every `services` boot. They are
    // destructive (mass kick / bulk role strip), so they now fail safe and
    // must be explicitly opted into via env flags set to the literal "true".
    if (config.ENABLE_BOOT_ACCOUNT_SWEEP) {
      // Sweep existing members: kick accounts < 4 weeks old that joined while bot was offline
      await luposOnReadyDeleteNewAccounts(client);
    } else {
      console.log(
        "⏭️ [luposOnReady] Boot account sweep skipped — set ENABLE_BOOT_ACCOUNT_SWEEP=true to enable.",
      );
    }

    if (config.ENABLE_BOOT_ROLE_REVOKE) {
      // Bulk role revocation — strip target role from all members in the specified guild
      await revokeRoleFromAllMembers(client);
    } else {
      console.log(
        "⏭️ [luposOnReady] Boot role revoke skipped — set ENABLE_BOOT_ROLE_REVOKE=true to enable.",
      );
    }

    if (config.ROLE_ID_BIRTHDAY_MONTH) {
      BirthdayJob.startJob(client, mongo);
    }

    // RemindersJob.startJob(client, mongo);

    if (config.EMOJI_ID_FLAG && config.ROLE_ID_FLAG) {
      EventReactJob.startJob(client, mongo);
    }

    PermanentTimeOutJob.startJob(client);

    if (
      config.CHANNEL_ID_POLITICS &&
      config.ROLE_ID_YAPPER &&
      config.ROLE_ID_REACTOR
    ) {
      ActivityRoleAssignmentJob.startJob({
        client,
        mongo,
        primaryChannelId: config.CHANNEL_ID_POLITICS as string,
        roleIdYapper: config.ROLE_ID_YAPPER,
        roleIdReactor: config.ROLE_ID_REACTOR,
        periodMinutes: 60,
        intervalMinutes: 1,
      });
    }
  } else if (mode === "messages") {
    // Reset bot nickname to "Lupos" in specific guild on startup
    try {
      const targetGuild = client.guilds.cache.get(
        config.GUILD_ID_GROBBULUS as string,
      );
      if (targetGuild) {
        const botMember = await targetGuild.members.fetch(client.user!.id);
        if (botMember) {
          await botMember.setNickname("Lupos");
          console.log(
            `Bot nickname reset to "Lupos" in guild ${targetGuild.name}`,
          );
        }
      }
    } catch (error: unknown) {
      console.error("Failed to reset bot nickname on startup:", error);
    }

    // April Fools: Random tag job
    if (APRIL_FOOLS_MODE) {
      RandomTagJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY as string,
        channelId: config.CHANNEL_ID_POLITICS as string,
      });

      // April Fools: Server icon rotation
      ServerIconJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY as string,
      });
    }
  }

  // Countdown icon overlays — run in ALL modes (daily countdown on guild icon)
  const countdownIconDefinitions = [
    {
      guildId: config.GUILD_ID_PRIMARY,
      targetDateString: config.COUNTDOWN_ICON_TARGET_DATE,
      baseIconFilename: "base-icon.gif",
      baseIconFallbackUrl:
        "https://cdn.discordapp.com/attachments/634583290984136716/1524160419399467168/whitemane-icon-fire-ashes-final.gif",
    },
    {
      guildId: config.GUILD_ID_CLOCK_CREW,
      targetDateString: config.COUNTDOWN_ICON_TARGET_DATE_CLOCK_CREW,
      baseIconFilename: "clock-crew-base-icon.png",
    },
  ];
  const activeCountdownDefinitions = countdownIconDefinitions.filter(
    (definition) => definition.guildId && definition.targetDateString,
  );
  if (activeCountdownDefinitions.length > 0) {
    const { parseTargetDateString } =
      await import("#root/utilities/CountdownIconOverlay.js");
    for (const definition of activeCountdownDefinitions) {
      CountdownIconJob.startJob({
        client,
        guildId: definition.guildId as string,
        targetDate: parseTargetDateString(
          definition.targetDateString as string,
        ),
        baseIconFilename: definition.baseIconFilename,
        baseIconFallbackUrl: definition.baseIconFallbackUrl,
      });
    }
  }
}

async function luposOnReadyReports(
  client: Client,
  mongo: import("mongodb").MongoClient,
) {
  utilities.consoleLog("<", "luposOnReadyReports");
  utilities.consoleLog(
    "=",
    `Logged in as ${DiscordUtilityService.getBotName(client)}`,
  );
  try {
    await mongo.connect();
    utilities.consoleLog("=", "Connected to MongoDB");
  } catch (error: unknown) {
    utilities.consoleLog("=", `Error connecting to MongoDB \n${error}`);
  }
  DiscordUtilityService.displayAllChannelActivity(client);
  utilities.consoleLog(">", "luposOnReadyReports");
}

async function luposOnReadyCloneMessages(
  client: Client,
  { localMongo }: { localMongo: import("mongodb").MongoClient },
) {
  await DiscordUtilityService.fetchAndSaveAllServerMessages(
    client,
    localMongo,
    DISCORD_GUILDS.whitemane,
  );

  // Backfill media archive for Lupos messages with Discord CDN URLs
  await DiscordUtilityService.backfillMediaArchive(client, localMongo, {
    authorIds: ["1198099566088699904"],
    guildId: DISCORD_GUILDS.whitemane,
  });
}

async function luposOnReadyRescrapeChannels(
  client: Client,
  {
    localMongo,
    channelIds,
    guildIds,
    dateLimit,
  }: {
    localMongo: import("mongodb").MongoClient;
    channelIds?: string[];
    guildIds?: string[];
    dateLimit?: string;
  },
) {
  const guilds = guildIds || [DISCORD_GUILDS.whitemane];
  const limit = dateLimit || "2025-01-01";

  for (const guildId of guilds) {
    const guild = client.guilds.cache.get(guildId);
    const guildName = guild?.name || guildId;
    console.log(
      `[rescrape:channels] Rescraping guild "${guildName}" (${guildId})${channelIds ? ` — ${channelIds.length} channel(s)` : " — all channels"} | dateLimit: ${limit}`,
    );

    await DiscordUtilityService.fetchAndSaveAllServerMessages(
      client,
      localMongo,
      guildId,
      {
        channelIds: channelIds || undefined,
        dateLimit: limit,
        autoResume: false,
        forceUpdate: true,
      },
    );
    console.log(`[rescrape:channels] Done with guild "${guildName}".`);
  }

  console.log(`[rescrape:channels] All guilds complete.`);
  process.exit(0);
}

async function luposOnReadyDeleteDuplicateMessages(
  client: Client,
  { localMongo }: { localMongo: import("mongodb").MongoClient },
) {
  await DiscordUtilityService.deleteDuplicateMessagesByID(localMongo);
}

/**
 * Check if a message or its replied-to message contains flagged words.
 * If flagged, sends a reply and returns true; otherwise returns false.

 */
async function rejectIfFlaggedContent(message: Message) {
  const FLAGGED_REPLY = "beep boop, no slurs, ya dumbass";

  // Check direct message content
  if (
    (message as Message).content &&
    CensorService.containsFlaggedWords((message as Message).content)
  ) {
    console.log(
      `⛔ [DiscordService] Message contains flagged words, ignoring.`,
    );
    try {
      await message.reply(FLAGGED_REPLY);
    } catch (error: unknown) {
      console.log("Error sending flagged words response:", error);
    }
    return true;
  }

  // Check replied-to message content
  if (message.reference && (message.reference.messageId as string)) {
    try {
      const repliedMessage = await (message as Message).channel.messages.fetch(
        message.reference.messageId as string,
      );
      if (
        repliedMessage.content &&
        CensorService.containsFlaggedWords(repliedMessage.content)
      ) {
        console.log(
          `⛔ [DiscordService] Replied message contains flagged words, ignoring.`,
        );
        try {
          await message.reply(FLAGGED_REPLY);
        } catch (error: unknown) {
          console.log("Error sending flagged words response:", error);
        }
        return true;
      }
    } catch (error: unknown) {
      console.log("Error fetching replied message:", error);
    }
  }

  return false;
}

/**
 * Send a self-destructing maintenance mode countdown message.
 * Randomly selects an explosion GIF and counts down from 10s before deleting.

 */
async function sendMaintenanceCountdown(message: Message) {
  let secondsRemaining = 10;
  const randomExplosionGif =
    EXPLOSION_GIFS[Math.floor(Math.random() * EXPLOSION_GIFS.length)];

  try {
    const sentMessage = await message.reply(
      `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
    );

    const interval = setInterval(async () => {
      secondsRemaining--;
      try {
        if (secondsRemaining <= 0) {
          clearInterval(interval);
          await sentMessage.delete();
        } else if (secondsRemaining < 3) {
          await sentMessage.edit(randomExplosionGif);
        } else {
          await sentMessage.edit(
            `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
          );
        }
      } catch (error: unknown) {
        console.error(error);
        clearInterval(interval);
      }
    }, 1000);
  } catch (error: unknown) {
    console.error(error);
  }
}

async function processMessage(
  client: Client,
  {
    localMongo,
  }: {
    mongo: import("mongodb").MongoClient;
    localMongo: import("mongodb").MongoClient;
  },
  message: Message,
  actionType: string,
) {
  const isDirectMessage = (message as Message).channel.type === ChannelType.DM;
  const isSelfMessage = message.author.id === client.user!.id;
  const isDirectMessageFromSelf = isDirectMessage && isSelfMessage;
  const isMessageWithoutSelfMention =
    !isDirectMessage && !message.mentions.has(client.user!);
  const isMessageFromBot = message.author.bot;
  const isGuildWhitemane = message?.guildId === config.GUILD_ID_PRIMARY;
  const isMentioningBot = isDirectMessage || message.mentions.has(client.user!);

  if ((message as Message).guildId === (config.GUILD_ID_GROBBULUS as string)) {
    return;
  }

  if (config.USER_IDS_DISALLOWED.includes(message.author.id)) {
    return;
  }

  // Lupos never converses over DMs — the birthday onboarding prompt
  // (button interactions) is the only DM surface. Incoming DMs are
  // relayed to #dm-inbox in Lupos Logs so replies (e.g. to the invite
  // campaign) are seen; fire-and-forget so a relay hiccup can't block
  // the pipeline.
  if (isDirectMessage) {
    if (!isSelfMessage && !isMessageFromBot && actionType === "CREATE") {
      void DmInboxService.relayDirectMessage(client, message);
    }
    return;
  }

  // Check for flagged words in message content or replied-to content
  if (!isSelfMessage && !isMessageFromBot && isMentioningBot) {
    if (await rejectIfFlaggedContent(message)) return;
  }

  try {
    if (!message.author.bot) {
      const date = utilities.getCombinedDateInformationFromDate(
        message.createdAt.getTime(),
        true,
      );

      let logMessage = `${date}
Message: ${message.cleanContent}`;

      if (message.attachments?.size > 0) {
        logMessage += `\nAttachment Message: ${[...message.attachments.values()].map((att: import("discord.js").Attachment) => att.url).join(", ")}`;
      }

      if (message.stickers?.size > 0) {
        logMessage += `\nSticker Message: ${[...message.stickers.values()].map((sticker: import("discord.js").Sticker) => sticker.name).join(", ")}`;
      }

      if (message.reference && (message.reference.messageId as string)) {
        logMessage += `\nReply Message: Yes, to message ID ${message.reference.messageId as string}`;
      }

      logMessage += `
Guild: ${(message as Message).guild?.name}
Channel: #${((message as Message).channel as TextChannel)?.name}
Author: ${utilities.getCombinedNamesFromUserOrMember({ member: (message as Message).member, user: message.author })}
URL: ${utilities.getDiscordMessageUrl((message as Message).guild?.id || "", (message as Message).channel.id, (message as Message).id)}`;

      console.log(logMessage);
    }
  } catch (error: unknown) {
    console.log("Error saving message to MongoDB:", error);
  }

  if (config.CHANNEL_IDS_JUKEBOX.includes((message as Message).channelId)) {
    await YouTubeService.searchAndPlay(client, message);
    await YouTubeService.stop(client, message);
    await YouTubeService.next(client, message);
    await YouTubeService.pause(client, message);
    await YouTubeService.resume(client, message);
    await YouTubeService.setVolume(client, message);
  }

  if (isMessageWithoutSelfMention) {
    return;
  }

  // IGNORE MESSAGES FROM BOT ACCOUNTS
  if (isMessageFromBot) {
    return;
  }

  // ASSIGN ROLES TO USERS BASED ON CHANNELS
  for (const channel of channels) {
    if ((message as Message).channelId === channel.id) {
      await DiscordUtilityService.addRoleToMember(
        (message as Message).member!,
        channel.roleId,
      );
    }
  }

  // IGNORE MESSAGES FROM THE BOT ITSELF
  if (isDirectMessageFromSelf) {
    return;
  }

  // IGNORE MESSAGES FROM SPECIFIC USERS
  if (config.USER_IDS_IGNORE.includes(message.author.id)) {
    return;
  }

  // IGNORE MESSAGES FROM USERS WITH SPECIFIC ROLES
  const memberObj = (message as Message).member;
  if (
    memberObj &&
    memberObj.roles.cache.some((role: import("discord.js").Role) =>
      config.ROLES_IDS_IGNORE.includes(role.id),
    )
  ) {
    return;
  }

  if (config.UNDER_MAINTENANCE && message.author.id !== DISCORD_USERS.owner) {
    // Only the owner can interact with Lupos during maintenance
    if ((message as Message).guild?.id === config.GUILD_ID_PRIMARY) {
      await sendMaintenanceCountdown(message);
    }
    return;
  }

  // START TYPING — always restart: an existing entry may hold a dead
  // interval (sendTyping failures self-clear the timer without deleting
  // the entry), and restarting a healthy one is harmless.
  try {
    const existingTypingInterval =
      DiscordState.typingIntervals[(message as Message).channel.id];
    if (existingTypingInterval) {
      DiscordUtilityService.clearTypingInterval(existingTypingInterval);
    }
    DiscordState.typingIntervals[(message as Message).channel.id] =
      await DiscordUtilityService.startTypingInterval(
        (message as Message).channel as TextChannel,
      );
  } catch (error: unknown) {
    console.warn(
      `⚠️ [processMessage] Could not start typing: ${(error as Error).message}`,
    );
  }

  // LUPOS CHATTER ROLE
  if (isGuildWhitemane) {
    await DiscordUtilityService.addRoleToMember(
      (message as Message).member!,
      config.ROLE_ID_BOT_CHATTER as string,
    );
    // remove after 1 minutes
    setTimeout(
      async () => {
        await DiscordUtilityService.removeRoleFromMember(
          (message as Message).member!,
          config.ROLE_ID_BOT_CHATTER as string,
        );
      },
      1 * 60 * 1000,
    );
  }

  // Fetch messages before the current one...
  const fetchedMessages = await DiscordUtilityService.fetchMessages(
    client,
    (message as Message).channel.id,
    {
      limit: 500,
      before: (message as Message).id,
    },
  );
  if (!fetchedMessages) {
    console.error(
      `❌ [processMessage] fetchMessages returned null — channel not in cache`,
    );
    // Clear the typing indicator we started above so it doesn't spin forever
    const typingChannelId = (message as Message).channel.id;
    if (DiscordState.typingIntervals[typingChannelId]) {
      DiscordUtilityService.clearTypingInterval(
        DiscordState.typingIntervals[typingChannelId],
      );
      delete DiscordState.typingIntervals[typingChannelId];
    }
    return;
  }
  const recentMessages = fetchedMessages.reverse();
  // ...and append the current message to the end
  recentMessages.set((message as Message).id, message);

  DiscordState.queuedData.push({
    message: message as Message,
    recentMessages,
    actionType: actionType || "",
  });

  if (!DiscordState.isProcessingQueue) {
    DiscordState.isProcessingQueue = true;
    // Stamp queue progress at drain start and after every item so
    // HeartbeatService can tell "one reply is hung" from "queue just
    // started after a long idle stretch".
    DiscordState.lastQueueActivityAtMs = Date.now();
    try {
      while (DiscordState.queuedData.length > 0) {
        const queuedDatum =
          DiscordState.queuedData.shift() as QueuedMessageData;
        const currentChannelId = (queuedDatum.message as Message).channel.id;
        try {
          await replyMessage(queuedDatum, localMongo);
        } catch (error: unknown) {
          console.error(
            `❌ [processMessage] Uncaught error in replyMessage — queue will continue processing:\n`,
            error,
          );
          // Clear typing for the failed channel so it doesn't hang
          if (DiscordState.typingIntervals[currentChannelId]) {
            DiscordUtilityService.clearTypingInterval(
              DiscordState.typingIntervals[currentChannelId],
            );
            delete DiscordState.typingIntervals[currentChannelId];
          }
        }
        DiscordState.lastQueueActivityAtMs = Date.now();
        // No more queued messages for this channel — clear typing indicator
        if (
          !DiscordState.queuedData.some(
            (q: QueuedMessageData) =>
              q.message?.channel?.id === currentChannelId,
          )
        ) {
          // Clear typing for this specific channel only
          if (DiscordState.typingIntervals[currentChannelId]) {
            DiscordUtilityService.clearTypingInterval(
              DiscordState.typingIntervals[currentChannelId],
            );
            delete DiscordState.typingIntervals[currentChannelId];
          }
        }
      }
    } finally {
      DiscordState.isProcessingQueue = false;
    }
    return;
  }
}

async function luposOnMessageCreate(
  client: Client,
  {
    mongo,
    localMongo,
  }: {
    mongo: import("mongodb").MongoClient;
    localMongo: import("mongodb").MongoClient;
  },
  message: Message,
) {
  await processMessage(client, { mongo, localMongo }, message, "CREATE");
}

async function luposOnMessageCreateCloneMessage(
  client: Client,
  {
    _mongo,
    localMongo,
  }: {
    _mongo: import("mongodb").MongoClient;
    localMongo: import("mongodb").MongoClient;
  },
  message: Message,
) {
  await DiscordUtilityService.saveMessageToMongo(message, localMongo);
}

async function luposOnMessageUpdateCloneMessage(
  client: Client,
  {
    _mongo,
    localMongo,
  }: {
    _mongo: import("mongodb").MongoClient;
    localMongo: import("mongodb").MongoClient;
  },
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  await DiscordUtilityService.updateMessageInMongo(
    newMessage as Message,
    localMongo,
  );
}

async function luposOnMessageUpdate(
  client: Client,
  {
    mongo,
    localMongo,
  }: {
    mongo: import("mongodb").MongoClient;
    localMongo: import("mongodb").MongoClient;
  },
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) {
  // An edit inside a frozen piggyback session makes its bytes stale —
  // drop the session so the next trigger rebuilds from live history.
  ChannelSessionCache.invalidateIfContains(
    newMessage.channel.id,
    newMessage.id,
  );

  // Process if message was edited to mention the bot
  if (
    newMessage.mentions.has(client.user!) &&
    !oldMessage.mentions.has(client.user!)
  ) {
    // Skip if the bot already replied to this message
    const fetchedMessages = await DiscordUtilityService.fetchMessages(
      client,
      newMessage.channel.id,
      {
        limit: 100,
        after: newMessage.id,
      },
    );
    if (!fetchedMessages) return;
    const futureMessages = fetchedMessages.filter(
      (message: Message) =>
        message.author.id === client.user!.id &&
        message.reference?.messageId === newMessage.id,
    );
    if (futureMessages.size) return;
    await processMessage(
      client,
      { mongo, localMongo },
      newMessage as Message,
      "UPDATE",
    );
  } else {
    return;
  }
}

// Whenever a message is deleted in WHITEMANE, post it in the deleted-message channel
// ── Delegated to DeletedMessageLogger ───────────────────────────
async function luposOnMessageDelete(
  client: Client,
  mongo: import("mongodb").MongoClient,
  message: Message,
) {
  // A deletion inside a frozen piggyback session makes its bytes stale —
  // drop the session so the next trigger rebuilds from live history.
  ChannelSessionCache.invalidateIfContains(message.channel.id, message.id);
  return DeletedMessageLogger.handleMessageDelete(client, mongo, message);
}

// ── Delegated to ReactionHighlights ─────────────────────────────
async function luposOnReactionCreateQueue(
  client: Client,
  mongo: import("mongodb").MongoClient,
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
) {
  return ReactionHighlights.handleReactionCreate(client, mongo, reaction, user);
}

async function luposOnReactionRemoveQueue(
  client: Client,
  mongo: import("mongodb").MongoClient,
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
) {
  return ReactionHighlights.handleReactionRemove(client, mongo, reaction, user);
}

// Whenever a new member joins the server
async function luposOnGuildMemberAdd(
  client: Client,
  mongo: import("mongodb").MongoClient,
  member: GuildMember,
) {
  const functionName = "luposOnGuildMemberAdd";
  if (member.guild.id !== config.GUILD_ID_PRIMARY) return;
  console.log(...LogFormatter.memberJoinedGuild(functionName, member));

  // Kick accounts less than 4 weeks old (unless whitelisted)
  const wasKicked = await kickIfTooNew(member, functionName);
  if (wasKicked) return;

  // Assign politics mute role if user is in the muted list
  if (
    config.USER_IDS_POLITICS_MUTED?.includes(member.id) &&
    config.ROLE_ID_POLITICS_MUTE
  ) {
    await DiscordUtilityService.addRoleToMember(
      member,
      config.ROLE_ID_POLITICS_MUTE,
    );
  }

  // Rejoin safety net: restore the birthday role for members who already
  // picked a month. The DM prompt is sent after onboarding completes.
  await BirthdayOnboarding.syncExistingBirthday(client, member);
}

// Whenever a member is updated
async function luposOnGuildMemberUpdate(
  client: Client,
  mongo: import("mongodb").MongoClient,
  oldMember: GuildMember,
  newMember: GuildMember,
) {
  const functionName = "luposOnGuildMemberUpdate";

  // Revert bot nickname if changed in specific server
  if (
    newMember.guild.id === (config.GUILD_ID_GROBBULUS as string) &&
    newMember.id === client.user!.id
  ) {
    const expectedNickname = "Lupos";
    // Only act if nickname changed AND is not the expected name
    if (
      oldMember.nickname !== newMember.nickname &&
      newMember.nickname !== expectedNickname
    ) {
      try {
        await newMember.setNickname(expectedNickname);
        console.log(
          `[${functionName}] Bot nickname was changed to "${newMember.nickname}", reverted to "${expectedNickname}"`,
        );
      } catch (error: unknown) {
        console.error(
          `[${functionName}] Failed to revert bot nickname:`,
          error,
        );
      }
    }
  }

  if (oldMember.guild.id !== config.GUILD_ID_PRIMARY) return;

  // Kick if member now holds the forbidden role combo (Horde + Apex Legends).
  // Always check — oldMember can be a partial with an empty role cache,
  // making size-based comparisons unreliable.
  await kickIfForbiddenCombo(newMember, functionName);

  // Whenever a user completes onboarding
  const hasOldMemberCompletedOnboarding = oldMember.flags
    ? oldMember.flags.bitfield & (1 << 1)
    : 0;
  const hasNewMemberCompletedOnboarding = newMember.flags
    ? newMember.flags.bitfield & (1 << 1)
    : 0;
  if (!hasOldMemberCompletedOnboarding && hasNewMemberCompletedOnboarding) {
    console.log(
      ...LogFormatter.memberUpdateOnboardingComplete(functionName, newMember),
    );
    await generateRolesEmbedMessage(client);

    // Re-check both guards after onboarding — the member now has all their chosen roles
    const freshMember = await newMember.guild.members.fetch(newMember.id);
    const kickedAge = await kickIfTooNew(freshMember, functionName);
    const kickedCombo = kickedAge
      ? true
      : await kickIfForbiddenCombo(freshMember, functionName);

    // DM the birthday month picker (skips bots, rejoins, closed DMs)
    if (!kickedAge && !kickedCombo) {
      await BirthdayOnboarding.sendBirthdayPrompt(client, freshMember);
    }
  }
}

// ─── Button handlers (registered with ButtonRouter below) ───────

async function handleYouTubeButton(
  _client: Client,
  interaction: import("discord.js").ButtonInteraction,
) {
  const youtubeAction =
    YOUTUBE_BUTTON_ACTIONS[
      interaction.customId as keyof typeof YOUTUBE_BUTTON_ACTIONS
    ];
  if (!youtubeAction) return;
  const reply = await interaction.deferReply();
  (YouTubeService as unknown as Record<string, (...args: unknown[]) => void>)[
    youtubeAction.method
  ](...youtubeAction.args);
  await reply.delete();
}

for (const youtubeButtonId of Object.keys(YOUTUBE_BUTTON_ACTIONS)) {
  ButtonRouter.register(youtubeButtonId, handleYouTubeButton);
}

// ─── Slash-command dispatch ──────────────────────────────────────

// Per-user command cooldowns: "commandName:userId" → true while cooling down.
const commandCooldowns = new BoundedMap<string, boolean>(5000, 60 * 60 * 1000);

async function dispatchSlashCommand(
  client: Client,
  interaction: import("discord.js").ChatInputCommandInteraction,
) {
  const functionName = "dispatchSlashCommand";
  const command = (
    client as Client & { commands: DiscordCollection<string, Command> }
  ).commands.get(interaction.commandName);

  if (!command) {
    console.error(...LogFormatter.commandNotFound(functionName, interaction));
    return;
  }

  // ── Central guards (commands opt in via their Command metadata) ──
  if (command.guildOnly && !interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server!",
      ephemeral: true,
    });
    return;
  }

  if (command.botPermissions?.length && interaction.guild) {
    const me = interaction.guild.members.me;
    const missing = command.botPermissions.filter(
      (permission: bigint) => !me?.permissions.has(permission),
    );
    if (missing.length > 0) {
      await interaction.reply({
        content:
          "I don't have the permissions I need to run this command here!",
        ephemeral: true,
      });
      return;
    }
  }

  if (command.cooldownSeconds) {
    const cooldownKey = `${interaction.commandName}:${interaction.user.id}`;
    if (commandCooldowns.has(cooldownKey)) {
      await interaction.reply({
        content: `⏳ Slow down — you can use /${interaction.commandName} again shortly.`,
        ephemeral: true,
      });
      return;
    }
    commandCooldowns.set(cooldownKey, true);
    setTimeout(
      () => commandCooldowns.delete(cooldownKey),
      command.cooldownSeconds * 1000,
    );
  }

  try {
    await command.execute(interaction);
  } catch (error: unknown) {
    // Always log — a command failure must never be silent.
    console.log(
      ...LogFormatter.commandError(functionName, interaction, error as Error),
    );
    const errorReply = {
      content: "There was an error while executing this command!",
    };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorReply);
      } else {
        await interaction.reply({ ...errorReply, ephemeral: true });
      }
    } catch {
      // Interaction token expired — nothing more we can do.
    }
  }
}

async function luposOnInteractionCreate(
  client: Client,
  mongo: import("mongodb").MongoClient,
  interaction: Interaction,
) {
  const functionName = "luposOnInteractionCreate";
  if (interaction.isButton()) {
    await ButtonRouter.dispatch(client, interaction);
  } else if (interaction.isChatInputCommand()) {
    console.log(
      ...LogFormatter.interactionCreateCommand(functionName, interaction),
    );
    if (interaction.commandName === "ping") {
      await interaction.reply("Pong!");
      return;
    }
    await dispatchSlashCommand(client, interaction);
  }
}

// ── Delegated to PresenceTracker ────────────────────────────────
async function luposOnPresenceUpdate(
  client: Client,
  oldPresence: Presence | null,
  newPresence: Presence,
) {
  return PresenceTracker.handlePresenceUpdate(client, oldPresence, newPresence);
}

async function luposOnGuildMemberRemove(
  client: Client,
  mongo: import("mongodb").MongoClient,
  member: GuildMember,
) {
  if (member.guild.id === (config.GUILD_ID_PRIMARY as string)) {
    if (config.CHANNEL_ID_LEAVERS) {
      const leaversLogChannel = DiscordUtilityService.getChannelById(
        client,
        config.CHANNEL_ID_LEAVERS,
      ) as TextChannel;
      if (leaversLogChannel) {
        let description = "";
        description += `Tag: <@${member.id}>\n`;
        description += `ID: \`${member.user.id}\`\n`;
        description += `Global Name: \`${member.user.globalName}\`\n`;
        description += `Username: \`${member.user.username}\`\n`;
        if (member.joinedTimestamp) {
          const joinedDateTime = TemporalHelpers.fromMillis(
            member.joinedTimestamp,
          );
          // Friday, October 14, 1983, 9:30:33 AM Eastern Daylight Time
          const joinedDate =
            TemporalHelpers.formatDateTimeHugeWithSeconds(joinedDateTime);
          description += `Joined Server: \`${joinedDate}\`\n`;
        }
        description += `Current Member Count: \`${member.guild.memberCount}\`\n`;
        const embed = new EmbedBuilder()
          .setAuthor({
            name: member.user.username,
            iconURL: member.user.displayAvatarURL(),
          })
          .setTitle(`${member.user.username} has left the server`)
          .setDescription(description)
          .setColor("#FF0000");
        // .setTimestamp()
        // .setFooter({ text: `User ID: ${member.id}`, iconURL: member.user.displayAvatarURL() });
        await leaversLogChannel.send({ embeds: [embed] });
      }
    }
  }
}

async function luposOnVoiceStateUpdate(
  client: Client,
  mongo: import("mongodb").MongoClient,
  oldState: VoiceState,
  newState: VoiceState,
) {
  if (newState.channelId) {
    if (!newState.member) return;
    console.log(...LogFormatter.memberJoinedVoiceChannel(newState));
    if (newState.member.guild.id === (config.GUILD_ID_PRIMARY as string)) {
      const voiceChatterRoleId = config.ROLE_ID_VOICE_CHATTER;
      if (voiceChatterRoleId) {
        await DiscordUtilityService.addRoleToMember(
          newState.member,
          voiceChatterRoleId,
        );
      }
    }
  } else {
    console.log(...LogFormatter.memberLeftVoiceChannel(oldState));
  }
}

async function consoleLogAllGuilds(client: Client) {
  const guilds = DiscordUtilityService.getAllGuilds(
    client,
  ) as unknown as DiscordCollection<string, Guild>;
  console.log(...LogFormatter.displayAllGuilds(guilds));
}

const DiscordService = {
  // VENDER
  async initializeBotVender() {
    const venderClient = DiscordWrapper.createClient(
      "vender",
      config.VENDER_TOKEN as string,
    );
    // Initialize MongoDB client
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const mongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      venderClient,
      { mongo, localMongo: mongo },
      undefined as never, // venderOnReady placeholder
    );
    DiscordUtilityService.onEventMessageCreate(
      venderClient,
      { mongo, localMongo: mongo },
      undefined as never, // venderOnMessageCreate placeholder
    );
    DiscordUtilityService.onEventInteractionCreate(
      venderClient,
      mongo,
      undefined as never, // venderOnInteractionCreate placeholder
    );
  },
  // LUPOS
  async initializeBotLupos() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    // Initialize MongoDB client
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const mongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    const localMongo = mongo;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo, localMongo },
      luposOnReady as (...args: unknown[]) => void,
    );
    // ─── Data-driven event registration ─────────────────────────────
    // Each entry: [registrationMethod, ...args]
    // "mongoBoth" = { mongo, localMongo }, "mongo" = mongo only, "none" = no db arg
    const cloneEvents: [string, ...unknown[]][] = [
      [
        "onEventMessageCreate",
        { mongo, localMongo },
        luposOnMessageCreateCloneMessage,
      ],
      [
        "onEventMessageUpdate",
        { mongo, localMongo },
        luposOnMessageUpdateCloneMessage,
      ],
    ];
    const messageEvents: [string, ...unknown[]][] = [
      ["onEventMessageCreate", { mongo, localMongo }, luposOnMessageCreate],
      ["onEventMessageUpdate", { mongo, localMongo }, luposOnMessageUpdate],
    ];
    const guildEvents: [string, ...unknown[]][] = [
      ["onEventGuildMemberAdd", mongo, luposOnGuildMemberAdd],
      ["onEventGuildMemberUpdate", mongo, luposOnGuildMemberUpdate],
      ["onEventChannelCreate", luposOnChannelCreate],
    ];
    const interactionEvents: [string, ...unknown[]][] = [
      ["onEventMessageReactionAdd", mongo, luposOnReactionCreateQueue],
      ["onEventMessageReactionRemove", mongo, luposOnReactionRemoveQueue],
      ["onEventInteractionCreate", mongo, luposOnInteractionCreate],
      ["onEventMessageDelete", mongo, luposOnMessageDelete],
      ["onEventPresenceUpdate", luposOnPresenceUpdate],
      ["onEventGuildMemberRemove", mongo, luposOnGuildMemberRemove],
      ["onEventVoiceStateUpdate", mongo, luposOnVoiceStateUpdate],
    ];

    const EVENT_REGISTRATIONS: Record<string, [string, ...unknown[]][]> = {
      services: [...cloneEvents, ...guildEvents, ...interactionEvents],
      messages: [...messageEvents],
      default: [
        ...cloneEvents,
        ...guildEvents,
        ...messageEvents,
        ...interactionEvents,
      ],
    };

    const eventsToRegister =
      EVENT_REGISTRATIONS[mode ?? "default"] ?? EVENT_REGISTRATIONS.default;
    for (const [method, ...args] of eventsToRegister) {
      (DiscordUtilityService as Record<string, (...args: unknown[]) => void>)[
        method
      ](luposClient, ...args);
    }

    // Log readiness for message-processing modes
    if (mode !== "services") {
      console.log(...LogFormatter.readyToProcessMessages());
      console.log(...LogFormatter.readyToProcessMessageUpdates());
    }

    // Create a collection to store your commands
    (
      luposClient as Client & { commands: DiscordCollection<string, unknown> }
    ).commands = new Collection<string, unknown>();

    // Load all commands from the commands directory. Only descend into
    // directories — the folder also holds plain modules (types.js).
    const foldersPath = path.join(import.meta.dirname, "..", "commands");
    const commandFolders = fs
      .readdirSync(foldersPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file: string) => file.endsWith(".js"));

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = (await import(pathToFileURL(filePath).href)).default;

        if (!command) {
          console.log(`[WARNING] Skipping ${file} — no default export found.`);
          continue;
        }

        if ("data" in command && "execute" in command) {
          (
            luposClient as Client & {
              commands: DiscordCollection<string, unknown>;
            }
          ).commands.set(command.data.name, command);
          console.log(...LogFormatter.commandLoaded(command.data.name));
        } else {
          console.error(...LogFormatter.commandFailedToLoad(command.data.name));
        }
      }
    }
  },
  async cloneMessages() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const localMongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnReadyCloneMessages as (...args: unknown[]) => void,
    );
    // Also handle deletes during scraping
    DiscordUtilityService.onEventMessageDelete(
      luposClient,
      localMongo,
      luposOnMessageDelete as (...args: unknown[]) => void,
    );
  },
  async rescrapeChannels({
    channelIds,
    guildIds,
    dateLimit,
  }: Record<string, unknown> = {}) {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const localMongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { localMongo, channelIds, guildIds, dateLimit },
      luposOnReadyRescrapeChannels as (...args: unknown[]) => void,
    );
    // Register clone handlers so live messages aren't dropped when
    // Discord load-balances gateway events across the two sessions.
    DiscordUtilityService.onEventMessageCreate(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnMessageCreateCloneMessage as (...args: unknown[]) => void,
    );
    DiscordUtilityService.onEventMessageUpdate(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnMessageUpdateCloneMessage as (...args: unknown[]) => void,
    );
    DiscordUtilityService.onEventMessageDelete(
      luposClient,
      localMongo,
      luposOnMessageDelete as (...args: unknown[]) => void,
    );
  },
  async deleteDuplicateMessages() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const localMongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo: localMongo, localMongo },
      luposOnReadyDeleteDuplicateMessages as (...args: unknown[]) => void,
    );
  },
  async deleteNewAccounts() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      {},
      luposOnReadyDeleteNewAccounts as (...args: unknown[]) => void,
    );
  },
  async purgeYoungAccounts({ confirm = false }: { confirm?: boolean } = {}) {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    // Live purge only when the CLI explicitly passed confirm=true;
    // everything else (including boot-time invocations) stays dry-run.
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { dryRun: !confirm },
      luposOnReadyPurgeYoungAccounts as (...args: unknown[]) => void,
    );
  },
  async initializeBotLuposReports() {
    // Create the Mongo client first — reports mode boots standalone, so no
    // other initializer has registered "local" yet.
    await MongoService.createClient("local", config.DATABASE_URL as string);
    const mongo = MongoService.getClient(
      "local",
    ) as import("mongodb").MongoClient;
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN as string,
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo, localMongo: mongo },
      luposOnReadyReports as (...args: unknown[]) => void,
    );
  },
};

export default DiscordService;
