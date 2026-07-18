// ── Message Archive BSON Serialization Tests ─────────────────────────────────
// Regression test for a BSONError ("Cannot convert circular structure to BSON")
// in the messageCreate clone handler. transformMessageRoot leaked live
// discord.js objects into the Mongo document:
//   - author.dmChannel (a live DMChannel, cached once a user DMs the bot)
//   - message.interaction / interactionMetadata (both carry a live User)
//   - message.components (component class instances)
// All live discord.js objects hold a client reference, which is circular.
// These tests build mocks with real circular references at exactly those
// spots and assert the transformed document serializes cleanly with no
// information loss.

import { describe, it, expect } from "vitest";
import { BSON } from "mongodb";
import type { Message } from "discord.js";
import {
  transformMessageRoot,
  transformMessageInteraction,
  transformMessageInteractionMetadata,
} from "#root/services/discord/transformers.js";

// Minimal Collection stand-in (only what transformMessageRoot touches)
const collection = <T>(items: T[]) => ({
  size: items.length,
  map: <R>(fn: (item: T) => R) => items.map(fn),
  values: () => items.values(),
  cache: undefined as unknown,
});

/** A discord.js-style circular object graph: client ⇄ everything */
const buildCircularClient = () => {
  const client: Record<string, unknown> = {};
  client.channels = { cache: new Map(), client };
  client.users = { cache: new Map(), client };
  return client;
};

const buildCircularUser = (id: string) => {
  const client = buildCircularClient();
  const user: Record<string, unknown> = {
    id,
    username: `user-${id}`,
    displayName: `User ${id}`,
    globalName: `User ${id}`,
    tag: `user-${id}#0`,
    bot: false,
    client,
  };
  // Live cached DMChannel — the exact shape that triggered the crash
  const dmChannel: Record<string, unknown> = { id: `dm-${id}`, client };
  (client.channels as { cache: Map<string, unknown> }).cache.set(
    dmChannel.id as string,
    dmChannel,
  );
  (client.users as { cache: Map<string, unknown> }).cache.set(id, user);
  user.dmChannel = dmChannel;
  return user;
};

const buildMockMessage = () => {
  const author = buildCircularUser("166745313258897409");
  const guild = { id: "g1", name: "Classic+ Whitemane", icon: null };
  const channel = {
    id: "c1",
    name: "politics",
    guild,
    guildId: "g1",
    parent: null,
    parentId: null,
    type: 0,
    partial: false,
    flags: { bitfield: 0 },
    url: "https://discord.com/channels/g1/c1",
  };

  // Component class instance: circular via .client, lossless via toJSON()
  const componentData = {
    type: 1,
    components: [{ type: 2, style: 1, label: "Click", custom_id: "btn" }],
  };
  const component: Record<string, unknown> = {
    data: componentData,
    client: author.client,
    toJSON: () => componentData,
  };

  const interactionUser = buildCircularUser("999");
  const message = {
    activity: null,
    applicationId: null,
    attachments: collection([]),
    author,
    bulkDeletable: true,
    call: null,
    channel,
    channelId: "c1",
    cleanContent: "hello",
    components: [component],
    content: "hello",
    createdAt: new Date("2026-07-18T02:16:18Z"),
    createdTimestamp: 1784427378000,
    crosspostable: false,
    deletable: true,
    editable: false,
    editedAt: null,
    editedTimestamp: null,
    embeds: [],
    flags: { bitfield: 0 },
    guild,
    guildId: "g1",
    hasThread: false,
    id: "1527861544275153026",
    interaction: {
      id: "i1",
      type: 2,
      commandName: "test",
      user: interactionUser,
    },
    interactionMetadata: {
      id: "i1",
      type: 2,
      user: interactionUser,
      authorizingIntegrationOwners: { "0": "g1" },
      originalResponseMessageId: null,
      interactedMessageId: null,
      triggeringInteractionMetadata: {
        id: "i0",
        type: 2,
        user: buildCircularUser("888"),
        authorizingIntegrationOwners: {},
        originalResponseMessageId: null,
        interactedMessageId: null,
        triggeringInteractionMetadata: null,
      },
    },
    member: null,
    mentions: undefined,
    messageSnapshots: undefined,
    nonce: null,
    partial: false,
    pinnable: true,
    pinned: false,
    poll: null,
    position: null,
    reactions: { cache: collection([]) },
    reference: null,
    roleSubscriptionData: null,
    stickers: undefined,
    system: false,
    tts: false,
    type: 0,
    url: "https://discord.com/channels/g1/c1/1527861544275153026",
    webhookId: null,
  };
  return message as unknown as Message;
};

describe("transformMessageRoot BSON serialization", () => {
  it("mock actually contains circular references (sanity)", () => {
    const message = buildMockMessage();
    expect(() =>
      BSON.serialize({ dmChannel: message.author.dmChannel }),
    ).toThrow(/circular/i);
    expect(() =>
      BSON.serialize({ user: message.interaction!.user }),
    ).toThrow(/circular/i);
  });

  it("serializes a message whose author has a cached DM channel", () => {
    const document = transformMessageRoot(buildMockMessage());
    expect(() => BSON.serialize(document)).not.toThrow();
  });

  it("preserves the DM channel id instead of the live object", () => {
    const document = transformMessageRoot(buildMockMessage());
    const author = document.author as Record<string, unknown>;
    expect(author.dmChannelId).toBe("dm-166745313258897409");
    expect(author.dmChannel).toBeUndefined();
  });

  it("flattens interaction and interactionMetadata without losing fields", () => {
    const document = transformMessageRoot(buildMockMessage());
    expect(document.interaction).toEqual({
      id: "i1",
      type: 2,
      commandName: "test",
      user: {
        displayName: "User 999",
        globalName: "User 999",
        id: "999",
        tag: "user-999#0",
        username: "user-999",
      },
    });
    const metadata = document.interactionMetadata as Record<string, unknown>;
    expect(metadata.id).toBe("i1");
    expect(metadata.authorizingIntegrationOwners).toEqual({ "0": "g1" });
    const triggering = metadata.triggeringInteractionMetadata as Record<
      string,
      unknown
    >;
    expect((triggering.user as Record<string, unknown>).id).toBe("888");
    expect(triggering.triggeringInteractionMetadata).toBeNull();
  });

  it("stores components as plain API data via toJSON", () => {
    const document = transformMessageRoot(buildMockMessage());
    expect(document.components).toEqual([
      {
        type: 1,
        components: [{ type: 2, style: 1, label: "Click", custom_id: "btn" }],
      },
    ]);
  });

  it("null interaction fields stay null", () => {
    expect(transformMessageInteraction(null)).toBeNull();
    expect(transformMessageInteractionMetadata(null)).toBeNull();
  });
});
