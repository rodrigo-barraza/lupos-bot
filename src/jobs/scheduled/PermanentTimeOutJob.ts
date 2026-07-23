import BotSettingsService from "#root/services/BotSettingsService.ts";
import config from "#root/config.ts";
import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import LogFormatter from "#root/formatters/LogFormatter.ts";
import type { Client, GuildMember } from "discord.js";

const timeoutLength = 168 * 60 * 60 * 1000;
const intervalLength = 167 * 60 * 60 * 1000;

async function timeOutUsers(client: Client) {
  const functionName = "timeOutUsers";
  const guild = DiscordUtilityService.getGuildById(
    client,
    config.GUILD_ID_PRIMARY || "",
  );
  if (!guild) return;

  for (const userId of BotSettingsService.get("USER_IDS_TIMED_OUT")) {
    let member: GuildMember | undefined;
    try {
      member = await guild.members.fetch(userId);
      if (member) {
        const totalTime = timeoutLength;
        const duration = totalTime / 1000;
        console.log(
          ...LogFormatter.memberTimedOut(functionName, member, guild, duration),
        );
        await member.timeout(totalTime, "Permanent timeout job");
      }
    } catch (error: unknown) {
      console.log(
        ...LogFormatter.memberTimeOutError(functionName, member as GuildMember, guild, error as Error),
      );
    }
    if (!member) {
      const user = await DiscordUtilityService.getUserFromClientAndId(
        client,
        userId,
      );
      if (user) {
        console.warn(...LogFormatter.memberNotFound(functionName, user, guild));
      } else {
        console.warn(...LogFormatter.userNotFound(functionName, userId));
      }
    }
  }
}

const PermanentTimeOutJob = {
  async startJob(client: Client) {
    await timeOutUsers(client); // Execute immediately
    setInterval(() => {
      timeOutUsers(client);
    }, intervalLength);
  },
};

export default PermanentTimeOutJob;
