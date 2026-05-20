import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import utilities from "#root/utilities.js";
import { MONGO_DB_NAME } from "#root/constants.js";
const { consoleLog } = utilities;

let previousTopAuthorId: any;
let previousTopReactorId: any;

async function assignActivityRoles({
  client,
  mongo,
  primaryChannelId,
  roleIdYapper,
  roleIdReactor,
  periodMinutes,
}: any) {
  const channel = DiscordUtilityService.getChannelById(
    client,
    primaryChannelId,
  );
  const guild = channel.guild;
  const msgs = await DiscordUtilityService.fetchMessages(
    client,
    primaryChannelId,
    { limit: 500 },
  );
  const allMessages: any[] = Array.from(msgs.values());

  if (!allMessages.length) return;

  // Filter messages from the last time period
  const periodMinutesAgo = Date.now() - periodMinutes * 60 * 1000;
  const messages = allMessages.filter(
    (message: any) => message.createdTimestamp > periodMinutesAgo,
  );

  // Exit early if no messages in the last time period
  if (messages.length === 0) {
    // consoleLog(`No messages found in the last ${periodMinutes} minutes`);
    return;
  }

  const topAuthorRole = guild.roles.cache.find(
    (role: any) => role.id === roleIdYapper,
  );
  const topReactorRole = guild.roles.cache.find(
    (role: any) => role.id === roleIdReactor,
  );

  const authorCounts = messages.reduce((accumulator: any, currentMessage: any) => {
    if (currentMessage.author.bot) return accumulator; // Skip bot messages
    const userId = currentMessage.author.id;
    const userName = utilities.getCombinedNamesFromUserOrMember({
      user: currentMessage.author,
    });
    let authorObj = accumulator.find((object: any) => object.userId === userId);
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
    messages.map((message: any) =>
      Promise.all(
        Array.from(message.reactions.cache.values()).map(async (reaction: any) => {
          try {
            return await reaction.users.fetch();
          } catch (error: unknown) {
            // Skip reactions with unknown/deleted emojis
            if ((error as any).code === 10014) {
              // consoleLog(`Skipping unknown emoji reaction: ${reaction.emoji.name || reaction.emoji.id}`);
              return new Map(); // Return empty Map to maintain structure
            }
            throw error; // Re-throw other errors
          }
        }),
      ),
    ),
  );

  const reactorCounts = reactionUsers.reduce(
    (accumulator: any, reactionMapsForMessage: any) => {
      for (const reactionUserMap of reactionMapsForMessage) {
        for (const user of reactionUserMap.values()) {
          if (user.bot) continue; // Skip bot reactions
          const userId = user.id;
          const userName = utilities.getCombinedNamesFromUserOrMember({
            user: user,
          });
          let userStats = accumulator.find((object: any) => object.userId === userId);
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
    // consoleLog('No authors found');
    return;
  }

  const topAuthorCounts = authorCounts
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 5);


  const topReactorCounts = reactorCounts
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 5);

  // Get the top author
  const topAuthor = topAuthorCounts[0];
  const topReactor = topReactorCounts[0];

  try {
    const topAuthorMember = await guild.members.fetch(topAuthor.userId);
    const membersWithYapperRole = guild.members.cache.filter((member: any) =>
      member.roles.cache.some((role: any) => role.id === roleIdYapper),
    );

    if (previousTopAuthorId !== topAuthor.userId) {
      // Remove the role from all current holders
      await Promise.all(
        membersWithYapperRole.map(async (member: any) => {
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
    consoleLog("Error in generateYappers:", (error as Error).message);
    console.error(error);
  }

  try {
    if (!topReactor) {
      consoleLog("=", "No reactors found");
      return;
    }
    const topReactorMember = await guild.members.fetch(topReactor.userId);
    const membersWithOverReactorRole = guild.members.cache.filter((member: any) =>
      member.roles.cache.some((role: any) => role.id === roleIdReactor),
    );

    if (previousTopReactorId !== topReactor.userId) {
      // Remove the role from all current holders
      await Promise.all(
        membersWithOverReactorRole.map(async (member: any) => {
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
    consoleLog("Error in generateYappers:", (error as Error).message);
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
  }: any) {
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
