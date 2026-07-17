import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

/**
 * Shared slash-command contract.
 *
 * The dispatcher (DiscordService.luposOnInteractionCreate) enforces the
 * optional guards centrally so command files don't each re-implement
 * guild checks, permission checks, cooldowns, and error replies.
 */
export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  /** Reject use outside guilds with an ephemeral reply. */
  guildOnly?: boolean;
  /** Bot permissions required in the guild (PermissionFlagsBits values). */
  botPermissions?: bigint[];
  /** Per-user cooldown in seconds, enforced in memory. */
  cooldownSeconds?: number;
  /**
   * Restrict Discord registration to these guild IDs (deploy-commands
   * skips the command for other guilds). Omit to register everywhere.
   */
  guildIds?: string[];
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
