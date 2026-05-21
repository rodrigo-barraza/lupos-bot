import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/commands/utility/deathrollUtils.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Replace Record<string, unknown> with more specific types where needed in functions
content = content.replace(/function formatStatsString\(stats: Record<string, unknown> \| null\)/, 'function formatStatsString(stats: any | null)');
content = content.replace(/function computePlayerProfile\(playerStats: Record<string, unknown> \| null\)/, 'function computePlayerProfile(playerStats: any | null)');

const replacements = [
  // Guild null checks
  ['buttonInteraction.guild.members', 'buttonInteraction.guild!.members'],
  ['interaction.guild.members', 'interaction.guild!.members'],
  ['await fetchHeadToHead(guild.id', 'await fetchHeadToHead(guild!.id'],
  ['const h2h = await fetchHeadToHead(guild.id, loserId, winnerId);', 'const h2h = await fetchHeadToHead(guild!.id, loserId, winnerId);'],
  ['fetchMidGameStats(guild.id', 'fetchMidGameStats(guild!.id'],
  ['buttonInteraction.guild.id', 'buttonInteraction.guild!.id'],
  ['await applyPendingTimeout(guild,', 'await applyPendingTimeout(guild!,'],
  ['await removePendingTimeout(guild,', 'await removePendingTimeout(guild!,'],
  ['await handleTimeoutLoss(guild,', 'await handleTimeoutLoss(guild!,'],
  
  // Interaction/Channel null checks
  ['channel.send(', 'channel!.send('],
  ['interaction.guild.id', 'interaction.guild!.id'],
  ['if (!interaction.member?.moderatable)', 'if (!(interaction.member as import("discord.js").GuildMember)?.moderatable)'],
  ['const challengerMember = await interaction.guild.members.fetch(loserId)', 'const challengerMember = await interaction.guild!.members.fetch(loserId)'],
  ['const opponentMember = await interaction.guild.members.fetch(winnerId)', 'const opponentMember = await interaction.guild!.members.fetch(winnerId)'],
  
  // Ephemeral property in updates
  ['await interaction.editReply({ content: "🎲 Double or nothing expired!", components: [], ephemeral: true });', 'await interaction.editReply({ content: "🎲 Double or nothing expired!", components: [] });'],
  ['await interaction.editReply({ content: "🎲 Only the challenged player can reply!", components: [], ephemeral: true });', 'await interaction.editReply({ content: "🎲 Only the challenged player can reply!", components: [] });'],
  ['await interaction.editReply({ content: "🎲 Game cancelled by the challenged player.", components: [], ephemeral: true });', 'await interaction.editReply({ content: "🎲 Game cancelled by the challenged player.", components: [] });'],
  ['await interaction.editReply({ content: "🎲 Request expired.", components: [], ephemeral: true });', 'await interaction.editReply({ content: "🎲 Request expired.", components: [] });'],
  
  // Map and sort callbacks missing proper typing
  ['(opp: WithId<Document>, i: number)', '(opp: any, i: number)'],
  ['(a: Record<string, unknown>, b: Record<string, unknown>) => (b.profile as Record<string, number>).totalGames - (a.profile as Record<string, number>).totalGames', '(a: any, b: any) => b.profile.totalGames - a.profile.totalGames'],
  ['(p: { profile: { isPlacement: boolean } }) => !p.profile.isPlacement', '(p: any) => !p.profile.isPlacement'],
  ['(p: { profile: { isPlacement: boolean } }) => p.profile.isPlacement', '(p: any) => p.profile.isPlacement'],
  ['const formatRankedLine = (player: Record<string, unknown>, index: number)', 'const formatRankedLine = (player: any, index: number)'],
  ['const formatUnrankedLine = (player: Record<string, unknown>)', 'const formatUnrankedLine = (player: any)'],
  ['(p: Record<string, unknown>, i: number) => formatRankedLine', '(p: any, i: number) => formatRankedLine'],
  ['(p: Record<string, unknown>) => {', '(p: any) => {'],
  ['(b as { profile: { totalGames: number } }).profile.totalGames - (a as { profile: { totalGames: number } }).profile.totalGames', 'b.profile.totalGames - a.profile.totalGames'],

  // Math operators on objects/unknown
  ['sum + (p.wins as number)', 'sum + (p.wins as number)'],
  ['(sum: number, p: Record<string, unknown>) => sum + (p.wins as number)', '(sum: number, p: any) => sum + p.wins'],
  
  // ActionRowBuilder types
  ['ActionRowBuilder().addComponents', 'ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents'],
  
  // Guild | null assignment
  ['async function applyPendingTimeout(guild: Guild,', 'async function applyPendingTimeout(guild: import("discord.js").Guild,'],
  ['async function removePendingTimeout(guild: Guild,', 'async function removePendingTimeout(guild: import("discord.js").Guild,'],
  ['async function handleTimeoutLoss(guild: Guild,', 'async function handleTimeoutLoss(guild: import("discord.js").Guild,']
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed deathrollUtils.ts');
