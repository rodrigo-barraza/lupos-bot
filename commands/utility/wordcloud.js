import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import MongoWrapper from '../../wrappers/MongoWrapper.js';
import puppeteer from 'puppeteer';

// Common stop words to filter out
const STOP_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
    'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
    'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
    'take', 'into', 'year', 'your', 'some', 'could', 'them', 'than', 'then',
    'now', 'only', 'its', 'also', 'back', 'after', 'use', 'how', 'our',
    'even', 'want', 'any', 'these', 'give', 'most', 'us', 'is', 'was',
    'are', 'been', 'has', 'had', 'were', 'did', 'am', 'im', 'youre', 'dont'
]);

export default {
    data: new SlashCommandBuilder()
        .setName('wordcloud')
        .setDescription('Generate a word cloud of most common words for a member')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to generate word cloud for')
                .setRequired(true))
        // .addIntegerOption(option =>
        //     option.setName('limit')
        //         .setDescription('Number of words to include (default: 100)')
        //         .setRequired(false)
        //         .setMinValue(10)
        //         .setMaxValue(200))
        .addIntegerOption(option =>
            option.setName('years')
                .setDescription('Number of years to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(7))
        .addIntegerOption(option =>
            option.setName('months')
                .setDescription('Number of months to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(12))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Number of days to look back')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(365)),

    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");

        const serverAgeInDays = Math.floor((Date.now() - interaction.guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        const serverAgeInMonths = Math.floor(serverAgeInDays / 30);
        const serverAgeInYears = Math.floor(serverAgeInDays / 365);

        await interaction.deferReply();

        const user = interaction.options.getUser('user');
        const limit = interaction.options.getInteger('limit') || 150;
        let years = interaction.options.getInteger('years') || 0;
        const months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;

        if (years === 0 && months === 0 && days === 0) {
            years = serverAgeInYears;
        }

        // Calculate start date
        const startDate = new Date();
        const endDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(startDate.getDate() - days);
        const unixStartDate = Math.floor(startDate.getTime());

        try {
            const displayName = user.globalName || user.username;
            const formattedStartDate = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            const formattedEndDate = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });


            // Fetch all messages from the user
            const messages = await messagesCollection.find({
                'author.id': user.id,
                // 'author.bot': { $ne: true },
                createdTimestamp: { $gte: unixStartDate }
            }).toArray();

            if (messages.length === 0) {
                await interaction.editReply({
                    content: `No messages found for ${user.username} in the specified time period.`
                });
                return;
            }

            // Process words
            const wordFreq = processWords(messages, limit);

            if (wordFreq.length === 0) {
                await interaction.editReply({
                    content: `No valid words found for <@${user.id}>.`
                });
                return;
            }

            // Generate word cloud image
            const imageBuffer = await generateWordCloudImage(wordFreq, user.username);

            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, {
                name: `wordcloud-${user.username}.png`
            });

            await interaction.editReply({
                content: `**Word Cloud for <@${user.id}>**\nBased on ${messages.length} messages from the last ${formatTimePeriod(years, months, days)} (From ${formattedStartDate} to ${formattedEndDate})`,
                files: [attachment]
            });

        } catch (error) {
            console.error('Error generating word cloud:', error);
            await interaction.editReply({
                content: 'An error occurred while generating the word cloud. Please try again later.'
            });
        }
    }
};

// Process messages to extract word frequencies
function processWords(messages, limit) {
    const freqMap = {};

    for (const msg of messages) {
        if (!msg.content) continue;

        // Remove URLs, mentions, emojis, and special characters
        const cleanContent = msg.content
            .replace(/https?:\/\/\S+/g, '') // Remove URLs
            .replace(/<@!?\d+>/g, '') // Remove user mentions
            .replace(/<#\d+>/g, '') // Remove channel mentions
            .replace(/<@&\d+>/g, '') // Remove role mentions
            .replace(/<a?:\w+:\d+>/g, '') // Remove custom emojis
            .replace(/[^\w\s'-]/g, ' ') // Remove punctuation except hyphens and apostrophes
            .toLowerCase();

        const words = cleanContent.split(/\s+/).filter(word => {
            word = word.trim();
            return word.length > 2 && // At least 3 characters
                !STOP_WORDS.has(word) &&
                !/^\d+$/.test(word) && // Not just numbers
                /[a-z]/.test(word); // Contains at least one letter
        });

        for (const word of words) {
            freqMap[word] = (freqMap[word] || 0) + 1;
        }
    }

    // Convert to array and sort
    return Object.entries(freqMap)
        .map(([text, value]) => ({ text, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

// Generate word cloud image using Puppeteer
async function generateWordCloudImage(words, username) {
    let puppeteerOptions;
    if (process.platform === "win32") {
        puppeteerOptions = { headless: true };
    } else {
        puppeteerOptions = { headless: true, executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox'] };
    }
    const browser = await puppeteer.launch(puppeteerOptions);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        // Create HTML content with word cloud
        const html = generateWordCloudHTML(words, username);

        await page.setContent(html, { waitUntil: 'networkidle0' });

        // Wait a bit for any animations/layout to settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Take screenshot
        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: false
        });

        return screenshot;
    } finally {
        await browser.close();
    }
}

// Generate HTML with word cloud using d3-cloud
function generateWordCloudHTML(words, username) {
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

// Helper function to format time period
function formatTimePeriod(years, months, days) {
    const parts = [];
    if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

    if (parts.length === 0) return '1 year (default)';
    return parts.join(', ');
}