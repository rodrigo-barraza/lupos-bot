/**
 * AccountGuardService — Centralized new-account kick logic.
 *
 * Deduplicates the account-age check that was repeated in both
 * luposOnGuildMemberAdd() and luposOnReadyDeleteNewAccounts().
 */

import config from "#root/secrets.js";
import { ACCOUNT_AGE_THRESHOLD_MS } from "#root/constants.js";

/**
 * Kick a member if their Discord account is too new (< 4 weeks old)
 * and they are not on the whitelist.
 *
 * @param {GuildMember} member - The Discord guild member.
 * @param {string} callerName - The calling function name (for logging).
 * @returns {boolean} true if the member was kicked, false otherwise.
 */
export async function kickIfTooNew(member, callerName = "AccountGuard") {
  if (member.user.bot) return false;

  const accountAge = Date.now() - member.user.createdAt.getTime();
  const isWhitelisted = config.USER_IDS_NEW_ACCOUNT_WHITELIST?.includes(
    member.id,
  );

  if (accountAge < ACCOUNT_AGE_THRESHOLD_MS && !isWhitelisted) {
    const ageDays = Math.floor(accountAge / (24 * 60 * 60 * 1000));
    console.log(
      `[${callerName}] Kicking new account: ${member.user.username} (${member.id}), account age: ${ageDays} days`,
    );
    try {
      await member.kick(`Account too new (${ageDays} days old)`);
      return true;
    } catch (error) {
      console.error(
        `[${callerName}] Failed to kick ${member.user.username}:`,
        error,
      );
    }
  }

  return false;
}

/**
 * IDs for the "forbidden combo" auto-kick rule.
 * If a member holds BOTH of these roles simultaneously, they are kicked.
 */
const FORBIDDEN_COMBO_ROLE_IDS = [
  "609477071776907388",   // Horde (warcraftFactions)
  "1384647483707097149",  // Apex Legends (rolesVideogames)
];

/**
 * Kick a member if they hold both roles in the forbidden combo
 * (currently: Horde + Apex Legends).
 *
 * @param {GuildMember} member - The Discord guild member to check.
 * @param {string} callerName - The calling function name (for logging).
 * @returns {boolean} true if the member was kicked, false otherwise.
 */
export async function kickIfForbiddenCombo(member, callerName = "AccountGuard") {
  if (member.user.bot) return false;

  const hasBoth = FORBIDDEN_COMBO_ROLE_IDS.every((roleId) =>
    member.roles.cache.has(roleId),
  );

  if (!hasBoth) return false;

  const comboNames = FORBIDDEN_COMBO_ROLE_IDS.map((id) => {
    const role = member.guild.roles.cache.get(id);
    return role ? role.name : id;
  }).join(" + ");

  console.log(
    `[${callerName}] Kicking ${member.user.username} (${member.id}) for forbidden role combo: ${comboNames}`,
  );

  try {
    await member.kick(`Forbidden role combo: ${comboNames}`);
    return true;
  } catch (error) {
    console.error(
      `[${callerName}] Failed to kick ${member.user.username}:`,
      error,
    );
  }

  return false;
}

export default { kickIfTooNew, kickIfForbiddenCombo };
