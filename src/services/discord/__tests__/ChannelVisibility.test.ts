// ============================================================
// ChannelVisibility.test.ts — GET /guild/visible-channels' rules
// ============================================================
// A channel is readable with ViewChannel AND ReadMessageHistory (for
// the member, or @everyone when there is none); threads follow their
// parent, except private threads the member is not known to be in.
// ============================================================

import { describe, it, expect } from "vitest";
import { ChannelType } from "discord.js";
import {
  HIDDEN_CHANNEL_ERROR,
  computeVisibleChannels,
  scopeStatsToRequester,
} from "#root/services/discord/ChannelVisibility.ts";
import {
  GUILD_ID,
  ManageThreads,
  ReadMessageHistory,
  REQUESTER_ID,
  STRANGER_ID,
  SendMessages,
  ViewChannel,
  asGuild,
  asMember,
  makeChannel,
  makeGuild,
  makeMember,
} from "#root/services/__tests__/support/fakeDiscord.ts";

const READ = [ViewChannel, ReadMessageHistory];

function buildGuild() {
  const general = makeChannel({
    id: "210000000000000001",
    name: "general",
    grants: { [GUILD_ID]: READ, [REQUESTER_ID]: READ },
  });
  const staff = makeChannel({
    id: "210000000000000002",
    name: "staff",
    grants: { [GUILD_ID]: [], [REQUESTER_ID]: [] },
  });
  const members = makeChannel({
    id: "210000000000000003",
    name: "members-only",
    grants: { [GUILD_ID]: [], [REQUESTER_ID]: READ },
  });
  const noHistory = makeChannel({
    id: "210000000000000004",
    name: "announcements-no-history",
    grants: { [GUILD_ID]: [ViewChannel, SendMessages], [REQUESTER_ID]: [ViewChannel] },
  });
  const voice = makeChannel({
    id: "210000000000000005",
    name: "voice",
    type: ChannelType.GuildVoice,
    grants: { [GUILD_ID]: READ, [REQUESTER_ID]: READ },
  });
  const category = makeChannel({
    id: "210000000000000006",
    name: "category",
    type: ChannelType.GuildCategory,
    grants: { [GUILD_ID]: READ, [REQUESTER_ID]: READ },
  });
  const forum = makeChannel({
    id: "210000000000000007",
    name: "forum",
    type: ChannelType.GuildForum,
    grants: { [GUILD_ID]: READ, [REQUESTER_ID]: READ },
  });

  const publicThread = makeChannel({
    id: "220000000000000001",
    type: ChannelType.PublicThread,
    parent: general,
  });
  const staffThread = makeChannel({
    id: "220000000000000002",
    type: ChannelType.PublicThread,
    parent: staff,
  });
  const privateWithRequester = makeChannel({
    id: "220000000000000003",
    type: ChannelType.PrivateThread,
    parent: general,
    threadMemberIds: [REQUESTER_ID],
  });
  const privateWithout = makeChannel({
    id: "220000000000000004",
    type: ChannelType.PrivateThread,
    parent: general,
  });
  const forumPost = makeChannel({
    id: "220000000000000005",
    type: ChannelType.PublicThread,
    parent: forum,
  });
  // Only in its parent's threads.cache, not in guild.channels.cache.
  const archivedInParentCache = makeChannel({
    id: "220000000000000006",
    type: ChannelType.PublicThread,
    parent: members,
  });
  members.threads.cache.set(archivedInParentCache.id, archivedInParentCache);

  const guild = makeGuild({
    channels: [
      general,
      staff,
      members,
      noHistory,
      voice,
      category,
      forum,
      publicThread,
      staffThread,
      privateWithRequester,
      privateWithout,
      forumPost,
    ],
  });
  return { guild };
}

describe("computeVisibleChannels", () => {
  it("with no member lists what @everyone can read, and no private threads", () => {
    const { guild } = buildGuild();
    const visible = computeVisibleChannels(asGuild(guild), null);
    expect(visible.channelIds.sort()).toEqual([
      "210000000000000001", // general
      "210000000000000005", // voice text chat
      "210000000000000007", // forum (its posts are threads)
    ]);
    expect(visible.threadIds.sort()).toEqual([
      "220000000000000001", // public thread in #general
      "220000000000000005", // forum post
    ]);
  });

  it("for a member uses their permissions and the threads they are in", () => {
    const { guild } = buildGuild();
    const member = makeMember({ id: REQUESTER_ID });
    const visible = computeVisibleChannels(asGuild(guild), asMember(member));
    expect(visible.channelIds).toContain("210000000000000003"); // members-only
    expect(visible.channelIds).not.toContain("210000000000000002"); // staff
    expect(visible.threadIds).toContain("220000000000000003"); // private, joined
    expect(visible.threadIds).not.toContain("220000000000000004"); // private, not joined
    expect(visible.threadIds).not.toContain("220000000000000002"); // under #staff
    expect(visible.threadIds).toContain("220000000000000006"); // parent-cache only
  });

  it("needs ReadMessageHistory, not just ViewChannel", () => {
    const { guild } = buildGuild();
    const member = makeMember({ id: REQUESTER_ID });
    const visible = computeVisibleChannels(asGuild(guild), asMember(member));
    expect(visible.channelIds).not.toContain("210000000000000004");
    expect(computeVisibleChannels(asGuild(guild), null).channelIds).not.toContain(
      "210000000000000004",
    );
  });

  it("never lists categories or threads as channels", () => {
    const { guild } = buildGuild();
    const visible = computeVisibleChannels(asGuild(guild), null);
    expect(visible.channelIds).not.toContain("210000000000000006");
    expect(visible.channelIds.some((id) => id.startsWith("22"))).toBe(false);
  });

  it("shows a private thread to a member who can manage threads", () => {
    const { guild } = buildGuild();
    const general = guild.channels.cache.get("210000000000000001")!;
    general.grants[REQUESTER_ID] = [...READ, ManageThreads];
    const visible = computeVisibleChannels(
      asGuild(guild),
      asMember(makeMember({ id: REQUESTER_ID })),
    );
    expect(visible.threadIds).toContain("220000000000000004");
  });
});

describe("scopeStatsToRequester", () => {
  function guildWithRequester() {
    const { guild } = buildGuild();
    const requester = makeMember({ id: REQUESTER_ID });
    guild.members.cache.set(REQUESTER_ID, requester);
    return guild;
  }

  it("without a requester keeps today's behaviour", async () => {
    const guild = guildWithRequester();
    expect(await scopeStatsToRequester(asGuild(guild), undefined, undefined)).toEqual({
      allowed: true,
      channelFilter: null,
    });
    expect(
      await scopeStatsToRequester(asGuild(guild), "", "210000000000000002"),
    ).toEqual({ allowed: true, channelFilter: "210000000000000002" });
  });

  it("with a requester limits a whole-guild query to what they can read", async () => {
    const guild = guildWithRequester();
    const scope = await scopeStatsToRequester(asGuild(guild), REQUESTER_ID, undefined);
    expect(scope.allowed).toBe(true);
    const filter = (scope as { channelFilter: { $in: string[] } }).channelFilter;
    const expected = computeVisibleChannels(
      asGuild(guild),
      asMember(guild.members.cache.get(REQUESTER_ID)),
    );
    expect(filter.$in.sort()).toEqual(
      [...expected.channelIds, ...expected.threadIds].sort(),
    );
    expect(filter.$in).not.toContain("210000000000000002"); // #staff
    expect(filter.$in).not.toContain("220000000000000002"); // thread under #staff
    expect(filter.$in).not.toContain("220000000000000004"); // private, not joined
  });

  it("keeps an explicit channel the requester can read, refuses one they cannot", async () => {
    const guild = guildWithRequester();
    expect(
      await scopeStatsToRequester(asGuild(guild), REQUESTER_ID, "210000000000000001"),
    ).toEqual({ allowed: true, channelFilter: "210000000000000001" });
    expect(
      await scopeStatsToRequester(asGuild(guild), REQUESTER_ID, "210000000000000002"),
    ).toEqual({ allowed: false, status: 403, error: HIDDEN_CHANNEL_ERROR });
  });

  it("404s a requester who is not a member, 400s a malformed id", async () => {
    const guild = guildWithRequester();
    expect(await scopeStatsToRequester(asGuild(guild), STRANGER_ID, undefined)).toMatchObject({
      allowed: false,
      status: 404,
    });
    expect(await scopeStatsToRequester(asGuild(guild), "someone", undefined)).toMatchObject({
      allowed: false,
      status: 400,
    });
  });
});
