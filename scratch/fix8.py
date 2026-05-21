import re
with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. channel name / id issues
content = content.replace('(channel: string | GuildChannel)', '(channel: import("discord.js").GuildChannel)')
content = content.replace('(channel: GuildChannel | string)', '(channel: import("discord.js").GuildChannel)')
content = content.replace('channel.parentId', '(channel as import("discord.js").GuildChannel).parentId')

# 2. bulkSaveNewMessages signature
content = content.replace('const bulkSaveNewMessages = async (messages: Record<string, unknown>[]) => {', 'const bulkSaveNewMessages = async (messages: Record<string, unknown>[]): Promise<{saved: number, duplicates: number, errors: number}> => {')

# 3. options: Record<string, unknown> = {}
content = content.replace('options: Record<string, unknown> = {}', 'options: Record<string, unknown> = {}')
# Wait, `concurrencyLimit` etc are destructured from `options`.
content = content.replace('const {\n      collectionName = "Messages",', 'const {\n      collectionName = "Messages",\n      concurrencyLimit = 10,\n      resumePoints = null,\n      batchSize = 100,\n      dateLimit = "2025-11-01",\n      categoryIds = null,\n      channelIds = null,\n      forceUpdate = false,\n      autoResume = true,\n    } = options as { collectionName?: string, concurrencyLimit?: number, resumePoints?: {channelId: string, lastMessageId: string}[], batchSize?: number, dateLimit?: string, categoryIds?: string[] | null, channelIds?: string[] | null, forceUpdate?: boolean, autoResume?: boolean };\n    /*')
content = content.replace('autoResume = true, // Persist per-channel checkpoints for crash recovery\n    } = options;', '*/')

# 4. Message object
content = content.replace('message.user.', 'message.author.')

# 5. attachment.contentType
content = content.replace('attachment.contentType?.startsWith', '(attachment.contentType as string)?.startsWith')
content = content.replace('attachment.contentType.startsWith', '(attachment.contentType as string)?.startsWith')

# 6. reference
content = content.replace('reference: repliedMessage ? { messageId: repliedMessage.id, channelId: repliedMessage.channelId, guildId: repliedMessage.guildId } : undefined,', 'reference: repliedMessage ? { messageId: (repliedMessage as import("discord.js").Message).id, channelId: (repliedMessage as import("discord.js").Message).channelId, guildId: (repliedMessage as import("discord.js").Message).guildId } : undefined,')

# 7. user string/undefined
content = content.replace('id: author.id,', 'id: author.id as string,')
content = content.replace('userId: author.id,', 'userId: author.id as string,')
content = content.replace('username: author.username,', 'username: author.username as string,')

# 8. Events handlers
content = content.replace('(message: Record<string, unknown>)', '(message: import("discord.js").Message)')
content = content.replace('oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage', 'oldMessage: import("discord.js").Message | import("discord.js").PartialMessage, newMessage: import("discord.js").Message | import("discord.js").PartialMessage')
content = content.replace('reaction: MessageReaction | PartialMessageReaction, user: User', 'reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction, user: import("discord.js").User')
content = content.replace('(member: GuildMember)', '(member: import("discord.js").GuildMember)')

# 9. textResponse used before declaration
content = content.replace('const textResponse = generatedTextResponse || "";\n    for (', 'const textResponse = generatedTextResponse || "";\n    for (')

# 10. stat errors
content = content.replace('(stat: Record<string, unknown>, index: number)', '(stat: { averageMessagesPerDay: number, messageCount: number, uniqueUsers: number, lastMessageDate: any, categoryName: string, channel: import("discord.js").TextChannel, topUsers: any[] }, index: number)')
content = content.replace('(sum: number, stat: Record<string, unknown>) => sum + (stat.messageCount as number),', '(sum: number, stat: { messageCount: number }) => sum + stat.messageCount,')
content = content.replace('channelStats.filter(\n      (stat: Record<string, unknown>) => (stat.messageCount as number) > 0,', 'channelStats.filter(\n      (stat: { messageCount: number }) => stat.messageCount > 0,')
content = content.replace('channelStats.filter(\n      (stat: Record<string, unknown>) => (stat.messageCount as number) === 0,', 'channelStats.filter(\n      (stat: { messageCount: number }) => stat.messageCount === 0,')
content = content.replace('channelStats.sort(\n      (a: Record<string, unknown>, b: Record<string, unknown>) => (b.averageMessagesPerDay as number) - (a.averageMessagesPerDay as number),', 'channelStats.sort(\n      (a: { averageMessagesPerDay: number }, b: { averageMessagesPerDay: number }) => b.averageMessagesPerDay - a.averageMessagesPerDay,')

# 11. Role / GuildMember
content = content.replace('async addRoleToMember(member: GuildMember, roleId: string)', 'async addRoleToMember(member: import("discord.js").GuildMember, roleId: string)')
content = content.replace('await member.roles.add(role);', 'await member.roles.add(role as import("discord.js").RoleResolvable);')

# 12. messages.fetch issues
content = content.replace('await (channel as import("discord.js").TextChannel).messages.fetch({ limit: 100 })', 'await (channel as import("discord.js").TextChannel).messages.fetch({ limit: 100 })')
content = content.replace('messages: Record<string, unknown>[] = messages ?', 'messagesArray: import("discord.js").Message[] = messages ?')
content = content.replace('Array.from(messages.values()) as Record<string, unknown>[]', 'Array.from(messages.values()) as import("discord.js").Message[]')
content = content.replace('Array.from(messages.values())', 'Array.from(messages.values()) as import("discord.js").Message[]')
content = content.replace('allMessages.some((existingMsg: Record<string, unknown>) => existingMsg.id === message.id)', 'allMessages.some((existingMsg: import("discord.js").Message) => existingMsg.id === message.id)')
content = content.replace('messagesInPeriod.forEach((message: Record<string, unknown>) => {', 'messagesInPeriod.forEach((message: import("discord.js").Message) => {')

content = content.replace('const messagesArray: Record<string, unknown>[] = messages ? Array.from(messages.values()) as Record<string, unknown>[] : [];', 'const messagesArray: import("discord.js").Message[] = messages ? Array.from(messages.values()) as import("discord.js").Message[] : [];')

# 13. user type mapping
content = content.replace('const userObject = {', 'const userObject: Record<string, unknown> = {')

# 14. Error catching
content = content.replace('LogFormatter.roleFailedToRemove(member.user.id, role as Role, (error as Error).message)', 'LogFormatter.roleFailedToRemove(member.user.id, role as import("discord.js").Role, String(error))')
content = content.replace('LogFormatter.roleFailedToAdd(member.user.id, role as Role, (error as Error).message)', 'LogFormatter.roleFailedToAdd(member.user.id, role as import("discord.js").Role, String(error))')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
