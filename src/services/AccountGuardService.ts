/**
 * AccountGuardService — Centralized new-account kick logic.
 *
 * Deduplicates the account-age check that was repeated in both
 * luposOnGuildMemberAdd() and luposOnReadyDeleteNewAccounts().
 */

import BotSettingsService from "#root/services/BotSettingsService.ts";
import type { Guild, GuildMember } from "discord.js";
import {
  ACCOUNT_AGE_THRESHOLD_MS,
  FORBIDDEN_COMBO_MAX_ACCOUNT_AGE_MS,
  FORBIDDEN_COMBO_MAX_JOIN_AGE_MS,
  MILLISECONDS_PER_DAY,
} from "#root/constants.ts";

/**
 * Kick a member if their Discord account is too new (< 4 weeks old)
 * and they are not on the whitelist.
 */
export async function kickIfTooNew(
  member: GuildMember,
  callerName: string = "AccountGuard",
) {
  if (member.user.bot) return false;

  const accountAge = Date.now() - member.user.createdAt.getTime();
  const isWhitelisted = BotSettingsService.get(
    "USER_IDS_NEW_ACCOUNT_WHITELIST",
  ).includes(member.id);

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
export const FORBIDDEN_COMBO_ROLE_IDS = [
  "609477071776907388", // Horde (warcraftFactions)
  "1384647483707097149", // Apex Legends (rolesVideogames)
];

/** Join window for the manual forbidden-combo sweep. */
export const SIX_MONTHS_MS = 182 * MILLISECONDS_PER_DAY;

/**
 * Roles a member holds that are neither @everyone nor part of the combo.
 * @everyone is always present in the cache and its id equals the guild id,
 * so counting it would make "no other roles" match nobody.
 */
function extraRoleNames(member: GuildMember) {
  return member.roles.cache
    .filter(
      (role: import("discord.js").Role) =>
        role.id !== member.guild.id &&
        !FORBIDDEN_COMBO_ROLE_IDS.includes(role.id),
    )
    .map((role: import("discord.js").Role) => role.name);
}

/**
 * Kick a member if they hold both roles in the forbidden combo
 * (currently: Horde + Apex Legends).
 */
export async function kickIfForbiddenCombo(
  member: GuildMember,
  callerName: string = "AccountGuard",
) {
  if (member.user.bot) return false;

  const hasBoth = FORBIDDEN_COMBO_ROLE_IDS.every((roleId: string) =>
    member.roles.cache.has(roleId),
  );

  if (!hasBoth) return false;

  // Only kick if the Discord account itself is less than 5 years old.
  // Accounts older than that predate the combo's use as a spam signature.
  const accountAge = Date.now() - member.user.createdAt.getTime();
  if (accountAge >= FORBIDDEN_COMBO_MAX_ACCOUNT_AGE_MS) return false;

  // Also skip if they've been in the server longer than 4 weeks
  const joinAge = Date.now() - (member.joinedTimestamp || 0);
  if (joinAge > FORBIDDEN_COMBO_MAX_JOIN_AGE_MS) return false;

  const joinDays = Math.floor(joinAge / MILLISECONDS_PER_DAY);
  const comboNames = FORBIDDEN_COMBO_ROLE_IDS.map((id: string) => {
    const role = member.guild.roles.cache.get(id);
    return role ? role.name : id;
  }).join(" + ");

  console.log(
    `[${callerName}] Kicking ${member.user.username} (${member.id}) for forbidden role combo: ${comboNames} (joined ${joinDays}d ago)`,
  );

  try {
    await member.kick(
      `Forbidden role combo: ${comboNames} (joined ${joinDays}d ago)`,
    );
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
 * Manual sweep — kick members who joined within the last `windowMs`
 * (default 6 months) AND hold both forbidden-combo roles, regardless of
 * how old their Discord account is.
 *
 * Distinct from kickIfForbiddenCombo(), which is the live event-driven guard
 * with its own account-age and 4-week join gates. This one is the one-off
 * backfill for members who slipped in before those gates were widened.
 *
 * `onlyTheseRoles` (default true) additionally requires the combo to be the
 * member's ENTIRE role set — the spam signature is an account that picked
 * exactly these two and nothing else. Both cohorts are always counted and
 * logged, so a dry run shows what widening it to false would add.
 */
export async function sweepForbiddenComboJoiners(
  guild: Guild,
  options: {
    dryRun?: boolean;
    windowMs?: number;
    onlyTheseRoles?: boolean;
    callerName?: string;
  } = {},
) {
  const {
    dryRun = true,
    windowMs = SIX_MONTHS_MS,
    onlyTheseRoles = true,
    callerName = "sweepForbiddenComboJoiners",
  } = options;
  const windowDays = Math.floor(windowMs / MILLISECONDS_PER_DAY);

  const comboNames = FORBIDDEN_COMBO_ROLE_IDS.map((id: string) => {
    const role = guild.roles.cache.get(id);
    return role ? role.name : id;
  }).join(" + ");

  console.log(
    `[${callerName}] Fetching all members for guild "${guild.name}" (${guild.id})...`,
  );
  const members = await guild.members.fetch();
  console.log(
    `[${callerName}] ${members.size} members loaded. Combo: ${comboNames}. ` +
      `Join window: ${windowDays} days. Only-these-roles: ${onlyTheseRoles}. Dry run: ${dryRun}`,
  );

  const now = Date.now();
  let kicked = 0;
  let skipped = 0;
  let errors = 0;
  // Members matching the combo + join window but holding other roles too —
  // kicked only when onlyTheseRoles is false.
  let withExtraRoles = 0;

  for (const [, member] of members) {
    if (member.user.bot) continue;

    const hasBoth = FORBIDDEN_COMBO_ROLE_IDS.every((roleId: string) =>
      member.roles.cache.has(roleId),
    );
    if (!hasBoth) continue;

    // A member with no joinedTimestamp has an unknown join date; treat it as
    // outside the window rather than kicking on missing data.
    if (!member.joinedTimestamp) continue;
    const joinAge = now - member.joinedTimestamp;
    if (joinAge > windowMs) continue;

    const extras = extraRoleNames(member);
    if (extras.length > 0) {
      withExtraRoles++;
      if (onlyTheseRoles) {
        console.log(
          `[${callerName}] ⏭️  Skipping (has ${extras.length} other role(s)): ` +
            `${member.user.username} (${member.id}) — ${extras.join(", ")}`,
        );
        continue;
      }
    }

    const isWhitelisted = BotSettingsService.get(
      "USER_IDS_NEW_ACCOUNT_WHITELIST",
    ).includes(member.id);
    if (isWhitelisted) {
      skipped++;
      console.log(
        `[${callerName}] ⏭️  Skipping (whitelisted): ${member.user.username} (${member.id})`,
      );
      continue;
    }

    const joinDays = Math.floor(joinAge / MILLISECONDS_PER_DAY);

    if (dryRun) {
      kicked++;
      console.log(
        `[${callerName}] 🔍 [DRY RUN] Would kick: ${member.user.username} (${member.id}), joined ${joinDays}d ago`,
      );
      continue;
    }

    try {
      await member.kick(
        `Forbidden role combo: ${comboNames} (joined ${joinDays}d ago)`,
      );
      kicked++;
      console.log(
        `[${callerName}] 🦶 Kicked: ${member.user.username} (${member.id}), joined ${joinDays}d ago`,
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
    `[${callerName}] Done. ${dryRun ? "Would kick" : "Kicked"}: ${kicked}, ` +
      `Skipped (whitelist): ${skipped}, Errors: ${errors}`,
  );
  console.log(
    `[${callerName}] ${withExtraRoles} matching member(s) also hold other roles — ` +
      (onlyTheseRoles
        ? `excluded by onlyTheseRoles. Re-run with onlyTheseRoles=false to include them.`
        : `included in the count above.`),
  );

  return { kicked, skipped, errors, withExtraRoles };
}

/**
 * Bulk-purge members whose Discord account age is below a given threshold.
 */
export async function purgeByAccountAge(
  guild: Guild,
  thresholdMs: number,
  options: { dryRun?: boolean; callerName?: string } = {},
) {
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
    const isWhitelisted = BotSettingsService.get(
      "USER_IDS_NEW_ACCOUNT_WHITELIST",
    ).includes(member.id);

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
      await member.kick(
        `Account too new (${ageDays} days old, threshold: ${thresholdDays} days)`,
      );
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

export default {
  kickIfTooNew,
  kickIfForbiddenCombo,
  sweepForbiddenComboJoiners,
  purgeByAccountAge,
};
