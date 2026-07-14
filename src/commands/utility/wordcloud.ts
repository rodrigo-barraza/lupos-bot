import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  SlashCommandUserOption,
} from "discord.js";
import type { WithId, Document } from "mongodb";
import {
  getMongoDb,
  addTimePeriodOptions,
  resolvePeriod,
  renderHtmlToPng,
} from "./commandUtils.ts";
import { EXCLUDE_SOFT_DELETED } from "#root/constants.js";

interface WordFrequency {
  text: string;
  value: number;
}

// Common stop words to filter out
const STOP_WORDS = new Set([
  "the",
  "be",
  "to",
  "of",
  "and",
  "a",
  "in",
  "that",
  "have",
  "i",
  "it",
  "for",
  "not",
  "on",
  "with",
  "he",
  "as",
  "you",
  "do",
  "at",
  "this",
  "but",
  "his",
  "by",
  "from",
  "they",
  "we",
  "say",
  "her",
  "she",
  "or",
  "an",
  "will",
  "my",
  "one",
  "all",
  "would",
  "there",
  "their",
  "what",
  "so",
  "up",
  "out",
  "if",
  "about",
  "who",
  "get",
  "which",
  "go",
  "me",
  "when",
  "make",
  "can",
  "like",
  "time",
  "no",
  "just",
  "him",
  "know",
  "take",
  "into",
  "year",
  "your",
  "some",
  "could",
  "them",
  "than",
  "then",
  "now",
  "only",
  "its",
  "also",
  "back",
  "after",
  "use",
  "how",
  "our",
  "even",
  "want",
  "any",
  "these",
  "give",
  "most",
  "us",
  "is",
  "was",
  "are",
  "been",
  "has",
  "had",
  "were",
  "did",
  "am",
  "im",
  "youre",
  "dont",
]);

export default {
  data: addTimePeriodOptions(
    new SlashCommandBuilder()
      .setName("wordcloud")
      .setDescription("Generate a word cloud of most common words for a member")
      .addUserOption((option: SlashCommandUserOption) =>
        option
          .setName("user")
          .setDescription("The user to generate word cloud for")
          .setRequired(true),
      ),
  ),

  async execute(interaction: ChatInputCommandInteraction) {
    const db = getMongoDb();
    const messagesCollection = db.collection("Messages");

    await interaction.deferReply();

    const user = interaction.options.getUser("user");
    const limit = 150;

    const { startDate, unixStartDate, label } = resolvePeriod(interaction);
    const endDate = new Date();

    const formattedStartDate = startDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const formattedEndDate = endDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Fetch all messages from the user in this guild
    const messages = await messagesCollection
      .find({
        ...EXCLUDE_SOFT_DELETED,
        guildId: interaction.guildId,
        "author.id": user!.id,
        createdTimestamp: { $gte: unixStartDate },
      })
      .toArray();

    if (messages.length === 0) {
      await interaction.editReply({
        content: `No messages found for ${user!.username} in the specified time period.`,
      });
      return;
    }

    // Process words
    const wordFrequency = processWords(
      messages,
      limit,
      interaction.client.user.id,
    );

    if (wordFrequency.length === 0) {
      await interaction.editReply({
        content: `No valid words found for <@${user!.id}>.`,
      });
      return;
    }

    // Generate word cloud image
    const imageBuffer = await generateWordCloudImage(wordFrequency);

    // Create attachment
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: `wordcloud-${user!.username}.png`,
    });

    await interaction.editReply({
      content: `**Word Cloud for <@${user!.id}>**\nBased on ${messages.length} messages from the ${label} (From ${formattedStartDate} to ${formattedEndDate})`,
      files: [attachment],
    });
  },
};

// Process messages to extract word frequencies
function processWords(
  messages: WithId<Document>[],
  resultLimit: number,
  botUserIdentifier?: string,
): WordFrequency[] {
  const wordFrequencyMap: Record<string, number> = {};

  for (const message of messages) {
    if (!message.content) continue;

    const trimmedMessageContent = message.content.trim();
    if (!trimmedMessageContent) continue;

    // Skip commands starting with typical prefix characters
    if (/^[!/.?$#\-+=~]/.test(trimmedMessageContent)) continue;

    // Skip messages mentioning the bot directly
    if (
      botUserIdentifier &&
      (trimmedMessageContent.includes(`<@${botUserIdentifier}>`) ||
        trimmedMessageContent.includes(`<@!${botUserIdentifier}>`))
    ) {
      continue;
    }

    // Skip messages starting with command verbs
    if (
      /^(draw|redraw|paint|generate|image|play)\b/i.test(trimmedMessageContent)
    )
      continue;

    // Skip messages containing common command keywords or style prompt patterns
    if (
      /\b(draw|redraw|photorealistic|hyper-realistic|hyperrealistic|aspect ratio|aspect-ratio)\b/i.test(
        trimmedMessageContent,
      )
    ) {
      continue;
    }

    // Remove URLs, mentions, emojis, and special characters
    const cleanedMessageContent = message.content
      .replace(/https?:\/\/\S+/g, "") // Remove URLs
      .replace(/<@!?\d+>/g, "") // Remove user mentions
      .replace(/<#\d+>/g, "") // Remove channel mentions
      .replace(/<@&\d+>/g, "") // Remove role mentions
      .replace(/<a?:\w+:\d+>/g, "") // Remove custom emojis
      .replace(/[^\w\s'-]/g, " ") // Remove punctuation except hyphens and apostrophes
      .toLowerCase();

    const extractedWords = cleanedMessageContent
      .split(/\s+/)
      .filter((wordText: string) => {
        const trimmedWord = wordText.trim();
        return (
          trimmedWord.length > 2 && // At least 3 characters
          !STOP_WORDS.has(trimmedWord) &&
          !/^\d+$/.test(trimmedWord) && // Not just numbers
          /[a-z]/.test(trimmedWord)
        ); // Contains at least one letter
      });

    for (const wordText of extractedWords) {
      const trimmedWord = wordText.trim();
      wordFrequencyMap[trimmedWord] = (wordFrequencyMap[trimmedWord] || 0) + 1;
    }
  }

  // Convert to array and sort
  return Object.entries(wordFrequencyMap)
    .map(([text, value]: [string, number]) => ({ text, value }))
    .sort(
      (firstItem: WordFrequency, secondItem: WordFrequency) =>
        secondItem.value - firstItem.value,
    )
    .slice(0, resultLimit);
}

// Generate word cloud image using the shared Playwright pipeline
async function generateWordCloudImage(words: WordFrequency[]) {
  const html = generateWordCloudHTML(words);
  return renderHtmlToPng(html, { width: 1200, height: 800 });
}

// Generate HTML with word cloud using d3-cloud
function generateWordCloudHTML(words: WordFrequency[]) {
  const wordsJson = JSON.stringify(words);

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #191919ff;
            font-family: Arial, sans-serif;
        }
        #wordcloud {
            width: 1200px;
            height: 800px;
        }
    </style>
</head>
<body>
    <div id="wordcloud"></div>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/d3-cloud@1.2.5/build/d3.layout.cloud.min.js"></script>
    <script>
        const words = ${wordsJson};
        const width = 1200;
        const height = 800;
        const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3BA55C', '#FFA500', '#1ABC9C', '#9B59B6', '#3498DB'];

        // Calculate font scale
        const minFreq = Math.min(...words.map(w => w.value));
        const maxFreq = Math.max(...words.map(w => w.value));
        
        const fontScale = (value) => {
            const minSize = 16;
            const maxSize = 100;
            const logMin = Math.log(minFreq);
            const logMax = Math.log(maxFreq);
            const scale = (Math.log(value) - logMin) / (logMax - logMin);
            return minSize + (maxSize - minSize) * scale;
        };

        const layout = d3.layout.cloud()
            .size([width, height])
            .words(words.map(d => ({ 
                text: d.text, 
                size: fontScale(d.value),
                value: d.value 
            })))
            .padding(6)
            .rotate(() => (Math.random() * 20) - 10)
            .font('Impact')
            .fontSize(d => d.size)
            .random(() => 0.5)
            .on('end', draw);

        layout.start();

        function draw(words) {
            d3.select('#wordcloud').append('svg')
                .attr('width', width)
                .attr('height', height)
                .append('g')
                .attr('transform', 'translate(' + width/2 + ',' + height/2 + ')')
                .selectAll('text')
                .data(words)
                .enter().append('text')
                .style('font-size', d => d.size + 'px')
                .style('font-family', 'Impact, Arial Black, sans-serif')
                .style('font-weight', 'bold')
                .style('fill', (d, i) => colors[i % colors.length])
                .attr('text-anchor', 'middle')
                .attr('transform', d => 'translate(' + [d.x, d.y] + ')rotate(' + d.rotate + ')')
                .text(d => d.text);
        }
    </script>
</body>
</html>
    `;
}
