const DiscordWrapper = require('../../wrappers/DiscordWrapper');
const { Client } = require('discord.js');

jest.mock('discord.js', () => {
    const mClient = {
        login: jest.fn(),
        options: {}
    };
    return {
        Client: jest.fn(() => mClient),
        GatewayIntentBits: {
            Guilds: 1,
            GuildMembers: 2,
            GuildPresences: 4,
            GuildMessages: 8,
            MessageContent: 16,
            DirectMessages: 32,
            GuildMessageReactions: 64,
            GuildExpressions: 128,
            GuildVoiceStates: 256,
        },
        Partials: {
            Channel: 1,
            Message: 2,
            Reaction: 3,
            User: 4,
            GuildMember: 5,
        }
    };
});

describe('DiscordWrapper', () => {
    beforeEach(() => {
        // Clear clients array before each test to ensure state isolation
        DiscordWrapper.clients.length = 0;
        jest.clearAllMocks();
    });

    test('should create a new client and login', () => {
        const client = DiscordWrapper.createClient('testBot', 'fakeToken');

        expect(Client).toHaveBeenCalledTimes(1);
        expect(client.login).toHaveBeenCalledWith('fakeToken');
        expect(client.options.failIfNotExists).toBe(false);
    });

    test('should store created clients and retrieve them by name', () => {
        const client1 = DiscordWrapper.createClient('bot1', 'token1');
        const client2 = DiscordWrapper.createClient('bot2', 'token2');

        expect(DiscordWrapper.clients.length).toBe(2);
        expect(DiscordWrapper.getClient('bot1')).toBe(client1);
        expect(DiscordWrapper.getClient('bot2')).toBe(client2);
    });
});
