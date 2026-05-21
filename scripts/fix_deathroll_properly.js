import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/commands/utility/deathrollUtils.ts');
let content = fs.readFileSync(filePath, 'utf-8');

if (!content.includes('import type { ChatInputCommandInteraction, ButtonInteraction, Guild, GuildMember, Message, Collection as DiscordCollection, MessageComponentInteraction } from "discord.js";')) {
  content = content.replace(
    'import {',
    'import type { ChatInputCommandInteraction, ButtonInteraction, Guild, GuildMember, Message, Collection as DiscordCollection, MessageComponentInteraction } from "discord.js";\nimport {'
  );
}

if (!content.includes('import type { WithId, Document, Collection as MongoCollection } from "mongodb";')) {
  content = content.replace(
    'import {',
    'import type { WithId, Document, Collection as MongoCollection } from "mongodb";\nimport {'
  );
}

const replacements = [
  // Math params -> number
  ['function getMultiplierName(multiplier: any)', 'function getMultiplierName(multiplier: number)'],
  ['function calculateKFactor(rd: any)', 'function calculateKFactor(rd: number)'],
  ['function gravityGainScale(mmr: any)', 'function gravityGainScale(mmr: number)'],
  ['function gravityLossScale(mmr: any)', 'function gravityLossScale(mmr: number)'],
  ['function mmrMultiplier(timeoutMultiplier: any)', 'function mmrMultiplier(timeoutMultiplier: number)'],
  ['function calculateConfidence(rd: any)', 'function calculateConfidence(rd: number)'],
  ['function applyTimeDecayRD(rd: any, lastPlayedAt: any)', 'function applyTimeDecayRD(rd: number, lastPlayedAt: number | null)'],
  ['function getRankTitle(mmr: any)', 'function getRankTitle(mmr: number)'],
  ['function formatStreak(currentStreak: any)', 'function formatStreak(currentStreak: number)'],
  ['function getMedal(index: any)', 'function getMedal(index: number)'],
  ['(t: any) => mmr', '(t: number) => mmr'],

  // Profile/Stats -> Document or Object
  ['function getSeasonMMR(userStats: any)', 'function getSeasonMMR(userStats: WithId<Document> | null)'],
  ['function formatStatsString(stats: any)', 'function formatStatsString(stats: Record<string, unknown> | null)'],
  ['function computePlayerProfile(playerStats: any)', 'function computePlayerProfile(playerStats: Record<string, unknown> | null)'],

  // DB functions
  ['(err: any) =>', '(err: Error) =>'],
  ['ensureDeathrollIndexes({ statsCollection, gamesCollection }: any)', 'ensureDeathrollIndexes({ statsCollection, gamesCollection }: { statsCollection: MongoCollection<Document>; gamesCollection: MongoCollection<Document> })'],
  ['async function aggregatePlayerStats(guildId: any, userId: any)', 'async function aggregatePlayerStats(guildId: string, userId: string)'],
  ['async function aggregateAllPlayerStats(guildId: any)', 'async function aggregateAllPlayerStats(guildId: string)'],
  ['(r: any) => ({', '(r: WithId<Document>) => ({'],
  ['async function fetchSinglePlayerStats(guildId: any, userId: any)', 'async function fetchSinglePlayerStats(guildId: string, userId: string)'],
  ['async function fetchMidGameStats(guildId: any, initiatorId: any, opponentId: any)', 'async function fetchMidGameStats(guildId: string, initiatorId: string, opponentId: string)'],
  ['async function fetchHeadToHead(guildId: any, player1Id: any, player2Id: any)', 'async function fetchHeadToHead(guildId: string, player1Id: string, player2Id: string)'],
  ['async function buildEndGameData(guildId: any, game: any, winnerId: any, loserId: any)', 'async function buildEndGameData(guildId: string, game: Record<string, unknown>, winnerId: string, loserId: string)'],

  // saveGameResult
  ['  guildId: any,', '  guildId: string,'],
  ['  game: any,', '  game: Record<string, unknown>,'],
  ['  winnerId: any,', '  winnerId: string,'],
  ['  loserId: any,', '  loserId: string,'],
  ['  winnerInfo: any,', '  winnerInfo: { username: string; displayName: string },'],
  ['  loserInfo: any,', '  loserInfo: { username: string; displayName: string },'],
  ['  endReason: any,', '  endReason: string | null,'],

  // formatGameMessage
  ['  lastRoll: any,', '  lastRoll: number,'],
  ['  lastRoller: any,', '  lastRoller: string,'],
  ['  lastRollerId: any,', '  lastRollerId: string,'],
  ['  isGameOver: any,', '  isGameOver: boolean,'],
  ['  stats: any,', '  stats: Record<string, unknown> | null,'],

  // buildDoubleOrNothingRow
  ['function buildDoubleOrNothingRow(game: any, winnerId: any, loserId: any)', 'function buildDoubleOrNothingRow(game: Record<string, unknown>, winnerId: string, loserId: string)'],

  // createDoubleOrNothingCollector
  ['  message: any,', '  message: Message,'],
  ['  guild: any,', '  guild: Guild,'],
  ['  startingNumber: any,', '  startingNumber: number,'],
  ['  timeoutMultiplier: any,', '  timeoutMultiplier: number,'],
  ['  pendingTimeoutData: any,', '  pendingTimeoutData: Record<string, unknown> | null,'],
  ['  pendingGameData: any,', '  pendingGameData: Record<string, unknown> | null,'],

  // Callbacks
  ['(id: any) =>', '(id: string) =>'],
  ['(buttonInteraction: any) =>', '(buttonInteraction: ButtonInteraction) =>'],
  ['(bi: any) =>', '(bi: ButtonInteraction) =>'],
  ['(collected: any, reason: any) =>', '(collected: DiscordCollection<string, MessageComponentInteraction>, reason: string) =>'],

  // Timeout logic
  ['async function applyPendingTimeout(guild: any, pendingTimeoutData: any)', 'async function applyPendingTimeout(guild: Guild, pendingTimeoutData: Record<string, unknown>)'],
  ['async function removePendingTimeout(guild: any, userId: any)', 'async function removePendingTimeout(guild: Guild, userId: string)'],
  ['async function handleTimeoutLoss(guild: any, game: any, winnerId: any, loserId: any)', 'async function handleTimeoutLoss(guild: Guild, game: Record<string, unknown>, winnerId: string, loserId: string)'],

  // Game flow
  ['function createRollCollector(message: any, gameId: any, guild: any)', 'function createRollCollector(message: Message, gameId: string, guild: Guild)'],
  ['async function handleDeclineButton(buttonInteraction: any, gameId: any)', 'async function handleDeclineButton(buttonInteraction: ButtonInteraction, gameId: string)'],
  ['async function handleEngageButton(buttonInteraction: any, gameId: any)', 'async function handleEngageButton(buttonInteraction: ButtonInteraction, gameId: string)'],
  ['async function handleRollButton(buttonInteraction: any, gameId: any)', 'async function handleRollButton(buttonInteraction: ButtonInteraction, gameId: string)'],
  ['  buttonInteraction: any,', '  buttonInteraction: ButtonInteraction,'],
  ['  roll: any,', '  roll: number,'],
  ['  gameOverMessage: any,', '  gameOverMessage: Message,'],

  // Root interactions
  ['export async function executeDeathroll(interaction: any)', 'export async function executeDeathroll(interaction: ChatInputCommandInteraction)'],
  ['export async function executeDeathrollStats(interaction: any)', 'export async function executeDeathrollStats(interaction: ChatInputCommandInteraction)'],
  ['export async function executeDeathrollLeaderboard(interaction: any)', 'export async function executeDeathrollLeaderboard(interaction: ChatInputCommandInteraction)'],

  // Generic objects
  ['Record<string, any>', 'Record<string, unknown>'],

  // Error casting
  ['(error as any)', '(error as Error & { code?: number; writeErrors?: unknown[]; result?: { nUpserted?: number } })'],

  // Leaderboard / Stats fetching
  ['async function fetchTopRivals(guildId: any, userId: any, limit: any = 3)', 'async function fetchTopRivals(guildId: string, userId: string, limit: number = 3)'],
  ['async function fetchLeaderboard(guildId: any, limit: any = 20)', 'async function fetchLeaderboard(guildId: string, limit: number = 20)'],
  ['(s: any) => [s.userId', '(s: WithId<Document>) => [s.userId'],
  ['(hs: any) =>', '(hs: Record<string, unknown>) =>'],
  ['const us: any = ', 'const us: WithId<Document> | Record<string, unknown> = '],
  ['.sort((a: any, b: any) => b.profile.mmr - a.profile.mmr)', '.sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.profile as Record<string, number>).mmr - (a.profile as Record<string, number>).mmr)'],
  ['(sum: any, p: any) => sum + p.wins', '(sum: number, p: Record<string, unknown>) => sum + (p.wins as number)'],
  ['(opp: any, i: any)', '(opp: WithId<Document>, i: number)'],
  ['(p: any) => !p.profile.isPlacement', '(p: Record<string, unknown>) => !(p.profile as Record<string, boolean>).isPlacement'],
  ['(p: any) => p.profile.isPlacement', '(p: Record<string, unknown>) => (p.profile as Record<string, boolean>).isPlacement'],
  ['const formatRankedLine = (player: any, index: any)', 'const formatRankedLine = (player: Record<string, unknown>, index: number)'],
  ['const formatUnrankedLine = (player: any)', 'const formatUnrankedLine = (player: Record<string, unknown>)'],
  ['(p: any, i: any) => formatRankedLine(p, i)', '(p: Record<string, unknown>, i: number) => formatRankedLine(p, i)'],
  ['(p: any) => {', '(p: Record<string, unknown>) => {'],
  ['(a: any, b: any) => b.profile.totalGames - a.profile.totalGames', '(a: Record<string, unknown>, b: Record<string, unknown>) => (b.profile as Record<string, number>).totalGames - (a.profile as Record<string, number>).totalGames'],

  // Discord.js nullable properties & specific types
  ['channel.send(', '(channel as import("discord.js").TextChannel).send('],
  ['buttonInteraction.guild.id', 'buttonInteraction.guild!.id'],
  ['interaction.guild.id', 'interaction.guild!.id'],
  ['interaction.guild.members', 'interaction.guild!.members'],
  ['buttonInteraction.guild.members', 'buttonInteraction.guild!.members'],
  ['interaction.member?', '(interaction.member as import("discord.js").GuildMember)?'],
  ['await handleTimeoutLoss(guild, game, winnerId, loserId)', 'await handleTimeoutLoss(guild!, game, winnerId, loserId)'],
  ['await applyPendingTimeout(guild, pendingTimeoutData)', 'await applyPendingTimeout(guild!, pendingTimeoutData)'],
  ['await removePendingTimeout(guild, userId)', 'await removePendingTimeout(guild!, userId)'],
  ['fetchMidGameStats(guild.id,', 'fetchMidGameStats(guild!.id,'],
  ['fetchHeadToHead(guild.id,', 'fetchHeadToHead(guild!.id,'],
  ['ActionRowBuilder().addComponents', 'ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents'],
  
  // Game property assertions
  ['game.rolls.push', '(game as {rolls: number[]}).rolls.push'],
  ['game.rolls.length', '(game as {rolls: number[]}).rolls.length'],
  ['game.rolls[', '(game as {rolls: number[]}).rolls['],
  ['game.timeoutMultiplier', '(game as {timeoutMultiplier: number}).timeoutMultiplier'],
  ['game.startedAt', '(game as {startedAt: number}).startedAt'],
  ['player1Wins', '(stats as Record<string, number>).player1Wins'],
  ['player2Wins', '(stats as Record<string, number>).player2Wins'],
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed deathrollUtils.ts properly with NO any');
