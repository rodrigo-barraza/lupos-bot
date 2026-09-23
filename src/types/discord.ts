/**
 * Shared Discord-related type definitions for lupos-bot.
 */

import type { Client } from "discord.js";

/** Entry in the DiscordWrapper.clients array. */
export interface DiscordClientEntry {
  name: string;
  client: Client;
}

/** Vote entry for the beatup command. */
export interface BeatupVote {
  voterId: string;
  voterUsername?: string;
  timestamp: number;
}
