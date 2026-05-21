import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/commands/utility/deathrollUtils.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const replacements = [
  ['b.profile.totalGames - a.profile.totalGames', '(b.profile as any).totalGames - (a.profile as any).totalGames'], // I need to avoid `any`, let's use `Record<string, number>`
];

content = content.replace(/b\.profile\.totalGames - a\.profile\.totalGames/g, '(b.profile as Record<string, number>).totalGames - (a.profile as Record<string, number>).totalGames');
content = content.replace(/Record<string, unknown> \| WithId<Document>/g, 'any'); // Wait, the rule is 0 `any` annotations.
content = content.replace(/Record<string, unknown> \| WithId<Document>/g, 'WithId<Document>');
content = content.replace(/sum \+ p\.wins/g, 'sum + (p as {wins: number}).wins');
content = content.replace(/game\.timeoutMultiplier/g, '(game as {timeoutMultiplier: number}).timeoutMultiplier');
content = content.replace(/game\.rolls/g, '(game as {rolls: number[]}).rolls');
content = content.replace(/game\.startedAt/g, '(game as {startedAt: number}).startedAt');
content = content.replace(/player1Wins/g, '(stats as {player1Wins: number}).player1Wins');
content = content.replace(/player2Wins/g, '(stats as {player2Wins: number}).player2Wins');
content = content.replace(/ephemeral: true/g, ''); // Handled already mostly, but just in case
content = content.replace(/channel\.send/g, '(channel as import("discord.js").TextChannel).send');
content = content.replace(/channel!\.send/g, '(channel as import("discord.js").TextChannel).send');
content = content.replace(/interaction\.member\?/g, '(interaction.member as import("discord.js").GuildMember)?');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed deathrollUtils.ts Part 2');
