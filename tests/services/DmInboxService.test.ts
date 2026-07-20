/**
 * DmInboxService.test.ts
 *
 * Tests the pure embed builder for the incoming-DM relay:
 *   1. author line, content, timestamp
 *   2. empty-content placeholder and 4096-char truncation
 *   3. attachments / stickers fields only when present
 *   4. campaign-target context field (with and without sentAt)
 */

import { buildInboxEmbed } from "../../src/services/discord/DmInboxService.ts";
import type { InboxMessageData } from "../../src/services/discord/DmInboxService.ts";

function makeData(overrides: Partial<InboxMessageData> = {}): InboxMessageData {
  return {
    authorTag: "thrall",
    authorId: "123456789012345678",
    authorAvatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
    content: "hey what is this server?",
    attachmentUrls: [],
    stickerNames: [],
    campaignTarget: null,
    createdAt: new Date(Date.UTC(2026, 6, 17, 12, 0, 0)),
    ...overrides,
  };
}

describe("buildInboxEmbed", () => {
  it("includes author tag+id and the message content", () => {
    const json = buildInboxEmbed(makeData()).toJSON();
    expect(json.author?.name).toBe("thrall (123456789012345678)");
    expect(json.description).toBe("hey what is this server?");
    expect(json.timestamp).toBeDefined();
  });

  it("uses a placeholder for empty content and truncates long content", () => {
    expect(buildInboxEmbed(makeData({ content: "" })).toJSON().description).toBe(
      "*(no text content)*",
    );
    const long = "x".repeat(5000);
    const description = buildInboxEmbed(makeData({ content: long })).toJSON()
      .description as string;
    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description.endsWith("…")).toBe(true);
  });

  it("adds attachments and stickers fields only when present", () => {
    const bare = buildInboxEmbed(makeData()).toJSON();
    expect(bare.fields ?? []).toEqual([]);

    const rich = buildInboxEmbed(
      makeData({
        attachmentUrls: ["https://cdn.discordapp.com/a.png"],
        stickerNames: ["wave"],
      }),
    ).toJSON();
    const names = (rich.fields ?? []).map((field) => field.name);
    expect(names).toEqual(["Attachments", "Stickers"]);
  });

  it("adds campaign context when the sender is a campaign target", () => {
    const json = buildInboxEmbed(
      makeData({
        campaignTarget: {
          status: "sent",
          sentAt: new Date(Date.UTC(2026, 6, 17, 11, 0, 0)),
        },
      }),
    ).toJSON();
    const field = (json.fields ?? []).find((f) => f.name === "DM campaign");
    expect(field?.value).toContain("**sent**");
    expect(field?.value).toContain("<t:");
  });

  it("omits the sentAt suffix when campaign sentAt is null", () => {
    const json = buildInboxEmbed(
      makeData({ campaignTarget: { status: "pending", sentAt: null } }),
    ).toJSON();
    const field = (json.fields ?? []).find((f) => f.name === "DM campaign");
    expect(field?.value).toBe("Target status: **pending**");
  });
});
