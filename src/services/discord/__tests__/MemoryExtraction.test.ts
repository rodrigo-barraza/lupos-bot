import { afterEach, describe, it, expect, vi } from "vitest";
import { Collection } from "discord.js";
import type { Channel, GuildMember, User } from "discord.js";
import config from "#root/config.ts";
import PrismService from "#root/services/PrismService.ts";
import {
  buildMemoryParticipants,
  isVisibleToEveryone,
} from "../MemoryExtraction.ts";

// Contract §7: Prism's /memory/extract attributes facts by participant
// id/username, and Lupos only mines channels @everyone can see.

function user(id: string, username: string, globalName?: string): User {
  return { id, username, globalName: globalName ?? null } as unknown as User;
}

function member(u: User, displayName: string): GuildMember {
  return { id: u.id, user: u, displayName } as unknown as GuildMember;
}

describe("buildMemoryParticipants", () => {
  it("sends { id, username, displayName } objects, preferring the server nickname", () => {
    const alice = user("111", "alice_01", "Alice");
    const bob = user("222", "bobby");
    const participants = new Collection<
      string,
      { user: User; member: GuildMember | null }
    >([
      ["111", { user: alice, member: member(alice, "Queen Alice") }],
      ["222", { user: bob, member: null }],
    ]);
    expect(buildMemoryParticipants(participants, undefined)).toEqual([
      { id: "111", username: "alice_01", displayName: "Queen Alice" },
      { id: "222", username: "bobby", displayName: "bobby" },
    ]);
  });

  it("adds mentioned members once, after the authors", () => {
    const alice = user("111", "alice_01", "Alice");
    const carol = user("333", "carol", "Carol");
    const participants = new Collection<
      string,
      { user: User; member: GuildMember | null }
    >([["111", { user: alice, member: null }]]);
    const mentions = new Collection<string, GuildMember>([
      ["111", member(alice, "Queen Alice")],
      ["333", member(carol, "Caz")],
    ]);
    expect(buildMemoryParticipants(participants, mentions)).toEqual([
      { id: "111", username: "alice_01", displayName: "Alice" },
      { id: "333", username: "carol", displayName: "Caz" },
    ]);
  });

  it("returns nothing for an empty conversation", () => {
    expect(buildMemoryParticipants(undefined, undefined)).toEqual([]);
  });
});

/** A guild channel whose @everyone permissions allow `viewChannel`. */
function guildChannel(viewChannel: boolean, overrides: Record<string, unknown> = {}) {
  const everyone = { id: "everyone-role" };
  const channel = {
    isDMBased: () => false,
    isThread: () => false,
    guild: { roles: { everyone } },
    permissionsFor: (role: unknown) => ({
      has: (permission: string) =>
        role === everyone && permission === "ViewChannel" && viewChannel,
    }),
    ...overrides,
  };
  return channel;
}

describe("isVisibleToEveryone", () => {
  it("is true for a channel @everyone can view", () => {
    expect(isVisibleToEveryone(guildChannel(true) as unknown as Channel)).toBe(true);
  });

  it("is false for a private channel", () => {
    expect(isVisibleToEveryone(guildChannel(false) as unknown as Channel)).toBe(false);
  });

  it("answers a thread by its parent", () => {
    const publicParentThread = {
      isDMBased: () => false,
      isThread: () => true,
      parent: guildChannel(true),
    };
    const privateParentThread = { ...publicParentThread, parent: guildChannel(false) };
    expect(isVisibleToEveryone(publicParentThread as unknown as Channel)).toBe(true);
    expect(isVisibleToEveryone(privateParentThread as unknown as Channel)).toBe(false);
  });

  it("is false for DMs, orphaned threads, missing permission data and errors", () => {
    expect(isVisibleToEveryone(null)).toBe(false);
    expect(isVisibleToEveryone({ isDMBased: () => true } as unknown as Channel)).toBe(false);
    expect(
      isVisibleToEveryone({
        isDMBased: () => false,
        isThread: () => true,
        parent: null,
      } as unknown as Channel),
    ).toBe(false);
    expect(
      isVisibleToEveryone(
        guildChannel(true, { permissionsFor: () => null }) as unknown as Channel,
      ),
    ).toBe(false);
    expect(
      isVisibleToEveryone(
        guildChannel(true, {
          permissionsFor: () => {
            throw new Error("role not cached");
          },
        }) as unknown as Channel,
      ),
    ).toBe(false);
  });
});

describe("PrismService.extractMemories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts participants as objects, not display-name strings", async () => {
    config.PRISM_API_URL = "http://prism.test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ count: 0 }), { status: 200 });
      }),
    );
    await PrismService.extractMemories({
      guildId: "g1",
      channelId: "c1",
      messages: [{ role: "user", content: "i moved to lisbon" }],
      participants: [{ id: "111", username: "alice_01", displayName: "Alice" }],
      sourceMessageId: "m1",
    });
    expect(bodies).toEqual([
      {
        guildId: "g1",
        channelId: "c1",
        messages: [{ role: "user", content: "i moved to lisbon" }],
        participants: [{ id: "111", username: "alice_01", displayName: "Alice" }],
        sourceMessageId: "m1",
      },
    ]);
  });
});
