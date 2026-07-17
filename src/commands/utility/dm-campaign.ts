// ============================================================
// /dm-campaign — owner-only control of the invite-DM campaign
// ============================================================
// Thin Discord front-end over DmCampaignService (same worker and
// Mongo state as the /guild/dm-campaign HTTP endpoints — the two
// surfaces are interchangeable). Three layers keep this owner-only:
//   1. guildIds restricts registration to the testing guild, so the
//      command doesn't exist in public servers' pickers,
//   2. default_member_permissions 0 hides it from non-admins there,
//   3. the OWNER_USER_ID check in execute is the hard gate.
// All replies are ephemeral.

import { SlashCommandBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";

import config from "#root/config.js";
import utilities from "#root/utilities.js";
import DmCampaignService from "#root/services/DmCampaignService.js";

type CampaignStatus = Awaited<ReturnType<typeof DmCampaignService.getStatus>>;

const STATUS_EMOJI: Record<string, string> = {
  running: "🟢",
  paused: "⏸️",
  seeded: "🌱",
  done: "✅",
  not_seeded: "⚪",
};

/** Renders getStatus() output as a Discord message. Pure — unit tested. */
export function formatCampaignStatus(status: CampaignStatus): string {
  const emoji = STATUS_EMOJI[status.status] ?? "❓";
  const lines = [
    `${emoji} **DM Campaign — ${status.campaignId}**`,
    `Status: **${status.status}**${status.workerActive ? " (worker active)" : ""}`,
  ];
  if (status.pausedReason) lines.push(`Paused reason: ${status.pausedReason}`);
  lines.push(
    `Today: **${status.sentToday}/${status.dailyCap}** sent (${status.remainingToday} remaining)`,
    `Total sent: **${status.totalSent}**`,
  );
  const countEntries = Object.entries(status.counts);
  if (countEntries.length > 0) {
    lines.push(
      countEntries
        .sort(([, a], [, b]) => b - a)
        .map(([key, count]) => `${key}: ${count}`)
        .join(" · "),
    );
  }
  if (status.estimatedDaysRemaining > 0) {
    lines.push(`Estimated days remaining: ~${status.estimatedDaysRemaining}`);
  }
  if (status.inviteUrl) lines.push(`Invite: ${status.inviteUrl}`);
  return lines.join("\n");
}

export default {
  data: new SlashCommandBuilder()
    .setName("dm-campaign")
    .setDescription("Owner-only: manage the Crusader Strike → Whitemane invite-DM campaign")
    .setDefaultMemberPermissions(0n)
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("seed")
        .setDescription("Compute targets and report counts — sends nothing"),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("start")
        .setDescription("Start or resume the paced sender"),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName("pause")
        .setDescription("Pause sending (kill switch)")
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Why it's being paused")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand.setName("status").setDescription("Show campaign progress"),
    ),
  // Only registered in the testing guild (Lupos Logs) — see deploy-commands.
  guildIds: [config.GUILD_ID_TESTING].filter(Boolean) as string[],
  async execute(interaction: ChatInputCommandInteraction) {
    if (
      !config.OWNER_USER_ID ||
      interaction.user.id !== config.OWNER_USER_ID
    ) {
      await interaction.reply({
        content: "This command is owner-only.",
        ephemeral: true,
      });
      return;
    }

    // seed does two full member fetches; everything hits Mongo — defer.
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();
    try {
      if (subcommand === "seed") {
        const result = await DmCampaignService.seedCampaign();
        await interaction.editReply(
          `Seeded **${result.candidateCount}** candidates (**${result.newlyAdded}** new). Nothing sent — run \`/dm-campaign start\` to begin.\n\n${formatCampaignStatus(result)}`,
        );
      } else if (subcommand === "start") {
        const status = await DmCampaignService.startCampaign();
        await interaction.editReply(formatCampaignStatus(status));
      } else if (subcommand === "pause") {
        const reason =
          interaction.options.getString("reason") ?? "manual (slash command)";
        const status = await DmCampaignService.pauseCampaign(reason);
        await interaction.editReply(formatCampaignStatus(status));
      } else {
        const status = await DmCampaignService.getStatus();
        await interaction.editReply(formatCampaignStatus(status));
      }
    } catch (err: unknown) {
      await interaction.editReply(`❌ ${utilities.errorMessage(err)}`);
    }
  },
};
