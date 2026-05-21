import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def fix_line(num, old, new):
    idx = num - 1
    if old in lines[idx]:
        lines[idx] = lines[idx].replace(old, new)
    else:
        print(f"Failed to match line {num}: {old} in {lines[idx]}")

# 1905
fix_line(1905, 'const messageArray: unknown[] = Array.from(allMessages.values());', 'const messageArray: import("discord.js").Message[] = Array.from(allMessages.values());')
# 1926
fix_line(1926, 'const transformTextChannel = (channel: import("discord.js").Channel | null | undefined, _concise: boolean = false) => {', 'const transformTextChannel = (channel: import("discord.js").TextChannel | null | undefined, _concise: boolean = false) => {')
# 1939
fix_line(1939, 'name: client.user.username,', 'name: client.user?.username,')
# 1942
fix_line(1942, 'client.user.setActivity(', 'client.user?.setActivity(')
# 1949
fix_line(1949, 'return channel ? channel.name : "Unknown Channel";', 'return channel ? (channel as import("discord.js").TextChannel).name : "Unknown Channel";')
# 1964
fix_line(1964, 'const authorName = item.author', 'const authorName = (item as import("discord.js").Message).author')
# 1965
fix_line(1965, 'if (authorName) return item.author.displayName || item.author.username || item.author.globalName;', 'if (authorName) return (item as any).author.displayName || (item as any).author.username || (item as any).author.globalName;')
# 1966
fix_line(1966, 'const userName = item.user', 'const userName = (item as import("discord.js").GuildMember).user')
# 1967
fix_line(1967, 'if (userName) return item.user.displayName || item.user.globalName || item.user.username;', 'if (userName) return (item as any).user.displayName || (item as any).user.globalName || (item as any).user.username;')
# 2046
fix_line(2046, 'const sentMessage = await message.channel.send(messageReplyOptions);', 'const sentMessage = await (message.channel as import("discord.js").TextChannel).send(messageReplyOptions);')
# 2054
fix_line(2054, 'const textResponse = generatedTextResponse || "";', 'const textResponse = generatedTextResponse || "";')
fix_line(2054, 'for (let i = 0; i < generatedTextResponse.length; i += messageChunkSizeLimit) {', 'const textResponse = generatedTextResponse || "";\n    for (let i = 0; i < textResponse.length; i += messageChunkSizeLimit) {')
# 2057
fix_line(2057, 'generatedTextResponse.substring(i, i + messageChunkSizeLimit);', 'textResponse.substring(i, i + messageChunkSizeLimit);')
# 2067
fix_line(2067, 'return await (message.channel as import("discord.js").TextChannel).send(generatedTextResponse);', 'return await (message.channel as import("discord.js").TextChannel).send(textResponse);')
# 2081
fix_line(2081, 'return await message.channel.send({ files });', 'return await (message.channel as import("discord.js").TextChannel).send({ files } as any);')
# 2082
fix_line(2082, 'return returnedFirstMessage;', 'return returnedFirstMessage as any;')
# 2109
fix_line(2109, 'const guildId = config.GUILD_ID_PRIMARY;', 'const guildId = config.GUILD_ID_PRIMARY as string;')
# 2111
fix_line(2111, 'const guild = client.guilds.cache.get(guildId);', 'const guild = client.guilds.cache.get(guildId);\n    if(!guild) return;')
# 2154
fix_line(2154, 'const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);', 'const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);\n    if(!guild) return;')
# 2175
fix_line(2175, 'categoryName: channel.parent ? channel.parent.name : "No Category",', 'categoryName: channel.parent ? channel.parent.name : "No Category",')
# 2205
fix_line(2205, 'const messagesArray: unknown[] = messages ? Array.from(messages.values()) : [];', 'const messagesArray: import("discord.js").Message[] = messages ? Array.from(messages.values()) as import("discord.js").Message[] : [];')
# 2291
fix_line(2291, 'await new Promise((resolve: unknown) => setTimeout(resolve, 100));', 'await new Promise((resolve: Record<string, unknown>) => setTimeout(resolve, 100));')
# 2340
fix_line(2340, '.sort((a: unknown, b: unknown) => b[1].count - a[1].count)', '.sort((a: Record<string, unknown>, b: Record<string, unknown>) => b[1].count - a[1].count)')
# 2342
fix_line(2342, '.map(([_userId, data]: unknown) => ({', '.map(([_userId, data]: Record<string, unknown>) => ({')
# 2349
fix_line(2349, 'sortedUsers.forEach((user: User, index: number) => {', 'sortedUsers.forEach((user: Record<string, unknown>, index: number) => {')
# 2448
fix_line(2448, 'if (result && result.channelStat) {', 'if (result && (result as any).channelStat) {')
# 2451
fix_line(2451, 'if (result && result.localUserStats) {', 'if (result && (result as any).localUserStats) {')
# 2470
fix_line(2470, '(a: unknown, b: unknown) => b.averageMessagesPerDay - a.averageMessagesPerDay,', '(a: Record<string, unknown>, b: Record<string, unknown>) => b.averageMessagesPerDay - a.averageMessagesPerDay,')
# 2485
fix_line(2485, 'channelStats.forEach((stat: unknown, index: number) => {', 'channelStats.forEach((stat: Record<string, unknown>, index: number) => {')
# 2530
fix_line(2530, '.sort((a: unknown, b: unknown) => b[1].totalMessages - a[1].totalMessages)', '.sort((a: Record<string, unknown>, b: Record<string, unknown>) => b[1].totalMessages - a[1].totalMessages)')
# 2532
fix_line(2532, '.map(([_userId, data]: unknown) => ({', '.map(([_userId, data]: Record<string, unknown>) => ({')
# 2547
fix_line(2547, 'channel: result.channel, averageMessagesPerDay: result.averageMessagesPerDay', 'channel: (result as any).channel, averageMessagesPerDay: (result as any).averageMessagesPerDay')
# 2573
fix_line(2573, 'topTenUsers.forEach((user: User, index: number) => {', 'topTenUsers.forEach((user: Record<string, unknown>, index: number) => {')
# 2619
fix_line(2619, 'return `${channel.name} (${channel.id})`;', 'return `${(channel as import("discord.js").TextChannel).name} (${channel.id})`;')
# 2633
fix_line(2633, 'return `${channel.name} (${channel.id})`;', 'return `${(channel as import("discord.js").TextChannel).name} (${channel.id})`;')
# 2653
fix_line(2653, 'const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);', 'const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);\n    if(!role) return;')
# 2671
fix_line(2671, 'const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);', 'const role = guild.roles.cache.find((role: import("discord.js").Role) => role.id === roleId);\n    if(!role) return;')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
