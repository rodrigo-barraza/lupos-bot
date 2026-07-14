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
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
