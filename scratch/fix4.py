import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Duplicate Events import
content = content.replace(', Events, ActivityType } from "discord.js";', ', ActivityType } from "discord.js";')
content = content.replace(', Events } from "discord.js";', ' } from "discord.js";')

# 2. transformRole
content = content.replace('const transformRole = (role: Role | null | undefined) => ({', 'const transformRole = (role: Role | null | undefined) => { if(!role) return null; return {')
content = content.replace('  url: role.url,                                 // string\n});', '  url: (role as any).url,                                 // string\n}; };')
content = content.replace('colors: {\n      primaryColor: role.colors.primaryColor,\n      secondaryColor: role.colors.secondaryColor ?? null,\n      tertiaryColor: role.colors.tertiaryColor ?? null,\n    },', 'colors: {\n      primaryColor: (role as any).colors?.primaryColor,\n      secondaryColor: (role as any).colors?.secondaryColor ?? null,\n      tertiaryColor: (role as any).colors?.tertiaryColor ?? null,\n    },')

content = content.replace('hexColor: role.hexColor,                       // string', 'hexColor: role.hexColor,                       // string')

# 3. transformTextChannel
content = content.replace('const transformTextChannel = (channel: TextChannel | GuildChannel | null | undefined, _concise: boolean = false) => {', 'const transformTextChannel = (channel: TextChannel | GuildChannel | null | undefined, _concise: boolean = false) => { if(!channel) return null; const txtChannel = channel as TextChannel; ')
content = content.replace('defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration', 'defaultAutoArchiveDuration: txtChannel.defaultAutoArchiveDuration')
content = content.replace('defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser', 'defaultThreadRateLimitPerUser: txtChannel.defaultThreadRateLimitPerUser')
content = content.replace('lastMessageId: channel.lastMessageId', 'lastMessageId: txtChannel.lastMessageId')
content = content.replace('lastPinAt: channel.lastPinAt', 'lastPinAt: txtChannel.lastPinAt')
content = content.replace('lastPinTimestamp: channel.lastPinTimestamp', 'lastPinTimestamp: txtChannel.lastPinTimestamp')
content = content.replace('nsfw: channel.nsfw', 'nsfw: txtChannel.nsfw')
content = content.replace('rateLimitPerUser: channel.rateLimitPerUser', 'rateLimitPerUser: txtChannel.rateLimitPerUser')
content = content.replace('topic: channel.topic', 'topic: txtChannel.topic')
content = content.replace('guild: transformGuild(channel.guild, true), // Guild', 'guild: transformGuild(channel.guild as Record<string, unknown>, true), // Guild')

# 4. Spread types
content = content.replace('...(guild.icon && { icon: guild.icon }),', '...(guild.icon ? { icon: guild.icon } : {}),')
content = content.replace('...(guild.banner && { banner: guild.banner }),', '...(guild.banner ? { banner: guild.banner } : {}),')
content = content.replace('...(guild.splash && { splash: guild.splash }),', '...(guild.splash ? { splash: guild.splash } : {}),')
content = content.replace('...(role.colors && {', '...((role as any).colors ? {')

# 5. transformPoll
content = content.replace('answers: poll.answers.map((answer: Record<string, unknown>) => ({', 'answers: (poll.answers as any[]).map((answer: Record<string, unknown>) => ({')
content = content.replace('emoji: transformEmoji(answer.emoji, true),', 'emoji: transformEmoji(answer.emoji as GuildEmoji, true),')

# 6. transformMessageMentions
content = content.replace('channels: mentions.channels.size', 'channels: (mentions.channels as any).size')
content = content.replace('? mentions.channels.map((channel: GuildChannel | string) =>', '? (mentions.channels as any).map((channel: GuildChannel | string) =>')
content = content.replace('guild: transformGuild(mentions.guild, true),', 'guild: transformGuild(mentions.guild as Record<string, unknown>, true),')

# 7. channels find
content = content.replace('const channel = client.channels.cache.find(\n    (channel: GuildChannel) => channel.id === channelId,\n  );', 'const channel = client.channels.cache.find(\n    (channel: any) => channel.id === channelId,\n  ) as TextChannel;')

# 8. embeds
content = content.replace('author: transformUser(embed.author, true),', 'author: transformUser(embed.author as User, true),')

# 9. role deletable / guildId / mention
content = content.replace('deletable: role.deletable', 'deletable: (role as any).deletable')
content = content.replace('guildId: role.guildId', 'guildId: (role as any).guildId')
content = content.replace('mention: role.mention', 'mention: (role as any).mention')
content = content.replace('url: role.url', 'url: (role as any).url')

# 10. message missing user
content = content.replace('user: transformUser(sticker.user, true),', 'user: transformUser(sticker.user as User, true),')

# 11. Reaction
content = content.replace('users: reaction.users.cache.map((user: User) => transformUser(user, true)),', 'users: reaction.users.cache.map((user: User) => transformUser(user, true)),')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
