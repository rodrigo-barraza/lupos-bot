import { DateTime, Duration } from "luxon";
import crypto from "crypto";
import {
  Collection,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { GetColorName } from "hex-color-to-color-name";
import moment from "moment";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// CONFIG
import config from "#root/config.js";
// ARRAYS
import {
  rolesVideogames,
  warcraftClasses,
  warcraftFactions,
  channels,
} from "#root/arrays.js";
// SERVICES
import ScraperService from "#root/services/ScraperService.js";
import DiscordWrapper from "#root/wrappers/DiscordWrapper.js";
import YouTubeService from "#root/services/YouTubeService.js";
import LightsService from "#root/services/LightsService.js";
import ComfyUIService from "#root/services/ComfyUIService.js";
import MongoService from "#root/services/MongoService.js";
import PrismService from "#root/services/PrismService.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import MessageService from "#root/services/MessageService.js";
import AIService from "#root/services/AIService.js";
import CurrentService from "#root/services/CurrentService.js";
import TrendsService from "#root/services/TrendsService.js";
// JOBS
import BirthdayJob from "#root/jobs/scheduled/BirthdayJob.js";
import ActivityRoleAssignmentJob from "#root/jobs/scheduled/ActivityRoleAssignmentJob.js";
// const RemindersJob = require('../jobs/scheduled/RemindersJob.js');
import PermanentTimeOutJob from "#root/jobs/scheduled/PermanentTimeOutJob.js";
import RandomTagJob from "#root/jobs/scheduled/RandomTagJob.js";
import ServerIconJob from "#root/jobs/scheduled/ServerIconJob.js";
import EventReactJob from "#root/jobs/event-driven/ReactJob.js";
// LIBRARIES
import utilities from "#root/utilities.js";
// FORMATTERS
import LogFormatter from "#root/formatters/LogFormatter.js";
// CONSTANTS
import {
  MessageConstant,
  APRIL_FOOLS_MODE,
  GAME_ROLE_MAPPINGS,
  EXPLOSION_GIFS,
  YOUTUBE_BUTTON_ACTIONS,
} from "#root/constants.js";
import CensorService from "#root/services/CensorService.js";
import { kickIfTooNew } from "#root/services/AccountGuardService.js";

const args = process.argv.slice(2);
const mode = args.find((arg) => arg.startsWith("mode="))?.split("=")[1];

let lastMessageSentTime = DateTime.now().toISO();
let isProcessingQueue = false;
const queuedData = [];
const cancelledMessageIds = new Set();
const repliedMessagesCollection = new Collection();
const botRepliedMessages = new Collection();

/**
 * Check if a message has been cancelled (deleted by user).
 * Also auto-cleans up expired entries.
 */
function isMessageCancelled(messageId) {
  return cancelledMessageIds.has(messageId);
}
// QUEUE: Reactions
let isProcessingOnReactionQueue = false;
const reactionQueue = [];
const allUniqueUsers = {};
const reactionMessages = {};
const typingIntervals = {};

const underMaintenance = false;

function updateLastMessageSentTime() {
  setInterval(() => {
    const currentTime = DateTime.now();
    const lastMessageSentTimeObject = DateTime.fromISO(lastMessageSentTime);
    const difference = currentTime
      .diff(lastMessageSentTimeObject, ["seconds"])
      .toObject();
    if (difference.seconds >= 30) {
      lastMessageSentTime = currentTime.toISO();
    }
  }, 1000);
  return lastMessageSentTime;
}

// function to split emoji name and id, example: <:monkaHmm:722280797025075271>
async function splitEmojiNameAndId(emoji) {
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

async function extractEmojisFromAllMessage(
  message,
  localMongo,
  type = "EMOJI",
) {
  // Rodrigo: This returns a Collection of emojis with their captions
  const messageEmojisCollection = new Collection();
  const messageEmojis =
    message.content.split(" ").filter((part) => /<(a)?:.+:\d+>/g.test(part)) ||
    [];

  if (messageEmojis.length > 0) {
    // Prepare all emoji URLs and create a mapping
    const emojiUrls = [];
    const emojiMapping = new Map(); // Map URL to original emoji string

    for (const emoji of messageEmojis) {
      const parsedEmoji = emoji.replace(/[\n#]/g, "");
      const emojiId = parsedEmoji.split(":").pop().slice(0, -1);
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

async function generateDescription(
  systemPrompt, // should stay the same
  message, // should stay the same`
  participant, //is either user or member
  who,
  participantIndex, // used only for who='MENTIONED' or 'SECONDARY'
  messages, // should stay the same
  participantsAvatarsCollection, // should stay the same
  participantsBannersCollection, // should stay the same
  conversation,
  member,
  user,
) {
  if (!user) {
    // Rodrigo: We are currently passing both which is a bit redundant. See if it can be cleaned up,
    // even though it wouldn't affect performance.
    // Members have a user property, but Users do not have a member property
    if (member) {
      user = member.user;
    } else if (participant?.user) {
      user = participant.user;
    } else if (participant.id) {
      user = participant;
    }
  }

  if (!user) {
    console.error("No user found for participant:", participant);
    return systemPrompt;
  }

  let messageSentAt;
  let messageSentAtRelative;
  const combinedNames = utilities.getCombinedNamesFromUserOrMember({
    member,
    user,
  });

  if (messages?.size) {
    const lastMessageSentByUser = messages.find(
      (msg) => msg.author.id === user.id,
    );
    if (lastMessageSentByUser) {
      const lastMessageDateTime = DateTime.fromMillis(
        lastMessageSentByUser.createdTimestamp,
      );
      messageSentAt = lastMessageDateTime
        .setZone("local")
        .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
      messageSentAtRelative = lastMessageDateTime.toRelative();
    }
  }

  if (who === "PRIMARY") {
    systemPrompt += `\n\n# About me: ${combinedNames}`;
    systemPrompt += `\n- PRIMARY TARGET: You're replying to me only (aware of others but ignore them)`;
  } else if (who === "SECONDARY" || who === "MENTIONED") {
    systemPrompt += `\n\n# ${participantIndex}. ${combinedNames}`;
    // systemPrompt += `\n- SECONDARY TARGET: You're aware of others but ignore them (reply to me only)`;
  }

  // const avatarCaption =
  const avatarCaption = participantsAvatarsCollection.get(user.id)?.caption;
  const bannerCaption = participantsBannersCollection.get(user.id)?.caption;
  if (avatarCaption) {
    systemPrompt += `\n- Avatar description: ${avatarCaption}`;
  }

  if (bannerCaption) {
    systemPrompt += `\n- Banner description: ${bannerCaption}`;
  }

  const totalMessages = messages.filter(
    (msg) => msg.author.id === user.id,
  ).size;
  if (totalMessages) {
    systemPrompt += `\n- Total from the last ${messages.size} messages: ${totalMessages} messages`;
  }

  if (user?.id) {
    systemPrompt += `\n- Discord user ID: ${user.id}`;
  }
  if (member?.nickname) {
    systemPrompt += `\n- Nickname: ${member?.nickname}`;
  } // Server-specific nickname
  if (user?.globalName) {
    systemPrompt += `\n- Name: ${user.globalName}`;
  } // Discord nickname
  if (user?.username) {
    systemPrompt += `\n- Username: ${user.username}`;
  } // Discord username

  if (member?.presence?.status) {
    systemPrompt += `\n- Status: ${member.presence.status}`; // online, idle, dnd, offline
    if (member.presence.status === "online") {
      if (member?.presence?.clientStatus) {
        const platforms = Object.keys(member.presence.clientStatus);
        systemPrompt += `\n- Active on: ${platforms.join(", ")}`;
      }
    }
  }
  if (member?.presence?.activities?.length > 0) {
    const customStatus = member.presence.activities.find((a) => a.type === 4);
    if (customStatus?.state) {
      systemPrompt += `\n- Custom status: "${customStatus.state}"`;
    }

    // Current activities (playing games, listening to music, etc.)
    const activities = member.presence.activities
      .filter((a) => a.type !== 4)
      .map((a) => {
        const types = [
          "Playing",
          "Streaming",
          "Listening to",
          "Watching",
          "Custom",
          "Competing",
        ];
        const state = a.state ? `: (${a.state})` : "";
        return `${types[a.type]} ${a.name}${state}`;
      });
    if (activities.length > 0) {
      systemPrompt += `\n- Activities: ${activities.join(", ")}`;
    }
  }

  if (user?.accentColor) {
    // User must be force-fetched to get this property
    const toHex = (d) => "#" + d.toString(16).padStart(6, "0").toUpperCase();
    const hexColor = toHex(user.accentColor);
    const colorName = GetColorName ? GetColorName(hexColor) : hexColor;
    systemPrompt += `\n- Profile color (their choice of color): ${colorName} (${hexColor})`;
  }

  const createdDateTime = DateTime.fromMillis(user.createdTimestamp);
  const accountCreatedAt = createdDateTime
    .setZone("local")
    .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
  const accountCreatedAtRelative = createdDateTime.toRelative();
  systemPrompt += `\n- Account creation date: ${accountCreatedAt} (${accountCreatedAtRelative})`;
  if (messageSentAt && messageSentAtRelative) {
    systemPrompt += `\n- Last message sent on: ${messageSentAt} (${messageSentAtRelative})`;
  }

  // is timed out
  if (member?.communicationDisabledUntilTimestamp) {
    const disabledDateTime = DateTime.fromMillis(
      member.communicationDisabledUntilTimestamp,
    );
    if (member.communicationDisabledUntilTimestamp > Date.now()) {
      systemPrompt += `\n- Timed out until: ${disabledDateTime.toRelative()}`;
    } else {
      systemPrompt += `\n- Last timed out at: ${disabledDateTime.toRelative()}`;
    }
  }
  // when they joined the server
  if (member) {
    const joinedDateTime = DateTime.fromMillis(member.joinedTimestamp);
    const serverJoinDateAt = joinedDateTime
      .setZone("local")
      .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
    const serverJoinDateRelative = joinedDateTime.toRelative();
    systemPrompt += `\n- Join date: ${serverJoinDateAt} (${serverJoinDateRelative})`;
  }
  // is boosting the server
  if (member?.premiumSinceTimestamp) {
    const boostDateTime = DateTime.fromMillis(member.premiumSinceTimestamp);
    const boostDateAt = boostDateTime
      .setZone("local")
      .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
    const boostDateRelative = boostDateTime.toRelative();
    systemPrompt += `\n- Boosting since: ${boostDateAt} (${boostDateRelative})`;
  }

  // + Permissions
  if (member?.permissions?.has("Administrator")) {
    systemPrompt += `\n- Has administrator permissions`;
  }
  const modPerms = [
    "ManageMessages",
    "KickMembers",
    "BanMembers",
    "ManageRoles",
  ];
  const hasModPerms = modPerms.filter((perm) => member?.permissions?.has(perm));
  if (hasModPerms.length > 0) {
    systemPrompt += `\n- Moderation permissions: ${hasModPerms.join(", ")}`;
  }
  const channelPerms =
    member && message.channel ? member.permissionsIn(message.channel) : null;
  if (channelPerms) {
    if (!channelPerms.has("SendMessages")) {
      systemPrompt += `\n- Cannot send messages in this channel`;
    }
    if (!channelPerms.has("ViewChannel")) {
      systemPrompt += `\n- Cannot view this channel (but was mentioned)`;
    }
  }
  // - Permissions

  if (!member) {
    systemPrompt += `\n- They have left the server and are no longer in the chat because they ran away.`;
  } else {
    // + Manageable
    if (member.kickable) {
      systemPrompt += `\n- You can kick or ban them from the server`;
    } else {
      systemPrompt += `\n- You cannot kick or ban them from the server. You do not have permission to do so.`;
    }
    if (member.manageable) {
      systemPrompt += `\n- You can manage this user's roles`;
    } else {
      systemPrompt += `\n- You cannot manage this user's roles.`;
    }
    // - Manageable
    // + Server Roles
    if (member.roles?.cache.size > 1) {
      systemPrompt += `\n- Roles: ${member.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name)
        .join(", ")}`;
      if (member.roles.highest) {
        systemPrompt += `\n- Current highest role: ${member.roles.highest.name}`;
        // systemPrompt += `\n- Highest role: ${member.roles.highest.name} (position: ${member.roles.highest.position})`;
      }
    } else {
      systemPrompt += `\n- Roles: No roles`;
    }
    // - Server Roles
    if (member.displayHexColor) {
      systemPrompt += `\n- Display name color (dependant on current highest role): ${GetColorName(member?.displayHexColor)} (${member.displayHexColor})`;
    }
  }

  // is it a bot
  if (user.bot) {
    systemPrompt += `\n- They are a bot`;
  }

  // + Voice Channel Details
  if (member?.voice?.channel) {
    systemPrompt += `\n- In voice channel: ${member.voice.channel.name}`;
    if (member.voice.deaf || member.voice.selfDeaf) {
      systemPrompt += `\n- Deafened in voice`;
    }
    if (member.voice.mute || member.voice.selfMute) {
      systemPrompt += `\n- Muted in voice`;
    }
    if (member.voice.streaming) {
      systemPrompt += `\n- Streaming in voice`;
    }
    if (member.voice.cameraOn) {
      systemPrompt += `\n- Camera on in voice`;
    }
    if (member.voice.suppress) {
      systemPrompt += `\n- Suppressed in voice`;
    }
    if (member.voice.requestedToSpeak) {
      systemPrompt += `\n- Requested to speak in voice`;
    }
  }
  // - Voice Channel Details

  if (who === "PRIMARY") {
    systemPrompt += `\n\n## My conversation summary `;
    systemPrompt += `\n${conversation}`;
  } else if (who === "SECONDARY") {
    systemPrompt += `\n\n## The conversation summary of ${combinedNames}`;
    systemPrompt += `\n${conversation}`;
  }
  return systemPrompt;
}

async function buildAndGenerateReply({
  canGenerateImage,
  conversation,
  conversationsCollection,
  memberMentionsCollection,
  messagesEmojisCollection,
  messagesImagesCollection,
  newSystemPrompt,
  participantsAvatarsCollection,
  participantsBannersCollection,
  participantsCollection,
  participantsMembersCollection,
  participantsUsersCollection,
  queuedDatum,
  isMessageAskingToGenerateImage,
  userMentionsCollection,
  localMongo,
}) {
  // Rodrigo: This creates a SYSTEM PROMPT
  const { message, recentMessages } = queuedDatum;
  const client = message.client;
  const bot = client.user;
  let systemPrompt = newSystemPrompt;

  let systemPromptForImagePromptGeneration;
  let promptForImagePromptGeneration;
  let systemPromptForTextGeneration;

  // let imagePrompt;
  let generatedText;
  const serverContext = [];
  let image;
  const start = performance.now();
  try {
    if (
      message.guildId === config.GUILD_ID_PRIMARY ||
      message.guildId === config.GUILD_ID_TESTING
    ) {
      // Rodrigo: If any of the recent messages match the custom context keywords...
      // ... or if the name of the user matches the custom context keywords
      const customContextWhitemane = MessageConstant.customContextWhitemane;
      const serverContextSet = new Set();

      const contextWithPatterns = customContextWhitemane.map((context) => {
        const keywords = Array.isArray(context.keywords)
          ? context.keywords
          : context.keywords.split(/[,\s]+/);
        const patterns = keywords.map(
          (keyword) =>
            new RegExp(
              `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
              "i",
            ),
        );
        return { context, patterns };
      });

      // Rodrigo: This searches the recent messages for the custom context keywords
      for (const recentMessage of recentMessages.values()) {
        let searchText = `${recentMessage.cleanContent}`;

        if (recentMessage.author) {
          searchText += ` ${recentMessage.author?.globalName} ${recentMessage.author?.username} ${recentMessage.author?.displayName}`;
        }

        searchText = searchText.toLowerCase();

        for (const { context, patterns } of contextWithPatterns) {
          if (patterns.some((pattern) => pattern.test(searchText))) {
            serverContextSet.add(context);
          }
        }
      }
      serverContext.push(...serverContextSet);
    }

    systemPrompt = `# Discord client information`;
    systemPrompt += `\n- Your name: ${utilities.getCombinedNamesFromUserOrMember({ user: bot })}`;
    systemPrompt += `\n- Your discord user ID tag: <@${bot.id}>`;
    systemPrompt += `\n- The current date and time is ${moment().format("dddd, MMMM Do, YYYY at h:mm A")} PST.`;
    systemPrompt += `\n- To mention, tag or reply to someone, you do it by mentioning their Discord user ID tag. For example, to mention me, you would type <@${bot.id}>.`;

    if (message.guild) {
      const bans = await message.guild.bans.fetch();

      systemPrompt += `\n\n# Discord server information`;
      // GUILD NAME
      systemPrompt += `\n- You are in the discord server called: ${message.guild.name}.`;
      // CREATED AT
      const createdDateTime = DateTime.fromMillis(
        message.guild.createdTimestamp,
      );
      const createdAtTimestampAt = createdDateTime
        .setZone("local")
        .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
      const createdAtTimestampRelative = createdDateTime.toRelative();
      systemPrompt += `\n- This server was created on: ${createdAtTimestampAt} (${createdAtTimestampRelative})`;
      // DESCRIPTION
      if (message.guild.description) {
        systemPrompt += `\n- The server description is: ${message.guild.description}`;
      }
      // SERVER HAS
      systemPrompt += `\n- This server has:`;
      systemPrompt += `\n  - ${message.guild.memberCount} members`;
      systemPrompt += `\n  - ${message.guild.channels.cache.size} channels`;
      systemPrompt += `\n  - ${message.guild.premiumSubscriptionCount} server nitro boosts`;
      if (message.guild.mfaLevel === 1) {
        systemPrompt += `\n  - 2FA enabled`;
      }
      // mfaLevel
      // commands
      if (message.guild.commands.cache.size) {
        systemPrompt += `\n  - ${message.guild.commands.cache.size} commands:`;
        for (const command of message.guild.commands.cache.values()) {
          systemPrompt += `\n    - ${command.name} (${command.description})`;
        }
      }
      // bans
      if (bans.size) {
        systemPrompt += `\n  - ${bans.size} bans`;
      }
      // emojis
      if (message.guild.emojis.cache.size) {
        systemPrompt += `\n  - ${message.guild.emojis.cache.size} emojis`;
        // const serverEmojis = await DiscordUtilityService.getAllServerEmojisFromMessage(message, 'string');
        // systemPrompt += `\n- The server emojis are: ${serverEmojis}`;
        // systemPrompt += `\n- You can use any of these emojis in your response by typing the emoji name.`;
      }
      // roles
      if (message.guild.roles.cache.size) {
        systemPrompt += `\n  - ${message.guild.roles.cache.size} roles`;
      }
      // owner
      if (message.guild.ownerId) {
        // const owner = await message.guild.members.cache.get(message.guild.ownerId);
        // const ownerUsername = owner ? owner.displayName || owner.user.username : 'Unknown';
        // systemPrompt += `\n- The server owner is: ${message.guild.ownerId}`;
      }

      // who is in voice chat
      const voiceChannelMembers = message.guild.channels.cache.filter(
        (channel) => channel.type === "GUILD_VOICE" && channel.members.size > 0,
      );
      if (voiceChannelMembers.size) {
        systemPrompt += `\n- The following voice channels have members in them:`;
        for (const channel of voiceChannelMembers.values()) {
          systemPrompt += `\n  - ${channel.name} (${channel.members.size} members)`;
          for (const member of channel.members.values()) {
            systemPrompt += `\n    - ${utilities.getCombinedNamesFromUserOrMember({ member })}`;
          }
        }
      }
    }
    if (message?.channel) {
      systemPrompt += `\n\n# Discord channel information`;
      systemPrompt += `\n- You are in the channel called: ${message.channel.name}`;
      if (message.channel.topic) {
        systemPrompt += `\n- The channel topic is: ${message.channel.topic}.`;
      }
      const channelCreatedDateTime = DateTime.fromMillis(
        message.channel.createdTimestamp,
      );
      const channelCreatedAt = channelCreatedDateTime
        .setZone("local")
        .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
      const channelCreatedAtRelative = channelCreatedDateTime.toRelative();
      systemPrompt += `\n- This channel was created on: ${channelCreatedAt} (${channelCreatedAtRelative})`;
      if (message.channel.lastMessage) {
        const lastMessageCreatedDateTime = DateTime.fromMillis(
          message.channel.lastMessage.createdTimestamp,
        );
        const lastMessageSentAt = lastMessageCreatedDateTime
          .setZone("local")
          .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
        const lastMessageSentAtRelative =
          lastMessageCreatedDateTime.toRelative();
        systemPrompt += `\n- Last message in this channel sent at: ${lastMessageSentAt} (${lastMessageSentAtRelative})`;
      } else {
        systemPrompt += `\n- No messages have been sent in this channel yet.`;
      }
    }

    let participantMember;
    let participantUser;
    let participantConversation;

    // Rodrigo: Process primary participant (the message author)
    if (participantsCollection?.size) {
      const primaryParticipant = participantsCollection.get(message.author?.id);
      if (primaryParticipant && primaryParticipant.user) {
        participantMember = participantsMembersCollection.get(
          message.author?.id,
        );
        participantUser = participantsUsersCollection.get(message.author?.id);
        participantConversation = conversationsCollection.get(
          message.author?.id,
        );
      }
      systemPrompt = await generateDescription(
        systemPrompt,
        message,
        message.author,
        "PRIMARY",
        null,
        recentMessages,
        participantsAvatarsCollection,
        participantsBannersCollection,
        participantConversation,
        participantMember,
        participantUser,
      );
    }

    // Rodrigo: Detect untagged user names in image generation requests
    // e.g. "draw Rodrigo as a samurai" without @Rodrigo
    const untaggedMatchedUserIds = new Set();
    if (isMessageAskingToGenerateImage) {
      // Build list of known participants (exclude bot, already-mentioned users, and message author)
      // The author is excluded because "draw your X" shouldn't match the author's name.
      // If the author wants to draw themselves, they should use "draw me" or @mention themselves.
      const alreadyMentionedIds = new Set([
        ...(memberMentionsCollection?.keys() || []),
        ...(userMentionsCollection?.keys() || []),
        bot.id,
        message.author?.id,
      ]);

      const knownParticipants = [];
      const addedIds = new Set();
      for (const [id, member] of participantsMembersCollection.entries()) {
        if (alreadyMentionedIds.has(id)) continue;
        addedIds.add(id);
        knownParticipants.push({
          id,
          username: member.user?.username || member.username || "",
          displayName:
            member.displayName ||
            member.user?.globalName ||
            member.user?.username ||
            "",
        });
      }
      // Also check participantsUsersCollection for users not in members
      for (const [id, user] of participantsUsersCollection.entries()) {
        if (alreadyMentionedIds.has(id) || addedIds.has(id)) continue;
        addedIds.add(id);
        knownParticipants.push({
          id,
          username: user.username || "",
          displayName: user.globalName || user.username || "",
        });
      }
      // Also check the guild member cache (covers users from reactions, voice, other channels, etc.)
      // Pre-filter: only include members whose name appears in the message (avoids sending thousands of names to AI)
      if (message.guild?.members?.cache) {
        const messageTextLower = (
          message.cleanContent ||
          message.content ||
          ""
        ).toLowerCase();
        for (const [id, member] of message.guild.members.cache.entries()) {
          if (
            alreadyMentionedIds.has(id) ||
            addedIds.has(id) ||
            member.user?.bot
          )
            continue;
          const username = (member.user?.username || "").toLowerCase();
          const displayName = (
            member.displayName ||
            member.user?.globalName ||
            ""
          ).toLowerCase();
          // Only include if the name (3+ chars) appears in the message text
          const hasNameMatch =
            (username.length >= 3 && messageTextLower.includes(username)) ||
            (displayName.length >= 3 && messageTextLower.includes(displayName));
          if (!hasNameMatch) continue;
          addedIds.add(id);
          knownParticipants.push({
            id,
            username: member.user?.username || "",
            displayName:
              member.displayName ||
              member.user?.globalName ||
              member.user?.username ||
              "",
          });
        }
      }

      if (knownParticipants.length > 0) {
        const matchedIds = await AIService.generateTextExtractMentionedNames(
          message.cleanContent || message.content,
          knownParticipants,
          message,
        );

        for (const matchedId of matchedIds) {
          untaggedMatchedUserIds.add(matchedId);
          // Add to memberMentionsCollection so they get full generateDescription treatment
          if (!memberMentionsCollection.has(matchedId)) {
            const member =
              participantsMembersCollection.get(matchedId) ||
              message.guild?.members?.cache?.get(matchedId);
            const user = participantsUsersCollection.get(matchedId);
            if (member) {
              memberMentionsCollection.set(matchedId, member);
            } else if (user) {
              userMentionsCollection.set(matchedId, user);
            } else if (message.guild) {
              // Last resort: fetch the member from the guild API
              try {
                const fetchedMember =
                  await DiscordUtilityService.retrieveMemberFromGuildById(
                    message.guild,
                    matchedId,
                  );
                if (fetchedMember) {
                  memberMentionsCollection.set(matchedId, fetchedMember);
                }
              } catch {
                console.warn(
                  `🏷️ [DiscordService] Could not fetch member ${matchedId} from guild`,
                );
              }
            }
          }
        }

        if (untaggedMatchedUserIds.size > 0) {
          console.log(
            `🏷️ [DiscordService] Detected ${untaggedMatchedUserIds.size} untagged user(s) in draw request: ${[...untaggedMatchedUserIds].join(", ")}`,
          );
        }
      }
    }

    // Detect GROUP references (e.g. "draw the top 5 people here", "draw everyone")
    // Always check for group references in image requests — the AI returns 0 for non-group cases.
    // This handles mixed cases like "draw @Rodrigo surrounded by everyone" correctly.
    if (isMessageAskingToGenerateImage) {
      const groupCount = await AIService.generateTextDetectGroupReference(
        message.cleanContent || message.content,
        message,
      );

      if (groupCount > 0) {
        console.log(
          `👥 [DiscordService] Detected group reference requesting ${groupCount} people`,
        );

        // Rank participants by message count in recentMessages (exclude bot only)
        const messageCounts = new Map();
        for (const msg of recentMessages.values()) {
          const authorId = msg.author?.id;
          if (!authorId || authorId === bot.id) continue;
          messageCounts.set(authorId, (messageCounts.get(authorId) || 0) + 1);
        }

        // Sort by message count (most active first), cap at groupCount
        const cap =
          groupCount === 99
            ? Math.min(messageCounts.size, 10) // "everyone" capped at 10
            : Math.min(groupCount, messageCounts.size);

        const topUserIds = [...messageCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, cap)
          .map(([id]) => id);

        // Add the message author too (they said "us" / "the boys" — likely including themselves)
        if (!topUserIds.includes(message.author.id)) {
          topUserIds.unshift(message.author.id);
          // Keep within cap
          if (topUserIds.length > cap && cap > 0) topUserIds.pop();
        }

        for (const userId of topUserIds) {
          untaggedMatchedUserIds.add(userId);
          if (!memberMentionsCollection.has(userId)) {
            const member =
              participantsMembersCollection.get(userId) ||
              message.guild?.members?.cache?.get(userId);
            const user = participantsUsersCollection.get(userId);
            if (member) {
              memberMentionsCollection.set(userId, member);
            } else if (user) {
              userMentionsCollection.set(userId, user);
            } else if (message.guild) {
              try {
                const fetchedMember =
                  await DiscordUtilityService.retrieveMemberFromGuildById(
                    message.guild,
                    userId,
                  );
                if (fetchedMember) {
                  memberMentionsCollection.set(userId, fetchedMember);
                }
              } catch {
                console.warn(
                  `👥 [DiscordService] Could not fetch member ${userId} from guild`,
                );
              }
            }
          }
        }

        if (topUserIds.length > 0) {
          console.log(
            `👥 [DiscordService] Auto-populated ${topUserIds.length} participants for group reference: ${topUserIds.join(", ")}`,
          );
        }
      }
    }

    // Rodrigo: Process mentioned members
    if (memberMentionsCollection?.size) {
      systemPrompt += `\n\n# Mentioned members in this server (${memberMentionsCollection.size})`;
      let currentUserCount = 0;
      for (const member of memberMentionsCollection.values()) {
        currentUserCount++;
        participantMember = participantsMembersCollection.get(member.id);
        // Rodrigo: Sometimes the mentioned member has not sent any messages ...
        // ... which means it's not in the cache ...
        // ... so we need to fetch from the message
        if (!participantMember) {
          participantMember =
            await DiscordUtilityService.retrieveMemberFromGuildById(
              message.guild,
              member.id,
            );
        }
        participantUser = participantsUsersCollection.get(member.id);
        participantConversation = conversationsCollection.get(member.id);

        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          member,
          "MENTIONED",
          currentUserCount,
          recentMessages,
          participantsAvatarsCollection,
          participantsBannersCollection,
          participantConversation,
          participantMember,
          participantUser,
        );
      }
    }
    // Rodrigo: Process mentioned users (which means they are not in the server)
    if (userMentionsCollection?.size) {
      systemPrompt += `\n\n# Mentioned users not in this server (${userMentionsCollection.size})`;
      let currentUserCount = 0;
      for (const user of userMentionsCollection.values()) {
        currentUserCount++;
        participantMember = participantsMembersCollection.get(user.id);
        // Rodrigo: Sometimes the mentioned member has not sent any messages ...
        // ... which means it's not in the cache ...
        // ... so we need to fetch from the message
        if (!participantMember) {
          participantMember =
            await DiscordUtilityService.retrieveMemberFromGuildById(
              message.guild,
              user.id,
            );
        }
        participantUser = participantsUsersCollection.get(user.id);
        participantConversation = conversationsCollection.get(user.id);

        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          user,
          "MENTIONED",
          currentUserCount,
          recentMessages,
          participantsAvatarsCollection,
          participantsBannersCollection,
          participantConversation,
          participantMember,
          participantUser,
        );
      }
    }
    // Rodrigo: Process secondary participants
    // Rodrigo: Has to be greater than one, since it includes Lupos
    if (participantsCollection?.size > 1) {
      systemPrompt += `\n\n# Secondary participants (${participantsCollection.size - 1})`;
      systemPrompt += `\nYou are aware of other participants in this conversation, but you are only replying to me.`;
      let currentUserCount = 0;
      // Rodrigo: This filter is turned off for now, since removing them from this list might make the AI think they are not part of the conversation,
      // and people that are mentioned, might not be part of the conversation.
      // const filteredParticipants = participantsCollection.filter(participant => {
      //     return !userMentionsCollection.has(participant.user.id) && !memberMentionsCollection.has(participant.user.id);
      // });
      for (const participant of participantsCollection.values()) {
        if (!participant?.user?.id || participant.user.id === message.author.id)
          continue;
        participantConversation = conversationsCollection.get(
          participant.user.id,
        );
        participantMember = participantsMembersCollection.get(
          participant.user.id,
        );
        participantUser = participantsUsersCollection.get(participant.user.id);
        currentUserCount++;
        systemPrompt = await generateDescription(
          systemPrompt,
          message,
          participant,
          "SECONDARY",
          currentUserCount,
          recentMessages,
          participantsAvatarsCollection,
          participantsBannersCollection,
          participantConversation,
          participantMember,
          participantUser,
        );
      }
    }

    if (messagesEmojisCollection?.size) {
      systemPrompt += `\n\n# A list of custom emoji names and their descriptions in this conversation (${messagesEmojisCollection.size})`;
      systemPrompt += `\nTo use these emojis, simply type the name of the emoji. Good examples: <a:emoji_name:1065508812565528596>, <emoji_name:1065508812565528596>. Bad example: :emoji_name:`;

      for (const [emoji, emojiObject] of messagesEmojisCollection.entries()) {
        // systemPrompt += `\n- ${emoji}: ${emojiObject.caption}`;
        systemPrompt += `\n- ${emoji}: ${emojiObject.caption}`;
      }
    }

    if (serverContext?.length) {
      systemPrompt += "\n\n# Relevant information for this conversation";
      for (const context of serverContext) {
        systemPrompt += `\n\n# ${context.title}`;
        systemPrompt += `\n- Keywords: ${context.keywords}`;
        systemPrompt += `\n- Description: ${context.description}`;
      }
    }

    // Memory retrieval — search for relevant memories about participants
    if (message.guildId) {
      try {
        // Collect all participant user IDs for the search
        const participantUserIds = [];
        if (message.author?.id) participantUserIds.push(message.author.id);
        for (const [id] of memberMentionsCollection.entries()) {
          if (!participantUserIds.includes(id)) participantUserIds.push(id);
        }
        for (const [id] of userMentionsCollection.entries()) {
          if (!participantUserIds.includes(id)) participantUserIds.push(id);
        }
        // Add secondary participants
        if (participantsCollection?.size) {
          for (const participant of participantsCollection.values()) {
            if (
              participant?.user?.id &&
              !participantUserIds.includes(participant.user.id)
            ) {
              participantUserIds.push(participant.user.id);
            }
          }
        }

        // Build a search query from recent conversation context (not just the triggering message)
        const recentUserConvo = conversation
          .filter((m) => m.role === "user")
          .slice(-5)
          .map((m) => m.content)
          .join("\n");
        const queryText =
          recentUserConvo || message.cleanContent || message.content || "";
        if (queryText.length > 3) {
          const memoryResult = await PrismService.searchMemories({
            guildId: message.guildId,
            userIds: participantUserIds,
            queryText,
            limit: 8,
          });

          if (memoryResult?.memories?.length > 0) {
            systemPrompt += `\n\n# Memories about participants`;
            systemPrompt += `\nThese are things you remember from past conversations. Use them naturally when relevant — don't force them into every response.`;
            for (const memory of memoryResult.memories) {
              const createdDate = new Date(memory.createdAt);
              const timeAgo = DateTime.fromJSDate(createdDate).toRelative();
              systemPrompt += `\n- ${memory.fact} (about ${memory.aboutUsername}, remembered ${timeAgo})`;
            }
          }
        }
      } catch (memoryErr) {
        console.warn(
          `🧠 [DiscordService] Memory retrieval failed: ${memoryErr.message}`,
        );
      }
    }

    // Trending data — inject what's trending across Trends, Products, and Beacon
    try {
      const trendingSummary = await TrendsService.getTrendingSummary();
      if (trendingSummary) {
        systemPrompt += trendingSummary;
      }
    } catch (trendsErr) {
      console.warn(
        `📈 [DiscordService] Trends retrieval failed: ${trendsErr.message}`,
      );
    }

    let shouldRedrawImage = false;
    const imageUrls = [];
    const imageLabels = []; // Tracks what each image in imageUrls represents
    const mentionsImageUrls = [];
    // This creates a shallow copy, which is no different than what we had before, can be changed back.
    let edittedMessageCleanContent = "";
    let composition = String(message.cleanContent);

    // // Remove first occurrence of bot mention from the clean content '@Lupos'
    const botMentionSyntax = `@${bot.username}`;
    if (composition.includes(botMentionSyntax)) {
      composition = composition.replace(botMentionSyntax, "").trim();
    }

    // if has image attachment, check if messagesImagesCollection has any images using the message id as the key
    if (message.attachments && message.attachments.size > 0) {
      const attachmentImages = messagesImagesCollection.filter((value, key) => {
        return key.startsWith(message.id);
      });
      if (attachmentImages.size > 0) {
        shouldRedrawImage = true;
        for (const imageObject of attachmentImages.first().values()) {
          const imageUrl = imageObject.url;
          imageLabels.push("Attached image from message");
          imageUrls.push(imageUrl);
        }
      }
    }

    // if has emojis, add the emoji images to the imageUrls array
    // if (emojisInMessage && emojisInMessage.size > 0) {
    //     for (const emojiObject of emojisInMessage.values()) {
    //         if (emojiObject && emojiObject.url) {
    //             imageUrls.push(emojiObject.url);
    //         }
    //     }
    // }

    // If it's replying to a message with an image
    if (message.reference && message.reference.messageId) {
      const referencedMessageImages = messagesImagesCollection.filter(
        (value, key) => {
          return key.startsWith(message.reference.messageId);
        },
      );
      // If the referenced message has an image in the collection, use that
      // (Only user messages are stored, not bot messages)
      if (referencedMessageImages.size > 0) {
        shouldRedrawImage = true;
        const imageUrl = referencedMessageImages.first().values().next()
          .value.url;
        imageLabels.push("Replied-to message image");
        imageUrls.push(imageUrl);
      } else {
        // If the referenced message is not in the collection, because we process a random amount of messages (5-100) ...
        // ... then we need to fetch the message and check if it has an attachment that is an image ...
        // ... this is a fallback in case the referenced message is not in the recent messages ...
        // ... along with bot messages
        const messageReference =
          await DiscordUtilityService.retrieveMessageReferenceFromMessage(
            message,
          );
        if (
          messageReference &&
          messageReference.attachments &&
          messageReference.attachments.size > 0
        ) {
          const imageAttachment = messageReference.attachments.find(
            (attachment) => {
              return (
                attachment.contentType &&
                attachment.contentType.startsWith("image/")
              );
            },
          );
          if (imageAttachment) {
            shouldRedrawImage = true;
            const imageUrl = imageAttachment.proxyURL || imageAttachment.url;
            imageLabels.push("Replied-to message image");
            imageUrls.push(imageUrl);
          }
        }
      }
    }

    // Caption images with SHORT and add the captions to the edittedMessageContent
    if (imageUrls.length > 0) {
      const { imagesMap } = await AIService.captionImages(
        imageUrls,
        localMongo,
        "SMALL",
      );
      edittedMessageCleanContent += `# Input Reference Images:`;
      let index = 0;
      for (const mapObject of imagesMap.values()) {
        const captionToAdd = `${mapObject.caption}`;
        edittedMessageCleanContent += `\n* Attached ${index + 1}: ${captionToAdd}`;
        index++;
      }
    }
    // If it mentions a user with an avatar, use that avatar as the image
    if (
      isMessageAskingToGenerateImage &&
      message.mentions &&
      message.mentions.users.size > 0
    ) {
      // Get the ID of the user being replied to (if this is a reply)
      const messageReference =
        await DiscordUtilityService.retrieveMessageReferenceFromMessage(
          message,
        );
      const repliedUserId = messageReference?.author?.id;

      let mentionedMembersOrUsersWithAvatars = message.mentions.members.filter(
        (member) => {
          // Exclude bot and the replied-to user (if this is a reply)
          return (
            member.id !== bot.id &&
            member.id !== repliedUserId &&
            member.user.avatar
          );
        },
      );

      if (mentionedMembersOrUsersWithAvatars.size === 0) {
        mentionedMembersOrUsersWithAvatars = message.mentions.users.filter(
          (user) => {
            // Exclude bot and the replied-to user (if this is a reply)
            return (
              user.id !== bot.id && user.id !== repliedUserId && user.avatar
            );
          },
        );
      }

      if (mentionedMembersOrUsersWithAvatars.size > 0) {
        for (const memberOrUser of mentionedMembersOrUsersWithAvatars.values()) {
          shouldRedrawImage = true;
          const avatarUrl = memberOrUser.displayAvatarURL({
            format: "png",
            size: 512,
          });
          mentionsImageUrls.push({ userId: memberOrUser.id, url: avatarUrl });
        }
        if (mentionsImageUrls.length > 0) {
          const { imagesMap } = await AIService.captionImages(
            mentionsImageUrls,
            localMongo,
            "SMALL",
          );
          if (!edittedMessageCleanContent.length) {
            edittedMessageCleanContent += `# Input Reference Images:`;
          }
          let index = 0;
          for (const [_hash, mapObject] of imagesMap.entries()) {
            shouldRedrawImage = true;
            const userDisplayName = await DiscordUtilityService.getDisplayName(
              message,
              mapObject.userId,
            );
            // const mentionSyntax = `@${userDisplayName}`;
            const captionToAdd = `(${mapObject.caption})`;
            // composition = composition.replace(mentionSyntax, `${mentionSyntax} ${captionToAdd}`);
            imageLabels.push(`${userDisplayName}'s avatar/profile picture`);
            imageUrls.push(mapObject.url);
            edittedMessageCleanContent += `\n* Person ${index + 1}: ${userDisplayName} ${captionToAdd}`;
            index++;
          }
        }
      }
    }
    // Rodrigo: Handle avatars for untagged matched users (detected by name, not @tag)
    if (isMessageAskingToGenerateImage && untaggedMatchedUserIds.size > 0) {
      const messageReference =
        await DiscordUtilityService.retrieveMessageReferenceFromMessage(
          message,
        );
      const repliedUserId = messageReference?.author?.id;

      for (const matchedId of untaggedMatchedUserIds) {
        // Skip if already handled by @mention block above
        if (mentionsImageUrls.some((m) => m.userId === matchedId)) continue;
        // Skip bot and replied-to user
        if (matchedId === bot.id || matchedId === repliedUserId) continue;

        // Try to get the member from the guild for their avatar
        let matchedMember = participantsMembersCollection.get(matchedId);
        if (!matchedMember && message.guild) {
          matchedMember =
            await DiscordUtilityService.retrieveMemberFromGuildById(
              message.guild,
              matchedId,
            );
        }
        const matchedUser = participantsUsersCollection.get(matchedId);
        const avatarSource = matchedMember || matchedUser;

        if (avatarSource && avatarSource.displayAvatarURL) {
          shouldRedrawImage = true;
          const avatarUrl = avatarSource.displayAvatarURL({
            format: "png",
            size: 512,
          });
          mentionsImageUrls.push({ userId: matchedId, url: avatarUrl });
        }
      }
      // Caption any new untagged user avatars
      if (mentionsImageUrls.length > 0) {
        // Only caption the newly added ones (avoid re-captioning @mention avatars)
        const uncaptionedUrls = mentionsImageUrls.filter(
          (m) => !imageUrls.includes(m.url),
        );
        if (uncaptionedUrls.length > 0) {
          const { imagesMap } = await AIService.captionImages(
            uncaptionedUrls,
            localMongo,
            "SMALL",
          );
          if (!edittedMessageCleanContent.length) {
            edittedMessageCleanContent += `# Input Reference Images:`;
          }
          for (const [_hash, mapObject] of imagesMap.entries()) {
            shouldRedrawImage = true;
            const userDisplayName = await DiscordUtilityService.getDisplayName(
              message,
              mapObject.userId,
            );
            const captionToAdd = `(${mapObject.caption})`;
            imageLabels.push(`${userDisplayName}'s avatar/profile picture`);
            imageUrls.push(mapObject.url);
            edittedMessageCleanContent += `\n* Person (detected by name): ${userDisplayName} ${captionToAdd}`;
          }
        }
      }
    }

    // If emotion emojis are present, add them to the composition
    const emojisInMessage = await extractEmojisFromAllMessage(
      message,
      localMongo,
      "SMALL",
    );
    if (emojisInMessage && emojisInMessage.size > 0) {
      if (!edittedMessageCleanContent.length) {
        edittedMessageCleanContent += `# Input Reference Images:`;
      }
      let index = 0;
      for (const [emoji, emojiObject] of emojisInMessage.entries()) {
        if (emojiObject && emojiObject.url) {
          imageLabels.push(`Emoji: ${emojiObject.name || emoji}`);
          imageUrls.push(emojiObject.url);
          const emojiCaption = emojiObject.caption
            ? `(${emojiObject.caption})`
            : "";
          const emojiData = await splitEmojiNameAndId(emoji);
          const emojiName = emojiData ? emojiData.name : "";
          edittedMessageCleanContent += `\n* Emoji ${index + 1}: ${emojiName} ${emojiCaption}`;
          index++;
        }
      }
    }

    edittedMessageCleanContent += `\n\n# Composition Guidelines:`;
    edittedMessageCleanContent += `\n- The attached images are references for style, colors, mood, and elements to include in the composition.`;
    edittedMessageCleanContent += `\n- The persons should be clearly recognizable but artistically adapted to match a unified scene`;
    edittedMessageCleanContent += `\n- The emojis should be integrated into the scene in a natural and cohesive way`;
    edittedMessageCleanContent += `\n- Maintain the core visual identity from the profile (colors, shapes, patterns) while allowing creative interpretation for scene cohesion`;
    edittedMessageCleanContent += `\n\n# Output:`;
    edittedMessageCleanContent += `\n${composition}`;

    const conversationForTextGeneration = [...conversation];
    const assistantMessage = MessageService.assembleAssistantMessage(
      canGenerateImage,
      message.guildId,
    );

    if (isMessageAskingToGenerateImage) {
      promptForImagePromptGeneration =
        await AIService.generateTextPromptForImagePromptGeneration(
          conversationForTextGeneration,
          systemPrompt,
          shouldRedrawImage,
          edittedMessageCleanContent,
        );

      const username = message.author?.username || "unknown";

      // Check if message was deleted before starting expensive image generation
      if (isMessageCancelled(message.id)) {
        console.log(
          `🗑️ [DiscordService] Message ${message.id} was deleted before image generation, aborting.`,
        );
        return {
          generatedText: null,
          image: null,
          promptForImagePromptGeneration: null,
        };
      }

      // Step 1: Generate the image first (before text reply)
      // Step 1: Always try Google first (no upfront NSFW filtering)
      // Prepend image-to-person mapping so Gemini knows which attached image is which
      let labeledPrompt = promptForImagePromptGeneration;
      if (imageLabels.length > 0 && imageUrls.length > 0) {
        const mapping = imageLabels
          .map((label, i) => `- Attached image ${i + 1}: ${label}`)
          .join("\n");
        labeledPrompt = `REFERENCE IMAGE MAP (the attached images correspond to):\n${mapping}\n\n${promptForImagePromptGeneration}`;
      }
      image = await AIService.generateImage(
        "GOOGLE",
        labeledPrompt,
        client,
        imageUrls,
        username,
      );

      // Step 2: If image generation failed (e.g. Gemini content policy rejection),
      // creatively redescribe the prompt and retry
      if (!image && promptForImagePromptGeneration) {
        console.log(
          "⚠️ [DiscordService] Image generation returned null, creatively redescribing prompt and retrying...",
        );
        const redescribedPrompt = await AIService.redescribeImagePrompt(
          promptForImagePromptGeneration,
          message,
        );
        if (
          redescribedPrompt &&
          redescribedPrompt !== promptForImagePromptGeneration
        ) {
          console.log(
            `🎨 [DiscordService] Redescribed prompt: "${redescribedPrompt.substring(0, 100)}..."`,
          );
          promptForImagePromptGeneration = redescribedPrompt;
          // Re-prepend image mapping for the retry
          let retryPrompt = redescribedPrompt;
          if (imageLabels.length > 0 && imageUrls.length > 0) {
            const mapping = imageLabels
              .map((label, i) => `- Attached image ${i + 1}: ${label}`)
              .join("\n");
            retryPrompt = `REFERENCE IMAGE MAP (the attached images correspond to):\n${mapping}\n\n${redescribedPrompt}`;
          }
          image = await AIService.generateImage(
            "GOOGLE",
            retryPrompt,
            client,
            imageUrls,
            username,
          );
        }
      }

      // Step 3: Generate text reply BASED ON whether image was actually produced
      if (image) {
        // Collect mention syntax for all drawn users (from @mentions and untagged matches)
        const drawnUserMentions = [];
        const addedMentionIds = new Set();
        for (const imgMention of mentionsImageUrls) {
          if (imgMention.userId && !addedMentionIds.has(imgMention.userId)) {
            addedMentionIds.add(imgMention.userId);
            drawnUserMentions.push(`<@${imgMention.userId}>`);
          }
        }
        // Also include the message author if they asked to draw themselves
        // (they're already in the conversation context, no need to add here)

        generatedText = await AIService.generateTextReplyImageGenerated(
          conversationForTextGeneration,
          assistantMessage,
          systemPrompt,
          promptForImagePromptGeneration,
          drawnUserMentions,
        );
      } else {
        // Image completely failed — don't pretend we drew something
        console.log(
          "⚠️ [DiscordService] Image generation failed after retry, generating text-only reply.",
        );
        generatedText = await AIService.generateTextReplyImageFailed(
          conversationForTextGeneration,
          assistantMessage,
          systemPrompt,
        );
      }
    } else {
      generatedText = await AIService.generateTextReplyNoImageGenerated(
        conversationForTextGeneration,
        assistantMessage,
        systemPrompt,
      );
    }
    // Rodrigo: Cleans the response
    generatedText = utilities.removeMentions(generatedText);
    generatedText = utilities.removeFlaggedWords(generatedText);

    const end = performance.now();
    const duration = end - start;

    console.log(
      ...LogFormatter.replyBuildingAndGeneratingSuccess({
        systemPrompt: systemPromptForTextGeneration,
        conversation,
        generatedText,
        message,
        duration,
      }),
    );
  } catch (error) {
    ((generatedText = "..."),
      // imagePrompt = 'an image of a beautiful purple wolf sleeping under the full moonlight, in the style of a watercolor painting. The text "Lupos sleeps under the full moonlight" is written in a beautiful cursive font at the bottom of the image.';
      console.error(...LogFormatter.error(error)));
  }
  return {
    generatedText,
    systemPromptForImagePromptGeneration,
    image,
    promptForImagePromptGeneration,
  };
}

async function replyMessage(queuedDatum, localMongo) {
  // Rodrigo: This function is called when a message is received or updated on Discord.
  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  const message = queuedDatum.message;
  const _messages = queuedDatum.recentMessages;
  const actionType = queuedDatum.actionType;

  const client = message.client;
  const guild = message.guild;
  const channel = message.channel;
  const member = message.member;
  const user = message.author;
  const combinedNames = utilities.getCombinedNamesFromUserOrMember({
    member,
    user,
  });

  CurrentService.setUser(user);
  CurrentService.setMessage(message);
  CurrentService.setStartTime(Date.now());

  // Check if message was deleted before we start processing
  if (isMessageCancelled(message.id)) {
    console.log(
      `🗑️ [DiscordService] Message ${message.id} was deleted before processing started, skipping.`,
    );
    cancelledMessageIds.delete(message.id);
    return;
  }

  let combinedGuildInformation;
  let combinedChannelInformation;
  // Rodrigo: These are the image variables
  let generatedTextResponse;
  let canGenerateImage = false;
  let generatedImage;
  let isMessageAskingToGenerateImage;
  let generatedImagePrompt;

  // Update status to say who it is replying to
  DiscordUtilityService.setUserActivity(
    client,
    `Replying to ${combinedNames}...`,
  );

  const start = performance.now();

  if (guild) {
    combinedGuildInformation =
      utilities.getCombinedGuildInformationFromGuild(guild);
    combinedChannelInformation =
      utilities.getCombinedChannelInformationFromChannel(channel);
    console.log(...LogFormatter.receivedGuildMessage(message, actionType));
  } else {
    console.log(...LogFormatter.receivedDirectMessage(message, actionType));
  }

  // CHECK IF WE CAN GENERATE AN IMAGE

  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  // Rodrigo: Generate a custom emoji reaction based on the message content
  const customEmojiReact =
    await AIService.generateTextCustomEmojiReactFromMessage(
      message,
      localMongo,
    );
  if (customEmojiReact) {
    try {
      await message.react(customEmojiReact);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      // Handle error
    }
  } else {
    // Handle case where no custom emoji is generated
  }
  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");

  if (config.GENERATE_IMAGE) {
    // Are we using Google Generative AI?
    if (config.GOOGLE_KEY) {
      canGenerateImage = true;
      // Are we using a local ComfyUI instance?
    } else {
      try {
        await ComfyUIService.checkComfyUIWebsocketStatus();
        canGenerateImage = true;
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        canGenerateImage = false;
      }
    }
    const _isAskingToDrawSelf = false;
    if (canGenerateImage) {
      if (message.content) {
        isMessageAskingToGenerateImage =
          await AIService.generateTextIsAskingToGenerateImage(
            message.cleanContent,
            message,
          );
        console.log(
          ...LogFormatter.isMessageAskingToGenerateImage(
            message,
            isMessageAskingToGenerateImage,
          ),
        );
      }
    }
  }

  // Rodrigo: This extracts the content from the messages
  const {
    conversation,
    newSystemPrompt,
    conversationsCollection,
    memberMentionsCollection,
    messagesEmojisCollection,
    messagesImagesCollection,
    _messagesTranscriptionsCollection,
    participantsAvatarsCollection,
    participantsBannersCollection,
    participantsCollection,
    participantsMembersCollection,
    participantsUsersCollection,
    userMentionsCollection,
  } = await extractContentFromMessages(queuedDatum, localMongo);

  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");

  // Check if message was deleted during content extraction
  if (isMessageCancelled(message.id)) {
    console.log(
      `🗑️ [DiscordService] Message ${message.id} was deleted during content extraction, aborting.`,
    );
    cancelledMessageIds.delete(message.id);
    return;
  }

  const { generatedText, image, promptForImagePromptGeneration } =
    await buildAndGenerateReply({
      canGenerateImage,
      conversation,
      conversationsCollection,
      memberMentionsCollection,
      messagesEmojisCollection,
      messagesImagesCollection,
      newSystemPrompt,
      participantsAvatarsCollection,
      participantsBannersCollection,
      participantsCollection,
      participantsMembersCollection,
      participantsUsersCollection,
      queuedDatum,
      isMessageAskingToGenerateImage,
      userMentionsCollection,
      localMongo,
    });
  // eslint-disable-next-line prefer-const
  generatedTextResponse = generatedText;
  generatedImage = image; // eslint-disable-line prefer-const
  generatedImagePrompt = promptForImagePromptGeneration; // eslint-disable-line prefer-const

  // (Image conversations are already saved per-call inside generateImage)

  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  // GENERATE SUMMARY
  const textSummary = await AIService.generateTextSummaryFromMessage(
    message,
    generatedTextResponse,
  );
  DiscordUtilityService.setUserActivity(client, textSummary);
  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  if (!generatedTextResponse) {
    await message.reply("...");
    lastMessageSentTime = DateTime.now().toISO();
    LightsService.setState({ color: "red" }, config.PRIMARY_LIGHT_ID);
    console.error(`❌ [DiscordService:replyMessage] NO RESPONSE GENERATED
${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild.id, channel.id, message.id)}` : ""}`);
    return;
  }
  // SEND THE REPLY
  try {
    // Check if message was deleted during reply generation
    if (isMessageCancelled(message.id)) {
      console.log(
        `🗑️ [DiscordService] Message ${message.id} was deleted during reply generation, not sending reply.`,
      );
      cancelledMessageIds.delete(message.id);
      return;
    }
    await message.fetch();
    LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
    const messageSent = await DiscordUtilityService.sendMessageInChunks(
      "reply",
      message,
      generatedTextResponse,
      generatedImage,
      generatedImagePrompt,
    );
    repliedMessagesCollection.set(message.id, messageSent.id);
    LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  } catch (error) {
    console.warn(`❌ [DiscordService:replyMessage] MESSAGE NOT FOUND (OR DELETED)
            ${error}
    ${member ? `Member: ${combinedNames}` : `User: ${combinedNames}`}
    ${combinedGuildInformation ? `Guild: ${combinedGuildInformation}` : "Direct Message"}
    ${combinedChannelInformation ? `Channel: ${combinedChannelInformation}` : ""}
    ${combinedGuildInformation && combinedChannelInformation ? `URL: ${utilities.getDiscordMessageUrl(guild.id, channel.id, message.id)}` : ""}`);
    LightsService.setState({ color: "red" }, config.PRIMARY_LIGHT_ID);
    return;
  }

  lastMessageSentTime = DateTime.now().toISO();
  CurrentService.setEndTime(Date.now());

  // Fire-and-forget memory extraction from the conversation
  if (message.guildId && conversation?.length > 0) {
    const memoryParticipants = [];
    // Collect participant info for extraction
    if (participantsCollection?.size) {
      for (const participant of participantsCollection.values()) {
        if (participant?.user) {
          memoryParticipants.push({
            id: participant.user.id,
            username: participant.user.username,
            displayName:
              participant.user.globalName || participant.user.username,
          });
        }
      }
    }
    // Include mentioned users
    if (memberMentionsCollection?.size) {
      for (const member of memberMentionsCollection.values()) {
        const alreadyAdded = memoryParticipants.some((p) => p.id === member.id);
        if (!alreadyAdded) {
          memoryParticipants.push({
            id: member.id,
            username: member.user?.username || member.username,
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
        .filter((m) => m.role === "user")
        .slice(-10);

      PrismService.extractMemories({
        guildId: message.guildId,
        channelId: message.channel?.id,
        messages: recentUserMessages,
        participants: memoryParticipants,
        sourceMessageId: message.id,
      })
        .then((result) => {
          if (result?.count > 0) {
            console.log(
              `🧠 [DiscordService] Extracted ${result.count} memory/memories from conversation.`,
            );
          }
        })
        .catch((err) => {
          console.warn(
            `🧠 [DiscordService] Memory extraction failed: ${err.message}`,
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
        generatedTextResponse,
        duration,
      ),
    );
  } else {
    console.log(
      ...LogFormatter.replyDirectMessageSuccess(
        message,
        generatedTextResponse,
        duration,
      ),
    );
  }

  const models = CurrentService.getModels();
  const modelTypes = CurrentService.getModelTypes();

  const db = localMongo.db("lupos");
  const collection2 = db.collection("MetricsMessageGeneration");
  await collection2.insertOne({
    models: models.join(", "),
    modelTypes: modelTypes.join(", "),
    guildId: message.guild?.id || "DM",
    guildName: message.guild?.name || "DM",
    channel: message.channel?.name || "DM",
    channelId: message.channel?.id || "DM",
    messageId: message.id,
    userId: message.author?.id,
    userName: message.author?.username,
    content: message.cleanContent,
  });
  CurrentService.clearModels();
  CurrentService.clearModelTypes();
  CurrentService.clearSessionId();

  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  return;
}

async function generateUserConversationAndHash(
  queuedDatum,
  recentMessage,
  localMongo,
) {
  // Create a hash of all the this specific user's recent messages
  const { message, recentMessages } = queuedDatum;
  const userMessages = recentMessages.filter(
    (message) => message.author.id === recentMessage.author.id,
  );
  const userMessagesAsText = userMessages
    .map((message) => message.content)
    .join("\n\n");
  const hash = crypto
    .createHash("sha256")
    .update(userMessagesAsText)
    .digest("hex");
  // Check if we already have a conversation for this hash
  const db = localMongo.db("lupos");
  const collection = db.collection("UserConversationSummaries");
  const existingConversation = await collection.findOne({ hash });
  if (existingConversation) {
    return existingConversation.conversation;
  }
  // If not, generate a new conversation
  const userName = DiscordUtilityService.getNameFromItem(recentMessage);
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

async function extractContentFromMessages(
  queuedDatum,
  localMongo,
  _maxSimultaneous = 50,
) {
  const functionName = "extractContentFromMessages";
  LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "purples");
  const { message, recentMessages } = queuedDatum;
  const now = Date.now();
  const newestMessage = recentMessages.last();

  for (const recentMessage of recentMessages.values()) {
    if (recentMessage.author?.bot) {
      if (recentMessage.reference && recentMessage.reference.messageId) {
        botRepliedMessages.set(
          recentMessage.reference.messageId,
          recentMessage.id,
        );
      }
    }
  }
  // Filter messages
  const filteredRecentMessages = recentMessages.filter((recentMessage) => {
    // Include bot messages
    if (recentMessage.author?.bot) {
      return true;
    }

    // Include the newest message
    if (recentMessage.id === newestMessage.id) {
      return true;
    }

    // For user messages (not the newest):
    // Exclude if it mentions the bot AND is NOT in botRepliedMessages
    if (
      recentMessage.mentions?.has(message.client.user.id) &&
      !botRepliedMessages.has(recentMessage.id)
    ) {
      return false;
    }

    // Include all other user messages (those that don't mention bot,
    // or those that mention bot but are in botRepliedMessages)
    return true;
  });

  const totalMessages = filteredRecentMessages.size;
  const oldestMessageTime =
    filteredRecentMessages.first()?.createdTimestamp || now;
  // Calculate how many hours of data we actually have
  const totalHoursOfData = (now - oldestMessageTime) / (1000 * 60 * 60);
  // Create hourly buckets (always 24 hours)
  const hourlyBreakdown = [];
  // Convert collection to array for easier debugging
  const messageArray = Array.from(filteredRecentMessages.values());
  // Calculate average messages per hour based on actual data
  const averageMessagesPerHour =
    totalHoursOfData > 0 ? totalMessages / totalHoursOfData : 0;

  // Count messages for each hour window (all 24 hours)
  for (let hours = 1; hours <= 24; hours++) {
    let messagesInWindow;
    let isEstimated = false;

    if (hours <= totalHoursOfData) {
      // We have actual data for this time period
      const cutoffTime = now - hours * 60 * 60 * 1000;

      // console.log(`Hour ${hours}: Looking for messages after ${new Date(cutoffTime).toISOString()}`);

      messagesInWindow = messageArray.filter((msg) => {
        return msg.createdTimestamp >= cutoffTime;
      }).length;

      // console.log(`  Found ${messagesInWindow} actual messages in last ${hours} hour(s)`);
    } else {
      // We need to estimate based on the average
      messagesInWindow = Math.round(averageMessagesPerHour * hours);
      isEstimated = true;

      // console.log(`  Estimated ${messagesInWindow} messages in last ${hours} hour(s) (based on ${averageMessagesPerHour.toFixed(2)} msgs/hour)`);
    }

    hourlyBreakdown.push({
      hours: hours,
      messages: messagesInWindow,
      averagePerHour: messagesInWindow / hours,
      averagePerPeriod: messagesInWindow,
      isEstimated: isEstimated,
    });
  }

  // NEW SECTION: Calculate time intervals for message groups
  // Sort messages by timestamp (newest first)
  const sortedMessages = messageArray.sort(
    (a, b) => b.createdTimestamp - a.createdTimestamp,
  );
  const latestMessageTime = sortedMessages[0]?.createdTimestamp || now;

  // Calculate time spans for every 10 messages up to 100
  const messageIntervals = [];
  for (let count = 10; count <= 100; count += 10) {
    if (count <= sortedMessages.length) {
      const targetMessage = sortedMessages[count - 1]; // -1 because array is 0-indexed
      const timeSpanMs = latestMessageTime - targetMessage.createdTimestamp;
      const timeSpanHours = timeSpanMs / (1000 * 60 * 60);
      const timeSpanMinutes = timeSpanMs / (1000 * 60);

      messageIntervals.push({
        messageCount: count,
        timeSpanMs: timeSpanMs,
        timeSpanMinutes: timeSpanMinutes.toFixed(2),
        timeSpanHours: timeSpanHours.toFixed(2),
        timeSpanFormatted: utilities.formatTimeSpan(timeSpanMs),
        averageTimeBetweenMessages:
          (timeSpanMs / (count - 1) / 1000).toFixed(2) + " seconds",
        messagesPerHour: (count / timeSpanHours).toFixed(2),
      });
    } else {
      // Not enough messages for this interval
      messageIntervals.push({
        messageCount: count,
        status: `Only ${sortedMessages.length} messages available`,
      });
    }
  }



  // Get some useful insights
  const _stats = {
    totalMessages: totalMessages,
    actualTimeSpan: `${totalHoursOfData.toFixed(2)} hours`,
    oldestMessageDate: new Date(oldestMessageTime).toISOString(),
    currentTime: new Date(now).toISOString(),
    averageMessagesPerHour: averageMessagesPerHour.toFixed(2),
    hourlyBreakdown: hourlyBreakdown,

    // Show where actual data ends and estimates begin
    actualDataUpTo: `${Math.min(Math.ceil(totalHoursOfData), 24)} hours`,
    estimatedAfter:
      totalHoursOfData < 24
        ? `${Math.ceil(totalHoursOfData)} hours`
        : "No estimation needed",

    // Recent activity for all 24 hours
    ...Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [
        `last${i + 1}Hour${i > 0 ? "s" : ""}`,
        hourlyBreakdown[i]?.messages || 0,
      ]),
    ),

    // Activity acceleration/deceleration (only based on actual data)
    recentTrend:
      totalHoursOfData >= 3 && hourlyBreakdown[0] && hourlyBreakdown[2]
        ? hourlyBreakdown[0].averagePerHour -
            hourlyBreakdown[2].averagePerHour >
          0
          ? "increasing"
          : "decreasing"
        : "unknown",

    // NEW: Message interval analysis
    messageIntervals: messageIntervals,

    // Quick access to specific intervals
    last10Messages: messageIntervals[0],
    last20Messages: messageIntervals[1],
    last50Messages: messageIntervals[4],
    last100Messages: messageIntervals[9],
  };

  // console.log(stats);
  // console.log(messageIntervals);

  let messageCountText = ``;
  let currentDateTime = DateTime.fromMillis(now);
  // Friday, October 14, 1983, 9:30:33 AM Eastern Daylight Time
  currentDateTime = currentDateTime.toLocaleString(
    DateTime.DATETIME_HUGE_WITH_SECONDS,
  );
  messageCountText += `As of ${currentDateTime}, I have analyzed the recent message activity in this channel. Here are some insights:\n\n`;

  for (const interval of messageIntervals) {
    if (!interval.status) {
      // const messageSentAtRelative = DateTime.fromMillis(recentMessage.createdTimestamp).toRelative();
      const oldestMessageDateTime = DateTime.fromMillis(
        now - interval.timeSpanMs,
      );
      const oldestMessageHowLongAgo = oldestMessageDateTime.toRelative();
      // convert interval.averageTimeBetweenMessages to number type
      const averageTimeBetweenMessagesAsNumber = parseFloat(
        interval.averageTimeBetweenMessages,
      );
      const secondsToHuman = Duration.fromObject({
        seconds: averageTimeBetweenMessagesAsNumber,
      }).toHuman();
      messageCountText += `\n- Last ${interval.messageCount}: spanning ${interval.timeSpanFormatted} (oldest message ${oldestMessageHowLongAgo}) | Rate: ${interval.messagesPerHour} msgs/hour | Average gap: ${secondsToHuman})`;
    }
  }

  // console.log(`Message Count Text: ${messageCountText}`);

  const messagesToFetch =
    await AIService.generateTextDetermineHowManyMessagesToFetch(
      message.content,
      message,
      messageCountText,
    );

  // console.log('|-------------------------|');
  console.log(
    `PROCESSING ${messagesToFetch} MESSAGES (out of ${totalMessages} available)`,
  );
  // console.log('|-------------------------|');

  const recentXMessages = filteredRecentMessages.last(messagesToFetch);
  const client = message.client;

  // Initialize collections
  const participantsCollection = new Collection();
  const participantsAvatarsCollection = new Collection();
  const participantsBannersCollection = new Collection();
  const participantsUsersCollection = new Collection();
  const participantsMembersCollection = new Collection();
  let memberMentionsCollection = new Collection();
  let userMentionsCollection = new Collection();
  const messagesImagesCollection = new Collection();
  const messagesTranscriptionsCollection = new Collection();
  const messagesEmojisCollection = new Collection();
  const conversationsCollection = new Collection();
  const conversation = [];
  const newSystemPrompt = "";

  // Prepare all async operations
  const allPromises = {
    conversations: [],
    avatars: [],
    banners: [],
    urls: [],
    emojis: [],
    audio: [],
    images: [],
    replies: [],
  };

  // First pass: collect all async operations
  const messageProcessingData = [];

  if (message.guild) {
    let index = 0;
    const firstMessageDateTime = DateTime.fromMillis(
      recentXMessages[0].createdTimestamp,
    );
    const lastMessageDateTime = DateTime.fromMillis(
      recentXMessages[recentXMessages.length - 1].createdTimestamp,
    );
    let dateIdFormat = "yyMMddHHmmSSS";
    if (firstMessageDateTime.hasSame(lastMessageDateTime, "hour")) {
      dateIdFormat = "mSSS";
    } else if (firstMessageDateTime.hasSame(lastMessageDateTime, "day")) {
      dateIdFormat = "HmmSSS";
    } else if (firstMessageDateTime.hasSame(lastMessageDateTime, "month")) {
      dateIdFormat = "dHHmmSSS";
    } else if (firstMessageDateTime.hasSame(lastMessageDateTime, "year")) {
      dateIdFormat = "MddHHmmSSS";
    }

    // Pre-calculate message sequences
    const messageSequenceInfo = new Map();
    let currentSequenceAuthor = null;
    let currentSequenceStart = -1;
    let currentSequenceMessages = [];

    for (let i = 0; i < recentXMessages.length; i++) {
      const msg = recentXMessages[i];
      const isBot = msg.author.id === client.user.id;

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
        currentSequenceStart = -1;
        currentSequenceMessages = [];
        // Bot messages don't get sequence info
        messageSequenceInfo.set(i, { xOfY: 0, total: 0 });
      } else {
        // User message
        if (msg.author.id !== currentSequenceAuthor) {
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
          currentSequenceAuthor = msg.author.id;
          currentSequenceStart = i; // eslint-disable-line no-unused-vars
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
      const user = recentMessage.author;

      if (!user || !user.id) {
        console.warn(
          `❌ [DiscordService:getParticipants] User is null or missing ID in message: ${recentMessage.id}`,
        );
        index++;
        continue;
      }

      const isBot = user.id === client.user.id;
      const isLastMessage = index === recentXMessages.length - 1;

      // Get the sequence info for this message
      const sequenceInfo = messageSequenceInfo.get(index) || {
        xOfY: 0,
        total: 0,
      };
      const userMessageXofY = sequenceInfo.xOfY;
      const sequentialUserMessages = sequenceInfo.total;

      const messageData = {
        index,
        recentMessage,
        member,
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

          // Queue avatar/banner fetching
          let avatarUrl, bannerUrl;
          if (user) {
            avatarUrl = utilities.getDiscordAvatarUrl(user.id, user.avatar);
            bannerUrl = utilities.getDiscordBannerUrl(user.id, user.banner);
          }
          if (member) {
            if (member.avatar) {
              avatarUrl = utilities.getDiscordAvatarUrl(member.id, member.avatar);
            }
            if (member.banner) {
              bannerUrl = utilities.getDiscordBannerUrl(member.id, member.banner);
            }
          }

          if (avatarUrl) {
            allPromises.avatars.push({
              userId: user.id,
              promise: AIService.captionImages(
                [avatarUrl],
                localMongo,
                "AVATAR",
              ),
            });
          }
          if (bannerUrl) {
            allPromises.banners.push({
              userId: user.id,
              promise: AIService.captionImages(
                [bannerUrl],
                localMongo,
                "BANNER",
              ),
            });
          }
        } else if (userExists.time < recentMessage.createdTimestamp) {
          userExists.time = recentMessage.createdTimestamp;
        }

        // Queue URL scraping
        const urls = recentMessage.content.match(/(https?:\/\/[^\s]+)/g);
        if (urls) {
          allPromises.urls.push({
            messageId: recentMessage.id,
            urls,
            promises: urls.map((url) =>
              ScraperService.scrapeURL(url).catch((_error) => ({
                url,
                error: "Failed to load",
                content: null,
              })),
            ),
          });
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
            messageId: recentMessage.id,
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
            messageId: recentMessage.id,
            promise: AIService.captionImages(imageUrls, localMongo, "IMAGE"),
          });
        }

        // Queue reply fetching
        if (recentMessage.reference?.messageId) {
          const channel = recentMessage.channel || message.channel;
          const repliedMessage = channel?.messages.cache.get(
            recentMessage.reference.messageId,
          );
          if (!repliedMessage) {
            allPromises.replies.push({
              messageId: recentMessage.id,
              referenceId: recentMessage.reference.messageId,
              promise: channel?.messages
                .fetch(recentMessage.reference.messageId)
                .catch((error) => {
                  console.log(
                    `Could not fetch replied message ${recentMessage.reference.messageId}:`,
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
      ...allPromises.conversations.map((item) => item.promise),
      ...allPromises.avatars.map((item) => item.promise),
      ...allPromises.banners.map((item) => item.promise),
      ...allPromises.urls.flatMap((item) => item.promises),
      ...allPromises.emojis.map((item) => item.promise),
      ...allPromises.audio.map((item) => item.promise),
      ...allPromises.images.map((item) => item.promise),
      ...allPromises.replies.map((item) => item.promise),
    ]);

    // Process results
    let resultIndex = 0;

    // Process conversations
    for (const item of allPromises.conversations) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        conversationsCollection.set(item.userId, result.value);
      }
    }

    // Process avatars
    for (const item of allPromises.avatars) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        const avatarsMap = result.value.imagesMap.values().next().value;
        participantsAvatarsCollection.set(item.userId, avatarsMap);
      }
    }

    // Process banners
    for (const item of allPromises.banners) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        const bannersMap = result.value.imagesMap.values().next().value;
        participantsBannersCollection.set(item.userId, bannersMap);
      }
    }

    // Process URLs
    const urlResults = {};
    for (const item of allPromises.urls) {
      const scrapedUrls = [];
      for (let i = 0; i < item.urls.length; i++) {
        const result = results[resultIndex++];
        scrapedUrls.push(
          result.status === "fulfilled"
            ? result.value
            : { url: item.urls[i], error: "Failed to load", content: null },
        );
      }
      urlResults[item.messageId] = { urls: item.urls, scrapedUrls };
    }

    // Process emojis
    for (const _item of allPromises.emojis) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled" && result.value?.size) {
        for (const [emoji, emojiObject] of result.value.entries()) {
          messagesEmojisCollection.set(emoji, emojiObject);
        }
      }
    }

    // Process audio
    for (const item of allPromises.audio) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        const { transcriptionsMap } = result.value;
        messagesTranscriptionsCollection.set(item.messageId, transcriptionsMap);
        for (const [hash, transcriptionObject] of transcriptionsMap.entries()) {
          console.log(
            ...LogFormatter.transcribeSuccess({
              functionName,
              hash,
              message: { id: item.messageId },
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
      const result = results[resultIndex++];
      if (result.status === "fulfilled") {
        const { imagesMap } = result.value;
        messagesImagesCollection.set(item.messageId, imagesMap);
        for (const [hash, mapObject] of imagesMap.entries()) {
          console.log(
            ...LogFormatter.captionSuccess({
              functionName,
              hash,
              message: { id: item.messageId },
              imageUrl: mapObject.url,
              caption: mapObject.caption,
              fileType: mapObject.fileType,
              cached: mapObject.cached,
            }),
          );
        }
      }
    }

    // Process replies
    const repliesMap = {};
    for (const item of allPromises.replies) {
      const result = results[resultIndex++];
      if (result.status === "fulfilled" && result.value) {
        repliesMap[item.messageId] = result.value;
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
        let imageDescription, imageSize, imageWidth, imageHeight;
        let attachmentContext;

        // Rodrigo: The bot has attached an image to this message
        if (recentMessage?.attachments?.size > 0) {
          const imageAttached = recentMessage.attachments.find((attachment) =>
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

        // Rodrigo: This message has reactions, so let's add them to the content
        let reactionsContent = "";
        if (recentMessage.reactions?.cache?.size > 0) {
          reactionsContent = `\n[REACTIONS]`;
          for (const reaction of recentMessage.reactions.cache.values()) {
            const byMe = reaction.me ? " (by you, Lupos)" : "";
            reactionsContent += `\n- ${reaction.emoji.name} x ${reaction.count}${byMe}`;
          }
        }

        let _replyContent = "";
        // Rodrigo: This message has a reply, so let's add it to the content
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
        const recentMessageDateTime = DateTime.fromMillis(
          recentMessage.createdTimestamp,
        );
        const messageId = recentMessageDateTime.toFormat(dateIdFormat);
        const combinedNames = utilities.getCombinedNamesFromUserOrMember({
          member: recentMessage.member,
        });
        const messageSentAt = recentMessageDateTime
          .setZone("local")
          .toFormat("LLLL dd, yyyy 'at' hh:mm:ss a");
        const messageSentAtRelative = recentMessageDateTime.toRelative();

        let modifiedContent = `=== MESSAGE ${userMessageXofY} of ${sequentialUserMessages} ${userMessageXofY === sequentialUserMessages && isLastMessage ? "(MOST RECENT)" : ""} ===`;
        modifiedContent += `\n[METADATA]`;
        modifiedContent += `\nFrom: ${combinedNames}`;
        modifiedContent += `\nTime: ${messageSentAt} (${messageSentAtRelative})`;
        modifiedContent += `\nMessage ID: ${messageId}`;

        // Add reply information
        const repliedMessage =
          messageData.repliedMessage || repliesMap[recentMessage.id];
        if (recentMessage.reference?.messageId) {
          modifiedContent += `\n\n[REPLYING TO]`;
          if (!repliedMessage) {
            modifiedContent += `\nAuthor: Unknown (DELETED MESSAGE)`;
            modifiedContent += `\nMessage ID: ${recentMessage.reference.messageId}`;
          } else {
            const repliedMessageDateTime = DateTime.fromMillis(
              repliedMessage.createdTimestamp,
            );
            const replyMessageId =
              repliedMessageDateTime.toFormat(dateIdFormat);
            const combinedRepliedNames =
              utilities.getCombinedNamesFromUserOrMember({
                member: repliedMessage.member,
              });
            modifiedContent += `\nAuthor: ${combinedRepliedNames}`;
            modifiedContent += `\nTime: ${repliedMessageDateTime.setZone("local").toFormat("LLLL dd, yyyy 'at' hh:mm:ss a")} (${repliedMessageDateTime.toRelative()})`;
            modifiedContent += `\nMessage ID: ${replyMessageId}`;

            if (repliedMessage.cleanContent) {
              modifiedContent += `\nType: Text Message`;
              modifiedContent += `\nContent:`;
              modifiedContent += `\n<message_content>`;
              modifiedContent += `\n${repliedMessage.content}`;
              modifiedContent += `\n</message_content>`;
            }

            modifiedContent = await generateAttachmentsResponse(
              repliedMessage,
              messagesTranscriptionsCollection,
              messagesImagesCollection,
              repliedMessage,
              modifiedContent,
              localMongo,
            );

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

          // Add scraped URL content
          const urlData = urlResults[recentMessage.id];
          if (urlData?.scrapedUrls?.length) {
            modifiedContent += `\n\n[SCRAPED URL CONTENT]`;
            for (const [index, scrapedData] of urlData.scrapedUrls.entries()) {
              modifiedContent += `\n- ${urlData.urls[index]}:`;
              for (const [key, value] of Object.entries(scrapedData)) {
                if (value) {
                  modifiedContent += `\n  - ${utilities.capitalize(key)}: ${value}`;
                }
              }
            }
          }
        }

        modifiedContent = await generateAttachmentsResponse(
          recentMessage,
          messagesTranscriptionsCollection,
          messagesImagesCollection,
          recentMessage,
          modifiedContent,
          localMongo,
        );

        // Add reactions
        const isCurrentMessage = recentMessage.id !== message.id;
        if (recentMessage.reactions?.cache?.size > 0 && !isCurrentMessage) {
          const reactions = recentMessage.reactions.cache.map((reaction) => {
            const byMe = reaction.me ? " (by you, Lupos)" : "";
            return `${reaction.emoji.name}${byMe}`;
          });
          modifiedContent += `\nNumber of reactions in this message: ${recentMessage.reactions.cache.size}`;
          modifiedContent += `\nReaction list: ${reactions.join(", ")}`;
        }

        conversation.push({
          role: "user",
          name: DiscordUtilityService.getUsernameNoSpaces(recentMessage),
          content: modifiedContent,
        });
      }
    }
  }

  // Clean up collections
  userMentionsCollection = userMentionsCollection.filter(
    (user) => !memberMentionsCollection.has(user.id),
  );
  memberMentionsCollection.delete(client.user.id);

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

async function generateRolesEmbedMessage(client) {
  // get the original message and edit it to show the new role count on the button
  // re-render the buttons with the new role count
  const classesEmbed = new EmbedBuilder()
    .setTitle("Pick Your WoW Classes")
    .setDescription("Which classes do you play as?")
    .setColor("#00FF00");

  const roles = client.guilds.cache
    .get(config.GUILD_ID_PRIMARY)
    .roles.cache.sort((a, b) => a.rawPosition - b.rawPosition)
    .reverse();

  const filteredClasses = roles.filter((role) =>
    warcraftClasses.some((videogameRole) => videogameRole.id === role.id),
  );
  const classesToArray = filteredClasses.map((role) => role);

  const classesRows = [];
  const maxButtonsPerRow = 5;
  for (let i = 0; i < classesToArray.length; i += maxButtonsPerRow) {
    const row = new ActionRowBuilder();
    const currentRoles = classesToArray.slice(i, i + maxButtonsPerRow);
    for (const role of currentRoles) {
      const _emoji =
        warcraftClasses.find((videogameRole) => videogameRole.id === role.id)
          ?.emojiId || null;
      const button = new ButtonBuilder()
        .setLabel(`${role.name} (${role.members.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`pick-role-${role.id}`)
        // emoji is in warcraftClasses as emojiId
        .setEmoji(
          warcraftClasses.find((warcraftClass) => warcraftClass.id === role.id)
            ?.emojiId || null,
        );
      row.addComponents(button);
    }
    classesRows.push(row);
  }

  const factionEmbed = new EmbedBuilder()
    .setTitle("Pick Your WoW Faction")
    .setDescription("Which faction do you play as?")
    .setColor("#00FF00");

  const filteredFactions = roles.filter((role) =>
    warcraftFactions.some((videogameRole) => videogameRole.id === role.id),
  );
  const factionsToArray = filteredFactions.map((role) => role);

  const factionsRows = [];
  for (let i = 0; i < factionsToArray.length; i += maxButtonsPerRow) {
    const row = new ActionRowBuilder();
    const currentRoles = factionsToArray.slice(i, i + maxButtonsPerRow);
    for (const role of currentRoles) {
      const button = new ButtonBuilder()
        .setLabel(`${role.name} (${role.members.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`pick-role-${role.id}`)
        .setEmoji(
          warcraftFactions.find(
            (warcraftFaction) => warcraftFaction.id === role.id,
          )?.emojiId || null,
        );
      row.addComponents(button);
    }
    factionsRows.push(row);
  }

  const videogamesEmbed = new EmbedBuilder()
    .setTitle("Pick Your Videogames")
    .setDescription("Which videogames do you play?")
    .setColor("#00FF00");

  const filteredVideogames = roles.filter((role) =>
    rolesVideogames.some((videogameRole) => videogameRole.id === role.id),
  );
  const videogamesToArray = filteredVideogames.map((role) => role);

  const videogamesRows = [];
  for (let i = 0; i < videogamesToArray.length; i += maxButtonsPerRow) {
    const row = new ActionRowBuilder();
    const sortedVideogames = videogamesToArray.sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const currentRoles = sortedVideogames.slice(i, i + maxButtonsPerRow);
    for (const role of currentRoles) {
      const emoji =
        rolesVideogames.find((videogameRole) => videogameRole.id === role.id)
          ?.emojiId || null;
      const button = new ButtonBuilder()
        .setLabel(`${role.name} (${role.members.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`pick-role-${role.id}`);
      if (emoji) {
        button.setEmoji(emoji);
      }
      row.addComponents(button);
    }
    videogamesRows.push(row);
  }

  // if the channel is empty, create a new message
  const channel = DiscordUtilityService.getChannelById(
    client,
    config.CHANNEL_ID_SELF_ROLES,
  );
  if (!channel) {
    return;
  }
  const messagesCacheSize =
    channel.messages.cache.size ||
    (await channel.messages
      .fetch({ limit: 10 })
      .then((messages) => messages.size));
  // await channel.bulkDelete(100);
  // if the channel is empty, post message, otherwise edit the first message
  if (messagesCacheSize === 0) {
    await channel.send({ embeds: [factionEmbed], components: factionsRows });
    await channel.send({ embeds: [classesEmbed], components: classesRows });
    await channel.send({
      embeds: [videogamesEmbed],
      components: videogamesRows,
    });

    const guildMastersEmbed = new EmbedBuilder()
      .setTitle("Guild Masters / Officers")
      .setDescription(
        `If you would like access to post in our guild recruitment channel and other guild leadership channels, please post on the <#966457267417411614> channel:

- Include a screenshot of your guild tab showing you as GM or officer, as well as the name and faction of the guild.
- Put your guild tag in your Discord nickname <Like This>.
            `,
      )
      .setColor("#00FF00");

    await channel.send({ embeds: [guildMastersEmbed] });

    return;
  } else {
    const allMessages = await channel.messages.fetch({ limit: 20 });
    const message1 = allMessages.at(allMessages.size - 1);
    const message2 = allMessages.at(allMessages.size - 2);
    const message3 = allMessages.at(allMessages.size - 3);
    await message1.edit({ embeds: [factionEmbed], components: factionsRows });
    await message2.edit({ embeds: [classesEmbed], components: classesRows });
    await message3.edit({
      embeds: [videogamesEmbed],
      components: videogamesRows,
    });
    return;
  }
}

async function luposOnReady(client, { mongo }) {
  console.log(...LogFormatter.botReady(client));
  consoleLogAllGuilds(client);
  DiscordUtilityService.setUserActivity(client, APRIL_FOOLS_MODE ? `:3` : `Don't @ me...`);

  if (mode === "services" || !mode) {
    await generateRolesEmbedMessage(client);

    if (config.ROLE_ID_BIRTHDAY_MONTH) {
      BirthdayJob.startJob(client);
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
        primaryChannelId: config.CHANNEL_ID_POLITICS,
        roleIdYapper: config.ROLE_ID_YAPPER,
        roleIdReactor: config.ROLE_ID_REACTOR,
        periodMinutes: 60,
        intervalMinutes: 1,
      });
    }
  } else if (mode === "messages") {
    // Reset bot nickname to "Lupos" in specific guild on startup
    try {
      const targetGuild = client.guilds.cache.get(config.GUILD_ID_GROBBULUS);
      if (targetGuild) {
        const botMember = await targetGuild.members.fetch(client.user.id);
        if (botMember) {
          await botMember.setNickname("Lupos");
          console.log(
            `Bot nickname reset to "Lupos" in guild ${targetGuild.name}`,
          );
        }
      }
    } catch (error) {
      console.error("Failed to reset bot nickname on startup:", error);
    }

    // April Fools: Random tag job
    if (APRIL_FOOLS_MODE) {
      RandomTagJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY,
        channelId: config.CHANNEL_ID_POLITICS,
      });

      // April Fools: Server icon rotation
      ServerIconJob.startJob({
        client,
        guildId: config.GUILD_ID_PRIMARY,
      });
    }

    // Check the last 100 messages in the channel politics, and if there is a message that mentions me that I haven't replied to in the last 5 minutes, reply to it
    // const politicsChannel = DiscordUtilityService.getChannelById(client, config.CHANNEL_ID_POLITICS);
    // // console.log('Politics channel found:', !!politicsChannel);

    // if (politicsChannel) {
    //     // const messages = await politicsChannel.messages.fetch({ limit: 100 });
    //     const messages = (await DiscordUtilityService.fetchMessages(client, config.CHANNEL_ID_POLITICS, 100)).reverse();
    //     // console.log('Total messages fetched:', messages.size);

    //     const now = Date.now();``````````````````````````

    //     // Convert to array and sort by timestamp (newest first)
    //     const messageArray = Array.from(messages.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    //     // Find messages from the bot that are replies
    //     const botReplies = messageArray.filter(m =>
    //         m.author.id === client.user.id &&
    //         m.reference?.messageId
    //     );
    //     const repliedToIds = new Set(botReplies.map(m => m.reference.messageId));
    //     // console.log('Bot replies found:', botReplies.length);
    //     // console.log('Replied to IDs:', Array.from(repliedToIds));

    //     let mentionsFound = 0;
    //     for (const message of messageArray) {
    //         if (message.mentions.has(client.user.id) && !message.author.bot) {
    //             mentionsFound++;
    //             const timeDifference = (now - message.createdTimestamp) / 1000 / 60; // Convert to minutes
    //             // console.log(`Mention ${mentionsFound}: ${message.id}, Time diff: ${timeDifference.toFixed(2)} minutes, Already replied: ${repliedToIds.has(message.id)}`);

    //             if (timeDifference <= 200 && !repliedToIds.has(message.id)) {
    //                 utilities.consoleLog('=', `Found message in politics channel that mentions me and I haven't replied to in the last 5 minutes: ${message.content}`);
    //                 await processMessage(client, { mongo, localMongo }, message);
    //                 break;
    //             }
    //         }
    //     }
    //     // console.log('Total mentions found:', mentionsFound);
    // }
  }
}

async function luposOnReadyReports(client, mongo) {
  utilities.consoleLog("<");
  utilities.consoleLog(
    "=",
    `Logged in as ${DiscordUtilityService.getBotName(client)}`,
  );
  try {
    await mongo.connect();
    utilities.consoleLog("=", "Connected to MongoDB");
  } catch (error) {
    utilities.consoleLog("=", `Error connecting to MongoDB \n${error}`);
  }
  // DiscordUtilityService.printOutAllRoles(client);
  // DiscordUtilityService.printOutAllEmojis(client);
  DiscordUtilityService.displayAllChannelActivity(client, mongo);
  // await DiscordUtilityService.calculateMessagesSentOnAveragePerDayInChannel(client, config.CHANNEL_ID_POLITICS);
  utilities.consoleLog(">");
}

async function luposOnReadyCloneMessages(client, { localMongo }) {
  // await DiscordUtilityService.fetchAndSaveAllServerMessages(client, localMongo, '609471635308937237', {
  //     resumePoints: [
  //         { channelId: '762734438375096380', lastMessageId: '901349132701155349' },  // politics
  //     ]
  // });
  await DiscordUtilityService.fetchAndSaveAllServerMessages(
    client,
    localMongo,
    config.GUILD_ID_PRIMARY,
  );
}

async function luposOnReadyDeleteDuplicateMessages(client, { localMongo }) {
  await DiscordUtilityService.deleteDuplicateMessagesByID(localMongo);
}

async function luposOnReadyDeleteNewAccounts(client) {
  const functionName = "luposOnReadyDeleteNewAccounts";
  const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);
  if (!guild) {
    console.error(`[${functionName}] Primary guild not found`);
    return;
  }

  console.log(`[${functionName}] Fetching all members...`);
  const members = await guild.members.fetch();
  let kickedCount = 0;

  for (const [, member] of members) {
    const wasKicked = await kickIfTooNew(member, functionName);
    if (wasKicked) kickedCount++;
  }

  console.log(`[${functionName}] Done. Kicked: ${kickedCount}`);
}

async function processMessage(
  client,
  { _mongo, localMongo },
  message,
  actionType,
) {
  const { _slowBlink, _bold, _faint } = utilities.ansiEscapeCodes(true);
  const isDirectMessage = message.channel.type === ChannelType.DM;
  const isSelfMessage = message.author.id === client.user.id;
  const isDirectMessageFromSelf = isDirectMessage && isSelfMessage;
  const isMessageWithoutSelfMention =
    !isDirectMessage && !message.mentions.has(client.user);
  const isMessageFromBot = message.author.bot;
  const isGuildWhitemane = message?.guildId === config.GUILD_ID_PRIMARY;
  const isMentioningBot = isDirectMessage || message.mentions.has(client.user);

  if (message.guildId === config.GUILD_ID_GROBBULUS) {
    return;
  }

  if (config.USER_IDS_DISALLOWED.includes(message.author.id)) {
    return;
  }

  // Check for flagged words and ignore the message if found
  if (
    !isSelfMessage &&
    !isMessageFromBot &&
    isMentioningBot &&
    message.content &&
    CensorService.containsFlaggedWords(message.content)
  ) {
    console.log(
      `⛔ [DiscordService:replyMessage] Message contains flagged words, ignoring.`,
    );
    try {
      await message.reply("beep boop, no slurs, ya dumbass");
    } catch (error) {
      console.log("Error sending flagged words response:", error);
    }
    return;
  }

  // Check if replying to a message with flagged words
  if (
    !isSelfMessage &&
    !isMessageFromBot &&
    isMentioningBot &&
    message.reference
  ) {
    try {
      const repliedMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (
        repliedMessage.content &&
        CensorService.containsFlaggedWords(repliedMessage.content)
      ) {
        console.log(
          `⛔ [DiscordService:replyMessage] Replied message contains flagged words, ignoring.`,
        );
        try {
          await message.reply("beep boop, no slurs, ya dumbass");
        } catch (error) {
          console.log("Error sending flagged words response:", error);
        }
        return;
      }
    } catch (error) {
      console.log("Error fetching replied message:", error);
    }
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
        logMessage += `\nAttachment Message: ${[...message.attachments.values()].map((att) => att.url).join(", ")}`;
      }

      if (message.stickers?.size > 0) {
        logMessage += `\nSticker Message: ${[...message.stickers.values()].map((sticker) => sticker.name).join(", ")}`;
      }

      if (message.reference) {
        logMessage += `\nReply Message: Yes, to message ID ${message.reference.messageId}`;
      }

      logMessage += `
Guild: ${message.guild?.name}
Channel: #${message.channel?.name}
Author: ${utilities.getCombinedNamesFromUserOrMember({ member: message.member, user: message.author })}
URL: ${utilities.getDiscordMessageUrl(message.guild?.id, message.channel.id, message.id)}`;

      console.log(logMessage);
    }
  } catch (error) {
    console.log("Error saving message to MongoDB:", error);
  }

  if (config.CHANNEL_IDS_JUKEBOX.includes(message.channelId)) {
    await YouTubeService.searchAndPlay(client, message);
    await YouTubeService.stop(client, message);
    await YouTubeService.next(client, message);
    await YouTubeService.pause(client, message);
    await YouTubeService.resume(client, message);
    await YouTubeService.setVolume(client, message);
  }

  if (message.channelId !== config.CHANNEL_ID_JUKEBOX_EXCEPTION) {
    LightsService.cycleColor(config.PRIMARY_LIGHT_ID, "rainbow");
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
    if (message.channelId === channel.id) {
      await DiscordUtilityService.addRoleToMember(
        message.member,
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
  if (
    message.member &&
    message.member.roles.cache.some((role) =>
      config.ROLES_IDS_IGNORE.includes(role.id),
    )
  ) {
    return;
  }

  if (underMaintenance) {
    // Make bot appear offline
    DiscordUtilityService.setUserStatus(client, "idle");
    if (message.guild.id === config.GUILD_ID_PRIMARY) {
      let secondsRemaining = 10;
      // Randomly select an explosion GIF
      const randomExplosionGif =
        EXPLOSION_GIFS[Math.floor(Math.random() * EXPLOSION_GIFS.length)];

      try {
        // Send initial message and store it
        const sentMessage = await message.reply(
          `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
        );

        const interval = setInterval(async () => {
          secondsRemaining--;

          try {
            if (secondsRemaining <= 0) {
              clearInterval(interval);
              // Delete the bot's reply
              await sentMessage.delete();
            } else if (secondsRemaining < 3) {
              // Show explosion GIF right before deletion
              await sentMessage.edit(randomExplosionGif);
            } else {
              // Update the countdown
              await sentMessage.edit(
                `I AM CURRENTLY UNDER MAINTENANCE, TRY AGAIN LATER.\nMESSAGE SELF DESTRUCTING IN ${secondsRemaining} SECONDS`,
              );
            }
          } catch (error) {
            console.error(error);
            clearInterval(interval);
          }
        }, 1000);
      } catch (error) {
        console.error(error);
      }
      return;
    }
  }

  // START TYPING
  if (!typingIntervals[message.channel.id]) {
    typingIntervals[message.channel.id] =
      await DiscordUtilityService.startTypingInterval(message.channel);
  }

  // LUPOS CHATTER ROLE
  if (isGuildWhitemane) {
    await DiscordUtilityService.addRoleToMember(
      message.member,
      config.ROLE_ID_BOT_CHATTER,
    );
    // remove after 1 minutes
    setTimeout(
      async () => {
        await DiscordUtilityService.removeRoleFromMember(
          message.member,
          config.ROLE_ID_BOT_CHATTER,
        );
      },
      1 * 60 * 1000,
    );
  }

  // Determine how many messages to go back into history
  // const messagesToFetch = await AIService.generateTextDetermineHowManyMessagesToFetch(message.content);

  // R: Grab the messages before the current message...
  const recentMessages = (
    await DiscordUtilityService.fetchMessages(client, message.channel.id, {
      limit: 500,
      before: message.id,
    })
  ).reverse();
  // R: ...and add the current message to the end of the collection
  recentMessages.set(message.id, message);

  queuedData.push({ message, recentMessages, actionType });

  if (!isProcessingQueue) {
    isProcessingQueue = true;
    while (queuedData.length > 0) {
      const queuedDatum = queuedData.shift();
      const currentChannelId = queuedDatum.message.channel.id;
      await replyMessage(queuedDatum, localMongo);
      // R: If there are no more messages in the queue for this channel, clear the typing interval
      // R: We use the optional chaining operator (?.), but I believe it's not needed, as it was crashing, whenever the bot kept getting kicked from the server.
      if (
        !queuedData.some((q) => q.message?.channel?.id === currentChannelId)
      ) {
        // if (!queuedData.some(q => q.message.channel.id === currentChannelId)) {
        // Clear typing for this specific channel only
        if (typingIntervals[currentChannelId]) {
          DiscordUtilityService.clearTypingInterval(
            typingIntervals[currentChannelId],
          );
          delete typingIntervals[currentChannelId];
        }
      }
    }
    isProcessingQueue = false;
    // Don't clear all typing intervals here - let each channel manage its own
    // typingIntervals = {}; // Remove this line
    return;
  }
}

async function luposOnMessageCreate(client, { mongo, localMongo }, message) {
  await processMessage(client, { mongo, localMongo }, message, "CREATE");
}

async function luposOnMessageCreateCloneMessage(
  client,
  { _mongo, localMongo },
  message,
) {
  await DiscordUtilityService.saveMessageToMongo(message, localMongo);
}

async function luposOnMessageUpdateCloneMessage(
  client,
  { _mongo, localMongo },
  oldMessage,
  newMessage,
) {
  await DiscordUtilityService.updateMessageInMongo(newMessage, localMongo);
}

async function luposOnMessageUpdate(
  client,
  { mongo, localMongo },
  oldMessage,
  newMessage,
) {
  // R: If the message mentions the bot and the old message does not, process it
  if (
    newMessage.mentions.has(client.user) &&
    !oldMessage.mentions.has(client.user)
  ) {
    // R: Check if there are any future messages that have this message as a reply by the bot
    const futureMessages = (
      await DiscordUtilityService.fetchMessages(client, newMessage.channel.id, {
        limit: 100,
        after: newMessage.id,
      })
    ).filter(
      (msg) =>
        msg.author.id === client.user.id &&
        msg.reference?.messageId === newMessage.id,
    );
    if (futureMessages.length) return;
    await processMessage(client, { mongo, localMongo }, newMessage, "UPDATE");
  } else {
    return;
  }
}

// Whenever a message is deleted in WHITEMANE, post it in the deleted-message channel
async function luposOnMessageDelete(client, message) {
  // Fetch partial messages
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      console.error("Failed to fetch partial message:", error);
      return;
    }
  }

  // Cancel any pending or in-flight processing for this message
  const deletedMessageId = message.id;
  // Remove from pending queue
  const removedCount = queuedData.length;
  for (let i = queuedData.length - 1; i >= 0; i--) {
    if (queuedData[i].message?.id === deletedMessageId) {
      queuedData.splice(i, 1);
    }
  }
  if (queuedData.length < removedCount) {
    console.log(
      `🗑️ [DiscordService] Removed deleted message ${deletedMessageId} from pending queue.`,
    );
  }
  // Mark as cancelled for in-flight processing
  cancelledMessageIds.add(deletedMessageId);
  // Auto-cleanup after 5 minutes to prevent memory leaks
  setTimeout(() => cancelledMessageIds.delete(deletedMessageId), 5 * 60 * 1000);

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
    config.CHANNEL_ID_DELETED_MESSAGES,
  );
  if (!deletedMessagesChannel) return;

  // Extract message data
  const name = DiscordUtilityService.getDisplayNameFromUserOrMember({
    member: message.member,
    user: message.author,
  });
  if (!name) return;

  const avatarUrl = utilities.getDiscordAvatarUrl(message.author?.id, message.author?.avatar);
  const channelName = DiscordUtilityService.getChannelName(
    client,
    message.channelId,
  );
  const messageURL = utilities.getDiscordMessageUrl(message.guildId, message.channelId, message.id);

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
      );
      if (referenceChannel?.messages) {
        const referenceMessage = await referenceChannel.messages.fetch(
          message.reference.messageId,
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
    } catch (error) {
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
    const attachmentArray = Array.from(message.attachments.values());
    const attachmentInfo = [];

    attachmentArray.forEach((attachment, index) => {
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
    const imageAttachments = attachmentArray.filter((att) =>
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
    const stickerArray = Array.from(message.stickers.values());
    const stickerInfo = stickerArray
      .map((sticker) => `**${sticker.name}** • [View](${sticker.url})`)
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
  } catch (error) {
    console.error("Failed to send deleted message log:", error);
  }
}

async function processCreateReaction(client, queuedReaction) {
  const functionName = "processCreateReaction";
  const { reaction, user } = queuedReaction;
  const messageId = reaction.message.id;
  const userId = reaction.message.author?.id;
  const guildId = reaction.message.guildId;
  const channelId = reaction.message.channelId;
  const channelName = DiscordUtilityService.getChannelName(client, channelId);
  const uniqueUserLengthTrigger = 5;
  const highlightsChannel = config.CHANNEL_ID_HIGHLIGHTS;
  const content = reaction.message.content;

  if (
    channelId === config.CHANNEL_ID_HIGHLIGHTS ||
    channelId === config.CHANNEL_ID_BOOTY_BAE
  )
    return;

  if (!allUniqueUsers[messageId]) {
    allUniqueUsers[messageId] = new Set();
  } else {
    allUniqueUsers[messageId].add(userId);
  }

  const users = await reaction.users.fetch();
  users.map((user) => allUniqueUsers[messageId].add(user.id));
  console.log(...LogFormatter.reactionAdded(functionName, user, reaction));
  if ([...allUniqueUsers[messageId]].length >= uniqueUserLengthTrigger) {
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
    let emojiUrl;

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
    let referenceMessage;

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
    // .addFields(
    //     { name: 'Regular field title', value: 'Some value here' },
    //     { name: '\u200B', value: '\u200B' },
    //     { name: 'Inline field title', value: 'Some value here', inline: true },
    //     { name: 'Inline field title', value: 'Some value here', inline: true },
    // )
    // .addFields({ name: 'Inline field title', value: 'Some value here', inline: true })

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
      [...allUniqueUsers[messageId]].length >
      reaction.message.reactions.cache.size
        ? [...allUniqueUsers[messageId]].length
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

    if (!reactionMessages[messageId]) {
      const message = await targetChannel.send({ embeds: [embed] });
      reactionMessages[messageId] = message.id;
    } else {
      const message = await targetChannel.messages.fetch(
        reactionMessages[messageId],
      );
      await message.edit({ embeds: [embed] });
    }
  }
}

async function luposOnReactionCreateQueue(client, mongo, reaction, user) {
  if (reaction.message.guild.id !== config.GUILD_ID_PRIMARY) return;

  await EventReactJob.processJob(client, mongo, reaction, user);
  const isHighlightChannel =
    reaction.message.channelId === config.CHANNEL_ID_HIGHLIGHTS;
  const isNSFWChannel =
    reaction.message.channelId === config.CHANNEL_ID_BOOTY_BAE;
  if (isHighlightChannel) return;
  if (isNSFWChannel) return;

  reactionQueue.push({ reaction, user });

  if (!isProcessingOnReactionQueue) {
    isProcessingOnReactionQueue = true;
    while (reactionQueue.length > 0) {
      const queuedReaction = reactionQueue.shift();
      await processCreateReaction(client, queuedReaction);
    }
    isProcessingOnReactionQueue = false;
    return;
  }
}

// Whenever a new member joins the server
async function luposOnGuildMemberAdd(client, mongo, member) {
  const functionName = "luposOnGuildMemberAdd";
  if (member.guild.id !== config.GUILD_ID_PRIMARY) return;
  console.log(...LogFormatter.memberJoinedGuild(functionName, member));

  // Kick accounts less than 4 weeks old (unless whitelisted)
  const wasKicked = await kickIfTooNew(member, functionName);
  if (wasKicked) return;

  // Assign politics mute role if user is in the muted list
  if (config.USER_IDS_POLITICS_MUTED?.includes(member.id)) {
    await DiscordUtilityService.addRoleToMember(
      member,
      config.ROLE_ID_POLITICS_MUTE,
    );
  }
}

// Whenever a member is updated
async function luposOnGuildMemberUpdate(client, mongo, oldMember, newMember) {
  const functionName = "luposOnGuildMemberUpdate";

  // Revert bot nickname if changed in specific server
  if (
    newMember.guild.id === config.GUILD_ID_GROBBULUS &&
    newMember.id === client.user.id
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
      } catch (error) {
        console.error(
          `[${functionName}] Failed to revert bot nickname:`,
          error,
        );
      }
    }
  }

  // console.log(...LogFormatter.memberUpdate(functionName, oldMember, newMember));
  if (oldMember.guild.id !== config.GUILD_ID_PRIMARY) return;
  // Whenever a user completes onboarding
  const hasOldMemberCompletedOnboarding = oldMember.flags & (1 << 1);
  const hasNewMemberCompletedOnboarding = newMember.flags & (1 << 1);
  if (!hasOldMemberCompletedOnboarding && hasNewMemberCompletedOnboarding) {
    LightsService.cycleColor(config.PRIMARY_LIGHT_ID);
    console.log(
      ...LogFormatter.memberUpdateOnboardingComplete(functionName, newMember),
    );
    await generateRolesEmbedMessage(client);
  }
}

async function luposOnInteractionCreate(client, mongo, interaction) {
  const functionName = "luposOnInteractionCreate";
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("pick-role-")) {
      const roleId = interaction.customId.split("pick-role-")[1];
      const role = interaction.guild.roles.cache.get(roleId);
      const member = interaction.member;
      if (!role) {
        console.error(...LogFormatter.roleNotFound(interaction, roleId));
        return;
      }
      if (member.roles.cache.has(roleId)) {
        console.log(
          ...LogFormatter.roleSelfRemoved(functionName, interaction, role),
        );
        await interaction.reply({
          content: `Removing <@&${roleId}>...`,
          flags: MessageFlags.Ephemeral,
        });
        await DiscordUtilityService.removeRoleFromMember(member, roleId);
        // update reply message to say role removed
        // I want to get the http response from the editReply call and log it
        await interaction.editReply({
          content: `Removed <@&${roleId}>!`,
          flags: MessageFlags.Ephemeral,
        });
        // wait 5 seconds before deleting the reply
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await interaction.deleteReply();
        await generateRolesEmbedMessage(client, interaction);
        return;
      } else {
        console.log(
          ...LogFormatter.roleSelfAdded(functionName, interaction, role),
        );
        await interaction.reply({
          content: `Adding <@&${roleId}>...`,
          flags: MessageFlags.Ephemeral,
        });
        await DiscordUtilityService.addRoleToMember(member, roleId);
        // update reply message to say role added
        await interaction.editReply({
          content: `Added <@&${roleId}>!`,
          flags: MessageFlags.Ephemeral,
        });
        // wait 5 seconds before deleting the reply
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await interaction.deleteReply();
        await generateRolesEmbedMessage(client, interaction);
        return;
      }
    }

    const youtubeAction = YOUTUBE_BUTTON_ACTIONS[interaction.customId];
    if (youtubeAction) {
      const reply = await interaction.deferReply();
      YouTubeService[youtubeAction.method](...youtubeAction.args);
      await reply.delete();
      return;
    }
  } else if (interaction.isCommand()) {
    // utilities.consoleLog('=', `Command interaction received: ${interaction.commandName}`);
    console.log(
      ...LogFormatter.interactionCreateCommand(functionName, interaction),
    );
    if (interaction.commandName === "ping") {
      await interaction.reply("Pong!");
      return;
    }
    // if (interaction.commandName === 'recordvoice') {
    //     return;
    // }
    else {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(...LogFormatter.commandNotFound(interaction));
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        // console.error('123123123', error);
        if (interaction.replied || interaction.deferred) {
          // await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
          // do nothing
          return;
        } else {
          console.log(
            ...LogFormatter.commandError(functionName, interaction, error),
          );
          await interaction.reply({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        }
      }
    }
  }
}

async function luposOnPresenceUpdate(client, oldPresence, newPresence) {
  const functionName = "luposOnPresenceUpdate";

  const mongo = MongoService.getClient("local");
  if (newPresence.guild.id !== config.GUILD_ID_PRIMARY) return;

  try {
    let activityName = "";
    let isStreaming = false;
    const userName = newPresence.user.username;
    let streamingUrl = "";
    const _userStatus = newPresence.status;

    // Check activities
    for (const activity of newPresence.activities) {
      // PLAYING
      if (activity.type === 0) {
        activityName = activity.name;

        const db = mongo.db("lupos");
        const collection = db.collection("GameActivity");
        const existingActivity = await collection.findOne({
          name: activity.name,
        });
        if (!existingActivity) {
          await collection.insertOne({ name: activity.name, count: 1 });
        } else {
          await collection.updateOne(
            { name: activity.name },
            { $inc: { count: 1 } },
          );
        }

        for (const mapping of GAME_ROLE_MAPPINGS) {
          if (activity.name.toLowerCase().includes(mapping.activityName)) {
            const roleId = rolesVideogames.find(
              (role) => role.name.toLowerCase() === mapping.roleName,
            )?.id;
            await DiscordUtilityService.addRoleToMember(
              newPresence.member,
              roleId,
            );
          }
        }
      }
      // streaming
      if (activity.type === 1) {
        isStreaming = true;
        streamingUrl = activity.url;
        // console.log(`${newPresence.user.tag} is streaming ${activity.name} at ${activity.url}.`);
      }
      // listening
      if (activity.type === 2) {
        activityName = activity.name;
        await DiscordUtilityService.addRoleToMember(newPresence.member, config.ROLE_ID_SPOTIFY_LISTENER);
        // console.log(`${newPresence.user.tag} is listening to ${activity.name}.`);
      }
      // watching
      if (activity.type === 3) {
        activityName = activity.name;
        // console.log(`${newPresence.user.tag} is watching ${activity.name}.`);
      }
      // custom
      if (activity.type === 4) {
        activityName = activity.name;
        // console.log(`${newPresence.user.tag} has a custom status: ${activity.name}.`);
      }
      // competing
      if (activity.type === 5) {
        activityName = activity.name;
        // console.log(`${newPresence.user.tag} is competing in ${activity.name}.`);
      }
    }

    if (isStreaming) {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const db = mongo.db("lupos");
      const streamersCollection = db.collection("ActiveStreamers");

      // Find and update or insert
      const result = await streamersCollection.findOneAndUpdate(
        { userId: newPresence.user.id },
        {
          $set: {
            userId: newPresence.user.id,
            userName: userName,
            streamingUrl: streamingUrl,
            activityName: activityName,
            isStreaming: isStreaming,
            timestamp: new Date(),
          },
        },
        {
          upsert: true,
          returnDocument: "before", // Returns the document before update (or null if inserted)
        },
      );

      // Check if we should notify (no previous record or last notification was more than 3 hours ago)
      const shouldNotify =
        !result || new Date(result.timestamp) < threeHoursAgo;

      if (shouldNotify) {
        try {
          // Scrape metadata from Twitch
          const metadata = await ScraperService.scrapeTwitchUrl(streamingUrl);
          // Assign streamer role to user
          await DiscordUtilityService.addRoleToMember(
            newPresence.member,
            config.ROLE_ID_STREAMER,
          );
          // Get the streaming channel
          const streamingChannel = await DiscordUtilityService.getChannelById(
            client,
            config.CHANNEL_ID_STREAMERS,
          );

          if (streamingChannel) {
            const userTag = `<@${newPresence.user.id}>`;

            // Create embed
            const embed = new EmbedBuilder()
              .setAuthor({
                name: `${userName} is now live on Twitch!`,
                iconURL: newPresence.user.displayAvatarURL(),
              })
              .setURL(streamingUrl)
              .setDescription(`${userTag} is streaming **${activityName}**`)
              .setColor("#57F287")
              .setTimestamp();

            // Add thumbnail if available
            if (metadata?.image) {
              embed.setThumbnail(metadata.image);
            }

            // Add title from description (max 256 characters)
            if (metadata?.description) {
              const title =
                metadata.description.length > 256
                  ? metadata.description.substring(0, 253) + "..."
                  : metadata.description;
              embed.setTitle(title);
            }

            // Create button
            const buttonWatchStream = new ButtonBuilder()
              .setLabel("Watch Stream")
              .setStyle(ButtonStyle.Link)
              .setURL(streamingUrl);

            const rowButtons = new ActionRowBuilder().addComponents(
              buttonWatchStream,
            );

            // Send the message
            await streamingChannel.send({
              embeds: [embed],
              components: [rowButtons],
            });
          } else {
            console.error(
              `Streaming channel with ID ${config.CHANNEL_ID_STREAMERS} not found`,
            );
          }
        } catch (notificationError) {
          console.error(...LogFormatter.error(functionName, notificationError));
        }
      }
    }
  } catch (error) {
    console.error(...LogFormatter.error(error));
  }
}

async function luposOnGuildMemberRemove(client, mongo, member) {
  // console.log(...LogFormatter.memberLeftGuild(member));
  if (member.guild.id === config.GUILD_ID_PRIMARY) {
    if (config.CHANNEL_ID_LEAVERS) {
      const leaversLogChannel = DiscordUtilityService.getChannelById(
        client,
        config.CHANNEL_ID_LEAVERS,
      );
      if (leaversLogChannel) {
        let description = "";
        description += `Tag: <@${member.id}>\n`;
        description += `ID: \`${member.user.id}\`\n`;
        description += `Global Name: \`${member.user.globalName}\`\n`;
        description += `Username: \`${member.user.username}\`\n`;
        if (member.joinedTimestamp) {
          const joinedDateTime = DateTime.fromMillis(member.joinedTimestamp);
          // Friday, October 14, 1983, 9:30:33 AM Eastern Daylight Time
          const joinedDate = joinedDateTime.toLocaleString(
            DateTime.DATETIME_HUGE_WITH_SECONDS,
          );
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

async function luposOnVoiceStateUpdate(client, mongo, oldState, newState) {
  if (newState.channelId) {
    console.log(...LogFormatter.memberJoinedVoiceChannel(newState));
    if (newState.member.guild.id === config.GUILD_ID_PRIMARY) {
      const voiceChatterRoleId = config.ROLE_ID_VOICE_CHATTER;
      await DiscordUtilityService.addRoleToMember(
        newState.member,
        voiceChatterRoleId,
      );
    }
  } else {
    console.log(...LogFormatter.memberLeftVoiceChannel(oldState));
  }
}

async function consoleLogAllGuilds(client) {
  const guilds = DiscordUtilityService.getAllGuilds(client);
  console.log(...LogFormatter.displayAllGuilds(guilds));
}

async function generateStickerResponse(message, localMongo) {
  // if sticker
  let content = "";
  if (message.stickers.size === 1) {
    const sticker = message.stickers.first();
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

async function generateAttachmentsResponse(
  message,
  messagesTranscriptionsCollection,
  messagesImagesCollection,
  userMessage,
  modifiedContent,
  localMongo,
) {
  const transcriptionsCollection = messagesTranscriptionsCollection.get(
    userMessage.id,
  );
  const imagesCollection = messagesImagesCollection.get(userMessage.id);
  if (!message.content) {
    if (transcriptionsCollection?.size > 0) {
      // iterate through the first one only
      const audioTranscriptions = transcriptionsCollection.values().next()
        .value.transcription;
      modifiedContent += `\nType: Voice Message`;
      modifiedContent += `\nAudio Content:`;
      modifiedContent += `\n<audio_transcription>`;
      modifiedContent += `\n${audioTranscriptions}`;
      modifiedContent += `\n</audio_transcription>`;
    }
    if (!transcriptionsCollection?.size && imagesCollection?.size) {
      modifiedContent += `\nType: Image Message`;
      for (const [_index, image] of imagesCollection.entries()) {
        modifiedContent += `\nImage Content:`;
        modifiedContent += `\n<image_caption>`;
        modifiedContent += `\n  ${image.caption}`;
        modifiedContent += `\n</image_caption>`;
      }
    }
  } else {
    if (transcriptionsCollection?.size || imagesCollection?.size) {
      modifiedContent += `\nAttachments (${imagesCollection.size}):`;
    }
    if (transcriptionsCollection?.size) {
      const audioTranscriptions = transcriptionsCollection.values().next()
        .value.transcription;
      modifiedContent += `\nAudio Transcription: ${audioTranscriptions}`;
    }
    if (imagesCollection?.size) {
      for (const [index, image] of imagesCollection.entries()) {
        // index is a long hash, cut it down to the first 8 characters
        modifiedContent += `\nImage ${index.substring(0, 8)} Content:`;
        modifiedContent += `\n<image_caption>`;
        modifiedContent += `\n  ${image.caption}`;
        modifiedContent += `\n</image_caption>`;
      }
    }
  }

  modifiedContent += await generateStickerResponse(userMessage, localMongo);
  return modifiedContent;
}

async function generateEmojiResponse(message, isReply = false) {
  // if emojis
  const who = "";
  if (isReply) {
    // who = `Original `;
  }
  let content = "";
  if (message.reactions.cache.size > 0) {
    const repliedReactions = message.reactions.cache.map((reaction) => {
      return `${reaction.emoji.name}`;
    });
    content += `\n${who}Reactions (${message.reactions.cache.size}):`;
    content += `\n  • ${repliedReactions.join(", ")}`;
  }
  return content;
}

const DiscordService = {
  // VENDER
  async initializeBotVender() {
    const venderClient = DiscordWrapper.createClient(
      "vender",
      config.VENDER_TOKEN,
    );
    // Initialize MongoDB client
    await MongoService.createClient("local", config.LOCAL_DATABASE_URL);
    const mongo = MongoService.getClient("local");
    DiscordUtilityService.onEventClientReady(
      venderClient,
      { mongo },
      venderOnReady, // eslint-disable-line no-undef
    );
    DiscordUtilityService.onEventMessageCreate(
      venderClient,
      { mongo },
      venderOnMessageCreate, // eslint-disable-line no-undef
    );
    DiscordUtilityService.onEventInteractionCreate(
      venderClient,
      mongo,
      venderOnInteractionCreate, // eslint-disable-line no-undef
    );
  },
  // LUPOS
  async initializeBotLupos() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN,
    );
    // Initialize MongoDB clients
    await MongoService.createClient("cloud", config.DATABASE_URL);
    await MongoService.createClient("local", config.LOCAL_DATABASE_URL);
    const mongo = MongoService.getClient("cloud");
    const localMongo = MongoService.getClient("local");
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo, localMongo },
      luposOnReady,
    );
    // I need a mode that processes all messages in the server and saves them to mongo
    if (mode === "services") {
      DiscordUtilityService.onEventMessageCreate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageCreateCloneMessage,
      );
      DiscordUtilityService.onEventMessageUpdate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageUpdateCloneMessage,
      );
      DiscordUtilityService.onEventGuildMemberAdd(
        luposClient,
        mongo,
        luposOnGuildMemberAdd,
      );
      DiscordUtilityService.onEventGuildMemberUpdate(
        luposClient,
        mongo,
        luposOnGuildMemberUpdate,
      );
      DiscordUtilityService.onEventMessageReactionAdd(
        luposClient,
        mongo,
        luposOnReactionCreateQueue,
      );
      DiscordUtilityService.onEventPresenceUpdate(
        luposClient,
        luposOnPresenceUpdate,
      );
      DiscordUtilityService.onEventGuildMemberRemove(
        luposClient,
        mongo,
        luposOnGuildMemberRemove,
      );
      DiscordUtilityService.onEventVoiceStateUpdate(
        luposClient,
        mongo,
        luposOnVoiceStateUpdate,
      );
      DiscordUtilityService.onEventInteractionCreate(
        luposClient,
        mongo,
        luposOnInteractionCreate,
      );
      DiscordUtilityService.onEventMessageDelete(
        luposClient,
        mongo,
        luposOnMessageDelete,
      );

      // I want to also edit this messageId: '1445112669265985718', in serverId: '609471635308937237', in channelId: '1400554512472866926' to say editted message
      // and console.log the res.headers
      // const channelId = '1400554512472866926';
      // const messageId = '1445112669265985718';
      // const serverId = '609471635308937237';
      // const newContent = `editted message.`;
      // fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      //     method: 'PATCH',
      //     headers: { 'Authorization': `Bot ${config.LUPOS_TOKEN}`, 'Content-Type': 'application/json' },
      //     body: JSON.stringify({ content: newContent })
      // })
      // .then(res => {
      //     console.log('Edit Message Status:', res.status);
      //     console.log('\n=== Rate Limit Headers After Edit ===');
      //     console.log('res.headers:', res.headers);
      //     return res.json();
      // })
      // .then(data => console.log('\nEdited Message:', data.content))
      // .catch(error => console.error('Error editing message:', error));
    } else if (mode === "messages") {
      DiscordUtilityService.onEventMessageCreate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageCreate,
      );
      console.log(...LogFormatter.readyToProcessMessages());
      DiscordUtilityService.onEventMessageUpdate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageUpdate,
      );
      console.log(...LogFormatter.readyToProcessMessageUpdates());
    } else {
      DiscordUtilityService.onEventMessageCreate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageCreateCloneMessage,
      );
      DiscordUtilityService.onEventMessageUpdate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageUpdateCloneMessage,
      );
      DiscordUtilityService.onEventGuildMemberAdd(
        luposClient,
        mongo,
        luposOnGuildMemberAdd,
      );
      DiscordUtilityService.onEventGuildMemberUpdate(
        luposClient,
        mongo,
        luposOnGuildMemberUpdate,
      );
      DiscordUtilityService.onEventMessageCreate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageCreate,
      );
      console.log(...LogFormatter.readyToProcessMessages());
      DiscordUtilityService.onEventMessageUpdate(
        luposClient,
        { mongo, localMongo },
        luposOnMessageUpdate,
      );
      console.log(...LogFormatter.readyToProcessMessageUpdates());
      DiscordUtilityService.onEventMessageReactionAdd(
        luposClient,
        mongo,
        luposOnReactionCreateQueue,
      );
      DiscordUtilityService.onEventInteractionCreate(
        luposClient,
        mongo,
        luposOnInteractionCreate,
      );
      DiscordUtilityService.onEventMessageDelete(
        luposClient,
        mongo,
        luposOnMessageDelete,
      );
      DiscordUtilityService.onEventPresenceUpdate(
        luposClient,
        luposOnPresenceUpdate,
      );
      DiscordUtilityService.onEventGuildMemberRemove(
        luposClient,
        mongo,
        luposOnGuildMemberRemove,
      );
      DiscordUtilityService.onEventVoiceStateUpdate(
        luposClient,
        mongo,
        luposOnVoiceStateUpdate,
      );
    }
    updateLastMessageSentTime();

    // Create a collection to store your commands
    luposClient.commands = new Collection();

    // Load all commands from the commands directory
    const foldersPath = path.join(import.meta.dirname, "..", "commands");
    const commandFolders = fs.readdirSync(foldersPath);

    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => file.endsWith(".js"));

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = (await import(pathToFileURL(filePath).href)).default;

        if (!command) {
          console.log(`[WARNING] Skipping ${file} — no default export found.`);
          continue;
        }

        if ("data" in command && "execute" in command) {
          luposClient.commands.set(command.data.name, command);
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
      config.LUPOS_TOKEN,
    );
    await MongoService.createClient("local", config.LOCAL_DATABASE_URL);
    const localMongo = MongoService.getClient("local");
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { localMongo },
      luposOnReadyCloneMessages,
    );
  },
  async deleteDuplicateMessages() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN,
    );
    await MongoService.createClient("local", config.LOCAL_DATABASE_URL);
    const localMongo = MongoService.getClient("local");
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { localMongo },
      luposOnReadyDeleteDuplicateMessages,
    );
  },
  async deleteNewAccounts() {
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN,
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      {},
      luposOnReadyDeleteNewAccounts,
    );
  },
  initializeBotLuposReports() {
    const mongo = MongoService.getClient("local");
    const luposClient = DiscordWrapper.createClient(
      "lupos",
      config.LUPOS_TOKEN,
    );
    DiscordUtilityService.onEventClientReady(
      luposClient,
      { mongo },
      luposOnReadyReports,
    );
  },
};

export default DiscordService;
