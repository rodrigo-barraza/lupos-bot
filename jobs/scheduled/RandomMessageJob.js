import config from '#/config.json' with { type: 'json' };
import { consoleInfo, consoleLog } from '#/libraries/UtilityLibrary.js';
import YapperService from '#/services/YapperService.js';
import UtilityLibrary from '#/libraries/UtilityLibrary.js';
import DiscordUtilityService from '#/services/DiscordUtilityService.js';
import luxon from 'luxon';
import AIService from '#/services/AIService.js';



const MIN_DELAY_HOURS = 16;
const MAX_DELAY_HOURS = 32;
const MIN_DELAY_MS = MIN_DELAY_HOURS * 60 * 60 * 1000;
const MAX_DELAY_MS = MAX_DELAY_HOURS * 60 * 60 * 1000;

const MIN_DELAY_MINUTES2 = 0;
const MAX_DELAY_MINUTES2 = 1;
const MIN_DELAY_MS2 = MIN_DELAY_MINUTES2 * 1000;
const MAX_DELAY_MS2 = MAX_DELAY_MINUTES2 * 1000;

// Function to calculate the next random delay
function getRandomDelay() {
    // Calculate random delay within the range [MIN_DELAY_MS, MAX_DELAY_MS]
    return Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS;
}

function getRandomDelay2() {
    return Math.random() * (MAX_DELAY_MS2 - MIN_DELAY_MS2) + MIN_DELAY_MS2;
}

async function sendRandomMessageTimeout(client) {
    consoleLog('<');
    async function sendRandomMessage() {
        consoleLog('<')
        const channelId = '1363708222992547880';
        // const channelId = '762734438375096380';
        const channel = DiscordUtilityService.getChannelById(client, channelId);
        let sendTypingInterval = null;

        try {

            if (!channel) {
                consoleLog('=', `Channel ${channelId} not found.`);
            } else {
                let fetchRecentMessages = (await DiscordUtilityService.fetchMessages(
                    client,
                    channelId,
                    { limit: 100 }
                )).reverse();
                let recentMessages = fetchRecentMessages.map((msg) => msg);
                let lastMessage = recentMessages[recentMessages.length - 1];
                let imageToGenerate = lastMessage.content;
                if (lastMessage.author.id !== client.user.id) {
                    consoleLog('=', `Sending reminder message to channel: ${channel.id}...`);
                    sendTypingInterval = await DiscordUtilityService.startTypingInterval(channel);

                    const {
                        generatedText, imagePrompt, modifiedMessage, systemPrompt, imageUrl
                    } = await AIService.generateNewTextResponse(
                        client, lastMessage, recentMessages
                    );

                    const { image, text } = await AIService.generateImageAndResponse(
                        lastMessage,
                        imagePrompt,
                        generatedText,
                        imageToGenerate,
                        imageUrl,
                        client,
                        recentMessages,
                        modifiedMessage,
                        systemPrompt
                    );
                    await DiscordUtilityService.sendMessageInChunks('send', lastMessage, text, image);
                    consoleLog('=', `Reminder message sent to channel: ${channel.id}`);
                } else {
                    consoleLog('=', `Last message was sent by the bot, skipping...`);
                }
            }
        } catch (error) {
            consoleLog('=', `Error: ${error}`);
        } finally {
            DiscordUtilityService.clearTypingInterval(sendTypingInterval);
            const nextDelay = getRandomDelay();
            const nextRunDate = new Date(Date.now() + nextDelay);
            consoleLog('=', `Next reminder scheduled in ${(nextDelay / (60 * 60 * 1000)).toFixed(2)} hours (at ${nextRunDate.toLocaleString()})`);
            setTimeout(sendRandomMessage, nextDelay);
        }
        consoleLog('>');
    }

    const firstDelay = getRandomDelay2();
    consoleLog('=', `First reminder scheduled in ${(firstDelay / (60 * 1000)).toFixed(2)} minutes`);
    consoleLog('>');
    setTimeout(sendRandomMessage, firstDelay);

}

const RandomMessageJob = {
    async startJob(client) {
        await sendRandomMessageTimeout(client);
    }
};

export default RandomMessageJob;