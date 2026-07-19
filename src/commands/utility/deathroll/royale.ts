/**
 * Deathroll Royale — multiplayer battle-royale deathroll.
 *
 * Lobby: players join via button (paying the optional gold wager up
 * front). On start, turn order is shuffled and everyone rolls in
 * sequence from the starting number; rolling 0 eliminates you (1min
 * timeout sting) and resets the number for the survivors. Last player
 * standing wins the pot; the final loser eats the classic 5min timeout.
 *
 * The pure state machine (createRoyaleState / startRoyale /
 * applyRoyaleRoll / eliminateRoyalePlayer) has no I/O and is unit-tested.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Message,
} from "discord.js";
import { shuffleArray, tryTimeoutMember } from "../commandUtils.ts";
import { adjustGold } from "../gold/goldRepository.ts";
import { HOUSE_RAKE, computeRoyalePot, formatGold } from "../gold/goldMath.ts";
import { BASE_TIMEOUT, BASE_TIMEOUT_MINUTES } from "./mmr.ts";
import {
  deleteRoyaleSnapshot,
  persistRoyaleSnapshot,
  saveRoyaleResult,
} from "./royalePersistence.ts";
import type { GameRoll } from "./types.ts";

// ─── Constants ────────────────────────────────────────────────────────

export const MIN_ROYALE_PLAYERS = 2;
export const MAX_ROYALE_PLAYERS = 10;
export const DEFAULT_ROYALE_PLAYERS = 8;
/** How long the lobby stays open before expiring. */
const LOBBY_LIFETIME_MS = 3 * 60 * 1000;
/** How long a player gets to roll before forfeiting. */
const TURN_IDLE_MS = 2 * 60 * 1000;
/** Timeout sting for a mid-game elimination (the final loser gets the
 * full 1v1 BASE_TIMEOUT instead). */
const ELIMINATION_TIMEOUT_MS = 60 * 1000;
/** Max rolls shown in the live message (content must stay under 2000). */
const ROLL_HISTORY_TAIL = 10;

// ─── State ────────────────────────────────────────────────────────────

export interface RoyalePlayer {
  userId: string;
  username: string;
  displayName: string;
}

export interface RoyaleElimination {
  userId: string;
  forfeit: boolean;
}

export type RoyalePhase = "lobby" | "active" | "done";

export interface RoyaleState {
  guildId: string;
  channelId: string;
  hostId: string;
  startingNumber: number;
  wager: number;
  maxPlayers: number;
  phase: RoyalePhase;
  players: RoyalePlayer[];
  turnOrder: string[];
  eliminated: RoyaleElimination[];
  currentTurn: string | null;
  currentNumber: number;
  rolls: GameRoll[];
  round: number;
  createdAt: number;
  startedAt: number | null;
  currentMessageId: string | null;
}

export type RoyaleRollEvent =
  | { type: "advance"; nextPlayerId: string }
  | {
      type: "eliminated";
      userId: string;
      forfeit: boolean;
      nextPlayerId: string;
    }
  | {
      type: "winner";
      winnerId: string;
      finalLoserId: string;
      finalForfeit: boolean;
    };

// ─── Pure State Machine ───────────────────────────────────────────────

export function createRoyaleState(options: {
  guildId: string;
  channelId: string;
  host: RoyalePlayer;
  startingNumber: number;
  wager: number;
  maxPlayers: number;
  now: number;
}): RoyaleState {
  return {
    guildId: options.guildId,
    channelId: options.channelId,
    hostId: options.host.userId,
    startingNumber: options.startingNumber,
    wager: options.wager,
    maxPlayers: options.maxPlayers,
    phase: "lobby",
    players: [options.host],
    turnOrder: [],
    eliminated: [],
    currentTurn: null,
    currentNumber: options.startingNumber,
    rolls: [],
    round: 1,
    createdAt: options.now,
    startedAt: null,
    currentMessageId: null,
  };
}

export function isEliminated(state: RoyaleState, userId: string) {
  return state.eliminated.some((e: RoyaleElimination) => e.userId === userId);
}

/** Alive players in turn order. */
export function aliveInOrder(state: RoyaleState) {
  return state.turnOrder.filter(
    (userId: string) => !isEliminated(state, userId),
  );
}

/**
 * The next alive player after `userId` in cyclic turn order. `userId`
 * itself may already be eliminated (it's still in turnOrder).
 */
export function nextAliveAfter(state: RoyaleState, userId: string) {
  const order = state.turnOrder;
  const start = order.indexOf(userId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length];
    if (!isEliminated(state, candidate)) return candidate;
  }
  return null;
}

/**
 * Locks the lobby and begins the game: shuffled turn order, first turn.
 * `shuffle` is injectable for deterministic tests.
 */
export function startRoyale(
  state: RoyaleState,
  now: number,
  shuffle: (array: string[]) => void = shuffleArray,
) {
  const order = state.players.map((p: RoyalePlayer) => p.userId);
  shuffle(order);
  state.turnOrder = order;
  state.phase = "active";
  state.currentNumber = state.startingNumber;
  state.currentTurn = order[0];
  state.startedAt = now;
}

/**
 * Applies the current player's roll: 0 eliminates them (and resets the
 * number for the survivors), anything else becomes the next max.
 */
export function applyRoyaleRoll(
  state: RoyaleState,
  roll: number,
): RoyaleRollEvent {
  const roller = state.currentTurn as string;
  state.rolls.push({
    userId: roller,
    username: state.players.find((p: RoyalePlayer) => p.userId === roller)
      ?.username,
    roll,
    maxNumber: state.currentNumber,
  });

  if (roll === 0) {
    return eliminateRoyalePlayer(state, roller, false);
  }

  state.currentNumber = roll;
  const next = nextAliveAfter(state, roller) as string;
  state.currentTurn = next;
  return { type: "advance", nextPlayerId: next };
}

/**
 * Eliminates a player (rolled 0, or forfeited on turn timeout). With one
 * survivor left the game is over; otherwise the number resets and play
 * continues with the next alive player.
 */
export function eliminateRoyalePlayer(
  state: RoyaleState,
  userId: string,
  forfeit: boolean,
): RoyaleRollEvent {
  state.eliminated.push({ userId, forfeit });

  const alive = aliveInOrder(state);
  if (alive.length <= 1) {
    state.phase = "done";
    state.currentTurn = null;
    return {
      type: "winner",
      winnerId: alive[0],
      finalLoserId: userId,
      finalForfeit: forfeit,
    };
  }

  state.round++;
  state.currentNumber = state.startingNumber;
  state.currentTurn = nextAliveAfter(state, userId);
  return {
    type: "eliminated",
    userId,
    forfeit,
    nextPlayerId: state.currentTurn as string,
  };
}

// ─── Rendering ────────────────────────────────────────────────────────

function playerMention(userId: string) {
  return `<@${userId}>`;
}

export function formatRoyaleLobby(state: RoyaleState, expiresAtUnix: number) {
  const pot = computeRoyalePot(state.wager, state.players.length);
  let content = `⚔️ **DEATHROLL ROYALE** — starting number **${state.startingNumber}**`;
  if (state.wager > 0) content += ` · entry ${formatGold(state.wager)}`;
  content += `\n`;
  content += `${playerMention(state.hostId)} is hosting a battle royale!\n\n`;
  content += `**Players (${state.players.length}/${state.maxPlayers}):** ${state.players.map((p: RoyalePlayer) => playerMention(p.userId)).join(", ")}\n`;
  content += `**Current pot:** ${formatGold(pot)}${state.wager > 0 ? ` (wagers, after ${Math.round(HOUSE_RAKE * 100)}% house rake)` : ` (house bonus)`}\n\n`;
  content += `Roll in turns — hit **0** and you're eliminated (1min timeout). `;
  content += `Last one standing takes the pot; the final loser gets timed out for ${BASE_TIMEOUT_MINUTES} minutes!\n`;
  content += `-# Lobby closes <t:${expiresAtUnix}:R> · at least ${MIN_ROYALE_PLAYERS} players needed · ${state.maxPlayers} auto-starts`;
  return content;
}

export function formatRoyaleGame(
  state: RoyaleState,
  banner: string | null = null,
) {
  const alive = aliveInOrder(state);
  let content = `⚔️ **DEATHROLL ROYALE** — Round ${state.round}`;
  if (state.wager > 0)
    content += ` · pot ${formatGold(computeRoyalePot(state.wager, state.players.length))}`;
  content += `\n`;
  content += `**Alive (${alive.length}):** ${alive.map(playerMention).join(" → ")}\n`;
  if (state.eliminated.length > 0) {
    content += `💀 **Out:** ${state.eliminated.map((e: RoyaleElimination) => playerMention(e.userId)).join(", ")}\n`;
  }

  if (banner) content += `\n${banner}\n`;

  const tail = state.rolls.slice(-ROLL_HISTORY_TAIL);
  const skipped = state.rolls.length - tail.length;
  content += `\n**Roll History:**\n`;
  if (skipped > 0)
    content += `-# …${skipped} earlier roll${skipped !== 1 ? "s" : ""}\n`;
  for (let i = 0; i < tail.length; i++) {
    const roll = tail[i];
    const clutch = roll.roll === 1 ? " ⚡ **CLUTCH!**" : "";
    const death = roll.roll === 0 ? " 💀" : "";
    content += `-# ${skipped + i + 1}. ${playerMention(roll.userId)} rolled **${roll.roll}** (from 0-${roll.maxNumber})${clutch}${death}\n`;
  }

  content += `\nCurrent number: **${state.currentNumber}**\n`;
  content += `${playerMention(state.currentTurn as string)}, it's your turn!`;
  return content;
}

export function buildRoyaleLobbyRow(gameId: string, wager: number) {
  const joinButton = new ButtonBuilder()
    .setCustomId(`droyale_join_${gameId}`)
    .setLabel(wager > 0 ? `Join (${wager}g entry)` : "Join")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("⚔️");
  const leaveButton = new ButtonBuilder()
    .setCustomId(`droyale_leave_${gameId}`)
    .setLabel("Leave")
    .setStyle(ButtonStyle.Secondary);
  const startButton = new ButtonBuilder()
    .setCustomId(`droyale_start_${gameId}`)
    .setLabel("Start")
    .setStyle(ButtonStyle.Success)
    .setEmoji("🎲");
  const cancelButton = new ButtonBuilder()
    .setCustomId(`droyale_cancel_${gameId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("❌");

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      joinButton,
      leaveButton,
      startButton,
      cancelButton,
    ),
  ];
}

export function buildRoyaleRollRow(gameId: string, maxNumber: number) {
  const rollButton = new ButtonBuilder()
    .setCustomId(`droyale_roll_${gameId}`)
    .setLabel(`Roll (0-${maxNumber})`)
    .setStyle(ButtonStyle.Primary)
    .setEmoji("🎲");
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(rollButton)];
}

// ─── Live Game Registry ───────────────────────────────────────────────

const activeRoyales = new Map<string, RoyaleState>();
const activeRoyaleCollectors = new Map<
  string,
  { stop(reason?: string): void }
>();

function stopRoyaleCollector(gameId: string) {
  const collector = activeRoyaleCollectors.get(gameId);
  if (collector) {
    collector.stop("manually stopped");
    activeRoyaleCollectors.delete(gameId);
  }
}

function cleanupRoyale(gameId: string) {
  activeRoyales.delete(gameId);
  activeRoyaleCollectors.delete(gameId);
  deleteRoyaleSnapshot(gameId);
}

async function refundAllWagers(state: RoyaleState, gameId: string) {
  if (state.wager <= 0) return;
  for (const player of state.players) {
    await adjustGold(
      state.guildId,
      player.userId,
      state.wager,
      "royale_refund",
      {
        userInfo: {
          username: player.username,
          displayName: player.displayName,
        },
        meta: { gameId },
      },
    );
  }
}

// ─── Command Handler ──────────────────────────────────────────────────

/**
 * /deathrollroyale command handler — posts the lobby.
 */
export async function executeDeathrollRoyale(
  interaction: ChatInputCommandInteraction,
) {
  const startingNumber = interaction.options.getInteger("number") || 100;
  const wager = interaction.options.getInteger("wager") || 0;
  const maxPlayers =
    interaction.options.getInteger("max_players") || DEFAULT_ROYALE_PLAYERS;

  await interaction.deferReply();

  if (
    !interaction.guild!.members.me?.permissions.has(
      PermissionFlagsBits.ModerateMembers,
    )
  ) {
    return interaction.editReply({
      content: "⚔️ I don't have permission to timeout members!",
    });
  }

  const member = interaction.member as GuildMember;
  if (!member || !member.moderatable) {
    return interaction.editReply({
      content:
        "⚔️ You can't be timed out (you have higher permissions), so you can't host a royale!",
    });
  }

  const guildId = interaction.guild!.id;
  const host: RoyalePlayer = {
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: member.displayName,
  };

  // The host pays their wager up front, exactly like a joiner.
  if (wager > 0) {
    const debit = await adjustGold(
      guildId,
      host.userId,
      -wager,
      "royale_wager",
      {
        userInfo: { username: host.username, displayName: host.displayName },
      },
    );
    if (!debit.ok) {
      return interaction.editReply({
        content:
          debit.error === "insufficient"
            ? `⚔️ You don't have ${formatGold(wager)} to wager! Check /gold balance.`
            : "⚔️ Couldn't take your wager — please try again.",
      });
    }
  }

  const state = createRoyaleState({
    guildId,
    channelId: interaction.channelId,
    host,
    startingNumber,
    wager,
    maxPlayers,
    now: Date.now(),
  });

  const expiresAtUnix = Math.floor((Date.now() + LOBBY_LIFETIME_MS) / 1000);
  const reply = await interaction.editReply({
    content: formatRoyaleLobby(state, expiresAtUnix),
    components: buildRoyaleLobbyRow(interaction.id, wager),
  });

  const gameId = `${interaction.channelId}_${interaction.id}`;
  state.currentMessageId = reply.id;
  activeRoyales.set(gameId, state);
  persistRoyaleSnapshot(gameId, state);

  createLobbyCollector(reply, gameId, expiresAtUnix);
}

// ─── Lobby Collector ──────────────────────────────────────────────────

function createLobbyCollector(
  message: Message,
  gameId: string,
  expiresAtUnix: number,
) {
  const collector = message.createMessageComponentCollector({
    time: LOBBY_LIFETIME_MS,
  });
  activeRoyaleCollectors.set(gameId, collector);

  collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
    try {
      const customId = buttonInteraction.customId;
      if (customId.startsWith("droyale_join_")) {
        await handleJoin(buttonInteraction, gameId, expiresAtUnix, collector);
      } else if (customId.startsWith("droyale_leave_")) {
        await handleLeave(buttonInteraction, gameId, expiresAtUnix);
      } else if (customId.startsWith("droyale_start_")) {
        await handleStart(buttonInteraction, gameId);
      } else if (customId.startsWith("droyale_cancel_")) {
        await handleCancel(buttonInteraction, gameId);
      }
    } catch (error: unknown) {
      console.error("Error in royale lobby collector:", error);
    }
  });

  collector.on(
    "end",
    async (
      _collected: Collection<string, ButtonInteraction>,
      reason: string,
    ) => {
      if (reason === "manually stopped") return;
      const state = activeRoyales.get(gameId);
      if (!state || state.phase !== "lobby") return;

      await refundAllWagers(state, gameId);
      await message
        .edit({
          content:
            `⚔️ ${playerMention(state.hostId)}'s deathroll royale expired — not enough fighters showed up!` +
            (state.wager > 0 ? " All wagers refunded." : ""),
          components: [],
        })
        .catch(() => {});
      cleanupRoyale(gameId);
    },
  );
}

async function handleJoin(
  buttonInteraction: ButtonInteraction,
  gameId: string,
  expiresAtUnix: number,
  collector: { stop(reason?: string): void },
) {
  const state = activeRoyales.get(gameId);
  if (!state || state.phase !== "lobby") {
    return buttonInteraction.reply({
      content: "⚔️ This royale is no longer open!",
      ephemeral: true,
    });
  }

  const userId = buttonInteraction.user.id;
  if (state.players.some((p: RoyalePlayer) => p.userId === userId)) {
    return buttonInteraction.reply({
      content: "⚔️ You're already in! Waiting for the host to start.",
      ephemeral: true,
    });
  }
  if (state.players.length >= state.maxPlayers) {
    return buttonInteraction.reply({
      content: "⚔️ This royale is full!",
      ephemeral: true,
    });
  }

  const member = buttonInteraction.member as GuildMember;
  if (!member || !member.moderatable) {
    return buttonInteraction.reply({
      content:
        "⚔️ You can't be timed out (higher permissions), so you can't join!",
      ephemeral: true,
    });
  }

  if (state.wager > 0) {
    const debit = await adjustGold(
      state.guildId,
      userId,
      -state.wager,
      "royale_wager",
      {
        userInfo: {
          username: buttonInteraction.user.username,
          displayName: member.displayName,
        },
        meta: { gameId },
      },
    );
    if (!debit.ok) {
      return buttonInteraction.reply({
        content:
          debit.error === "insufficient"
            ? `⚔️ You need ${formatGold(state.wager)} to enter! Check /gold balance.`
            : "⚔️ Couldn't take your wager — please try again.",
        ephemeral: true,
      });
    }
  }

  state.players.push({
    userId,
    username: buttonInteraction.user.username,
    displayName: member.displayName,
  });
  persistRoyaleSnapshot(gameId, state);

  if (state.players.length >= state.maxPlayers) {
    collector.stop("manually stopped");
    activeRoyaleCollectors.delete(gameId);
    await beginRoyale(buttonInteraction, gameId, state);
    return;
  }

  await buttonInteraction.update({
    content: formatRoyaleLobby(state, expiresAtUnix),
  });
}

async function handleLeave(
  buttonInteraction: ButtonInteraction,
  gameId: string,
  expiresAtUnix: number,
) {
  const state = activeRoyales.get(gameId);
  if (!state || state.phase !== "lobby") {
    return buttonInteraction.reply({
      content: "⚔️ This royale is no longer open!",
      ephemeral: true,
    });
  }

  const userId = buttonInteraction.user.id;
  if (userId === state.hostId) {
    return buttonInteraction.reply({
      content: "⚔️ You're the host — use Cancel to call the whole thing off.",
      ephemeral: true,
    });
  }
  const index = state.players.findIndex(
    (p: RoyalePlayer) => p.userId === userId,
  );
  if (index === -1) {
    return buttonInteraction.reply({
      content: "⚔️ You're not in this royale!",
      ephemeral: true,
    });
  }

  const [player] = state.players.splice(index, 1);
  if (state.wager > 0) {
    await adjustGold(state.guildId, userId, state.wager, "royale_refund", {
      userInfo: { username: player.username, displayName: player.displayName },
      meta: { gameId, left: true },
    });
  }
  persistRoyaleSnapshot(gameId, state);

  await buttonInteraction.update({
    content: formatRoyaleLobby(state, expiresAtUnix),
  });
}

async function handleStart(
  buttonInteraction: ButtonInteraction,
  gameId: string,
) {
  const state = activeRoyales.get(gameId);
  if (!state || state.phase !== "lobby") {
    return buttonInteraction.reply({
      content: "⚔️ This royale is no longer open!",
      ephemeral: true,
    });
  }
  if (buttonInteraction.user.id !== state.hostId) {
    return buttonInteraction.reply({
      content: "⚔️ Only the host can start the royale!",
      ephemeral: true,
    });
  }
  if (state.players.length < MIN_ROYALE_PLAYERS) {
    return buttonInteraction.reply({
      content: `⚔️ You need at least ${MIN_ROYALE_PLAYERS} players to start!`,
      ephemeral: true,
    });
  }

  stopRoyaleCollector(gameId);
  await beginRoyale(buttonInteraction, gameId, state);
}

async function handleCancel(
  buttonInteraction: ButtonInteraction,
  gameId: string,
) {
  const state = activeRoyales.get(gameId);
  if (!state || state.phase !== "lobby") {
    return buttonInteraction.reply({
      content: "⚔️ This royale is no longer open!",
      ephemeral: true,
    });
  }
  if (buttonInteraction.user.id !== state.hostId) {
    return buttonInteraction.reply({
      content: "⚔️ Only the host can cancel the royale!",
      ephemeral: true,
    });
  }

  stopRoyaleCollector(gameId);
  await refundAllWagers(state, gameId);
  await buttonInteraction.update({
    content:
      `⚔️ ${playerMention(state.hostId)}'s deathroll royale was cancelled.` +
      (state.wager > 0 ? " All wagers refunded." : ""),
    components: [],
  });
  cleanupRoyale(gameId);
}

// ─── Game Flow ────────────────────────────────────────────────────────

async function beginRoyale(
  buttonInteraction: ButtonInteraction,
  gameId: string,
  state: RoyaleState,
) {
  startRoyale(state, Date.now());
  persistRoyaleSnapshot(gameId, state);

  await buttonInteraction.deferUpdate().catch(() => {});
  await buttonInteraction.message.delete().catch(() => {});

  const banner = `🎲 **The royale begins!** ${state.players.length} fighters enter — turn order is shuffled.`;
  const newMessage = await buttonInteraction.followUp({
    content: formatRoyaleGame(state, banner),
    components: buildRoyaleRollRow(gameId, state.currentNumber),
  });

  state.currentMessageId = newMessage.id;
  persistRoyaleSnapshot(gameId, state);
  createRoyaleRollCollector(newMessage, gameId, buttonInteraction.guild!);
}

function createRoyaleRollCollector(
  message: Message,
  gameId: string,
  guild: Guild,
) {
  const collector = message.createMessageComponentCollector({
    idle: TURN_IDLE_MS,
  });
  activeRoyaleCollectors.set(gameId, collector);

  collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
    try {
      await handleRoyaleRoll(buttonInteraction, gameId, guild);
    } catch (error: unknown) {
      console.error("Error in royale roll collector:", error);
    }
  });

  collector.on(
    "end",
    async (
      _collected: Collection<string, ButtonInteraction>,
      reason: string,
    ) => {
      if (reason === "manually stopped") return;
      const state = activeRoyales.get(gameId);
      if (!state || state.phase !== "active" || !state.currentTurn) return;

      // Turn timer expired — the current player forfeits.
      const afkPlayerId = state.currentTurn;
      const event = eliminateRoyalePlayer(state, afkPlayerId, true);
      activeRoyaleCollectors.delete(gameId);

      await message.edit({ components: [] }).catch(() => {});

      const channel = message.channel as GuildTextBasedChannel;
      try {
        if (event.type === "winner") {
          await finishRoyale(guild, channel, state, gameId, event, null);
        } else {
          await applyEliminationSting(guild, afkPlayerId, true, false);
          const banner = `⏱️ ${playerMention(afkPlayerId)} took too long and forfeits! 💀 Number resets to **${state.startingNumber}**.`;
          const newMessage = await channel.send({
            content: formatRoyaleGame(state, banner),
            components: buildRoyaleRollRow(gameId, state.currentNumber),
          });
          state.currentMessageId = newMessage.id;
          persistRoyaleSnapshot(gameId, state);
          createRoyaleRollCollector(newMessage, gameId, guild);
        }
      } catch (error: unknown) {
        console.error("Error handling royale turn timeout:", error);
      }
    },
  );
}

async function handleRoyaleRoll(
  buttonInteraction: ButtonInteraction,
  gameId: string,
  guild: Guild,
) {
  const state = activeRoyales.get(gameId);
  if (!state || state.phase !== "active") {
    return buttonInteraction.reply({
      content: "⚔️ This royale is no longer active!",
      ephemeral: true,
    });
  }

  const userId = buttonInteraction.user.id;
  if (isEliminated(state, userId)) {
    return buttonInteraction.reply({
      content: "💀 You've been eliminated — spectate and cope!",
      ephemeral: true,
    });
  }
  if (userId !== state.currentTurn) {
    return buttonInteraction.reply({
      content: "⚔️ It's not your turn!",
      ephemeral: true,
    });
  }

  stopRoyaleCollector(gameId);

  const roll = Math.floor(Math.random() * (state.currentNumber + 1));
  const event = applyRoyaleRoll(state, roll);

  await buttonInteraction.update({ components: [] });
  const oldMessage = buttonInteraction.message;
  setTimeout(() => {
    oldMessage.delete().catch(() => {});
  }, 500);

  if (event.type === "winner") {
    const channel = buttonInteraction.channel as GuildTextBasedChannel;
    await finishRoyale(guild, channel, state, gameId, event, buttonInteraction);
    return;
  }

  let banner: string | null = null;
  if (event.type === "eliminated") {
    await applyEliminationSting(guild, event.userId, false, false);
    banner = `💥 ${playerMention(event.userId)} rolled **0** and is ELIMINATED! (1min timeout) Number resets to **${state.startingNumber}**.`;
  }

  const newMessage = await buttonInteraction.followUp({
    content: formatRoyaleGame(state, banner),
    components: buildRoyaleRollRow(gameId, state.currentNumber),
  });

  state.currentMessageId = newMessage.id;
  persistRoyaleSnapshot(gameId, state);
  createRoyaleRollCollector(newMessage, gameId, guild);
}

/**
 * Times out an eliminated player: 1 minute for a mid-game death, the
 * full 1v1 timeout for the final loser.
 */
async function applyEliminationSting(
  guild: Guild,
  userId: string,
  forfeit: boolean,
  isFinalLoser: boolean,
) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  const duration = isFinalLoser ? BASE_TIMEOUT : ELIMINATION_TIMEOUT_MS;
  const reason = isFinalLoser
    ? `Lost a deathroll royale (final loser, ${duration / 60000}min)`
    : forfeit
      ? "Forfeited a deathroll royale turn (1min)"
      : "Eliminated from a deathroll royale (1min)";
  const result = await tryTimeoutMember(member, duration, reason);
  if (!result.ok) {
    console.warn(`[royale] Could not time out ${userId}: ${result.error}`);
  }
}

async function finishRoyale(
  guild: Guild,
  channel: GuildTextBasedChannel,
  state: RoyaleState,
  gameId: string,
  event: Extract<RoyaleRollEvent, { type: "winner" }>,
  buttonInteraction: ButtonInteraction | null,
) {
  const pot = computeRoyalePot(state.wager, state.players.length);

  await applyEliminationSting(
    guild,
    event.finalLoserId,
    event.finalForfeit,
    true,
  );

  const payout = await adjustGold(
    state.guildId,
    event.winnerId,
    pot,
    "royale_pot",
    {
      userInfo: {
        username:
          state.players.find((p: RoyalePlayer) => p.userId === event.winnerId)
            ?.username ?? event.winnerId,
        displayName:
          state.players.find((p: RoyalePlayer) => p.userId === event.winnerId)
            ?.displayName ?? event.winnerId,
      },
      meta: { gameId },
    },
  );

  const placements = [
    event.winnerId,
    ...state.eliminated.map((e: RoyaleElimination) => e.userId).reverse(),
  ];
  const medals = ["👑", "🥈", "🥉"];
  const placementLines = placements
    .map((userId: string, index: number) => {
      const medal = medals[index] ?? "💀";
      return `-# ${medal} ${index + 1}. ${playerMention(userId)}`;
    })
    .join("\n");

  let content = formatRoyaleGame(
    { ...state, currentTurn: event.winnerId },
    null,
  );
  // Strip the "it's your turn" tail — the game is over.
  content = content.substring(0, content.lastIndexOf("\nCurrent number:"));
  content += `\n\n💀 ${playerMention(event.finalLoserId)} ${event.finalForfeit ? "forfeited" : "rolled **0**"} and has been timed out for ${BASE_TIMEOUT_MINUTES} minutes!\n`;
  content += `-# 💰 Feeling generous? /gold ransom can buy them out early.\n`;
  content += `🏆 **${playerMention(event.winnerId)} WINS THE ROYALE** and takes the pot: **${formatGold(pot)}**!`;
  if (payout.ok) {
    content += `\n-# New balance: ${formatGold(payout.balance)}\n`;
  } else {
    content += `\n`;
  }
  content += `\n**Final Standings:**\n${placementLines}`;

  const send = async () => {
    if (buttonInteraction) {
      return buttonInteraction.followUp({ content });
    }
    return channel.send({ content });
  };
  await send().catch((error: unknown) =>
    console.error("Error posting royale finish:", error),
  );

  await saveRoyaleResult(gameId, state, event.winnerId).catch(
    (error: unknown) => console.error("Error saving royale result:", error),
  );
  cleanupRoyale(gameId);
}
