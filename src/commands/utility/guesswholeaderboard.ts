import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { Document } from "mongodb";
import { getMongoDb, buildLeaderboardEmbed } from "./commandUtils.ts";

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

  guildOnly: true,

  async execute(interaction: ChatInputCommandInteraction) {
    const db = getMongoDb();
    const scoresCollection = db.collection("GuessWhoGameScore");

    await interaction.deferReply();

    const allScores = await scoresCollection
      .find({ guildId: interaction.guildId })
      .sort({ score: -1 })
      .toArray();

    if (allScores.length === 0) {
      await interaction.editReply({
        content: "No Guess Who scores found yet! Play some `/guesswho` first.",
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
    const totalPoints = enriched.reduce(
      (sum: number, e: EnrichedScore) => sum + (e.score || 0),
      0,
    );

    // Top 10 + bottom 5 hall of shame (bottom only when there are enough players)
    const embed = buildLeaderboardEmbed({
      title: "❓ Guess Who Leaderboard",
      color: 0x5865f2,
      entries: enriched,
      topN: 10,
      bottomN: 5,
      topHeader: "🏆 Top Players",
      bottomHeader: "💀 Hall of Shame",
      formatLine: (
        entry: EnrichedScore,
        index: number,
        medal: string,
        section: "top" | "bottom",
      ) =>
        section === "bottom"
          ? `💀 **#${index + 1}.** ${entry.displayName} — **${entry.score}** pts`
          : `${medal} **${index + 1}.** ${entry.displayName} — **${entry.score}** pts`,
      footer: `${totalPlayers} players • ${totalPoints} total points across all players`,
    });

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
  },
};
