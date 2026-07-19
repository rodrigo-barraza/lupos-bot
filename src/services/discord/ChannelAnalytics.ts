// ============================================================
// ChannelAnalytics — Reports-mode console analytics
// ============================================================
// displayAllChannelActivity and
// calculateMessagesSentOnAveragePerDayInChannel moved verbatim
// from DiscordUtilityService.ts (R1 split). DiscordUtilityService
// keeps thin delegating wrappers, so callers are unchanged.
// Note: this module imports DiscordUtilityService back (for
// fetchMessages), but only accesses it lazily inside function
// bodies, which keeps the circular import safe.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import utilities from "#root/utilities.js";
const { consoleLog } = utilities;
import config from "#root/config.js";
import { Collection, ChannelType } from "discord.js";
import type { Client, Message, TextChannel } from "discord.js";
import { MILLISECONDS_PER_DAY } from "#root/constants.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import { errorMessage, errorStack } from "#root/services/discord/errors.js";
import { DISCORD_CHANNELS } from "@rodrigo-barraza/utilities-library/taxonomy";

/** Represents a channel stat entry from the activity analysis. */
interface ChannelStat {
  channel: TextChannel;
  messageCount: number;
  uniqueUsers: number;
  topUsers: { username: string; count: number }[];
  averageMessagesPerDay: number;
  lastMessageDate: Temporal.ZonedDateTime | null;
  categoryName: string;
}

/** Per-user global stats across all channels. */
interface UserStat {
  username: string;
  totalMessages: number;
  channels: Set<string>;
}

/** Result of displayAllChannelActivity's processChannel */
interface ActivityChannelResult {
  channelStat: ChannelStat;
  localUserStats: Record<string, UserStat>;
}

async function fetchMessagesWithOptionalLastId(
  client: Client,
  channelId: string,
  maxMessages: number = 10,
  lastId?: string,
) {
  const channel = client.channels.cache.find((ch) => ch.id === channelId) as
    | TextChannel
    | undefined;

  if (channel) {
    let allMessages = new Collection<string, Message>();

    // Initial fetch
    let messages = await channel.messages.fetch({
      limit: Math.min(100, maxMessages),
      before: lastId,
    });
    allMessages = allMessages.concat(messages);

    // Continue fetching if we need more messages
    while (allMessages.size < maxMessages && messages.size !== 0) {
      lastId = messages.last()?.id;
      if (!lastId) break;

      const additionalMessagesNeeded = maxMessages - allMessages.size;
      messages = await channel.messages.fetch({
        limit: Math.min(100, additionalMessagesNeeded),
        before: lastId,
      });

      allMessages = allMessages.concat(messages);
    }
    // If we fetched more than needed, trim the collection
    if (allMessages.size > maxMessages) {
      const trimmedCollection = new Collection<string, Message>();
      let count = 0;
      for (const [id, message] of allMessages) {
        if (count >= maxMessages) break;
        trimmedCollection.set(id, message);
        count++;
      }
      return trimmedCollection;
    }

    return allMessages;
  }
}

const ChannelAnalytics = {
  async displayAllChannelActivity(client: Client) {
    const MONTHS_TO_ANALYZE = 36;
    const CONCURRENT_CHANNELS = 10; // Number of channels to process simultaneously
    const periodText =
      (MONTHS_TO_ANALYZE as number) === 1
        ? "1 month"
        : `${MONTHS_TO_ANALYZE} months`;

    const startTime = Date.now();
    consoleLog(">", `Displaying all channel activity (past ${periodText})`);
    console.log("[START] Beginning channel activity analysis...");
    console.log(`[START] Started at: ${new Date(startTime).toISOString()}`);
    console.log(
      `[CONFIG] Processing ${CONCURRENT_CHANNELS} channels concurrently`,
    );

    const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY!);
    if (!guild) {
      console.error("[ERROR] Primary guild not found");
      return;
    }
    console.log(
      `[GUILD] Found guild: ${guild.name} with ${guild.channels.cache.size} total channels`,
    );

    const excludedCategories = [
      // 'Archived',
      // 'Archived02',
      // 'Archived: First Purge',
      // 'Archived: SOD',
      // 'Archived: Alliance',
      // 'Archived: WoW Classes',
      "⚒ Administration",
      "Info",
      "Welcome",
      "commands",
    ];

    const excludedChannels = [
      "609498307626008576",
      DISCORD_CHANNELS.politics,
      DISCORD_CHANNELS.sportsmane,
    ];

    console.log(
      `[FILTER] Excluding categories: ${excludedCategories.join(", ")}`,
    );
    console.log(
      `[FILTER] Excluding ${excludedChannels.length} specific channels`,
    );

    const channelStats: ChannelStat[] = [];
    const globalUserStats: Record<string, UserStat> = {};
    const now = TemporalHelpers.now();
    const cutoffDate = TemporalHelpers.minus(now, {
      months: MONTHS_TO_ANALYZE,
    });
    console.log(`[TIME] Current time: ${TemporalHelpers.nowISO()}`);
    console.log(
      `[TIME] Cutoff date (${periodText} ago): ${cutoffDate.toInstant().toString()}`,
    );

    let processedChannelCount = 0;
    let totalFetchCount = 0;

    // Collect all eligible channels first
    const eligibleChannels: TextChannel[] = [];
    for (const channel of guild.channels.cache.values()) {
      if (
        channel.type === ChannelType.GuildText &&
        channel.parent &&
        !excludedCategories.includes(channel.parent.name) &&
        !excludedChannels.includes(channel.id)
      ) {
        eligibleChannels.push(channel);
      }
    }

    const eligibleChannelCount = eligibleChannels.length;
    console.log(
      `[CHANNELS] Found ${eligibleChannelCount} eligible text channels to process`,
    );
    console.log("----------------------------------------");

    // Function to process a single channel
    const processChannel = async (
      channel: TextChannel,
      channelIndex: number,
    ) => {
      const logPrefix = `[CH ${channelIndex}/${eligibleChannelCount}]`;
      console.log(
        `\n${logPrefix} Processing: #${channel.name} (Category: ${channel.parent?.name ?? "No Category"})`,
      );

      try {
        let allMessages: Message[] = [];
        let lastMessageId = null;
        let fetchMore = true;
        let fetchCount = 0;
        let channelFetchCount = 0;
        let consecutiveDuplicates = 0;
        let previousOldestId = null;

        console.log(
          `  ${logPrefix} [FETCH] Starting message fetch for #${channel.name}...`,
        );

        while (fetchMore) {
          fetchCount++;
          channelFetchCount++;
          totalFetchCount++;

          console.log(`  ${logPrefix} [FETCH] Fetching batch ${fetchCount}...`);

          const messages = await fetchMessagesWithOptionalLastId(
            client,
            channel.id,
            100,
            lastMessageId ? lastMessageId : undefined,
          );

          const messagesArray: Message[] = messages
            ? Array.from(messages.values())
            : [];

          if (messagesArray.length === 0) {
            console.log(
              `  ${logPrefix} [FETCH] No messages found, stopping fetch`,
            );
            fetchMore = false;
            break;
          }

          const oldestMessage = messagesArray[messagesArray.length - 1];
          const oldestMessageDateTime = TemporalHelpers.fromMillis(
            oldestMessage.createdTimestamp,
          );
          const newestMessage = messagesArray[0];
          const newestMessageDateTime = TemporalHelpers.fromMillis(
            newestMessage.createdTimestamp,
          );

          if (previousOldestId === oldestMessage.id) {
            consecutiveDuplicates++;
            console.log(
              `  ${logPrefix} [FETCH] WARNING: Got same oldest message ID as previous batch (duplicate #${consecutiveDuplicates})`,
            );
            if (consecutiveDuplicates >= 3) {
              console.log(
                `  ${logPrefix} [FETCH] ERROR: Too many duplicate batches, stopping to prevent infinite loop`,
              );
              fetchMore = false;
              break;
            }
          } else {
            consecutiveDuplicates = 0;
            previousOldestId = oldestMessage.id;
          }

          const newMessages = messagesArray.filter(
            (message: Message) =>
              !allMessages.some(
                (existingMsg: Message) => existingMsg.id === message.id,
              ),
          );

          if (newMessages.length === 0) {
            console.log(
              `  ${logPrefix} [FETCH] All messages in this batch are duplicates, stopping`,
            );
            fetchMore = false;
            break;
          }

          allMessages = allMessages.concat(newMessages);

          console.log(
            `  ${logPrefix} [FETCH] Batch ${fetchCount}: ${messagesArray.length} messages (${newMessages.length} new)`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Date range: ${TemporalHelpers.format(newestMessageDateTime, "yyyy-MM-dd HH:mm:ss")} to ${TemporalHelpers.format(oldestMessageDateTime, "yyyy-MM-dd HH:mm:ss")}`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Oldest message ID: ${oldestMessage.id}`,
          );

          if (
            TemporalHelpers.toEpochMs(oldestMessageDateTime) <
            TemporalHelpers.toEpochMs(cutoffDate)
          ) {
            console.log(
              `  ${logPrefix} [FETCH] Reached messages older than ${periodText} (${TemporalHelpers.format(oldestMessageDateTime, "yyyy-MM-dd")} < ${TemporalHelpers.format(cutoffDate, "yyyy-MM-dd")})`,
            );
            fetchMore = false;
            break;
          }

          if (messagesArray.length < 100) {
            console.log(
              `  ${logPrefix} [FETCH] Retrieved only ${messagesArray.length} messages, channel history exhausted`,
            );
            fetchMore = false;
            break;
          }

          lastMessageId = oldestMessage.id;

          console.log(
            `  ${logPrefix} [FETCH] Total unique messages collected: ${allMessages.length}`,
          );
          console.log(
            `  ${logPrefix} [FETCH] Next fetch will use before: ${lastMessageId}`,
          );

          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }

        console.log(
          `  ${logPrefix} [FETCH] Total fetches for this channel: ${channelFetchCount}`,
        );
        console.log(
          `  ${logPrefix} [PROCESS] Filtering messages from the last ${periodText}...`,
        );

        const messagesInPeriod = allMessages.filter(
          (message: Message) =>
            TemporalHelpers.toEpochMs(
              TemporalHelpers.fromMillis(message.createdTimestamp),
            ) > TemporalHelpers.toEpochMs(cutoffDate),
        );
        console.log(
          `  ${logPrefix} [PROCESS] Found ${messagesInPeriod.length} messages in the last ${periodText} (out of ${allMessages.length} total fetched)`,
        );

        const userMessageCount: Record<
          string,
          { username: string; count: number }
        > = {};
        const localUserStats: Record<string, UserStat> = {}; // Collect locally first to avoid race conditions

        messagesInPeriod.forEach((message: Message) => {
          const userId = message.author.id;
          const username = message.author.username;
          if (!userMessageCount[userId]) {
            userMessageCount[userId] = {
              username: username,
              count: 0,
            };
          }
          userMessageCount[userId].count++;

          if (!localUserStats[userId]) {
            localUserStats[userId] = {
              username: username,
              totalMessages: 0,
              channels: new Set(),
            };
          }
          localUserStats[userId].totalMessages++;
          localUserStats[userId].channels.add(channel.name);
        });

        const uniqueUserCount = Object.keys(userMessageCount).length;
        console.log(
          `  ${logPrefix} [USERS] Found ${uniqueUserCount} unique users in the last ${periodText}`,
        );

        const sortedUsers = Object.entries(userMessageCount)
          .sort(([, a], [, b]) => b.count - a.count)
          .slice(0, 20)
          .map(([_userId, data]) => ({
            username: data.username,
            count: data.count,
          }));

        if (sortedUsers.length > 0) {
          console.log(`  ${logPrefix} [TOP USERS] Top contributors:`);
          sortedUsers.forEach((user, index: number) => {
            console.log(
              `    ${index + 1}. ${user.username}: ${user.count} messages`,
            );
          });
        }

        let averageMessagesPerDay = 0;
        let lastMessageDate = null;

        if (messagesInPeriod.length > 0) {
          const oldestRecentMessage =
            messagesInPeriod[messagesInPeriod.length - 1];
          const newestMessage = messagesInPeriod[0];
          const oldestDateTime = TemporalHelpers.fromMillis(
            oldestRecentMessage.createdTimestamp,
          );
          const newestDateTime = TemporalHelpers.fromMillis(
            newestMessage.createdTimestamp,
          );
          const daySpan = Math.max(
            1,
            TemporalHelpers.diffIn(newestDateTime, oldestDateTime, "days"),
          );

          averageMessagesPerDay = messagesInPeriod.length / daySpan;
          lastMessageDate = newestDateTime;

          console.log(
            `  ${logPrefix} [METRICS] Message span: ${daySpan.toFixed(1)} days`,
          );
          console.log(
            `  ${logPrefix} [METRICS] Average messages/day: ${averageMessagesPerDay.toFixed(2)}`,
          );
          console.log(
            `  ${logPrefix} [METRICS] Last message: ${TemporalHelpers.format(lastMessageDate, "yyyy-MM-dd HH:mm")}`,
          );
        } else {
          console.log(
            `  ${logPrefix} [METRICS] No messages in the last ${periodText}`,
          );
        }

        processedChannelCount++;
        console.log(
          `  ${logPrefix} [COMPLETE] Successfully processed #${channel.name} (${processedChannelCount}/${eligibleChannelCount} done)`,
        );

        return {
          channelStat: {
            channel: channel,
            messageCount: messagesInPeriod.length,
            uniqueUsers: uniqueUserCount,
            topUsers: sortedUsers,
            averageMessagesPerDay: averageMessagesPerDay,
            lastMessageDate: lastMessageDate,
            categoryName: channel.parent ? channel.parent.name : "No Category",
          },
          localUserStats: localUserStats,
        };
      } catch (error: unknown) {
        console.error(
          `  ${logPrefix} [ERROR] Failed to fetch messages for channel ${channel.name}:`,
          errorMessage(error),
        );
        console.error(`  ${logPrefix} [ERROR] Stack trace:`, errorStack(error));
        processedChannelCount++;
        return null;
      }
    };

    // Process channels in batches with concurrency limit
    const results: (ActivityChannelResult | null)[] = [];
    for (let i = 0; i < eligibleChannels.length; i += CONCURRENT_CHANNELS) {
      const batch = eligibleChannels.slice(i, i + CONCURRENT_CHANNELS);
      const batchNumber = Math.floor(i / CONCURRENT_CHANNELS) + 1;
      const totalBatches = Math.ceil(
        eligibleChannels.length / CONCURRENT_CHANNELS,
      );

      console.log(`\n========================================`);
      console.log(
        `[BATCH ${batchNumber}/${totalBatches}] Processing ${batch.length} channels concurrently...`,
      );
      console.log(`========================================`);

      const batchPromises = batch.map(
        (channel: TextChannel, batchIndex: number) =>
          processChannel(channel, i + batchIndex + 1),
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      console.log(`\n[BATCH ${batchNumber}/${totalBatches}] Completed`);
    }

    // Merge results
    for (const result of results) {
      if (result) {
        channelStats.push(result.channelStat);

        // Merge local user stats into global
        for (const [userId, data] of Object.entries(result.localUserStats)) {
          if (!globalUserStats[userId]) {
            globalUserStats[userId] = {
              username: data.username,
              totalMessages: 0,
              channels: new Set(),
            };
          }
          globalUserStats[userId].totalMessages += data.totalMessages;
          for (const channelName of data.channels) {
            globalUserStats[userId].channels.add(channelName);
          }
        }
      }
    }

    console.log("\n----------------------------------------");
    console.log("[SORT] Sorting channels by average messages per day...");
    channelStats.sort(
      (a, b) => b.averageMessagesPerDay - a.averageMessagesPerDay,
    );
    console.log("[SORT] Sorting complete (by average messages/day)");

    console.log(`\n=== Channel Activity Report (Past ${periodText}) ===`);
    console.log("=== Sorted by Average Messages Per Day ===\n");
    console.log(
      "Rank | Avg/Day | Messages | Users | Days Ago | Category            | Channel Name         | Top 3 Users",
    );
    console.log(
      "-----|---------|----------|-------|----------|---------------------|----------------------|-------------",
    );

    channelStats.forEach((stat, index: number) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const avgPerDay = stat.averageMessagesPerDay.toFixed(2).padStart(7, " ");
      const messageCount = stat.messageCount.toString().padStart(8, " ");
      const uniqueUsers = stat.uniqueUsers.toString().padStart(5, " ");

      let daysSinceLastMessage = "N/A";
      if (stat.lastMessageDate) {
        const daysDiff = TemporalHelpers.diffIn(
          now,
          stat.lastMessageDate,
          "days",
        );
        daysSinceLastMessage = daysDiff.toFixed(0).padStart(8, " ");
      } else {
        daysSinceLastMessage = daysSinceLastMessage.padStart(8, " ");
      }

      const category = stat.categoryName.substring(0, 20).padEnd(20, " ");
      const channelName = stat.channel.name.substring(0, 20).padEnd(20, " ");

      let topUsersStr: string;
      if (stat.topUsers.length > 0) {
        topUsersStr = stat.topUsers
          .slice(0, 3)
          .map(
            (user, userIndex: number) =>
              `${userIndex + 1}. ${user.username} (${user.count})`,
          )
          .join(", ");
      } else {
        topUsersStr = "No activity";
      }

      console.log(
        `${rank} | ${avgPerDay} | ${messageCount} | ${uniqueUsers} | ${daysSinceLastMessage} | ${category} | ${channelName} | ${topUsersStr}`,
      );
    });

    const totalMessages = channelStats.reduce(
      (sum, stat) => sum + stat.messageCount,
      0,
    );
    const activeChannels = channelStats.filter(
      (stat) => stat.messageCount > 0,
    ).length;
    const inactiveChannels = channelStats.filter(
      (stat) => stat.messageCount === 0,
    ).length;
    const totalUniqueUsers = Object.keys(globalUserStats).length;

    const mostActiveByAverage = channelStats[0];

    const topTenUsers = Object.entries(globalUserStats)
      .sort(([, a], [, b]) => b.totalMessages - a.totalMessages)
      .slice(0, 10)
      .map(([_userId, data]) => ({
        username: data.username,
        totalMessages: data.totalMessages,
        channelCount: data.channels.size,
      }));

    const endTime = Date.now();
    const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const totalTimeMinutes = (Number(totalTimeSeconds) / 60).toFixed(2);

    console.log("\n=== Summary ===");
    console.log(`[SUMMARY] Total messages (${periodText}): ${totalMessages}`);
    console.log(`[SUMMARY] Active channels: ${activeChannels}`);
    console.log(`[SUMMARY] Inactive channels: ${inactiveChannels}`);
    console.log(
      `[SUMMARY] Most active channel (by avg/day): ${mostActiveByAverage?.channel.name || "N/A"} (${mostActiveByAverage?.averageMessagesPerDay.toFixed(2) || 0} messages/day)`,
    );
    console.log(`[SUMMARY] Total channels processed: ${processedChannelCount}`);
    console.log(`[SUMMARY] Total API fetches made: ${totalFetchCount}`);
    console.log(
      `[SUMMARY] Average fetches per channel: ${(totalFetchCount / processedChannelCount).toFixed(2)}`,
    );
    console.log(
      `[SUMMARY] Total unique users across all channels: ${totalUniqueUsers}`,
    );
    console.log(
      `[SUMMARY] Concurrent channels setting: ${CONCURRENT_CHANNELS}`,
    );
    console.log(
      `[SUMMARY] Total execution time: ${totalTimeSeconds} seconds (${totalTimeMinutes} minutes)`,
    );
    console.log(`[SUMMARY] Completed at: ${new Date(endTime).toISOString()}`);

    console.log(`\n=== Top 10 Most Active Users (Past ${periodText}) ===`);
    console.log(
      "Rank | Username                | Total Messages | Active Channels",
    );
    console.log(
      "-----|-------------------------|----------------|----------------",
    );

    topTenUsers.forEach((user, index: number) => {
      const rank = (index + 1).toString().padStart(4, " ");
      const username = user.username.substring(0, 23).padEnd(23, " ");
      const totalMsgs = user.totalMessages.toString().padStart(14, " ");
      const channelCount = user.channelCount.toString().padStart(15, " ");

      console.log(`${rank} | ${username} | ${totalMsgs} | ${channelCount}`);
    });

    console.log("\n[END] Channel activity analysis complete!");
    consoleLog(">", "displayAllChannelActivity");
  },
  async calculateMessagesSentOnAveragePerDayInChannel(
    client: Client,
    channelId: string,
  ) {
    console.log(
      `Calculating average messages sent in channel ${channelId} over the date range in the messages...`,
    );
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      console.log(
        `Channel with ID ${channelId} not found or is not a text channel.`,
      );
      return;
    }

    const now = Date.now();

    let messageCount = 0;
    let lastMessageDate = null;

    try {
      const fetchResult = await DiscordUtilityService.fetchMessages(
        client,
        channel.id,
        {
          limit: 100,
        },
      );
      if (!fetchResult) return;
      const recentMessages = fetchResult.reverse();
      for (const recentMsg of recentMessages.values()) {
        messageCount++;
        if (
          !lastMessageDate ||
          recentMsg.createdTimestamp > lastMessageDate.getTime()
        ) {
          lastMessageDate = new Date(recentMsg.createdTimestamp);
        }
      }
    } catch (error: unknown) {
      console.log(
        `Error fetching messages from channel ${(channel as TextChannel).name}: ${errorMessage(error)}`,
      );
      return;
    }

    const daysSinceStart = Math.max(
      1,
      Math.ceil(
        (now - (lastMessageDate?.getTime() || now)) / MILLISECONDS_PER_DAY,
      ),
    );
    const averageMessagesPerHour = (
      messageCount /
      (daysSinceStart * 24)
    ).toFixed(2);

    console.log(`Channel: ${(channel as TextChannel).name}`);
    console.log(
      `Messages sent in the last ${daysSinceStart} days: ${messageCount}`,
    );
    console.log(`Average messages sent per hour: ${averageMessagesPerHour}`);
    if (lastMessageDate) {
      console.log(`Last message date: ${lastMessageDate.toISOString()}`);
    } else {
      console.log("No messages found in the specified period.");
    }
  },
};

export default ChannelAnalytics;
