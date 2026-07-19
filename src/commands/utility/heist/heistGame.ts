/**
 * Heist the Hoard — a cooperative raid on the wolf's gold.
 *
 * A crew of 2-6 stakes gold, then runs three shuffled stages (sneak
 * timing, lockpick roll, riddle) with a different member on point each
 * time. 3/3 steals 25% of the hoard, 2/3 steals 10% (stakes returned
 * both ways); 1/3 forfeits the stakes to the wolf; 0/3 forfeits AND
 * the wolf mauls the crew (1min timeouts).
 *
 * All judging is local and deterministic (heistMath) — the money path
 * is never decided by an LLM. Every gold movement is closed-loop with
 * the wolf's hoard.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildTextBasedChannel,
  Message,
} from "discord.js";
import { shuffleArray, tryTimeoutMember } from "../commandUtils.ts";
import { adjustGold, fetchWallet } from "../gold/goldRepository.ts";
import { formatGold } from "../gold/goldMath.ts";
import { ensureWolfWallet } from "../gold/luposAgentGold.ts";
import {
  HEIST_BIG_SCORE_PCT,
  HEIST_COOLDOWN_MS,
  HEIST_DEFAULT_BUYIN,
  HEIST_LOBBY_LIFETIME_MS,
  HEIST_MAX_BUYIN,
  HEIST_MAX_CREW,
  HEIST_MIN_BUYIN,
  HEIST_MIN_CREW,
  HEIST_MIN_HOARD,
  HEIST_SMALL_SCORE_PCT,
  LOCKPICK_THRESHOLD,
  MAULED_TIMEOUT_MS,
  RIDDLE_MAX_GUESSES,
  RIDDLE_TIME_MS,
  SNEAK_MAX_DELAY_MS,
  SNEAK_MIN_DELAY_MS,
  STAGE_IDLE_MS,
  computeHeistLoot,
  computeHeistOutcome,
  judgeSneakClick,
  matchesRiddleAnswer,
  rollStageOrder,
  splitHeistLoot,
} from "./heistMath.ts";
import type { HeistStageKind } from "./heistMath.ts";
import { drawRiddle } from "./riddles.ts";
import {
  deleteHeistSnapshot,
  getHeistCooldownRemaining,
  persistHeistSnapshot,
  saveHeistResult,
} from "./heistPersistence.ts";

// ─── State ────────────────────────────────────────────────────────────

export interface HeistCrewMember {
  userId: string;
  username: string;
  displayName: string;
}

export type HeistPhase = "lobby" | "active" | "done";

export interface HeistStageResult {
  kind: HeistStageKind;
  pointId: string;
  success: boolean;
  detail: string;
}

export interface HeistState {
  guildId: string;
  channelId: string;
  hostId: string;
  buyin: number;
  phase: HeistPhase;
  crew: HeistCrewMember[];
  stageOrder: HeistStageKind[];
  pointOrder: string[];
  stageResults: HeistStageResult[];
  createdAt: number;
  startedAt: number | null;
  currentMessageId: string | null;
}

export function createHeistState(options: {
  guildId: string;
  channelId: string;
  host: HeistCrewMember;
  buyin: number;
  now: number;
}): HeistState {
  return {
    guildId: options.guildId,
    channelId: options.channelId,
    hostId: options.host.userId,
    buyin: options.buyin,
    phase: "lobby",
    crew: [options.host],
    stageOrder: [],
    pointOrder: [],
    stageResults: [],
    createdAt: options.now,
    startedAt: null,
    currentMessageId: null,
  };
}

/**
 * Locks the lobby: shuffled stage order and shuffled point rotation so
 * a different crew member fronts each stage. Shuffles injectable.
 */
export function startHeist(
  state: HeistState,
  now: number,
  stageShuffle: () => HeistStageKind[] = rollStageOrder,
  crewShuffle: (arr: string[]) => void = shuffleArray,
) {
  state.stageOrder = stageShuffle();
  const order = state.crew.map((member: HeistCrewMember) => member.userId);
  crewShuffle(order);
  state.pointOrder = order;
  state.phase = "active";
  state.startedAt = now;
}

/** The crew member fronting the given stage (rotates through the crew). */
export function pointForStage(state: HeistState, stageIndex: number) {
  return state.pointOrder[stageIndex % state.pointOrder.length];
}

export function successCount(state: HeistState) {
  return state.stageResults.filter((r: HeistStageResult) => r.success).length;
}

// ─── Rendering ────────────────────────────────────────────────────────

const STAGE_LABELS: Record<HeistStageKind, string> = {
  sneak: "The Sneak",
  lock: "The Lock",
  riddle: "The Riddle",
};

const STAGE_EMOJI: Record<HeistStageKind, string> = {
  sneak: "🤫",
  lock: "🔓",
  riddle: "🧩",
};

export function formatHeistLobby(
  state: HeistState,
  hoardBalance: number,
  expiresAtUnix: number,
) {
  const bigScore = computeHeistLoot(hoardBalance, HEIST_BIG_SCORE_PCT);
  const smallScore = computeHeistLoot(hoardBalance, HEIST_SMALL_SCORE_PCT);
  let content = `🏦 **HEIST THE HOARD** — the wolf sleeps on **${formatGold(hoardBalance)}**\n`;
  content += `<@${state.hostId}> is assembling a crew! Buy-in: **${formatGold(state.buyin)}** each.\n\n`;
  content += `**Crew (${state.crew.length}/${HEIST_MAX_CREW}):** ${state.crew.map((m: HeistCrewMember) => `<@${m.userId}>`).join(", ")}\n\n`;
  content += `**The plan:** three stages, a different crewmate on point each time.\n`;
  content += `🏆 3/3 — steal **${formatGold(bigScore)}** (25% of the hoard), stakes back\n`;
  content += `💰 2/3 — grab **${formatGold(smallScore)}** (10%), stakes back\n`;
  content += `🚨 1/3 — busted: the wolf keeps your stakes\n`;
  content += `🩸 0/3 — mauled: stakes gone and a minute in his jaws\n`;
  content += `-# Lobby closes <t:${expiresAtUnix}:R> · ${HEIST_MIN_CREW}+ crew needed · one heist per server every ${HEIST_COOLDOWN_MS / 3600000}h`;
  return content;
}

export function formatStageProgress(state: HeistState) {
  return state.stageOrder
    .map((kind: HeistStageKind, index: number) => {
      const result = state.stageResults[index];
      const icon = result ? (result.success ? "✅" : "❌") : "⏳";
      return `${icon} ${STAGE_LABELS[kind]}`;
    })
    .join(" · ");
}

function stageHeader(state: HeistState, stageIndex: number) {
  const kind = state.stageOrder[stageIndex];
  return (
    `🏦 **HEIST — Stage ${stageIndex + 1}/3: ${STAGE_LABELS[kind].toUpperCase()}** ${STAGE_EMOJI[kind]}\n` +
    `${formatStageProgress(state)}\n\n`
  );
}

// ─── Live Registry ────────────────────────────────────────────────────

/** One heist per guild at a time (plus the DB cooldown between them). */
const activeGuildHeists = new Map<string, string>();

// ─── Command Handler ──────────────────────────────────────────────────

export async function executeHeist(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild!;
  const guildId = guild.id;
  const buyin = Math.min(
    HEIST_MAX_BUYIN,
    Math.max(
      HEIST_MIN_BUYIN,
      interaction.options.getInteger("buyin") || HEIST_DEFAULT_BUYIN,
    ),
  );

  await interaction.deferReply();

  if (activeGuildHeists.has(guildId)) {
    return interaction.editReply({
      content: "🏦 A heist is already underway — one crew at a time!",
    });
  }

  const cooldownRemaining = await getHeistCooldownRemaining(guildId);
  if (cooldownRemaining > 0) {
    const readyAtUnix = Math.floor((Date.now() + cooldownRemaining) / 1000);
    return interaction.editReply({
      content: `🐺 The wolf is on high alert after the last job. The hoard can be hit again <t:${readyAtUnix}:R>.`,
    });
  }

  const botUserId = interaction.client.user!.id;
  const wolfWallet = await ensureWolfWallet(guildId, botUserId);
  const hoardBalance = wolfWallet?.balance ?? 0;
  if (hoardBalance < HEIST_MIN_HOARD) {
    return interaction.editReply({
      content: `🏦 The hoard holds only ${formatGold(hoardBalance)} — not worth the risk. Come back when the wolf is richer (${formatGold(HEIST_MIN_HOARD)}+).`,
    });
  }

  const hostMember = await guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const host: HeistCrewMember = {
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: hostMember?.displayName ?? interaction.user.username,
  };

  const stake = await adjustGold(guildId, host.userId, -buyin, "heist_stake", {
    userInfo: { username: host.username, displayName: host.displayName },
  });
  if (!stake.ok) {
    return interaction.editReply({
      content:
        stake.error === "insufficient"
          ? `🏦 You need ${formatGold(buyin)} to bankroll this job! Check /gold balance.`
          : "🏦 Couldn't take your stake — try again.",
    });
  }

  const state = createHeistState({
    guildId,
    channelId: interaction.channelId,
    host,
    buyin,
    now: Date.now(),
  });

  const heistId = `${interaction.channelId}_${interaction.id}`;
  activeGuildHeists.set(guildId, heistId);

  const expiresAtUnix = Math.floor(
    (Date.now() + HEIST_LOBBY_LIFETIME_MS) / 1000,
  );
  const reply = await interaction.editReply({
    content: formatHeistLobby(state, hoardBalance, expiresAtUnix),
    components: buildLobbyRow(interaction.id, buyin),
  });

  state.currentMessageId = reply.id;
  persistHeistSnapshot(heistId, state);
  createLobbyCollector(reply, heistId, state, hoardBalance, expiresAtUnix);
}

function buildLobbyRow(interactionId: string, buyin: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`heist_join_${interactionId}`)
        .setLabel(`Join the crew (${buyin}g stake)`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🥷"),
      new ButtonBuilder()
        .setCustomId(`heist_leave_${interactionId}`)
        .setLabel("Back out")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`heist_start_${interactionId}`)
        .setLabel("Start the job")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🏦"),
      new ButtonBuilder()
        .setCustomId(`heist_cancel_${interactionId}`)
        .setLabel("Call it off")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌"),
    ),
  ];
}

async function refundAllStakes(state: HeistState, heistId: string) {
  for (const member of state.crew) {
    await adjustGold(
      state.guildId,
      member.userId,
      state.buyin,
      "heist_refund",
      {
        userInfo: {
          username: member.username,
          displayName: member.displayName,
        },
        meta: { heistId },
      },
    );
  }
}

function cleanupHeist(heistId: string, guildId: string) {
  if (activeGuildHeists.get(guildId) === heistId) {
    activeGuildHeists.delete(guildId);
  }
  deleteHeistSnapshot(heistId);
}

// ─── Lobby Collector ──────────────────────────────────────────────────

function createLobbyCollector(
  message: Message,
  heistId: string,
  state: HeistState,
  hoardBalance: number,
  expiresAtUnix: number,
) {
  const collector = message.createMessageComponentCollector({
    time: HEIST_LOBBY_LIFETIME_MS,
  });

  collector.on("collect", async (bi: ButtonInteraction) => {
    try {
      if (state.phase !== "lobby") {
        return bi.reply({
          content: "🏦 The job already started!",
          ephemeral: true,
        });
      }
      const userId = bi.user.id;

      if (bi.customId.startsWith("heist_join_")) {
        if (state.crew.some((m: HeistCrewMember) => m.userId === userId)) {
          return bi.reply({
            content: "🥷 You're already on the crew!",
            ephemeral: true,
          });
        }
        if (state.crew.length >= HEIST_MAX_CREW) {
          return bi.reply({ content: "🏦 The crew is full!", ephemeral: true });
        }
        const displayName =
          (bi.member as { displayName?: string } | null)?.displayName ??
          bi.user.username;
        const stake = await adjustGold(
          state.guildId,
          userId,
          -state.buyin,
          "heist_stake",
          {
            userInfo: { username: bi.user.username, displayName },
            meta: { heistId },
          },
        );
        if (!stake.ok) {
          return bi.reply({
            content:
              stake.error === "insufficient"
                ? `🏦 You need ${formatGold(state.buyin)} to buy in! Check /gold balance.`
                : "🏦 Couldn't take your stake — try again.",
            ephemeral: true,
          });
        }
        state.crew.push({ userId, username: bi.user.username, displayName });
        persistHeistSnapshot(heistId, state);
        if (state.crew.length >= HEIST_MAX_CREW) {
          collector.stop("manually stopped");
          await bi.deferUpdate().catch(() => {});
          await runHeist(bi, heistId, state);
          return;
        }
        return bi.update({
          content: formatHeistLobby(state, hoardBalance, expiresAtUnix),
        });
      }

      if (bi.customId.startsWith("heist_leave_")) {
        if (userId === state.hostId) {
          return bi.reply({
            content: "🏦 You're running this job — use Call it off instead.",
            ephemeral: true,
          });
        }
        const index = state.crew.findIndex(
          (m: HeistCrewMember) => m.userId === userId,
        );
        if (index === -1) {
          return bi.reply({
            content: "🥷 You're not on this crew!",
            ephemeral: true,
          });
        }
        const [left] = state.crew.splice(index, 1);
        await adjustGold(state.guildId, userId, state.buyin, "heist_refund", {
          userInfo: { username: left.username, displayName: left.displayName },
          meta: { heistId, left: true },
        });
        persistHeistSnapshot(heistId, state);
        return bi.update({
          content: formatHeistLobby(state, hoardBalance, expiresAtUnix),
        });
      }

      if (bi.customId.startsWith("heist_start_")) {
        if (userId !== state.hostId) {
          return bi.reply({
            content: "🏦 Only the host can start the job!",
            ephemeral: true,
          });
        }
        if (state.crew.length < HEIST_MIN_CREW) {
          return bi.reply({
            content: `🏦 You need at least ${HEIST_MIN_CREW} crew for this job!`,
            ephemeral: true,
          });
        }
        collector.stop("manually stopped");
        await bi.deferUpdate().catch(() => {});
        await runHeist(bi, heistId, state);
        return;
      }

      if (bi.customId.startsWith("heist_cancel_")) {
        if (userId !== state.hostId) {
          return bi.reply({
            content: "🏦 Only the host can call it off!",
            ephemeral: true,
          });
        }
        collector.stop("manually stopped");
        state.phase = "done";
        await refundAllStakes(state, heistId);
        await bi.update({
          content: `🏦 <@${state.hostId}> called off the heist. Stakes refunded — the wolf sleeps on.`,
          components: [],
        });
        cleanupHeist(heistId, state.guildId);
        return;
      }
    } catch (error: unknown) {
      console.error("Error in heist lobby collector:", error);
    }
  });

  collector.on(
    "end",
    async (_c: Collection<string, ButtonInteraction>, reason: string) => {
      if (reason === "manually stopped") return;
      if (state.phase !== "lobby") return;
      state.phase = "done";
      await refundAllStakes(state, heistId);
      await message
        .edit({
          content:
            "🏦 The heist crew never assembled — stakes refunded. The wolf sleeps on, hoard intact.",
          components: [],
        })
        .catch(() => {});
      cleanupHeist(heistId, state.guildId);
    },
  );
}

// ─── Stage Runners ────────────────────────────────────────────────────

async function runHeist(
  bi: ButtonInteraction,
  heistId: string,
  state: HeistState,
) {
  const guild = bi.guild!;
  const channel = bi.channel as GuildTextBasedChannel;

  try {
    startHeist(state, Date.now());
    persistHeistSnapshot(heistId, state);
    await bi.message.delete().catch(() => {});

    for (
      let stageIndex = 0;
      stageIndex < state.stageOrder.length;
      stageIndex++
    ) {
      const kind = state.stageOrder[stageIndex];
      const pointId = pointForStage(state, stageIndex);
      let result: { success: boolean; detail: string };
      if (kind === "sneak") {
        result = await runSneakStage(
          channel,
          heistId,
          state,
          stageIndex,
          pointId,
        );
      } else if (kind === "lock") {
        result = await runLockStage(
          channel,
          heistId,
          state,
          stageIndex,
          pointId,
        );
      } else {
        result = await runRiddleStage(
          channel,
          heistId,
          state,
          stageIndex,
          pointId,
        );
      }
      state.stageResults.push({
        kind,
        pointId,
        success: result.success,
        detail: result.detail,
      });
      persistHeistSnapshot(heistId, state);
    }

    await finishHeist(guild, channel, heistId, state);
  } catch (error: unknown) {
    // A broken heist must never eat the crew's gold — void and refund.
    console.error("Error running heist:", error);
    state.phase = "done";
    await refundAllStakes(state, heistId);
    await channel
      .send({
        content:
          "🏦 Something went wrong mid-heist — the job is voided and all stakes are refunded.",
      })
      .catch(() => {});
    cleanupHeist(heistId, state.guildId);
  }
}

async function runSneakStage(
  channel: GuildTextBasedChannel,
  heistId: string,
  state: HeistState,
  stageIndex: number,
  pointId: string,
): Promise<{ success: boolean; detail: string }> {
  const content =
    stageHeader(state, stageIndex) +
    `🐺 The wolf stirs in his sleep...\n` +
    `<@${pointId}>, you're on point. **Wait for his eye to close, then MOVE.** Click too early and he sees you.`;

  const message = await channel.send({
    content,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`heist_sneak_${heistId}`)
          .setLabel("HOLD...")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("👁️"),
      ),
    ],
  });
  state.currentMessageId = message.id;
  persistHeistSnapshot(heistId, state);

  return new Promise(
    (resolve: (r: { success: boolean; detail: string }) => void) => {
      let goSignalAt: number | null = null;
      let settled = false;
      const delay =
        SNEAK_MIN_DELAY_MS +
        Math.floor(Math.random() * (SNEAK_MAX_DELAY_MS - SNEAK_MIN_DELAY_MS));

      const collector = message.createMessageComponentCollector({
        time: STAGE_IDLE_MS,
      });

      const settle = async (success: boolean, detail: string, note: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(flipTimer);
        collector.stop("manually stopped");
        await message
          .edit({ content: content + `\n\n${note}`, components: [] })
          .catch(() => {});
        resolve({ success, detail });
      };

      const flipTimer = setTimeout(() => {
        if (settled) return;
        goSignalAt = Date.now();
        message
          .edit({
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(`heist_sneak_${heistId}`)
                  .setLabel("GO! GO! GO!")
                  .setStyle(ButtonStyle.Success)
                  .setEmoji("💨"),
              ),
            ],
          })
          .catch(() => {});
      }, delay);

      collector.on("collect", async (bi: ButtonInteraction) => {
        try {
          if (bi.user.id !== pointId) {
            return bi.reply({
              content: "🤫 You're not on point — don't blow this for the crew!",
              ephemeral: true,
            });
          }
          await bi.deferUpdate().catch(() => {});
          const verdict = judgeSneakClick(Date.now(), goSignalAt ?? Infinity);
          if (verdict === "too_early") {
            return settle(
              false,
              "moved too early",
              `👁️ <@${pointId}> moved while the eye was still open — **SPOTTED!**`,
            );
          }
          if (verdict === "success") {
            return settle(
              true,
              "slipped past",
              `💨 <@${pointId}> slips past the sleeping wolf — **clean!**`,
            );
          }
          return settle(
            false,
            "froze too long",
            `🐺 <@${pointId}> hesitated and the moment passed — **SPOTTED!**`,
          );
        } catch (error: unknown) {
          console.error("Error in sneak stage:", error);
        }
      });

      collector.on(
        "end",
        (_c: Collection<string, ButtonInteraction>, reason: string) => {
          if (reason === "manually stopped") return;
          void settle(
            false,
            "froze completely",
            `🐺 <@${pointId}> never moved. Frozen in fear — **SPOTTED!**`,
          );
        },
      );
    },
  );
}

async function runLockStage(
  channel: GuildTextBasedChannel,
  heistId: string,
  state: HeistState,
  stageIndex: number,
  pointId: string,
): Promise<{ success: boolean; detail: string }> {
  const content =
    stageHeader(state, stageIndex) +
    `🔓 The vault's lock glints in the dark.\n` +
    `<@${pointId}>, you're on point: pick it! Roll **${LOCKPICK_THRESHOLD} or higher** (0-100).`;

  const message = await channel.send({
    content,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`heist_lock_${heistId}`)
          .setLabel(`Pick the lock (need ${LOCKPICK_THRESHOLD}+)`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔓"),
      ),
    ],
  });
  state.currentMessageId = message.id;
  persistHeistSnapshot(heistId, state);

  return new Promise(
    (resolve: (r: { success: boolean; detail: string }) => void) => {
      let settled = false;
      const collector = message.createMessageComponentCollector({
        time: STAGE_IDLE_MS,
      });

      const settle = async (success: boolean, detail: string, note: string) => {
        if (settled) return;
        settled = true;
        collector.stop("manually stopped");
        await message
          .edit({ content: content + `\n\n${note}`, components: [] })
          .catch(() => {});
        resolve({ success, detail });
      };

      collector.on("collect", async (bi: ButtonInteraction) => {
        try {
          if (bi.user.id !== pointId) {
            return bi.reply({
              content: "🔓 Not your lock — hands off!",
              ephemeral: true,
            });
          }
          await bi.deferUpdate().catch(() => {});
          const roll = Math.floor(Math.random() * 101);
          if (roll >= LOCKPICK_THRESHOLD) {
            return settle(
              true,
              `rolled ${roll}`,
              `🔓 <@${pointId}> rolls **${roll}** — the lock clicks open! **Clean!**`,
            );
          }
          return settle(
            false,
            `rolled ${roll}`,
            `🔒 <@${pointId}> rolls **${roll}** — the pick snaps in the lock. **Jammed!**`,
          );
        } catch (error: unknown) {
          console.error("Error in lock stage:", error);
        }
      });

      collector.on(
        "end",
        (_c: Collection<string, ButtonInteraction>, reason: string) => {
          if (reason === "manually stopped") return;
          void settle(
            false,
            "never tried",
            `🔒 <@${pointId}> stared at the lock until the moment passed. **Jammed!**`,
          );
        },
      );
    },
  );
}

async function runRiddleStage(
  channel: GuildTextBasedChannel,
  heistId: string,
  state: HeistState,
  stageIndex: number,
  pointId: string,
): Promise<{ success: boolean; detail: string }> {
  const riddle = drawRiddle();
  const crewIds = new Set(state.crew.map((m: HeistCrewMember) => m.userId));
  const expiresAtUnix = Math.floor((Date.now() + RIDDLE_TIME_MS) / 1000);

  const content =
    stageHeader(state, stageIndex) +
    `🧩 A voice rumbles from the sleeping wolf — he riddles even in dreams:\n` +
    `> *${riddle.riddle}*\n\n` +
    `<@${pointId}> leads, but **anyone on the crew** may answer in chat. ` +
    `${RIDDLE_MAX_GUESSES} guesses between you — expires <t:${expiresAtUnix}:R>.`;

  const message = await channel.send({ content });
  state.currentMessageId = message.id;
  persistHeistSnapshot(heistId, state);

  return new Promise(
    (resolve: (r: { success: boolean; detail: string }) => void) => {
      let settled = false;
      let guesses = 0;

      const collector = channel.createMessageCollector({
        time: RIDDLE_TIME_MS,
        filter: (m: Message) => crewIds.has(m.author.id) && !m.author.bot,
      });

      const settle = async (success: boolean, detail: string, note: string) => {
        if (settled) return;
        settled = true;
        collector.stop("manually stopped");
        await message
          .edit({ content: content + `\n\n${note}` })
          .catch(() => {});
        resolve({ success, detail });
      };

      collector.on("collect", async (guessMessage: Message) => {
        try {
          guesses++;
          if (matchesRiddleAnswer(guessMessage.content, riddle.answers)) {
            await guessMessage.react("✅").catch(() => {});
            return settle(
              true,
              `answered in ${guesses} guess${guesses !== 1 ? "es" : ""}`,
              `🧩 <@${guessMessage.author.id}> answers **${riddle.answers[0]}** — the dream-wolf nods. **Clean!**`,
            );
          }
          await guessMessage.react("❌").catch(() => {});
          if (guesses >= RIDDLE_MAX_GUESSES) {
            return settle(
              false,
              "out of guesses",
              `🧩 Out of guesses! The answer was **${riddle.answers[0]}**. The wolf growls in his sleep — **ALARM!**`,
            );
          }
        } catch (error: unknown) {
          console.error("Error in riddle stage:", error);
        }
      });

      collector.on("end", (_c: unknown, reason: string) => {
        if (reason === "manually stopped") return;
        void settle(
          false,
          "time expired",
          `🧩 Time's up! The answer was **${riddle.answers[0]}**. The wolf growls in his sleep — **ALARM!**`,
        );
      });
    },
  );
}

// ─── Finale ───────────────────────────────────────────────────────────

async function finishHeist(
  guild: Guild,
  channel: GuildTextBasedChannel,
  heistId: string,
  state: HeistState,
) {
  state.phase = "done";
  const botUserId = guild.client.user!.id;
  const successes = successCount(state);
  const outcome = computeHeistOutcome(successes);

  const recap = state.stageResults
    .map(
      (r: HeistStageResult) =>
        `-# ${r.success ? "✅" : "❌"} ${STAGE_LABELS[r.kind]} — <@${r.pointId}> ${r.detail}`,
    )
    .join("\n");

  let loot = 0;
  let content = `🏦 **HEIST COMPLETE — ${successes}/3**\n${recap}\n\n`;

  if (outcome.hoardPct > 0) {
    const wolfWallet = await fetchWallet(state.guildId, botUserId);
    loot = computeHeistLoot(wolfWallet?.balance ?? 0, outcome.hoardPct);
    if (loot > 0) {
      const debit = await adjustGold(
        state.guildId,
        botUserId,
        -loot,
        "heist_loot",
        {
          meta: { heistId, tier: outcome.tier },
        },
      );
      if (debit.ok) {
        const shares = splitHeistLoot(loot, state.crew.length);
        const shareLines: string[] = [];
        for (let i = 0; i < state.crew.length; i++) {
          const member = state.crew[i];
          await adjustGold(
            state.guildId,
            member.userId,
            shares[i],
            "heist_loot",
            {
              userInfo: {
                username: member.username,
                displayName: member.displayName,
              },
              meta: { heistId },
            },
          );
          shareLines.push(
            `-# 💰 <@${member.userId}> takes ${formatGold(shares[i])}`,
          );
        }
        content +=
          outcome.tier === "master"
            ? `🏆 **MASTER HEIST!** The vault swings open and the crew makes off with **${formatGold(loot)}** — a quarter of the hoard!\n`
            : `💰 **SMASH AND GRAB!** It got messy, but the crew escapes with **${formatGold(loot)}**!\n`;
        content += `${shareLines.join("\n")}\n`;
        content += `Stakes returned. The hoard is down to **${formatGold(debit.balance)}**. Somewhere, a wolf howls.`;
      } else {
        content += `🏦 The vault was somehow empty — stakes returned, nothing gained.`;
      }
    } else {
      content += `🏦 The vault was somehow empty — stakes returned, nothing gained.`;
    }
    await refundAllStakes(state, heistId);
  } else {
    // Forfeited stakes flow into the hoard — closed loop.
    const forfeited = state.buyin * state.crew.length;
    const hoard = await adjustGold(
      state.guildId,
      botUserId,
      forfeited,
      "heist_stake",
      {
        userInfo: { username: "Lupos", displayName: "Lupos" },
        meta: { heistId, forfeited: true },
      },
    );
    if (outcome.mauled) {
      content += `🩸 **MAULED.** The wolf was awake the whole time. He takes the crew's stakes (**${formatGold(forfeited)}**) and a minute of their dignity.\n`;
      for (const member of state.crew) {
        const guildMember = await guild.members
          .fetch(member.userId)
          .catch(() => null);
        if (guildMember) {
          await tryTimeoutMember(
            guildMember,
            MAULED_TIMEOUT_MS,
            "Mauled by the wolf guarding his hoard (failed heist)",
          );
        }
      }
      content += `-# 💰 Anyone can /gold ransom them out. The wolf finds this funny.\n`;
    } else {
      content += `🚨 **BUSTED!** One slip too many — the crew scatters empty-handed and the wolf keeps the stakes (**${formatGold(forfeited)}**).\n`;
    }
    content += `The hoard swells to **${formatGold(hoard.ok ? hoard.balance : 0)}**.`;
  }

  await channel
    .send({ content })
    .catch((error: unknown) =>
      console.error("Error posting heist finale:", error),
    );

  await saveHeistResult(heistId, state, {
    tier: outcome.tier,
    successes,
    loot,
    stageResults: state.stageResults.map((r: HeistStageResult) => ({
      kind: r.kind,
      pointId: r.pointId,
      success: r.success,
    })),
  });
  cleanupHeist(heistId, state.guildId);
}
