const fs = require('fs');

let content = fs.readFileSync('src/services/DiscordUtilityService.ts', 'utf8');

// 1
content = content.replace(
  `    for (
      let i = 0;
      i < generatedTextResponse.length;
      i += messageChunkSizeLimit
    ) {`,
  `    const textResponse = generatedTextResponse || "";
    for (
      let i = 0;
      i < textResponse.length;
      i += messageChunkSizeLimit
    ) {`
);

content = content.replace(/generatedTextResponse\.substring/g, 'textResponse.substring');
content = content.replace(/generatedTextResponse\.length/g, 'textResponse.length');

// 2
content = content.replace(
  `const files: string[] = [];`,
  `const files: any[] = [];`
);

content = content.replace(
  `messageReplyOptions = { ...messageReplyOptions, files: files } as Record<string, unknown>;`,
  `const finalOptions = { ...messageReplyOptions, files: files } as any;`
);

content = content.replace(
  `const sentMessage = await message.channel.send(messageReplyOptions);`,
  `const sentMessage = await (message.channel as TextChannel).send(finalOptions);`
);

content = content.replace(
  `const repliedMessage = await message.reply(messageReplyOptions);`,
  `const repliedMessage = await message.reply(finalOptions);`
);

content = content.replace(
  `return await message.channel.send({ files });`,
  `return await (message.channel as TextChannel).send({ files } as any);`
);

content = content.replace(
  `return await message.reply({ files });`,
  `return await message.reply({ files } as any);`
);

// 3
content = content.replace(
  `const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY);`,
  `const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);\n    if (!guild) { console.error("Guild not found"); return; }`
);

// 4
content = content.replace(
  `channel.parent.name`,
  `channel.parent?.name || "No Category"`
);
content = content.replace(
  `channel.parent ? channel.parent.name : "No Category"`,
  `channel.parent?.name || "No Category"`
);

// 5
content = content.replace(
  `lastMessageId ? lastMessageId : undefined,`,
  `lastMessageId ? String(lastMessageId) : undefined,`
);

// 6
content = content.replace(
  `const messagesArray: Record<string, unknown>[] = messages ? Array.from(messages.values()) : [];`,
  `const messagesArray: Record<string, unknown>[] = messages ? Array.from(messages.values()) as Record<string, unknown>[] : [];`
);

// 7
content = content.replace(
  `TemporalHelpers.fromMillis(
            oldestMessage.createdTimestamp,
          );`,
  `TemporalHelpers.fromMillis(
            Number(oldestMessage.createdTimestamp),
          );`
);
content = content.replace(
  `TemporalHelpers.fromMillis(
            newestMessage.createdTimestamp,
          );`,
  `TemporalHelpers.fromMillis(
            Number(newestMessage.createdTimestamp),
          );`
);
content = content.replace(
  `TemporalHelpers.fromMillis(message.createdTimestamp)`,
  `TemporalHelpers.fromMillis(Number(message.createdTimestamp))`
);
content = content.replace(
  `TemporalHelpers.fromMillis(
            oldestRecentMessage.createdTimestamp,
          );`,
  `TemporalHelpers.fromMillis(
            Number(oldestRecentMessage.createdTimestamp),
          );`
);

// 8
content = content.replace(
  `const userId = message.author.id;
          const username = message.author.username;`,
  `const author = message.author as Record<string, unknown>;
          const userId = String(author.id);
          const username = String(author.username);`
);

// 9
content = content.replace(
  `const userMessageCount: Record<string, unknown> = {};`,
  `const userMessageCount: Record<string, { username: string; count: number }> = {};`
);
content = content.replace(
  `const localUserStats: Record<string, unknown> = {}; // Collect locally first to avoid race conditions`,
  `const localUserStats: Record<string, { username: string; totalMessages: number; channels: Set<string> }> = {};`
);
content = content.replace(
  `const globalUserStats: Record<string, unknown> = {};`,
  `const globalUserStats: Record<string, { username: string; totalMessages: number; channels: Set<string> }> = {};`
);

// 10
content = content.replace(
  `const channelStats: Record<string, unknown>[] = [];`,
  `const channelStats: any[] = [];`
);
content = content.replace(
  `const results: Record<string, unknown>[] = [];`,
  `const results: any[] = [];`
);

// 11
content = content.replace(
  `Object.entries(result.localUserStats) as [string, any][]`,
  `Object.entries(result.localUserStats as Record<string, any>)`
);

// 12
content = content.replace(
  `topTenUsers.forEach((user: { username: string; totalMessages: number }, index: number) => {`,
  `topTenUsers.forEach((user: { username: string; totalMessages: number; channelCount: number }, index: number) => {`
);

// 13
content = content.replace(
  `channel \${channel.name}`,
  `channel \${'name' in channel ? channel.name : channel.id}`
);
content = content.replace(
  `Channel: \${channel.name}`,
  `Channel: \${'name' in channel ? channel.name : channel.id}`
);

// 14
content = content.replace(
  `!member.roles.cache.some((role: Role) => role.id === roleId)`,
  `role && !member.roles.cache.some((r: Role) => r.id === roleId)`
);
content = content.replace(
  `member.roles.cache.some((role: Role) => role.id === roleId)`,
  `role && member.roles.cache.some((r: Role) => r.id === roleId)`
);

content = content.replace(
  `console.log(...LogFormatter.roleAdded(member, role));`,
  `console.log(...LogFormatter.roleAdded(member, role as Role));`
);
content = content.replace(
  `console.error(
        ...LogFormatter.roleFailedToAdd(member.user.id, role, (error as Error).message),
      );`,
  `console.error(
        ...LogFormatter.roleFailedToAdd(member.user.id, role as Role, (error as Error).message),
      );`
);
content = content.replace(
  `console.log(...LogFormatter.roleRemoved(member, role));`,
  `console.log(...LogFormatter.roleRemoved(member, role as Role));`
);
content = content.replace(
  `console.error(
        ...LogFormatter.roleFailedToRemove(member.user.id, role, (error as Error).message),
      );`,
  `console.error(
        ...LogFormatter.roleFailedToRemove(member.user.id, role as Role, (error as Error).message),
      );`
);

// 15
content = content.replace(
  `await client.user.setStatus(status);`,
  `if (client.user) await client.user.setStatus(status);`
);

// 16 - topUsers mapping fix
content = content.replace(
  `.map(([_userId, data]: [string, { count: number }]) => ({
        username: data.username,
        totalMessages: data.totalMessages,
        channelCount: data.channels.size,
      }));`,
  `.map(([_userId, data]: [string, any]) => ({
        username: data.username,
        totalMessages: data.totalMessages,
        channelCount: data.channels.size,
      }));`
);


fs.writeFileSync('src/services/DiscordUtilityService.ts', content);
