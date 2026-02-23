
import DiscordUtilityService from '#services/DiscordUtilityService.js';
import birthdays from '#arrays/birthdays.js';
import config from '#config.json' with { type: 'json' };

async function getCurrentMonthBirthdays(client) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonth = months[new Date().getMonth()];

    const currentMonthData = birthdays.find(item => item.month === currentMonth);
    const users = currentMonthData ? currentMonthData.users : [];

    // get the guild
    const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);
    const birthdayRoleId = config.ROLE_ID_BIRTHDAY_MONTH;

    // First, remove birthday roles from everyone who has it
    const birthdayRoleMembers = guild.members.cache.filter(member =>
        member.roles.cache.some(role => role.id === birthdayRoleId));

    // Use Promise.all to wait for all role removals to complete
    await Promise.all(birthdayRoleMembers.map(member =>
        member.roles.remove(birthdayRoleId)
            .catch(err => console.error(`Error removing role from ${member.user.username}:`, err))
    ));

    // Now assign the birthday role to each user in the current month
    const addRolePromises = [];
    for (const user of users) {
        const member = guild.members.cache.find(member => member.user.username === user);
        if (member) {
            addRolePromises.push(
                member.roles.add(birthdayRoleId)
                    .catch(err => console.error(`Error adding role to ${user}:`, err))
            );
        }
    }

    // Wait for all role additions to complete
    await Promise.all(addRolePromises);
    return users;
}

const BirthdayJob = {
    async startJob(client) {
        await getCurrentMonthBirthdays(client); // Execute immediately
        setInterval(() => {
            getCurrentMonthBirthdays(client);
        }, 1000 * 60 * 60 * 24); // every 24 hours
    }
};

export default BirthdayJob;