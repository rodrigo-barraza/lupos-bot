import fs from 'fs';

function replaceInFile(filePath, search, replace) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(search, replace);
  fs.writeFileSync(filePath, content, 'utf-8');
}

// 1. guesswho.ts - WithId
replaceInFile('src/commands/utility/guesswho.ts', /WithId,\s*/g, '');

// 2. guesswholeaderboard.ts - WithId
replaceInFile('src/commands/utility/guesswholeaderboard.ts', /WithId,\s*/g, '');

// 3. LogFormatter.ts - prompt -> _prompt
replaceInFile('src/formatters/LogFormatter.ts', 'generateImageStart({ prompt }: { prompt: string }) {', 'generateImageStart({ prompt: _prompt }: { prompt: string }) {');

// 4. ActivityRoleAssignmentJob.ts - Collection
replaceInFile('src/jobs/scheduled/ActivityRoleAssignmentJob.ts', /Collection,\s*/g, '');

// 5. GuildRoutes.ts - GuildEmoji
replaceInFile('src/routes/GuildRoutes.ts', /GuildEmoji,\s*/g, '');

// 6. DiscordService.ts - MessageFlags, ChatInputCommandInteraction, ButtonInteraction
replaceInFile('src/services/DiscordService.ts', /MessageFlags,\s*/g, '');
replaceInFile('src/services/DiscordService.ts', /ChatInputCommandInteraction,\s*/g, '');
replaceInFile('src/services/DiscordService.ts', /ButtonInteraction,\s*/g, '');

console.log('Fixed unused variables in small files.');
