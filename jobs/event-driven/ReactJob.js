const DiscordUtilityService = require('../../services/DiscordUtilityService.js');
const config = require('../../config.json');

let queueIsProcessing = false;
const queue = [];

let reactors = [];

async function generateReactors(client, mongo, reaction, user) {
    // if reaction is flag emoji, give flag role
    if (reaction._emoji.id === config.EMOJI_ID_FLAG) {
        const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);
        const role = guild.roles.cache.find(role => role.id === config.ROLE_ID_FLAG);
        const member = await guild.members.fetch(user?.id);

        if (member) {
            member.roles.add(role);
            const reactor = {
                id: member.id,
                name: user.globalName || user.username,
                role: role.name,
                timestamp: new Date(),
            }
            reactors.push(reactor);
        }
        return;
    }
}

async function clearReactors(client, mongo) {
    // Clear the reactors and remove the role if their timestamp was more than 30 minutes ago
    const oneMinuteAgo = new Date(Date.now() - 30 * 60 * 1000);
    const guild = DiscordUtilityService.getGuildById(client, config.GUILD_ID_PRIMARY);
    const role = guild.roles.cache.find(role => role.id === config.ROLE_ID_FLAG);
    const membersWithRole = guild.members.cache.filter(member => member.roles.cache.some(r => r.id === role.id));
    
    // Process all members who have the role
    for (const member of membersWithRole.values()) {
        const reactor = reactors.find(r => r.id === member.id);
        
        // Remove role if: member is not in reactors array OR their timestamp is old
        if (!reactor || reactor.timestamp < oneMinuteAgo) {
            await member.roles.remove(role);
        }
    }
    
    // Keep only reactors with recent timestamps
    reactors = reactors.filter(reactor => reactor.timestamp >= oneMinuteAgo);
}
    


const ReactJob = {
    async startJob(client, mongo) {
        await clearReactors(client, mongo); // Execute immediately
        setInterval(() => {
            clearReactors(client, mongo);
        }, 1000 * 60); // every minute
    },
    async processJob(client, mongo, reaction, user) {
        queue.push({reaction, user});
        if (queueIsProcessing) return;
        queueIsProcessing = true;
        while (queue.length > 0) {
            const {reaction: currentReaction, user: currentUser} = queue.shift();
            await generateReactors(client, mongo, currentReaction, currentUser);
        }
        queueIsProcessing = false;
        return;
    }
};

module.exports = ReactJob;