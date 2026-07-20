// ============================================================
// Console utilities — styled terminal logging and ANSI helpers.
// ============================================================

import TemporalHelpers from "#root/utilities/TemporalHelpers.ts";

export interface StyleOptions {
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

export function consoleLog(
  symbol: string,
  message: string | null | undefined,
  styleOptions: StyleOptions = {},
) {
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
    let finalOutput = `${time} - `;
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
}

export function ansiEscapeCodes(isConsoleLog: boolean = false) {
  const bold = (text: string) =>
    isConsoleLog ? `\x1b[1m${text}\x1b[0m` : text;
  const faint = (text: string) =>
    isConsoleLog ? `\x1b[2m${text}\x1b[0m` : text;
  const italic = (text: string) =>
    isConsoleLog ? `\x1b[3m${text}\x1b[0m` : text;
  const underline = (text: string) =>
    isConsoleLog ? `\x1b[4m${text}\x1b[0m` : text;
  const slowBlink = (text: string) =>
    isConsoleLog ? `\x1b[5m${text}\x1b[0m` : text;
  const rapidBlink = (text: string) =>
    isConsoleLog ? `\x1b[6m${text}\x1b[0m` : text;
  const inverse = (text: string) =>
    isConsoleLog ? `\x1b[7m${text}\x1b[0m` : text;
  const hidden = (text: string) =>
    isConsoleLog ? `\x1b[8m${text}\x1b[0m` : text;
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
}
