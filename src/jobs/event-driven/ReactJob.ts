import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import config from "#root/config.js";
import {
  Client,
  MessageReaction,
  User,
  Guild,
  Role,
  GuildMember,
} from "discord.js";
import { MongoClient } from "mongodb";

interface Reactor {
  id: string;
  name: string;
  role: string;
  timestamp: Date;
}

interface QueueItem {
  reaction: MessageReaction;
  user: User;
}

let queueIsProcessing = false;
const queue: QueueItem[] = [];

let reactors: Reactor[] = [];

async function generateReactors(
  client: Client,
  mongo: MongoClient,
  reaction: MessageReaction,
  user: User,
) {
  const emojiId =
    reaction.emoji.id ||
    (reaction as unknown as { _emoji?: { id?: string } })._emoji?.id;
  // if reaction is flag emoji, give flag role
  if (emojiId === config.EMOJI_ID_FLAG) {
    const guild = DiscordUtilityService.getGuildById(
      client,
      config.GUILD_ID_PRIMARY || "",
    ) as Guild | undefined;
    if (!guild) return;
    const role = guild.roles.cache.find(
      (role: Role) => role.id === config.ROLE_ID_FLAG,
    );
    if (!role) return;
    const member = await guild.members.fetch(user.id);

    if (member) {
      await member.roles.add(role);
      const reactor: Reactor = {
        id: member.id,
        name: user.globalName || user.username,
        role: role.name,
        timestamp: new Date(),
      };
      reactors.push(reactor);
    }
    return;
  }
}

async function clearReactors(client: Client, _mongo: MongoClient) {
  // Clear the reactors and remove the role if their timestamp was more than 30 minutes ago
  const oneMinuteAgo = new Date(Date.now() - 30 * 60 * 1000);
  const guild = DiscordUtilityService.getGuildById(
    client,
    config.GUILD_ID_PRIMARY || "",
  ) as Guild | undefined;
  if (!guild) return;
  const role = guild.roles.cache.find(
    (role: Role) => role.id === config.ROLE_ID_FLAG,
  );
  if (!role) return;
  const membersWithRole = guild.members.cache.filter((member: GuildMember) =>
    member.roles.cache.some((r: Role) => r.id === role.id),
  );

  // Process all members who have the role
  for (const member of membersWithRole.values()) {
    const reactor = reactors.find((r: Reactor) => r.id === member.id);

    // Remove role if: member is not in reactors array OR their timestamp is old
    if (!reactor || reactor.timestamp < oneMinuteAgo) {
      await member.roles.remove(role);
    }
  }

  // Keep only reactors with recent timestamps
  reactors = reactors.filter(
    (reactor: Reactor) => reactor.timestamp >= oneMinuteAgo,
  );
}

const ReactJob = {
  async startJob(client: Client, mongo: MongoClient): Promise<void> {
    await clearReactors(client, mongo); // Execute immediately
    setInterval(() => {
      clearReactors(client, mongo).catch((error: unknown) => {
        console.error("❌ [ReactJob] clearReactors failed:", error);
      });
    }, 1000 * 60); // every minute
  },
  async processJob(
    client: Client,
    mongo: MongoClient,
    reaction: MessageReaction,
    user: User,
  ): Promise<void> {
    queue.push({ reaction, user });
    if (queueIsProcessing) return;
    queueIsProcessing = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          try {
            await generateReactors(client, mongo, item.reaction, item.user);
          } catch (error: unknown) {
            console.error(
              "❌ [ReactJob] generateReactors failed — continuing queue:",
              error,
            );
          }
        }
      }
    } finally {
      queueIsProcessing = false;
    }
  },
};

export default ReactJob;
