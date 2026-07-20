// ============================================================
// utilities — façade over the domain-split utility modules.
//
// Implementations live in src/utilities/*:
//   strings.ts        — text/mention/superscript helpers
//   discord-format.ts — Discord display formatting + CDN URLs
//   net.ts            — fetch-based helpers
//   console.ts        — styled terminal logging
//   misc.ts           — array comparison, random intervals
//
// `capitalize` and `errorMessage` come straight from
// @rodrigo-barraza/utilities-library (no local wrappers).
//
// Kept as a single default-export object so the ~40 existing
// `import utilities from "#root/utilities.ts"` call sites keep
// working unchanged.
// ============================================================

import { capitalize, errorMessage } from "@rodrigo-barraza/utilities-library";
import {
  convertToSuperScript,
  fixBareMentions,
  howl,
  removeMentions,
} from "#root/utilities/strings.ts";
import {
  formatPlaybackTime,
  formatReactions,
  formatTimeSpan,
  getCombinedChannelInformationFromChannel,
  getCombinedDateInformationFromDate,
  getCombinedEmojiInformationFromReaction,
  getCombinedGuildInformationFromGuild,
  getCombinedNamesFromUserOrMember,
  getCombinedRoleInformationFromRole,
  getDiscordAvatarUrl,
  getDiscordBannerUrl,
  getDiscordMessageUrl,
  getMinutesAgo,
} from "#root/utilities/discord-format.ts";
import { generateFileHash, isImageUrl } from "#root/utilities/net.ts";
import { ansiEscapeCodes, consoleLog } from "#root/utilities/console.ts";
import { areArraysEqual, getRandomInterval } from "#root/utilities/misc.ts";

const utilities = {
  // Crypto/network utilities
  generateFileHash,
  isImageUrl,
  // String utilities
  capitalize,
  fixBareMentions,
  removeMentions,
  convertToSuperScript,
  howl,
  // Array utilities
  areArraysEqual,
  getRandomInterval,
  // Console utilities
  consoleLog,
  ansiEscapeCodes,
  // Discord display formatting
  getCombinedNamesFromUserOrMember,
  getCombinedGuildInformationFromGuild,
  getCombinedChannelInformationFromChannel,
  getCombinedEmojiInformationFromReaction,
  getCombinedRoleInformationFromRole,
  getCombinedDateInformationFromDate,
  getDiscordAvatarUrl,
  getDiscordBannerUrl,
  getDiscordMessageUrl,
  formatReactions,
  formatTimeSpan,
  formatPlaybackTime,
  getMinutesAgo,
  // Library pass-throughs
  errorMessage,
};

export default utilities;
