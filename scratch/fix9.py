import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Broad replacements
replacements = [
    (r'\bclient: any\b', 'client: Client'),
    (r'\bmongo: any\b', 'mongo: import("mongodb").MongoClient'),
    (r'\blocalMongo: any\b', 'localMongo: import("mongodb").MongoClient'),
    (r'\bmessage: any\b', 'message: Message'),
    (r'\boldMessage: any\b', 'oldMessage: Message | PartialMessage'),
    (r'\bnewMessage: any\b', 'newMessage: Message | PartialMessage'),
    (r'\bmember: any\b', 'member: GuildMember'),
    (r'\boldMember: any\b', 'oldMember: GuildMember | PartialGuildMember'),
    (r'\bnewMember: any\b', 'newMember: GuildMember'),
    (r'\bguild: any\b', 'guild: Guild'),
    (r'\bchannel: any\b', 'channel: TextChannel'),
    (r'\breaction: any\b', 'reaction: MessageReaction | PartialMessageReaction'),
    (r'\breactionMessage: any\b', 'reactionMessage: Message'),
    (r'\buser: any\b', 'user: User'),
    (r'\binteraction: any\b', 'interaction: Interaction'),
    (r'\bstatus: any\b', 'status: import("discord.js").PresenceStatusData'),
    (r'\bchannelId: any\b', 'channelId: string'),
    (r'\buserId: any\b', 'userId: string'),
    (r'\bguildId: any\b', 'guildId: string'),
    (r'\bmessageId: any\b', 'messageId: string'),
    (r'\buserIds: any\b', 'userIds: string[]'),
    (r'\bemoji: any\b', 'emoji: GuildEmoji'),
    (r'\boldPresence: any\b', 'oldPresence: Presence | null'),
    (r'\bnewPresence: any\b', 'newPresence: Presence'),
    (r'\boldState: any\b', 'oldState: VoiceState'),
    (r'\bnewState: any\b', 'newState: VoiceState'),
    (r'\bcustomFunction: any\b', 'customFunction: (...args: any[]) => void'),
    (r'\boptions: any\b', 'options: Record<string, unknown>'),
    (r'\broleId: any\b', 'roleId: string'),
    (r'\bcollectionName: any\b', 'collectionName: string'),
    (r'\bformat: any\b', 'format: "string" | "array"'),
    (r'\bforce: any\b', 'force: boolean'),
    (r'\bsendOrReply: any\b', 'sendOrReply: "send" | "reply"'),
    (r'\bgeneratedTextResponse: any\b', 'generatedTextResponse: string | null'),
    (r'\bencodedImageDataBase64: any\b', 'encodedImageDataBase64: Buffer | string | null'),
    (r'\bimagePrompt: any\b', 'imagePrompt: string | null'),
    (r'\bimageUrl: any\b', 'imageUrl: string'),
    (r'\bname: any\b', 'name: string'),
    (r'\bsendTypingInterval: any\b', 'sendTypingInterval: NodeJS.Timeout'),
    (r'\bchannelIndex: any\b', 'channelIndex: number'),
    (r'\bindex: any\b', 'index: number'),
    (r'\bbatchIndex: any\b', 'batchIndex: number'),
    (r'\bitem: any\b', 'item: any'), # we can't guess item
    (r'\br: any\b', 'r: MessageReaction'),
]

for old, new_val in replacements:
    content = re.sub(old, new_val, content)

# Remove 'any' from type parameters / arrays
content = re.sub(r'const queue: any\[\]', 'const queue: (() => void)[]', content)
content = re.sub(r'const channelPromises: any\[\]', 'const channelPromises: Promise<any>[]', content)
content = re.sub(r'const orphanIds: any\[\]', 'const orphanIds: string[]', content)
content = re.sub(r'const audioUrls: any\[\]', 'const audioUrls: string[]', content)
content = re.sub(r'const imageUrls: any\[\]', 'const imageUrls: string[]', content)
content = re.sub(r'const files: any\[\]', 'const files: import("discord.js").AttachmentPayload[]', content)
content = re.sub(r'const channelStats: any\[\]', 'const channelStats: any[]', content)
content = re.sub(r'const eligibleChannels: any\[\]', 'const eligibleChannels: TextChannel[]', content)
content = re.sub(r'const allMessages: any\[\]', 'const allMessages: Message[]', content)
content = re.sub(r'const messagesArray: any\[\]', 'const messagesArray: Message[]', content)
content = re.sub(r'const messageArray: any\[\]', 'const messageArray: Message[]', content)
content = re.sub(r'const results: any\[\]', 'const results: any[]', content)
content = re.sub(r'let guildsCollection: any', 'let guildsCollection: import("discord.js").Collection<string, Guild>', content)
content = re.sub(r'let returnedFirstMessage: any', 'let returnedFirstMessage: Message | null = null', content)
content = re.sub(r'let liveMessage: any', 'let liveMessage: Message | null', content)
content = re.sub(r'let messageReference: any', 'let messageReference: Message | null = null', content)
content = re.sub(r'let displayName: any', 'let displayName: string | null = null', content)

# Fix role: any
content = re.sub(r'\(role: any\)', '(role: import("discord.js").Role)', content)

# Fix a, b sorts
content = re.sub(r'\(a: any, b: any\) => a.rawPosition - b.rawPosition', '(a: import("discord.js").Role, b: import("discord.js").Role) => a.rawPosition - b.rawPosition', content)

# Fix document: any
content = re.sub(r'\(document: any\)', '(document: { id: string })', content)

# Fix message: any in iterations
content = re.sub(r'\(message: any\)', '(message: Message)', content)

# Fix msgId: any
content = re.sub(r'\(msgId: any\)', '(msgId: string)', content)

# Fix _error: any
content = re.sub(r'\(_error: any\)', '(_error: Error)', content)
content = re.sub(r'\(error: any\)', '(error: Error)', content)

# Fix existingMsg: any
content = re.sub(r'\(existingMsg: any\)', '(existingMsg: Message)', content)

# Fix user: any in top users
content = re.sub(r'\(user: any, index: number\)', '(user: { username: string; count: number; totalMessages?: number }, index: number)', content)

# Fix stat: any
content = re.sub(r'\(stat: any, index: number\)', '(stat: { channel: TextChannel, averageMessagesPerDay: number, messageCount: number, uniqueUsers: number, topUsers: any[], lastMessageDate: Date, categoryName: string }, index: number)', content)
content = re.sub(r'\(stat: any\)', '(stat: { messageCount: number })', content)
content = re.sub(r'\(sum: any, stat: { messageCount: number }\)', '(sum: number, stat: { messageCount: number })', content)
content = re.sub(r'\(a: any, b: any\) => b.averageMessagesPerDay', '(a: { averageMessagesPerDay: number }, b: { averageMessagesPerDay: number }) => b.averageMessagesPerDay', content)

# Fix [_userId, data]: any
content = re.sub(r'\(\[_userId, data\]: any\)', '([_userId, data]: [string, any])', content)

# Fix Object.entries sort
content = re.sub(r'\(a: any, b: any\) => b\[1\]\.count', '(a: [string, { count: number }], b: [string, { count: number }]) => b[1].count', content)
content = re.sub(r'\(a: any, b: any\) => b\[1\]\.totalMessages', '(a: [string, { totalMessages: number }], b: [string, { totalMessages: number }]) => b[1].totalMessages', content)

# Custom fixes:
# (channel: TextChannel) => channel.id == channelId  (wait, TextChannel does not have all channel ids if it's not a text channel)
content = re.sub(r'\(channel: TextChannel\) => channel.id == channelId', '(channel: import("discord.js").Channel) => channel.id === channelId', content)

content = content.replace('{ mongo, localMongo }: any', '{ mongo, localMongo }: { mongo: import("mongodb").MongoClient, localMongo: import("mongodb").MongoClient }')
content = content.replace('{ user, member }: any', '{ user, member }: { user?: User, member?: GuildMember }')


with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
