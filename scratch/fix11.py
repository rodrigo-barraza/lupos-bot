import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# channel.messages
content = content.replace('channel.messages.fetch', '(channel as import("discord.js").TextChannel).messages.fetch')

# messageArray type
content = content.replace('const messageArray: Message[] = Array.from(allMessages.values());', 'const messageArray: Message[] = Array.from(allMessages.values()) as Message[];')
content = content.replace('const messagesArray: Message[] = messages ? Array.from(messages.values()) : [];', 'const messagesArray: Message[] = messages ? Array.from(messages.values()) as Message[] : [];')

# return { saved: 0, duplicates: 0, errors: 0 } as Record<string, any>;
content = content.replace('return { saved: 0, duplicates: 0, errors: 0 } as Record<string, any>;', 'return { saved: 0, duplicates: 0, errors: 0 };')

# channel type in sendMessageInChunks
content = content.replace('await message.channel.send(', 'await (message.channel as TextChannel).send(')
content = content.replace('return await message.channel.send({ files });', 'return await (message.channel as TextChannel).send({ files });')

# channel type in getChannelName
content = content.replace('channel.name', '(channel as TextChannel).name')

# guild is possibly undefined
content = content.replace('const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);', 'const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);\n    if (!guild) return;')
content = content.replace('const guild = client.guilds.cache.get(guildId);', 'const guild = client.guilds.cache.get(guildId);\n    if (!guild) return;')
content = content.replace('const guild = client.guilds.cache.get(guildId as string);', 'const guild = client.guilds.cache.get(guildId as string);\n    if (!guild) return;')

# user type
content = content.replace('(user: User, index: number)', '(user: { username: string, count: number, totalMessages?: number, channelCount?: number }, index: number)')

# temporal helpers
content = content.replace('TemporalHelpers.fromMillis(stat.lastMessageDate.getTime())', 'TemporalHelpers.fromMillis(Number(stat.lastMessageDate))')
content = content.replace('TemporalHelpers.fromMillis(stat.lastMessageDate)', 'TemporalHelpers.fromMillis(Number(stat.lastMessageDate))')

# error in sendTyping
content = content.replace('channel.sendTyping().catch((error: unknown) => {', 'channel.sendTyping().catch((error: unknown) => {')
content = content.replace('console.error(`Error sending typing indicator in channel ${channel.id}:`, error);', 'console.error(`Error sending typing indicator in channel ${channel.id}:`, (error as Error).message);')

# role | undefined
content = content.replace('const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);', 'const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);\n    if (!role) return;')

# role | undefined roleAdded
content = content.replace('LogFormatter.roleAdded(member, role)', 'LogFormatter.roleAdded(member, role as Role)')
content = content.replace('LogFormatter.roleRemoved(member, role)', 'LogFormatter.roleRemoved(member, role as Role)')

# client.user possibly null
content = content.replace('client.user.id', 'client.user?.id')
content = content.replace('client.user.setStatus(status)', 'if (client.user) client.user.setStatus(status)')

# channel.parent
content = content.replace('channel.parent.name', 'channel.parent?.name')

# emojis map string
content = content.replace('(emoji: GuildEmoji) => `<${emoji.name}:${emoji.id}>`', '(emoji: { name: string, id: string }) => `<${emoji.name}:${emoji.id}>`')

# error in role
content = content.replace('member.roles.add(role as import("discord.js").RoleResolvable)', 'if (role) await member.roles.add(role)')
content = content.replace('member.roles.remove(role)', 'if (role) await member.roles.remove(role)')

# Event parameter overrides
content = content.replace('reaction: MessageReaction | PartialMessageReaction', 'reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction')

# member to string error in AddRoleToMember
content = content.replace('LogFormatter.roleFailedToAdd(member.user.id, role as import("discord.js").Role, String(error))', 'LogFormatter.roleFailedToAdd(member.user.id, role as import("discord.js").Role, String(error))')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
