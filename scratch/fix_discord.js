const fs = require('fs');

let fileContent = fs.readFileSync('src/services/DiscordUtilityService.ts', 'utf8');

// 1. Fix sendMessageInChunks
fileContent = fileContent.replace(
  /for \(\s*let i = 0;\s*i < generatedTextResponse\.length;\s*i \+= messageChunkSizeLimit\s*\) {/g,
  `const textResponse = generatedTextResponse || "";
    for (
      let i = 0;
      i < textResponse.length;
      i += messageChunkSizeLimit
    ) {`
);

fileContent = fileContent.replace(
  /generatedTextResponse\.substring/g,
  `textResponse.substring`
);

fileContent = fileContent.replace(
  /generatedTextResponse\.length/g,
  `textResponse.length`
);

fileContent = fileContent.replace(
  /const files: string\[\] = \[\];/g,
  `const files: any[] = [];`
);

fileContent = fileContent.replace(
  /messageReplyOptions = { \.\.\.messageReplyOptions, files: files } as Record<string, unknown>;\s*if \(sendOrReply === "send"\) {\s*const sentMessage = await message\.channel\.send\(messageReplyOptions\);/g,
  `const finalOptions = { ...messageReplyOptions, files: files } as any;
      if (sendOrReply === "send") {
        const sentMessage = await (message.channel as TextChannel).send(finalOptions);`
);

fileContent = fileContent.replace(
  /const repliedMessage = await message\.reply\(messageReplyOptions\);/g,
  `const repliedMessage = await message.reply(finalOptions);`
);

fileContent = fileContent.replace(
  /if \(sendOrReply === "send"\) {\s*return await message\.channel\.send\({ files }\);\s*} else {\s*return await message\.reply\({ files }\);\s*}/g,
  `if (sendOrReply === "send") {
        return await (message.channel as TextChannel).send({ files } as any);
      } else {
        return await message.reply({ files } as any);
      }`
);

// 2. Fix guild and channel.parent
fileContent = fileContent.replace(
  /const guild = client\.guilds\.cache\.get\(config\.GUILD_ID_PRIMARY\);/g,
  `const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);\n    if (!guild) { console.error("[ERROR] Guild not found"); return; }`
);

fileContent = fileContent.replace(
  /\(Category: \$\{channel\.parent\.name\}\)/g,
  `(Category: \${channel.parent?.name || "No Category"})`
);

fileContent = fileContent.replace(
  /channel\.parent \? channel\.parent\.name : "No Category"/g,
  `channel.parent?.name || "No Category"`
);

// 3. Fix lastMessageId and messagesArray
fileContent = fileContent.replace(
  /lastMessageId \? lastMessageId : undefined/g,
  `lastMessageId ? String(lastMessageId) : undefined`
);

fileContent = fileContent.replace(
  /const messagesArray: Record<string, unknown>\[\] = messages \? Array\.from\(messages\.values\(\)\) : \[\];/g,
  `const messagesArray: Record<string, unknown>[] = messages ? Array.from(messages.values()) as Record<string, unknown>[] : [];`
);


// 4. Fix TemporalHelpers.fromMillis
fileContent = fileContent.replace(
  /TemporalHelpers\.fromMillis\(\s*oldestMessage\.createdTimestamp,\s*\)/g,
  `TemporalHelpers.fromMillis(Number(oldestMessage.createdTimestamp))`
);

fileContent = fileContent.replace(
  /TemporalHelpers\.fromMillis\(\s*newestMessage\.createdTimestamp,\s*\)/g,
  `TemporalHelpers.fromMillis(Number(newestMessage.createdTimestamp))`
);

fileContent = fileContent.replace(
  /TemporalHelpers\.fromMillis\(message\.createdTimestamp\)/g,
  `TemporalHelpers.fromMillis(Number(message.createdTimestamp))`
);

fileContent = fileContent.replace(
  /TemporalHelpers\.fromMillis\(\s*oldestRecentMessage\.createdTimestamp,\s*\)/g,
  `TemporalHelpers.fromMillis(Number(oldestRecentMessage.createdTimestamp))`
);

// 5. Fix message.author and user stats types
fileContent = fileContent.replace(
  /const userId = message\.author\.id;\s*const username = message\.author\.username;/g,
  `const author = message.author as Record<string, unknown>;\n          const userId = String(author.id);\n          const username = String(author.username);`
);

fileContent = fileContent.replace(
  /const userMessageCount: Record<string, unknown> = {};/g,
  `const userMessageCount: Record<string, { username: string; count: number }> = {};`
);

fileContent = fileContent.replace(
  /const localUserStats: Record<string, unknown> = {}; \/\/ Collect locally first to avoid race conditions/g,
  `const localUserStats: Record<string, { username: string; totalMessages: number; channels: Set<string> }> = {}; // Collect locally first to avoid race conditions`
);

fileContent = fileContent.replace(
  /const globalUserStats: Record<string, unknown> = {};/g,
  `const globalUserStats: Record<string, { username: string; totalMessages: number; channels: Set<string> }> = {};`
);

fileContent = fileContent.replace(
  /const channelStats: Record<string, unknown>\[\] = \[\];/g,
  `const channelStats: any[] = [];`
);

fileContent = fileContent.replace(
  /const results: Record<string, unknown>\[\] = \[\];/g,
  `const results: any[] = [];`
);

fileContent = fileContent.replace(
  /Object\.entries\(result\.localUserStats\) as \[string, any\]\[\]/g,
  `Object.entries(result.localUserStats)`
);

// 6. Fix topTenUsers type
fileContent = fileContent.replace(
  /topTenUsers\.forEach\(\(user: \{ username: string; totalMessages: number \}, index: number\) => \{/g,
  `topTenUsers.forEach((user: { username: string; totalMessages: number; channelCount: number }, index: number) => {`
);

// 7. Fix channel.name
fileContent = fileContent.replace(
  /channel \$\{channel\.name\}/g,
  `channel \${'name' in channel ? channel.name : channel.id}`
);

fileContent = fileContent.replace(
  /Channel: \$\{channel\.name\}/g,
  `Channel: \${'name' in channel ? channel.name : channel.id}`
);


// 8. Fix role adding
fileContent = fileContent.replace(
  /if \(\s*!member\.user\.bot &&\s*!member\.roles\.cache\.some\(\(role: Role\) => role\.id === roleId\)\s*\) \{/g,
  `if (\n        !member.user.bot && role &&\n        !member.roles.cache.some((r: Role) => r.id === roleId)\n      ) {`
);

fileContent = fileContent.replace(
  /if \(\s*!member\.user\.bot &&\s*member\.roles\.cache\.some\(\(role: Role\) => role\.id === roleId\)\s*\) \{/g,
  `if (\n        !member.user.bot && role &&\n        member.roles.cache.some((r: Role) => r.id === roleId)\n      ) {`
);

fileContent = fileContent.replace(
  /console\.log\(\.\.\.LogFormatter\.roleAdded\(member, role\)\);/g,
  `console.log(...LogFormatter.roleAdded(member, role as Role));`
);

fileContent = fileContent.replace(
  /console\.error\(\s*\.\.\.LogFormatter\.roleFailedToAdd\(member\.user\.id, role, \(error as Error\)\.message\),\s*\);/g,
  `console.error(\n        ...LogFormatter.roleFailedToAdd(member.user.id, role as Role, (error as Error).message),\n      );`
);

fileContent = fileContent.replace(
  /console\.log\(\.\.\.LogFormatter\.roleRemoved\(member, role\)\);/g,
  `console.log(...LogFormatter.roleRemoved(member, role as Role));`
);

fileContent = fileContent.replace(
  /console\.error\(\s*\.\.\.LogFormatter\.roleFailedToRemove\(member\.user\.id, role, \(error as Error\)\.message\),\s*\);/g,
  `console.error(\n        ...LogFormatter.roleFailedToRemove(member.user.id, role as Role, (error as Error).message),\n      );`
);

// 9. Fix client.user.setStatus
fileContent = fileContent.replace(
  /await client\.user\.setStatus\(status\);/g,
  `if (client.user) await client.user.setStatus(status);`
);

// 10. Fix array map in top users
fileContent = fileContent.replace(
  /\(\[_userId, data\]: \[string, \{ count: number \}\]\)/g,
  `([_userId, data]: [string, any])`
);


fs.writeFileSync('src/services/DiscordUtilityService.ts', fileContent);
console.log("Done.");
