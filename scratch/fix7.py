import re
with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('message.(channel as import("discord.js").TextChannel).messages.fetch(', '(message.channel as import("discord.js").TextChannel).messages.fetch(')

# Fix the ternary on message.guild ? ...
content = content.replace('      });\n      if (format === "array") {', '      }) : [];\n      if (format === "array") {')

# Wait, `emojis` maps over `message.guild.emojis.cache`.
# The replacement of map callback type:
content = content.replace('return emojis.map((emoji: GuildEmoji) => `<${emoji.name}:${emoji.id}>`).join(", ");', 'return emojis.map((emoji: any) => `<${emoji.name}:${emoji.id}>`).join(", ");')


with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
