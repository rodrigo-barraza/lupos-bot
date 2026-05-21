const fs = require('fs');
let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

code = code.replace(/export interface PlayerProfile \{/, 'export interface PlayerProfile {\n  multiplierGames?: number;\n  multiplierWins?: number;\n  multiplierLosses?: number;\n  createdAt?: number;');
code = code.replace(/export interface UserStats \{/, 'export interface UserStats {\n  mmrSeason?: string;\n  multiplierGames?: number;\n  multiplierWins?: number;\n  multiplierLosses?: number;\n  createdAt?: number;');
code = code.replace(/export interface AggregatedStats \{/, 'export interface AggregatedStats {\n  multiplierGames?: number;\n  multiplierWins?: number;\n  multiplierLosses?: number;');

code = code.replace(/if \(!challengerMember \|\| !challengerMember\.moderatable \|\| !opponentMember \|\| !opponentMember\.moderatable\)/g, "if (!challengerMember || !('moderatable' in challengerMember) || !challengerMember.moderatable || !opponentMember || !('moderatable' in opponentMember) || !opponentMember.moderatable)");

code = code.replace(/const totalGames = playerStats\?\.totalGames \|\| wins \+ losses;/g, 'const totalGames = playerStats?.totalGames || (wins || 0) + (losses || 0);');

code = code.replace(/applyPendingTimeout\(guild!, pendingTimeoutData\)/g, 'applyPendingTimeout(guild!, pendingTimeoutData as PendingTimeoutData)');
code = code.replace(/buttonInteraction\.guild,/g, 'buttonInteraction.guild!,');
code = code.replace(/buttonInteraction\.guild\)\)/g, 'buttonInteraction.guild!))');
code = code.replace(/interaction\.guild\./g, 'interaction.guild!.');
code = code.replace(/interaction\.guild!\.!/g, 'interaction.guild!.');
code = code.replace(/interaction\.guildId,/g, 'interaction.guild!.id,');

code = code.replace(/formatStatsString\(stats\.initiator\)/g, 'formatStatsString(stats.initiator as Partial<PlayerProfile>)');
code = code.replace(/formatStatsString\(stats\.opponent\)/g, 'formatStatsString(stats.opponent as Partial<PlayerProfile>)');

code = code.replace(/game\.initiator/g, '(game.initiator as string)');
code = code.replace(/game\.opponent/g, '(game.opponent as string)');

code = code.replace(/\.catch\(\(err: unknown\) =>/g, '.catch(() =>');
code = code.replace(/statsCollection\.findOne\(\{\s*userId,\s*guildId\s*\}\)/g, 'statsCollection.findOne({ userId, guildId }) as unknown as Partial<UserStats> | null');

code = code.replace(/ActionRowBuilder<import\("discord\.js"\)\.ButtonBuilder\[\]>/g, 'ActionRowBuilder<import("discord.js").ButtonBuilder>');

code = code.replace(/const row = new ActionRowBuilder\(\)\.addComponents\(donButton\);/g, 'const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents(donButton);');
code = code.replace(/const row = new ActionRowBuilder\(\)\.addComponents\(rollButton\);/g, 'const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents(rollButton);');

// Additional fixes for the remaining TS errors
code = code.replace(/const userStats = await statsCollection\.findOne\(\{ userId, guildId \}\) as unknown as Partial<UserStats> \| null as unknown as Partial<UserStats> \| null/g, 'const userStats = await statsCollection.findOne({ userId, guildId }) as unknown as Partial<UserStats> | null');

code = code.replace(/if \(!\(\"moderatable\" in initiatorMember\) \|\| !initiatorMember\.moderatable\)/g, "if (!initiatorMember || !('moderatable' in initiatorMember) || !initiatorMember.moderatable)");
code = code.replace(/if \(!\(\"moderatable\" in opponentMember\) \|\| !opponentMember\.moderatable\)/g, "if (!opponentMember || !('moderatable' in opponentMember) || !opponentMember.moderatable)");
code = code.replace(/if \(!\(\"moderatable\" in targetMember\) \|\| !targetMember\.moderatable\)/g, "if (!targetMember || !('moderatable' in targetMember) || !targetMember.moderatable)");

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
