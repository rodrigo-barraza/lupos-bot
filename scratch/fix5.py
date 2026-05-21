import re

def fix():
    with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Duplicate Events
    content = content.replace('Collection, ChannelType, Events, ActivityType', 'Collection, ChannelType, ActivityType')
    
    # 2. client.channels.cache.find -> cast channel as TextChannel
    content = content.replace(
        '(channel: GuildChannel) => channel.id === channelId',
        '(channel: import("discord.js").Channel) => channel.id === channelId'
    )
    content = content.replace('if (channel) {', 'if (channel && channel.isTextBased()) {')
    
    # 3. transformUserPrimaryGuild -> param to Record<string, unknown> | null | undefined
    content = content.replace(
        'const transformUserPrimaryGuild = (userPrimaryGuild: Record<string, unknown> | null | undefined) => ({',
        'const transformUserPrimaryGuild = (userPrimaryGuild: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {\n  if (!userPrimaryGuild) return null;\n  return {'
    )
    content = content.replace(
        '  tag: userPrimaryGuild?.tag,\n});',
        '  tag: userPrimaryGuild.tag,\n  };\n};'
    )
    
    # 4. transformRole issues (deletable, guildId, mention, url don't exist on Role in this version?)
    content = content.replace('deletable: role.deletable,                     // boolean', '')
    content = content.replace('guildId: role.guildId,                         // Snowflake', '')
    content = content.replace('mention: role.mention,                         // string', '')
    content = content.replace('url: role.url,                                 // string', '')
    content = content.replace('const transformRole = (role: Role | null | undefined) => ({', 'const transformRole = (role: Role | null | undefined) => {\n  if (!role) return null;\n  return {')
    content = content.replace('hexColor: role.hexColor,                       // string\n  iconURL: role.iconURL(),                       // string\n});', 'hexColor: role.hexColor,                       // string\n  iconURL: role.iconURL(),                       // string\n  };\n};')
    
    # 5. transformTextChannel issues (TextChannel vs GuildChannel)
    content = content.replace('const transformTextChannel = (channel: TextChannel | GuildChannel | null | undefined, _concise: boolean = false) => {', 'const transformTextChannel = (channel: import("discord.js").Channel | null | undefined, _concise: boolean = false) => {')
    content = content.replace('if (channel) {', 'if (channel && channel.isTextBased() && !channel.isDMBased()) {\n    const textChannel = channel as TextChannel;')
    # replace all `channel.` with `textChannel.` inside transformTextChannel
    # Actually, we can just let `textChannel` replace `channel` in that block.
    # We will use regex to replace `channel\.` to `textChannel.` between `const textChannel = {` and `return textChannel;`
    # Let's do it simply by replacing `channel.` with `textChannel.` in lines 162-194.
    content = re.sub(r'(createdAt|createdTimestamp|defaultAutoArchiveDuration|defaultThreadRateLimitPerUser|deletable|flags|guild|guildId|id|lastMessageId|lastPinAt|lastPinTimestamp|manageable|name|nsfw|parentId|parent|partial|permissionsLocked|position|rateLimitPerUser|rawPosition|topic|type|url|viewable): channel\.', r'\1: textChannel.', content)
    
    # 6. spread objects
    content = content.replace('...(guild.icon && { icon: guild.icon }),', '...(guild.icon ? { icon: guild.icon } : {}),')
    content = content.replace('...(guild.banner && { banner: guild.banner }),', '...(guild.banner ? { banner: guild.banner } : {}),')
    content = content.replace('...(guild.splash && { splash: guild.splash }),', '...(guild.splash ? { splash: guild.splash } : {}),')
    content = content.replace('...(role.colors && {', '...((role as import("discord.js").Role & { colors?: any }).colors ? {')
    content = content.replace('primaryColor: role.colors.primaryColor,', 'primaryColor: (role as import("discord.js").Role & { colors?: any }).colors.primaryColor,')
    content = content.replace('secondaryColor: role.colors.secondaryColor ?? null,', 'secondaryColor: (role as import("discord.js").Role & { colors?: any }).colors.secondaryColor ?? null,')
    content = content.replace('tertiaryColor: role.colors.tertiaryColor ?? null,', 'tertiaryColor: (role as import("discord.js").Role & { colors?: any }).colors.tertiaryColor ?? null,')
    
    content = content.replace('...(roleColorsData && { roleColors: roleColorsData }),', '...(roleColorsData ? { roleColors: roleColorsData } : {}),')
    
    # 7. transformPoll answers
    content = content.replace('answers: poll.answers.map((answer: Record<string, unknown>) => ({', 'answers: (poll.answers as any[]).map((answer: Record<string, unknown>) => ({')
    content = content.replace('emoji: transformEmoji(answer.emoji, true),', 'emoji: transformEmoji(answer.emoji as GuildEmoji, true),')

    # 8. transformMessageMentions
    content = content.replace('channels: mentions.channels.size', 'channels: (mentions.channels as import("discord.js").Collection<string, import("discord.js").Channel>).size')
    content = content.replace('? mentions.channels.map((channel: GuildChannel | string) =>', '? (mentions.channels as import("discord.js").Collection<string, import("discord.js").Channel>).map((channel: import("discord.js").Channel) =>')

    # 9. transformEmbeds
    content = content.replace('author: transformUser(embed.author, true),', 'author: transformUser(embed.author as User, true),')
    
    # 10. transformGuild param
    content = content.replace('transformGuild(channel.guild, true)', 'transformGuild(textChannel.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(mentions.guild, true)', 'transformGuild(mentions.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(member.guild, true)', 'transformGuild(member.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(presence.guild, true)', 'transformGuild(presence.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(voice.guild, true)', 'transformGuild(voice.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(sticker.guild, true)', 'transformGuild(sticker.guild as unknown as Record<string, unknown>, true)')
    content = content.replace('transformGuild(message.guild, true)', 'transformGuild(message.guild as unknown as Record<string, unknown>, true)')

    # 11. message.author
    content = content.replace('author: transformUser(message.author),', 'author: transformUser(message.author as User),')
    
    # 12. member.user
    content = content.replace('user: transformUser(member.user, true),', 'user: transformUser(member.user as User, true),')
    
    # 13. sticker user
    content = content.replace('user: transformUser(sticker.user, true),', 'user: transformUser(sticker.user as User, true),')

    # 14. reaction user
    content = content.replace('users: reaction.users.cache.map((user: User) => transformUser(user, true)),', 'users: reaction.users.cache.map((user: User) => transformUser(user, true)),')
    
    # 15. get messages from fetch (limit error)
    content = content.replace('await DiscordUtilityService.fetchMessages(client, channel.id, {\n          limit: 100,\n        })', 'await (channel as TextChannel).messages.fetch({ limit: 100 })')

    with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
        f.write(content)

fix()
