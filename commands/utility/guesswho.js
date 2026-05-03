import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  getMongoDb,
  getServerAgeYears,
  computeStartDate,
  formatTimePeriod,
  shuffleArray,
} from "./commandUtils.js";
import { WRONG_GUESS_ROASTS } from "../../constants/GuessWhoConstants.js";

export default {
  data: new SlashCommandBuilder()
    .setName("guesswho")
    .setDescription("Guess the user from an anonymous message quote")
    .addIntegerOption((option) =>
      option
        .setName("years")
        .setDescription("Number of years to look back")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(10),
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
        .setMaxValue(365),
    )
    .addIntegerOption((option) =>
      option
        .setName("min_length")
        .setDescription("Minimum message length (default: 20)")
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(500),
    ),

  async execute(interaction) {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");
    const scoresCollection = db.collection("GuessWhoGameScore");

    await interaction.deferReply();

    // Get time parameters
    let years = interaction.options.getInteger("years") || 0;
    const months = interaction.options.getInteger("months") || 0;
    const days = interaction.options.getInteger("days") || 0;
    const channel =
      interaction.options.getChannel("channel") || interaction.channel;
    const minLength = interaction.options.getInteger("min_length") || 20;

    if (years === 0 && months === 0 && days === 0) {
      years = getServerAgeYears(interaction.guild);
    }

    const { unixStartDate } = computeStartDate(years, months, days);

    const invokerId = interaction.user.id;

    const match = {
      createdTimestamp: { $gte: unixStartDate },
      guildId: interaction.guildId,
      "author.bot": { $ne: true },
      "author.id": { $ne: invokerId },
      content: {
        $exists: true,
        $ne: "",
        $not: { $regex: "^[!./]" },
      },
    };

    if (channel) {
      match.channelId = channel.id;
    }

    try {
      // Get random message using aggregation
      const messages = await messagesCollection
        .aggregate([
          { $match: match },
          {
            $addFields: {
              contentLength: { $strLenCP: "$content" },
            },
          },
          {
            $match: {
              contentLength: { $gte: minLength },
            },
          },
          { $sample: { size: 1 } },
        ])
        .toArray();

      if (messages.length === 0) {
        await interaction.editReply({
          content:
            "No suitable messages found in the specified time period. Try adjusting your parameters!",
        });
        return;
      }

      const message = messages[0];
      const correctUserId = message.author.id;
      const correctUsername = message.author.username;

      // Create message link
      const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

      // Get 7 other random users from the same time period as decoys
      const decoyUsers = await messagesCollection
        .aggregate([
          {
            $match: {
              ...match,
              guildId: interaction.guildId,
              "author.id": { $ne: correctUserId, $nin: [invokerId] },
            },
          },
          {
            $group: {
              _id: "$author.id",
              username: { $first: "$author.username" },
              avatar: { $first: "$author.defaultAvatarURL" },
            },
          },
          { $sample: { size: 7 } },
        ])
        .toArray();

      if (decoyUsers.length < 7) {
        await interaction.editReply({
          content:
            "Not enough active users found for a proper game. Try a longer time period!",
        });
        return;
      }

      // Fetch guild members to get display names
      const allUserIds = [correctUserId, ...decoyUsers.map((u) => u._id)];
      const memberPromises = allUserIds.map(async (userId) => {
        try {
          const member = await interaction.guild.members.fetch(userId);
          return { userId, displayName: member.displayName };
        } catch {
          const user =
            userId === correctUserId
              ? { username: correctUsername }
              : decoyUsers.find((u) => u._id === userId);
          return { userId, displayName: user.username };
        }
      });

      const memberData = await Promise.all(memberPromises);
      const userDisplayNames = new Map(
        memberData.map((m) => [m.userId, m.displayName]),
      );

      // Create array of all options and shuffle
      const allOptions = [
        {
          userId: correctUserId,
          displayName: userDisplayNames.get(correctUserId),
          isCorrect: true,
        },
        ...decoyUsers.map((u) => ({
          userId: u._id,
          displayName: userDisplayNames.get(u._id),
          isCorrect: false,
        })),
      ];
      shuffleArray(allOptions);

      // Truncate message if too long
      let displayContent = message.content;
      if (displayContent.length > 500) {
        displayContent = displayContent.substring(0, 497) + "...";
      }

      // ─── Live Guess Feed State ────────────────────────────────────
      const guesses = new Map();
      const guessLog = []; // Public log of all guesses as they happen
      const eliminatedOptionIds = new Set(); // Track eliminated wrong choices

      // Build the embed with live guess feed
      const createEmbed = (timeRemaining, status = "active") => {
        const color =
          status === "correct"
            ? 0x57f287
            : status === "timeout"
              ? 0xed4245
              : 0x5865f2;
        const titleSuffix =
          status === "active" ? `⏱️ ${timeRemaining}s` : "⏱️ ENDED";

        const embed = new EmbedBuilder()
          .setTitle(`❓ Guess Who? ${titleSuffix}`)
          .setDescription(`**Guess who said this:**\n\n> ${displayContent}`)
          .setColor(color)
          .setFooter({
            text: `Message from ${new Date(message.createdTimestamp).toLocaleDateString()} • Time period: ${formatTimePeriod(years, months, days, "Last year (default)")}`,
          });

        if (channel) {
          embed.addFields({
            name: "Channel",
            value: channel.toString(),
            inline: true,
          });
        }

        // Live guess feed — the spectacle
        if (guessLog.length > 0) {
          const remaining = allOptions.filter(
            (o) => !eliminatedOptionIds.has(o.userId),
          ).length;
          embed.addFields({
            name: `📋 Guesses (${remaining} option${remaining !== 1 ? "s" : ""} remaining)`,
            value: guessLog.join("\n"),
          });
        }

        return embed;
      };

      // Build buttons across two rows (Discord max 5 per ActionRow)
      const createButtons = () => {
        const buttons = allOptions.map((option) => {
          const eliminated = eliminatedOptionIds.has(option.userId);
          return new ButtonBuilder()
            .setCustomId(`whosthat_${option.userId}_${option.isCorrect}`)
            .setLabel(
              eliminated ? `✕ ${option.displayName}` : option.displayName,
            )
            .setStyle(eliminated ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setDisabled(eliminated);
        });
        const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 4));
        const row2 = new ActionRowBuilder().addComponents(buttons.slice(4));
        return [row1, row2];
      };

      const response = await interaction.editReply({
        embeds: [createEmbed(60)],
        components: createButtons(),
      });

      // Timer update logic — update every 5s instead of 1s to reduce API spam
      const startTime = Date.now();
      const timeLimit = 60000;
      // eslint-disable-next-line prefer-const
      let timerInterval;

      const updateTimer = async () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 1000));

        if (remaining > 0) {
          try {
            await response.edit({
              embeds: [createEmbed(remaining)],
              components: createButtons(),
            });
          } catch {
            clearInterval(timerInterval);
          }
        }
      };

      // Update every 5 seconds to reduce rate limit pressure
      timerInterval = setInterval(updateTimer, 5000);

      // Create collector for button interactions
      const collector = response.createMessageComponentCollector({
        time: timeLimit,
      });

      collector.on("collect", async (i) => {
        // Check if user already guessed
        if (guesses.has(i.user.id)) {
          await i.reply({
            content: "You already made a guess!",
            ephemeral: true,
          });
          return;
        }

        const [, userId, isCorrectStr] = i.customId.split("_");
        const isCorrect = isCorrectStr === "true";

        // Calculate points change
        const pointsChange = isCorrect ? 1 : -2;

        // Update score in database
        const updatedDoc = await scoresCollection.findOneAndUpdate(
          {
            userId: i.user.id,
            guildId: interaction.guildId,
          },
          {
            $inc: { score: pointsChange },
            $set: {
              username: i.user.username,
              lastUpdated: new Date(),
            },
          },
          { upsert: true, returnDocument: "after" },
        );

        const currentScore = updatedDoc?.score ?? pointsChange;

        guesses.set(i.user.id, {
          guessedUserId: userId,
          isCorrect,
          guessedName: userDisplayNames.get(userId),
          pointsChange,
        });

        if (isCorrect) {
          // Add winning guess to the live feed
          guessLog.push(
            `${guessLog.length + 1}. <@${i.user.id}> guessed **${userDisplayNames.get(userId)}** ✅ (+1 → **${currentScore}** pts)`,
          );

          // Acknowledge the button press (required by Discord)
          await i.deferUpdate();
          collector.stop("correct_answer");
        } else {
          // Eliminate the wrong option
          eliminatedOptionIds.add(userId);

          // Add wrong guess to the live feed — PUBLIC, not ephemeral!
          const roast =
            WRONG_GUESS_ROASTS[
              Math.floor(Math.random() * WRONG_GUESS_ROASTS.length)
            ];
          guessLog.push(
            `${guessLog.length + 1}. <@${i.user.id}> guessed ~~${userDisplayNames.get(userId)}~~ ❌ (-2 → **${currentScore}** pts)\n-# *${roast}*`,
          );

          // Check if only the correct answer remains (process of elimination)
          const remainingOptions = allOptions.filter(
            (o) => !eliminatedOptionIds.has(o.userId),
          );
          if (remainingOptions.length === 1) {
            await i.deferUpdate();
            collector.stop("all_eliminated");
            return;
          }

          // Update embed with new guess log and eliminated buttons
          await i.update({
            embeds: [
              createEmbed(
                Math.max(
                  0,
                  Math.ceil((timeLimit - (Date.now() - startTime)) / 1000),
                ),
              ),
            ],
            components: createButtons(),
          });
        }
      });

      collector.on("end", async (collected, reason) => {
        // Clear timer interval
        clearInterval(timerInterval);

        // Disable all buttons and highlight correct answer
        const disabledButtons = allOptions.map((option) => {
          const button = new ButtonBuilder()
            .setCustomId(
              `whosthat_${option.userId}_${option.isCorrect}_disabled`,
            )
            .setLabel(option.displayName)
            .setDisabled(true);

          if (option.isCorrect) {
            button.setStyle(ButtonStyle.Success);
          } else {
            button.setStyle(ButtonStyle.Secondary);
          }

          return button;
        });
        const disabledRow1 = new ActionRowBuilder().addComponents(
          disabledButtons.slice(0, 4),
        );
        const disabledRow2 = new ActionRowBuilder().addComponents(
          disabledButtons.slice(4),
        );

        // Fetch current scores for all players who participated
        const playerIds = Array.from(guesses.keys());
        const scores = await scoresCollection
          .find({
            userId: { $in: playerIds },
            guildId: interaction.guildId,
          })
          .toArray();

        const scoreMap = new Map(scores.map((s) => [s.userId, s.score]));

        // Determine final status
        const wasGuessed =
          reason === "correct_answer" || reason === "all_eliminated";
        const finalStatus = wasGuessed ? "correct" : "timeout";

        // Create final embed
        const finalEmbed = createEmbed(0, finalStatus);

        // Clear default fields and rebuild for final state
        finalEmbed.spliceFields(0, finalEmbed.data.fields?.length || 0);

        if (channel) {
          finalEmbed.addFields({
            name: "📎 Message Link",
            value: messageLink,
            inline: true,
          });
        }

        // Show the full guess log in the final embed
        if (guessLog.length > 0) {
          finalEmbed.addFields({
            name: "📋 Guess Log",
            value: guessLog.join("\n"),
          });
        }

        // Correct/incorrect summary
        const correctGuesses = [];
        const incorrectGuesses = [];

        for (const [usrId, data] of guesses.entries()) {
          const currentScore = scoreMap.get(usrId) || 0;
          const pointsDisplay =
            data.pointsChange > 0 ? `+${data.pointsChange}` : data.pointsChange;

          if (data.isCorrect) {
            correctGuesses.push(
              `<@${usrId}> (${pointsDisplay} → **${currentScore}** points)`,
            );
          } else {
            incorrectGuesses.push(
              `<@${usrId}> guessed ${data.guessedName} (${pointsDisplay} → **${currentScore}** points)`,
            );
          }
        }

        if (wasGuessed) {
          if (reason === "all_eliminated") {
            finalEmbed.addFields({
              name: "🎯 Process of Elimination!",
              value: `All wrong answers eliminated — it was **${userDisplayNames.get(correctUserId)}**!`,
            });
          } else if (correctGuesses.length > 0) {
            finalEmbed.addFields({
              name: "🎉 Winner(s)",
              value: correctGuesses.join("\n"),
            });
          }
        } else {
          finalEmbed.addFields({
            name: "⏱️ Time's Up!",
            value: `The correct answer was **${userDisplayNames.get(correctUserId)}**`,
          });
        }

        await response.edit({
          embeds: [finalEmbed],
          components: [disabledRow1, disabledRow2],
        });
      });
    } catch (error) {
      console.error("Error in guesswho command:", error);
      await interaction.editReply({
        content:
          "An error occurred while fetching a message. Please try again later.",
      });
    }
  },
};
