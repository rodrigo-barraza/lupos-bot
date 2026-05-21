/**
 * Shared Discord-related type definitions for lupos-bot.
 */

import type { Client } from "discord.js";

/** Entry in the DiscordWrapper.clients array. */
export interface DiscordClientEntry {
  name: string;
  client: Client;
}

/** Mood level definition from MoodConstants. */
export interface MoodEntry {
  level: number;
  name: string;
  emoji: string;
  description: string;
}

/**
 * Mood temperature threshold entry.
 * [minTemp, maxTemp, direction, multiplier]
 */
export type MoodTemperatureThreshold = [number, number, "decrease" | "increase", number];

/** Vote entry for the beatup command. */
export interface BeatupVote {
  voterId: string;
  voterUsername?: string;
  timestamp: number;
}
