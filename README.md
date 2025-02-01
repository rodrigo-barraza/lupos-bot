# lupos

# TO DOS
Whenever someone is replying to a message from Lupos, that has an image attached, ignore the text and only use the image prompt
Sometimes Lupos will mis-tag people: ie. @235195675707441155 vs <@235195675707441155>
Ability to see stickers
When asking to draw someone, put their name in the prompt, not the message author ?
Take response of what the image is, combine it for the response, as currently it doesn't 'see' what it draws
Make Lupos see itself when tagged twice
When replying to Lupos to "try again", generate prompt from the original message Lupos is replying to

ADD TIME PER POST

# Bugs to fix
Replying to a message that has mentions isn't working currently ?
Replying to a user without a profile image breaks
Reply to user and include their banner image if they have one


Remove the word "draw" or replace with imagine

##### installation
```bash
npm install
```

Create a .env file in the root directory and add the following:
```bash
OPENAI_KEY=
TOKEN=
SALLY_WHITEMANE_TOKEN=
CHANNEL_ID_THE_CLAM_BOT_PLAYGROUND=
GUILD_ID_THE_CLAM=
```




ine ││ lupos >     at async _REST.request (/develop/lupos/node_modules/@discordjs/rest/dist/index.js:1272:22)                                                                        │
│                                                                          ││ lupos >     at async ReactionUserManager.fetch (/develop/lupos/node_modules/discord.js/src/managers/ReactionUserManager.js:47:18)           2                                 │
│                                                                          ││ lupos >     at async Promise.all (index 0)                                                                                                                                    │
│                                                                          ││ lupos >     at async Promise.all (index 62)                                                                                                                                   │
│                                                                          ││ lupos >     at async generateOverReactors (/develop/lupos/lupos.js:82:25)                                                                                                     │
│                                                                          ││ lupos >     at async autoAssignRoles (/develop/lupos/lupos.js:187:9) {                                                                                                        │
│                                                                          ││ lupos >   requestBody: { files: undefined, json: undefined },                                                                                                                 │
│                                                                          ││ lupos >   rawError: { message: 'Unknown Message', code: 10008 },                                                                                                              │
│                                                                          ││ lupos >   code: 10008,                                                                                                                                                        │
│                                                                          ││ lupos >   status: 404,                                                                                                                                                        │
│                                                                          ││ lupos >   method: 'GET',                                                                                                                                                      │
│                                                                          ││ lupos >   url: 'https://discord.com/api/v10/channels/762734438375096380/messages/1308148461572718694/reactions/%F0%9F%98%AD?limit=100&type=0'                                 │
│                                                                          ││ lupos > }                                                                                                                                                                     │
│                                                                          ││ lupos > Error in processing: DiscordAPIError[10008]: Unknown Message                                                                                                          │
│                                                                          ││ lupos >     at handleErrors (/develop/lupos/node_modules/@discordjs/rest/dist/index.js:727:13)                                                                                │
│                                                                          ││ lupos >     at process.processTicksAndRejections (node:internal/process/task_queues:95:5)                                                                                     │
│                                                                          ││ lupos >     at async SequentialHandler.runRequest (/develop/lupos/node_modules/@discordjs/rest/dist/index.js:1128:23)                                                         │
│                                                                          ││ lupos >     at async SequentialHandler.queueRequest (/develop/lupos/node_modules/@discordjs/rest/dist/index.js:959:14)                                                        │
│                                                                          ││ lupos >     at async _REST.request (/develop/lupos/node_modules/@discordjs/rest/dist/index.js:1272:22)                                                                        │
│                                                                          ││ lupos >     at async ReactionUserManager.fetch (/develop/lupos/node_modules/discord.js/src/managers/ReactionUserManager.js:47:18)           2                                 │
│                                                                          ││ lupos >     at async Promise.all (index 0)                                                                                                                                    │
│                                                                          ││ lupos >     at async Promise.all (index 63)                                                                                                                                   │
│                                                                          ││ lupos >     at async generateOverReactors (/develop/lupos/lupos.js:82:25)                                                                                                     │
│                                                                          ││ lupos >     at async autoAssignRoles (/develop/lupos/lupos.js:187:9) {                                                                                                        │
│                                                                          ││ lupos >   requestBody: { files: undefined, json: undefined },                                                                                                                 │
│                                                                          ││ lupos >   rawError: { message: 'Unknown Message', code: 10008 },                                                                                                              │
│                                                                          ││ lupos >   code: 10008,                                                                                                                                                        │
│                                                                          ││ lupos >   status: 404,                                                                                                                                                        │
│                                                                          ││ lupos >   method: 'GET',                                                                                                                                                      │
│                                                                          ││ lupos >   url: 'https://discord.com/api/v10/channels/762734438375096380/messages/1308148461572718694/reactions/%F0%9F%98%AD?limit=100&type=0'                                 │
│                                                                          ││ lupos > }    