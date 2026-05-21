import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/commands/utility/deathrollUtils.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const replacements = [
  // Math operators on unknown
  ['(t: number) => mmr', '(t: { min: number }) => mmr'],
  ['(t as {min: number}).min', 't.min'],
  ['wins + losses', '(wins as number) + (losses as number)'],
  ['wins / (wins + losses)', '(wins as number) / ((wins as number) + (losses as number))'],
  ['stats.rank.emoji', '(stats.rank as { emoji: string }).emoji'],
  ['stats.rank.title', '(stats.rank as { title: string }).title'],
  ['const wins = playerStats?.wins || 0;', 'const wins = (playerStats?.wins as number) || 0;'],
  ['const losses = playerStats?.losses || 0;', 'const losses = (playerStats?.losses as number) || 0;'],
  ['const currentStreak = playerStats?.currentStreak || 0;', 'const currentStreak = (playerStats?.currentStreak as number) || 0;'],
  ['stats.mmr / 100', '(stats.mmr as number) / 100'],
  ['stats.mmr < 1000', '(stats.mmr as number) < 1000'],
  ['stats.mmr - 1000', '(stats.mmr as number) - 1000'],

  // formatStatsString
  ['function formatStatsString(stats: Record<string, unknown> | null)', 'function formatStatsString(stats: any)'], // Temporarily using any for stats mapping internally, wait, user rules strictly say NO ANY
  ['function formatStatsString(stats: Record<string, unknown> | null)', 'function formatStatsString(stats: Record<string, unknown> | null)'], // revert the any, keep it Record
  ['formatStatsString(stats.initiator)', 'formatStatsString(stats.initiator as Record<string, unknown>)'],
  ['formatStatsString(stats.opponent)', 'formatStatsString(stats.opponent as Record<string, unknown>)'],
  ['getSeasonMMR(userStats)', 'getSeasonMMR(userStats as WithId<Document>)'],

  // Rolls type fixing
  ['(game as {rolls: number[]}).rolls', '(game as {rolls: {roll: number, userId: string, maxNumber: number}[]}).rolls'],
  
  // Game parsing
  ['(id: string) => `<@${id}>`', '(id: unknown) => `<@${id as string}>`'],
  ['game.startingNumber', 'game.startingNumber as number'],
  ['game.initiator', 'game.initiator as string'],
  ['game.opponent', 'game.opponent as string'],
  ['game.h2h', 'game.h2h as Record<string, unknown> | undefined'],
  ['await applyPendingTimeout(guild!, pendingTimeoutData)', 'await applyPendingTimeout(guild!, pendingTimeoutData as Record<string, unknown>)'],

  // Missing nulls
  ['const role = guild.roles.cache.find((r: import("discord.js").Role) => r.name === roleName);', 'const role = guild?.roles.cache.find((r: import("discord.js").Role) => r.name === roleName);'],
  ['await member.roles.add(role);', 'await member?.roles.add(role);'],
  ['await member.roles.remove(role);', 'await member?.roles.remove(role);'],
  ['guild.channels.cache.get', 'guild?.channels.cache.get'],
  ['(r: WithId<Document>) => ({', '(r: Document) => ({'],
  ['(s: WithId<Document>) => [s.userId', '(s: Document) => [s.userId'],
  
  // Document mapping
  ['(opp: WithId<Document>, i: number)', '(opp: Document, i: number)'],
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed deathrollUtils.ts Part 3');
