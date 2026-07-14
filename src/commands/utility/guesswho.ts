import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Collection,
} from "discord.js";
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  SlashCommandIntegerOption,
  MessageComponentInteraction,
} from "discord.js";
import type { Document } from "mongodb";
import {
  getMongoDb,
  addTimePeriodOptions,
  resolvePeriod,
  shuffleArray,
} from "./commandUtils.ts";
import { WRONG_GUESS_ROASTS } from "../../constants/GuessWhoConstants.ts";
import { EXCLUDE_SOFT_DELETED } from "#root/constants.js";

interface GuessOption {
  userId: string;
  displayName: string;
  isCorrect: boolean;
}

interface GuessData {
  guessedUserId: string;
  isCorrect: boolean;
  guessedName: string;
  pointsChange: number;
}

export default {
  data: addTimePeriodOptions(
    new SlashCommandBuilder()
      .setName("guesswho")
      .setDescription("Guess the user from an anonymous message quote"),
  ).addIntegerOption((option: SlashCommandIntegerOption) =>
    option
      .setName("min_length")
      .setDescription("Minimum message length (default: 20)")
      .setRequired(false)
      .setMinValue(5)
      .setMaxValue(500),
  ),

  guildOnly: true,

  async execute(interaction: ChatInputCommandInteraction) {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");
    const scoresCollection = db.collection("GuessWhoGameScore");

    await interaction.deferReply();

    // Get time parameters
    const channel =
      interaction.options.getChannel("channel") || interaction.channel;
    const minLength = interaction.options.getInteger("min_length") || 20;

    const { unixStartDate, label: periodLabel } = resolvePeriod(interaction);

    const invokerId = interaction.user.id;

    const match: Record<string, unknown> = {
      ...EXCLUDE_SOFT_DELETED,
      createdTimestamp: { $gte: unixStartDate },
      guildId: interaction.guildId,
      "author.bot": { $ne: true },
      "author.id": { $ne: invokerId },
      content: {
        $exists: true,
        $ne: "",
        $not: { $regex: "^[!./]" },
      },
      $expr: {
        $gte: [{ $strLenCP: "$content" }, minLength],
      },
    };

    if (channel) {
      match.channelId = channel.id;
    }

    let chosenMessage: Document | null = null;
    const nowTimestamp = Date.now();
    const maximumAttempts = 15;

    // Try to find a message using the fast random timestamp method
    for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex++) {
      const randomTimestamp =
        unixStartDate +
        Math.floor(Math.random() * (nowTimestamp - unixStartDate));

      // Query a batch of messages after the random timestamp
      let messageBatch = await messagesCollection
        .find({
          ...EXCLUDE_SOFT_DELETED,
          guildId: interaction.guildId,
          ...(channel ? { channelId: channel.id } : {}),
          createdTimestamp: { $gte: randomTimestamp },
        })
        .sort({ createdTimestamp: 1 })
        .limit(100)
        .toArray();

      // If batch is empty, try looking before the random timestamp
      if (messageBatch.length === 0) {
        messageBatch = await messagesCollection
          .find({
            ...EXCLUDE_SOFT_DELETED,
            guildId: interaction.guildId,
            ...(channel ? { channelId: channel.id } : {}),
            createdTimestamp: { $lte: randomTimestamp, $gte: unixStartDate },
          })
          .sort({ createdTimestamp: -1 })
          .limit(100)
          .toArray();
      }

      // Filter the batch in-memory for our game requirements
      const validMessages = messageBatch.filter((messageDocument: Document) => {
        if (messageDocument.author?.bot === true) return false;
        if (messageDocument.author?.id === invokerId) return false;
        if (!messageDocument.content || messageDocument.content === "")
          return false;
        if (/^[!./]/.test(messageDocument.content)) return false;
        if (messageDocument.content.length < minLength) return false;
        return true;
      });

      if (validMessages.length > 0) {
        // Pick a random message from the valid messages in this batch
        const randomIndex = Math.floor(Math.random() * validMessages.length);
        chosenMessage = validMessages[randomIndex];
        break;
      }
    }

    // Fallback to slow aggregation only if the extremely fast method yields nothing
    if (!chosenMessage) {
      const fallbackMessages = await messagesCollection
        .aggregate([{ $match: match }, { $sample: { size: 1 } }])
        .toArray();
      if (fallbackMessages.length > 0) {
        chosenMessage = fallbackMessages[0];
      }
    }

    if (!chosenMessage) {
      await interaction.editReply({
        content:
          "No suitable messages found in the specified time period. Try adjusting your parameters!",
      });
      return;
    }

    const message = chosenMessage;
    const correctUserId = message.author.id;
    const correctUsername = message.author.username;

    // Create message link
    const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

    // Get 7 other random users from the same time period as decoys
    const uniqueDecoys = new Map<
      string,
      { _id: string; username: string; defaultAvatarURL: string }
    >();

    // Try to find decoy users using fast random timestamp queries
    for (
      let attemptIndex = 0;
      attemptIndex < maximumAttempts && uniqueDecoys.size < 7;
      attemptIndex++
    ) {
      const randomTimestamp =
        unixStartDate +
        Math.floor(Math.random() * (nowTimestamp - unixStartDate));

      let decoyMessageBatch = await messagesCollection
        .find({
          guildId: interaction.guildId,
          ...(channel ? { channelId: channel.id } : {}),
          createdTimestamp: { $gte: randomTimestamp },
        })
        .sort({ createdTimestamp: 1 })
        .limit(100)
        .toArray();

      if (decoyMessageBatch.length === 0) {
        decoyMessageBatch = await messagesCollection
          .find({
            guildId: interaction.guildId,
            ...(channel ? { channelId: channel.id } : {}),
            createdTimestamp: { $lte: randomTimestamp, $gte: unixStartDate },
          })
          .sort({ createdTimestamp: -1 })
          .limit(100)
          .toArray();
      }

      for (const messageDocument of decoyMessageBatch) {
        const author = messageDocument.author;
        if (!author || author.bot === true) continue;

        const authorId = String(author.id);
        if (authorId === correctUserId || authorId === invokerId) continue;

        uniqueDecoys.set(authorId, {
          _id: authorId,
          username: author.username,
          defaultAvatarURL: author.defaultAvatarURL || author.avatar || "",
        });

        if (uniqueDecoys.size === 7) {
          break;
        }
      }
    }

    // If we still don't have 7 decoys, fetch from recent messages in the guild (very fast index scan)
    if (uniqueDecoys.size < 7) {
      const recentMessages = await messagesCollection
        .find({
          guildId: interaction.guildId,
        })
        .sort({ createdTimestamp: -1 })
        .limit(200)
        .toArray();

      for (const messageDocument of recentMessages) {
        const author = messageDocument.author;
        if (!author || author.bot === true) continue;

        const authorId = String(author.id);
        if (authorId === correctUserId || authorId === invokerId) continue;

        uniqueDecoys.set(authorId, {
          _id: authorId,
          username: author.username,
          defaultAvatarURL: author.defaultAvatarURL || author.avatar || "",
        });

        if (uniqueDecoys.size === 7) {
          break;
        }
      }
    }

    const decoyUsers = Array.from(uniqueDecoys.values());

    if (decoyUsers.length < 7) {
      await interaction.editReply({
        content:
          "Not enough active users found for a proper game. Try a longer time period!",
      });
      return;
    }

    // Fetch guild members to get display names
    const allUserIds = [
      correctUserId,
      ...decoyUsers.map((u: Document) => String(u._id)),
    ];
    const memberPromises = allUserIds.map(async (userId: string) => {
      try {
        const member = await interaction.guild!.members.fetch(userId);
        return { userId, displayName: member.displayName };
      } catch {
        const user =
          userId === correctUserId
            ? { username: correctUsername }
            : decoyUsers.find((u: Record<string, unknown>) => u._id === userId);
        return {
          userId,
          displayName:
            (user as Record<string, string> | undefined)?.username ?? userId,
        };
      }
    });

    const memberData = await Promise.all(memberPromises);
    const userDisplayNames = new Map(
      memberData.map((m: { userId: string; displayName: string }) => [
        m.userId,
        m.displayName,
      ]),
    );

    // Create array of all options and shuffle
    const allOptions: GuessOption[] = [
      {
        userId: correctUserId,
        displayName: userDisplayNames.get(correctUserId) ?? "Unknown",
        isCorrect: true,
      },
      ...decoyUsers.map((u: Document) => ({
        userId: String(u._id),
        displayName: userDisplayNames.get(String(u._id)) ?? "",
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
    const guesses = new Map<string, GuessData>();
    const guessLog: string[] = []; // Public log of all guesses as they happen
    const eliminatedOptionIds = new Set<string>(); // Track eliminated wrong choices

    // Build the embed with live guess feed
    const createEmbed = (
      timeRemaining: number,
      status: "active" | "correct" | "timeout" = "active",
    ) => {
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
          text: `Message from ${new Date(message.createdTimestamp).toLocaleDateString()} • Time period: ${periodLabel}`,
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
          (o: GuessOption) => !eliminatedOptionIds.has(o.userId),
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
      const buttons = allOptions.map((option: GuessOption) => {
        const eliminated = eliminatedOptionIds.has(option.userId);
        return new ButtonBuilder()
          .setCustomId(`whosthat_${option.userId}_${option.isCorrect}`)
          .setLabel(eliminated ? `✕ ${option.displayName}` : option.displayName)
          .setStyle(eliminated ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(eliminated);
      });
      const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(0, 4),
      );
      const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(4),
      );
      return [row1, row2];
    };

    const response = await interaction.editReply({
      embeds: [createEmbed(60)],
      components: createButtons(),
    });

    // Timer update logic — update every 5s instead of 1s to reduce API spam
    const startTime = Date.now();
    const timeLimit = 60000;
    const timerState: { interval: ReturnType<typeof setInterval> | null } = {
      interval: null,
    };

    const updateTimer = async () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 1000));

      if (remaining > 0) {
        try {
          await response.edit({
            embeds: [createEmbed(remaining)],
            components: createButtons(),
          });
        } catch (error: unknown) {
          // 50027 = token expired, stop polling entirely
          if ((error as { code?: number }).code === 50027) {
            if (timerState.interval) clearInterval(timerState.interval);
          }
        }
      }
    };

    // Update every 5 seconds to reduce rate limit pressure
    timerState.interval = setInterval(updateTimer, 5000);

    // Create collector for button interactions
    const collector = response.createMessageComponentCollector({
      time: timeLimit,
    });

    collector.on("collect", async (i: ButtonInteraction) => {
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
        guessedName: userDisplayNames.get(userId) ?? "Unknown",
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
          (o: GuessOption) => !eliminatedOptionIds.has(o.userId),
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

    collector.on(
      "end",
      async (
        _collected: Collection<string, MessageComponentInteraction>,
        reason: string,
      ) => {
        // Clear timer interval
        if (timerState.interval) clearInterval(timerState.interval);

        // Disable all buttons and highlight correct answer
        const disabledButtons = allOptions.map((option: GuessOption) => {
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
        const disabledRow1 =
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            disabledButtons.slice(0, 4),
          );
        const disabledRow2 =
          new ActionRowBuilder<ButtonBuilder>().addComponents(
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

        const scoreMap = new Map<string, number>(
          scores.map((s: Document) => [String(s.userId), s.score as number]),
        );

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
        const correctGuesses: string[] = [];
        const incorrectGuesses: string[] = [];

        for (const [usrId, data] of guesses.entries() as IterableIterator<
          [string, GuessData]
        >) {
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

        try {
          await response.edit({
            embeds: [finalEmbed],
            components: [disabledRow1, disabledRow2],
          });
        } catch (editError: unknown) {
          // Token expired (50027) — fall back to a regular channel message
          console.error(
            "Failed to edit guesswho final embed (token likely expired):",
            (editError as { code?: number }).code,
          );
          try {
            if (interaction.channel && "send" in interaction.channel) {
              await interaction.channel.send({
                embeds: [finalEmbed],
                components: [disabledRow1, disabledRow2],
              });
            }
          } catch {
            /* channel send also failed, nothing we can do */
          }
        }
      },
    );
  },
};
