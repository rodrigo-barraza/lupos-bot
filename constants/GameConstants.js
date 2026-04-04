/**
 * GameConstants — Game activity to Discord role mappings.
 *
 * Used by luposOnPresenceUpdate() to auto-assign game roles
 * when users play specific games.
 */

export const GAME_ROLE_MAPPINGS = [
  { activityName: "apex legends", roleName: "apex legends" },
  { activityName: "ashes of creation", roleName: "ashes of creation" },
  { activityName: "counter-strike", roleName: "counter-strike" },
  { activityName: "deadlock", roleName: "deadlock" },
  { activityName: "diablo", roleName: "diablo" },
  { activityName: "dota", roleName: "dota 2" },
  { activityName: "fortnite", roleName: "fortnite" },
  { activityName: "league of legends", roleName: "league of legends" },
  { activityName: "marvel rivals", roleName: "marvel rivals" },
  { activityName: "minecraft", roleName: "minecraft" },
  { activityName: "overwatch", roleName: "overwatch" },
  { activityName: "runelite", roleName: "runescape" },
  { activityName: "the sims", roleName: "the sims" },
  { activityName: "valorant", roleName: "valorant" },
  { activityName: "warhammer", roleName: "warhammer" },
];

/**
 * Maintenance mode explosion GIFs.
 * Shown when the bot is under maintenance and a user mentions it.
 */
export const EXPLOSION_GIFS = [
  "https://tenor.com/view/house-explosion-explode-boom-kaboom-gif-19506150",
  "https://tenor.com/view/bingbangboom-will-ferrell-anchorman-gif-27377989",
  "https://tenor.com/view/explosion-cat-gif-5858640239144030160",
  "https://tenor.com/view/aunt-may-may-parker-spider-man-explosion-reversed-gif-14580976912125554154",
  "https://tenor.com/view/explosion-gif-18109706",
  "https://tenor.com/view/running-explosion-gif-21340471",
  "https://tenor.com/view/explosion-explode-clouds-of-smoke-gif-17216934",
  "https://tenor.com/view/explosion-missile-cat-dancing-yippe-gif-3015672001210922862",
  "https://tenor.com/view/cat-brick-nuke-explosion-gif-10450514456976550076",
  "https://tenor.com/view/cat-explosion-gif-25536604",
  "https://tenor.com/view/splooge-sploosh-take-that-gif-24820474",
  "https://tenor.com/view/this-is-my-kingdom-come-gif-22105215",
  "https://tenor.com/view/lazy-eye-gif-8849457",
  "https://tenor.com/view/house-monster-gif-22761469",
];

/**
 * YouTube interaction button action map.
 * Maps interaction customId to the corresponding YouTubeService method.
 */
export const YOUTUBE_BUTTON_ACTIONS = {
  volumeUp: { method: "setVolumeByAmount", args: [5] },
  volumeDown: { method: "setVolumeByAmount", args: [-5] },
  pause: { method: "buttonPause", args: [] },
  resume: { method: "buttonResume", args: [] },
  next: { method: "buttonNext", args: [] },
};

/**
 * Account guard constants.
 */
export const ACCOUNT_AGE_THRESHOLD_MS = 28 * 24 * 60 * 60 * 1000; // 4 weeks
