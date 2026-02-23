import { REST, Routes, Client, GatewayIntentBits } from 'discord.js';
import config from './config.json' with { type: 'json' };
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';

const { CLIENT_ID, LUPOS_TOKEN } = config;

const commands = [];
const foldersPath = path.join(import.meta.dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = (await import(pathToFileURL(filePath))).default;
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const rest = new REST().setToken(LUPOS_TOKEN);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

(async () => {
    try {
        await client.login(LUPOS_TOKEN);

        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // Option 1: Deploy to ALL guilds (recommended for multi-server bots)
        let successCount = 0;
        for (const guild of client.guilds.cache.values()) {
            try {
                // This REPLACES all commands in the guild
                const data = await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, guild.id),
                    { body: commands },
                );
                console.log(`Successfully deployed ${data.length} commands to ${guild.name}`);
                successCount++;
            } catch (error) {
                console.error(`Failed to deploy commands to ${guild.name}:`, error);
            }
        }

        // Option 2: Deploy globally (takes up to 1 hour to propagate)
        // Uncomment this if you want global commands instead
        /*
        const data = await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log(`Successfully deployed ${data.length} global commands.`);
        */

        console.log(`Successfully deployed commands to ${successCount} guilds.`);
        client.destroy();
    } catch (error) {
        console.error(error);
        client.destroy();
    }
})();