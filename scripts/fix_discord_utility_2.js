import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/DiscordUtilityService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Imports
if (!content.includes('import type { Client, Events } from "discord.js";')) {
  content = content.replace(
    'import type { Message',
    'import type { Client, Events, PartialMessage, PartialGuildMember } from "discord.js";\nimport type { Message'
  );
}

const patterns = [
  ['client: any /* Discord.js Client */', 'client: Client'],
  ['mongo: any', 'mongo: import("mongodb").MongoClient'],
  ['localMongo: any', 'localMongo: import("mongodb").MongoClient'],
  ['guildId: any', 'guildId: string'],
  ['userIds: any', 'userIds: string[]'],
  ['userId: any', 'userId: string'],
  ['message: any', 'message: Message'],
  ['reactionMessage: any', 'reactionMessage: Message'],
  ['{ user, member }: any', '{ user, member }: { user: User; member: GuildMember }'],
  ['user: any', 'user: User'],
  ['member: any', 'member: GuildMember'],
  ['guild: any', 'guild: import("discord.js").Guild'],
  ['roleId: any', 'roleId: string'],
  ['channelId: any', 'channelId: string'],
  ['imageUrl: any', 'imageUrl: string'],
  ['options: any', 'options: Record<string, unknown>'],
  ['customFunction: any', 'customFunction: (...args: any[]) => void'],
  ['status: any', 'status: import("discord.js").PresenceStatusData'],
  ['format: any', 'format: "string" | "array"'],
  ['force: any', 'force: boolean'],
  ['oldMessage: any', 'oldMessage: Message | PartialMessage'],
  ['newMessage: any', 'newMessage: Message | PartialMessage'],
  ['reaction: any', 'reaction: MessageReaction | PartialMessageReaction'],
  ['oldPresence: any', 'oldPresence: Presence | null'],
  ['newPresence: any', 'newPresence: Presence'],
  ['oldState: any', 'oldState: VoiceState'],
  ['newState: any', 'newState: VoiceState'],
  ['oldMember: any', 'oldMember: GuildMember | PartialGuildMember'],
  ['newMember: any', 'newMember: GuildMember'],
  ['interaction: any', 'interaction: Interaction'],
  ['emoji: any', 'emoji: GuildEmoji'],
  ['chunk.map(async (msgId: any)', 'chunk.map(async (msgId: string)'],
  ['let liveMessage: any;', 'let liveMessage: Message | null = null;'],
  ['collectionName: any', 'collectionName: string'],
  ['name: any', 'name: string'],
  ['const orphanIds: any[] = [];', 'const orphanIds: string[] = [];'],
  ['const audioUrls: any[] = [];', 'const audioUrls: string[] = [];'],
  ['const imageUrls: any[] = [];', 'const imageUrls: string[] = [];'],
  ['let messageReference: any;', 'let messageReference: import("discord.js").MessageReference | null = null;'],
  ['let displayName: any;', 'let displayName: string | null = null;'],
  ['(role: any) => role.id', '(role: Role) => role.id'],
  ['(a: any, b: any) => a.rawPosition', '(a: Role, b: Role) => a.rawPosition'],
  ['{ mongo, localMongo }: any', '{ mongo, localMongo }: { mongo: import("mongodb").MongoClient, localMongo: import("mongodb").MongoClient }']
];

for (const [search, replace] of patterns) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed DiscordUtilityService.ts Part 2');
