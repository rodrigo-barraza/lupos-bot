import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import MessageService from "#root/services/MessageService.js";
import AIService from "#root/services/AIService.js";
import PrismService from "#root/services/PrismService.js";
import { MessageConstant } from "#root/constants.js";
import config from "#root/config.js";
import utilities from "#root/utilities.js";
import { DateTime } from "luxon";

const { consoleLog } = utilities;

const INTERVAL_MIN_MS = 10 * 60 * 1000; // 10 minutes
const INTERVAL_MAX_MS = 60 * 60 * 1000; // 60 minutes

function getRandomInterval() {
  return Math.floor(Math.random() * (INTERVAL_MAX_MS - INTERVAL_MIN_MS + 1)) + INTERVAL_MIN_MS;
}

/**
 * RandomTagJob — April Fools scheduled job.
 *
 * Every 30 seconds, Lupos picks a random member from a specific guild/channel,
 * reads the recent conversation, generates a contextual message tagging them,
 * and sends it unprompted. Maximum chaos energy.
 */

async function randomTag({ client, guildId, channelId }) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      consoleLog("!", `[RandomTagJob] Guild ${guildId} not found`);
      return;
    }

    const channel = DiscordUtilityService.getChannelById(client, channelId);
    if (!channel) {
      consoleLog("!", `[RandomTagJob] Channel ${channelId} not found`);
      return;
    }

    // Scan all text channels under the target categories for active users
    const CATEGORY_IDS = ["610921893071028408", "610924121311674415", "609652454375555082"];
    const activeAuthors = new Map(); // userId -> member

    for (const [, ch] of guild.channels.cache) {
      if (ch.type !== 0) continue; // GuildText = 0
      if (!ch.parentId || !CATEGORY_IDS.includes(ch.parentId)) continue;

      try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        for (const [, msg] of msgs) {
          if (msg.author.bot) continue;
          if (!activeAuthors.has(msg.author.id) && msg.member) {
            activeAuthors.set(msg.author.id, msg.member);
          }
        }
      } catch {
        // Channel may be inaccessible — skip silently
      }
    }

    if (activeAuthors.size === 0) {
      consoleLog("!", `[RandomTagJob] No active human authors found in target categories`);
      return;
    }

    // Pick a random active member
    const membersArray = Array.from(activeAuthors.values());
    const randomMember =
      membersArray[Math.floor(Math.random() * membersArray.length)];
    const displayName =
      randomMember.displayName ||
      randomMember.user.globalName ||
      randomMember.user.username;
    const username = randomMember.user.username;

    consoleLog(
      "=",
      `[RandomTagJob] 🎯 Targeting: ${displayName} (${username}) [pool: ${activeAuthors.size} active users]`,
    );

    // Fetch recent messages from the channel for context
    const recentMessages = await DiscordUtilityService.fetchMessages(
      client,
      channelId,
      { limit: 30 },
    );

    // If the last message was from Lupos, skip — don't double-post
    if (recentMessages && recentMessages.size > 0) {
      const lastMsg = recentMessages.first();
      if (lastMsg.author.id === client.user.id) {
        consoleLog(
          "=",
          `[RandomTagJob] ⏭️ Last message was from Lupos, skipping this round`,
        );
        return;
      }
    }

    // Build a simplified conversation context from recent messages
    let conversationContext = "";
    if (recentMessages && recentMessages.size > 0) {
      const messagesArray = Array.from(recentMessages.values()).reverse();
      for (const msg of messagesArray.slice(-15)) {
        const author =
          msg.member?.displayName ||
          msg.author?.globalName ||
          msg.author?.username ||
          "Unknown";
        if (msg.content) {
          conversationContext += `${author}: ${msg.content}\n`;
        }
      }
    }

    // Look up custom context for this user from MessageConstants
    let customContext = "";
    const usernameLower = username.toLowerCase();
    const displayNameLower = displayName.toLowerCase();
    const matchedContext = MessageConstant.customContextWhitemane?.find(
      (ctx) => {
        const keywords = ctx.keywords
          .split(",")
          .map((k) => k.trim().toLowerCase());
        return (
          keywords.includes(usernameLower) ||
          keywords.includes(displayNameLower)
        );
      },
    );
    if (matchedContext) {
      customContext = `\n## KNOWN INFO ABOUT ${displayName.toUpperCase()}:\n${matchedContext.description}`;
    }

    // Retrieve memories about this user from Prism
    let memoriesContext = "";
    try {
      const memoryResult = await PrismService.searchMemories({
        guildId,
        userIds: [randomMember.id],
        queryText: displayName,
        limit: 5,
      });
      if (memoryResult?.memories?.length > 0) {
        memoriesContext = `\n## YOUR MEMORIES ABOUT ${displayName.toUpperCase()}:`;
        memoriesContext += `\nUse these naturally — don't force all of them.`;
        for (const memory of memoryResult.memories) {
          const createdDate = new Date(memory.createdAt);
          const timeAgo = DateTime.fromJSDate(createdDate).toRelative();
          memoriesContext += `\n- ${memory.fact} (remembered ${timeAgo})`;
        }
      }
    } catch (memoryErr) {
      consoleLog(
        "!",
        `[RandomTagJob] Memory retrieval failed: ${memoryErr.message}`,
      );
    }

    // Build the system prompt using the existing personality
    const assistantMessage = MessageService.assembleAssistantMessage(
      false,
      guildId,
    );

    const systemPrompt = `${assistantMessage}

# SPECIAL TASK: INITIATE CONVERSATION
You are NOT replying to someone — YOU are starting the conversation.
You are tagging a specific person and pulling them into whatever is being discussed.
The person you are tagging is: ${displayName} (<@${randomMember.id}>)
${customContext}${memoriesContext}

## RULES:
- You MUST start your message by tagging them: <@${randomMember.id}>
- STAY ON TOPIC with the ongoing conversation. Read the recent chat context carefully and make your message RELEVANT to what people are currently discussing.
- Pull the tagged person INTO the current topic — ask their opinion, roast their take, or drag them into the discussion
- If there IS an active conversation, your message MUST relate to it. Do NOT change the subject randomly.
- If there is NO recent conversation, THEN you can be random and chaotic
- Keep it to ONE sentence, maximum TWO
- Be in-character: sassy, high, cat-cosplaying wolf energy
- If you have memories or known info about them, USE IT to make the tag personal and specific
- DO NOT explain why you're tagging them — just do it like it's the most natural thing in the world

${conversationContext ? `## RECENT CHAT CONTEXT (STAY ON THIS TOPIC):\n${conversationContext}` : "## No recent messages — just vibe and be chaotic."}`;

    const conversation = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `Generate a message tagging <@${randomMember.id}> (${displayName}). Remember: you're initiating, not replying. Be chaotic and in-character.`,
      },
    ];

    const generatedText = await AIService.generateText({
      conversation,
      type: config.LANGUAGE_MODEL_TYPE,
      modelPerformance: "POWERFUL",
      tokens: 150,
      temperature: 1.0,
      label: "🎯 Random Tag",
    });

    if (!generatedText) {
      consoleLog("!", `[RandomTagJob] No text generated, skipping`);
      return;
    }

    // Ensure the message actually contains the mention
    let finalMessage = generatedText.trim();
    if (!finalMessage.includes(`<@${randomMember.id}>`)) {
      finalMessage = `<@${randomMember.id}> ${finalMessage}`;
    }

    // Send the message to the channel
    await channel.send(finalMessage);
    consoleLog(
      "=",
      `[RandomTagJob] ✅ Sent message tagging ${displayName}: ${finalMessage.substring(0, 100)}...`,
    );
  } catch (error) {
    consoleLog("!", `[RandomTagJob] Error: ${error.message}`);
    console.error(error);
  }
}

const RandomTagJob = {
  startJob({ client, guildId, channelId }) {
    const scheduleNext = () => {
      const delay = getRandomInterval();
      const delayMinutes = (delay / 60_000).toFixed(1);
      consoleLog(
        "=",
        `[RandomTagJob] 🎯 Next random tag in ${delayMinutes} minutes`,
      );
      setTimeout(async () => {
        await randomTag({ client, guildId, channelId });
        scheduleNext();
      }, delay);
    };

    consoleLog(
      "=",
      `[RandomTagJob] 🎯 Starting random tag job (10-60 min interval) for guild ${guildId}, channel ${channelId}`,
    );

    // Initial delay then start the loop
    setTimeout(() => {
      randomTag({ client, guildId, channelId }).then(scheduleNext);
    }, 10_000);
  },
};

export default RandomTagJob;
