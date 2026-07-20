/**
 * CommandSyncService.test.ts
 *
 * Tests the pure payload/hash logic behind boot-time slash-command
 * registration:
 *   1. buildGuildCommandPayload — guildIds restriction filtering
 *   2. hashCommandPayload — stable for identical payloads, different
 *      for changed definitions (the "only re-register on change" guard)
 */

import { SlashCommandBuilder } from "discord.js";
import {
  buildGuildCommandPayload,
  hashCommandPayload,
} from "../../src/services/CommandSyncService.ts";
import type { Command } from "../../src/commands/types.ts";

function makeCommand(name: string, guildIds?: string[]): Command {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`${name} description`),
    guildIds,
    execute: async () => {},
  };
}

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

describe("buildGuildCommandPayload", () => {
  const commands = [
    makeCommand("everywhere"),
    makeCommand("only-a", [GUILD_A]),
    makeCommand("nowhere", []),
  ];

  it("includes unrestricted commands in every guild", () => {
    const names = buildGuildCommandPayload(commands, GUILD_B).map(
      (json) => json.name,
    );
    expect(names).toEqual(["everywhere"]);
  });

  it("includes restricted commands only in their guilds", () => {
    const names = buildGuildCommandPayload(commands, GUILD_A).map(
      (json) => json.name,
    );
    expect(names).toEqual(["everywhere", "only-a"]);
  });

  it("an empty guildIds list registers nowhere", () => {
    for (const guildId of [GUILD_A, GUILD_B]) {
      const names = buildGuildCommandPayload(commands, guildId).map(
        (json) => json.name,
      );
      expect(names).not.toContain("nowhere");
    }
  });
});

describe("hashCommandPayload", () => {
  it("is stable for identical payloads", () => {
    const first = buildGuildCommandPayload([makeCommand("stable")], GUILD_A);
    const second = buildGuildCommandPayload([makeCommand("stable")], GUILD_A);
    expect(hashCommandPayload(first)).toBe(hashCommandPayload(second));
  });

  it("changes when a command definition changes", () => {
    const original = buildGuildCommandPayload([makeCommand("cmd")], GUILD_A);
    const changed = [
      new SlashCommandBuilder()
        .setName("cmd")
        .setDescription("a different description")
        .toJSON(),
    ];
    expect(hashCommandPayload(original)).not.toBe(hashCommandPayload(changed));
  });

  it("changes when the guild's command set changes", () => {
    const commands = [makeCommand("everywhere"), makeCommand("only-a", [GUILD_A])];
    const inA = buildGuildCommandPayload(commands, GUILD_A);
    const inB = buildGuildCommandPayload(commands, GUILD_B);
    expect(hashCommandPayload(inA)).not.toBe(hashCommandPayload(inB));
  });
});
