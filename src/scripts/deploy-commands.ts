import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { REST, Routes, Client, GatewayIntentBits } from "discord.js";
import secrets from "../config.ts";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { LUPOS_TOKEN } = secrets;

interface DeployableCommand {
  json: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** When set, the command is only registered in these guilds. */
  guildIds?: string[];
}

const commands: DeployableCommand[] = [];
const foldersPath = path.join(import.meta.dirname, "..", "commands");
// Only descend into directories — the folder also holds plain modules (types.js).
const commandFolders = fs
  .readdirSync(foldersPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file: string) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = (await import(pathToFileURL(filePath).href)).default;
    if (!command) {
      console.log(`[WARNING] Skipping ${file} — no default export found.`);
      continue;
    }
    if ("data" in command && "execute" in command) {
      commands.push({ json: command.data.toJSON(), guildIds: command.guildIds });
      if (command.guildIds && command.guildIds.length === 0) {
        console.log(
          `[WARNING] ${file} has an empty guildIds list — it will not be registered anywhere (is its guild env var set?).`,
        );
      }
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

const rest = new REST().setToken(LUPOS_TOKEN as string);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

(async () => {
  try {
    await client.login(LUPOS_TOKEN);

    const clientId = client.user!.id;

    console.log(
      `Started refreshing ${commands.length} application (/) commands.`,
    );

    let successCount = 0;
    for (const guild of client.guilds.cache.values()) {
      // Guild-restricted commands (e.g. owner-only /dm-campaign) are
      // only included in the guilds they name.
      const body = commands
        .filter(
          (command) => !command.guildIds || command.guildIds.includes(guild.id),
        )
        .map((command) => command.json);
      try {
        const data = await rest.put(
          Routes.applicationGuildCommands(clientId, guild.id),
          { body },
        );
        console.log(
          `Successfully deployed ${(data as unknown[]).length} commands to ${guild.name}`,
        );
        successCount++;
      } catch (error: unknown) {
        console.error(`Failed to deploy commands to ${guild.name}:`, error);
      }
    }

    console.log(`Successfully deployed commands to ${successCount} guilds.`);
    client.destroy();
  } catch (error: unknown) {
    console.error(error);
    client.destroy();
  }
})();
