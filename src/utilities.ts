import TemporalHelpers from "#root/utilities/TemporalHelpers.js";
import crypto from "crypto";
import type { Guild, GuildMember, MessageReaction, Role, User } from "discord.js";

interface UserOrMemberParam {
  user?: User | null;
  member?: GuildMember | null;
}

interface StyleOptions {
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  underline?: boolean;
  slowBlink?: boolean;
  rapidBlink?: boolean;
  crossedOut?: boolean;
  doubleUnderline?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  color?: string | null;
}

const utilities = {
  // Crypto utilities
  async generateFileHash(url: string) {
    try {
      if (!url) {
        throw new Error(`generateFileHash called with invalid URL: ${url}`);
      }
      const response = await fetch(url);
      if (!response.ok) {
        // 404 is expected for stale Discord CDN URLs (changed avatars/banners)
        if (response.status === 404) return null;
        throw new Error(
          `generateFileHash received HTTP ${response.status} for URL: ${url}`,
        );
      }
      const bytes = await response.bytes();
      const buffer = Buffer.from(bytes);
      const fileType = response.headers.get("content-type");

      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      return { hash, fileType };
    } catch (error: unknown) {
      console.log(
        `❌ [utilities:generateFileHash] Error generating hash:\n`,
        `${error}`,
      );
      return null;
    }
  },
  // String utilities
  capitalize(string: string) {
    if (string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    }
  },

  /**
   * Convert bare @SNOWFLAKE_ID patterns to proper Discord mention syntax.
   * The AI sometimes outputs "@124296008548089858" instead of "<@124296008548089858>".
   * It also sometimes drops the <@ prefix entirely, producing "166745313258897409>".
   * Discord snowflake IDs are 17-20 digit numbers.
   * Only matches patterns that are NOT already wrapped in <@...>.
   */
  fixBareMentions(string: string) {
    // Pass 1: Fix orphaned "DIGITS>" — missing <@ prefix (e.g. "166745313258897409>")
    // Negative lookbehind ensures we don't re-wrap already-valid <@ID> mentions
    let result = string.replace(/(?<!<@!?)(?<!\d)(\d{17,20})>/g, '<@$1>');
    // Pass 2: Fix bare "@DIGITS" — missing angle brackets (e.g. "@166745313258897409")
    result = result.replace(/(?<!<)@(\d{17,20})(?!>)/g, '<@$1>');
    return result;
  },

  removeMentions(string: string) {
    return string
      .replace(/@here/g, "꩜here")
      .replace(/@everyone/g, "꩜everyone")
      .replace(/@horde/g, "꩜horde")
      .replace(/@alliance/g, "꩜alliance")
      .replace(/@Guild Leader - Horde/g, "꩜Guild Leader - Horde")
      .replace(/@Guild Leader - Alliance/g, "꩜Guild Leader - Alliance")
      .replace(/@Guild Officer - Horde/g, "꩜Guild Officer - Horde")
      .replace(/@Guild Officer - Alliance/g, "꩜Guild Officer - Alliance");
  },
  convertToSuperScript(string: string) {
    const superScriptMap: Record<string, string> = {
      0: "⁰",
      1: "¹",
      2: "²",
      3: "³",
      4: "⁴",
      5: "⁵",
      6: "⁶",
      7: "⁷",
      8: "⁸",
      9: "⁹",
      a: "ᵃ",
      b: "ᵇ",
      c: "ᶜ",
      d: "ᵈ",
      e: "ᵉ",
      f: "ᶠ",
      g: "ᵍ",
      h: "ʰ",
      i: "ⁱ",
      j: "ʲ",
      k: "ᵏ",
      l: "ˡ",
      m: "ᵐ",
      n: "ⁿ",
      o: "ᵒ",
      p: "ᵖ",
      q: "ᑫ",
      r: "ʳ",
      s: "ˢ",
      t: "ᵗ",
      u: "ᵘ",
      v: "ᵛ",
      w: "ʷ",
      x: "ˣ",
      y: "ʸ",
      z: "ᶻ",
      A: "ᴬ",
      B: "ᴮ",
      C: "ᶜ",
      D: "ᴰ",
      E: "ᴱ",
      F: "ᶠ",
      G: "ᴳ",
      H: "ᴴ",
      I: "ᴵ",
      J: "ᴶ",
      K: "ᴷ",
      L: "ᴸ",
      M: "ᴹ",
      N: "ᴺ",
      O: "ᴼ",
      P: "ᴾ",
      Q: "Q",
      R: "ᴿ",
      S: "ˢ",
      T: "ᵀ",
      U: "ᵁ",
      V: "ⱽ",
      W: "ᵂ",
      X: "ˣ",
      Y: "ʸ",
      Z: "ᶻ",
      "+": "⁺",
      "-": "⁻",
      "=": "⁼",
      "(": "⁽",
      ")": "⁾",
      ".": "˙",
      ",": "̓",
      " ": " ",
    };
    return string
      .split("")
      .map((char) => superScriptMap[char] || char)
      .join("");
  },
  // Fetch utilities
  async isImageUrl(url: string) {
    try {
      const response = await fetch(url);
      const contentType = response.headers.get("content-type");
      return contentType ? contentType.startsWith("image/") : false;
    } catch (error: unknown) {
      console.error(
        `❌ [utilities:isImageUrl] Error checking if URL is an image:\n`,
        `${error}`,
      );
      return false;
    }
  },
  // Date Utilities
  getCurrentDateAndTime(date: Date) {
    // 2024-01-31 03:45:27 PM
    return TemporalHelpers.format(TemporalHelpers.fromJSDate(date), "yyyy-MM-dd HH:mm:ss a");
  },
  getMinutesAgo(date: Date) {
    return TemporalHelpers.toRelative(TemporalHelpers.fromJSDate(date));
  },
  consoleLog(symbol: string, message: string | null | undefined, styleOptions: StyleOptions = {}) {
    const debugLevel = 3;
    if (!symbol) {
      return;
    }
    const resetStyle = "\x1b[0m";

    const stack = new Error().stack;
    const callerLine = stack ? stack.split("\n")[2] : "";
    let trimmedCallerLine = callerLine.trim().replace("at ", "");

    trimmedCallerLine = trimmedCallerLine
      .replace("as _", "_")
      .replace("[", "")
      .replace("]", "")
      .replace("(", "")
      .replace(")", "");
    const splitString = trimmedCallerLine.split(" ");
    let funcName: string;
    let lineLocation: string;
    if (splitString.length === 3) {
      funcName = splitString[0];
      lineLocation = splitString[2];
    } else {
      funcName = splitString[0];
      lineLocation = splitString[1];
    }

    // finalOutput += `\n\x1b[3m\x1b[37m${funcName} ${lineLocation}\x1b[0m`;

    // --- Constants for styling ---
    const colorCodes: Record<string, number> = {
      black: 30,
      red: 31,
      green: 32,
      yellow: 33,
      blue: 34,
      magenta: 35,
      cyan: 36,
      white: 37,
      orange: 33,
    };

    const time = TemporalHelpers.format(TemporalHelpers.now(), "h:mm:ss a");

    let logText = "";

    const location = `\n${resetStyle}\x1b[2m\x1b[3m\x1b[37m(${lineLocation})${resetStyle}`;

    if (debugLevel >= 2) {
      if (symbol === "<") {
        logText = `${symbol}${funcName}`;
      } else if (symbol === ">" || symbol === "=") {
        logText = `${symbol}${funcName}`;
      }
    }

    if (message !== undefined && message !== null) {
      logText += `\n${message}`;
    }

    if (debugLevel >= 3) {
      if (symbol === "<") {
        logText += location;
      }
    }

    const {
      bold = false,
      faint = false,
      italic = false,
      underline = false,
      slowBlink = false,
      rapidBlink = false,
      crossedOut = false,
      doubleUnderline = false,
      superscript = false, // Note: Support varies widely across terminals
      subscript = false, // Note: Support varies widely across terminals
      color = null, // Default to no color
    } = styleOptions;

    const styleCodeList = [
      bold ? "1" : "",
      faint ? "2" : "",
      italic ? "3" : "",
      underline ? "4" : "",
      slowBlink ? "5" : "",
      rapidBlink ? "6" : "",
      crossedOut ? "9" : "",
      doubleUnderline ? "21" : "",
      superscript ? "73" : "",
      subscript ? "74" : "",
    ].filter((code) => code); // Remove empty strings

    // Add color code if specified and valid
    const lowerCaseColor = color ? String(color).toLowerCase() : null;
    if (lowerCaseColor && colorCodes[lowerCaseColor]) {
      styleCodeList.push(colorCodes[lowerCaseColor].toString());
    }

    if (symbol === "<") {
      styleCodeList.push("1");
      styleCodeList.push("34");
    } else if (symbol === ">") {
      styleCodeList.push("1");
      styleCodeList.push("32");
    } else if (symbol === ">!") {
      styleCodeList.push("1");
      styleCodeList.push("31");
    } else if (symbol === "=") {
      styleCodeList.push("33");
    }

    if (logText.length) {
      let finalOutput = "";
      finalOutput = `${time} - `;
      if (styleCodeList.length > 0) {
        const stylePrefix = `\x1b[${styleCodeList.join(";")}m`;
        finalOutput += `${stylePrefix}${logText}${resetStyle}`;
      } else {
        // No styles applied
        finalOutput += logText;
      }

      if (debugLevel === 3) {
        if (symbol === ">" || symbol === "=") {
          finalOutput += ` ${location}`;
        }
      }

      console.info(finalOutput);
    }
  },
  howl() {
    let howl = "Aw";
    const randomize = Math.floor(Math.random() * 10) + 1;
    for (let i = 0; i < randomize; i++) {
      howl = howl + "o";
    }
    howl = howl + "!";
    return howl;
  },
  // Array utilities
  areArraysEqual(array1: Record<string, unknown>[], array2: Record<string, unknown>[]) {
    return (
      array1.length === array2.length &&
      array1.every((item1) =>
        array2.some(
          (item2) =>
            Object.keys(item1).length === Object.keys(item2).length &&
            Object.entries(item1).every(
              ([key, value]) =>
                Object.prototype.hasOwnProperty.call(item2, key) &&
                item2[key] === value,
            ),
        ),
      ) &&
      array2.every((item1) =>
        array1.some(
          (item2) =>
            Object.keys(item1).length === Object.keys(item2).length &&
            Object.entries(item1).every(
              ([key, value]) =>
                Object.prototype.hasOwnProperty.call(item2, key) &&
                item2[key] === value,
            ),
        ),
      )
    );
  },
  // Console utilities
  ansiEscapeCodes(isConsoleLog: boolean = false) {
    const bold = (text: string) => (isConsoleLog ? `\x1b[1m${text}\x1b[0m` : text);
    const faint = (text: string) => (isConsoleLog ? `\x1b[2m${text}\x1b[0m` : text);
    const italic = (text: string) => (isConsoleLog ? `\x1b[3m${text}\x1b[0m` : text);
    const underline = (text: string) => (isConsoleLog ? `\x1b[4m${text}\x1b[0m` : text);
    const slowBlink = (text: string) => (isConsoleLog ? `\x1b[5m${text}\x1b[0m` : text);
    const rapidBlink = (text: string) =>
      isConsoleLog ? `\x1b[6m${text}\x1b[0m` : text;
    const inverse = (text: string) => (isConsoleLog ? `\x1b[7m${text}\x1b[0m` : text);
    const hidden = (text: string) => (isConsoleLog ? `\x1b[8m${text}\x1b[0m` : text);
    const strikethrough = (text: string) =>
      isConsoleLog ? `\x1b[9m${text}\x1b[0m` : text;
    return {
      bold,
      faint,
      italic,
      underline,
      slowBlink,
      rapidBlink,
      inverse,
      hidden,
      strikethrough,
    };
  },
  getCombinedNamesFromUserOrMember({ user, member }: UserOrMemberParam, isConsoleLog: boolean = false) {
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    const parts: string[] = [];

    if (member) {
      if (member.nickname) parts.push(bold(member.nickname));
      if (!member.nickname && member.user?.globalName)
        parts.push(bold(member.user?.globalName));
      if (member.user?.username) parts.push(member.user.username);
      if (member.user?.globalName && member.nickname)
        parts.push(member.user.globalName);
      if (member.user?.id) parts.push(faint(`<@${member.user.id}>`));
    } else if (user) {
      parts.push(bold(user.username));
      if (user.globalName) parts.push(user.globalName);
      if (!user.globalName && user.tag) {
        parts.push(`${user.tag}`);
      }
      parts.push(faint(`<@${user.id}>`));
    }

    return parts.join(" • ");
  },
  getCombinedGuildInformationFromGuild(guild: Guild | null, isConsoleLog: boolean = false) {
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    let combinedGuildInformation: string | undefined;
    if (guild) {
      combinedGuildInformation = `${bold(guild.name)} • ${faint(guild.id)}`;
    }
    return combinedGuildInformation;
  },
  getCombinedChannelInformationFromChannel(channel: { name: string; id: string } | null, isConsoleLog: boolean = false) {
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    let combinedChannelInformation: string | undefined;
    if (channel) {
      combinedChannelInformation = `#${bold(channel.name)} • ${faint(channel.id)}`;
    }
    return combinedChannelInformation;
  },
  getCombinedEmojiInformationFromReaction(reaction: MessageReaction | null, isConsoleLog: boolean = false) {
    if (!reaction) return;
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    const emoji = reaction.emoji;
    const parts: string[] = [];
    if (emoji) {
      parts.push(bold(emoji.name || "unknown"));
      if (emoji.id) {
        parts.push(faint(`<:${emoji.name}:${emoji.id}>`));
      }
    }
    return parts.join(" • ");
  },
  getCombinedRoleInformationFromRole(role: Role | null, isConsoleLog: boolean = false) {
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    let combinedRoleInformation: string | undefined;
    if (role) {
      combinedRoleInformation = `${bold(role.name)} • ${faint(role.id)}`;
    }
    return combinedRoleInformation;
  },
  getCombinedDateInformationFromDate(unixDate: number | null | undefined, isConsoleLog: boolean = false) {
    const { bold, faint } = utilities.ansiEscapeCodes(isConsoleLog);
    const effectiveDate = unixDate || Date.now();
    const dateTime = TemporalHelpers.fromMillis(effectiveDate);
    const time = TemporalHelpers.format(dateTime, "hh:mm:ss a");
    const date = TemporalHelpers.format(dateTime, "LLLL dd, yyyy");
    const combinedDateInformation = `${bold(time)} ${faint("on")} ${faint(date)} • ${faint(String(effectiveDate))}`;
    return combinedDateInformation;
  },
  /**
   * Build a Discord CDN avatar URL.
   * Handles animated avatars (a_ prefix → .gif) vs static (.png).


   */
  getDiscordAvatarUrl(userId: string, avatarHash: string, size: number = 512) {
    if (!userId || !avatarHash) return null;
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
  },
  /**
   * Build a Discord CDN banner URL.
   * Handles animated banners (a_ prefix → .gif) vs static (.png).


   */
  getDiscordBannerUrl(userId: string, bannerHash: string, size: number = 512) {
    if (!userId || !bannerHash) return null;
    const ext = bannerHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.${ext}?size=${size}`;
  },
  /**
   * Format a millisecond duration into a human-readable string.

   */
  formatTimeSpan(ms: number) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  },
  /**
   * Build a Discord message URL.


   */
  getDiscordMessageUrl(guildId: string, channelId: string, messageId: string) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
  },
  /**
   * Format a millisecond duration as playback time (m:ss).

   */
  formatPlaybackTime(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  },
  /**
   * Return a random integer between minMs and maxMs (inclusive).


   */
  getRandomInterval(minMs: number, maxMs: number) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  },
  /**
   * Fetch a URL with an AbortController timeout.
   * Returns parsed JSON on success, null on failure / timeout.


   */
  async fetchWithTimeout(url: string, timeoutMs: number = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
  /**
   * Format a Discord.js reactions cache into a human-readable string.


   *   - "list":   "\n- emoji x count (by you, Lupos)"
   *   - "inline": "emoji(by you, Lupos), emoji2"
   *   - "names":  "emoji, emoji2" (names only, no counts)
   */
  formatReactions(reactionsCache: Map<string, MessageReaction> | null | undefined, format: "list" | "inline" | "names" = "list") {
    if (!reactionsCache?.size) return "";
    const entries = [...reactionsCache.values()];
    switch (format) {
      case "inline":
        return entries
          .map((r) => `${r.emoji.name}${r.me ? " (by you, Lupos)" : ""}`)
          .join(", ");
      case "names":
        return entries.map((r) => r.emoji.name).join(", ");
      case "list":
      default:
        return entries
          .map((r) => `- ${r.emoji.name} x ${r.count}${r.me ? " (by you, Lupos)" : ""}`)
          .join("\n");
    }
  },
};

export default utilities;
