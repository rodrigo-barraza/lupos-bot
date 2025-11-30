# TO DOS
- Move birthdays to database
- Slash command for adding birthdays
- Slash command for removing birthdays
- Slash command for listing birthdays
- Isolate features to Whitemane
  - Some already are, such as role selection

Needs to grab reacts to add to emoji list
Need to clean up edittedMessageCleanContent and optimize it



# Features
- Image generation based on user prompts
  - Supports:
    - Local Image Generation
    - Google Image Search
- Context-aware responses
- Support for multiple image formats
- Integration with external APIs for enhanced functionality


# TODAY 2025-08-31
- Add cost tracking
- Support multiple-image reading

Whenever two messages are sent to Lupos, and it still hasn't replied to the first one, it will most of the time include a response on the second message, that also includes a response to the first message.
Lupos needs to caption image and create a reaction emoji for message requests, same with voice messages.
Make lupos prefere anyone that has a profile picture of a dog, wolf or any other canine.
Fix lupos saying he's declining to draw, when he actually drew exactly what was asked of lol.

# Whenever a user sends a message
- Save the message to the database

- Save the attachments to the database
- Save the messageSnapshots to the database
- Save the stickers to the database
- Save the reactions to the database


- Save the user to the database
- Save the member to the database
- Save the guild to the database
- Save the channel to the database
- Save the poll to the database


# COLORS
- Replying: purples
- Reactions: reds
- Message send: greens
- Message update: oranges
- Roles: yellows
- Voice channel: blues
- Errors: reds

- POST: greens
- GET: grays
- PUT: blues
- DELETE: reds
- PATCH: oranges

# FIXES
- Compare image URLS for profile and banner before checking hash
- Count user messages in system prompt
- Count user emojis in system prompt
- Count user stickers in system prompt
- Count user reactions in system prompt
- Count user attachments in system prompt
- Count user mentions in system prompt
- Count user links in system prompt
- Count user images in system prompt
- Count user videos in system prompt
- Count user audio in system prompt
- Count user files in system prompt
- Count user polls in system prompt

- Optimize sequential messages

⭐
✅
🛑

ℹ️

💡
❌

⚡
🔋
🪫
🔌

# More things to cache:
URL scraping results
Reactions/Emojis
Stickers


# ANTHROPIC PRICING
- CLAUDE OPUS 4.1		: 		Input: $15, Output: $75, 5x
- CLAUDE SONNET 4		:		Input: $3, Output: $15, 1x
- CLAUDE HAIKU 3.5		:		Input: $0.80, Output: $4, -3.75x

# OPENAI PRICING
- gpt-5					:		  Input: $1.25, Output: $10, Cached: $0.125, 5x
- gpt-5-mini			:		Input: $0.25, Output: $2, Cached: $0.025, 1x 
- gpt-5-nano    :     Input: $0.05, Output: $0.40, Cached: $0.005, -5x
- gpt-4o        :		Input: $2.50, Output: $10, Cached: $1.25, 10x, 5x




    

    // Generate Emoji Word React
    // const emojiWordReact = await AIService.generateSingleWordWithoutRepeatingLetters(message, generatedTextResponse);
    // console.log('emojiWordReact', emojiWordReact);
    // const alphaEmoji = (letter) => String.fromCodePoint(127462 + parseInt(letter, 36) - 10);
    // const emojiWordReactArray = emojiWordReact.split('').map(alphaEmoji);
    // console.log('emojiWordReactArray', emojiWordReactArray);
    // if (emojiWordReactArray.length > 0) {
    //     for (const emoji of emojiWordReactArray) {
    //         try {
    //             await react(emoji);
    //         } catch (error) {
    //             UtilityLibrary.consoleLog('=', `Error reacting with emoji: ${error.message}`);
    //         }
    //     }
    // } else {
    //     UtilityLibrary.consoleLog('=', `No emoji word react generated`);
    // }








# FEATURES
- Generated images that are uploaded to discord have their description added to the metadata, so it can be pulled later, rather than use a separate database.

===

4:03:34 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:03:34 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:03:34 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:03:34 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:03:35 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:03:56 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:03:56 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:04:14 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:04:29 AM - <luposOnGuildMemberUpdate
(Y:\lupos\services\DiscordService.js:1699:20)
Successfully assigned role League of Legends to user 154356494496694272
4:04:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:04:43 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:04:43 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:04:43 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:04:43 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:05:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:05:38 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:06:03 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:06:14 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:06:28 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:06:28 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:06:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:07:38 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:07:47 AM - <luposOnGuildMemberUpdate
(Y:\lupos\services\DiscordService.js:1699:20)
Successfully assigned role Music Enjoyer to user 767779310723137568
4:08:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:08:48 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:08:48 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:08:48 AM - <luposOnMessageUpdate
(Y:\lupos\services\DiscordService.js:1473:20)
4:09:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:10:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:11:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:12:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:13:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:14:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:15:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:16:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:17:38 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:18:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:19:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:20:21 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:20:21 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:20:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:21:04 AM - <luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1466:20)
4:21:04 AM - >luposOnMessageCreate
(Y:\lupos\services\DiscordService.js:1469:20)
4:21:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:22:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:23:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:24:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:25:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:26:37 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
4:27:38 AM -
Unknown Member
DiscordAPIError[10007]: Unknown Member
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async GuildMemberManager._fetchSingle (Y:\lupos\node_modules\discord.js\src\managers\GuildMemberManager.js:222:18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:119:33) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Member', code: 10007 },
  code: 10007,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/guilds/609471635308937237/members/1211781489931452447'
}
Reminder processing already in progress, skipping this interval.
Reminder processing already in progress, skipping this interval.
Reminder processing already in progress, skipping this interval.
node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^

ConnectTimeoutError: Connect Timeout Error (attempted address: discord.com:443, timeout: 10000ms)
    at onConnectTimeout (Y:\lupos\node_modules\undici\lib\core\connect.js:237:24)
    at Immediate._onImmediate (Y:\lupos\node_modules\undici\lib\core\connect.js:188:35)
    at process.processImmediate (node:internal/timers:491:21) {
  code: 'UND_ERR_CONNECT_TIMEOUT'
}

Node.js v22.12.0
(base) PS Y:\lupos>

===

Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748
      throw new DiscordAPIError(data, "code" in data ? data.code : data.error, status, method, url, requestData);
            ^

DiscordAPIError[10008]: Unknown Message
    at handleErrors (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:748:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async SequentialHandler.runRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1149:23)
    at async SequentialHandler.queueRequest (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:980:14)
    at async _REST.request (Y:\lupos\node_modules\@discordjs\rest\dist\index.js:1293:22)
    at async ReactionUserManager.fetch (Y:\lupos\node_modules\discord.js\src\managers\ReactionUserManager.js:47:18)
    at async Y:\lupos\jobs\scheduled\YapperJob.js:59:32
    at async Promise.all (index 0)
    at async Promise.all (index 18)
    at async generateYappers (Y:\lupos\jobs\scheduled\YapperJob.js:54:21) {
  requestBody: { files: undefined, json: undefined },
  rawError: { message: 'Unknown Message', code: 10008 },
  code: 10008,
  status: 404,
  method: 'GET',
  url: 'https://discord.com/api/v10/channels/762734438375096380/messages/1400953357102747738/reactions/%E2%9D%A4%EF%B8%8F?limit=100&type=0'
}

Node.js v22.12.0
(base) PS Y:\lupos> node .\lupos.js

# TO DO (UPDATED)
- Remove moment.js

# Client
# Guild
# Message
    cleanContent*

    client
    channel
    member
    author (user)
    guild

    crosspostable
    createdAt
    createdTimestamp
    stickers
    channelId
    guildId
    mentions
    reactions
    messageSnapshots
    editedAt
    editedTimestamp
    reference
    embeds
    poll
    url
# Channel
  client
  guild

  members
  messages
  url
# User
  client
  primaryGuild?
  dmChannel
  collectibles
# GuildMember
  user
  client
  guild

  dmChannel
  communicationDisabledUntilTimestamp
  premiumSinceTimestamp 

---


# TO DOS
* Remove ability for lupos to get descriptions of users when replying to a message with a user mentioned (ie. Lupos replying to Rodrigo, while tagging @Rodrigo), because it is polluting images attached with the user's avatar and descrpition. Maybe make it so if it has an image attached, do not read off user's mentions.

Whenever someone is replying to a message from Lupos, that has an image attached, ignore the text and only use the image prompt
Sometimes Lupos will mis-tag people: ie. @235195675707441155 vs <@235195675707441155>
Ability to see stickers
When asking to draw someone, put their name in the prompt, not the message author ?
Take response of what the image is, combine it for the response, as currently it doesn't 'see' what it draws
Make Lupos see itself when tagged twice
When replying to Lupos to "try again", generate prompt from the original message Lupos is replying to

ADD TIME PER POST
