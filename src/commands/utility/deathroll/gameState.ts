/**
 * In-memory game lifecycle state for deathroll: the activeGames /
 * activeCollectors maps, state-transition helpers, the button collectors,
 * and the win/loss handlers. Every state change is mirrored to Mongo via
 * persistence.ts so a restart can reconcile interrupted games.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildMember,
  Message,
  TextChannel,
} from "discord.js";
import { tryTimeoutMember } from "../commandUtils.ts";
import {
  BASE_TIMEOUT,
  BASE_TIMEOUT_MINUTES,
  getMultiplierName,
} from "./mmr.ts";
import {
  buildEndGameData,
  fetchHeadToHead,
  fetchMidGameStats,
  saveGameResult,
} from "./repository.ts";
import {
  buildDoubleOrNothingAgreeRow,
  buildDoubleOrNothingRow,
  buildEngageDeclineRow,
  buildRollRow,
  formatGameMessage,
} from "./render.ts";
import { deleteGameSnapshot, persistGameSnapshot } from "./persistence.ts";
import type {
  GameState,
  PendingGameData,
  PendingTimeoutData,
} from "./types.ts";

/** How long the Double-or-Nothing offer can idle before expiring. */
const DON_IDLE_TIMEOUT = 10 * 1000;
/**
 * Hard cap on the DoN offer window: bystander clicks reset the idle timer,
 * so without this cap the loser's timeout could be postponed forever.
 */
const DON_MAX_LIFETIME = 60 * 1000;

// ─── Active Game State ────────────────────────────────────────────────

// Store active games (gameId -> game state)
const activeGames = new Map<string, GameState>();
// Store active collectors (only .stop is ever called on them; the exact
// InteractionCollector generic varies with the message's cache type)
const activeCollectors = new Map<string, { stop(reason?: string): void }>();

export function getGame(gameId: string) {
  return activeGames.get(gameId);
}

/**
 * Registers a new game in memory and snapshots it for crash recovery.
 */
export function createGame(
  gameId: string,
  guildId: string,
  game: GameState,
  phase: "pending" | "active",
) {
  activeGames.set(gameId, game);
  persistGameSnapshot(gameId, guildId, game, phase);
}

/**
 * Stops (and forgets) the collector for a game, if one is active.
 * "manually stopped" tells the end-handler not to run its timeout logic.
 */
export function stopCollector(gameId: string) {
  const collector = activeCollectors.get(gameId);
  if (collector) {
    collector.stop("manually stopped");
    activeCollectors.delete(gameId);
  }
}

/**
 * Rolls 0..currentNumber and records it in the game's roll history.
 */
function rollAndRecord(
  game: GameState,
  userId: string,
  username: string | null | undefined,
): number {
  const roll = Math.floor(Math.random() * (game.currentNumber + 1));
  game.rolls.push({
    userId,
    username,
    roll,
    maxNumber: game.currentNumber,
  });
  return roll;
}

/**
 * Advances the game to the next player's turn after a non-zero roll.
 */
function advanceTurn(game: GameState, roll: number, nextPlayerId: string) {
  game.currentNumber = roll;
  game.currentTurn = nextPlayerId;
}

// ─── Double or Nothing ────────────────────────────────────────────────

export function createDoubleOrNothingCollector(
  message: Message,
  guild: Guild,
  gameId: string,
  winnerId: string,
  loserId: string,
  startingNumber: number,
  timeoutMultiplier: number,
  pendingTimeoutData: PendingTimeoutData | null,
  pendingGameData: PendingGameData | null,
) {
  const collector = message.createMessageComponentCollector({
    idle: DON_IDLE_TIMEOUT,
    time: DON_MAX_LIFETIME,
  });

  const agreed = new Set<string>();
  let countdown = 10;
  const baseContent = message.content;
  const nextMultiplier = (timeoutMultiplier || 1) * 2;
  const multiplierName = getMultiplierName(nextMultiplier);

  const countdownInterval = setInterval(async () => {
    countdown--;
    if (countdown > 0) {
      const agreeLine =
        agreed.size > 0
          ? `\n-# ${[...agreed].map((id: string) => `<@${id}>`).join(", ")} agreed — waiting for the other player...`
          : "";
      await message
        .edit({
          content:
            baseContent +
            `\n-# ⏱️ **${countdown}** second${countdown !== 1 ? "s" : ""} remaining — both players must agree...${agreeLine}`,
        })
        .catch(() => {});
    } else {
      clearInterval(countdownInterval);
    }
  }, 1000);

  collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
    try {
      const userId = buttonInteraction.user.id;

      if (!buttonInteraction.customId.startsWith("deathroll_don_agree_"))
        return;

      if (userId !== winnerId && userId !== loserId) {
        return buttonInteraction.reply({
          content: "🎲 Only the two players can agree to Double or Nothing!",
          ephemeral: true,
        });
      }

      if (agreed.has(userId)) {
        return buttonInteraction.reply({
          content: "🎲 You already agreed! Waiting for the other player.",
          ephemeral: true,
        });
      }

      agreed.add(userId);

      // If only one player has agreed, update the message and wait
      if (agreed.size < 2) {
        const otherId = userId === winnerId ? loserId : winnerId;
        await buttonInteraction.update({
          content:
            baseContent +
            `\n\n🎰 <@${userId}> wants **${multiplierName} or Nothing**! <@${otherId}>, click the button to agree.`,
        });
        return;
      }

      // Both players agreed — start DoN!
      clearInterval(countdownInterval);
      collector.stop("manually stopped");

      const challengerMember = await guild.members
        .fetch(loserId)
        .catch(() => null);
      const opponentMember = await guild.members
        .fetch(winnerId)
        .catch(() => null);

      if (!challengerMember?.moderatable || !opponentMember?.moderatable) {
        await buttonInteraction.update({ components: [] });
        return buttonInteraction.followUp({
          content: "🎲 One of the players can't be timed out anymore!",
          ephemeral: true,
        });
      }

      await removePendingTimeout(guild, loserId);

      // The previous game's outcome is voided — DoN supersedes it.
      deleteGameSnapshot(gameId);

      const h2h = await fetchHeadToHead(guild.id, loserId, winnerId);

      const newGameId = `${buttonInteraction.channelId}_${buttonInteraction.id}`;
      const now = Date.now();

      const newGame: GameState = {
        initiator: loserId,
        initiatorName: challengerMember.user.username,
        opponent: winnerId,
        opponentName: opponentMember.user.username,
        targetUserId: winnerId,
        currentNumber: startingNumber,
        currentTurn: winnerId,
        messageId: buttonInteraction.message.id,
        channelId: buttonInteraction.channelId,
        startingNumber: startingNumber,
        rolls: [],
        startedAt: now,
        currentMessageId: null,
        timeoutMultiplier: nextMultiplier,
        h2h: h2h,
      };
      activeGames.set(newGameId, newGame);

      const roll = rollAndRecord(
        newGame,
        winnerId,
        opponentMember.user.username,
      );

      await buttonInteraction.update({
        content:
          baseContent +
          `\n\n✅ Both players agreed to **${multiplierName} or Nothing**! 🎰`,
        components: [],
      });

      if (roll === 0) {
        const game = activeGames.get(newGameId);
        if (!game) return;
        const endGameData = await buildEndGameData(
          guild.id,
          game,
          loserId,
          winnerId,
        );
        const gameOverMsg = await buttonInteraction.followUp({
          content: formatGameMessage(
            game,
            roll,
            opponentMember.user.username,
            winnerId,
            true,
            endGameData,
          ),
          components: buildDoubleOrNothingRow(game, loserId, winnerId),
        });
        await handleLoss(
          buttonInteraction,
          game,
          newGameId,
          winnerId,
          roll,
          gameOverMsg,
        );
        activeGames.delete(newGameId);
        return;
      }

      const game = activeGames.get(newGameId);
      if (!game) return;
      advanceTurn(game, roll, loserId);
      persistGameSnapshot(newGameId, guild.id, game, "active");

      const midGameStats = await fetchMidGameStats(guild.id, loserId, winnerId);

      const newMessage = await buttonInteraction.followUp({
        content: formatGameMessage(
          game,
          roll,
          opponentMember.user.username,
          winnerId,
          false,
          midGameStats,
        ),
        components: buildRollRow(newGameId, roll),
      });

      game.currentMessageId = newMessage.id;
      persistGameSnapshot(newGameId, guild.id, game, "active");
      createRollCollector(newMessage, newGameId, guild);
    } catch (error: unknown) {
      console.error("Error in Double or Nothing agreement collector:", error);
      try {
        const channel = buttonInteraction.channel as TextChannel | null;
        if (channel) {
          const recoveryMultiplierName = getMultiplierName(nextMultiplier);
          const recoveryMsg = await channel.send({
            content: `⚠️ Something went wrong! <@${winnerId}> / <@${loserId}>, click below to agree to ${recoveryMultiplierName} or Nothing.`,
            components: buildDoubleOrNothingAgreeRow(
              winnerId,
              loserId,
              startingNumber,
              nextMultiplier,
            ),
          });
          createDoubleOrNothingCollector(
            recoveryMsg,
            guild,
            gameId,
            winnerId,
            loserId,
            startingNumber,
            timeoutMultiplier,
            pendingTimeoutData,
            pendingGameData,
          );
        }
      } catch (recoveryError: unknown) {
        console.error(
          "Failed to recover from DoN agreement error:",
          recoveryError,
        );
      }
    }
  });

  collector.on(
    "end",
    async (
      collected: Collection<string, ButtonInteraction>,
      reason: string,
    ) => {
      clearInterval(countdownInterval);
      if (reason !== "manually stopped") {
        const timeoutMinutes =
          (pendingTimeoutData?.timeoutDuration || BASE_TIMEOUT) / 60000;
        await message
          .edit({
            content:
              baseContent +
              `\n-# ⏱️ Time's up! <@${loserId}> has been timed out for ${timeoutMinutes} minutes.`,
            components: [],
          })
          .catch(() => {});
        if (pendingTimeoutData) {
          await applyPendingTimeout(guild, pendingTimeoutData);
        }
        // DoN not agreed — save the final game result now
        if (pendingGameData) {
          await saveGameResult(
            guild.id,
            pendingGameData.game,
            pendingGameData.winnerId,
            pendingGameData.loserId,
            pendingGameData.winnerInfo,
            pendingGameData.loserInfo,
            null,
          );
        }
        // Result saved and timeout applied — the game is fully resolved.
        deleteGameSnapshot(gameId);
      }
    },
  );
}

async function applyPendingTimeout(
  guild: Guild,
  pendingTimeoutData: PendingTimeoutData,
) {
  if (!pendingTimeoutData) return;
  const { loserId, timeoutDuration } = pendingTimeoutData;
  try {
    const loser = await guild.members.fetch(loserId).catch(() => null);
    if (loser) {
      const timeoutMinutes = timeoutDuration / 60000;
      const result = await tryTimeoutMember(
        loser,
        timeoutDuration,
        `Lost a deathroll game (${timeoutMinutes}min) — Double or Nothing expired`,
      );
      if (!result.ok) {
        console.warn(
          `[deathroll] Could not apply pending timeout to ${loserId}: ${result.error}`,
        );
      }
    }
  } catch (error: unknown) {
    console.error("Error applying pending timeout:", error);
  }
}

async function removePendingTimeout(guild: Guild, userId: string) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.communicationDisabledUntil) {
      await member.timeout(
        null,
        "Double or Nothing accepted — timeout cancelled",
      );
    }
  } catch (error: unknown) {
    console.error("Error removing pending timeout:", error);
  }
}

// ─── Collectors ───────────────────────────────────────────────────────

export function createRollCollector(
  message: Message,
  gameId: string,
  guild: Guild,
) {
  const collector = message.createMessageComponentCollector({
    idle: 5 * 60 * 1000,
  });

  activeCollectors.set(gameId, collector);

  collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
    try {
      await handleRollButton(buttonInteraction, gameId);
    } catch (error: unknown) {
      console.error("Error in roll collector:", error);
      try {
        const game = activeGames.get(gameId);
        if (!game) return;

        const channel = buttonInteraction.channel as TextChannel | null;
        if (channel) {
          const lastRoll =
            game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;
          const rollWasGenerated =
            lastRoll && lastRoll.userId === buttonInteraction.user.id;

          if (!rollWasGenerated) {
            // Error before roll — re-post the existing roll button
            const newMessage = await channel.send({
              content: `⚠️ Something went wrong! <@${game.currentTurn}>, click below to roll again.`,
              components: buildRollRow(gameId, game.currentNumber),
            });
            game.currentMessageId = newMessage.id;
            persistGameSnapshot(gameId, guild.id, game, "active");
            createRollCollector(newMessage, gameId, guild);
          } else if (lastRoll.roll === 0) {
            // Roll was 0 (game over) but display failed — recover via channel
            const winnerId =
              lastRoll.userId === game.initiator
                ? (game.opponent as string)
                : game.initiator;
            const endGameData = await buildEndGameData(
              guild.id,
              game,
              winnerId,
              lastRoll.userId,
            );
            const gameOverMsg = await channel.send({
              content: formatGameMessage(
                game,
                lastRoll.roll,
                lastRoll.username,
                lastRoll.userId,
                true,
                endGameData,
              ),
              components: buildDoubleOrNothingRow(
                game,
                winnerId,
                lastRoll.userId,
              ),
            });
            await handleLoss(
              buttonInteraction,
              game,
              gameId,
              lastRoll.userId,
              lastRoll.roll,
              gameOverMsg,
            );
            activeGames.delete(gameId);
            activeCollectors.delete(gameId);
          } else {
            // Roll was generated but display failed — update state and re-post
            advanceTurn(
              game,
              lastRoll.roll,
              lastRoll.userId === game.initiator
                ? (game.opponent as string)
                : game.initiator,
            );

            const midGameStats = await fetchMidGameStats(
              guild.id,
              game.initiator,
              game.opponent as string,
            );
            const newMessage = await channel.send({
              content: formatGameMessage(
                game,
                lastRoll.roll,
                lastRoll.username,
                lastRoll.userId,
                false,
                midGameStats,
              ),
              components: buildRollRow(gameId, lastRoll.roll),
            });
            game.currentMessageId = newMessage.id;
            persistGameSnapshot(gameId, guild.id, game, "active");
            createRollCollector(newMessage, gameId, guild);
          }
        }
      } catch (recoveryError: unknown) {
        console.error("Failed to recover from roll error:", recoveryError);
      }
    }
  });

  collector.on(
    "end",
    async (
      collected: Collection<string, ButtonInteraction>,
      reason: string,
    ) => {
      if (reason !== "manually stopped" && activeGames.has(gameId)) {
        const game = activeGames.get(gameId);

        if (!game) return;

        if ((game.opponent as string) && game.currentTurn) {
          const loserId = game.currentTurn;
          const winnerId =
            loserId === game.initiator
              ? (game.opponent as string)
              : game.initiator;

          try {
            await handleTimeoutLoss(guild, game, winnerId, loserId);
            const timeoutMinutes =
              (game.timeoutMultiplier || 1) * BASE_TIMEOUT_MINUTES;
            await message
              .edit({
                content:
                  message.content +
                  `\n\n⏱️ Game timed out! <@${loserId}> took too long to roll.\n💀 <@${loserId}> loses and has been timed out for ${timeoutMinutes} minutes!\n🎉 <@${winnerId}> wins!`,
                components: [],
              })
              .catch(() => {});
          } catch (error: unknown) {
            console.error("Error handling timeout loss:", error);
            await message
              .edit({
                content:
                  message.content + "\n\n⏱️ Game timed out due to inactivity.",
                components: [],
              })
              .catch(() => {});
          }
        } else {
          await message
            .edit({
              content:
                message.content + "\n\n⏱️ Game timed out due to inactivity.",
              components: [],
            })
            .catch(() => {});
        }

        activeGames.delete(gameId);
        activeCollectors.delete(gameId);
        deleteGameSnapshot(gameId);
      }
    },
  );
}

/**
 * Creates the accept/decline collector for a freshly-posted challenge.
 * Moved out of executeDeathroll so lifecycle state stays in this module.
 */
export function createEngageCollector(
  reply: Message,
  gameId: string,
  interaction: ChatInputCommandInteraction,
) {
  const collector = reply.createMessageComponentCollector({
    idle: 5 * 60 * 1000,
  });
  activeCollectors.set(gameId, collector);

  collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
    try {
      if (buttonInteraction.customId.startsWith("deathroll_engage_")) {
        await handleEngageButton(buttonInteraction, gameId);
      } else if (buttonInteraction.customId.startsWith("deathroll_decline_")) {
        await handleDeclineButton(buttonInteraction, gameId);
      }
    } catch (error: unknown) {
      console.error("Error in deathroll engage/decline collector:", error);
      try {
        const game = activeGames.get(gameId);
        if (!game) return;

        const channel = buttonInteraction.channel as TextChannel | null;
        if (!channel) return;
        const lastRoll =
          game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;

        if ((game.opponent as string) && lastRoll) {
          // Engage happened, roll was generated but display failed — recover via channel
          if (lastRoll.roll === 0) {
            const winnerId = game.initiator;
            const endGameData = await buildEndGameData(
              buttonInteraction.guild!.id,
              game,
              winnerId,
              lastRoll.userId,
            );
            const gameOverMsg = await channel.send({
              content: formatGameMessage(
                game,
                lastRoll.roll,
                lastRoll.username,
                lastRoll.userId,
                true,
                endGameData,
              ),
              components: buildDoubleOrNothingRow(
                game,
                winnerId,
                lastRoll.userId,
              ),
            });
            await handleLoss(
              buttonInteraction,
              game,
              gameId,
              lastRoll.userId,
              lastRoll.roll,
              gameOverMsg,
            );
            activeGames.delete(gameId);
          } else {
            advanceTurn(game, lastRoll.roll, game.initiator);

            const midGameStats = await fetchMidGameStats(
              buttonInteraction.guild!.id,
              game.initiator,
              game.opponent as string,
            );
            const newMessage = await channel.send({
              content: formatGameMessage(
                game,
                lastRoll.roll,
                lastRoll.username,
                lastRoll.userId,
                false,
                midGameStats,
              ),
              components: buildRollRow(gameId, lastRoll.roll),
            });
            game.currentMessageId = newMessage.id;
            persistGameSnapshot(
              gameId,
              buttonInteraction.guild!.id,
              game,
              "active",
            );
            createRollCollector(newMessage, gameId, buttonInteraction.guild!);
          }
        } else {
          // Error before game started — re-post engage/decline buttons
          const buttonLabel = `Accept Deathroll (0-${game.startingNumber})`;
          const recoveryChannel = buttonInteraction.channel;
          if (!recoveryChannel || !("send" in recoveryChannel)) return;
          const recoveryMsg = await recoveryChannel.send({
            content: `⚠️ Something went wrong! Click below to accept or decline the deathroll challenge from <@${game.initiator}>.`,
            components: buildEngageDeclineRow(
              gameId.split("_")[1],
              buttonLabel,
            ),
          });
          game.currentMessageId = recoveryMsg.id;
          if (buttonInteraction.guild) {
            persistGameSnapshot(
              gameId,
              buttonInteraction.guild.id,
              game,
              "pending",
            );
          }
          const newCollector = recoveryMsg.createMessageComponentCollector({
            idle: 5 * 60 * 1000,
          });
          activeCollectors.set(gameId, newCollector);
          newCollector.on("collect", async (bi: ButtonInteraction) => {
            try {
              if (bi.customId.startsWith("deathroll_engage_")) {
                await handleEngageButton(bi, gameId);
              } else if (bi.customId.startsWith("deathroll_decline_")) {
                await handleDeclineButton(bi, gameId);
              }
            } catch (error: unknown) {
              console.error(
                "Error in recovery engage/decline collector:",
                error,
              );
            }
          });
          newCollector.on(
            "end",
            (
              _collected: Collection<string, ButtonInteraction>,
              reason: string,
            ) => {
              if (reason !== "manually stopped" && activeGames.has(gameId)) {
                const game = activeGames.get(gameId);
                if (!game) return;
                if (!game.opponent) {
                  recoveryMsg
                    .edit({
                      content: `🎲 <@${game.initiator}>'s deathroll expired - no one engaged!`,
                      components: [],
                    })
                    .catch(() => {});
                }
                activeGames.delete(gameId);
                activeCollectors.delete(gameId);
                deleteGameSnapshot(gameId);
              }
            },
          );
        }
      } catch (recoveryError: unknown) {
        console.error(
          "Failed to recover from engage/decline error:",
          recoveryError,
        );
      }
    }
  });

  collector.on(
    "end",
    (_collected: Collection<string, ButtonInteraction>, reason: string) => {
      if (reason !== "manually stopped") {
        if (activeGames.has(gameId)) {
          const game = activeGames.get(gameId);
          if (!game) return;
          if (!(game.opponent as string)) {
            interaction
              .editReply({
                content: `🎲 <@${game.initiator}>'s deathroll expired - no one engaged!`,
                components: [],
              })
              .catch(() => {});
          }
          activeGames.delete(gameId);
          deleteGameSnapshot(gameId);
        }
        activeCollectors.delete(gameId);
      }
    },
  );
}

// ─── Button Handlers ──────────────────────────────────────────────────

async function handleDeclineButton(
  buttonInteraction: ButtonInteraction,
  gameId: string,
) {
  const game = activeGames.get(gameId);
  if (!game) {
    return buttonInteraction.reply({
      content: "🎲 This game is no longer active!",
      ephemeral: true,
    });
  }

  const userId = buttonInteraction.user.id;

  if (game.targetUserId && userId !== game.targetUserId) {
    return buttonInteraction.reply({
      content: "🎲 This challenge is not for you!",
      ephemeral: true,
    });
  }

  if (game.opponent as string) {
    return buttonInteraction.reply({
      content: "🎲 This game is already in progress!",
      ephemeral: true,
    });
  }

  stopCollector(gameId);

  await buttonInteraction.update({
    content: `🎲 <@${game.initiator}>'s deathroll from **${game.startingNumber}** was denied by <@${buttonInteraction.user.id}>!`,
    components: [],
  });

  activeGames.delete(gameId);
  deleteGameSnapshot(gameId);
}

async function handleEngageButton(
  buttonInteraction: ButtonInteraction,
  gameId: string,
) {
  const game = activeGames.get(gameId);
  if (!game) {
    return buttonInteraction.reply({
      content: "🎲 This game is no longer active!",
      ephemeral: true,
    });
  }

  const userId = buttonInteraction.user.id;

  if (userId === game.initiator) {
    return buttonInteraction.reply({
      content: "🎲 You can't play against yourself!",
      ephemeral: true,
    });
  }

  if (game.targetUserId && userId !== game.targetUserId) {
    return buttonInteraction.reply({
      content: "🎲 This challenge is not for you!",
      ephemeral: true,
    });
  }

  if (game.opponent as string) {
    return buttonInteraction.reply({
      content: "🎲 This game is already in progress!",
      ephemeral: true,
    });
  }

  const guild = buttonInteraction.guild!;
  const initiatorMember = await guild.members
    .fetch(game.initiator)
    .catch(() => null);

  if (!initiatorMember) {
    await buttonInteraction.update({
      content: `🎲 <@${game.initiator}>'s deathroll has ended - they left the server!`,
      components: [],
    });
    activeGames.delete(gameId);
    deleteGameSnapshot(gameId);
    return;
  }

  const opponentMember = buttonInteraction.member as GuildMember;

  if (!opponentMember) return;

  if (!initiatorMember.moderatable) {
    return buttonInteraction.reply({
      content: `🎲 The game initiator can't be timed out (they have higher permissions)!`,
    });
  }

  if (!opponentMember.moderatable) {
    return buttonInteraction.reply({
      content: `🎲 You can't deathroll (you have higher permissions)!`,
    });
  }

  stopCollector(gameId);

  game.opponent = userId;
  game.opponentName = buttonInteraction.user.username;
  game.currentTurn = userId;

  const h2h = await fetchHeadToHead(guild.id, game.initiator, userId);
  game.h2h = h2h;

  const roll = rollAndRecord(game, userId, buttonInteraction.user.username);

  await buttonInteraction.deferUpdate();
  await buttonInteraction.message.delete().catch(() => {});

  if (roll === 0) {
    const winnerId = game.initiator;
    const endGameData = await buildEndGameData(
      guild.id,
      game,
      winnerId,
      userId,
    );
    const gameOverMsg = await buttonInteraction.followUp({
      content: formatGameMessage(
        game,
        roll,
        buttonInteraction.user.username,
        userId,
        true,
        endGameData,
      ),
      components: buildDoubleOrNothingRow(game, winnerId, userId),
    });
    await handleLoss(
      buttonInteraction,
      game,
      gameId,
      userId,
      roll,
      gameOverMsg,
    );
    activeGames.delete(gameId);
    return;
  }

  advanceTurn(game, roll, game.initiator);
  persistGameSnapshot(gameId, guild.id, game, "active");

  const midGameStats = await fetchMidGameStats(
    guild.id,
    game.initiator,
    game.opponent as string,
  );

  const newMessage = await buttonInteraction.followUp({
    content: formatGameMessage(
      game,
      roll,
      buttonInteraction.user.username,
      userId,
      false,
      midGameStats,
    ),
    components: buildRollRow(gameId, roll),
  });

  game.currentMessageId = newMessage.id;
  persistGameSnapshot(gameId, guild.id, game, "active");
  createRollCollector(newMessage, gameId, guild);
}

async function handleRollButton(
  buttonInteraction: ButtonInteraction,
  gameId: string,
) {
  const game = activeGames.get(gameId);
  if (!game) {
    return buttonInteraction.reply({
      content: "🎲 This game is no longer active!",
      ephemeral: true,
    });
  }

  const guild = buttonInteraction.guild!;
  const userId = buttonInteraction.user.id;

  if (userId !== game.currentTurn) {
    return buttonInteraction.reply({
      content: "🎲 It's not your turn!",
      ephemeral: true,
    });
  }

  stopCollector(gameId);

  const roll = rollAndRecord(game, userId, buttonInteraction.user.username);

  await buttonInteraction.update({ components: [] });

  const oldMessage = buttonInteraction.message;
  setTimeout(() => {
    oldMessage.delete().catch(() => {});
  }, 500);

  if (roll === 0) {
    const winnerId =
      userId === game.initiator ? (game.opponent as string) : game.initiator;
    const endGameData = await buildEndGameData(
      guild.id,
      game,
      winnerId,
      userId,
    );
    const gameOverMsg = await buttonInteraction.followUp({
      content: formatGameMessage(
        game,
        roll,
        buttonInteraction.user.username,
        userId,
        true,
        endGameData,
      ),
      components: buildDoubleOrNothingRow(game, winnerId, userId),
    });
    await handleLoss(
      buttonInteraction,
      game,
      gameId,
      userId,
      roll,
      gameOverMsg,
    );
    activeGames.delete(gameId);
    activeCollectors.delete(gameId);
    return;
  }

  const nextPlayer =
    userId === game.initiator ? (game.opponent as string) : game.initiator;
  advanceTurn(game, roll, nextPlayer);
  persistGameSnapshot(gameId, guild.id, game, "active");

  const midGameStats = await fetchMidGameStats(
    guild.id,
    game.initiator,
    game.opponent as string,
  );

  const newMessage = await buttonInteraction.followUp({
    content: formatGameMessage(
      game,
      roll,
      buttonInteraction.user.username,
      userId,
      false,
      midGameStats,
    ),
    components: buildRollRow(gameId, roll),
  });

  game.currentMessageId = newMessage.id;
  persistGameSnapshot(gameId, guild.id, game, "active");
  createRollCollector(newMessage, gameId, guild);
}

// ─── Game End Handlers ────────────────────────────────────────────────

async function handleLoss(
  buttonInteraction: ButtonInteraction,
  game: GameState,
  gameId: string,
  loserId: string,
  roll: number,
  gameOverMessage: Message | null,
) {
  const guild = buttonInteraction.guild!;
  const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);
  const winnerId =
    loserId === game.initiator ? (game.opponent as string) : game.initiator;
  // Either player may have left the server mid-game — the result must
  // still be saved, so degrade to id-based info instead of throwing.
  const loser = await guild.members.fetch(loserId).catch(() => null);
  const winnerMember = await guild.members.fetch(winnerId).catch(() => null);

  try {
    // Build pending game data — save is deferred until DoN chain resolves
    const pendingGameData = {
      game,
      winnerId,
      loserId,
      winnerInfo: {
        username: winnerMember?.user.username ?? winnerId,
        displayName: winnerMember?.displayName ?? winnerId,
      },
      loserInfo: {
        username: loser?.user.username ?? loserId,
        displayName: loser?.displayName ?? loserId,
      },
    };

    if (gameOverMessage) {
      const pendingTimeoutData = { loserId, timeoutDuration };
      // Snapshot the determined-but-unsaved outcome so a restart can
      // apply the timeout and record the result.
      game.currentMessageId = gameOverMessage.id;
      persistGameSnapshot(gameId, guild.id, game, "don_pending", {
        pendingTimeout: pendingTimeoutData,
        pendingResult: {
          winnerId,
          loserId,
          winnerInfo: pendingGameData.winnerInfo,
          loserInfo: pendingGameData.loserInfo,
        },
      });
      createDoubleOrNothingCollector(
        gameOverMessage,
        guild,
        gameId,
        winnerId,
        loserId,
        game.startingNumber,
        game.timeoutMultiplier || 1,
        pendingTimeoutData,
        pendingGameData,
      );
    } else {
      // No DoN button (e.g. can't timeout) — save immediately
      await saveGameResult(
        guild.id,
        game,
        winnerId,
        loserId,
        pendingGameData.winnerInfo,
        pendingGameData.loserInfo,
        null,
      );
      deleteGameSnapshot(gameId);
      try {
        const timeoutMinutes = timeoutDuration / 60000;
        if (loser) {
          const result = await tryTimeoutMember(
            loser,
            timeoutDuration,
            `Lost a deathroll game (${timeoutMinutes}min)`,
          );
          if (!result.ok) {
            console.warn(
              `[deathroll] Could not time out loser ${loserId}: ${result.error}`,
            );
          }
        } else {
          console.warn(
            `[deathroll] Loser ${loserId} left the server — timeout skipped`,
          );
        }
      } catch (error: unknown) {
        console.error("Error timing out user:", error);
      }
    }
  } catch (error: unknown) {
    console.error("Error in handleLoss:", error);
  }
}

async function handleTimeoutLoss(
  guild: Guild,
  game: GameState,
  winnerId: string,
  loserId: string,
) {
  // Either player may have left the server mid-game — the result must
  // still be saved, so degrade to id-based info instead of throwing.
  const loser = await guild.members.fetch(loserId).catch(() => null);
  const winnerMember = await guild.members.fetch(winnerId).catch(() => null);
  const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);

  try {
    const timeoutMinutes = timeoutDuration / 60000;
    if (loser) {
      const result = await tryTimeoutMember(
        loser,
        timeoutDuration,
        `Lost a deathroll game on timeout (${timeoutMinutes}min)`,
      );
      if (!result.ok) {
        console.warn(
          `[deathroll] Could not time out loser ${loserId}: ${result.error}`,
        );
      }
    } else {
      console.warn(
        `[deathroll] Loser ${loserId} left the server — timeout skipped`,
      );
    }
  } catch (error: unknown) {
    console.error("Error timing out user on timeout:", error);
  }

  await saveGameResult(
    guild.id,
    game,
    winnerId,
    loserId,
    {
      username: winnerMember?.user.username ?? winnerId,
      displayName: winnerMember?.displayName ?? winnerId,
    },
    {
      username: loser?.user.username ?? loserId,
      displayName: loser?.displayName ?? loserId,
    },
    "timeout",
  );
}
