import { SlashCommandBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  SlashCommandChannelOption,
} from "discord.js";
import {
  getMongoDb,
  addTimePeriodOptions,
  resolvePeriod,
  buildLeaderboardEmbed,
} from "./commandUtils.ts";
import { EXCLUDE_SOFT_DELETED } from "#root/constants.ts";

interface LeaderboardUser {
  _id: string;
  username: string;
  count: number;
}

export default {
  data: addTimePeriodOptions(
    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Shows message leaderboard for a specified time period"),
  ).addChannelOption((option: SlashCommandChannelOption) =>
    option
      .setName("channel")
      .setDescription("Channel to check (default: current channel)")
      .setRequired(false),
  ),

  async execute(interaction: ChatInputCommandInteraction) {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");

    await interaction.deferReply();

    const channel = interaction.options.getChannel("channel");
    const now = new Date();
    const { startDate, unixStartDate, label } = resolvePeriod(interaction, {
      days: 7,
      label: "Last 7 days (default)",
    });

    const match: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId: interaction.guildId,
    };

    if (channel) {
      match.channelId = channel.id;
    }

    // Run total count (including bots) and user grouping in parallel.
    // The user pipeline does a single pass: filter bots → group → sort.
    const [totalMessages, allUsers] = await Promise.all([
      messagesCollection.countDocuments(match),
      messagesCollection
        .aggregate([
          { $match: { ...match, "author.bot": { $ne: true } } },
          {
            $group: {
              _id: "$author.id",
              username: { $first: "$author.username" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ])
        .toArray() as unknown as Promise<LeaderboardUser[]>,
    ]);

    const totalUsers = allUsers.length;
    const totalUserMessages = allUsers.reduce(
      (s: number, u: LeaderboardUser) => s + u.count,
      0,
    );
    const avgMessages = totalUsers > 0 ? totalUserMessages / totalUsers : 0;

    const description = `**Time Period:** ${label}\n**Channel:** ${channel ? channel.toString() : "All Channels"}\n**Total Messages:** ${totalMessages}`;

    const embed = buildLeaderboardEmbed({
      title: "📊 Message Leaderboard",
      color: 0x00ae86,
      description,
      entries: allUsers,
      topN: 10,
      topHeader: "Top Contributors",
      formatLine: (user: LeaderboardUser, index: number, medal: string) =>
        `${medal} **${index + 1}.** ${user.username} - **${user.count}** messages`,
      footer: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}`,
    });

    if (allUsers.length === 0) {
      embed.addFields({
        name: "No Messages",
        value: "No messages found in the specified time period.",
      });
    } else {
      embed.addFields({
        name: "📈 Statistics",
        value: `**Active Users:** ${totalUsers}\n**Average Messages/User:** ${avgMessages.toFixed(1)}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
