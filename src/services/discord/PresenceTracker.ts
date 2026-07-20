// ============================================================
// PresenceTracker — Presence Update & Streaming Notifications
// ============================================================
// Handles Discord `presenceUpdate` events to:
// 1. Track game activity in MongoDB
// 2. Auto-assign game roles based on activity name
// 3. Post streaming notifications for Twitch in #streamers
// ============================================================

import type { Client, Presence, TextChannel } from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import config from "#root/config.ts";
import { GAME_ROLE_MAPPINGS, MONGO_DB_NAME } from "#root/constants.ts";
import { rolesVideogames } from "#root/arrays/roles.ts";
import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import ScraperService from "#root/services/ScraperService.ts";
import MongoService from "#root/services/MongoService.ts";
import LogFormatter from "#root/formatters/LogFormatter.ts";

/**
 * Handle a presence update event — track activity, assign roles,
 * and post streaming notifications.
 */
async function handlePresenceUpdate(client: Client, _oldPresence: Presence | null, newPresence: Presence) {
  const functionName = "luposOnPresenceUpdate";

  const mongo = MongoService.getClient("local");
  if (!mongo) return;
  if (!newPresence.guild || !newPresence.member) return;
  if (newPresence.guild.id !== config.GUILD_ID_PRIMARY) return;

  try {
    let activityName = "";
    let isStreaming = false;
    const userName = newPresence.user!.username;
    let streamingUrl = "";
    const _userStatus = newPresence.status;

    // Check activities
    for (const activity of newPresence.activities) {
      // PLAYING
      if (activity.type === 0) {
        activityName = activity.name;

        const db = mongo.db(MONGO_DB_NAME);
        const collection = db.collection("GameActivity");
        await collection.updateOne(
          { name: activity.name },
          { $inc: { count: 1 } },
          { upsert: true },
        );

        for (const mapping of GAME_ROLE_MAPPINGS) {
          if (activity.name.toLowerCase().includes(mapping.activityName)) {
            const roleId = rolesVideogames.find(
              (role: { name: string; id: string; emojiId: string }) => role.name.toLowerCase() === mapping.roleName,
            )?.id;
            if (roleId) {
              await DiscordUtilityService.addRoleToMember(
                newPresence.member,
                roleId,
              );
            }
          }
        }
      }
      // streaming
      if (activity.type === 1) {
        isStreaming = true;
        streamingUrl = activity.url ?? "";
      }
      // listening
      if (activity.type === 2) {
        activityName = activity.name;
        await DiscordUtilityService.addRoleToMember(newPresence.member, config.ROLE_ID_SPOTIFY_LISTENER || "");
      }
      // watching
      if (activity.type === 3) {
        activityName = activity.name;
      }
      // custom
      if (activity.type === 4) {
        activityName = activity.name;
      }
      // competing
      if (activity.type === 5) {
        activityName = activity.name;
      }
    }

    if (isStreaming) {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const db = mongo.db(MONGO_DB_NAME);
      const streamersCollection = db.collection("ActiveStreamers");

      // Find and update or insert
      const result = await streamersCollection.findOneAndUpdate(
        { userId: newPresence.user!.id },
        {
          $set: {
            userId: newPresence.user!.id,
            userName: userName,
            streamingUrl: streamingUrl,
            activityName: activityName,
            isStreaming: isStreaming,
            timestamp: new Date(),
          },
        },
        {
          upsert: true,
          returnDocument: "before", // Returns the document before update (or null if inserted)
        },
      );

      // Check if we should notify (no previous record or last notification was more than 3 hours ago)
      const shouldNotify =
        !result || new Date(result.timestamp as string | number | Date) < threeHoursAgo;

      if (shouldNotify) {
        try {
          // Scrape metadata from Twitch
          const metadata = await ScraperService.scrapeTwitchUrl(streamingUrl);
          // Assign streamer role to user
          await DiscordUtilityService.addRoleToMember(
            newPresence.member,
            config.ROLE_ID_STREAMER || "",
          );
          // Get the streaming channel
          const streamingChannel = await DiscordUtilityService.getChannelById(
            client,
            config.CHANNEL_ID_STREAMERS || "",
          ) as TextChannel | undefined;

          if (streamingChannel) {
            const userTag = `<@${newPresence.user!.id}>`;

            // Create embed
            const embed = new EmbedBuilder()
              .setAuthor({
                name: `${userName} is now live on Twitch!`,
                iconURL: newPresence.user!.displayAvatarURL(),
              })
              .setURL(streamingUrl)
              .setDescription(`${userTag} is streaming **${activityName}**`)
              .setColor("#57F287")
              .setTimestamp();

            // Add thumbnail if available
            if (metadata?.image) {
              embed.setThumbnail(metadata.image);
            }

            // Add title from description (max 256 characters)
            if (metadata?.description) {
              const title =
                metadata.description.length > 256
                  ? metadata.description.substring(0, 253) + "..."
                  : metadata.description;
              embed.setTitle(title);
            }

            // Create button
            const buttonWatchStream = new ButtonBuilder()
              .setLabel("Watch Stream")
              .setStyle(ButtonStyle.Link)
              .setURL(streamingUrl);

            const rowButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
              buttonWatchStream,
            );

            // Send the message
            await streamingChannel.send({
              embeds: [embed],
              components: [rowButtons],
            });
          } else {
            console.error(
              `Streaming channel with ID ${config.CHANNEL_ID_STREAMERS} not found`,
            );
          }
        } catch (notificationError: unknown) {
          console.error(...LogFormatter.error(functionName, notificationError as Error));
        }
      }
    }
  } catch (error: unknown) {
    console.error(...LogFormatter.error(functionName, error as Error));
  }
}

export default { handlePresenceUpdate };
