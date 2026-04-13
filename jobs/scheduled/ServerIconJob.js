import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import utilities from "#root/utilities.js";

const { consoleLog } = utilities;

const INTERVAL_MIN_MS = 3 * 60 * 1000;  // 3 minutes
const INTERVAL_MAX_MS = 10 * 60 * 1000; // 10 minutes
const IMAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../images/april-fools",
);

let lastUsedImage = null;

function getRandomInterval() {
  return utilities.getRandomInterval(INTERVAL_MIN_MS, INTERVAL_MAX_MS);
}

async function rotateIcon({ client, guildId }) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      consoleLog("!", `[ServerIconJob] Guild ${guildId} not found`);
      return;
    }

    // Read all image files from the directory
    const files = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));

    if (files.length === 0) {
      consoleLog("!", `[ServerIconJob] No images found in ${IMAGES_DIR}`);
      return;
    }

    // Pick a random image, avoiding the same one twice in a row
    let chosen;
    if (files.length === 1) {
      chosen = files[0];
    } else {
      do {
        chosen = files[Math.floor(Math.random() * files.length)];
      } while (chosen === lastUsedImage);
    }
    lastUsedImage = chosen;

    const imagePath = path.join(IMAGES_DIR, chosen);
    const imageBuffer = fs.readFileSync(imagePath);

    await guild.setIcon(imageBuffer, "April Fools icon rotation 🐱");

    consoleLog(
      "=",
      `[ServerIconJob] 🖼️ Updated server icon to: ${chosen}`,
    );
  } catch (error) {
    consoleLog("!", `[ServerIconJob] Error: ${error.message}`);
    console.error(error);
  }
}

const ServerIconJob = {
  startJob({ client, guildId }) {
    const scheduleNext = () => {
      const delay = getRandomInterval();
      const delayMinutes = (delay / 60_000).toFixed(1);
      consoleLog(
        "=",
        `[ServerIconJob] 🖼️ Next icon rotation in ${delayMinutes} minutes`,
      );
      setTimeout(async () => {
        await rotateIcon({ client, guildId });
        scheduleNext();
      }, delay);
    };

    consoleLog(
      "=",
      `[ServerIconJob] 🖼️ Starting server icon rotation (3-30 min interval) for guild ${guildId}`,
    );

    // Initial delay then start the loop
    setTimeout(() => {
      rotateIcon({ client, guildId }).then(scheduleNext);
    }, 5_000);
  },
};

export default ServerIconJob;
