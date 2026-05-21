import { Project, SyntaxKind, ParameterDeclaration, TypeNode } from "ts-morph";

const project = new Project({
    tsConfigFilePath: "tsconfig.json",
});

const sourceFile = project.getSourceFileOrThrow("src/services/DiscordUtilityService.ts");

// 1. Add imports
sourceFile.addImportDeclaration({
    moduleSpecifier: "discord.js",
    namedImports: ["Message", "Guild", "User", "Client", "TextChannel", "GuildEmoji", "MessageReaction", "PartialMessageReaction", "Presence", "VoiceState", "Interaction", "GuildMember", "PartialGuildMember", "PartialMessage", "Role", "Attachment", "PresenceStatusData"]
});

const mappings: Record<string, string> = {
    client: "Client",
    mongo: 'import("mongodb").MongoClient',
    localMongo: 'import("mongodb").MongoClient',
    message: "Message",
    oldMessage: "Message | PartialMessage",
    newMessage: "Message | PartialMessage",
    member: "GuildMember",
    oldMember: "GuildMember | PartialGuildMember",
    newMember: "GuildMember",
    guild: "Guild",
    channel: "TextChannel",
    reaction: "MessageReaction | PartialMessageReaction",
    reactionMessage: "Message",
    user: "User",
    interaction: "Interaction",
    status: "PresenceStatusData",
    channelId: "string",
    userId: "string",
    guildId: "string",
    messageId: "string",
    userIds: "string[]",
    emoji: "GuildEmoji",
    oldPresence: "Presence | null",
    newPresence: "Presence",
    oldState: "VoiceState",
    newState: "VoiceState",
    customFunction: "(...args: unknown[]) => void",
    options: "Record<string, unknown>",
    roleId: "string",
    collectionName: "string",
    format: '"string" | "array"',
    force: "boolean",
    sendOrReply: '"send" | "reply"',
    generatedTextResponse: "string | null",
    encodedImageDataBase64: "Buffer | string | null",
    imagePrompt: "string | null",
    imageUrl: "string",
    name: "string",
    sendTypingInterval: "NodeJS.Timeout",
    channelIndex: "number",
    index: "number",
    batchIndex: "number",
    r: "MessageReaction",
    attachment: "Attachment",
    role: "Role",
    document: "import('mongodb').Document",
    msgId: "string",
    _error: "Error",
    error: "Error",
    existingMsg: "Message",
    item: "unknown"
};

// 2. Fix all parameters typed as `any` or untyped (implicit any)
for (const param of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
    const typeNode = param.getTypeNode();
    const paramName = param.getName();
    
    if (typeNode && typeNode.getText() === "any") {
        if (mappings[paramName]) {
            param.setType(mappings[paramName]);
        } else {
            param.setType("unknown");
        }
    }
}

// 3. Fix arrays typed as any[]
for (const varDecl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const typeNode = varDecl.getTypeNode();
    if (typeNode && typeNode.getText() === "any[]") {
        const name = varDecl.getName();
        if (name === "queue") varDecl.setType("(() => void)[]");
        else if (name === "channelPromises") varDecl.setType("Promise<unknown>[]");
        else if (name === "orphanIds" || name === "audioUrls" || name === "imageUrls") varDecl.setType("string[]");
        else if (name === "files") varDecl.setType("import('discord.js').AttachmentPayload[]");
        else if (name === "channelStats" || name === "results") varDecl.setType("unknown[]");
        else if (name === "eligibleChannels") varDecl.setType("TextChannel[]");
        else if (name === "allMessages" || name === "messagesArray" || name === "messageArray") varDecl.setType("Message[]");
        else varDecl.setType("unknown[]");
    }
    
    if (typeNode && typeNode.getText() === "any") {
        const name = varDecl.getName();
        if (name === "guildsCollection") varDecl.setType("import('discord.js').Collection<string, Guild>");
        else if (name === "returnedFirstMessage" || name === "liveMessage" || name === "messageReference") varDecl.setType("Message | null");
        else if (name === "displayName") varDecl.setType("string | null");
        else varDecl.setType("unknown");
    }
}

sourceFile.saveSync();
