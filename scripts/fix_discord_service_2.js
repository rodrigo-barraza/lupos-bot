import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/DiscordService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const patterns = [
  ['_maxSimultaneous: any = 50,', '_maxSimultaneous: number = 50,'],
  ['members.filter((m: any) => m.roles.cache.has(REVOKE_ROLE_ID));', 'members.filter((m: import("discord.js").GuildMember) => m.roles.cache.has(REVOKE_ROLE_ID));']
];

for (const [search, replace] of patterns) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed DiscordService.ts Part 2');
