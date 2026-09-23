// ============================================================
// Discord Action Service — what the Lupos agent can DO in Discord
// ============================================================
// Native polls, threads and Lupos's own nickname, requested by the
// model through tools-service (create_discord_poll,
// create_discord_thread, set_discord_nickname) and always bound to the
// conversation: the guild and channel come from the turn's trusted
// context, never from the model. GuildRoutes adapts these to HTTP;
// every check lives here and in AgentActionGuards.
// ============================================================

import { ChannelType, PermissionFlagsBits } from "discord.js";
import type {
  Client,
  GuildTextBasedChannel,
  Message,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  ActionError,
  SCOPE_ERROR,
  CooldownWindow,
  assertBotCan,
  assertClean,
  assertRequesterCan,
  auditReason,
  fetchMember,
  isSnowflake,
  readOptionalSnowflake,
  readText,
  resolveActionContext,
  resolveBotMember,
  sendPermissionFor,
  withCooldown,
} from "#root/services/discord/AgentActionGuards.ts";
import type { ActionBody } from "#root/services/discord/AgentActionGuards.ts";
import {
  NICKNAME_COOLDOWN_MS,
  NICKNAME_MAX_LENGTH,
  POLL_ANSWERS_MAX,
  POLL_ANSWERS_MIN,
  POLL_ANSWER_MAX_LENGTH,
  POLL_COOLDOWN_MS,
  POLL_DURATION_HOURS_DEFAULT,
  POLL_DURATION_HOURS_MAX,
  POLL_DURATION_HOURS_MIN,
  POLL_QUESTION_MAX_LENGTH,
  THREAD_AUTO_ARCHIVE_MINUTES,
  THREAD_AUTO_ARCHIVE_MINUTES_DEFAULT,
  THREAD_COOLDOWN_MS,
  THREAD_NAME_MAX_LENGTH,
} from "#root/constants/DiscordActionConstants.ts";

// In-memory windows (a restart forgets them — they pace the agent, the
// hard limits are Discord's own).
const pollCooldown = new CooldownWindow(POLL_COOLDOWN_MS); // per channel
const threadCooldown = new CooldownWindow(THREAD_COOLDOWN_MS); // per channel
const nicknameCooldown = new CooldownWindow(NICKNAME_COOLDOWN_MS); // per guild

/** Test hook: forget every cooldown. */
export function resetActionCooldowns(): void {
  pollCooldown.reset();
  threadCooldown.reset();
  nicknameCooldown.reset();
}

// ─── Poll ─────────────────────────────────────────────────────────────

function readAnswers(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < POLL_ANSWERS_MIN ||
    value.length > POLL_ANSWERS_MAX
  ) {
    throw new ActionError(
      400,
      `answers must be a list of ${POLL_ANSWERS_MIN} to ${POLL_ANSWERS_MAX} options.`,
    );
  }
  const answers = value.map((answer, index) =>
    readText(answer, `answers[${index}]`, POLL_ANSWER_MAX_LENGTH),
  );
  const distinct = new Set(answers.map((answer) => answer.toLowerCase()));
  if (distinct.size !== answers.length) {
    throw new ActionError(400, "Poll answers must all be different.");
  }
  return answers;
}

function readDurationHours(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return POLL_DURATION_HOURS_DEFAULT;
  }
  const hours =
    typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (
    !Number.isInteger(hours) ||
    hours < POLL_DURATION_HOURS_MIN ||
    hours > POLL_DURATION_HOURS_MAX
  ) {
    throw new ActionError(
      400,
      `durationHours must be a whole number of hours from ${POLL_DURATION_HOURS_MIN} to ${POLL_DURATION_HOURS_MAX}.`,
    );
  }
  return hours;
}

function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new ActionError(400, `${field} must be true or false.`);
  }
  return value;
}

/**
 * Posts a native Discord poll in the conversation's channel. The
 * requester needs Create Polls there; one poll per channel per window.
 */
export async function createPoll(
  client: Client,
  body: ActionBody,
): Promise<{ messageId: string; url: string }> {
  const question = readText(body.question, "question", POLL_QUESTION_MAX_LENGTH);
  const answers = readAnswers(body.answers);
  const durationHours = readDurationHours(body.durationHours);
  const allowMultiselect = readBoolean(
    body.allowMultiselect,
    "allowMultiselect",
    false,
  );

  const { guild, channel, requester } = await resolveActionContext(client, body);
  assertRequesterCan(channel, requester, [PermissionFlagsBits.SendPolls], "create polls");
  const bot = await resolveBotMember(guild);
  assertBotCan(
    channel,
    bot,
    [
      PermissionFlagsBits.ViewChannel,
      sendPermissionFor(channel),
      PermissionFlagsBits.SendPolls,
    ],
    "post polls",
  );
  assertClean([question, ...answers]);

  const message = await withCooldown(
    pollCooldown,
    channel.id,
    (wait) =>
      `There's already been a poll in this channel in the last 10 minutes — the next one can go up in ${wait}.`,
    () =>
      channel.send({
        poll: {
          question: { text: question },
          answers: answers.map((text) => ({ text })),
          duration: durationHours,
          allowMultiselect,
        },
        allowedMentions: { parse: [] },
      }),
  );
  console.log(
    `🗳️ [DiscordActionService] Poll posted in #${channel.name} for ${requester.user.username}: ${question}`,
  );
  return { messageId: message.id, url: message.url };
}

// ─── Thread ───────────────────────────────────────────────────────────

function readAutoArchiveMinutes(value: unknown): ThreadAutoArchiveDuration {
  if (value === undefined || value === null || value === "") {
    return THREAD_AUTO_ARCHIVE_MINUTES_DEFAULT as ThreadAutoArchiveDuration;
  }
  const minutes = Number(value);
  if (!(THREAD_AUTO_ARCHIVE_MINUTES as readonly number[]).includes(minutes)) {
    throw new ActionError(
      400,
      `autoArchiveMinutes must be one of ${THREAD_AUTO_ARCHIVE_MINUTES.join(", ")}.`,
    );
  }
  return minutes as ThreadAutoArchiveDuration;
}

/** The message a thread starts from — it must be in this channel. */
async function fetchStarterMessage(
  channel: GuildTextBasedChannel,
  messageId: string,
): Promise<Message> {
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    throw new ActionError(404, "That message isn't in this channel.");
  }
  if (message.hasThread) {
    const existing = message.thread?.url;
    throw new ActionError(
      409,
      `That message already has a thread${existing ? `: ${existing}` : "."}`,
    );
  }
  return message;
}

/**
 * Starts a public thread in the conversation's channel — from
 * `messageId` when given (it must be in this channel), else a new one.
 * The requester needs Create Public Threads; one per channel per window.
 */
export async function createThread(
  client: Client,
  body: ActionBody,
): Promise<{ threadId: string; url: string }> {
  const name = readText(body.name, "name", THREAD_NAME_MAX_LENGTH);
  const messageId = readOptionalSnowflake(body.messageId, "messageId");
  const autoArchiveDuration = readAutoArchiveMinutes(body.autoArchiveMinutes);

  const { guild, channel, requester } = await resolveActionContext(client, body);
  if (channel.isThread()) {
    throw new ActionError(
      400,
      "This conversation is already in a thread — Lupos can't start a thread inside a thread.",
    );
  }
  const isText = channel.type === ChannelType.GuildText;
  const isAnnouncement = channel.type === ChannelType.GuildAnnouncement;
  if (!isText && !isAnnouncement) {
    throw new ActionError(
      400,
      "Threads can only be started in text or announcement channels.",
    );
  }
  if (isAnnouncement && !messageId) {
    throw new ActionError(
      400,
      "In an announcement channel a thread has to start from a message — give its messageId.",
    );
  }

  const readHistory = messageId ? [PermissionFlagsBits.ReadMessageHistory] : [];
  assertRequesterCan(
    channel,
    requester,
    [PermissionFlagsBits.CreatePublicThreads, ...readHistory],
    "create threads",
  );
  const bot = await resolveBotMember(guild);
  assertBotCan(
    channel,
    bot,
    [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.CreatePublicThreads,
      ...readHistory,
    ],
    "create threads",
  );
  assertClean([name]);
  const starter = messageId ? await fetchStarterMessage(channel, messageId) : null;

  const reason = auditReason(requester);
  const thread = await withCooldown(
    threadCooldown,
    channel.id,
    (wait) =>
      `Lupos already started a thread in this channel in the last 10 minutes — the next one can start in ${wait}.`,
    async () => {
      if (starter) {
        return starter.startThread({ name, autoArchiveDuration, reason });
      }
      if (channel.type !== ChannelType.GuildText) {
        // Unreachable (announcement channels need a starter, checked
        // above) — narrows the type for threads.create.
        throw new ActionError(400, "Threads need a starter message here.");
      }
      return channel.threads.create({
        name,
        autoArchiveDuration,
        type: ChannelType.PublicThread,
        reason,
      });
    },
  );
  console.log(
    `🧵 [DiscordActionService] Thread "${name}" started in #${channel.name} for ${requester.user.username}`,
  );
  return { threadId: thread.id, url: thread.url };
}

// ─── Nickname ─────────────────────────────────────────────────────────

/**
 * Sets Lupos's OWN nickname in the conversation's guild ("" resets it).
 * One change per guild per window; setting the current name is a no-op
 * that spends nothing.
 */
export async function setOwnNickname(
  client: Client,
  body: ActionBody,
): Promise<{ nickname: string; unchanged?: true }> {
  if (typeof body.nickname !== "string") {
    throw new ActionError(
      400,
      "nickname must be a string (an empty string resets it).",
    );
  }
  const nickname = body.nickname.trim();
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    throw new ActionError(
      400,
      `nickname is too long (${nickname.length} characters, the limit is ${NICKNAME_MAX_LENGTH}).`,
    );
  }

  const { guild, channel, requester } = await resolveActionContext(client, body);
  assertRequesterCan(channel, requester, [], "ask Lupos for that");
  const bot = await resolveBotMember(guild);
  if (!bot.permissions.has(PermissionFlagsBits.ChangeNickname)) {
    throw new ActionError(
      403,
      "Lupos doesn't have permission to change his nickname in this server (missing: Change Nickname).",
    );
  }
  assertClean([nickname]);
  if ((bot.nickname ?? "") === nickname) {
    return { nickname, unchanged: true };
  }

  await withCooldown(
    nicknameCooldown,
    guild.id,
    (wait) =>
      `Lupos already changed his nickname in the last 10 minutes — he can change it again in ${wait}.`,
    () => bot.setNickname(nickname || null, auditReason(requester)),
  );
  console.log(
    `🏷️ [DiscordActionService] Nickname in ${guild.name} set to "${nickname || "(reset)"}" for ${requester.user.username}`,
  );
  return { nickname };
}

// ─── React (existing route, tightened) ────────────────────────────────

/**
 * POST /guild/react's scope rules: with `scopeGuildId` the target
 * channel must be in that guild; with `requesterUserId` the requester
 * must be able to see it (a reaction is a message oracle otherwise).
 * Returns the guild the reaction runs in; throws ActionError(403/400).
 */
export async function checkReactScope(
  client: Client,
  body: ActionBody,
  fallbackGuildId: string | undefined,
): Promise<string | undefined> {
  const scopeGuildId = body.scopeGuildId;
  const channelId = String(body.channelId);
  let guildId = (body.guildId as string | undefined) || fallbackGuildId;

  if (scopeGuildId !== undefined && scopeGuildId !== null && scopeGuildId !== "") {
    if (body.guildId && body.guildId !== scopeGuildId) {
      throw new ActionError(403, SCOPE_ERROR);
    }
    const target =
      client.channels.cache.get(channelId) ??
      (await client.channels.fetch(channelId).catch(() => null));
    const targetGuildId =
      target && "guildId" in target ? (target.guildId as string | null) : null;
    if (target && targetGuildId !== scopeGuildId) {
      throw new ActionError(403, SCOPE_ERROR);
    }
    guildId = String(scopeGuildId);
  }

  const requesterUserId = body.requesterUserId;
  if (requesterUserId !== undefined && requesterUserId !== null && requesterUserId !== "") {
    if (!isSnowflake(requesterUserId)) {
      throw new ActionError(400, "requesterUserId must be a Discord id.");
    }
    const guild = guildId ? client.guilds.cache.get(guildId) : undefined;
    const channel = guild?.channels.cache.get(channelId);
    if (guild && channel) {
      const requester = await fetchMember(guild, requesterUserId);
      const canView =
        requester &&
        channel
          .permissionsFor(requester)
          ?.has(PermissionFlagsBits.ViewChannel);
      if (!canView) {
        throw new ActionError(
          403,
          "That's in a channel you can't see, so Lupos won't react there.",
        );
      }
    }
  }
  return guildId;
}
