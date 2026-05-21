import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix imports
# Replace the first `import { ... } from "discord.js";` with all the needed types
content = re.sub(
    r'import \{[\s\S]*?\} from "discord\.js";',
    'import { Collection, ChannelType, ActivityType, Events, Message, Guild, User, Client, TextChannel, GuildEmoji, MessageReaction, PartialMessageReaction, Presence, VoiceState, Interaction, GuildMember, PartialGuildMember, PartialMessage, Role, Attachment } from "discord.js";',
    content,
    count=1
)

# And remove `import type { Client, ... }` if it exists
content = re.sub(r'import type \{[\s\S]*?\} from "discord\.js";\n', '', content)

# Fix (error: Error) -> (error: unknown) then cast to String(error)
content = re.sub(r'\(error: Error\)', '(error: unknown)', content)

# Fix generatedTextResponse is possibly null (line ~2053)
content = content.replace('const textResponse = generatedTextResponse || "";', 'const textResponse = generatedTextResponse || "";')
content = content.replace('generatedTextResponse.substring(', '(generatedTextResponse || "").substring(')
content = content.replace('generatedTextResponse.length', '(generatedTextResponse || "").length')

# Fix ZonedDateTime
content = content.replace('TemporalHelpers.fromMillis(stat.lastMessageDate)', 'TemporalHelpers.fromMillis(stat.lastMessageDate.getTime())')


with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
