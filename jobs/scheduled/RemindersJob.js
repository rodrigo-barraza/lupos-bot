import DiscordUtilityService from '#services/DiscordUtilityService.js';
import config from '#config.json' with { type: 'json' };
import { consoleInfo } from '#libraries/UtilityLibrary.js';
import YapperService from '#services/YapperService.js';
import UtilityLibrary from '#libraries/UtilityLibrary.js';
import AIService from '#services/AIService.js';
import luxon from 'luxon';

let isProcessingReminders = false;

async function processReminders(client, mongo) {
    // Prevent overlap if the previous run took longer than 1 second
    if (isProcessingReminders) {
        console.log('Reminder processing already in progress, skipping this interval.');
        return;
    }
    isProcessingReminders = true;

    try {
        const db = mongo.db("lupos");
        const collection = db.collection('Reminders');
        const now = luxon.DateTime.now().plus({ seconds: 30 });
        const nowISO = now.toISO(); // Get the current time in ISO format

        // eslint-disable-next-line no-constant-condition
        while (true) { // Loop to process all due reminders one by one
            // Atomically find and delete one due reminder
            const userReminder = await collection.findOneAndDelete({
                reminderAt: { $lte: nowISO } // Filter for due reminders in the query
            });

            // If no due reminder was found and deleted, break the loop
            if (!userReminder) {
                break;
            }

            // --- Process the found reminder ---
            // Use try...finally to ensure cleanup (like clearing intervals)
            let sendTypingInterval = null;
            const channel = DiscordUtilityService.getChannelById(client, userReminder.channelId);

            try {
                if (!channel) {
                    console.log(`Channel ${userReminder.channelId} not found for reminder ${userReminder._id}`);
                    continue; // Skip to the next reminder if channel is invalid
                }

                const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);
                if (!guild) {
                    console.log(`Guild ${config.GUILD_ID_PRIMARY} not found.`);
                    continue; // Cannot proceed without the guild
                }
                const member = guild.members.cache.get(userReminder.userId);

                if (member) {
                    sendTypingInterval = await DiscordUtilityService.startTypingInterval(channel);

                    // Generate and send the message
                    const response = await AIService.generateReminderTextReminderResponse(userReminder.message);
                    const generatedImage = await AIService.generateImage(userReminder.message);
                    const attachment = Buffer.from(generatedImage, 'base64');
                    const fileName = `reminder-${userReminder._id}.png`;
                    const originalMessage = await channel.messages.fetch(userReminder.messageId);
                    await originalMessage.reply({ content: response, files: [{ attachment, name: fileName }] });
                    // await channel.send(`⏰ Reminder: ${userReminder.message}`); // Keep original if preferred

                    // UtilityLibrary.consoleInfoColor([[`⏰ Reminder Sent: ${userReminder.message}`, { color: 'green' }, 'middle']]);
                } else {
                    console.log(`Member ${userReminder.userId} not found in guild for reminder ${userReminder._id}`);
                }

            } catch (error) {
                console.log(`Error processing reminder ${userReminder._id}:`, error);
            } finally {
                // Ensure typing indicator is stopped
                if (sendTypingInterval) {
                    DiscordUtilityService.clearTypingInterval(sendTypingInterval);
                }
            }
            // --- End processing the found reminder ---
        } // End while loop

    } catch (error) {
        console.log('Error in reminder interval:', error);
    } finally {
        isProcessingReminders = false; // Allow the next interval to run
    }
}

const RemindersJob = {
    async startJob(client, mongo) {
        await processReminders(client, mongo);
        setInterval(() => {
            processReminders(client, mongo);
        }, 1000 * 5); // every 5 seconds
    }
};

export default RemindersJob;