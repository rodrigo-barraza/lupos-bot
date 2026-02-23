import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import MongoWrapper from '../../wrappers/MongoWrapper.js';
import puppeteer from 'puppeteer';

export default {
    data: new SlashCommandBuilder()
        .setName('heatmap')
        .setDescription('Shows activity heatmap by day/hour for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to analyze (default: you)')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to check (default: all channels)')
                .setRequired(false))
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
                .setMinValue(7)
                .setMaxValue(31)),


    async execute(interaction) {
        const localMongo = MongoWrapper.getClient('local');
        const db = localMongo.db("lupos");
        const messagesCollection = db.collection("Messages");

        const serverAgeInDays = Math.floor((Date.now() - interaction.guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        const serverAgeInMonths = Math.floor(serverAgeInDays / 30);
        const serverAgeInYears = Math.floor(serverAgeInDays / 365);

        await interaction.deferReply();

        // Get parameters
        const user = interaction.options.getUser('user') || interaction.user;
        const channel = interaction.options.getChannel('channel');
        let years = interaction.options.getInteger('years') || 0;
        let months = interaction.options.getInteger('months') || 0;
        let days = interaction.options.getInteger('days') || 0;

        if (years === 0 && months === 0 && days === 0) {
            years = serverAgeInYears + 1;
        }

        // Calculate start date
        const now = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(startDate.getDate() - days);
        const unixStartDate = Math.floor(startDate.getTime());

        // Calculate actual days in the period
        const actualDays = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

        const match = {
            createdTimestamp: { $gte: unixStartDate },
            guildId: interaction.guildId,
            'author.id': user.id,
            'author.bot': { $ne: true }
        };

        if (channel) {
            match.channelId = channel.id;
        }

        try {
            // Aggregate messages by day of week and 30-minute intervals (in PST)
            const [hourlyResult] = await messagesCollection.aggregate([
                {
                    $match: match
                },
                {
                    $project: {
                        date: { $toDate: '$createdTimestamp' },
                        author: 1
                    }
                },
                {
                    $group: {
                        _id: {
                            dayOfWeek: {
                                $subtract: [
                                    { $dayOfWeek: { date: '$date', timezone: 'America/Los_Angeles' } },
                                    1
                                ]
                            },
                            hour: { $hour: { date: '$date', timezone: 'America/Los_Angeles' } },
                            minute: { $minute: { date: '$date', timezone: 'America/Los_Angeles' } }
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        dayOfWeek: '$_id.dayOfWeek',
                        block: {
                            $add: [
                                { $multiply: ['$_id.hour', 2] },
                                { $cond: [{ $gte: ['$_id.minute', 30] }, 1, 0] }
                            ]
                        },
                        count: 1
                    }
                },
                {
                    $group: {
                        _id: {
                            dayOfWeek: '$dayOfWeek',
                            block: '$block'
                        },
                        count: { $sum: '$count' }
                    }
                },
                {
                    $group: {
                        _id: null,
                        messages: {
                            $push: {
                                day: '$_id.dayOfWeek',
                                block: '$_id.block',
                                count: '$count'
                            }
                        },
                        totalMessages: { $sum: '$count' }
                    }
                }
            ]).toArray();

            // Aggregate messages by year and month
            const [monthlyResult] = await messagesCollection.aggregate([
                {
                    $match: match
                },
                {
                    $project: {
                        date: { $toDate: '$createdTimestamp' }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: { date: '$date', timezone: 'America/Los_Angeles' } },
                            month: { $month: { date: '$date', timezone: 'America/Los_Angeles' } }
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: null,
                        messages: {
                            $push: {
                                year: '$_id.year',
                                month: '$_id.month',
                                count: '$count'
                            }
                        }
                    }
                }
            ]).toArray();

            if (!hourlyResult || hourlyResult.totalMessages === 0) {
                return await interaction.editReply({
                    content: `No messages found for ${user.username} in the specified period.`
                });
            }

            const hourlyMessages = hourlyResult.messages;
            const totalMessages = hourlyResult.totalMessages;
            const monthlyMessages = monthlyResult?.messages || [];

            // Create 7x48 grid (days x 30-minute blocks)
            const heatmapData = Array(7).fill(null).map(() => Array(48).fill(0));

            // Fill in the hourly data
            hourlyMessages.forEach(msg => {
                heatmapData[msg.day][msg.block] = msg.count;
            });

            // Find max count for color scaling
            let maxCount = 0;
            let peakDay = 0;
            let peakBlock = 0;

            heatmapData.forEach((dayData, day) => {
                dayData.forEach((count, block) => {
                    if (count > maxCount) {
                        maxCount = count;
                        peakDay = day;
                        peakBlock = block;
                    }
                });
            });

            // Process monthly data
            const yearSet = new Set();
            monthlyMessages.forEach(msg => yearSet.add(msg.year));
            const years = Array.from(yearSet).sort();

            // Create year x month grid (dynamic years x 12 months)
            const monthlyHeatmapData = [];
            years.forEach(year => {
                const yearData = Array(12).fill(0);
                monthlyMessages.forEach(msg => {
                    if (msg.year === year) {
                        yearData[msg.month - 1] = msg.count;
                    }
                });
                monthlyHeatmapData.push({ year, data: yearData });
            });

            // Find max for monthly heatmap
            let maxMonthlyCount = 0;
            monthlyHeatmapData.forEach(yearData => {
                yearData.data.forEach(count => {
                    if (count > maxMonthlyCount) {
                        maxMonthlyCount = count;
                    }
                });
            });

            // Generate heatmap image
            const imageBuffer = await generateHeatmapImage(
                heatmapData,
                maxCount,
                monthlyHeatmapData,
                maxMonthlyCount,
                user.username
            );

            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, {
                name: `heatmap-${user.username}.png`
            });

            // Calculate statistics
            const avgPerHour = actualDays > 0 ? (totalMessages / (actualDays * 24)).toFixed(2) : '0.00';
            const mostActiveDay = getMostActiveDay(heatmapData);
            const mostActiveBlocks = getMostActiveBlocks(heatmapData);

            // Create embed
            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📊 Activity Heatmap - ${user.username}`)
                .setDescription(`*All times shown in Pacific Time (PST/PDT)*\n*Includes hourly activity pattern and monthly activity over time*`)
                .addFields(
                    { name: '📅 Period', value: `Last ${actualDays} days`, inline: true },
                    { name: '📝 Channel', value: channel ? channel.toString() : 'All Channels', inline: true },
                    { name: '💬 Total Messages', value: totalMessages.toString(), inline: true },
                    { name: '🔥 Peak Activity', value: `${getDayName(peakDay)} at ${formatTimeBlock(peakBlock)} (${maxCount} messages)`, inline: false },
                    { name: '📊 Average Messages/Hour', value: avgPerHour, inline: true },
                    { name: '🌟 Most Active Day', value: mostActiveDay, inline: true },
                    { name: '⏰ Most Active Times', value: mostActiveBlocks, inline: true }
                )
                .setImage(`attachment://heatmap-${user.username}.png`)
                .setFooter({ text: `From ${startDate.toLocaleDateString()} to ${now.toLocaleDateString()}` })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                files: [attachment]
            });

        } catch (error) {
            console.error('Error fetching heatmap:', error);
            await interaction.editReply({
                content: 'An error occurred while generating the heatmap. Please try again later.'
            });
        }
    }
};

// Generate heatmap image using Puppeteer and D3
async function generateHeatmapImage(hourlyData, maxHourlyCount, monthlyData, maxMonthlyCount, username) {
    let puppeteerOptions;
    if (process.platform === "win32") {
        puppeteerOptions = { headless: true };
    } else {
        puppeteerOptions = {
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox']
        };
    }

    const browser = await puppeteer.launch(puppeteerOptions);

    try {
        const page = await browser.newPage();
        // Increased height to accommodate both heatmaps
        // await page.setViewport({ width: 1600, height: 1100 });
        // In generateHeatmapImage function, calculate dynamic height
        const estimatedHeight = 800 + (monthlyData.length * 40); // Base height + monthly rows
        await page.setViewport({ width: 1600, height: Math.max(1100, estimatedHeight) });

        // Create HTML content with both heatmaps
        const html = generateHeatmapHTML(hourlyData, maxHourlyCount, monthlyData, maxMonthlyCount, username);

        await page.setContent(html, { waitUntil: 'networkidle0' });

        // Wait for rendering
        await new Promise(resolve => setTimeout(resolve, 500));

        // Take screenshot
        const screenshot = await page.screenshot({
            type: 'png',
            fullPage: false,
            omitBackground: true
        });

        return screenshot;
    } finally {
        await browser.close();
    }
}

// Generate HTML with D3 heatmaps
function generateHeatmapHTML(hourlyData, maxHourlyCount, monthlyData, maxMonthlyCount, username) {
    const hourlyDataJson = JSON.stringify(hourlyData);
    const monthlyDataJson = JSON.stringify(monthlyData);

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: transparent;
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #FFFFFF;
        }
        #heatmap-container {
            width: 1600px;
            height: 1100px;
        }
        .cell {
            stroke: #23272A;
            stroke-width: 1px;
        }
        .cell:hover {
            stroke: #FFFFFF;
            stroke-width: 2px;
        }
        .day-label, .hour-label, .month-label, .year-label {
            font-size: 12px;
            fill: #B9BBBE;
            font-weight: 500;
        }
        .title {
            font-size: 24px;
            fill: #FFFFFF;
            font-weight: bold;
        }
        .subtitle {
            font-size: 14px;
            fill: #B9BBBE;
            font-weight: normal;
        }
        .section-title {
            font-size: 18px;
            fill: #FFFFFF;
            font-weight: bold;
        }
        .legend-text {
            font-size: 12px;
            fill: #B9BBBE;
        }
        .legend-title {
            font-size: 14px;
            fill: #FFFFFF;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div id="heatmap-container"></div>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script>
        const hourlyData = ${hourlyDataJson};
        const maxHourlyCount = ${maxHourlyCount};
        const monthlyData = ${monthlyDataJson};
        const maxMonthlyCount = ${maxMonthlyCount};
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        // Convert block index to time string
        function blockToTime(block) {
            const hour = Math.floor(block / 2);
            const minute = (block % 2) * 30;
            const period = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            return displayHour + ':' + (minute === 0 ? '00' : minute) + ' ' + period;
        }
        
        // Calculate dimensions
        const svgWidth = 1600;
        const hourlyMargin = {top: 80, right: 40, bottom: 80, left: 100};
        const hourlyWidth = svgWidth - hourlyMargin.left - hourlyMargin.right;
        const hourlyHeight = 400 - hourlyMargin.top - hourlyMargin.bottom;
        
        const monthlyMargin = {top: 80, right: 40, bottom: 60, left: 100};
        const monthlyWidth = svgWidth - monthlyMargin.left - monthlyMargin.right;
        const monthlyYears = monthlyData.length;
        const monthlyCellHeight = 40;
        const monthlyHeight = monthlyYears * monthlyCellHeight;
        
        // Calculate total SVG height
        const hourlyTotalHeight = hourlyHeight + hourlyMargin.top + hourlyMargin.bottom;
        const monthlyTotalHeight = monthlyHeight + monthlyMargin.top + monthlyMargin.bottom;
        const totalHeight = hourlyTotalHeight + monthlyTotalHeight + 40; // 40px gap between heatmaps
        
        // Create main SVG
        const svg = d3.select('#heatmap-container')
            .append('svg')
            .attr('width', svgWidth)
            .attr('height', totalHeight);
        
        // ========== HOURLY HEATMAP ==========
        const hourlyCellWidth = hourlyWidth / 48;
        const hourlyCellHeight = hourlyHeight / 7;
        
        // Color scale for hourly
        const hourlyColorScale = d3.scaleSequential()
            .domain([0, maxHourlyCount])
            .interpolator(d3.interpolateRgb("#1e3a8a", "#ef4444"));
        
        const hourlyGroup = svg.append('g')
            .attr('transform', 'translate(' + hourlyMargin.left + ',' + hourlyMargin.top + ')');
        
        // Hourly title
        hourlyGroup.append('text')
            .attr('class', 'section-title')
            .attr('x', hourlyWidth / 2)
            .attr('y', -50)
            .attr('text-anchor', 'middle')
            .text('Hourly Activity Pattern (Day of Week × Time)');
        
        // Hourly subtitle
        hourlyGroup.append('text')
            .attr('class', 'subtitle')
            .attr('x', hourlyWidth / 2)
            .attr('y', -30)
            .attr('text-anchor', 'middle')
            .text('(Pacific Time - 30 minute intervals)');
        
        // Create hourly cells
        days.forEach((day, dayIndex) => {
            for (let block = 0; block < 48; block++) {
                const count = hourlyData[dayIndex][block];
                const color = count === 0 ? '#23272A' : hourlyColorScale(count);
                
                hourlyGroup.append('rect')
                    .attr('class', 'cell')
                    .attr('x', block * hourlyCellWidth)
                    .attr('y', dayIndex * hourlyCellHeight)
                    .attr('width', hourlyCellWidth)
                    .attr('height', hourlyCellHeight)
                    .attr('fill', color)
                    .append('title')
                    .text(day + ' ' + blockToTime(block) + ' - ' + count + ' messages');
            }
        });
        
        // Hourly day labels
        hourlyGroup.selectAll('.day-label')
            .data(days)
            .enter()
            .append('text')
            .attr('class', 'day-label')
            .attr('x', -10)
            .attr('y', (d, i) => i * hourlyCellHeight + hourlyCellHeight / 2)
            .attr('dy', '.35em')
            .attr('text-anchor', 'end')
            .text(d => d);
        
        // Hourly hour labels (every 2 hours = every 4 blocks)
        const timeLabels = [];
        for (let block = 0; block < 48; block += 4) {
            timeLabels.push({ block: block, time: blockToTime(block) });
        }
        
        hourlyGroup.selectAll('.hour-label')
            .data(timeLabels)
            .enter()
            .append('text')
            .attr('class', 'hour-label')
            .attr('x', d => d.block * hourlyCellWidth + hourlyCellWidth * 2)
            .attr('y', -10)
            .attr('text-anchor', 'middle')
            .text(d => d.time);
        
        // Hourly legend
        const hourlyLegendWidth = 300;
        const hourlyLegendHeight = 20;
        const hourlyLegendX = hourlyWidth - hourlyLegendWidth - 20;
        const hourlyLegendY = hourlyHeight + 20;
        
        hourlyGroup.append('text')
            .attr('class', 'legend-title')
            .attr('x', hourlyLegendX)
            .attr('y', hourlyLegendY - 10)
            .text('Message Count');
        
        const hourlyDefs = svg.append('defs');
        const hourlyGradient = hourlyDefs.append('linearGradient')
            .attr('id', 'hourly-legend-gradient')
            .attr('x1', '0%')
            .attr('x2', '100%');
        
        hourlyGradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', '#1e3a8a');
        
        hourlyGradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', '#ef4444');
        
        hourlyGroup.append('rect')
            .attr('x', hourlyLegendX)
            .attr('y', hourlyLegendY)
            .attr('width', hourlyLegendWidth)
            .attr('height', hourlyLegendHeight)
            .style('fill', 'url(#hourly-legend-gradient)')
            .style('stroke', '#23272A')
            .style('stroke-width', 2);
        
        hourlyGroup.append('text')
            .attr('class', 'legend-text')
            .attr('x', hourlyLegendX)
            .attr('y', hourlyLegendY + hourlyLegendHeight + 15)
            .attr('text-anchor', 'start')
            .text('0');
        
        hourlyGroup.append('text')
            .attr('class', 'legend-text')
            .attr('x', hourlyLegendX + hourlyLegendWidth)
            .attr('y', hourlyLegendY + hourlyLegendHeight + 15)
            .attr('text-anchor', 'end')
            .text(maxHourlyCount);
        
        // ========== MONTHLY HEATMAP ==========
        if (monthlyData.length > 0) {
            const monthlyYOffset = hourlyTotalHeight + 40;
            
            const monthlyCellWidth = monthlyWidth / 12;
            
            // Color scale for monthly
            const monthlyColorScale = d3.scaleSequential()
                .domain([0, maxMonthlyCount])
                .interpolator(d3.interpolateRgb("#1e3a8a", "#ef4444"));
            
            const monthlyGroup = svg.append('g')
                .attr('transform', 'translate(' + monthlyMargin.left + ',' + (monthlyYOffset + monthlyMargin.top) + ')');
            
            // Monthly title
            monthlyGroup.append('text')
                .attr('class', 'section-title')
                .attr('x', monthlyWidth / 2)
                .attr('y', -50)
                .attr('text-anchor', 'middle')
                .text('Monthly Activity Over Time (Year × Month)');
            
            // Create monthly cells
            monthlyData.forEach((yearData, yearIndex) => {
                for (let month = 0; month < 12; month++) {
                    const count = yearData.data[month];
                    const color = count === 0 ? '#23272A' : monthlyColorScale(count);
                    
                    monthlyGroup.append('rect')
                        .attr('class', 'cell')
                        .attr('x', month * monthlyCellWidth)
                        .attr('y', yearIndex * monthlyCellHeight)
                        .attr('width', monthlyCellWidth)
                        .attr('height', monthlyCellHeight)
                        .attr('fill', color)
                        .append('title')
                        .text(months[month] + ' ' + yearData.year + ' - ' + count + ' messages');
                }
            });
            
            // Year labels
            monthlyGroup.selectAll('.year-label')
                .data(monthlyData)
                .enter()
                .append('text')
                .attr('class', 'year-label')
                .attr('x', -10)
                .attr('y', (d, i) => i * monthlyCellHeight + monthlyCellHeight / 2)
                .attr('dy', '.35em')
                .attr('text-anchor', 'end')
                .text(d => d.year);
            
            // Month labels
            monthlyGroup.selectAll('.month-label')
                .data(months)
                .enter()
                .append('text')
                .attr('class', 'month-label')
                .attr('x', (d, i) => i * monthlyCellWidth + monthlyCellWidth / 2)
                .attr('y', -10)
                .attr('text-anchor', 'middle')
                .text(d => d);
            
            // Monthly legend
            const monthlyLegendWidth = 300;
            const monthlyLegendHeight = 20;
            const monthlyLegendX = monthlyWidth - monthlyLegendWidth - 20;
            const monthlyLegendY = monthlyHeight + 20;
            
            monthlyGroup.append('text')
                .attr('class', 'legend-title')
                .attr('x', monthlyLegendX)
                .attr('y', monthlyLegendY - 10)
                .text('Message Count');
            
            const monthlyGradient = hourlyDefs.append('linearGradient')
                .attr('id', 'monthly-legend-gradient')
                .attr('x1', '0%')
                .attr('x2', '100%');
            
            monthlyGradient.append('stop')
                .attr('offset', '0%')
                .attr('stop-color', '#1e3a8a');
            
            monthlyGradient.append('stop')
                .attr('offset', '100%')
                .attr('stop-color', '#ef4444');
            
            monthlyGroup.append('rect')
                .attr('x', monthlyLegendX)
                .attr('y', monthlyLegendY)
                .attr('width', monthlyLegendWidth)
                .attr('height', monthlyLegendHeight)
                .style('fill', 'url(#monthly-legend-gradient)')
                .style('stroke', '#23272A')
                .style('stroke-width', 2);
            
            monthlyGroup.append('text')
                .attr('class', 'legend-text')
                .attr('x', monthlyLegendX)
                .attr('y', monthlyLegendY + monthlyLegendHeight + 15)
                .attr('text-anchor', 'start')
                .text('0');
            
            monthlyGroup.append('text')
                .attr('class', 'legend-text')
                .attr('x', monthlyLegendX + monthlyLegendWidth)
                .attr('y', monthlyLegendY + monthlyLegendHeight + 15)
                .attr('text-anchor', 'end')
                .text(maxMonthlyCount);
        }
    </script>
</body>
</html>
    `;
}

// Helper functions
function getDayName(dayIndex) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return days[dayIndex];
}

function formatTimeBlock(block) {
    const hour = Math.floor(block / 2);
    const minute = (block % 2) * 30;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute === 0 ? '00' : minute} ${period}`;
}

function getMostActiveDay(data) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayCounts = data.map(dayData => dayData.reduce((sum, count) => sum + count, 0));
    const maxIndex = dayCounts.indexOf(Math.max(...dayCounts));
    return `${days[maxIndex]} (${dayCounts[maxIndex]} messages)`;
}

function getMostActiveBlocks(data) {
    const blockCounts = Array(48).fill(0);

    data.forEach(dayData => {
        dayData.forEach((count, block) => {
            blockCounts[block] += count;
        });
    });

    // Get top 3 time blocks
    const blockIndices = blockCounts
        .map((count, block) => ({ block, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(b => formatTimeBlock(b.block));

    return blockIndices.join(', ');
}
