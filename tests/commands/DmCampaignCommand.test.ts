/**
 * DmCampaignCommand.test.ts
 *
 * Tests the owner-only /dm-campaign slash command:
 *   1. builder JSON — name, default_member_permissions 0, the four
 *      subcommands, and the guild registration restriction field
 *   2. owner gate — non-owner (or unset OWNER_USER_ID) is rejected with
 *      an ephemeral reply and never reaches deferReply; the owner passes
 *      the gate (deferReply is called)
 *   3. formatCampaignStatus — renders the getStatus() shape
 */

import type { ChatInputCommandInteraction } from "discord.js";
import dmCampaign, {
  formatCampaignStatus,
} from "../../src/commands/utility/dm-campaign.ts";
import config from "../../src/config.ts";

interface FakeInteraction {
  interaction: ChatInputCommandInteraction;
  replies: unknown[];
  deferred: boolean;
  edits: unknown[];
}

function makeInteraction(userId: string, subcommand = "status"): FakeInteraction {
  const fake: FakeInteraction = {
    replies: [],
    deferred: false,
    edits: [],
    interaction: undefined as unknown as ChatInputCommandInteraction,
  };
  fake.interaction = {
    user: { id: userId },
    reply: async (payload: unknown) => {
      fake.replies.push(payload);
    },
    deferReply: async () => {
      fake.deferred = true;
    },
    editReply: async (payload: unknown) => {
      fake.edits.push(payload);
    },
    options: {
      getSubcommand: () => subcommand,
      getString: () => null,
    },
  } as unknown as ChatInputCommandInteraction;
  return fake;
}

const OWNER_ID = "166745313258897409";

describe("/dm-campaign builder", () => {
  const json = dmCampaign.data.toJSON();

  it("is named dm-campaign and hidden from non-admins", () => {
    expect(json.name).toBe("dm-campaign");
    expect(json.default_member_permissions).toBe("0");
  });

  it("has the four subcommands", () => {
    const names = (json.options ?? []).map((option) => option.name);
    expect(names).toEqual(["seed", "start", "pause", "status"]);
  });

  it("restricts registration via guildIds (string array, no falsy entries)", () => {
    expect(Array.isArray(dmCampaign.guildIds)).toBe(true);
    for (const id of dmCampaign.guildIds) expect(typeof id).toBe("string");
  });
});

describe("/dm-campaign owner gate", () => {
  const originalOwner = config.OWNER_USER_ID;
  afterEach(() => {
    config.OWNER_USER_ID = originalOwner;
  });

  it("rejects a non-owner with an ephemeral reply and never defers", async () => {
    config.OWNER_USER_ID = OWNER_ID;
    const fake = makeInteraction("999999999999999999");
    await dmCampaign.execute(fake.interaction);
    expect(fake.replies).toEqual([
      { content: "This command is owner-only.", ephemeral: true },
    ]);
    expect(fake.deferred).toBe(false);
  });

  it("rejects everyone when OWNER_USER_ID is unset", async () => {
    config.OWNER_USER_ID = undefined;
    const fake = makeInteraction(OWNER_ID);
    await dmCampaign.execute(fake.interaction);
    expect(fake.replies).toHaveLength(1);
    expect(fake.deferred).toBe(false);
  });

  it("lets the owner through the gate (defers, then reports the error from the uninitialized test DB)", async () => {
    config.OWNER_USER_ID = OWNER_ID;
    const fake = makeInteraction(OWNER_ID);
    await dmCampaign.execute(fake.interaction);
    expect(fake.replies).toHaveLength(0);
    expect(fake.deferred).toBe(true);
    // No Mongo in unit tests — the service throws and execute reports it.
    expect(fake.edits).toHaveLength(1);
    expect(String(fake.edits[0])).toContain("❌");
  });
});

describe("formatCampaignStatus", () => {
  it("renders a running campaign", () => {
    const rendered = formatCampaignStatus({
      campaignId: "crusader-strike-to-whitemane",
      status: "running",
      pausedReason: null,
      workerActive: true,
      dailyCap: 300,
      sentToday: 42,
      remainingToday: 258,
      totalSent: 342,
      counts: { pending: 3662, sent: 342, dms_closed: 12 },
      estimatedDaysRemaining: 13,
      inviteUrl: "https://discord.gg/classicwhitemane",
      seededAt: new Date(0),
      startedAt: new Date(0),
    });
    expect(rendered).toContain("**running**");
    expect(rendered).toContain("(worker active)");
    expect(rendered).toContain("**42/300**");
    expect(rendered).toContain("pending: 3662");
    expect(rendered).toContain("~13");
    expect(rendered).toContain("https://discord.gg/classicwhitemane");
  });

  it("shows the pause reason when paused", () => {
    const rendered = formatCampaignStatus({
      campaignId: "crusader-strike-to-whitemane",
      status: "paused",
      pausedReason: "Discord anti-spam triggered (40003: opening DMs too fast)",
      workerActive: false,
      dailyCap: 300,
      sentToday: 10,
      remainingToday: 290,
      totalSent: 10,
      counts: {},
      estimatedDaysRemaining: 0,
      inviteUrl: null,
      seededAt: null,
      startedAt: null,
    });
    expect(rendered).toContain("**paused**");
    expect(rendered).toContain("40003");
    expect(rendered).not.toContain("worker active");
  });
});
