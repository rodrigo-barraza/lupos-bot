const fs = require('fs');
let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

code = code.replace(/\(game\.initiator as string\)Name/g, 'game.initiatorName');
code = code.replace(/\(game\.opponent as string\)Name/g, 'game.opponentName');
code = code.replace(/\(game\.opponent as string\) = userId;/g, 'game.opponent = userId;');

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
