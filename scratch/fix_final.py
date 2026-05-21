import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace any with specific types based on parameter names.
# This time we use \b to strictly match parameters and avoid replacing inside other strings.
content = re.sub(r'\(client: any\)', '(client: import("discord.js").Client)', content)
content = re.sub(r'\(client: any,', '(client: import("discord.js").Client,', content)
content = re.sub(r'client: any,', 'client: import("discord.js").Client,', content)

content = re.sub(r'mongo: any,', 'mongo: import("mongodb").MongoClient,', content)
content = re.sub(r'mongo: any\)', 'mongo: import("mongodb").MongoClient)', content)

content = re.sub(r'\(message: any\)', '(message: import("discord.js").Message)', content)
content = re.sub(r'message: any,', 'message: import("discord.js").Message,', content)

content = re.sub(r'channel: any,', 'channel: import("discord.js").TextChannel,', content)
content = re.sub(r'\(channel: any\)', '(channel: import("discord.js").TextChannel)', content)

content = re.sub(r'member: any,', 'member: import("discord.js").GuildMember,', content)
content = re.sub(r'\(member: any\)', '(member: import("discord.js").GuildMember)', content)

content = re.sub(r'guild: any,', 'guild: import("discord.js").Guild,', content)
content = re.sub(r'\(guild: any\)', '(guild: import("discord.js").Guild)', content)

content = re.sub(r'user: any,', 'user: import("discord.js").User,', content)
content = re.sub(r'\(user: any\)', '(user: import("discord.js").User)', content)

content = re.sub(r'userId: any,', 'userId: string,', content)
content = re.sub(r'\(userId: any\)', '(userId: string)', content)

content = re.sub(r'channelId: any,', 'channelId: string,', content)
content = re.sub(r'\(channelId: any\)', '(channelId: string)', content)

content = re.sub(r'guildId: any,', 'guildId: string,', content)
content = re.sub(r'\(guildId: any\)', '(guildId: string)', content)

content = re.sub(r'userIds: any,', 'userIds: string[],', content)

content = re.sub(r'options: Record<string, any> = \{\}', 'options: Record<string, unknown> = {}', content)

content = re.sub(r'options: any', 'options: Record<string, unknown>', content)

# Fix map parameters
content = re.sub(r'\(emoji: any\)', '(emoji: import("discord.js").GuildEmoji)', content)
content = re.sub(r'\(r: any\)', '(r: import("discord.js").MessageReaction)', content)
content = re.sub(r'\(attachment: any\)', '(attachment: import("discord.js").Attachment)', content)
content = re.sub(r'\(document: any\)', '(document: { id: string })', content)

content = re.sub(r'let guildsCollection: any;', 'let guildsCollection: import("discord.js").Collection<string, import("discord.js").Guild>;', content)
content = re.sub(r'let returnedFirstMessage: any;', 'let returnedFirstMessage: import("discord.js").Message | undefined;', content)

# Remove all other simple ": any" with ": unknown" to satisfy strict TS without 'any'
# But we can't do it blindly. Let's just fix the remaining common ones.
content = re.sub(r': any\[\]', ': unknown[]', content)
content = re.sub(r': any', ': unknown', content)

# Now fix the TS errors caused by changing `any` to `unknown`
content = content.replace('const messageArray: unknown[] = Array.from(allMessages.values());', 'const messageArray: import("discord.js").Message[] = Array.from(allMessages.values());')
content = content.replace('const messagesArray: unknown[] = messages ? Array.from(messages.values()) : [];', 'const messagesArray: import("discord.js").Message[] = messages ? Array.from(messages.values()) : [];')
content = content.replace('const channelPromises: unknown[] = [];', 'const channelPromises: Promise<unknown>[] = [];')
content = content.replace('const files: unknown[] = [];', 'const files: import("discord.js").AttachmentPayload[] = [];')
content = content.replace('const channelStats: unknown[] = [];', 'const channelStats: unknown[] = [];')

# Custom patches
content = content.replace('channel.messages.fetch', '(channel as import("discord.js").TextChannel).messages.fetch')
content = content.replace('message.channel.send(', '(message.channel as import("discord.js").TextChannel).send(')

# ZonedDateTime error
content = content.replace('TemporalHelpers.fromMillis(stat.lastMessageDate)', 'TemporalHelpers.fromMillis(Number(stat.lastMessageDate))')

# Event emitters
content = content.replace('oldMessage: unknown, newMessage: unknown', 'oldMessage: import("discord.js").Message | import("discord.js").PartialMessage, newMessage: import("discord.js").Message | import("discord.js").PartialMessage')
content = content.replace('reaction: unknown, user: import("discord.js").User', 'reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction, user: import("discord.js").User')
content = content.replace('oldMember: unknown, newMember: import("discord.js").GuildMember', 'oldMember: import("discord.js").GuildMember | import("discord.js").PartialGuildMember, newMember: import("discord.js").GuildMember')

# Fix client.user
content = content.replace('client.user.id', 'client.user?.id')
content = content.replace('client.user.setActivity', 'client.user?.setActivity')
content = content.replace('client.user.setStatus', 'if (client.user) client.user.setStatus')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
