import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/DiscordUtilityService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const patterns = [
  ['(indexError as any).code', '(indexError as Error & { code?: number }).code'],
  ['(fetchErr as any).code', '(fetchErr as Error & { code?: number }).code'],
  ['reactionMessage.reactions.cache.map((r: any) =>', 'reactionMessage.reactions.cache.map((r: import("discord.js").MessageReaction) =>'],
  ['customFunction: (...args: any[]) => void', 'customFunction: (...args: unknown[]) => void']
];

for (const [search, replace] of patterns) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed DiscordUtilityService.ts Part 3');
