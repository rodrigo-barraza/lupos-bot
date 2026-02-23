import config from '../config.json' with { type: 'json' };
import UtilityLibrary from '../libraries/UtilityLibrary.js';
import LightWrapper from '../wrappers/LightWrapper.js';

const { slowBlink, bold } = UtilityLibrary.ansiEscapeCodes(true);

const styles = {
    white: '\x1b[38;5;255m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    greenBackground: '\x1b[42m',
    blueBackground: '\x1b[44m',
    redBackground: '\x1b[41m',
    yellowBackground: '\x1b[43m',
    reset: '\x1b[0m',
}

const LogFormatter = {
    globalFormatter({
        // Required
        functionName,
        logEmoji,
        logName,
        // Discord Info
        client,
        user,
        member,
        guild,
        channel,
        message,
        role,
        reaction,
        state,
        interaction,
        guilds,
        // Generative Text Info
        systemPrompt,
        prompt,
        conversation,
        generatedText,
        duration,
        // Specific
        roleId,
        userId,
        // Error
        error,

        // NEW GENERATIVE INFO
        modelType,
        modelName,
        inputCharacterCount,
        outputCharacterCount,
        // duration, already exists
        inputTokenCount,
        outputTokenCount,
        inputTokenCost,
        outputTokenCost,
        totalCost,
        // NEW SCRAPE INFO
        url,
        result,
        // NEW TRANSCRIBE INFO
        // message, already exists
        audioUrl,
        transcription,
        cached,
        // NEW CAPTION INFO
        hash,
        // message,
        imageUrl,
        caption,

    }) {
        LightWrapper.cycleColor(config.PRIMARY_LIGHT_ID);

        let theClient;
        let theUser;
        let theMember;
        let theGuild;
        let theChannel;
        let theMessage;
        let theGuilds;
        let theInteractionCustom;

        if (reaction) {
            theUser = reaction.message.author;
            theMember = reaction.message.member;
            theGuild = reaction.message.guild;
            theChannel = reaction.message.channel;
            theMessage = reaction.message;
            theClient = reaction.message.client;
        }
        if (state) {
            theUser = state.member.user;
            theMember = state.member;
            theGuild = state.guild;
            theChannel = state.channel;
            theClient = state.client;
        }
        if (interaction) {
            theUser = interaction.user;
            theMember = interaction.member;
            theGuild = interaction.guild;
            theChannel = interaction.channel;
            theInteractionCustom = interaction.customId;
            theClient = interaction.client;
        }
        if (message) {
            theUser = message.author;
            theMember = message.member;
            theGuild = message.guild;
            theChannel = message.channel;
            theClient = message.client;
        }

        if (member) {
            theUser = member.user;
            theGuild = member.guild;
        }

        if (client) {
            theClient = client;
        }

        if (guilds) {
            theGuilds = guilds;
        }

        if (user) {
            theUser = user;
            // If user is passed but member is not, make member undefined
            if (!member) {
                theMember = undefined;
            }
        }
        if (member) {
            theMember = member;
        }
        if (guild) {
            theGuild = guild;
        }
        if (channel) {
            theChannel = channel;
        }
        if (message) {
            theMessage = message;
        }
        

        const combinedNames = UtilityLibrary.getCombinedNamesFromUserOrMember({ user: theUser, member: theMember }, true);
        const combinedGuildInformation = UtilityLibrary.getCombinedGuildInformationFromGuild(theGuild, true);
        const combinedChannelInformation = UtilityLibrary.getCombinedChannelInformationFromChannel(theChannel, true);
        const combinedEmojiInformation = UtilityLibrary.getCombinedEmojiInformationFromReaction(reaction, true);
        const combinedRoleInformation = UtilityLibrary.getCombinedRoleInformationFromRole(role, true)
        const combinedTimeInformation = UtilityLibrary.getCombinedDateInformationFromDate(undefined, true);

        let log = `${combinedTimeInformation}`;
        if (logEmoji) {
            log += `\n${logEmoji}`;
        }
        if (functionName) {
            // log += ` [${functionName}]`;
        }
        if (logName) {
            log += ` ${bold(slowBlink(logName))}`;
        }
        // Duration
        if (duration) {
            log += `\n    Duration: ${duration.toFixed(0)} ms`;
        }
        // Client and Guilds
        if (theClient) {
            log += `\n    Client: ${UtilityLibrary.getCombinedNamesFromUserOrMember({ user: theClient.user }, true)}`;
        }
        if (theGuilds) {
            for (const guild of theGuilds.values()) {
                log += `\n    - ${UtilityLibrary.getCombinedGuildInformationFromGuild(guild, true)}`;
                // get member count if available
                if (guild.memberCount) {
                    log += `\n      - (Members: ${guild.memberCount})`;
                    // boosts
                    if (guild.premiumSubscriptionCount) {
                        log += `\n      - (Boosts: ${guild.premiumSubscriptionCount})`;
                    }
                    // channels
                    if (guild.channels.cache.size) {
                        log += `\n      - (Channels: ${guild.channels.cache.size})`;
                    }
                    // roles
                    if (guild.roles.cache.size) {
                        log += `\n      - (Roles: ${guild.roles.cache.size})`;
                    }
                    // emojis
                    if (guild.emojis.cache.size) {
                        log += `\n      - (Emojis: ${guild.emojis.cache.size})`;
                    }
                    // stickers
                    if (guild.stickers.cache.size) {
                        log += `\n      - (Stickers: ${guild.stickers.cache.size})`;
                    }
                    // commands
                    if (guild.commands.cache.size) {
                        log += `\n      - (Commands: ${guild.commands.cache.size})`;
                    } 
                    // bans
                    if (guild.bans.cache.size) {
                        log += `\n      - (Bans: ${guild.bans.cache.size})`;
                    }
                    // online members
                    const onlineMembers = guild.members.cache.filter(member => member.presence && member.presence.status
                        && (member.presence.status === 'online' || member.presence.status === 'dnd' || member.presence.status === 'idle'));
                    if (onlineMembers.size) {
                        log += `\n      - (Online Members: ${onlineMembers.size})`;
                    }
                    // bots
                    const botMembers = guild.members.cache.filter(member => member.user.bot);
                    if (botMembers.size) {
                        log += `\n      - (Bots: ${botMembers.size})`;
                    }
                    // verification level
                    if (guild.verificationLevel) {
                        log += `\n      - (Verification Level: ${guild.verificationLevel})`;
                    }
                    // region
                    if (guild.region) {
                        log += `\n      - (Region: ${guild.region})`;
                    }   
                    // locale
                    if (guild.preferredLocale) {
                        log += `\n      - (Locale: ${guild.preferredLocale})`;
                    }
                    // created at
                    if (guild.createdAt) {
                        log += `\n      - (Created At: ${guild.createdAt})`;
                    }
                }
            }
        }
        // User ID
        if (userId) {
            log += `\n    User ID: ${userId}`;
        }
        // Member or User
        if (combinedNames) {
            log += `\n    ${theMember ? `Member: ${combinedNames}` : `User: ${combinedNames}`}`;
        }
        // Role
        if (combinedRoleInformation) {
            log += `\n    Role: ${combinedRoleInformation}`;
        }
        if (roleId) {
            log += `\n    Role ID: ${roleId}`;
        }
        // Emoji
        if (combinedEmojiInformation) {
            log += `\n    Emoji: ${combinedEmojiInformation}`;
        }
        // Guild and Channel
        if (combinedGuildInformation) {
            log += `\n    Guild: ${combinedGuildInformation}`;
        }
        if (combinedChannelInformation) {
            log += `\n    Channel: ${combinedChannelInformation}`;
        }

        let logParts = [];

        logParts.push(log);
        if (systemPrompt) {
            logParts.push('\n    System Prompt:');
            logParts.push(styles.white);
            logParts.push(`\n${systemPrompt}`);
            logParts.push(styles.reset);
            // logParts.push([{systemPrompt}]);
        }
        if (prompt) {
            logParts.push('\n    Prompt:');
            logParts.push(styles.white);
            logParts.push(`\n${prompt}`);
            logParts.push(styles.reset);
            // logParts.push([{prompt}]);
        }
        if (conversation) {
            logParts.push('\n    Conversation:');
            logParts.push(styles.white);
            logParts.push(conversation);
            logParts.push(styles.reset);
        }
        if (generatedText) {
            logParts.push('\n    Generated Text:');
            // logParts.push([{generatedText}]);
            logParts.push(styles.white);
            logParts.push(`\n${generatedText}`);
            logParts.push(styles.reset);
        }
        if (theMessage) {
            if (theMessage.content) {
                logParts.push('\n    Message Content:');
                // logParts.push([{ content: theMessage.content }]);
                logParts.push(styles.white);
                logParts.push(`\n${theMessage.content}`);
                logParts.push(styles.reset);
            }
            if (theMessage.guild && theMessage.channel && theMessage.id) { 
                logParts.push(`\n    Message URL: https://discord.com/channels/${theMessage.guild.id}/${theMessage.channel.id}/${theMessage.id}`);
            }
        }
        // TEXT GENERATION INFO
        if (modelType) {
            logParts.push(`\n    Model Type: ${modelType}`);
        }
        if (modelName) {
            logParts.push(`\n    Model Name: ${modelName}`);
        }
        if (inputCharacterCount) {
            logParts.push(`\n    Character Count: ${inputCharacterCount}`);
        }
        if (outputCharacterCount) {
            logParts.push(`\n    Output Character Count: ${outputCharacterCount}`);
        }
        if (inputTokenCount) {
            logParts.push(`\n    Input Token Count: ${inputTokenCount}`);
        }
        if (outputTokenCount) {
            logParts.push(`\n    Output Token Count: ${outputTokenCount}`);
        }
        if (inputTokenCost) {
            logParts.push(`\n    Input Token Cost: $${inputTokenCost}`);
        }
        if (outputTokenCost) {
            logParts.push(`\n    Output Token Cost: $${outputTokenCost}`);
        }
        if (totalCost) {
            logParts.push(`\n    Total Cost: $${totalCost}`);
        }
        // SCRAPE INFO
        if (url) {
            logParts.push(`\n    URL: ${url}`);
        }
        if (result) {
            logParts.push('\n    Result:');
            logParts.push(result);
        }
        if (audioUrl) {
            logParts.push(`\n    Audio URL: ${audioUrl}`);
        }
        if (transcription) {
            logParts.push(`\n    Transcription:`);
            logParts.push(styles.white);
            logParts.push(`\n${transcription}`);
            logParts.push(styles.reset);
        }
        if (cached !== undefined) {
            logParts.push(`\n    Cached: ${styles.green}${cached}${styles.reset}`);
        }
        if (hash) {
            logParts.push(`\n    Hash: ${hash}`);
        }
        if (imageUrl) {
            logParts.push(`\n    Image URL: ${imageUrl}`);
        }
        if (caption) {
            logParts.push(`\n    Caption:`);
            logParts.push(styles.white);
            logParts.push(`\n${caption}`);
            logParts.push(styles.reset);
        }
        // Error
        if (error) {
            logParts.push('    Error:');
            logParts.push(error);
        }

        return logParts;
    },
    // GENERATE INFO
    generateTextSuccess({
        functionName,
        duration,
        inputCharacterCount,
        inputTokenCost,
        inputTokenCount,
        modelName,
        modelType,
        outputCharacterCount,
        outputTokenCost,
        outputTokenCount,
        totalCost,
    }) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '🧠',
            logName: `${styles.yellowBackground}GENERATE TEXT SUCCESS${styles.reset}`,
            modelType,
            modelName,
            inputCharacterCount,
            outputCharacterCount,
            duration,
            inputTokenCount,
            outputTokenCount,
            inputTokenCost,
            outputTokenCost,
            totalCost,
        });
    },
    // generateImageSuccess({
    //     functionName, 
    //     duration,
    //     inputCharacterCount,
    //     outputCharacterCount,

    // }),
    generateImageStart({ prompt }) {
        return LogFormatter.globalFormatter({
            logEmoji: '🖼️',
            logName: `${styles.yellowBackground}GENERATE IMAGE START${styles.reset}`,
            prompt,
        });
    },
    generateImageSuccess({ prompt, duration, totalCost }) {
        return LogFormatter.globalFormatter({
            logEmoji: '🖼️',
            logName: `${styles.yellowBackground}GENERATE IMAGE SUCCESS${styles.reset}`,
            prompt,
            duration,
            totalCost,
        });
    },
    // SCRAPE INFO
    scrapeSuccess({functionName, url, result}) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '🌐',
            logName: `${styles.yellowBackground}SCRAPE SUCCESS${styles.reset}`,
            url,
            result,
        });
    },
    scrapeError(functionName, url, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}SCRAPE ERROR${styles.reset}`,
            url,
            error,
        });
    },
    // TRANSCRIBE INFO
    transcribeSuccess({functionName, message, audioUrl, transcription, cached}) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '🎤',
            logName: `${styles.yellowBackground}TRANSCRIBE SUCCESS${styles.reset}`,
            message,
            audioUrl,
            transcription,
            cached,
        });
    },
    transcribeError(functionName, message, audioUrl, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}TRANSCRIBE ERROR${styles.reset}`,
            message,
            audioUrl,
            error,
        });
    },
    // CAPTION INFO
    captionSuccess({functionName, hash, message, imageUrl, caption, cached}) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '🖼️',
            logName: `${styles.yellowBackground}CAPTION SUCCESS${styles.reset}`,
            hash,
            message,
            imageUrl,
            caption,
            cached,
        });
    },
    captionError(functionName, hash, message, imageUrl, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}CAPTION ERROR${styles.reset}`,
            hash,
            message,
            imageUrl,
            error,
        });
    },
    // ERROR
    error(functionName, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}ERROR${styles.reset}`,
            error,
        });
    },
    // CLIENT
    botReady(client) {
        return LogFormatter.globalFormatter({ 
            logEmoji: '💡',
            logName: `${styles.yellowBackground}BOT READY${styles.reset}`,
            client,
        });
    },
    // USERS
    memberNotFound(functionName, user, guild) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}MEMBER NOT FOUND${styles.reset}`,
            user,
            guild,
        });
    },
    userNotFound(functionName, userId) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}USER NOT FOUND${styles.reset}`,
            userId,
        });
    },
    // MEMBERS
    memberJoinedGuild(functionName, member) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '➡️🏰',
            logName: `${styles.yellowBackground}MEMBER JOINED GUILD${styles.reset}`,
            member,
        });
    },
    memberLeftGuild(member) {
        return LogFormatter.globalFormatter({
            logEmoji: '⬅️👤🏰',
            logName: `${styles.yellowBackground}MEMBER LEFT GUILD${styles.reset}`,
            member,
        });
    },
    memberUpdateOnboardingComplete(functionName, member) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '👤🎉🚀',
            logName: `${styles.yellowBackground}MEMBER ONBOARDING COMPLETE${styles.reset}`,
            member,
        });
    },
    memberTimedOut(functionName, member, guild, duration) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '⏰',
            logName: `${styles.yellowBackground}MEMBER TIMEOUT${styles.reset}`,
            member,
            guild,
            totalTime: duration,
        });
    },
    memberTimeOutError(functionName, member, guild, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}MEMBER TIMEOUT ERROR${styles.reset}`,
            member,
            guild,
            error,
        });
    },
    // MESSAGES
    receivedGuildMessage(message, actionType) {
        return LogFormatter.globalFormatter({
            logEmoji: '👥💬',
            logName: `${styles.greenBackground}GUILD MESSAGE ${actionType}D${styles.reset}`,
            message,
        });
    },
    receivedDirectMessage(message, actionType) {
        return LogFormatter.globalFormatter({
            logEmoji: '👤💬',
            logName: `${styles.greenBackground}DIRECT MESSAGE ${actionType}D${styles.reset}`,
            message,
        });
    },
    // ROLES
    roleFailedToAdd(member, role, error) {
        return LogFormatter.globalFormatter({ 
            logEmoji: '❌',
            logName: `${styles.redBackground}ROLE FAILED TO ADD, MEMBER NOT FOUND${styles.reset}`,
            member,
            role,
            error,
        });
    },
    roleFailedToRemove(userId, role, error) {
        return LogFormatter.globalFormatter({
            logEmoji: '❌',
            logName: `${styles.redBackground}ROLE FAILED TO REMOVE${styles.reset}`,
            userId,
            role,
            error,
        });
    },
    roleAdded(member, role) {
        return LogFormatter.globalFormatter({
            logEmoji: '➕ 🏷️',
            logName: `${styles.yellowBackground}ROLE ADDED${styles.reset}`,
            member,
            role,
        });
    },
    roleRemoved(member, role) {
        return LogFormatter.globalFormatter({
            logEmoji: '➖ 🏷️',
            logName: `${styles.yellowBackground}ROLE REMOVED${styles.reset}`,
            member,
            role,
        });
    },
    // USER
    reactionAdded(functionName, user, reaction) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '➕👍',
            logName: `${styles.yellowBackground}REACTION ADDED${styles.reset}`,
            reaction,
            user,
        });
    },
    // MESSAGES
    replyBuildingAndGenerating(message) {
        return LogFormatter.globalFormatter({
            logEmoji: '📝',
            logName: `${styles.yellowBackground}REPLY BUILDING AND GENERATING${styles.reset}`,
            message,
        });
    },
    replyBuildingAndGeneratingSuccess({
        systemPrompt,
        conversation,
        generatedText,
        message,
        duration
    }) {
        return LogFormatter.globalFormatter({
            logEmoji: '🧠',
            logName: `${styles.yellowBackground}REPLY BUILT AND GENERATED${styles.reset}`,
            systemPrompt,
            conversation,
            generatedText,
            message,
            duration,
        });
    },
    // INTERACTIONS
    roleSelfAdded(functionName, interaction, role) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '➕🏷️',
            logName: `${styles.greenBackground}ROLE SELF ADDED${styles.reset}`,
            interaction,
            role,
        });
    },
    roleSelfRemoved(functionName, interaction, role) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '➖🏷️',
            logName: `${styles.greenBackground}ROLE SELF REMOVED${styles.reset}`,
            interaction,
            role,
        });
    },
    interactionCreate(functionName, interaction) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '⭐',
            logName: `${styles.yellowBackground}INTERACTION CREATED${styles.reset}`,
            interaction,
        });
    },
    interactionCreateButton(functionName, interaction) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '🕹️',
            logName: `${styles.yellowBackground}INTERACTION TYPE: BUTTON${styles.reset}`,
            interaction,
        });
    },
    interactionCreateCommand(functionName, interaction) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '⭐',
            logName: `${styles.yellowBackground}INTERACTION TYPE: COMMAND${styles.reset}`,
            interaction,
        });
    },
    commandNotFound(functionName, interaction) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}COMMAND NOT FOUND${styles.reset}`,
            interaction,
        });
    },
    commandError(functionName, interaction, error) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}COMMAND ERROR${styles.reset}`,
            interaction,
            error,
        });
    },
    roleNotFound(functionName, interaction, roleId) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}ROLE NOT FOUND${styles.reset}`,
            interaction,
            roleId,
        });
    },
    interactionMemberNotFound(functionName, interaction, roleId) {
        return LogFormatter.globalFormatter({ 
            logEmoji: '❌',
            functionName,
            logName: `${styles.redBackground}MEMBER NOT FOUND${styles.reset}`,
            interaction,
            roleId,
        });
    },
    // LLM
    replyGuildMessageSuccess(message, generatedTextResponse, duration) {
        return LogFormatter.globalFormatter({ 
            logEmoji: '➕📡💬',
            logName: `${styles.blueBackground}GUILD MESSAGE SENT${styles.reset}`,
            message,
            generatedTextResponse,
            duration,
        });
    },
    replyDirectMessageSuccess(message, generatedTextResponse, duration) {
        return LogFormatter.globalFormatter({
            logEmoji: '➕💬',
            logName: `${styles.blueBackground}DIRECT MESSAGE SENT${styles.reset}`,
            message,
            generatedTextResponse,
            duration,
        });
    },
    // VOICE CHANNEL
    memberJoinedVoiceChannel(newState) {
        return LogFormatter.globalFormatter({
            logEmoji: '👤➡️🎤',
            logName: `${styles.greenBackground}MEMBER JOINED VOICE CHANNEL${styles.reset}`,
            state: newState,
        });
    },
    memberLeftVoiceChannel(oldState) {
        return LogFormatter.globalFormatter({
            logEmoji: '⬅️👤🎤',
            logName: `${styles.greenBackground}MEMBER LEFT VOICE CHANNEL${styles.reset}`,
            state: oldState,
        });
    },
    // COMFY UI
    comfyUITimedOut(functionName) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}COMFY UI TIMED OUT${styles.reset}`,
        });
    },
    comfyUIDown(functionName) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '❌',
            logName: `${styles.redBackground}COMFY UI DOWN${styles.reset}`,
        });
    },
    comfyUIUp(functionName) {
        return LogFormatter.globalFormatter({
            functionName,
            logEmoji: '✅',
            logName: `${styles.yellowBackground}COMFY UI UP${styles.reset}`,
        });
    },
    luposInitializing() {
        return LogFormatter.globalFormatter({
            logEmoji: '🐺',
            logName: 'Lupos v1.0 initializing ...',
        });
    },
    readyToProcessMessages() {
        return LogFormatter.globalFormatter({
            logEmoji: '📄',
            logName: '... ready to process messages',
        });
    },
    readyToProcessMessageUpdates() {
        return LogFormatter.globalFormatter({
            logEmoji: '📝',
            logName: '... ready to process message updates',
        });
    },
    commandLoaded(commandName) {
        return LogFormatter.globalFormatter({
            logEmoji: '✅',
            logName: `... the command /${commandName} has loaded`,
        });
    },
    commandFailedToLoad(commandName) {
        return LogFormatter.globalFormatter({
            logEmoji: '⚠️',
            logName: `... the command /${commandName} has failed to load`,
        });
    },
    errorInitialization(error) {
        return LogFormatter.globalFormatter({
            logEmoji: '❌',
            logName: `${styles.redBackground}INITIALIZATION ERROR${styles.reset}`,
            error,
        });
    },
    displayAllGuilds(guilds) {
        return LogFormatter.globalFormatter({
            logEmoji: '🌎',
            logName: `Connected Discord Servers: ${guilds.size}`,
            guilds,
        });
    },
    mongoConnectionSuccess(mongoName) {
        return LogFormatter.globalFormatter({
            logEmoji: '🛢️',
            logName: `MongoDB Connection Success: ${mongoName}`,
        });
    },
    mongoConnectionError(mongoName, error) {
        return LogFormatter.globalFormatter({
            logEmoji: '❌',
            logName: `MongoDB Connection Error: ${mongoName}`,
            error,
        });
    },
    isMessageAskingToGenerateImage(message, isMessageAskingToGenerateImage) {
        return LogFormatter.globalFormatter({
            logEmoji: isMessageAskingToGenerateImage ? '🖼️' : '🖼️',
            logName: isMessageAskingToGenerateImage ? `${styles.greenBackground}MESSAGE IS ASKING TO GENERATE IMAGE${styles.reset}` : `${styles.redBackground}MESSAGE IS NOT ASKING TO GENERATE IMAGE${styles.reset}`,
            message,
        });
    }
}

export default LogFormatter;