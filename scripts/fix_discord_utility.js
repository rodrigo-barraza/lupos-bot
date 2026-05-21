import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/DiscordUtilityService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Imports
if (!content.includes('import type { Message, GuildMember, User, Role, TextChannel, GuildChannel, Collection as DiscordCollection, Activity, Presence, VoiceState, MessageReaction, PartialMessageReaction, PartialUser, GuildEmoji, Interaction, ChatInputCommandInteraction } from "discord.js";')) {
  content = content.replace(
    'import {',
    'import type { Message, GuildMember, User, Role, TextChannel, GuildChannel, Collection as DiscordCollection, Activity, Presence, VoiceState, MessageReaction, PartialMessageReaction, PartialUser, GuildEmoji, Interaction, ChatInputCommandInteraction } from "discord.js";\nimport {'
  );
}

// Global replaces
content = content.replace(/Record<string, any>/g, 'Record<string, unknown>');
content = content.replace(/\(error as any\)\.stack/g, '(error as Error).stack');
content = content.replace(/\(error as any\)\.code/g, '(error as Error & { code?: number }).code');
content = content.replace(/\(error as any\)\.writeErrors/g, '(error as Error & { writeErrors?: unknown[] }).writeErrors');
content = content.replace(/\(error as any\)\.result/g, '(error as Error & { result?: { nUpserted?: number } }).result');
content = content.replace(/\(error as any\)/g, '(error as Error)');
content = content.replace(/let allMessages: any\[\] = \[\];/g, 'let allMessages: Record<string, unknown>[] = [];');
content = content.replace(/const messagesArray: any\[\] =/g, 'const messagesArray: Record<string, unknown>[] =');
content = content.replace(/let guildsCollection: any;/g, 'let guildsCollection: import("mongodb").Collection<import("mongodb").Document> | undefined;');
content = content.replace(/const messageArray: any\[\] =/g, 'const messageArray: Record<string, unknown>[] =');
content = content.replace(/const files: any\[\] = \[\];/g, 'const files: string[] = [];');
content = content.replace(/const channelStats: any\[\] = \[\];/g, 'const channelStats: Record<string, unknown>[] = [];');
content = content.replace(/const eligibleChannels: any\[\] = \[\];/g, 'const eligibleChannels: TextChannel[] = [];');
content = content.replace(/const channelPromises: any\[\] = \[\];/g, 'const channelPromises: Promise<void>[] = [];');
content = content.replace(/const documents: any\[\] = \[\];/g, 'const documents: Record<string, unknown>[] = [];');
content = content.replace(/const queue: any\[\] = \[\];/g, 'const queue: (() => void)[] = [];');
content = content.replace(/const results: any\[\] = \[\];/g, 'const results: Record<string, unknown>[] = [];');

// Specific replaces
const patterns = [
  ['client: any', 'client: any /* Discord.js Client */'],
  ['channelId: any', 'channelId: string'],
  ['maxMessages: any = 10', 'maxMessages: number = 10'],
  ['lastId: any = null', 'lastId: string | null = null'],
  ['(channel: any) => channel.id == channelId', '(channel: GuildChannel) => channel.id === channelId'],
  ['transformUserPrimaryGuild = (userPrimaryGuild: any)', 'transformUserPrimaryGuild = (userPrimaryGuild: Record<string, unknown> | null | undefined)'],
  ['transformUser = (user: any, concise: any = false)', 'transformUser = (user: User | PartialUser | null | undefined, concise: boolean = false)'],
  ['transformRole = (role: any)', 'transformRole = (role: Role | null | undefined)'],
  ['transformAttachment = (attachment: any)', 'transformAttachment = (attachment: Record<string, unknown>)'],
  ['transformTextChannel = (channel: any, _concise: any = false)', 'transformTextChannel = (channel: TextChannel | GuildChannel | null | undefined, _concise: boolean = false)'],
  ['transformEmbeds = (embeds: any)', 'transformEmbeds = (embeds: Record<string, unknown>[])'],
  ['(embed: any) => ({', '(embed: Record<string, unknown>) => ({'],
  ['transformGuild = (guild: any, _concise: any = false)', 'transformGuild = (guild: Record<string, unknown> | null | undefined, _concise: boolean = false)'],
  ['transformPoll = (poll: any)', 'transformPoll = (poll: Record<string, unknown> | null | undefined)'],
  ['(answer: any) => ({', '(answer: Record<string, unknown>) => ({'],
  ['transformMessageMentions = (mentions: any)', 'transformMessageMentions = (mentions: Record<string, unknown> | null | undefined)'],
  ['(channel: any) =>', '(channel: GuildChannel | string) =>'],
  ['(member: any) => transformMember(member, true)', '(member: GuildMember) => transformMember(member, true)'],
  ['(user: any) => transformUser(user, true)', '(user: User) => transformUser(user, true)'],
  ['(role: any) => transformRole(role)', '(role: Role) => transformRole(role)'],
  ['transformMessageSnapshot = (messageSnapshot: any)', 'transformMessageSnapshot = (messageSnapshot: Record<string, unknown>)'],
  ['transformActivity = (activity: any)', 'transformActivity = (activity: Activity)'],
  ['transformPresence = (presence: any)', 'transformPresence = (presence: Presence | null | undefined)'],
  ['(activity: any) =>', '(activity: Activity) =>'],
  ['transformVoice = (voice: any)', 'transformVoice = (voice: VoiceState | null | undefined)'],
  ['transformMember = (member: any, concise: any = false)', 'transformMember = (member: GuildMember | null | undefined, concise: boolean = false)'],
  ['transformEmoji = (emoji: any, _concise: any = false)', 'transformEmoji = (emoji: GuildEmoji | null | undefined, _concise: boolean = false)'],
  ['transformReaction = (reaction: any)', 'transformReaction = (reaction: MessageReaction | PartialMessageReaction | null | undefined)'],
  ['transformSticker = (sticker: any)', 'transformSticker = (sticker: Record<string, unknown> | null | undefined)'],
  ['transformMessageRoot = (message: any)', 'transformMessageRoot = (message: Message | Record<string, unknown>)'],
  ['(attachment: any) =>', '(attachment: Record<string, unknown>) =>'],
  ['(snapshot: any) =>', '(snapshot: Record<string, unknown>) =>'],
  ['(reaction: any) =>', '(reaction: MessageReaction | PartialMessageReaction) =>'],
  ['(sticker: any) => transformSticker(sticker)', '(sticker: Record<string, unknown>) => transformSticker(sticker)'],
  ['client: any, mongo: any, guildId: any, options: Record<string, unknown> = {}', 'client: any /* Client */, mongo: any /* MongoClient */, guildId: string, options: Record<string, unknown> = {}'],
  ['resumePoints.forEach((point: any) =>', 'resumePoints.forEach((point: { channelId: string; lastMessageId: string }) =>'],
  ['(channel: any) => channel.type === ChannelType.GuildText', '(channel: GuildChannel) => channel.type === ChannelType.GuildText'],
  ['(channel: any) => channelIds.includes(channel.id)', '(channel: GuildChannel) => channelIds.includes(channel.id)'],
  ['(channel: any) => channel.parentId && categoryIds.includes(channel.parentId)', '(channel: GuildChannel) => channel.parentId && categoryIds.includes(channel.parentId)'],
  ['textChannels = textChannels.filter((channel: any) =>', 'textChannels = textChannels.filter((channel: GuildChannel) =>'],
  ['(channel: any) => !completedChannelIds.has(channel.id)', '(channel: GuildChannel) => !completedChannelIds.has(channel.id)'],
  ['bulkSaveNewMessages = async (messages: any)', 'bulkSaveNewMessages = async (messages: Record<string, unknown>[])'],
  ['bulkOps = documents.map((document: any) =>', 'bulkOps = documents.map((document: Record<string, unknown>) =>'],
  ['createConcurrencyLimiter = (limit: any)', 'createConcurrencyLimiter = (limit: number)'],
  ['run = async (fn: any)', 'run = async (fn: () => Promise<void>)'],
  ['new Promise((resolve: any)', 'new Promise((resolve: (value: void | PromiseLike<void>) => void)'],
  ['processChannel = async (channel: any)', 'processChannel = async (channel: TextChannel)'],
  ['(document: any) => !discordUserMessageIds.has(document.id)', '(document: Record<string, unknown>) => !discordUserMessageIds.has(document.id as string)'],
  ['(document: any) => document.id', '(document: Record<string, unknown>) => document.id as string'],
  ['messages.filter((message: any) => !allMessages.has(message.id))', 'messages.filter((message: Record<string, unknown>) => !allMessages.has(message.id as string))'],
  ['getOrFetchChannelByChannelId(client: any, channelId: any)', 'getOrFetchChannelByChannelId(client: any /* Client */, channelId: string)'],
  ['getBotName(client: any)', 'getBotName(client: any /* Client */)'],
  ['setUserActivity(client: any, message: any)', 'setUserActivity(client: any /* Client */, message: string)'],
  ['getChannelById(client: any, channelId: any)', 'getChannelById(client: any /* Client */, channelId: string)'],
  ['getChannelName(client: any, channelId: any)', 'getChannelName(client: any /* Client */, channelId: string)'],
  ['getGuildById(client: any, guildId: any)', 'getGuildById(client: any /* Client */, guildId: string)'],
  ['getAllGuilds(client: any)', 'getAllGuilds(client: any /* Client */)'],
  ['getNameFromItem(item: any)', 'getNameFromItem(item: Record<string, unknown> | null | undefined)'],
  ['patchBanner(client: any, imageUrl: any)', 'patchBanner(client: any /* Client */, imageUrl: string)'],
  ['patchBannerFromImageUrl(client: any, imageUrl: any)', 'patchBannerFromImageUrl(client: any /* Client */, imageUrl: string)'],
  ['getBannerFromUserId(client: any, userId: any)', 'getBannerFromUserId(client: any /* Client */, userId: string)'],
  ['startTypingInterval(channel: any)', 'startTypingInterval(channel: TextChannel)'],
  ['.catch((error: any) => {', '.catch((error: Error) => {'],
  ['.catch((_error: any) => {', '.catch((_error: Error) => {'],
  ['clearTypingInterval(sendTypingInterval: any)', 'clearTypingInterval(sendTypingInterval: ReturnType<typeof setInterval>)'],
  ['sendOrReply: any,', 'sendOrReply: "send" | "reply",'],
  ['message: any,', 'message: Message,'],
  ['generatedTextResponse: any,', 'generatedTextResponse: string | null,'],
  ['encodedImageDataBase64: any,', 'encodedImageDataBase64: string | null,'],
  ['imagePrompt: any,', 'imagePrompt: string | null,'],
  ['let returnedFirstMessage: any;', 'let returnedFirstMessage: Message | null = null;'],
  ['= { ...messageReplyOptions, files: files } as any;', '= { ...messageReplyOptions, files: files } as Record<string, unknown>;'],
  ['displayAllChannelActivity(client: any)', 'displayAllChannelActivity(client: any /* Client */)'],
  ['processChannel = async (channel: any, channelIndex: any)', 'processChannel = async (channel: TextChannel, channelIndex: number)'],
  ['!allMessages.some((existingMsg: any) => existingMsg.id === message.id)', '!allMessages.some((existingMsg: Record<string, unknown>) => existingMsg.id === message.id)'],
  ['(message: any) =>', '(message: Record<string, unknown>) =>'],
  ['messagesInPeriod.forEach((message: any) =>', 'messagesInPeriod.forEach((message: Record<string, unknown>) =>'],
  ['.sort((a: any, b: any) => b[1].count - a[1].count)', '.sort((a: [string, { count: number }], b: [string, { count: number }]) => b[1].count - a[1].count)'],
  ['.map(([userId, data]: any) => ({', '.map(([userId, data]: [string, { count: number }]) => ({'],
  ['.map(([_userId, data]: any) => ({', '.map(([_userId, data]: [string, { count: number }]) => ({'],
  ['sortedUsers.forEach((user: any, index: any) =>', 'sortedUsers.forEach((user: { username: string; count: number }, index: number) =>'],
  ['batchPromises = batch.map((channel: any, batchIndex: any) =>', 'batchPromises = batch.map((channel: TextChannel, batchIndex: number) =>'],
  ['(a: any, b: any) => b.averageMessagesPerDay - a.averageMessagesPerDay', '(a: Record<string, unknown>, b: Record<string, unknown>) => (b.averageMessagesPerDay as number) - (a.averageMessagesPerDay as number)'],
  ['channelStats.forEach((stat: any, index: any) =>', 'channelStats.forEach((stat: Record<string, unknown>, index: number) =>'],
  ['.map((user: any, index: any) =>', '.map((user: { username: string; count: number }, index: number) =>'],
  ['(sum: any, stat: any) => sum + stat.messageCount', '(sum: number, stat: Record<string, unknown>) => sum + (stat.messageCount as number)'],
  ['(stat: any) => stat.messageCount > 0', '(stat: Record<string, unknown>) => (stat.messageCount as number) > 0'],
  ['(stat: any) => stat.messageCount === 0', '(stat: Record<string, unknown>) => (stat.messageCount as number) === 0'],
  ['.sort((a: any, b: any) => b[1].totalMessages - a[1].totalMessages)', '.sort((a: [string, { totalMessages: number }], b: [string, { totalMessages: number }]) => b[1].totalMessages - a[1].totalMessages)'],
  ['topTenUsers.forEach((user: any, index: any) =>', 'topTenUsers.forEach((user: { username: string; totalMessages: number }, index: number) =>'],
  ['calculateMessagesSentOnAveragePerDayInChannel(client: any, channelId: any)', 'calculateMessagesSentOnAveragePerDayInChannel(client: any /* Client */, channelId: string)'],
  ['addRoleToMember(member: any, roleId: any)', 'addRoleToMember(member: GuildMember, roleId: string)'],
  ['removeRoleFromMember(member: any, roleId: any)', 'removeRoleFromMember(member: GuildMember, roleId: string)'],
  ['setUserStatus(client: any, status: any)', 'setUserStatus(client: any /* Client */, status: string)']
];

for (const [search, replace] of patterns) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed DiscordUtilityService.ts');
