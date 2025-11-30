const { REST, Routes, Client, GatewayIntentBits } = require('discord.js');
const { CLIENT_ID, LUPOS_TOKEN } = require('./config.json');
require('dotenv/config');

const rest = new REST().setToken(LUPOS_TOKEN);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

(async () => {
    try {
        await client.login(LUPOS_TOKEN);
        
        console.log('Starting command cleanup...');
        
        // Clear global commands
        try {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
            console.log('Successfully cleared global commands.');
        } catch (error) {
            console.error('Failed to clear global commands:', error);
        }
        
        // Clear guild-specific commands
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, guild.id),
                    { body: [] }
                );
                console.log(`Successfully cleared commands in ${guild.name}`);
            } catch (error) {
                console.error(`Failed to clear commands in ${guild.name}:`, error);
            }
        }
        
        console.log('Command cleanup complete!');
        client.destroy();
    } catch (error) {
        console.error(error);
    }
})();
