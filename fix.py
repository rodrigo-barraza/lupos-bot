import re

with open('src/commands/utility/deathrollUtils.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix InteractionCollector
text = re.sub(r'const activeCollectors = new Map<string, InteractionCollector<MessageComponentInteraction>>\(\);', r'const activeCollectors = new Map<string, import(
