import utilities from "#root/utilities.js";
import type {
  Client,
  Guild,
  GuildMember,
  Message,
  MessageReaction,
  Role,
  User,
  VoiceState,
  Interaction,
  Collection,
} from "discord.js";

const { slowBlink, bold } = utilities.ansiEscapeCodes(true);

const styles = {
  white: "\x1b[38;5;255m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  greenBackground: "\x1b[42m",
  blueBackground: "\x1b[44m",
  redBackground: "\x1b[41m",
  yellowBackground: "\x1b[43m",
  reset: "\x1b[0m",
};

/** The mega-params object for globalFormatter. */
interface GlobalFormatterParams {
  // Required
  functionName?: string;
  logEmoji?: string;
  logName?: string;
  // Discord Info
  client?: Client;
  user?: User;
  member?: GuildMember;
  guild?: Guild;
  channel?: { name: string; id: string } | null;
  message?: Message;
  role?: Role;
  reaction?: MessageReaction;
  state?: VoiceState;
  interaction?: Interaction;
  guilds?: Collection<string, Guild>;
  // Generative Text Info
  duration?: number;
  generatedTextResponse?: string;
  prompt?: string;
  totalTime?: number;
  // Specific
  roleId?: string;
  userId?: string;
  // Error
  error?: Error | unknown;
  // Generative Info
  modelType?: string;
  modelName?: string;
  // Scrape Info
  url?: string;
  result?: unknown;
  // Transcribe Info
  audioUrl?: string;
  transcription?: string;
  cached?: boolean;
  // Caption Info
  hash?: string;
  imageUrl?: string;
  caption?: string;
}

const LogFormatter = {
  globalFormatter({
    // Required
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
    duration,
    // Specific
    roleId,
    userId,
    // Error
    error,

    // NEW GENERATIVE INFO
    modelType,
    modelName,

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
  }: GlobalFormatterParams) {
    let theClient: Client | undefined;
    let theUser: User | undefined;
    let theMember: GuildMember | undefined;
    let theGuild: Guild | undefined;
    let theChannel: { name: string; id: string } | null | undefined;
    let theMessage: Message | undefined;
    let theGuilds: Collection<string, Guild> | undefined;
    let _theInteractionCustom: string | undefined;

    if (reaction) {
      theUser = reaction.message.author ?? undefined;
      theMember = reaction.message.member ?? undefined;
      theGuild = reaction.message.guild ?? undefined;
      theChannel = reaction.message.channel as { name: string; id: string };
      theMessage = reaction.message as Message;
      theClient = reaction.message.client;
    }
    if (state) {
      theUser = state.member?.user;
      theMember = state.member ?? undefined;
      theGuild = state.guild;
      theChannel = state.channel as { name: string; id: string } | null;
      theClient = state.client;
    }
    if (interaction) {
      theUser = interaction.user;
      theMember = interaction.member as GuildMember | undefined;
      theGuild = interaction.guild ?? undefined;
      theChannel = interaction.channel as { name: string; id: string } | null;
      _theInteractionCustom =
        "customId" in interaction
          ? (interaction.customId as string)
          : undefined;
      theClient = interaction.client;
    }
    if (message) {
      theUser = message.author;
      theMember = message.member ?? undefined;
      theGuild = message.guild ?? undefined;
      theChannel = message.channel as { name: string; id: string };
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

    const combinedNames = utilities.getCombinedNamesFromUserOrMember(
      { user: theUser, member: theMember },
      true,
    );
    const combinedGuildInformation =
      utilities.getCombinedGuildInformationFromGuild(theGuild ?? null, true);
    const combinedChannelInformation =
      utilities.getCombinedChannelInformationFromChannel(
        theChannel ?? null,
        true,
      );
    const combinedEmojiInformation =
      utilities.getCombinedEmojiInformationFromReaction(reaction ?? null, true);
    const combinedRoleInformation =
      utilities.getCombinedRoleInformationFromRole(role ?? null, true);
    const combinedTimeInformation =
      utilities.getCombinedDateInformationFromDate(undefined, true);

    let log = `${combinedTimeInformation}`;
    if (logEmoji) {
      log += `\n${logEmoji}`;
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
      log += `\n    Client: ${utilities.getCombinedNamesFromUserOrMember({ user: theClient.user }, true)}`;
    }
    if (theGuilds) {
      for (const g of theGuilds.values()) {
        log += `\n    - ${utilities.getCombinedGuildInformationFromGuild(g, true)}`;
        // get member count if available
        if (g.memberCount) {
          log += `\n      - (Members: ${g.memberCount})`;
          // boosts
          if (g.premiumSubscriptionCount) {
            log += `\n      - (Boosts: ${g.premiumSubscriptionCount})`;
          }
          // channels
          if (g.channels.cache.size) {
            log += `\n      - (Channels: ${g.channels.cache.size})`;
          }
          // roles
          if (g.roles.cache.size) {
            log += `\n      - (Roles: ${g.roles.cache.size})`;
          }
          // emojis
          if (g.emojis.cache.size) {
            log += `\n      - (Emojis: ${g.emojis.cache.size})`;
          }
          // stickers
          if (g.stickers.cache.size) {
            log += `\n      - (Stickers: ${g.stickers.cache.size})`;
          }
          // commands
          if (g.commands.cache.size) {
            log += `\n      - (Commands: ${g.commands.cache.size})`;
          }
          // bans
          if (g.bans.cache.size) {
            log += `\n      - (Bans: ${g.bans.cache.size})`;
          }
          // online members
          const onlineMembers = g.members.cache.filter(
            (m) =>
              m.presence &&
              m.presence.status &&
              (m.presence.status === "online" ||
                m.presence.status === "dnd" ||
                m.presence.status === "idle"),
          );
          if (onlineMembers.size) {
            log += `\n      - (Online Members: ${onlineMembers.size})`;
          }
          // bots
          const botMembers = g.members.cache.filter((m) => m.user.bot);
          if (botMembers.size) {
            log += `\n      - (Bots: ${botMembers.size})`;
          }
          // verification level
          if (g.verificationLevel) {
            log += `\n      - (Verification Level: ${g.verificationLevel})`;
          }
          // locale
          if (g.preferredLocale) {
            log += `\n      - (Locale: ${g.preferredLocale})`;
          }
          // created at
          if (g.createdAt) {
            log += `\n      - (Created At: ${g.createdAt})`;
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

    const logParts: (string | unknown)[] = [];

    logParts.push(log);

    if (theMessage) {
      if (theMessage.content) {
        logParts.push("\n    Message Content:");
        logParts.push(styles.white);
        logParts.push(`\n${theMessage.content}`);
        logParts.push(styles.reset);
      }
      if (theMessage.guild && theMessage.channel && theMessage.id) {
        logParts.push(
          `\n    Message URL: https://discord.com/channels/${theMessage.guild.id}/${theMessage.channel.id}/${theMessage.id}`,
        );
      }
    }
    // TEXT GENERATION INFO
    if (modelType) {
      logParts.push(`\n    Model Type: ${modelType}`);
    }
    if (modelName) {
      logParts.push(`\n    Model Name: ${modelName}`);
    }

    // SCRAPE INFO
    if (url) {
      logParts.push(`\n    URL: ${url}`);
    }
    if (result) {
      logParts.push("\n    Result:");
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
      logParts.push("    Error:");
      logParts.push(error);
    }

    return logParts;
  },
  // GENERATE INFO
  generateImageStart({ prompt: _prompt }: { prompt: string }) {
    return LogFormatter.globalFormatter({
      logEmoji: "🖼️",
      logName: `${styles.yellowBackground}GENERATE IMAGE START${styles.reset}`,
    });
  },
  // SCRAPE INFO
  scrapeSuccess({
    functionName,
    url,
    result,
  }: {
    functionName: string;
    url: string;
    result: unknown;
  }) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "🌐",
      logName: `${styles.yellowBackground}SCRAPE SUCCESS${styles.reset}`,
      url,
      result,
    });
  },
  scrapeError(functionName: string, url: string, error: Error) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}SCRAPE ERROR${styles.reset}`,
      url,
      error,
    });
  },
  // TRANSCRIBE INFO
  transcribeSuccess({
    functionName,
    message,
    audioUrl,
    transcription,
    cached,
  }: {
    functionName: string;
    message: Message;
    audioUrl: string;
    transcription: string;
    cached: boolean;
  }) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "🎤",
      logName: `${styles.yellowBackground}TRANSCRIBE SUCCESS${styles.reset}`,
      message,
      audioUrl,
      transcription,
      cached,
    });
  },
  transcribeError(
    functionName: string,
    message: Message,
    audioUrl: string,
    error: Error,
  ) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}TRANSCRIBE ERROR${styles.reset}`,
      message,
      audioUrl,
      error,
    });
  },
  // CAPTION INFO
  captionSuccess({
    functionName,
    hash,
    message,
    imageUrl,
    caption,
    cached,
  }: {
    functionName: string;
    hash: string;
    message: Message;
    imageUrl: string;
    caption: string;
    cached: boolean;
  }) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "🖼️",
      logName: `${styles.yellowBackground}CAPTION SUCCESS${styles.reset}`,
      hash,
      message,
      imageUrl,
      caption,
      cached,
    });
  },
  captionError(
    functionName: string,
    hash: string,
    message: Message,
    imageUrl: string,
    error: Error,
  ) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}CAPTION ERROR${styles.reset}`,
      hash,
      message,
      imageUrl,
      error,
    });
  },
  // ERROR
  error(functionName: string, error: Error) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}ERROR${styles.reset}`,
      error,
    });
  },
  // CLIENT
  botReady(client: Client) {
    return LogFormatter.globalFormatter({
      logEmoji: "💡",
      logName: `${styles.yellowBackground}BOT READY${styles.reset}`,
      client,
    });
  },
  // USERS
  memberNotFound(functionName: string, user: User, guild: Guild) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}MEMBER NOT FOUND${styles.reset}`,
      user,
      guild,
    });
  },
  userNotFound(functionName: string, userId: string) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}USER NOT FOUND${styles.reset}`,
      userId,
    });
  },
  // MEMBERS
  memberJoinedGuild(functionName: string, member: GuildMember) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "➡️🏰",
      logName: `${styles.yellowBackground}MEMBER JOINED GUILD${styles.reset}`,
      member,
    });
  },
  memberLeftGuild(member: GuildMember) {
    return LogFormatter.globalFormatter({
      logEmoji: "⬅️👤🏰",
      logName: `${styles.yellowBackground}MEMBER LEFT GUILD${styles.reset}`,
      member,
    });
  },
  memberUpdateOnboardingComplete(functionName: string, member: GuildMember) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "👤🎉🚀",
      logName: `${styles.yellowBackground}MEMBER ONBOARDING COMPLETE${styles.reset}`,
      member,
    });
  },
  memberTimedOut(
    functionName: string,
    member: GuildMember,
    guild: Guild,
    duration: number,
  ) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "⏰",
      logName: `${styles.yellowBackground}MEMBER TIMEOUT${styles.reset}`,
      member,
      guild,
      totalTime: duration,
    });
  },
  memberTimeOutError(
    functionName: string,
    member: GuildMember,
    guild: Guild,
    error: Error,
  ) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}MEMBER TIMEOUT ERROR${styles.reset}`,
      member,
      guild,
      error,
    });
  },
  // MESSAGES
  receivedGuildMessage(message: Message, actionType: string) {
    return LogFormatter.globalFormatter({
      logEmoji: "👥💬",
      logName: `${styles.greenBackground}GUILD MESSAGE ${actionType}D${styles.reset}`,
      message,
    });
  },
  receivedDirectMessage(message: Message, actionType: string) {
    return LogFormatter.globalFormatter({
      logEmoji: "👤💬",
      logName: `${styles.greenBackground}DIRECT MESSAGE ${actionType}D${styles.reset}`,
      message,
    });
  },
  // ROLES
  roleFailedToAdd(member: GuildMember, role: Role, error: Error) {
    return LogFormatter.globalFormatter({
      logEmoji: "❌",
      logName: `${styles.redBackground}ROLE FAILED TO ADD, MEMBER NOT FOUND${styles.reset}`,
      member,
      role,
      error,
    });
  },
  roleFailedToRemove(userId: string, role: Role, error: Error) {
    return LogFormatter.globalFormatter({
      logEmoji: "❌",
      logName: `${styles.redBackground}ROLE FAILED TO REMOVE${styles.reset}`,
      userId,
      role,
      error,
    });
  },
  roleAdded(member: GuildMember, role: Role) {
    return LogFormatter.globalFormatter({
      logEmoji: "➕ 🏷️",
      logName: `${styles.yellowBackground}ROLE ADDED${styles.reset}`,
      member,
      role,
    });
  },
  roleRemoved(member: GuildMember, role: Role) {
    return LogFormatter.globalFormatter({
      logEmoji: "➖ 🏷️",
      logName: `${styles.yellowBackground}ROLE REMOVED${styles.reset}`,
      member,
      role,
    });
  },
  // USER
  reactionAdded(functionName: string, user: User, reaction: MessageReaction) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "➕👍",
      logName: `${styles.yellowBackground}REACTION ADDED${styles.reset}`,
      reaction,
      user,
    });
  },
  // INTERACTIONS
  roleSelfAdded(functionName: string, interaction: Interaction, role: Role) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "➕🏷️",
      logName: `${styles.greenBackground}ROLE SELF ADDED${styles.reset}`,
      interaction,
      role,
    });
  },
  roleSelfRemoved(functionName: string, interaction: Interaction, role: Role) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "➖🏷️",
      logName: `${styles.greenBackground}ROLE SELF REMOVED${styles.reset}`,
      interaction,
      role,
    });
  },
  interactionCreate(functionName: string, interaction: Interaction) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "⭐",
      logName: `${styles.yellowBackground}INTERACTION CREATED${styles.reset}`,
      interaction,
    });
  },
  interactionCreateButton(functionName: string, interaction: Interaction) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "🕹️",
      logName: `${styles.yellowBackground}INTERACTION TYPE: BUTTON${styles.reset}`,
      interaction,
    });
  },
  interactionCreateCommand(functionName: string, interaction: Interaction) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "⭐",
      logName: `${styles.yellowBackground}INTERACTION TYPE: COMMAND${styles.reset}`,
      interaction,
    });
  },
  commandNotFound(functionName: string, interaction: Interaction) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}COMMAND NOT FOUND${styles.reset}`,
      interaction,
    });
  },
  commandError(functionName: string, interaction: Interaction, error: Error) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}COMMAND ERROR${styles.reset}`,
      interaction,
      error,
    });
  },
  roleNotFound(functionName: string, interaction: Interaction, roleId: string) {
    return LogFormatter.globalFormatter({
      functionName,
      logEmoji: "❌",
      logName: `${styles.redBackground}ROLE NOT FOUND${styles.reset}`,
      interaction,
      roleId,
    });
  },
  interactionMemberNotFound(
    functionName: string,
    interaction: Interaction,
    roleId: string,
  ) {
    return LogFormatter.globalFormatter({
      logEmoji: "❌",
      functionName,
      logName: `${styles.redBackground}MEMBER NOT FOUND${styles.reset}`,
      interaction,
      roleId,
    });
  },
  // LLM
  replyGuildMessageSuccess(
    message: Message,
    generatedTextResponse: string,
    duration: number,
  ) {
    return LogFormatter.globalFormatter({
      logEmoji: "➕📡💬",
      logName: `${styles.blueBackground}GUILD MESSAGE SENT${styles.reset}`,
      message,
      generatedTextResponse,
      duration,
    });
  },
  replyDirectMessageSuccess(
    message: Message,
    generatedTextResponse: string,
    duration: number,
  ) {
    return LogFormatter.globalFormatter({
      logEmoji: "➕💬",
      logName: `${styles.blueBackground}DIRECT MESSAGE SENT${styles.reset}`,
      message,
      generatedTextResponse,
      duration,
    });
  },
  // VOICE CHANNEL
  memberJoinedVoiceChannel(newState: VoiceState) {
    return LogFormatter.globalFormatter({
      logEmoji: "👤➡️🎤",
      logName: `${styles.greenBackground}MEMBER JOINED VOICE CHANNEL${styles.reset}`,
      state: newState,
    });
  },
  memberLeftVoiceChannel(oldState: VoiceState) {
    return LogFormatter.globalFormatter({
      logEmoji: "⬅️👤🎤",
      logName: `${styles.greenBackground}MEMBER LEFT VOICE CHANNEL${styles.reset}`,
      state: oldState,
    });
  },

  luposInitializing() {
    console.log(
      "\x1b[36m🐺 Lupos\x1b[0m \x1b[2m— Discord Sentinel · v1.0\x1b[0m",
    );
    console.log("\x1b[2;33m   ► Initializing ...\x1b[0m");
    return [""];
  },
  readyToProcessMessages() {
    return LogFormatter.globalFormatter({
      logEmoji: "📄",
      logName: "... ready to process messages",
    });
  },
  readyToProcessMessageUpdates() {
    return LogFormatter.globalFormatter({
      logEmoji: "📝",
      logName: "... ready to process message updates",
    });
  },
  commandLoaded(commandName: string) {
    return LogFormatter.globalFormatter({
      logEmoji: "✅",
      logName: `... the command /${commandName} has loaded`,
    });
  },
  commandFailedToLoad(commandName: string) {
    return LogFormatter.globalFormatter({
      logEmoji: "⚠️",
      logName: `... the command /${commandName} has failed to load`,
    });
  },
  errorInitialization(error: unknown) {
    return LogFormatter.globalFormatter({
      logEmoji: "❌",
      logName: `${styles.redBackground}INITIALIZATION ERROR${styles.reset}`,
      error,
    });
  },
  displayAllGuilds(guilds: Collection<string, Guild>) {
    return LogFormatter.globalFormatter({
      logEmoji: "🌎",
      logName: `Connected Discord Servers: ${guilds.size}`,
      guilds,
    });
  },
  mongoConnectionSuccess(mongoName: string) {
    return LogFormatter.globalFormatter({
      logEmoji: "🛢️",
      logName: `MongoDB Connection Success: ${mongoName}`,
    });
  },
  mongoConnectionError(mongoName: string, error: Error) {
    return LogFormatter.globalFormatter({
      logEmoji: "❌",
      logName: `MongoDB Connection Error: ${mongoName}`,
      error,
    });
  },
  isMessageAskingToGenerateImage(
    message: Message,
    isMessageAskingToGenerateImage: boolean,
  ) {
    return LogFormatter.globalFormatter({
      logEmoji: isMessageAskingToGenerateImage ? "🖼️" : "🖼️",
      logName: isMessageAskingToGenerateImage
        ? `${styles.greenBackground}MESSAGE IS ASKING TO GENERATE IMAGE${styles.reset}`
        : `${styles.redBackground}MESSAGE IS NOT ASKING TO GENERATE IMAGE${styles.reset}`,
      message,
    });
  },
};

export default LogFormatter;
