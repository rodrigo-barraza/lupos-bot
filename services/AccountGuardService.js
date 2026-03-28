/**
 * AccountGuardService — Centralized new-account kick logic.
 *
 * Deduplicates the account-age check that was repeated in both
 * luposOnGuildMemberAdd() and luposOnReadyDeleteNewAccounts().
 */

import config from "#root/config.js";
import { ACCOUNT_AGE_THRESHOLD_MS } from "#root/constants.js";

/**
 * Kick a member if their Discord account is too new (< 2 weeks old)
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

export default { kickIfTooNew };
