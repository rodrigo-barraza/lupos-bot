// ============================================================
// fakeDiscord — mocked discord.js guild/channel/member objects
// ============================================================
// Plain objects with the handful of methods the agent actions call.
// Permissions use discord.js's REAL PermissionsBitField, granted per
// subject id (a member id, or the guild id for @everyone) per channel,
// so permission checks run exactly as they would against Discord.
// ============================================================

import { vi } from "vitest";
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Client, Guild, GuildMember } from "discord.js";

export const GUILD_ID = "100000000000000001";
export const OTHER_GUILD_ID = "100000000000000002";
export const CHANNEL_ID = "200000000000000001";
export const OTHER_CHANNEL_ID = "200000000000000002";
export const FOREIGN_CHANNEL_ID = "200000000000000009";
export const MESSAGE_ID = "400000000000000001";
export const REQUESTER_ID = "300000000000000001";
export const STRANGER_ID = "300000000000000002";
export const BOT_ID = "300000000000000099";

export const {
  ViewChannel,
  SendMessages,
  SendMessagesInThreads,
  SendPolls,
  ReadMessageHistory,
  CreatePublicThreads,
  ManageThreads,
  ChangeNickname,
} = PermissionFlagsBits;

/** What a regular member can do in a normal text channel. */
export const MEMBER_FLAGS = [
  ViewChannel,
  SendMessages,
  SendMessagesInThreads,
  ReadMessageHistory,
  SendPolls,
  CreatePublicThreads,
];

const THREAD_TYPES: number[] = [
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];
const NON_TEXT_TYPES: number[] = [
  ChannelType.GuildCategory,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
];

export interface FakeMessage {
  id: string;
  hasThread: boolean;
  thread: { url: string } | null;
  startThread: ReturnType<typeof vi.fn>;
}

export function makeMessage(
  id = MESSAGE_ID,
  { existingThreadUrl }: { existingThreadUrl?: string } = {},
): FakeMessage {
  return {
    id,
    hasThread: Boolean(existingThreadUrl),
    thread: existingThreadUrl ? { url: existingThreadUrl } : null,
    startThread: vi.fn(async ({ name }: { name: string }) => ({
      id: "500000000000000001",
      name,
      url: `https://discord.com/channels/${GUILD_ID}/500000000000000001`,
    })),
  };
}

export interface FakeChannelOptions {
  id?: string;
  name?: string;
  type?: ChannelType;
  guildId?: string;
  parentId?: string | null;
  /** subject id (member id, or guild id = @everyone) → granted flags */
  grants?: Record<string, bigint[]>;
  messages?: FakeMessage[];
  /** For threads: permissions come from this parent, like discord.js. */
  parent?: FakeChannel;
  threadMemberIds?: string[];
}

export type FakeChannel = ReturnType<typeof makeChannel>;

export function makeChannel(options: FakeChannelOptions = {}) {
  const id = options.id ?? CHANNEL_ID;
  const guildId = options.guildId ?? GUILD_ID;
  const type = options.type ?? ChannelType.GuildText;
  const messages = new Map((options.messages ?? []).map((m) => [m.id, m]));
  const channel = {
    id,
    name: options.name ?? "general",
    type,
    guildId,
    parentId: options.parentId ?? options.parent?.id ?? null,
    grants: options.grants ?? {},
    isThread: () => THREAD_TYPES.includes(type),
    isTextBased: () => !NON_TEXT_TYPES.includes(type),
    isSendable: () => !NON_TEXT_TYPES.includes(type),
    permissionsFor(subject: string | { id: string }) {
      if (options.parent) return options.parent.permissionsFor(subject);
      const subjectId = typeof subject === "string" ? subject : subject.id;
      return new PermissionsBitField(channel.grants[subjectId] ?? []).freeze();
    },
    send: vi.fn(async (_payload: unknown) => ({
      id: "600000000000000001",
      url: `https://discord.com/channels/${guildId}/${id}/600000000000000001`,
    })),
    messages: {
      fetch: vi.fn(async (messageId: string) => {
        const message = messages.get(messageId);
        if (!message) throw Object.assign(new Error("Unknown Message"), { code: 10008, status: 404 });
        return message;
      }),
    },
    threads: {
      cache: new Map<string, unknown>(),
      create: vi.fn(async ({ name }: { name: string }) => ({
        id: "500000000000000002",
        name,
        url: `https://discord.com/channels/${guildId}/500000000000000002`,
      })),
    },
    members: { cache: new Map((options.threadMemberIds ?? []).map((m) => [m, {}])) },
  };
  return channel;
}

export interface FakeMemberOptions {
  id?: string;
  username?: string;
  timedOut?: boolean;
  nickname?: string | null;
  guildFlags?: bigint[];
}

export function makeMember(options: FakeMemberOptions = {}) {
  const id = options.id ?? REQUESTER_ID;
  const member = {
    id,
    user: { id, username: options.username ?? `user-${id.slice(-2)}`, bot: false },
    nickname: options.nickname ?? null,
    permissions: new PermissionsBitField(options.guildFlags ?? []).freeze(),
    isCommunicationDisabled: () => options.timedOut ?? false,
    setNickname: vi.fn(async (nickname: string | null) => {
      member.nickname = nickname;
      return member;
    }),
  };
  return member;
}

export type FakeMember = ReturnType<typeof makeMember>;

export interface FakeGuildOptions {
  id?: string;
  channels?: FakeChannel[];
  members?: FakeMember[];
  me?: FakeMember | null;
}

export function makeGuild(options: FakeGuildOptions = {}) {
  const id = options.id ?? GUILD_ID;
  const channels = new Map((options.channels ?? []).map((c) => [c.id, c]));
  const members = new Map((options.members ?? []).map((m) => [m.id, m]));
  const me = options.me === undefined ? makeMember({ id: BOT_ID, username: "Lupos" }) : options.me;
  if (me) members.set(me.id, me);
  return {
    id,
    name: "Test Guild",
    roles: { everyone: { id } },
    channels: {
      cache: channels,
      fetch: vi.fn(async (channelId: string) => {
        const channel = channels.get(channelId);
        if (!channel) throw Object.assign(new Error("Unknown Channel"), { code: 10003, status: 404 });
        return channel;
      }),
    },
    members: {
      // Cache misses fall through to fetch, like the real manager.
      cache: new Map<string, FakeMember>(),
      me,
      fetch: vi.fn(async (userId: string) => {
        const member = members.get(userId);
        if (!member) throw Object.assign(new Error("Unknown Member"), { code: 10007, status: 404 });
        return member;
      }),
      fetchMe: vi.fn(async () => me),
    },
  };
}

export type FakeGuild = ReturnType<typeof makeGuild>;

export function makeClient(guilds: FakeGuild[], extraChannels: FakeChannel[] = []) {
  const channels = new Map<string, FakeChannel>();
  for (const guild of guilds) {
    for (const channel of guild.channels.cache.values()) channels.set(channel.id, channel);
  }
  for (const channel of extraChannels) channels.set(channel.id, channel);
  const guildCache = new Map(guilds.map((g) => [g.id, g]));
  return {
    user: { id: BOT_ID },
    guilds: {
      cache: guildCache,
      fetch: vi.fn(async (guildId: string) => {
        const guild = guildCache.get(guildId);
        if (!guild) throw Object.assign(new Error("Unknown Guild"), { code: 10004, status: 404 });
        return guild;
      }),
    },
    channels: {
      cache: channels,
      fetch: vi.fn(async (channelId: string) => channels.get(channelId) ?? null),
    },
  };
}

export const asClient = (client: unknown) => client as Client;
export const asGuild = (guild: unknown) => guild as Guild;
export const asMember = (member: unknown) => member as GuildMember;

/**
 * The standard scene: one guild, #general where the requester and the
 * bot can do everything a member can, a requester, and the bot.
 */
export function makeScene(
  overrides: {
    requester?: FakeMemberOptions;
    requesterFlags?: bigint[];
    botFlags?: bigint[];
    botGuildFlags?: bigint[];
    channel?: FakeChannelOptions;
  } = {},
) {
  const requester = makeMember({ id: REQUESTER_ID, ...overrides.requester });
  const bot = makeMember({
    id: BOT_ID,
    username: "Lupos",
    guildFlags: overrides.botGuildFlags ?? [ChangeNickname],
  });
  const channel = makeChannel({
    grants: {
      [REQUESTER_ID]: overrides.requesterFlags ?? MEMBER_FLAGS,
      [BOT_ID]: overrides.botFlags ?? MEMBER_FLAGS,
    },
    messages: [makeMessage()],
    ...overrides.channel,
  });
  const guild = makeGuild({ channels: [channel], members: [requester], me: bot });
  const client = makeClient([guild]);
  return { requester, bot, channel, guild, client };
}

/** The conversation context tools-service forwards on every action. */
export function conversationBody(extra: Record<string, unknown> = {}) {
  return {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    requesterUserId: REQUESTER_ID,
    scopeGuildId: GUILD_ID,
    ...extra,
  };
}
