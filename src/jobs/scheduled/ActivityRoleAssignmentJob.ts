import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import utilities from "#root/utilities.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";
import type { Client, GuildMember, Role, Message, User } from "discord.js";
import type { MongoClient } from "mongodb";

const { consoleLog } = utilities;

interface ActivityRoleJobConfig {
  client: Client;
  mongo: MongoClient;
  primaryChannelId: string;
  roleIdYapper: string;
  roleIdReactor: string;
  periodMinutes: number;
  intervalMinutes?: number;
}

interface AuthorCount {
  userId: string;
  userName: string;
  count: number;
  earliestTimestamp: number;
}

interface ReactorCount {
  userId: string;
  userName: string;
  count: number;
}

let previousTopAuthorId: string | undefined;
let previousTopReactorId: string | undefined;

async function assignActivityRoles({
  client,
  mongo,
  primaryChannelId,
  roleIdYapper,
  roleIdReactor,
  periodMinutes,
}: ActivityRoleJobConfig) {
  const channel = DiscordUtilityService.getChannelById(
    client,
    primaryChannelId,
  ) as import("discord.js").TextChannel | undefined;
  if (!channel) return;
  const guild = channel.guild;
  const msgs = await DiscordUtilityService.fetchMessages(
    client,
    primaryChannelId,
    { limit: 500 },
  );
  if (!msgs) return;
  const allMessages: Message[] = Array.from(msgs.values());

  if (!allMessages.length) return;

  // Filter messages from the last time period
  const periodMinutesAgo = Date.now() - periodMinutes * 60 * 1000;
  const messages = allMessages.filter(
    (message: Message) => message.createdTimestamp > periodMinutesAgo,
  );

  // Exit early if no messages in the last time period
  if (messages.length === 0) {
    return;
  }

  const topAuthorRole = guild.roles.cache.find(
    (role: Role) => role.id === roleIdYapper,
  );
  const topReactorRole = guild.roles.cache.find(
    (role: Role) => role.id === roleIdReactor,
  );

  if (!topAuthorRole || !topReactorRole) return;

  const authorCounts = messages.reduce((accumulator: AuthorCount[], currentMessage: Message) => {
    if (currentMessage.author.bot) return accumulator; // Skip bot messages
    const userId = currentMessage.author.id;
    const userName = utilities.getCombinedNamesFromUserOrMember({
      user: currentMessage.author,
    });
    let authorObj = accumulator.find((object: AuthorCount) => object.userId === userId);
    if (!authorObj) {
      authorObj = {
        userId: userId,
        userName: userName,
        count: 0,
        earliestTimestamp: currentMessage.createdTimestamp,
      };
      accumulator.push(authorObj);
    }
    authorObj.count++;
    authorObj.earliestTimestamp = Math.min(
      authorObj.earliestTimestamp,
      currentMessage.createdTimestamp,
    );

    return accumulator;
  }, []);

  const reactionUsers = await Promise.all(
    messages.map((message: Message) =>
      Promise.all(
        Array.from(message.reactions.cache.values()).map(async (reaction) => {
          try {
            return await reaction.users.fetch();
          } catch (error: unknown) {
            // Skip reactions with unknown/deleted emojis
            if ((error as { code?: number }).code === 10014) {
              return new Map<string, User>(); // Return empty Map to maintain structure
            }
            throw error; // Re-throw other errors
          }
        }),
      ),
    ),
  );

  const reactorCounts = reactionUsers.reduce(
    (accumulator: ReactorCount[], reactionMapsForMessage) => {
      for (const reactionUserMap of reactionMapsForMessage) {
        for (const user of reactionUserMap.values()) {
          if (user.bot) continue; // Skip bot reactions
          const userId = user.id;
          const userName = utilities.getCombinedNamesFromUserOrMember({
            user: user,
          });
          let userStats = accumulator.find((object: ReactorCount) => object.userId === userId);
          if (!userStats) {
            userStats = {
              userId: userId,
              userName: userName,
              count: 0,
            };
            accumulator.push(userStats);
          }
          userStats.count++;
        }
      }
      return accumulator;
    },
    [],
  );

  // Exit if no authors found
  if (authorCounts.length === 0) {
    return;
  }

  const topAuthorCounts = authorCounts
    .sort((a: AuthorCount, b: AuthorCount) => b.count - a.count)
    .slice(0, 5);


  const topReactorCounts = reactorCounts
    .sort((a: ReactorCount, b: ReactorCount) => b.count - a.count)
    .slice(0, 5);

  // Get the top author
  const topAuthor = topAuthorCounts[0];
  const topReactor = topReactorCounts[0];

  try {
    const topAuthorMember = await guild.members.fetch(topAuthor.userId);
    const membersWithYapperRole = guild.members.cache.filter((member: GuildMember) =>
      member.roles.cache.some((role: Role) => role.id === roleIdYapper),
    );

    if (previousTopAuthorId !== topAuthor.userId) {
      // Remove the role from all current holders
      await Promise.all(
        membersWithYapperRole.map(async (member: GuildMember) => {
          consoleLog(
            "=",
            `Removing ${topAuthorRole.name} role from: ${member.user.tag}`,
          );
          return member.roles.remove(topAuthorRole);
        }),
      );
      // Add the role to the new top author
      await topAuthorMember.roles.add(topAuthorRole);
      previousTopAuthorId = topAuthor.userId;
      // log in database
      const db = mongo.db(MONGO_DB_NAME);
      const collection = db.collection("ActivityRoles");
      await collection.insertOne({
        userId: topAuthor.userId,
        roleId: roleIdYapper,
        timestamp: new Date(),
      });
      consoleLog(
        "=",
        `${topAuthor.userName} has been given the role ${topAuthorRole.name}`,
      );
    }
  } catch (error: unknown) {
    consoleLog("Error in generateYappers:", utilities.errorMessage(error));
    console.error(error);
  }

  try {
    if (!topReactor) {
      consoleLog("=", "No reactors found");
      return;
    }
    const topReactorMember = await guild.members.fetch(topReactor.userId);
    const membersWithOverReactorRole = guild.members.cache.filter((member: GuildMember) =>
      member.roles.cache.some((role: Role) => role.id === roleIdReactor),
    );

    if (previousTopReactorId !== topReactor.userId) {
      // Remove the role from all current holders
      await Promise.all(
        membersWithOverReactorRole.map(async (member: GuildMember) => {
          consoleLog(
            "=",
            `Removing ${topReactorRole.name} role from: ${member.user.tag}`,
          );
          return member.roles.remove(topReactorRole);
        }),
      );
      // Add the role to the new top reactor
      await topReactorMember.roles.add(topReactorRole);
      previousTopReactorId = topReactor.userId;
      // log in database
      const db = mongo.db(MONGO_DB_NAME);
      const collection = db.collection("ActivityRoles");
      await collection.insertOne({
        userId: topReactor.userId,
        roleId: roleIdReactor,
        timestamp: new Date(),
      });
      consoleLog(
        "=",
        `${topReactor.userName} has been given the role ${topReactorRole.name}`,
      );
    }
  } catch (error: unknown) {
    consoleLog("Error in generateYappers:", utilities.errorMessage(error));
    console.error(error);
  }
}

const ActivityRoleAssignmentJob = {
  async startJob({
    client,
    mongo,
    primaryChannelId,
    roleIdYapper,
    roleIdReactor,
    periodMinutes = 60,
    intervalMinutes = 1,
  }: ActivityRoleJobConfig) {
    await assignActivityRoles({
      client,
      mongo,
      primaryChannelId,
      roleIdYapper,
      roleIdReactor,
      periodMinutes,
    });
    setInterval(
      () => {
        assignActivityRoles({
          client,
          mongo,
          primaryChannelId,
          roleIdYapper,
          roleIdReactor,
          periodMinutes,
        });
      },
      1000 * 60 * intervalMinutes,
    );
  },
};

export default ActivityRoleAssignmentJob;
