import config from '#root/config.json' with { type: 'json' };
import DiscordUtilityService from '#root/services/DiscordUtilityService.js';
import LogFormatter from '#root/formatters/LogFormatter.js';

const timeoutLength = 168 * 60 * 60 * 1000;
const intervalLength = 167 * 60 * 60 * 1000;


async function timeOutUsers(client) {
    const functionName = 'timeOutUsers';
    const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);
    for (const userId of config.USER_IDS_TIMED_OUT) {
        let member;
        try {
            member = await guild.members.fetch(userId);
            if (member) {
                const totalTime = timeoutLength;
                const duration = totalTime / 1000;
                console.log(...LogFormatter.memberTimedOut(functionName, member, guild, duration));
                await member.timeout(totalTime, 'Permanent timeout job');
            }
        } catch (error) {
            console.log(...LogFormatter.memberTimeOutError(functionName, member, guild, error));
        }
        if (!member) {
            const user = await DiscordUtilityService.retrieveUserFromClientAndUserId(client, userId);
            if (user) {
                console.warn(...LogFormatter.memberNotFound(functionName, user, guild));
            } else {
                console.warn(...LogFormatter.userNotFound(functionName, userId));
            }
        }
    }
}

const PermanentTimeOutJob = {
    async startJob(client) {
        await timeOutUsers(client); // Execute immediately
        setInterval(() => {
            timeOutUsers(client);
        }, intervalLength);
    }
};

export default PermanentTimeOutJob;