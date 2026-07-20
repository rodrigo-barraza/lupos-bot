import DiscordUtilityService from "#root/services/DiscordUtilityService.ts";
import BirthdayOnboarding, {
  MONTHS,
} from "#root/services/discord/BirthdayOnboarding.ts";
import birthdays from "#root/arrays/birthdays.ts";
import config from "#root/config.ts";
import type { Client, GuildMember, Role } from "discord.js";

async function getCurrentMonthBirthdays(
  client: Client,
  mongo: import("mongodb").MongoClient,
) {
  const currentMonthNumber = new Date().getMonth() + 1;
  const currentMonth = MONTHS[currentMonthNumber - 1];

  const currentMonthData = birthdays.find(
    (item: { month: string; users: string[] }) => item.month === currentMonth,
  );
  const users = currentMonthData ? currentMonthData.users : [];

  // Birthdays collected via the onboarding DM (stored by user id)
  let storedUserIds: string[] = [];
  try {
    storedUserIds = await BirthdayOnboarding.getUserIdsForMonth(
      mongo,
      currentMonthNumber,
    );
  } catch (error: unknown) {
    console.error("Error reading stored birthdays from MongoDB:", error);
  }

  // get the guild
  const guild = DiscordUtilityService.getGuildById(
    client,
    config.GUILD_ID_PRIMARY || "",
  );
  const birthdayRoleId = config.ROLE_ID_BIRTHDAY_MONTH;
  if (!guild || !birthdayRoleId) return [];

  // Resolve celebrants first (union of array usernames + stored ids)
  // so the remove sweep below doesn't strip-and-re-add current holders.
  const celebrants = new Map<string, GuildMember>();
  for (const user of users) {
    const member = guild.members.cache.find(
      (member: GuildMember) => member.user.username === user,
    );
    if (member) celebrants.set(member.id, member);
  }
  for (const userId of storedUserIds) {
    const member = guild.members.cache.get(userId);
    if (member) celebrants.set(member.id, member);
  }

  // First, remove birthday roles from everyone who shouldn't have it
  const birthdayRoleMembers = guild.members.cache.filter(
    (member: GuildMember) =>
      member.roles.cache.some((role: Role) => role.id === birthdayRoleId) &&
      !celebrants.has(member.id),
  );

  // Use Promise.all to wait for all role removals to complete
  await Promise.all(
    birthdayRoleMembers.map((member: GuildMember) =>
      member.roles
        .remove(birthdayRoleId)
        .catch((error: Error) =>
          console.error(
            `Error removing role from ${member.user.username}:`,
            error,
          ),
        ),
    ),
  );

  // Now assign the birthday role to each celebrant
  await Promise.all(
    [...celebrants.values()].map((member: GuildMember) =>
      member.roles
        .add(birthdayRoleId)
        .catch((error: Error) =>
          console.error(
            `Error adding role to ${member.user.username}:`,
            error,
          ),
        ),
    ),
  );

  return [...celebrants.values()].map(
    (member: GuildMember) => member.user.username,
  );
}

const BirthdayJob = {
  async startJob(client: Client, mongo: import("mongodb").MongoClient) {
    await getCurrentMonthBirthdays(client, mongo); // Execute immediately
    setInterval(
      () => {
        getCurrentMonthBirthdays(client, mongo);
      },
      1000 * 60 * 60 * 24,
    ); // every 24 hours
  },
};

export default BirthdayJob;
