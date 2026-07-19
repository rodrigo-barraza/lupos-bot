import { describe, it, expect, vi } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { Client, NonThreadGuildBasedChannel } from "discord.js";
import {
  isPubliclyViewable,
  luposOnChannelCreate,
} from "../OnboardingDefaults.js";
import config from "#root/config.js";

/**
 * Community Onboarding hides any channel missing from default_channel_ids
 * from new members. These tests pin the add-on-create behavior: public
 * channels in the primary guild get appended to the existing defaults,
 * while private channels, foreign guilds, and disabled onboarding are
 * left untouched.
 */

function makeChannel(overrides: {
  guildId?: string;
  type?: ChannelType;
  everyoneCanView?: boolean;
  onboardingEnabled?: boolean;
  existingDefaultIds?: string[];
  editOnboarding?: ReturnType<typeof vi.fn>;
}) {
  const editOnboarding = overrides.editOnboarding ?? vi.fn();
  const defaultChannels = new Map(
    (overrides.existingDefaultIds ?? []).map((id) => [id, { id }]),
  );
  return {
    id: "new-channel-id",
    name: "new-channel",
    type: overrides.type ?? ChannelType.GuildText,
    guild: {
      id: overrides.guildId ?? (config.GUILD_ID_PRIMARY as string),
      roles: { everyone: { id: "everyone-role" } },
      fetchOnboarding: vi.fn().mockResolvedValue({
        enabled: overrides.onboardingEnabled ?? true,
        defaultChannels,
      }),
      editOnboarding,
    },
    permissionsFor: vi
      .fn()
      .mockReturnValue({ has: () => overrides.everyoneCanView ?? true }),
  } as unknown as NonThreadGuildBasedChannel;
}

const client = {} as Client;

describe("OnboardingDefaults", () => {
  it("appends a public channel to the existing defaults", async () => {
    const editOnboarding = vi.fn();
    const channel = makeChannel({
      existingDefaultIds: ["a", "b"],
      editOnboarding,
    });
    await luposOnChannelCreate(client, channel);
    expect(editOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultChannels: ["a", "b", "new-channel-id"],
      }),
    );
  });

  it("skips channels @everyone cannot view", async () => {
    const editOnboarding = vi.fn();
    const channel = makeChannel({ everyoneCanView: false, editOnboarding });
    await luposOnChannelCreate(client, channel);
    expect(editOnboarding).not.toHaveBeenCalled();
  });

  it("skips guilds other than the primary guild", async () => {
    const editOnboarding = vi.fn();
    const channel = makeChannel({ guildId: "some-other-guild", editOnboarding });
    await luposOnChannelCreate(client, channel);
    expect(editOnboarding).not.toHaveBeenCalled();
  });

  it("skips when onboarding is disabled", async () => {
    const editOnboarding = vi.fn();
    const channel = makeChannel({ onboardingEnabled: false, editOnboarding });
    await luposOnChannelCreate(client, channel);
    expect(editOnboarding).not.toHaveBeenCalled();
  });

  it("skips channels already in the defaults", async () => {
    const editOnboarding = vi.fn();
    const channel = makeChannel({
      existingDefaultIds: ["new-channel-id"],
      editOnboarding,
    });
    await luposOnChannelCreate(client, channel);
    expect(editOnboarding).not.toHaveBeenCalled();
  });

  it("contains editOnboarding failures instead of rejecting", async () => {
    const editOnboarding = vi.fn().mockRejectedValue(new Error("api down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const channel = makeChannel({ editOnboarding });
    await expect(
      luposOnChannelCreate(client, channel),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe("isPubliclyViewable", () => {
    it("rejects categories", () => {
      const channel = makeChannel({ type: ChannelType.GuildCategory });
      expect(isPubliclyViewable(channel)).toBe(false);
    });

    it("rejects voice channels @everyone cannot connect to", () => {
      // Discord refuses view-only voice counters as onboarding defaults
      // (DEFAULT_CHANNEL_REQUIRES_EVERYONE_ACCESS requires Connect).
      const channel = makeChannel({ type: ChannelType.GuildVoice });
      (
        channel.permissionsFor as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        has: (bit: bigint) => bit !== PermissionFlagsBits.Connect,
      });
      expect(isPubliclyViewable(channel)).toBe(false);
    });

    it("accepts voice channels @everyone can view and connect to", () => {
      const channel = makeChannel({ type: ChannelType.GuildVoice });
      expect(isPubliclyViewable(channel)).toBe(true);
    });

    it("treats an unresolvable permission set as private", () => {
      const channel = makeChannel({});
      (
        channel.permissionsFor as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(null);
      expect(isPubliclyViewable(channel)).toBe(false);
    });
  });
});
