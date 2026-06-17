/**
 * AccountGuardService — Centralized new-account kick logic.
 *
 * Deduplicates the account-age check that was repeated in both
 * luposOnGuildMemberAdd() and luposOnReadyDeleteNewAccounts().
 */

import type { Guild, GuildMember } from "discord.js";
import config from "#root/config.js";
import { ACCOUNT_AGE_THRESHOLD_MS, MILLISECONDS_PER_DAY } from "#root/constants.js";

/**
 * Kick a member if their Discord account is too new (< 4 weeks old)
 * and they are not on the whitelist.
 */
export async function kickIfTooNew(member: GuildMember, callerName: string = "AccountGuard") {
  if (member.user.bot) return false;

  const accountAge = Date.now() - member.user.createdAt.getTime();
  const isWhitelisted = config.USER_IDS_NEW_ACCOUNT_WHITELIST?.includes(
    member.id,
  );

  if (accountAge < ACCOUNT_AGE_THRESHOLD_MS && !isWhitelisted) {
    const ageDays = Math.floor(accountAge / MILLISECONDS_PER_DAY);
    console.log(
      `[${callerName}] Kicking new account: ${member.user.username} (${member.id}), account age: ${ageDays} days`,
    );
    try {
      await member.kick(`Account too new (${ageDays} days old)`);
      return true;
    } catch (error: unknown) {
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
 */
export async function kickIfForbiddenCombo(member: GuildMember, callerName: string = "AccountGuard") {
  if (member.user.bot) return false;

  const hasBoth = FORBIDDEN_COMBO_ROLE_IDS.every((roleId: string) =>
    member.roles.cache.has(roleId),
  );

  if (!hasBoth) return false;

  // Only kick if the Discord account itself is less than 4 weeks old.
  // Old accounts picking both roles are real users, not spam bots.
  const accountAge = Date.now() - member.user.createdAt.getTime();
  if (accountAge >= ACCOUNT_AGE_THRESHOLD_MS) return false;

  // Also skip if they've been in the server longer than 4 weeks
  const joinAge = Date.now() - (member.joinedTimestamp || 0);
  if (joinAge > ACCOUNT_AGE_THRESHOLD_MS) return false;

  const joinDays = Math.floor(joinAge / MILLISECONDS_PER_DAY);
  const comboNames = FORBIDDEN_COMBO_ROLE_IDS.map((id: string) => {
    const role = member.guild.roles.cache.get(id);
    return role ? role.name : id;
  }).join(" + ");

  console.log(
    `[${callerName}] Kicking ${member.user.username} (${member.id}) for forbidden role combo: ${comboNames} (joined ${joinDays}d ago)`,
  );

  try {
    await member.kick(`Forbidden role combo: ${comboNames} (joined ${joinDays}d ago)`);
    return true;
  } catch (error: unknown) {
    console.error(
      `[${callerName}] Failed to kick ${member.user.username}:`,
      error,
    );
  }

  return false;
}

/**
 * Bulk-purge members whose Discord account age is below a given threshold.
 */
export async function purgeByAccountAge(guild: Guild, thresholdMs: number, options: { dryRun?: boolean; callerName?: string } = {}) {
  const { dryRun = false, callerName = "purgeByAccountAge" } = options;
  const thresholdDays = Math.floor(thresholdMs / MILLISECONDS_PER_DAY);

  console.log(
    `[${callerName}] Fetching all members for guild "${guild.name}" (${guild.id})...`,
  );
  const members = await guild.members.fetch();
  console.log(
    `[${callerName}] ${members.size} members loaded. Threshold: ${thresholdDays} days. Dry run: ${dryRun}`,
  );

  let kicked = 0;
  let skipped = 0;
  let errors = 0;

  for (const [, member] of members) {
    if (member.user.bot) continue;

    const accountAge = Date.now() - member.user.createdAt.getTime();
    if (accountAge >= thresholdMs) continue;

    const ageDays = Math.floor(accountAge / MILLISECONDS_PER_DAY);
    const isWhitelisted = config.USER_IDS_NEW_ACCOUNT_WHITELIST?.includes(
      member.id,
    );

    if (isWhitelisted) {
      skipped++;
      console.log(
        `[${callerName}] ⏭️  Skipping (whitelisted): ${member.user.username} (${member.id}), age: ${ageDays}d`,
      );
      continue;
    }

    if (dryRun) {
      kicked++;
      console.log(
        `[${callerName}] 🔍 [DRY RUN] Would kick: ${member.user.username} (${member.id}), age: ${ageDays}d`,
      );
      continue;
    }

    try {
      await member.kick(`Account too new (${ageDays} days old, threshold: ${thresholdDays} days)`);
      kicked++;
      console.log(
        `[${callerName}] 🦶 Kicked: ${member.user.username} (${member.id}), age: ${ageDays}d`,
      );
    } catch (error: unknown) {
      errors++;
      console.error(
        `[${callerName}] ❌ Failed to kick ${member.user.username} (${member.id}):`,
        (error as Error).message,
      );
    }
  }

  console.log(
    `[${callerName}] Done. Kicked: ${kicked}, Skipped: ${skipped}, Errors: ${errors}`,
  );

  return { kicked, skipped, errors };
}

export default { kickIfTooNew, kickIfForbiddenCombo, purgeByAccountAge };
