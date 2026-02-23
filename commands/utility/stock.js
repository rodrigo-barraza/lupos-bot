import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('Look up stock market information for a symbol')
        .addStringOption(option =>
            option.setName('symbol')
                .setDescription('Stock ticker symbol (e.g., AAPL, TSLA, MSFT)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('range')
                .setDescription('Time range for statistics')
                .setRequired(false)
                .addChoices(
                    { name: '1 Day', value: '1d' },
                    { name: '5 Days', value: '5d' },
                    { name: '1 Month', value: '1mo' },
                    { name: '3 Months', value: '3mo' },
                    { name: '1 Year', value: '1y' }
                )),
    
    async execute(interaction) {
        await interaction.deferReply();

        const symbol = interaction.options.getString('symbol').toUpperCase();
        const range = interaction.options.getString('range') || '1d';

        try {
            // Fetch stock data from Yahoo Finance API
            const response = await fetch(
                `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch stock data');
            }

            const data = await response.json();
            
            if (data.chart.error) {
                await interaction.editReply({ 
                    content: `❌ Error: ${data.chart.error.description}` 
                });
                return;
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            const quote = result.indicators.quote[0];

            // Get current and previous prices
            const currentPrice = meta.regularMarketPrice;
            const previousClose = meta.chartPreviousClose;
            const priceChange = currentPrice - previousClose;
            const percentChange = (priceChange / previousClose) * 100;

            // Get high/low for the range
            const prices = quote.close.filter(p => p !== null);
            const high = Math.max(...prices);
            const low = Math.min(...prices);

            // Determine color based on price change
            const embedColor = priceChange >= 0 ? 0x00FF00 : 0xFF0000;
            const changeEmoji = priceChange >= 0 ? '📈' : '📉';

            // Format currency
            const currency = meta.currency || 'USD';
            const formatPrice = (price) => `${currency} ${price.toFixed(2)}`;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`${changeEmoji} ${meta.symbol} - ${meta.longName || meta.shortName}`)
                .setDescription(`**${formatPrice(currentPrice)}**`)
                .setColor(embedColor)
                .setTimestamp()
                .setFooter({ text: `Data from Yahoo Finance • ${getRangeName(range)}` });

            // Add price change field
            const changeSign = priceChange >= 0 ? '+' : '';
            embed.addFields({
                name: 'Change',
                value: `${changeSign}${formatPrice(priceChange)} (${changeSign}${percentChange.toFixed(2)}%)`,
                inline: true
            });

            // Add market status
            const marketState = meta.marketState;
            const marketEmoji = marketState === 'REGULAR' ? '🟢' : '🔴';
            embed.addFields({
                name: 'Market Status',
                value: `${marketEmoji} ${formatMarketState(marketState)}`,
                inline: true
            });

            // Add volume if available
            if (meta.regularMarketVolume) {
                embed.addFields({
                    name: 'Volume',
                    value: formatVolume(meta.regularMarketVolume),
                    inline: true
                });
            }

            // Add range statistics
            embed.addFields({
                name: `${getRangeName(range)} High`,
                value: formatPrice(high),
                inline: true
            },
            {
                name: `${getRangeName(range)} Low`,
                value: formatPrice(low),
                inline: true
            },
            {
                name: 'Previous Close',
                value: formatPrice(previousClose),
                inline: true
            });

            // Add market cap if available
            if (meta.marketCap) {
                embed.addFields({
                    name: 'Market Cap',
                    value: formatMarketCap(meta.marketCap),
                    inline: true
                });
            }

            // Add exchange
            if (meta.exchangeName) {
                embed.addFields({
                    name: 'Exchange',
                    value: meta.exchangeName,
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching stock data:', error);
            await interaction.editReply({ 
                content: `❌ Could not find stock data for symbol **${symbol}**. Please check the symbol and try again.`
            });
        }
    }
};

// Helper function to get range display name
function getRangeName(range) {
    const rangeNames = {
        '1d': '1 Day',
        '5d': '5 Days',
        '1mo': '1 Month',
        '3mo': '3 Months',
        '1y': '1 Year'
    };
    return rangeNames[range] || range;
}

// Helper function to format market state
function formatMarketState(state) {
    const stateNames = {
        'REGULAR': 'Open',
        'PRE': 'Pre-Market',
        'POST': 'After-Hours',
        'CLOSED': 'Closed'
    };
    return stateNames[state] || state;
}

// Helper function to format volume
function formatVolume(volume) {
    if (volume >= 1e9) {
        return (volume / 1e9).toFixed(2) + 'B';
    } else if (volume >= 1e6) {
        return (volume / 1e6).toFixed(2) + 'M';
    } else if (volume >= 1e3) {
        return (volume / 1e3).toFixed(2) + 'K';
    }
    return volume.toString();
}

// Helper function to format market cap
function formatMarketCap(marketCap) {
    if (marketCap >= 1e12) {
        return '$' + (marketCap / 1e12).toFixed(2) + 'T';
    } else if (marketCap >= 1e9) {
        return '$' + (marketCap / 1e9).toFixed(2) + 'B';
    } else if (marketCap >= 1e6) {
        return '$' + (marketCap / 1e6).toFixed(2) + 'M';
    }
    return '$' + marketCap.toString();
}
