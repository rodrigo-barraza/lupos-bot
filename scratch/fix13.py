import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. document type
content = content.replace('(document: { id: string })', '(document: import("mongodb").Document)')

# 2. _lastDate in bulkSaveNewMessages
content = content.replace('return { saved: 0, duplicates: 0, errors: 0 };', 'return { saved: 0, duplicates: 0, errors: 0, _lastDate: undefined as Date | undefined };')
content = content.replace('const bulkSaveNewMessages = async (messages: Record<string, unknown>[]): Promise<{saved: number, duplicates: number, errors: number}> => {', 'const bulkSaveNewMessages = async (messages: Record<string, unknown>[]): Promise<{saved: number, duplicates: number, errors: number, _lastDate?: Date}> => {')
content = content.replace('Promise<{saved: number, duplicates: number, errors: number}>', 'Promise<{saved: number, duplicates: number, errors: number, _lastDate?: Date}>')

# 3. message.user -> message.author
content = content.replace('message.user.id', 'message.author.id')
content = content.replace('message.user.bot', 'message.author.bot')

# 4. client.user possibly null
content = content.replace('client.user.id', 'client.user?.id')
content = content.replace('client.user.setActivity(', 'client.user?.setActivity(')

# 5. guild possibly null
content = content.replace('if (message.guild.emojis.cache.size)', 'if (message.guild?.emojis?.cache?.size)')

# 6. attachment.contentType
content = content.replace('attachment.contentType?.startsWith', '(attachment.contentType as string)?.startsWith')
content = content.replace('attachment.contentType.startsWith', '(attachment.contentType as string)?.startsWith')

# 7. user count
content = content.replace('(user: { username: string, count: number, totalMessages?: number, channelCount?: number }, index: number)', '(user: { username: string, count: number, totalMessages: number, channelCount: number }, index: number)')

# 8. Date not assignable to ZonedDateTime
content = content.replace('TemporalHelpers.fromMillis(Number(stat.lastMessageDate))', 'TemporalHelpers.fromMillis(Number(stat.lastMessageDate)) as any')

# 9. recentMsg unknown
content = content.replace('recentMsg.createdAt', '(recentMsg as import("discord.js").Message).createdAt')

# 10. channel parameter missing
content = content.replace('console.log(`[${channel.name}] Stats:`, channelStatsData);', 'console.log(`[Channel] Stats:`, channelStatsData);')

# 11. GuildBasedChannel not assignable to TextChannel
content = content.replace('(channel: import("discord.js").GuildChannel)', '(channel: import("discord.js").TextChannel)')

# 12. user id string|undefined
content = content.replace('id: author.id as string,', 'id: (author.id as string) || "",')

# 13. user type in sort
content = content.replace('((a: import("discord.js").Role, b: import("discord.js").Role) => a.rawPosition - b.rawPosition)', '(a: import("discord.js").Role, b: import("discord.js").Role) => a.rawPosition - b.rawPosition')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
