import DiscordUtilityService from '../../services/DiscordUtilityService.js';
import config from '../../config.json' with { type: 'json' };
import UtilityLibrary from '../../libraries/UtilityLibrary.js';
const { consoleLog } = UtilityLibrary;

let previousOverReactorId;

async function generateReactors(client, mongo) {
    const channel1 = DiscordUtilityService.getChannelById(client, config.CHANNEL_ID_POLITICS);
    const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);

    const allMessages = await Promise.all([
        channel1.messages.fetch({ limit: 100 })
    ]);

    if (!allMessages[0]) return;

    const messages = allMessages[0];

    const overReactorRoleId = config.ROLE_ID_REACTOR;

    const userIds = [];
    let mostCommonOverReactor;

    try {
        consoleLog('<')
        const results = await Promise.all(
            messages.map(message =>
                Promise.all(
                    Array.from(message.reactions.cache.values()).map(reaction =>
                        reaction.users.fetch()
                    )
                )
            )
        );

        results.forEach(reactions => {
            reactions.forEach(users => {
                users.forEach(user => {
                    const existingUser = userIds.find(u => u.id === user.id);
                    if (existingUser) {
                        existingUser.count++;
                    } else {
                        userIds.push({ id: user.id, count: 1 });
                    }
                });
            });
        });

        mostCommonOverReactor = userIds.reduce((acc, user) => (user.count > acc.count ? user : acc), userIds[0]);

        if (mostCommonOverReactor?.count > 4) {
            const overReactorRole = guild.roles.cache.find(role => role.id === overReactorRoleId);
            const currentOverReactor = await guild.members.fetch(mostCommonOverReactor.id);

            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.some(role => role.id === overReactorRoleId));
            if (previousOverReactorId !== currentOverReactor.id) {
                // Remove the role from all current holders simultaneously
                await Promise.all(
                    membersWithRole.map(async member => {
                        consoleLog('=', `Removing ${overReactorRole.name} role from member: ${member.user.tag} (ID: ${member.id})`);
                        return member.roles.remove(overReactorRole);
                    })
                );

                // Add the role to the new over-reactor
                await currentOverReactor.roles.add(overReactorRole);

                previousOverReactorId = currentOverReactor.id;
                // consoleLog('=', `${currentOverReactor.displayName} has been given the role ${overReactorRole.name}`);
            }
        } else {
            const overreactorRole = guild.roles.cache.find(role => role.id === overReactorRoleId);
            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.some(role => role.id === overReactorRoleId));
            await membersWithRole.forEach(member => member.roles.remove(overreactorRole));
        }
        consoleLog('>')
    } catch (err) {
        console.error('Error in processing:', err);
    }
}

const ReactJob = {
    async startJob(client, mongo) {
        await generateReactors(client, mongo); // Execute immediately
        setInterval(() => {
            generateReactors(client, mongo);
        }, 1000 * 60); // every minute
    }
};

export default ReactJob;