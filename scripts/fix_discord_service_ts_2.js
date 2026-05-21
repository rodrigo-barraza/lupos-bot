import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/services/DiscordService.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const replacements = [
  // Fix ensureMentionPopulated signature
  [`}: Record<string, unknown>) {`, `}: { message: Message, memberMentionsCollection: DiscordCollection<string, GuildMember>, userMentionsCollection: DiscordCollection<string, User>, participantsMembersCollection: DiscordCollection<string, GuildMember>, participantsUsersCollection: DiscordCollection<string, User>, logPrefix?: string }) {`],
  
  // Fix buildParticipantContext signature
  [`message: Message, // should stay the same\n  participant: User | GuildMember, //is either user or member\n  who: "MENTIONED" | "SECONDARY" | string,\n  participantIndex: number,\n  messages: Message[], // should stay the same\n  participantsAvatarsCollection: DiscordCollection<string, string | null>,\n  participantsBannersCollection: DiscordCollection<string, string | null>,\n  conversation: Record<string, unknown>[],\n  member: GuildMember,\n  user: User,\n  captionsMap: Map<string, string>,`, `message: Message,\n  participant: User | GuildMember | Record<string, unknown>,\n  who: "MENTIONED" | "SECONDARY" | "PRIMARY",\n  participantIndex: number | null,\n  messages: DiscordCollection<string, Message>,\n  participantsAvatarsCollection: DiscordCollection<string, string | null>,\n  participantsBannersCollection: DiscordCollection<string, string | null>,\n  conversation: Record<string, unknown>[] | undefined,\n  member: GuildMember | undefined,\n  user: User | undefined,\n  captionsMap: Map<string, string>,`],
  
  // Property 'size' does not exist on type 'Message[]' -> we changed it to DiscordCollection<string, Message> above, so it will work now
  
  // Fix Activity 'type' map -> (a: Activity) => string
  ['(a: import("discord.js").Attachment) => {', '(a: import("discord.js").Activity) => {'],

  // Fix Attachment 'state' -> attachments don't have 'state' or 'type'. It's 'contentType'
  // Actually, line 363 says "const state = a.state ? `: (${a.state})` : '';". The map was for activities, but my previous replace changed it to Attachment.
  // Wait, I fixed that above with (a: Activity). So line 363 will be fixed naturally.
  
  // buildAndGenerateReply signature
  [`}: Record<string, unknown>) {`, `}: { conversation: Record<string, unknown>[], conversationsCollection: DiscordCollection<string, Record<string, unknown>[]>, memberMentionsCollection: DiscordCollection<string, GuildMember>, messagesEmojisCollection: DiscordCollection<string, Record<string, unknown>>, messagesImagesCollection: DiscordCollection<string, Record<string, unknown>>, newSystemPrompt: string, participantsAvatarsCollection: DiscordCollection<string, string | null>, participantsBannersCollection: DiscordCollection<string, string | null>, participantsCollection: DiscordCollection<string, { user: User }>, participantsMembersCollection: DiscordCollection<string, GuildMember>, participantsUsersCollection: DiscordCollection<string, User>, queuedDatum: { message: Message, recentMessages: DiscordCollection<string, Message> }, userMentionsCollection: DiscordCollection<string, User>, localMongo: import("mongodb").MongoClient }) {`],
  
  // (error as any) missing properties fix
  [`(error as Error & { data?: { retry_after?: number, opcode?: number } })`, `(error as Error & { data?: { retry_after?: number, opcode?: number } })`], // ensure it's there
  
  // userExists from user/member mismatch
  [`const userExists: User | undefined = participantsCollection.get(user.id);`, `const userExists = participantsCollection.get(user.id);`],
  
  // ChannelResolvable
  [`channel: DMChannel | VoiceChannel | TextChannel | NewsChannel | PartialDMChannel | PartialGroupDMChannel | StageChannel | PublicThreadChannel<...> | PrivateThreadChannel`, `channel: GuildChannel | TextChannel | import("discord.js").VoiceChannel | import("discord.js").ThreadChannel`],

  // Fix `customFunction` type in DiscordUtilityService callbacks previously missed
  // No, those are in UtilityService.
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed DiscordService.ts Part 2');
