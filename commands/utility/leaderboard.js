import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getMongoDb, formatTimePeriod, getMedal } from "./commandUtils.js";

export default {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows message leaderboard for a specified time period")
    .addIntegerOption((option) =>
      option
        .setName("years")
        .setDescription("Number of years to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7),
    )
    .addIntegerOption((option) =>
      option
        .setName("months")
        .setDescription("Number of months to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(12),
    )
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setDescription("Number of days to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(31),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to check (default: current channel)")
        .setRequired(false),
    ),

  async execute(interaction) {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");

    await interaction.deferReply();

    // Get time parameters
    const years = interaction.options.getInteger("years") || 0;
    const months = interaction.options.getInteger("months") || 0;
    let days = interaction.options.getInteger("days") || 0;
    const channel = interaction.options.getChannel("channel");

    if (years === 0 && months === 0 && days === 0) {
      days = 7;
    }

    // Calculate start date
    const now = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setDate(startDate.getDate() - days);
    const unixStartDate = Math.floor(startDate.getTime());

    const match = {
      createdTimestamp: { $gte: unixStartDate },
      guildId: interaction.guildId,
    };

    if (channel) {
      match.channelId = channel.id;
    }

    try {
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
          .toArray(),
      ]);

      const sortedUsers = allUsers.slice(0, 10);
      const totalUsers = allUsers.length;
      const totalUserMessages = allUsers.reduce((s, u) => s + u.count, 0);
      const avgMessages = totalUsers > 0 ? totalUserMessages / totalUsers : 0;

      const description = `**Time Period:** ${formatTimePeriod(years, months, days, "Last 7 days (default)")}\n**Channel:** ${channel ? channel.toString() : "All Channels"}\n**Total Messages:** ${totalMessages}\n\n`;

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle(`📊 Message Leaderboard`)
        .setDescription(description)
        .setColor(0x00ae86)
        .setTimestamp()
        .setFooter({
          text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}`,
        });

      // Add leaderboard fields
      if (sortedUsers.length === 0) {
        embed.addFields({
          name: "No Messages",
          value: "No messages found in the specified time period.",
        });
      } else {
        const leaderboardText = sortedUsers
          .map((user, index) => {
            const medal = getMedal(index);
            return `${medal} **${index + 1}.** ${user.username} - **${user.count}** messages`;
          })
          .join("\n");

        embed.addFields({
          name: "Top Contributors",
          value: leaderboardText,
        });

        embed.addFields({
          name: "📈 Statistics",
          value: `**Active Users:** ${totalUsers}\n**Average Messages/User:** ${avgMessages.toFixed(1)}`,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      await interaction.editReply({
        content:
          "An error occurred while fetching the leaderboard. Please try again later.",
      });
    }
  },
};
