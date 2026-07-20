// ============================================================
// OnboardingDefaults — keep Community Onboarding defaults in sync
// ============================================================
// With Community Onboarding enabled, Discord only shows new members
// the channels in default_channel_ids (plus channels granted by
// onboarding prompts); everything else is hidden until the member
// manually follows it in Channels & Roles. Discord never auto-adds
// newly created channels to that list, so every new public channel
// ships invisible to new members. This listener adds public channels
// to the onboarding defaults the moment they are created.
// ============================================================

import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { Client, NonThreadGuildBasedChannel } from "discord.js";

import config from "#root/config.ts";

/**
 * A channel belongs in the onboarding defaults when @everyone can view
 * it. Categories can't be onboarding defaults, and threads never reach
 * ChannelCreate. Discord additionally requires @everyone Connect for
 * voice/stage defaults (DEFAULT_CHANNEL_REQUIRES_EVERYONE_ACCESS), so
 * view-only counters like "Players: 15.2K" are not defaultable.
 */
export function isPubliclyViewable(channel: NonThreadGuildBasedChannel) {
  if (channel.type === ChannelType.GuildCategory) return false;
  const everyone = channel.guild.roles.everyone;
  const perms = channel.permissionsFor(everyone);
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) return false;
  if (
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice
  ) {
    return perms.has(PermissionFlagsBits.Connect);
  }
  return true;
}

async function addChannelToOnboardingDefaults(
  channel: NonThreadGuildBasedChannel,
) {
  const functionName = "OnboardingDefaults";
  if (channel.guild.id !== config.GUILD_ID_PRIMARY) return;
  if (!isPubliclyViewable(channel)) return;

  const onboarding = await channel.guild.fetchOnboarding();
  if (!onboarding.enabled) return;
  if (onboarding.defaultChannels.has(channel.id)) return;

  await channel.guild.editOnboarding({
    defaultChannels: [...onboarding.defaultChannels.keys(), channel.id],
    reason: `Auto-add public channel #${channel.name} to onboarding defaults`,
  });
  console.log(
    `✅ [${functionName}] Added #${channel.name} (${channel.id}) to onboarding default channels`,
  );
}

// Bulk channel creation (e.g. building out a category) fires ChannelCreate
// in quick succession; serialize the read-modify-write of the defaults
// list so concurrent edits can't drop each other's additions.
let queue: Promise<void> = Promise.resolve();

export function luposOnChannelCreate(
  _client: Client,
  channel: NonThreadGuildBasedChannel,
) {
  queue = queue
    .then(() => addChannelToOnboardingDefaults(channel))
    .catch((error: unknown) => {
      console.error(
        `❌ [OnboardingDefaults] Failed to add #${channel.name} to onboarding defaults:`,
        error,
      );
    });
  return queue;
}
