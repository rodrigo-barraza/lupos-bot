const fs = require('fs');

function applyFixes(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix localMongo and mongo unknown parameters in Record<string, unknown>
  content = content.replace(/\{ localMongo \}: Record<string, unknown>/g, '{ localMongo }: { localMongo: import("mongodb").MongoClient }');
  content = content.replace(/\{ localMongo, channelIds, guildIds, dateLimit \}: Record<string, unknown>/g, '{ localMongo, channelIds, guildIds, dateLimit }: { localMongo: import("mongodb").MongoClient, channelIds?: string[], guildIds?: string[], dateLimit?: string }');
  content = content.replace(/\{ mongo \}: Record<string, unknown>/g, '{ mongo }: { mongo: import("mongodb").MongoClient }');
  content = content.replace(/\{ mongo, localMongo \}: Record<string, unknown>/g, '{ mongo, localMongo }: { mongo: import("mongodb").MongoClient, localMongo: import("mongodb").MongoClient }');

  // Fix message and recentMessage of type unknown
  content = content.replace(/recentMessage\.cleanContent/g, '(recentMessage as Message).cleanContent');
  content = content.replace(/recentMessage\.author/g, '(recentMessage as Message).author');
  content = content.replace(/message\.content/g, '(message as Message).content');
  content = content.replace(/message\.guild/g, '(message as Message).guild');
  content = content.replace(/message\.channel/g, '(message as Message).channel');
  content = content.replace(/message\.member/g, '(message as Message).member');
  content = content.replace(/message\.id/g, '(message as Message).id');

  // Fix client.user possibly null
  content = content.replace(/client\.user\.id/g, 'client.user!.id');
  content = content.replace(/client\.user,/g, 'client.user!,');
  content = content.replace(/client\.user\)/g, 'client.user!)');
  content = content.replace(/client\.application\.id/g, 'client.application!.id');

  // Fix Argument of type 'string | undefined' is not assignable to parameter of type 'string'
  content = content.replace(/config\.ROLE_ID_BOT_CHATTER/g, '(config.ROLE_ID_BOT_CHATTER as string)');
  content = content.replace(/config\.GUILD_ID_PRIMARY,/g, '(config.GUILD_ID_PRIMARY as string),');
  content = content.replace(/config\.CHANNEL_ID_POLITICS,/g, '(config.CHANNEL_ID_POLITICS as string),');

  // Fix arithmetic operation on undefined/unknown
  content = content.replace(/\(new Date\(\) - messageSentTimestamp\)/g, '(new Date().getTime() - (messageSentTimestamp as number))');
  content = content.replace(/Date\.now\(\) - queuedDatum\.timestamp/g, 'Date.now() - (queuedDatum.timestamp as number)');

  // Fix Collection<unknown, unknown> to Collection<string, DiscordCollection<...>>
  content = content.replace(/new Collection\(\)/g, 'new Collection<any, any>()');

  // Fix 'send', 'messages' does not exist on type 'Channel'
  content = content.replace(/const channel = client\.channels\.cache\.get\((.*?)\);/g, 'const channel = client.channels.cache.get($1) as TextChannel;');
  content = content.replace(/message\.channel\.messages/g, '(message.channel as TextChannel).messages');

  // Fix transcriptionsCollection
  content = content.replace(/transcriptionsCollection\?\.size/g, '(transcriptionsCollection?.size ?? 0)');
  content = content.replace(/transcriptionsCollection\.values/g, 'transcriptionsCollection!.values');

  // Fix ActionRowBuilder
  content = content.replace(/ActionRowBuilder<AnyComponentBuilder>/g, 'ActionRowBuilder<any>');

  fs.writeFileSync(filePath, content, 'utf8');
}

applyFixes('src/services/DiscordService.ts');
console.log('Fixes applied');
