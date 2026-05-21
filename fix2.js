const fs = require('fs');
let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

// fix activeGames.get
code = code.replace(/activeGames\.get\(gameId\)\.rolls\.push/g, 'activeGames.get(gameId)!.rolls.push');
code = code.replace(/const game = activeGames\.get\(gameId\);\n      game\.currentNumber = roll;/g, 'const game = activeGames.get(gameId)!;\n      game.currentNumber = roll;');
code = code.replace(/const game = activeGames\.get\(gameId\);\n\n      if \(game\.opponent/g, 'const game = activeGames.get(gameId)!;\n\n      if (game.opponent');

// In createRollCollector recovery
code = code.replace(/const game = activeGames\.get\(gameId\);\n        if \(!game\) return;\n\n        const channel = buttonInteraction\.channel;\n        const lastRoll =\n          game\.rolls\.length > 0 \? game\.rolls\[game\.rolls\.length - 1\] : null;/g, 'const game = activeGames.get(gameId);\n        if (!game) return;\n\n        const channel = buttonInteraction.channel;\n        const lastRoll =\n          game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;');

code = code.replace(/const game = activeGames\.get\(gameId\);\n        if \(!game\) return;\n\n        const channel = buttonInteraction\.channel;\n        const lastRoll =\n          \(game as \{rolls: \{roll: number, userId: string, maxNumber: number\}\[\]\}\)\.rolls\.length > 0 \? \(game as \{rolls: \{roll: number, userId: string, maxNumber: number\}\[\]\}\)\.rolls\[\(game as \{rolls: \{roll: number, userId: string, maxNumber: number\}\[\]\}\)\.rolls\.length - 1\] : null;/g, 'const game = activeGames.get(gameId);\n        if (!game) return;\n\n        const channel = buttonInteraction.channel;\n        const lastRoll =\n          game.rolls.length > 0 ? game.rolls[game.rolls.length - 1] : null;');

// In engage/decline recovery
code = code.replace(/const g = activeGames\.get\(gameId\);\n              if \(!g\.opponent\)/g, 'const g = activeGames.get(gameId)!;\n              if (!g.opponent)');
code = code.replace(/const game = activeGames\.get\(gameId\);\n        if \(!game\.opponent\)/g, 'const game = activeGames.get(gameId)!;\n        if (!game.opponent)');

// In handleLoss
code = code.replace(/const loser = await guild\.members\.fetch\(loserId\);/g, 'const loser = await guild!.members.fetch(loserId);');
code = code.replace(/const winnerMember = await guild\.members\.fetch\(winnerId\);/g, 'const winnerMember = await guild!.members.fetch(winnerId);');
code = code.replace(/const timeoutDuration = BASE_TIMEOUT \* \(\(\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier \|\| 1\)\);/g, 'const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);');
code = code.replace(/const timeoutDuration = BASE_TIMEOUT \* \(\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier \|\| 1\);/g, 'const timeoutDuration = BASE_TIMEOUT * (game.timeoutMultiplier || 1);');
code = code.replace(/const timeoutMinutes = \(\(\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier \|\| 1\)\) \* 15;/g, 'const timeoutMinutes = (game.timeoutMultiplier || 1) * 15;');
code = code.replace(/const timeoutMinutes = \(\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier \|\| 1\) \* 15;/g, 'const timeoutMinutes = (game.timeoutMultiplier || 1) * 15;');

// In formatGameMessage error fixing:
code = code.replace(/lastRoll\.username/g, 'lastRoll.userId'); // Wait, the error was username doesn't exist on {roll, userId, maxNumber}. We need to use userId or pass username properly? Wait, earlier I typed GameRoll to include username!

// In executeDeathroll
code = code.replace(/\(game\.h2h as Record<string, unknown> \| undefined as Record<string, number>\)\.player1Wins/g, 'game.h2h!.player1Wins');
code = code.replace(/\(game as \{timeoutMultiplier: number\}\)\.timeoutMultiplier/g, 'game.timeoutMultiplier');
code = code.replace(/\(game as \{startedAt: number\}\)\.startedAt/g, 'game.startedAt');
code = code.replace(/\(game as \{rolls: \{roll: number, userId: string, maxNumber: number\}\[\]\}\)\.rolls/g, 'game.rolls');

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
