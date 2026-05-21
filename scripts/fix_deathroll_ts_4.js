import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/commands/utility/deathrollUtils.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const replacements = [
  // 198, 201: Operator '>' cannot be applied to types '{}' and 'number'.
  // This occurs in calculateKFactor(rd: number). Wait! My replacement "function calculateKFactor(rd: any) -> function calculateKFactor(rd: number)" might have missed if rd wasn't `any` but rather destructured like `{ rd }`.
  ['function calculateKFactor({ rd }) {', 'function calculateKFactor({ rd }: { rd: number }) {'],
  ['function gravityGainScale({ mmr })', 'function gravityGainScale({ mmr }: { mmr: number })'],
  ['function gravityLossScale({ mmr })', 'function gravityLossScale({ mmr }: { mmr: number })'],
  ['function mmrMultiplier({ timeoutMultiplier })', 'function mmrMultiplier({ timeoutMultiplier }: { timeoutMultiplier: number })'],
  ['function applyTimeDecayRD({ rd, lastPlayedAt })', 'function applyTimeDecayRD({ rd, lastPlayedAt }: { rd: number, lastPlayedAt: number | null })'],
  ['function getRankTitle({ mmr })', 'function getRankTitle({ mmr }: { mmr: number })'],
  ['function formatStreak({ currentStreak })', 'function formatStreak({ currentStreak }: { currentStreak: number })'],
  ['function calculateConfidence({ rd })', 'function calculateConfidence({ rd }: { rd: number })'],
  ['function getMedal({ index })', 'function getMedal({ index }: { index: number })'],

  // stringName
  ['game.opponentName as stringName', 'game.opponentName as string'],

  // Document types
  ['WithId<Document> | null', 'Record<string, unknown> | null'], // for getSeasonMMR stats
  ['WithId<Document>', 'Record<string, unknown>'], // for fetchSinglePlayerStats

  // Time decay
  ['lastPlayedAt as number', 'lastPlayedAt as number | null'],

  // Math on games played
  ['(game.h2h as Record<string, number>).player1Wins + (game.h2h as Record<string, number>).player2Wins', '(game.h2h as Record<string, number>).player1Wins + (game.h2h as Record<string, number>).player2Wins'],

  // Guild and Member
  ['handleTimeoutLoss(guild,', 'handleTimeoutLoss(guild!,'],
  ['buttonInteraction.guild.members.cache', 'buttonInteraction.guild!.members.cache'],
  ['applyPendingTimeout(guild,', 'applyPendingTimeout(guild!,'],
  ['removePendingTimeout(guild,', 'removePendingTimeout(guild!,'],
  ['opponentMember.user', 'opponentMember?.user'],
  ['opponentMember.moderatable', 'opponentMember?.moderatable'],

  // Timeout logic
  ['pendingTimeoutData.timeoutDuration', '(pendingTimeoutData as Record<string, unknown>).timeoutDuration as number'],
  ['pendingTimeoutData.createdAt', '(pendingTimeoutData as Record<string, unknown>).createdAt as number'],

  // Username on rolls (it's roll.userId, let's fetch it from cache if we need username or just use userId tag)
  ['const lastRoller = lastRoll.username', 'const lastRoller = `<@${lastRoll.userId}>`'],
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

// Additional regex fixes:
content = content.replace(/function calculateKFactor\(\{\s*rd\s*\}\)/g, 'function calculateKFactor({ rd }: { rd: number })');
content = content.replace(/function gravityGainScale\(\{\s*mmr\s*\}\)/g, 'function gravityGainScale({ mmr }: { mmr: number })');
content = content.replace(/function gravityLossScale\(\{\s*mmr\s*\}\)/g, 'function gravityLossScale({ mmr }: { mmr: number })');
content = content.replace(/function mmrMultiplier\(\{\s*timeoutMultiplier\s*\}\)/g, 'function mmrMultiplier({ timeoutMultiplier }: { timeoutMultiplier: number })');
content = content.replace(/function applyTimeDecayRD\(\{\s*rd,\s*lastPlayedAt\s*\}\)/g, 'function applyTimeDecayRD({ rd, lastPlayedAt }: { rd: number, lastPlayedAt: number | null })');
content = content.replace(/function calculateConfidence\(\{\s*rd\s*\}\)/g, 'function calculateConfidence({ rd }: { rd: number })');
content = content.replace(/function getRankTitle\(\{\s*mmr\s*\}\)/g, 'function getRankTitle({ mmr }: { mmr: number })');
content = content.replace(/function formatStreak\(\{\s*currentStreak\s*\}\)/g, 'function formatStreak({ currentStreak }: { currentStreak: number })');
content = content.replace(/function getMedal\(\{\s*index\s*\}\)/g, 'function getMedal({ index }: { index: number })');
content = content.replace(/stringName/g, 'string');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed deathrollUtils.ts Part 4');
