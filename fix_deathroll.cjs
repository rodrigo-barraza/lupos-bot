const fs = require('fs');

let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

const interfaces = `
export interface GameRoll {
  userId: string;
  username: string | null | undefined;
  roll: number;
  maxNumber: number;
}
export interface H2HStats {
  player1Wins: number;
  player2Wins: number;
}
export interface GameState {
  initiator: string;
  initiatorName: string | null | undefined;
  opponent: string | null;
  opponentName: string | null | undefined;
  targetUserId: string | null;
  currentNumber: number;
  currentTurn: string | null;
  messageId: string;
  channelId: string;
  startingNumber: number;
  rolls: GameRoll[];
  startedAt: number;
  currentMessageId: string | null;
  timeoutMultiplier: number;
  h2h?: H2HStats | null;
}
export interface PendingTimeoutData {
  loserId: string;
  timeoutDuration: number;
}
export interface PendingGameData {
  game: GameState;
  winnerId: string;
  loserId: string;
  winnerInfo: { username: string; displayName: string };
  loserInfo: { username: string; displayName: string };
}
export interface UserStats {
  userId: string;
  guildId: string;
  mmr: number;
  rd: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt: number;
  wins?: number;
  losses?: number;
  totalGames?: number;
}
export interface PlayerProfile {
  wins: number;
  losses: number;
  totalGames: number;
  winRate: number;
  mmr: number;
  rd: number;
  isPlacement: boolean;
  rank: { title: string; emoji: string };
  confidence: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt?: number;
}
export interface AggregatedStats {
  userId: string;
  wins: number;
  losses: number;
  totalGames: number;
}
`;

code = code.replace('// ─── Pure Computation Helpers ─────────────────────────────────────────', interfaces + '\n// ─── Pure Computation Helpers ─────────────────────────────────────────');

code = code.replace(/function getMultiplierName\(multiplier: any\)/g, 'function getMultiplierName(multiplier: number)');
code = code.replace(/function calculateKFactor\(rd: any\)/g, 'function calculateKFactor(rd: number)');
code = code.replace(/function gravityGainScale\(mmr: any\)/g, 'function gravityGainScale(mmr: number)');
code = code.replace(/function gravityLossScale\(mmr: any\)/g, 'function gravityLossScale(mmr: number)');
code = code.replace(/function mmrMultiplier\(timeoutMultiplier: any\)/g, 'function mmrMultiplier(timeoutMultiplier: number)');
code = code.replace(/function calculateConfidence\(rd: any\)/g, 'function calculateConfidence(rd: number)');
code = code.replace(/function applyTimeDecayRD\(rd: any, lastPlayedAt: any\)/g, 'function applyTimeDecayRD(rd: number, lastPlayedAt: number | undefined)');
code = code.replace(/function getSeasonMMR\(userStats: any\)/g, 'function getSeasonMMR(userStats: Partial<UserStats> | null)');
code = code.replace(/function getRankTitle\(mmr: any\)/g, 'function getRankTitle(mmr: number)');
code = code.replace(/\(t: any\)/g, '(t: { min: number; title: string; emoji: string })');
code = code.replace(/function formatStatsString\(stats: any\)/g, 'function formatStatsString(stats: Partial<PlayerProfile>)');
code = code.replace(/function formatStreak\(currentStreak: any\)/g, 'function formatStreak(currentStreak: number)');
code = code.replace(/function computePlayerProfile\(playerStats: any\)/g, 'function computePlayerProfile(playerStats: Partial<AggregatedStats> & Partial<UserStats> | null): PlayerProfile');

code = code.replace(/getMedal\(index: any\)/g, 'getMedal(index: number)');
code = code.replace(/\.catch\(\(err: any\) =>/g, '.catch((err: unknown) =>');
code = code.replace(/ensureDeathrollIndexes\(\{ statsCollection, gamesCollection \}: any\)/g, 'ensureDeathrollIndexes({ statsCollection, gamesCollection }: { statsCollection: import("mongodb").Collection; gamesCollection: import("mongodb").Collection })');

code = code.replace(/aggregatePlayerStats\(guildId: any, userId: any\)/g, 'aggregatePlayerStats(guildId: string, userId: string)');
code = code.replace(/aggregateAllPlayerStats\(guildId: any\)/g, 'aggregateAllPlayerStats(guildId: string)');
code = code.replace(/\.map\(\(r: any\) =>/g, '.map((r: any) =>');
code = code.replace(/fetchSinglePlayerStats\(guildId: any, userId: any\)/g, 'fetchSinglePlayerStats(guildId: string, userId: string)');
code = code.replace(/fetchMidGameStats\(guildId: any, initiatorId: any, opponentId: any\)/g, 'fetchMidGameStats(guildId: string, initiatorId: string, opponentId: string)');
code = code.replace(/fetchHeadToHead\(guildId: any, player1Id: any, player2Id: any\)/g, 'fetchHeadToHead(guildId: string, player1Id: string, player2Id: string)');
code = code.replace(/buildEndGameData\(guildId: any, game: any, winnerId: any, loserId: any\)/g, 'buildEndGameData(guildId: string, game: GameState, winnerId: string, loserId: string)');
code = code.replace(/saveGameResult\(\n  guildId: any,\n  game: any,\n  winnerId: any,\n  loserId: any,\n  winnerInfo: any,\n  loserInfo: any,\n  endReason: any,/g, 'saveGameResult(\n  guildId: string,\n  game: GameState,\n  winnerId: string,\n  loserId: string,\n  winnerInfo: { username: string; displayName: string },\n  loserInfo: { username: string; displayName: string },\n  endReason: string | null,');
code = code.replace(/fetchTopRivals\(guildId: any, userId: any, limit: any = 3\)/g, 'fetchTopRivals(guildId: string, userId: string, limit: number = 3)');
code = code.replace(/fetchLeaderboard\(guildId: any, limit: any = 20\)/g, 'fetchLeaderboard(guildId: string, limit: number = 20)');

code = code.replace(/formatGameMessage\(\n  game: any,\n  lastRoll: any,\n  lastRoller: any,\n  lastRollerId: any,\n  isGameOver: any,\n  stats: any,/g, 'formatGameMessage(\n  game: GameState,\n  lastRoll: number,\n  lastRoller: string | null | undefined,\n  lastRollerId: string,\n  isGameOver: boolean,\n  stats: { initiator?: PlayerProfile, opponent?: PlayerProfile, winnerRank?: string, loserRank?: string, winnerMmrChange?: string, loserMmrChange?: string, winnerStreak?: number, loserStreak?: number } | null,');

code = code.replace(/buildDoubleOrNothingRow\(game: any, winnerId: any, loserId: any\)/g, 'buildDoubleOrNothingRow(game: GameState, winnerId: string, loserId: string)');

code = code.replace(/createDoubleOrNothingCollector\(\n  message: any,\n  guild: any,\n  winnerId: any,\n  loserId: any,\n  startingNumber: any,\n  timeoutMultiplier: any,\n  pendingTimeoutData: any,\n  pendingGameData: any,\n\)/g, 'createDoubleOrNothingCollector(\n  message: import("discord.js").Message,\n  guild: import("discord.js").Guild,\n  winnerId: string,\n  loserId: string,\n  startingNumber: number,\n  timeoutMultiplier: number,\n  pendingTimeoutData: PendingTimeoutData | null,\n  pendingGameData: PendingGameData | null,\n)');

code = code.replace(/applyPendingTimeout\(guild: any, pendingTimeoutData: any\)/g, 'applyPendingTimeout(guild: import("discord.js").Guild, pendingTimeoutData: PendingTimeoutData)');
code = code.replace(/removePendingTimeout\(guild: any, userId: any\)/g, 'removePendingTimeout(guild: import("discord.js").Guild, userId: string)');
code = code.replace(/createRollCollector\(message: any, gameId: any, guild: any\)/g, 'createRollCollector(message: import("discord.js").Message, gameId: string, guild: import("discord.js").Guild)');
code = code.replace(/handleDeclineButton\(buttonInteraction: any, gameId: any\)/g, 'handleDeclineButton(buttonInteraction: import("discord.js").ButtonInteraction, gameId: string)');
code = code.replace(/handleEngageButton\(buttonInteraction: any, gameId: any\)/g, 'handleEngageButton(buttonInteraction: import("discord.js").ButtonInteraction, gameId: string)');
code = code.replace(/handleRollButton\(buttonInteraction: any, gameId: any\)/g, 'handleRollButton(buttonInteraction: import("discord.js").ButtonInteraction, gameId: string)');

code = code.replace(/handleLoss\(\n  buttonInteraction: any,\n  game: any,\n  loserId: any,\n  roll: any,\n  gameOverMessage: any,\n\)/g, 'handleLoss(\n  buttonInteraction: import("discord.js").ButtonInteraction,\n  game: GameState,\n  loserId: string,\n  roll: number,\n  gameOverMessage: import("discord.js").Message | null,\n)');

code = code.replace(/handleTimeoutLoss\(guild: any, game: any, winnerId: any, loserId: any\)/g, 'handleTimeoutLoss(guild: import("discord.js").Guild, game: GameState, winnerId: string, loserId: string)');

code = code.replace(/executeDeathroll\(interaction: any\)/g, 'executeDeathroll(interaction: import("discord.js").ChatInputCommandInteraction)');
code = code.replace(/executeDeathrollStats\(interaction: any\)/g, 'executeDeathrollStats(interaction: import("discord.js").ChatInputCommandInteraction)');
code = code.replace(/executeDeathrollLeaderboard\(interaction: any\)/g, 'executeDeathrollLeaderboard(interaction: import("discord.js").ChatInputCommandInteraction)');

code = code.replace(/const activeGames = new Map<string, any>\(\);/g, 'const activeGames = new Map<string, GameState>();');
code = code.replace(/const activeCollectors = new Map<string, any>\(\);/g, 'const activeCollectors = new Map<string, import("discord.js").InteractionCollector<import("discord.js").MessageComponentInteraction>>();');

// Add guild exclamation checks and Fix issues
code = code.replace(/buttonInteraction\.guild,/g, 'buttonInteraction.guild!,');
code = code.replace(/buttonInteraction\.guild;/g, 'buttonInteraction.guild!;');
code = code.replace(/buttonInteraction\.guild\)\)/g, 'buttonInteraction.guild!))');
code = code.replace(/interaction\.guild\.id/g, 'interaction.guild!.id');
code = code.replace(/interaction\.guildId,/g, 'interaction.guildId!,');

// Re-apply the fix script I used before
code = code.replace(/game\.rolls\.push\(\{/g, 'game!.rolls.push({');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)game\.currentNumber = roll;/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1game.currentNumber = roll;');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)game\.currentMessageId/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1game.currentMessageId');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)if \(game\.opponent/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1if (game.opponent');
code = code.replace(/const g = activeGames\.get\(gameId\);\n(\s*)if \(\!g\.opponent\)/g, 'const g = activeGames.get(gameId);\n$1if (!g) return;\n$1if (!g.opponent)');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)if \(\!game\.opponent\)/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1if (!game.opponent)');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)game\.opponent = userId;/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1game.opponent = userId;');
code = code.replace(/const game = activeGames\.get\(gameId\);\n(\s*)const endGameData/g, 'const game = activeGames.get(gameId);\n$1if (!game) return;\n$1const endGameData');
code = code.replace(/interaction\.guild!\.members\.me\.permissions\.has/g, 'interaction.guild!.members.me?.permissions.has');
code = code.replace(/interaction\.editReply\(\{\n\s*content:.*?,(\n\s*)ephemeral: true,\n\s*\}\)/g, match => match.replace('ephemeral: true,', ''));

// Apply findOne casts
code = code.replace(/const userStats = await statsCollection\.findOne\(\{\s*userId,\s*guildId\s*\}\);/g, 'const userStats = await statsCollection.findOne({ userId, guildId }) as unknown as Partial<UserStats> | null;');
code = code.replace(/statsCollection\.findOne\(\{\s*userId:\s*initiatorId,\s*guildId\s*\}\),/g, 'statsCollection.findOne({ userId: initiatorId, guildId }) as unknown as Promise<Partial<UserStats> | null>,');
code = code.replace(/statsCollection\.findOne\(\{\s*userId:\s*opponentId,\s*guildId\s*\}\),/g, 'statsCollection.findOne({ userId: opponentId, guildId }) as unknown as Promise<Partial<UserStats> | null>,');
code = code.replace(/statsCollection\.findOne\(\{\s*userId:\s*winnerId,\s*guildId\s*\}\),/g, 'statsCollection.findOne({ userId: winnerId, guildId }) as unknown as Promise<Partial<UserStats> | null>,');
code = code.replace(/statsCollection\.findOne\(\{\s*userId:\s*loserId,\s*guildId\s*\}\),/g, 'statsCollection.findOne({ userId: loserId, guildId }) as unknown as Promise<Partial<UserStats> | null>,');

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
