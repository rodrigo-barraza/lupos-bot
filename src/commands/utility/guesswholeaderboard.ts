import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { Document } from "mongodb";
import { getMongoDb, getMedal } from "./commandUtils.ts";

interface GuessWhoScore {
  userId: string;
  username: string;
  score: number;
  guildId: string;
}

interface EnrichedScore extends GuessWhoScore {
  displayName: string;
}

export default {
  data: new SlashCommandBuilder()
    .setName("guesswholeaderboard")
    .setDescription("Shows the Guess Who leaderboard — top and bottom players"),

  async execute(interaction: ChatInputCommandInteraction) {
    const db = getMongoDb();
    const scoresCollection = db.collection("GuessWhoGameScore");

    await interaction.deferReply();

    if (!interaction.guild) {
      await interaction.editReply("This command can only be used in a server.");
      return;
    }

    try {
      const allScores = await scoresCollection
        .find({ guildId: interaction.guildId })
        .sort({ score: -1 })
        .toArray();

      if (allScores.length === 0) {
        await interaction.editReply({
          content:
            "No Guess Who scores found yet! Play some `/guesswho` first.",
        });
        return;
      }

      // Fetch display names for all players
      const enriched: EnrichedScore[] = await Promise.all(
        allScores.map(async (entry: Document): Promise<EnrichedScore> => {
          const userId = String(entry.userId);
          const username = String(entry.username);
          const score = Number(entry.score);
          const guildId = String(entry.guildId);
          let displayName = username;
          try {
            const member = await interaction.guild!.members.fetch(userId);
            displayName = member.displayName;
          } catch {
            // User may have left the server
          }
          return { userId, username, score, guildId, displayName };
        }),
      );

      const totalPlayers = enriched.length;
      const totalPoints = enriched.reduce((sum: number, e: EnrichedScore) => sum + (e.score || 0), 0);

      // Top 10
      const top10 = enriched.slice(0, 10);
      const topText = top10
        .map((entry: EnrichedScore, index: number) => {
          const medal = getMedal(index);
          return `${medal} **${index + 1}.** ${entry.displayName} — **${entry.score}** pts`;
        })
        .join("\n");

      // Bottom 5 (the hall of shame — only if there are enough players)
      const bottom5 =
        totalPlayers > 10
          ? enriched
              .slice(-5)
              .reverse()
              .map((entry: EnrichedScore) => {
                const rank =
                  enriched.findIndex((e: EnrichedScore) => e.userId === entry.userId) + 1;
                return `💀 **#${rank}.** ${entry.displayName} — **${entry.score}** pts`;
              })
              .join("\n")
          : null;

      const embed = new EmbedBuilder()
        .setTitle("❓ Guess Who Leaderboard")
        .setColor(0x5865f2)
        .setTimestamp()
        .setFooter({
          text: `${totalPlayers} players • ${totalPoints} total points across all players`,
        });

      embed.addFields({
        name: "🏆 Top Players",
        value: topText,
      });

      if (bottom5) {
        embed.addFields({
          name: "💀 Hall of Shame",
          value: bottom5,
        });
      }

      // Fun stats
      const bestPlayer = enriched[0];
      const worstPlayer = enriched[enriched.length - 1];
      const avgScore = totalPoints / totalPlayers;

      embed.addFields({
        name: "📈 Stats",
        value: [
          `**Best:** ${bestPlayer.displayName} (${bestPlayer.score} pts)`,
          `**Worst:** ${worstPlayer.displayName} (${worstPlayer.score} pts)`,
          `**Average Score:** ${avgScore.toFixed(1)} pts`,
          `**Total Players:** ${totalPlayers}`,
        ].join("\n"),
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      console.error("Error fetching Guess Who leaderboard:", error);
      await interaction.editReply({
        content:
          "An error occurred while fetching the leaderboard. Please try again later.",
      });
    }
  },
};
