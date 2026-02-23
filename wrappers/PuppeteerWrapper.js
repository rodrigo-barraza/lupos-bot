import 'dotenv/config';
import UtilityLibrary from '#/libraries/UtilityLibrary.js';
const puppeteer = await import(process.platform === "win32" ? "puppeteer" : "puppeteer-core");
// const puppeteer = require('puppeteer-core');
import { executablePath } from 'puppeteer-core';
import xml2js from 'xml2js';
// const AIService = require('../services/AIService.js');
// const LogFormatter = require('../formatters/LogFormatter.js');

let puppeteerOptions = {};

if (process.platform === "win32") {
    puppeteerOptions = { headless: true };
} else {
    puppeteerOptions = { headless: true, executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox'] };
}

const PuppeteerWrapper = {
    async scrapeRSS(url) {
        const browser = await puppeteer.launch(puppeteerOptions);
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
    // async scrapeRSSGoogleNews(message) {
    //     const url = 'https://news.google.com/rss?gl=US&hl=en-US&ceid=US:en';
    //     const browser = await puppeteer.launch({ headless: true, executablePath: executablePath() });
    //     const page = await browser.newPage();
    //     await page.goto(url, { waitUntil: 'networkidle0' });

    //     // Extract XML content from the page
    //     let xmlContent = await page.evaluate(() => document.body.innerText);

    //     await browser.close();

    //     xmlContent = xmlContent.substring(xmlContent.indexOf('<rss'));

    //     xmlContent = xmlContent.replace(/&(?!nbsp;)/g, '&amp;');

    //     // Parse XML content to JSON
    //     const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
    //     const result = await parser.parseStringPromise(xmlContent);

    //     let userMessage = "# Latest News\n";

    //     const items = result.rss.channel.item;
    //     items.forEach((item) => {
    //         const title = item.title;
    //         const pubDate = UtilityLibrary.getCurrentDateAndTime(item.pubDate);
    //         const minutesAgo = UtilityLibrary.getMinutesAgo(item.pubDate);
    //         const link = item.link;
    //         const description = item.description || '';

    //         userMessage += `## Title: ${title}\n`;
    //         userMessage += `- Date: ${pubDate}\n`;
    //         userMessage += `- Minutes ago: ${minutesAgo}\n`;
    //         userMessage += `- Link: ${link}\n`
    //         userMessage += `- Description: ${description}\n`;
    //     });

    //     userMessage += `If any, return the most related news to this: ${message.content}`;

    //     const systemMessage = `#Task:\n-You return the most related news, and summarize the description without adding more information.\n-If there is no related news, return an empty string.\n\n#Output Format:
    //     -## Title: [Title]
    //     -Date: [Date]
    //     -Minutes ago: [Minutes]
    //     -Link: [Link]
    //     -Description: [Description]`;

    //     const conversation = await AIService.rawGenerateConversation(systemMessage, userMessage, message)

    //     await AIService.rawGenerateText({conversation, type: 'OPENAI', performance: 'FAST'})

    //     return userMessage;
    // },
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
        const functionName = 'scrapeURL';
        if (url.includes('aveda.com')) {
            // ignore
            return {};
        }
        async function isImageURL(url) {
            const res = await fetch(url, { method: 'HEAD' });
            const type = res.headers.get('content-type');
            return type && type.startsWith('image/');
        }

        const isImage = await isImageURL(url);
        if (isImage) {
            return {};
        }

        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        await page.goto(url);

        const selectors = [
            { selector: 'head title', property: 'title', attribute: null },
            { selector: 'p', property: 'text', attribute: null },
            { selector: 'h1', property: 'header', attribute: null },
            { selector: 'meta[name="description"]', property: 'description', attribute: 'content' },
            { selector: 'meta[name="keywords"]', property: 'keywords', attribute: 'content' },
            { selector: 'meta[property="og:image"]', property: 'image', attribute: 'content' },
        ];

        const result = {};
        const youtubeWatchRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

        if (youtubeWatchRegex.test(url)) {
            // Video description
            selectors.push({ selector: 'div[id="description"] span', property: 'description', attribute: null });
            // Related videos
            selectors.push({ selector: 'div[id="secondary"] a h3', property: 'relatedVideos', attribute: null });

            try {
                const descriptionElement = await page.waitForSelector('div[id="description"]', { timeout: 5000 });
                if (descriptionElement) {
                    await page.evaluate(() => document.querySelector('div[id="description"]').click());
                    await page.waitForSelector('button[aria-label="Show transcript"]', { timeout: 5000 });
                    const showTranscriptButton = await page.$('button[aria-label="Show transcript"]');
                    if (showTranscriptButton) {
                        await page.evaluate(() => document.querySelector('button[aria-label="Show transcript"]').click());
                        await page.waitForSelector('ytd-transcript-segment-renderer', { timeout: 5000 });

                        const transcriptData = await page.evaluate(() => {
                            const transcriptElement = document.querySelector('div[id="panels"]');
                            const transcriptSegments = Array.from(transcriptElement.querySelectorAll('ytd-transcript-segment-renderer'));
                            return transcriptSegments.map(segment => {
                                const timestamp = segment.querySelector('div[class="segment-timestamp style-scope ytd-transcript-segment-renderer"]').innerText;
                                const innerText = segment.querySelector('yt-formatted-string').innerText;
                                return { timestamp, innerText };
                            });
                        });

                        const transcript = transcriptData.map(entry => `${entry.timestamp}: ${entry.innerText}\n`).join('');
                        if (transcript.trim()) {
                            result.transcript = transcript;
                        }
                    }
                }
            } catch (error) {
                console.error('YouTube transcript extraction error:', error);
            }
        }

        await Promise.all(
            selectors.map(async ({ selector, property, attribute }) => {
                try {
                    const elementExists = await page.$(selector);
                    if (!elementExists) return;

                    const value = await page.evaluate((s, attr) => {
                        const elements = Array.from(document.querySelectorAll(s));
                        return elements.map(element => {
                            if (!element) return null;
                            // If attribute is specified, get that attribute (for meta tags)
                            if (attr) {
                                return element.getAttribute(attr);
                            }
                            // Otherwise, get innerText
                            return element.innerText;
                        });
                    }, selector, attribute);

                    // Filter out null, undefined, and empty strings
                    const filteredValue = value.filter(v => v !== null && v !== undefined && v.trim() !== '');

                    // Only add to result if there are actual values
                    if (filteredValue.length > 0) {
                        // If it's a single value, don't use an array
                        result[property] = filteredValue.length === 1 ? filteredValue[0] : filteredValue;
                    }
                } catch (error) {
                    console.error(`Puppeteer Error on ${selector}:\n`, error);
                }
            })
        );

        await browser.close();
        // console.log(...LogFormatter.scrapeSuccess({functionName, url, result}));
        return result;
    },
    async scrapeURL2(url) {
        async function isImageURL(url) {
            const res = await fetch(url, { method: 'HEAD' });
            const type = res.headers.get('content-type');
            return type && type.startsWith('image/');
        }

        const isImage = await isImageURL(url);
        if (isImage) return {};

        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

        const selectors = [
            { selector: 'head title', property: 'title' },
            { selector: 'p', property: 'text' },
            { selector: 'h1', property: 'header' },
            { selector: 'meta[name="description"]', property: 'description' },
            { selector: 'meta[name="keywords"]', property: 'keywords' },
            { selector: 'meta[property="og:image"]', property: 'image' },
        ];

        const youtubeWatchRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const result = {};

        if (youtubeWatchRegex.test(url)) {
            selectors.push(
                { selector: 'div#below div#description yt-formatted-string', property: 'description' },
                { selector: 'ytd-compact-video-renderer a#video-title', property: 'relatedVideos' }
            );

            const expandDescriptionSelector = 'tp-yt-paper-button#expand';
            try {
                await page.waitForSelector(expandDescriptionSelector, { timeout: 5000 });
                await page.click(expandDescriptionSelector);
            } catch { }

            const showTranscriptSelector = 'button[aria-label="Show transcript"]';
            try {
                await page.waitForSelector(showTranscriptSelector, { timeout: 5000 });
                await page.click(showTranscriptSelector);
                await page.waitForSelector('ytd-transcript-segment-renderer', { timeout: 5000 });

                const transcriptData = await page.evaluate(() => {
                    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
                    return segments.map(s => {
                        const timestamp = s.querySelector('.segment-timestamp')?.innerText;
                        const text = s.querySelector('yt-formatted-string')?.innerText;
                        return `${timestamp}: ${text}`;
                    });
                });
                result.transcript = transcriptData.join('\n');
            } catch { }
        }

        await Promise.all(
            selectors.map(async ({ selector, property }) => {
                const elements = await page.$$(selector);
                if (!elements.length) return;
                const values = await Promise.all(elements.map(async el => {
                    if (selector.startsWith('meta')) {
                        return await el.evaluate(node => node.getAttribute('content'));
                    } else {
                        return await el.evaluate(node => node.innerText);
                    }
                }));
                result[property] = values.filter(v => v && v.trim());
            })
        );

        await browser.close();
        return result;
    },
    async scrapeTenor(url) {
        let browser;
        try {
            // consoleInfo('<', 'scrapeTenor');
            // consoleInfo('=', 'scrapeTenor', url);
            browser = await puppeteer.launch(puppeteerOptions);
            const page = await browser.newPage();
            // Set user agent to avoid bot detection
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            // Set viewport
            await page.setViewport({ width: 1920, height: 1080 });
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
            // consoleInfo('=', 'scrapeTenor', result);
            // consoleInfo('>', 'scrapeTenor');
            return result;
        } catch (error) {
            console.error('Puppeteer Error:\n', error);
            return {};
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    },
    async scrapeTwitchUrl(url) {
        const functionName = 'scrapeTwitchUrl';
        try {
            const browser = await puppeteer.launch(puppeteerOptions);
            const page = await browser.newPage();
            await page.goto(url, {
                timeout: 15000,  // 15 seconds timeout
                waitUntil: 'domcontentloaded'  // Less strict than 'load' or 'networkidle0'
            });

            const selectors = [
                { selector: 'title', property: 'title' },
                { selector: 'meta[name="description"]', property: 'description' },
                { selector: 'meta[name="og:description"]', property: 'description' },
                { selector: 'meta[name="twitter:description"]', property: 'description' },
                { selector: 'meta[property="og:image"]', property: 'image' },
                { selector: 'meta[property="og:video"]', property: 'video' },
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
                            // console.log(`⚡ [PuppeteerWrapper:scrapeTwitchUrl] Scraped property ${property} for selector ${selector} for URL: ${url} with value:`, result[property]);
                        }
                    } catch (error) {
                        // console.warn(`❌ [PuppeteerWrapper:scrapeTwitchUrl] Error scraping selector: ${selector} for URL: ${url}`);
                    }
                })
            );

            await browser.close();
            // console.log(...LogFormatter.scrapeSuccess({functionName, url, result}));
            return result;
        } catch (error) {
            console.error('Puppeteer Error:\n', error);
            return {};
        }
    },
    async scrapeGoogleAlerts(searchText) {
        let result;
        const browser = await puppeteer.launch(puppeteerOptions);
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
        // UtilityLibrary.consoleInfoColor([[`║ 📰 News: `, { }], [result, { }]]);
        return result;
    },
};

export default PuppeteerWrapper;