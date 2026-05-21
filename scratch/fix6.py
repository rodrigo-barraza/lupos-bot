import re
with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix Events import
content = content.replace('import type { Client, Events, PartialMessage, PartialGuildMember } from "discord.js";', 'import type { Client, PartialMessage, PartialGuildMember } from "discord.js";')
content = content.replace('import { Collection, ChannelType, ActivityType } from "discord.js";', 'import { Collection, ChannelType, ActivityType, Events } from "discord.js";')

# Fix attachment.contentType is possibly null
content = content.replace('attachment.contentType.startsWith("video/")', 'attachment.contentType?.startsWith("video/")')
content = content.replace('attachment.contentType.startsWith("image/")', 'attachment.contentType?.startsWith("image/")')

# Fix MessageReference assignment
content = content.replace('reference: repliedMessage,', 'reference: repliedMessage ? { messageId: repliedMessage.id, channelId: repliedMessage.channelId, guildId: repliedMessage.guildId } : undefined,')

# Fix Message<boolean> user (user doesn't exist on Message)
content = content.replace('returnedFirstMessage.user.id', 'returnedFirstMessage.author.id')
content = content.replace('sentMessage.user.id', 'sentMessage.author.id')
content = content.replace('repliedMessage.user.id', 'repliedMessage.author.id')

# Fix messageId undefined
content = content.replace('const message = await channel.messages.fetch(messageId);', 'const message = messageId ? await (channel as import("discord.js").TextChannel).messages.fetch(messageId) : undefined;')

# Fix message.guild possibly null
content = content.replace('if (message.guild.emojis.cache.size)', 'if (message.guild && message.guild.emojis.cache.size)')
content = content.replace('message.guild.emojis.cache.map(', 'message.guild?.emojis.cache.map(')

# Fix map callback type
content = content.replace('(emoji: GuildEmoji) => {', '(emoji: import("discord.js").GuildEmoji) => {')

# Fix message.guild map
content = content.replace('const emojis = message.guild?.emojis.cache.map((emoji: import("discord.js").GuildEmoji) => {', 'const emojis = message.guild ? message.guild.emojis.cache.map((emoji: import("discord.js").GuildEmoji) => {')

# Fix channel.messages.fetch properties (lines 1836, 1858, 1889, etc)
content = content.replace('channel.messages.fetch(', '(channel as import("discord.js").TextChannel).messages.fetch(')

# limit type
content = content.replace('limit: limit,', 'limit: Number(limit),')

# Collection missing properties -> cast
content = content.replace('const guilds: import("discord.js").Collection<string, import("discord.js").Guild> = client.guilds.cache;', 'const guilds = client.guilds.cache as unknown as import("mongodb").Collection<import("mongodb").Document>;')

# Fix user missing properties (displayName)
# user is User type
# wait, what was it in line 1965?
content = content.replace('displayName: user.displayName,', 'displayName: (user as any).displayName,')
content = content.replace('username: user.username,', 'username: (user as any).username,')
content = content.replace('globalName: user.globalName,', 'globalName: (user as any).globalName,')

# Wait, `client.user` could be null
content = content.replace('client.user.id', 'client.user?.id')

# Let's write this with care
with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
