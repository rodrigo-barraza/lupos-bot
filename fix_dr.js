const fs = require('fs');
let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

code = code.replace(/async function handleLoss\(\n  buttonInteraction: ButtonInteraction,\n  game: Record<string, unknown>,\n  loserId: string,\n  roll: number,\n  gameOverMessage: Message,\n\) \{/m, 'async function handleLoss(\n  buttonInteraction: ButtonInteraction,\n  game: GameState,\n  loserId: string,\n  roll: number,\n  gameOverMessage: Message | null,\n) {');

code = code.replace(/async function handleTimeoutLoss\(guild: Guild, game: Record<string, unknown>, winnerId: string, loserId: string\) \{/, 'async function handleTimeoutLoss(guild: Guild, game: GameState, winnerId: string, loserId: string) {');

code = code.replace(/async function applyPendingTimeout\(guild: Guild, pendingTimeoutData: Record<string, unknown>\) \{/, 'async function applyPendingTimeout(guild: Guild, pendingTimeoutData: PendingTimeoutData) {');

code = code.replace(/\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier/g, 'game.timeoutMultiplier');
code = code.replace(/\(game as \{rolls: \{roll: number, userId: string, maxNumber: number\}\[\]\}\)\.rolls/g, 'game.rolls');
code = code.replace(/\(game as \{startedAt: number\}\)\.startedAt/g, 'game.startedAt');
code = code.replace(/game\.initiator as string/g, 'game.initiator');
code = code.replace(/game\.opponent as string/g, 'game.opponent!');
code = code.replace(/game\.startingNumber as number/g, 'game.startingNumber');
code = code.replace(/\(game\.h2h as Record<string, unknown> \| undefined as Record<string, number>\)\.player1Wins/g, 'game.h2h!.player1Wins');
code = code.replace(/\(game\.h2h as Record<string, unknown> \| undefined as Record<string, number>\)\.player2Wins/g, 'game.h2h!.player2Wins');
code = code.replace(/game\.h2h as Record<string, unknown> \| undefined/g, 'game.h2h');

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
