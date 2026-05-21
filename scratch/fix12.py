import re

with open('src/services/DiscordUtilityService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('message.(channel as import("discord.js").TextChannel).messages.fetch(', '(message.channel as import("discord.js").TextChannel).messages.fetch(')

content = content.replace('stat.(channel as TextChannel).name', '(stat.channel as import("discord.js").TextChannel).name')

content = content.replace('await if (role) await member.roles.remove(role);', 'if (role) await member.roles.remove(role);')

content = content.replace('await if (client.user) client.user.setStatus(status);', 'if (client.user) await client.user.setStatus(status);')

content = content.replace('await if (role) await member.roles.add(role);', 'if (role) await member.roles.add(role);')

with open('src/services/DiscordUtilityService.ts', 'w', encoding='utf-8') as f:
    f.write(content)
