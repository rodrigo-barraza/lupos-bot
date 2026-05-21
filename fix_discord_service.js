const fs = require('fs');
const file = 'src/services/DiscordService.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. MessageFlags.Ephemeral -> ephemeral: true
content = content.replace(/flags:\s*MessageFlags\.Ephemeral/g, 'ephemeral: true');

// 2. member / interaction.guild possibly null
content = content.replace(/const freshMember = await interaction\.guild\.members\.fetch\(member\.id\);/g, 'const freshMember = await interaction.guild!.members.fetch(member.id);');
content = content.replace(/const member = interaction\.member;/g, 'const member = interaction.member as GuildMember;\n        if (!interaction.guild) return;');

// 3. YouTubeService
content = content.replace(/\(YouTubeService as Record<string, \(\.\.\.args: unknown\[\]\) => void>\)/g, '(YouTubeService as unknown as Record<string, (...args: unknown[]) => void>)');

// 4. client.commands
content = content.replace(/const command = client\.commands\.get\(interaction\.commandName\);/g, 'const command = (client as Client & { commands: DiscordCollection<string, any> }).commands.get(interaction.commandName);');
content = content.replace(/commands: DiscordCollection<string, any>/g, 'commands: DiscordCollection<string, { execute: (interaction: Interaction) => Promise<void> }>');

// 5. error as Error
content = content.replace(/\.\.\.LogFormatter\.commandError\(functionName, interaction, error\),/g, '...LogFormatter.commandError(functionName, interaction, error as Error),');

// 6. leaversLogChannel
content = content.replace(/const leaversLogChannel = DiscordUtilityService\.getChannelById\(\n\s*client,\n\s*config\.CHANNEL_ID_LEAVERS,\n\s*\);/g, 'const leaversLogChannel = DiscordUtilityService.getChannelById(\n          client,\n          config.CHANNEL_ID_LEAVERS,\n        ) as TextChannel;');

// 7. newState.member
content = content.replace(/if \(newState\.channelId\) \{/g, 'if (!newState.member) return;\n  if (newState.channelId) {');

// 8. guilds
content = content.replace(/const guilds = DiscordUtilityService\.getAllGuilds\(client\);/g, 'const guilds = DiscordUtilityService.getAllGuilds(client) as DiscordCollection<string, Guild>;');

// 9. sticker
content = content.replace(/const sticker = message\.stickers\.first\(\);/g, 'const sticker = message.stickers.first();\n    if (!sticker) return "";');

// 10. collections types
content = content.replace(/messagesTranscriptionsCollection: DiscordCollection<string, string>/g, 'messagesTranscriptionsCollection: DiscordCollection<string, DiscordCollection<string, { transcription: string }>>');
content = content.replace(/messagesImagesCollection: DiscordCollection<string, string>/g, 'messagesImagesCollection: DiscordCollection<string, DiscordCollection<string, { url: string, caption: string }>>');

// 11. DATABASE_URL
content = content.replace(/config\.DATABASE_URL!/g, '(config.DATABASE_URL as string)');

// 12. luposOnReady
content = content.replace(/,\n\s*luposOnReady,/g, ',\n      luposOnReady as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyCloneMessages,/g, ',\n      luposOnReadyCloneMessages as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyRescrapeChannels,/g, ',\n      luposOnReadyRescrapeChannels as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyDeleteDuplicateMessages,/g, ',\n      luposOnReadyDeleteDuplicateMessages as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyDeleteNewAccounts,/g, ',\n      luposOnReadyDeleteNewAccounts as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyPurgeYoungAccounts,/g, ',\n      luposOnReadyPurgeYoungAccounts as (...args: unknown[]) => void,');
content = content.replace(/,\n\s*luposOnReadyReports,/g, ',\n      luposOnReadyReports as (...args: unknown[]) => void,');

// 13. localMongo
content = content.replace(/const mongo = MongoService\.getClient\("local"\);/g, 'const mongo = MongoService.getClient("local") as import("mongodb").MongoClient;');
content = content.replace(/const localMongo = MongoService\.getClient\("local"\);/g, 'const localMongo = MongoService.getClient("local") as import("mongodb").MongoClient;');

fs.writeFileSync(file, content, 'utf8');
console.log('done');
