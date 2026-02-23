import 'dotenv/config';
import UtilityLibrary from '#root/libraries/UtilityLibrary.js';
import puppeteer from 'puppeteer-core';
import xml2js from 'xml2js';
import AIService from '#root/services/AIService.js';

const PuppeteerWrapper = {
    async scrapeRSS(url) {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        let xmlContent = await page.evaluate(() => document.body.innerText);

        await browser.close();

        xmlContent = xmlContent.substring(xmlContent.indexOf('<rss'));
        xmlContent = xmlContent.replace(/&(?!nbsp;)/g, '&amp;');

        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(xmlContent);
        const items = result.rss.channel.item;
        return items;
    },
    async scrapeRSSGoogleNews(message) {
        const url = 'https://news.google.com/rss?gl=US&hl=en-US&ceid=US:en';
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        // Extract XML content from the page
        let xmlContent = await page.evaluate(() => document.body.innerText);

        await browser.close();

        xmlContent = xmlContent.substring(xmlContent.indexOf('<rss'));

        xmlContent = xmlContent.replace(/&(?!nbsp;)/g, '&amp;');

        // Parse XML content to JSON
        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(xmlContent);

        let userMessage = "# Latest News\n";

        const items = result.rss.channel.item;
        items.forEach((item) => {
            const title = item.title;
            const pubDate = UtilityLibrary.getCurrentDateAndTime(item.pubDate);
            const minutesAgo = UtilityLibrary.getMinutesAgo(item.pubDate);
            const link = item.link;
            const description = item.description || '';

            userMessage += `## Title: ${title}\n`;
            userMessage += `- Date: ${pubDate}\n`;
            userMessage += `- Minutes ago: ${minutesAgo}\n`;
            userMessage += `- Link: ${link}\n`
            userMessage += `- Description: ${description}\n`;
        });

        userMessage += `If any, return the most related news to this: ${message.content}`;

        const systemMessage = `#Task:\n-You return the most related news, and summarize the description without adding more information.\n-If there is no related news, return an empty string.\n\n#Output Format:
        -## Title: [Title]
        -Date: [Date]
        -Minutes ago: [Minutes]
        -Link: [Link]
        -Description: [Description]`;

        const conversation = AIService.rawGenerateConversation(systemMessage, userMessage, message)

        AIService.rawGenerateText({ conversation, type: 'OPENAI', performance: 'FAST' })

        return userMessage;
    },
    async scrapeRSSGoogleTrends() {
        const url = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        // Extract XML content from the page
        let xmlContent = await page.evaluate(() => document.body.innerText);

        await browser.close();

        xmlContent = xmlContent.substring(xmlContent.indexOf('<rss'));

        // Parse XML content to JSON
        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(xmlContent);

        let output = "# Currently Trending\n";

        const items = result.rss.channel.item;
        items.forEach((item) => {
            const title = item.title;
            const description = item.description || 'No description';
            const pubDate = item.pubDate;

            output += `## Title: ${title}\n`;
            output += `- Description: ${description}\n`;
            output += `- Date: ${pubDate}\n`;
            output += `### Recent News\n`;

            const newsItems = Array.isArray(item['ht:news_item']) ? item['ht:news_item'] : [item['ht:news_item']];
            newsItems.forEach((newsItem) => {
                const newsItemTitle = newsItem['ht:news_item_title'];
                const newsItemSnippet = newsItem['ht:news_item_snippet'];
                const newsItemUrl = newsItem['ht:news_item_url'];
                const newsItemSource = newsItem['ht:news_item_source'];

                output += `- Title: ${newsItemTitle}\n`;
                output += `- Snippet: ${newsItemSnippet}\n`;
                output += `- URL: ${newsItemUrl}\n`;
                output += `- Source: ${newsItemSource}\n\n`;
            });
        });

        return output;
    },
    async scrapeURL(url) {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url);

        const selectors = [
            { selector: 'title', property: 'title' },
            { selector: 'meta[name="description"]', property: 'description' },
            { selector: 'meta[name="keywords"]', property: 'keywords' },
            { selector: 'meta[property="og:image"]', property: 'image' },
        ];

        const result = {};

        await Promise.all(
            selectors.map(async ({ selector, property }) => {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });

                    const value = await page.evaluate((s, p) => {
                        const element = document.querySelector(s);
                        return element ? element[p] || element.getAttribute('content') : null;
                    }, selector, property);

                    if (value) {
                        result[property] = value.trim();
                    }
                } catch (error) {
                    console.error(`Puppeteer Error on ${selector}:\n`, error);
                }
            })
        );

        await browser.close();
        // UtilityLibrary.consoleInfo([[`║ 🌐 Scraping URL: `, { }], [result, { }]]);
        return result;
    },
    async scrapeTenor(url) {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url);

        const selectors = [
            { selector: 'title', property: 'title' },
            { selector: 'meta[itemprop="contentUrl"]', property: 'image' },
            { selector: 'meta[itemprop="keywords"]', property: 'keywords' },
        ];

        const result = {};

        await Promise.all(
            selectors.map(async ({ selector, property }) => {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });

                    const value = await page.evaluate((s, p) => {
                        const element = document.querySelector(s);
                        return element ? element[p] || element.getAttribute('content') : null;
                    }, selector, property);

                    if (value) {
                        result[property] = value.trim();
                    }
                } catch (error) {
                    console.error(`Puppeteer Error on ${selector}:\n`, error);
                }
            })
        );

        result.name = url.replace('https://tenor.com/view/', '').replace(/-/g, ' ').replace(/%20/g, ' ');

        await browser.close();
        // UtilityLibrary.consoleInfo([[`║ 🌐 Scraping Tenor URL: `, { }], [result, { }]]);
        return result;
    },
    async scrapeGoogleAlerts(searchText) {
        let result;
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('https://www.google.com/alerts');

        try {
            await page.type('input[type="text"]', searchText);
            await page.waitForSelector('li.result');


            result = await page.evaluate(() => {
                const noRecentResults = document.querySelector('.preview_timerange_extended');
                if (!noRecentResults) {
                    const firstResultSet = document.querySelector('#preview_results .result_set');
                    if (!firstResultSet) return [];
                    const listItems = firstResultSet.querySelectorAll('li.result');
                    return Array.from(listItems, element => {
                        const title = element.querySelector('h4 a').textContent.trim();
                        const description = element.querySelector('div span').textContent.trim();
                        const url = element.querySelector('h4 a').getAttribute('href');
                        return { title, description, url };
                    });
                }
            });

        } catch (error) {
            console.error('Puppeteer Error:\n', error);
            result = null;
        }

        await browser.close();
        // UtilityLibrary.consoleInfo([[`║ 📰 News: `, { }], [result, { }]]);
        return result;
    },
};

export default PuppeteerWrapper;