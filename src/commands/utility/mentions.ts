import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  getMongoDb,
  addTimePeriodOptions,
  resolvePeriod,
  getMedal,
} from "./commandUtils.ts";
import { EXCLUDE_SOFT_DELETED } from "#root/constants.ts";

interface MentionerEntry {
  _id: string;
  username: string;
  avatar: string;
  count: number;
}

export default {
  data: addTimePeriodOptions(
    new SlashCommandBuilder()
      .setName("mentions")
      .setDescription("Shows top 5 users who have mentioned a specific user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User to check mentions for")
          .setRequired(true),
      ),
  ).addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel to check (default: all channels)")
      .setRequired(false),
  ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");

    await interaction.deferReply();

    // Get parameters
    const targetUser = interaction.options.getUser("user", true);
    const channel = interaction.options.getChannel("channel");

    const now = new Date();
    const { startDate, unixStartDate, label } = resolvePeriod(interaction);

    // Build match query
    const match: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId: interaction.guildId,
      "mentions.users": {
        $elemMatch: { id: targetUser.id },
      },
    };

    if (channel) {
      match.channelId = channel.id;
    }

    // Use aggregation pipeline
    const [result] = await messagesCollection
      .aggregate([
        {
          $match: match,
        },
        {
          $facet: {
            // Get top mentioners (non-bots only)
            topMentioners: [
              {
                $match: {
                  "author.bot": { $ne: true },
                  "author.id": { $ne: targetUser.id }, // Exclude self-mentions
                },
              },
              {
                $group: {
                  _id: "$author.id",
                  username: { $first: "$author.username" },
                  avatar: { $first: "$author.defaultAvatarURL" },
                  count: { $sum: 1 },
                },
              },
              {
                $sort: { count: -1 },
              },
              {
                $limit: 5,
              },
            ],
            // Get total statistics
            stats: [
              {
                $match: {
                  "author.bot": { $ne: true },
                },
              },
              {
                $group: {
                  _id: null,
                  totalMentions: { $sum: 1 },
                  uniqueMentioners: { $addToSet: "$author.id" },
                },
              },
              {
                $project: {
                  totalMentions: 1,
                  uniqueMentioners: { $size: "$uniqueMentioners" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const topMentioners = (result?.topMentioners || []) as MentionerEntry[];
    const stats = (result?.stats[0] || {
      totalMentions: 0,
      uniqueMentioners: 0,
    }) as { totalMentions: number; uniqueMentioners: number };

    const description = `**User:** ${targetUser.toString()}\n**Time Period:** ${label}\n**Channel:** ${channel ? channel.toString() : "All Channels"}\n**Total Mentions:** ${stats.totalMentions}\n\n`;

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(`💬 Mention Leaderboard`)
      .setDescription(description)
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({
        text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}`,
      });

    // Set thumbnail to target user's avatar
    if (targetUser.avatar) {
      embed.setThumbnail(targetUser.displayAvatarURL());
    }

    // Add leaderboard fields
    if (topMentioners.length === 0) {
      embed.addFields({
        name: "No Mentions",
        value: `No one has mentioned ${targetUser.username} in the specified time period.`,
      });
    } else {
      const leaderboardText = topMentioners
        .map((user, index) => {
          const medal = getMedal(index);
          const percentage = ((user.count / stats.totalMentions) * 100).toFixed(
            1,
          );
          return `${medal} **${index + 1}.** ${user.username} - **${user.count}** mentions (${percentage}%)`;
        })
        .join("\n");

      embed.addFields({
        name: "Top Mentioners",
        value: leaderboardText,
      });

      embed.addFields({
        name: "📈 Statistics",
        value: `**Unique Mentioners:** ${stats.uniqueMentioners}\n**Average Mentions per User:** ${(stats.totalMentions / stats.uniqueMentioners).toFixed(1)}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
