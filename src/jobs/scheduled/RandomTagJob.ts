import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import AIService from "#root/services/AIService.js";
import PrismService from "#root/services/PrismService.js";
import { MessageConstant } from "#root/constants.js";
import config from "#root/config.js";
import utilities from "#root/utilities.js";
import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import type { Client, GuildMember, Message } from "discord.js";

const { consoleLog } = utilities;

const INTERVAL_MIN_MS = 10 * 60 * 1000; // 10 minutes
const INTERVAL_MAX_MS = 60 * 60 * 1000; // 60 minutes

function getRandomInterval() {
  return utilities.getRandomInterval(INTERVAL_MIN_MS, INTERVAL_MAX_MS);
}

interface RandomTagJobConfig {
  client: Client;
  guildId: string;
  channelId: string;
}

interface SelectedMember {
  member: GuildMember;
  displayName: string;
  username: string;
  id: string;
}

interface CustomContext {
  title: string;
  keywords: string;
  description: string;
}

/**
 * RandomTagJob — April Fools scheduled job.
 *
 * Every 30 seconds, Lupos picks a random member from a specific guild/channel,
 * reads the recent conversation, generates a contextual message tagging them,
 * and sends it unprompted. Maximum chaos energy.
 */

async function randomTag({ client, guildId, channelId }: RandomTagJobConfig) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      consoleLog("!", `[RandomTagJob] Guild ${guildId} not found`);
      return;
    }

    const channel = DiscordUtilityService.getChannelById(client, channelId) as import("discord.js").TextChannel | undefined;
    if (!channel) {
      consoleLog("!", `[RandomTagJob] Channel ${channelId} not found`);
      return;
    }

    // Scan all text channels under the target categories for active users
    const CATEGORY_IDS = ["610921893071028408", "610924121311674415", "609652454375555082"];
    const activeAuthors = new Map<string, GuildMember>(); // userId -> member

    for (const [, ch] of guild.channels.cache) {
      if (ch.type !== 0) continue; // GuildText = 0
      if (!ch.parentId || !CATEGORY_IDS.includes(ch.parentId)) continue;

      try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        for (const [, message] of msgs) {
          if (message.author.bot) continue;
          if (!activeAuthors.has(message.author.id) && message.member) {
            activeAuthors.set(message.author.id, message.member);
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

    // Pick 3 random active members (or fewer if pool is small)
    const membersArray = Array.from(activeAuthors.values());
    const TARGET_COUNT = Math.min(3, membersArray.length);
    const selectedMembers: SelectedMember[] = [];
    const usedIndices = new Set<number>();

    while (selectedMembers.length < TARGET_COUNT) {
      const index = Math.floor(Math.random() * membersArray.length);
      if (usedIndices.has(index)) continue;
      usedIndices.add(index);
      const member = membersArray[index];
      selectedMembers.push({
        member: member,
        displayName:
          member.displayName || member.user.globalName || member.user.username,
        username: member.user.username,
        id: member.user.id,
      });
    }

    const namesStr = selectedMembers.map((s: SelectedMember) => s.displayName).join(", ");
    consoleLog(
      "=",
      `[RandomTagJob] 🎯 Targeting: ${namesStr} [pool: ${activeAuthors.size} active users]`,
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
      if (client.user && lastMsg?.author.id === client.user.id) {
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
      const messagesArray: Message[] = Array.from(recentMessages.values()).reverse() as Message[];
      for (const message of messagesArray.slice(-15)) {
        const author =
          message.member?.displayName ||
          message.author?.globalName ||
          message.author?.username ||
          "Unknown";
        if (message.content) {
          conversationContext += `${author}: ${message.content}\n`;
        }
      }
    }

    // Gather custom context and memories for each tagged person
    let peopleContext = "";
    for (const person of selectedMembers) {
      // Custom context from MessageConstants
      const usernameLower = person.username.toLowerCase();
      const displayNameLower = person.displayName.toLowerCase();
      const matchedContext = MessageConstant.customContextWhitemane?.find(
        (context: CustomContext) => {
          const keywords = context.keywords
            .split(",")
            .map((k: string) => k.trim().toLowerCase());
          return (
            keywords.includes(usernameLower) ||
            keywords.includes(displayNameLower)
          );
        },
      );
      if (matchedContext) {
        peopleContext += `\n### KNOWN INFO ABOUT ${person.displayName.toUpperCase()}:\n${matchedContext.description}`;
      }

      // Memories from Prism
      try {
        const memoryResult = await PrismService.searchMemories({
          guildId,
          userIds: [person.id],
          queryText: person.displayName,
          limit: 3,
        });
        if (memoryResult?.memories && memoryResult.memories.length > 0) {
          peopleContext += `\n### YOUR MEMORIES ABOUT ${person.displayName.toUpperCase()}:`;
          for (const memory of memoryResult.memories) {
            const createdDate = new Date(memory.createdAt);
            const timeAgo = TemporalHelpers.toRelative(TemporalHelpers.fromJSDate(createdDate));
            peopleContext += `\n- ${memory.content} (remembered ${timeAgo})`;
          }
        }
      } catch (memoryErr: unknown) {
        consoleLog(
          "!",
          `[RandomTagJob] Memory retrieval for ${person.displayName} failed: ${(memoryErr as Error).message}`,
        );
      }
    }

    // Build tag strings
    const tagsList = selectedMembers
      .map((s: SelectedMember) => `<@${s.id}>`)
      .join(" ");
    const namesList = selectedMembers
      .map((s: SelectedMember) => `${s.displayName} (<@${s.id}>)`)
      .join(", ");

    // Build the job-specific task description. The LUPOS persona
    // (personality, capabilities, guild flavor) is assembled
    // server-side by Prism's AgentPersonaRegistry — we only send
    // the runtime task context.
    const taskDescription = `# SPECIAL TASK: INITIATE GROUP CONVERSATION
You are NOT replying to someone — YOU are starting the conversation.
You are tagging MULTIPLE people and pulling ALL of them into whatever is being discussed.
The people you are tagging are: ${namesList}

## RULES:
- You MUST tag ALL of them in your message: ${tagsList}
- STAY ON TOPIC with the ongoing conversation. Read the recent chat context carefully and make your message RELEVANT to what people are currently discussing.
- Pull ALL tagged people INTO the current topic — pit them against each other, ask them to weigh in, start a debate, or drag them all into it together
- Address them as a GROUP but also call out individuals by name for maximum engagement
- If there IS an active conversation, your message MUST relate to it. Do NOT change the subject randomly.
- If there is NO recent conversation, THEN you can be random and chaotic
- Keep it to TWO to THREE sentences max
- Be in-character: sassy, high, cat-cosplaying wolf energy
- If you have memories or known info about them, USE IT to make the tags personal and specific
- DO NOT explain why you're tagging them — just do it like it's the most natural thing in the world`;

    const agentContext: Record<string, unknown> = {
      platform: "discord",
      guildId,
      channelId,
      participantUserIds: selectedMembers.map((s: SelectedMember) => s.id),
      platformContext: {
        description: taskDescription,
        ids: `# Discord IDs\n- Guild ID: ${guildId}\n- Channel ID: ${channelId}`,
      },
    };

    // Memory/context strings travel in the user message
    let userMessage = `Generate a message tagging ${namesList}. You're initiating a group conversation. Be chaotic and in-character. Make sure you involve all of them.`;
    userMessage += `\n\n## PEOPLE CONTEXT:${peopleContext || "\nNo specific info available."}`;
    userMessage += `\n\n${conversationContext ? `## RECENT CHAT CONTEXT (STAY ON THIS TOPIC):\n${conversationContext}` : "## No recent messages — just vibe and be chaotic."}`;

    // Start typing indicator while generating
    const typingInterval = await DiscordUtilityService.startTypingInterval(channel);

    const agentModel =
      config.LANGUAGE_MODEL_TYPE === "GOOGLE"
        ? config.GOOGLE_LANGUAGE_MODEL_FAST
        : config.LANGUAGE_MODEL_TYPE === "OPENAI"
          ? config.FAST_LANGUAGE_MODEL_OPENAI
          : config.LANGUAGE_MODEL_TYPE === "LOCAL"
            ? config.FAST_LANGUAGE_MODEL_LOCAL
            : config.ANTHROPIC_LANGUAGE_MODEL_FAST;

    const agentResponse = await PrismService.generateAgentResponse({
      messages: [{ role: "user", content: userMessage }],
      type: config.LANGUAGE_MODEL_TYPE || "",
      model: agentModel || "",
      agentContext,
      maxTokens: 1024,
      temperature: 1.0,
      ...AIService._getTraceParams(),
    });

    const generatedText = agentResponse.text;

    if (!generatedText) {
      DiscordUtilityService.clearTypingInterval(typingInterval);
      consoleLog("!", `[RandomTagJob] No text generated, skipping`);
      return;
    }

    // Ensure the message actually contains all mentions
    let finalMessage = generatedText.trim();
    for (const person of selectedMembers) {
      if (!finalMessage.includes(`<@${person.id}>`)) {
        finalMessage = `<@${person.id}> ${finalMessage}`;
      }
    }

    // Send the message to the channel
    await channel.send(finalMessage);
    consoleLog(
      "=",
      `[RandomTagJob] ✅ Sent message tagging ${namesStr}: ${finalMessage.substring(0, 120)}...`,
    );
    DiscordUtilityService.clearTypingInterval(typingInterval);
  } catch (error: unknown) {
    consoleLog("!", `[RandomTagJob] Error: ${(error as Error).message}`);
    console.error(error);
  }
}

const RandomTagJob = {
  startJob({ client, guildId, channelId }: RandomTagJobConfig) {
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
