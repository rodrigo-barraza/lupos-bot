const fs = require('fs');
let code = fs.readFileSync('src/commands/utility/deathrollUtils.ts', 'utf8');

code = code.replace(/const \{ wins, losses, mmr, rank, isPlacement \} = stats;/g, 'const { wins = 0, losses = 0, mmr, rank, isPlacement } = stats;');

code = code.replace(/const lastPlayedAt = playerStats\?\.lastPlayedAt \|\| null;/g, 'const lastPlayedAt = playerStats?.lastPlayedAt || undefined;');
code = code.replace(/const createdAt = playerStats\?\.createdAt \|\| null;/g, 'const createdAt = playerStats?.createdAt || undefined;');

code = code.replace(/applyPendingTimeout\(guild!, pendingTimeoutData\)/g, 'applyPendingTimeout(guild!, pendingTimeoutData as PendingTimeoutData)');
code = code.replace(/applyPendingTimeout\(guild!, pendingTimeoutData as PendingTimeoutData \| null\)/g, 'applyPendingTimeout(guild!, pendingTimeoutData as PendingTimeoutData)');

code = code.replace(/if \(!opponentMember \|\| !opponentMember\.moderatable\)/g, "if (!opponentMember || !('moderatable' in opponentMember) || !opponentMember.moderatable)");
code = code.replace(/if \(!\(\"moderatable\" in opponentMember\) \|\| !opponentMember\.moderatable\)/g, "if (!opponentMember || !('moderatable' in opponentMember) || !opponentMember.moderatable)");

code = code.replace(/buttonInteraction\.guild,/g, 'buttonInteraction.guild!,');
code = code.replace(/buttonInteraction\.guild\)\)/g, 'buttonInteraction.guild!))');

code = code.replace(/if \(!interaction\.member \|\| !interaction\.member\.moderatable\)/g, "if (!interaction.member || !('moderatable' in interaction.member) || !interaction.member.moderatable)");
code = code.replace(/if \(!interaction\.member \|\| !\(\"moderatable\" in interaction\.member\) \|\| !interaction\.member\.moderatable\)/g, "if (!interaction.member || !('moderatable' in interaction.member) || !interaction.member.moderatable)");

code = code.replace(/ephemeral: true,/g, '');

code = code.replace(/formatStatsString\(stats\.initiator\)/g, 'formatStatsString(stats.initiator as Partial<PlayerProfile>)');
code = code.replace(/formatStatsString\(stats\.opponent\)/g, 'formatStatsString(stats.opponent as Partial<PlayerProfile>)');

code = code.replace(/ActionRowBuilder<import\("discord\.js"\)\.ButtonBuilder\[\]>/g, 'ActionRowBuilder<import("discord.js").ButtonBuilder>');

code = code.replace(/const row = new ActionRowBuilder\(\)\.addComponents\(donButton\);/g, 'const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents(donButton);');
code = code.replace(/const row = new ActionRowBuilder\(\)\.addComponents\(rollButton\);/g, 'const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents(rollButton);');

// 2207: Argument of type 'string | null' is not assignable to parameter of type 'string'.
// fetchTopRivals(guildId: string, userId: string, limit: number = 3)
code = code.replace(/fetchTopRivals\(guild\.id, \(game\.initiator as string\), userId\)/g, 'fetchTopRivals(guild.id, (game.initiator as string), userId)');

// 1921: Object is possibly null - interaction.guild!.members.me
code = code.replace(/interaction\.guild!\.members\.me\.permissions\.has/g, 'interaction.guild!.members.me?.permissions.has');

// 2244: 'profile.multiplierGames' is possibly 'undefined'
code = code.replace(/profile\.multiplierGames > 0/g, '(profile.multiplierGames || 0) > 0');
code = code.replace(/profile\.multiplierWins/g, '(profile.multiplierWins || 0)');
code = code.replace(/profile\.multiplierLosses/g, '(profile.multiplierLosses || 0)');

code = code.replace(/await fetchHeadToHead\(guild\.id, \(game\.initiator as string\), userId\);/g, 'await fetchHeadToHead(guild.id, (game.initiator as string), userId);');
code = code.replace(/const h2h = await fetchHeadToHead\(guildId, loserId, winnerId\);/g, 'const h2h = await fetchHeadToHead(guildId!, loserId, winnerId);');

fs.writeFileSync('src/commands/utility/deathrollUtils.ts', code);
