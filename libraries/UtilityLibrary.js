const moment = require('moment');
const { DateTime } = require('luxon');
const config = require('../config.json');
const crypto = require('crypto');

const UtilityLibrary = {
    // Crypto utilities
    async generateFileHash(url) {
        try {
            const response = await fetch(url);
            const bytes = await response.bytes();
            const buffer = Buffer.from(bytes);
            const fileType = response.headers.get('content-type');
            
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            return { hash, fileType };
        } catch (error) {
            console.log(`❌ [UtilityLibrary:generateFileHash] Error generating hash:\n`, `${error}`);
            throw error;
        }
    },
    // String utilities
    capitalize(string) {
        if (string) {
            return string.charAt(0).toUpperCase() + string.slice(1);
        }
    },
    removeFlaggedWords(string) {
        const flaggedWordsArray = config.FLAGGED_WORDS.split(", ");
        for (const word of flaggedWordsArray) {
            const regex = new RegExp(`\\b${word}\\b`, "gi");
            string = string.replace(regex, (match) => `||${'*'.repeat(match.length)}||`);
        }
        return string;
    },
    removeMentions(string) {
        return string
        .replace(/@here/g, '꩜here')
        .replace(/@everyone/g, '꩜everyone')
        .replace(/@horde/g, '꩜horde')
        .replace(/@alliance/g, '꩜alliance')
        .replace(/@alliance/g, '꩜alliance')
        .replace(/@Guild Leader - Horde/g, '꩜Guild Leader - Horde')
        .replace(/@Guild Leader - Alliance/g, '꩜Guild Leader - Alliance')
        .replace(/@Guild Officer - Horde/g, '꩜Guild Officer - Horde')
        .replace(/@Guild Officer - Alliance/g, '꩜Guild Officer - Alliance')
    },
    // Fetch utilities
    async isImageUrl(url) {
        try {
            const response = await fetch(url);
            const contentType = response.headers.get('content-type');
            return contentType.startsWith('image/');
        } catch (error) {
            console.error(`❌ [UtilityLibrary:isImageUrl] Error checking if URL is an image:\n`, `${error}`);
            return false;
        }
    },
    // Date Utilities
    getCurrentDateAndTime(date) {
        // 2024-01-31 03:45:27 PM
        return DateTime.fromJSDate(date).toFormat('yyyy-MM-dd HH:mm:ss a');
    },
    getMinutesAgo(date) {
        return DateTime.fromJSDate(date).toRelative();
    },
    consoleLog(symbol, message, styleOptions = {}) {
        const debugLevel = 3;
        if (!symbol) {
            return;
        }
        const resetStyle = "\x1b[0m";
        
        const stack = new Error().stack;
        // console.log(stack);
        const callerLine = stack.split('\n')[2];
        let trimmedCallerLine = callerLine.trim().replace('at ', '');

        trimmedCallerLine = trimmedCallerLine.replace('as _', '_').replace('[', '').replace(']', '').replace('(', '').replace(')', '');
        const splitString = trimmedCallerLine.split(' ');
        // console.log(splitString);
        let funcName;
        let lineLocation;
        if (splitString.length === 3) {
            funcName = splitString[0];
            lineLocation = splitString[2];
        } else {
            funcName = splitString[0];
            lineLocation = splitString[1];
        }

        
        // finalOutput += `\n\x1b[3m\x1b[37m${funcName} ${lineLocation}\x1b[0m`;
    
        // --- Constants for styling ---
        const colorCodes = {
            'black': 30, 'red': 31, 'green': 32, 'yellow': 33,
            'blue': 34, 'magenta': 35, 'cyan': 36, 'white': 37,
            'orange': 33,
        };
    
        const time = DateTime.now().toFormat('h:mm:ss a');
    

        let logText = '';

        const location = `\n${resetStyle}\x1b[2m\x1b[3m\x1b[37m(${lineLocation})${resetStyle}`


        if (debugLevel >= 2) {
            if (symbol === '<') {
                logText = `${symbol}${funcName}`;
            } else if (symbol === '>' || symbol === '=') {
                logText = `${symbol}${funcName}`;
            }
        }

        if (message !== undefined && message !== null) {
            logText += `\n${message}`;
        }

        if (debugLevel >= 3) {
            if (symbol === '<') {
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
            subscript = false,   // Note: Support varies widely across terminals
            color = null      // Default to no color
        } = styleOptions;
    
        const styleCodeList = [
            bold ? '1' : '',
            faint ? '2' : '',
            italic ? '3' : '',
            underline ? '4' : '',
            slowBlink ? '5' : '',
            rapidBlink ? '6' : '',
            crossedOut ? '9' : '',
            doubleUnderline ? '21' : '',
            superscript ? '73' : '',
            subscript ? '74' : '',
        ].filter(code => code); // Remove empty strings
    
        // Add color code if specified and valid
        const lowerCaseColor = color ? String(color).toLowerCase() : null;
        if (lowerCaseColor && colorCodes[lowerCaseColor]) {
            styleCodeList.push(colorCodes[lowerCaseColor]);
        }

        if (symbol === '<') {
            styleCodeList.push('1');
            styleCodeList.push('34');
        } else if (symbol === '>') {
            styleCodeList.push('1');
            styleCodeList.push('32');
        } else if (symbol === '>!') {
            styleCodeList.push('1');
            styleCodeList.push('31');
        } else if (symbol === '=') {
            styleCodeList.push('33');
        }

        if (logText.length) {
            let finalOutput = '';
            finalOutput = `${time} - `;
            if (styleCodeList.length > 0) {
                const stylePrefix = `\x1b[${styleCodeList.join(';')}m`;
                finalOutput += `${stylePrefix}${logText}${resetStyle}`;
            } else {
                // No styles applied
                finalOutput += logText;
            }
    
            if (debugLevel === 3) {
                if (symbol === '>' || symbol === '=') {
                    finalOutput += ` ${location}`;
                }
            }
    
            console.info(finalOutput);
        } 
    },
    howl() {
        let howl = 'Aw';
        let randomize = Math.floor(Math.random() * 10) + 1;
        for (let i = 0; i < randomize; i++) {
            howl = howl + 'o';
        }
        howl = howl + '!';
        return howl;
    },
    // Array utilities
    areArraysEqual(array1, array2) {
        return array1.length === array2.length &&
        array1.every(item1 =>
            array2.some(item2 =>
            Object.keys(item1).length === Object.keys(item2).length &&
            Object.entries(item1).every(([key, val]) => item2.hasOwnProperty(key) && item2[key] === val)
            )
        ) &&
        array2.every(item1 =>
            array1.some(item2 =>
            Object.keys(item1).length === Object.keys(item2).length &&
            Object.entries(item1).every(([key, val]) => item2.hasOwnProperty(key) && item2[key] === val)
            )
        );
    },
    // Console utilities
    ansiEscapeCodes(isConsoleLog = false) {
        const bold = (text) => isConsoleLog ? `\x1b[1m${text}\x1b[0m` : text;
        const faint = (text) => isConsoleLog ? `\x1b[2m${text}\x1b[0m` : text;
        const italic = (text) => isConsoleLog ? `\x1b[3m${text}\x1b[0m` : text;
        const underline = (text) => isConsoleLog ? `\x1b[4m${text}\x1b[0m` : text;
        const slowBlink = (text) => isConsoleLog ? `\x1b[5m${text}\x1b[0m` : text;
        const rapidBlink = (text) => isConsoleLog ? `\x1b[6m${text}\x1b[0m` : text;
        const inverse = (text) => isConsoleLog ? `\x1b[7m${text}\x1b[0m` : text;
        const hidden = (text) => isConsoleLog ? `\x1b[8m${text}\x1b[0m` : text;
        const strikethrough = (text) => isConsoleLog ? `\x1b[9m${text}\x1b[0m` : text;
        return {
            bold,
            faint,
            italic,
            underline,
            slowBlink,
            rapidBlink,
            inverse,
            hidden,
            strikethrough
        };
    },
    getCombinedNamesFromUserOrMember({ user, member }, isConsoleLog = false) {
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        let parts = [];

        if (member) {
            if (member.nickname) parts.push(bold(member.nickname));
            if (!member.nickname && member.user?.globalName) parts.push(bold(member.user?.globalName));
            if (member.user?.username) parts.push(member.user.username);
            if (member.user?.globalName && member.nickname) parts.push(member.user.globalName);
            if (member.user?.id) parts.push(faint(`<@${member.user.id}>`));
        } else if (user) {
            parts.push(bold(user.username));
            if (user.globalName) parts.push(user.globalName);
            if (!user.globalName && user.tag) { parts.push(`${user.tag}`) }
            parts.push(faint(`<@${user.id}>`));
        }

        return parts.join(' • ');
    },
    getCombinedGuildInformationFromGuild(guild, isConsoleLog = false) {
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        let combinedGuildInformation;
        if (guild) {
            combinedGuildInformation = `${bold(guild.name)} • ${faint(guild.id)}`;
        }
        return combinedGuildInformation;
    },
    getCombinedChannelInformationFromChannel(channel, isConsoleLog = false) {
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        let combinedChannelInformation;
        if (channel) {
            combinedChannelInformation = `#${bold(channel.name)} • ${faint(channel.id)}`;
        }
        return combinedChannelInformation;
    },
    getCombinedEmojiInformationFromReaction(reaction, isConsoleLog = false) {
        if (!reaction) return;
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        const emoji = reaction._emoji;
        const parts = [];
        if (emoji) {
            parts.push(bold(emoji.name));
            if (emoji.id) {
                parts.push(faint(`<:${emoji.name}:${emoji.id}>`));
            }
        }
        return parts.join(' • ');
    },
    getCombinedRoleInformationFromRole(role, isConsoleLog = false) {
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        let combinedRoleInformation;
        if (role) {
            combinedRoleInformation = `${bold(role.name)} • ${faint(role.id)}`;
        }
        return combinedRoleInformation;
    },
    getCombinedDateInformationFromDate(unixDate, isConsoleLog = false) {
        const { bold, faint } = UtilityLibrary.ansiEscapeCodes(isConsoleLog);
        let combinedDateInformation;
        if (!unixDate) {
            unixDate = Date.now();
        }
        if (unixDate) {
            const dateTime = DateTime.fromMillis(unixDate);
            const time = dateTime.setZone('local').toFormat('hh:mm:ss a');
            const date = dateTime.setZone('local').toFormat('LLLL dd, yyyy');
            combinedDateInformation = `${bold(time)} ${faint('on')} ${faint(date)} • ${faint(unixDate)}`;
        }
        return combinedDateInformation;
    },
};

module.exports = UtilityLibrary;
