// ============================================================
// BirthdayOnboarding — DM month-picker for new members
// ============================================================
// When a new member finishes onboarding in the primary guild, Lupos
// DMs them a one-time prompt with 12 month buttons. Their pick is
// stored in
// the "UserBirthdays" Mongo collection (keyed by Discord user id)
// and BirthdayJob unions it with the hardcoded birthdays array to
// assign the birthday role each month. Users can change their
// answer anytime by clicking a different month — the handler
// simply upserts and re-renders. This is the ONLY DM surface the
// bot has: conversational DMs are ignored in processMessage.
// ============================================================

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { ButtonInteraction, Client, GuildMember } from "discord.js";

import config from "#root/config.js";
import { MONGO_DB_NAME } from "#root/constants.js";
import MongoService from "#root/services/MongoService.js";
import ButtonRouter from "#root/services/discord/ButtonRouter.js";

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const BIRTHDAY_BUTTON_PREFIX = "birthday-month-";
const COLLECTION_NAME = "UserBirthdays";

// Whitemane guild emoji used to brand the DM (renders in embed
// descriptions only — Discord doesn't render custom emojis in titles).
const WHITEMANE_EMOJI = "<:whitemanejudge:880889135555047424>";

// Discord API error: "Cannot send messages to this user" (DMs closed)
const ERROR_CODE_DMS_CLOSED = 50007;

export interface UserBirthdayDocument {
  userId: string;
  username: string;
  month: string;
  monthNumber: number; // 1-12
  updatedAt: Date;
}

function getCollection() {
  return MongoService.getDb("local").collection<UserBirthdayDocument>(
    COLLECTION_NAME,
  );
}

/**
 * Build the 12 month buttons (3 rows of 4). The currently stored
 * month renders green so the picker doubles as confirmation.
 */
export function buildMonthButtonRows(selectedMonthNumber?: number) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let columnIndex = 0; columnIndex < 4; columnIndex++) {
      const monthNumber = rowIndex * 4 + columnIndex + 1;
      row.addComponents(
        new ButtonBuilder()
          .setLabel(MONTHS[monthNumber - 1])
          .setCustomId(`${BIRTHDAY_BUTTON_PREFIX}${monthNumber}`)
          .setStyle(
            monthNumber === selectedMonthNumber
              ? ButtonStyle.Success
              : ButtonStyle.Secondary,
          ),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildPromptEmbed(selectedMonth?: string) {
  const embed = new EmbedBuilder().setColor("#FFD700");
  if (selectedMonth) {
    embed
      .setTitle(`🎂 ${selectedMonth} — so it is written.`)
      .setDescription(
        `${WHITEMANE_EMOJI} When **${selectedMonth}** arrives, the Monastery ` +
          `bells will ring and you'll receive the **birthday role** — *arise, ` +
          `my champion*, it's your month to be celebrated across Whitemane.\n\n` +
          `Picked the wrong one? Just click another month below.`,
      );
  } else {
    embed
      .setTitle("Welcome to Classic Whitemane!")
      .setDescription(
        `${WHITEMANE_EMOJI} So you made it past the Monastery gates — welcome ` +
          `to **Classic Whitemane**. I'm **Lupos**, the wolf who prowls these ` +
          `scarlet halls. The Inquisitor runs her Crusade; the pack answers to me.\n\n` +
          `Tell me your **birthday month**, and when it arrives you'll be ` +
          `granted the **🎂 birthday role** — your month to rise as the pack's ` +
          `champion and be celebrated across the server.\n\n` +
          `Just the month — no year, no date. The Inquisition keeps records; ` +
          `I don't. Pick below, and change it anytime by clicking another month.`,
      )
      .setFooter({
        text: "Heads up — I don't reply to DMs. Come find me in the server instead.",
      });
  }
  return embed;
}

/**
 * Immediately add/remove the birthday role after a pick so the user
 * doesn't wait up to 24h for BirthdayJob's next sweep.
 */
async function syncBirthdayRole(
  client: Client,
  userId: string,
  monthNumber: number,
) {
  const guildId = config.GUILD_ID_PRIMARY;
  const roleId = config.ROLE_ID_BIRTHDAY_MONTH;
  if (!guildId || !roleId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const isCurrentMonth = monthNumber === new Date().getMonth() + 1;
  try {
    if (isCurrentMonth) {
      await member.roles.add(roleId);
    } else if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
    }
  } catch (error: unknown) {
    console.error(
      `❌ [BirthdayOnboarding] Failed to sync birthday role for ${member.user.username}:`,
      error,
    );
  }
}

const BirthdayOnboarding = {
  /**
   * Role re-sync only, no DM — used on guildMemberAdd so rejoining
   * members who already picked a month get their birthday role back
   * even if they stall in onboarding. The DM prompt itself is sent
   * by sendBirthdayPrompt once onboarding completes.
   */
  async syncExistingBirthday(client: Client, member: GuildMember) {
    const functionName = "syncExistingBirthday";
    if (member.user.bot) return;

    let existing: UserBirthdayDocument | null;
    try {
      existing = await getCollection().findOne({ userId: member.id });
    } catch (error: unknown) {
      console.error(
        `❌ [${functionName}] Mongo lookup failed for ${member.user.username}:`,
        error,
      );
      return;
    }

    if (existing) {
      await syncBirthdayRole(client, member.id, existing.monthNumber);
    }
  },

  /**
   * DM a member the birthday month picker once they complete
   * onboarding. Skips bots, members who already answered (rejoins),
   * and users with DMs closed.
   */
  async sendBirthdayPrompt(client: Client, member: GuildMember) {
    const functionName = "sendBirthdayPrompt";
    if (member.user.bot) return;

    let existing: UserBirthdayDocument | null;
    try {
      existing = await getCollection().findOne({ userId: member.id });
    } catch (error: unknown) {
      console.error(
        `❌ [${functionName}] Mongo lookup failed for ${member.user.username}:`,
        error,
      );
      return;
    }

    // Rejoining member who already told us — just re-sync the role.
    if (existing) {
      await syncBirthdayRole(client, member.id, existing.monthNumber);
      return;
    }

    try {
      await member.send({
        embeds: [buildPromptEmbed()],
        components: buildMonthButtonRows(),
      });
      console.log(
        `🎂 [${functionName}] Sent birthday onboarding DM to ${member.user.username}`,
      );
    } catch (error: unknown) {
      const code = (error as { code?: number }).code;
      if (code === ERROR_CODE_DMS_CLOSED) {
        console.log(
          `🎂 [${functionName}] ${member.user.username} has DMs closed — skipping birthday prompt`,
        );
      } else {
        console.error(
          `❌ [${functionName}] Failed to DM ${member.user.username}:`,
          error,
        );
      }
    }
  },

  /**
   * Read all stored birthdays for a month (1-12). Used by
   * BirthdayJob to union with the hardcoded birthdays array.
   */
  async getUserIdsForMonth(
    mongo: import("mongodb").MongoClient,
    monthNumber: number,
  ): Promise<string[]> {
    const documents = await mongo
      .db(MONGO_DB_NAME)
      .collection<UserBirthdayDocument>(COLLECTION_NAME)
      .find({ monthNumber })
      .toArray();
    return documents.map((document) => document.userId);
  },
};

async function handleBirthdayMonthButton(
  client: Client,
  interaction: ButtonInteraction,
) {
  const functionName = "handleBirthdayMonthButton";
  const monthNumber = Number(
    interaction.customId.slice(BIRTHDAY_BUTTON_PREFIX.length),
  );
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return;
  }
  const month = MONTHS[monthNumber - 1];

  try {
    await getCollection().updateOne(
      { userId: interaction.user.id },
      {
        $set: {
          userId: interaction.user.id,
          username: interaction.user.username,
          month,
          monthNumber,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error: unknown) {
    console.error(
      `❌ [${functionName}] Failed to save birthday for ${interaction.user.username}:`,
      error,
    );
    await interaction
      .reply({
        content: "Something went wrong saving your pick — try again in a bit!",
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  console.log(
    `🎂 [${functionName}] ${interaction.user.username} set birthday month to ${month}`,
  );

  await syncBirthdayRole(client, interaction.user.id, monthNumber);

  await interaction.update({
    embeds: [buildPromptEmbed(month)],
    components: buildMonthButtonRows(monthNumber),
  });
}

ButtonRouter.register(BIRTHDAY_BUTTON_PREFIX, handleBirthdayMonthButton);

export default BirthdayOnboarding;
