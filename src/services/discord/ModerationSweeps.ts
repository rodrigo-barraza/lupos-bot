// ============================================================
// ModerationSweeps — startup member sweeps & bulk role ops
// ============================================================
// Extracted from DiscordService (R1 decomposition). One-shot
// moderation passes that run on bot ready:
//   - luposOnReadyDeleteNewAccounts — kick too-new / forbidden-combo members
//   - luposOnReadyPurgeYoungAccounts — one-off young-account purge (dry-run unless confirmed)
//   - revokeRoleFromAllMembers — bulk strip of a stale role
//   - fetchMembersWithRetry — gateway-rate-limit-aware member fetch
// ============================================================

import type { Client, Guild } from "discord.js";

import config from "#root/config.ts";
import { MILLISECONDS_PER_DAY } from "#root/constants.ts";
import {
  kickIfTooNew,
  kickIfForbiddenCombo,
  purgeByAccountAge,
} from "#root/services/AccountGuardService.ts";

/**
 * Fetch guild members with automatic retry on Gateway rate limits (opcode 8).
 * Discord.js throws GatewayRateLimitError when the gateway rejects the
 * REQUEST_GUILD_MEMBERS payload — this is NOT a REST error and won't be
 * caught by the REST rate-limit handler. We catch it here and wait the
 * advertised retry_after duration before retrying.


 */
export async function fetchMembersWithRetry(
  guild: Guild,
  maxRetries: number = 3,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await guild.members.fetch();
    } catch (error: unknown) {
      const isGatewayRateLimit =
        (error as Error & { data?: { retry_after?: number; opcode?: number } })
          .constructor?.name === "GatewayRateLimitError" ||
        ((error as Error & { data?: { retry_after?: number; opcode?: number } })
          .data?.retry_after &&
          (
            error as Error & {
              data?: { retry_after?: number; opcode?: number };
            }
          ).data?.opcode === 8);

      if (isGatewayRateLimit && attempt < maxRetries) {
        const waitMs =
          Math.ceil(
            ((
              error as Error & {
                data?: { retry_after?: number; opcode?: number };
              }
            ).data?.retry_after || 30) * 1000,
          ) + 1000;
        console.warn(
          `⏳ [fetchMembersWithRetry] Gateway rate-limited (attempt ${attempt}/${maxRetries}). ` +
            `Retrying in ${(waitMs / 1000).toFixed(1)}s...`,
        );
        await new Promise(
          (resolve: (value: void | PromiseLike<void>) => void) =>
            setTimeout(resolve, waitMs),
        );
      } else {
        throw error;
      }
    }
  }
  throw new Error("fetchMembersWithRetry failed");
}

export async function luposOnReadyDeleteNewAccounts(client: Client) {
  const functionName = "luposOnReadyDeleteNewAccounts";
  const guild = client.guilds.cache.get(config.GUILD_ID_PRIMARY as string);
  if (!guild) {
    console.error(`[${functionName}] Primary guild not found`);
    return;
  }

  console.log(`[${functionName}] Fetching all members...`);
  const members = await fetchMembersWithRetry(guild);
  let kickedAge = 0;
  let kickedCombo = 0;

  for (const [, member] of members) {
    const wasTooNew = await kickIfTooNew(member, functionName);
    if (wasTooNew) {
      kickedAge++;
      continue;
    }
    const wasForbidden = await kickIfForbiddenCombo(member, functionName);
    if (wasForbidden) kickedCombo++;
  }

  console.log(
    `[${functionName}] Done. Kicked — age: ${kickedAge}, forbidden combo: ${kickedCombo}`,
  );
}

/**
 * One-off purge: kick all members with accounts < 2 months old
 * in a specific guild.
 */
const TWO_MONTHS_MS = 60 * MILLISECONDS_PER_DAY;
const PURGE_TARGET_GUILD_ID = "609471635308937237";
const REVOKE_ROLE_ID = "1353101921681936456";

export async function luposOnReadyPurgeYoungAccounts(
  client: Client,
  options?: { dryRun?: boolean },
) {
  const functionName = "luposOnReadyPurgeYoungAccounts";
  const guild = client.guilds.cache.get(PURGE_TARGET_GUILD_ID);
  if (!guild) {
    console.error(
      `[${functionName}] Guild ${PURGE_TARGET_GUILD_ID} not found in cache`,
    );
    return;
  }

  // Dry-run unless the caller explicitly opted into a live purge
  // (CLI mode purge:youngAccounts with confirm=true).
  const dryRun = options?.dryRun !== false;
  if (dryRun) {
    console.warn(
      `🔍 [${functionName}] DRY RUN mode — no members will be kicked. ` +
        `Run with "confirm=true" to execute the purge.`,
    );
  } else {
    console.warn(
      `🚨 [${functionName}] LIVE PURGE mode — members with accounts younger ` +
        `than 2 months WILL be kicked from guild ${PURGE_TARGET_GUILD_ID}.`,
    );
  }

  await purgeByAccountAge(guild, TWO_MONTHS_MS, {
    dryRun,
    callerName: functionName,
  });
}

/**
 * Bulk role revocation — strips a specific role from every member who has it
 * in the target guild. Runs once on bot startup to clean up stale roles.
 */
export async function revokeRoleFromAllMembers(client: Client) {
  const functionName = "revokeRoleFromAllMembers";
  const guild = client.guilds.cache.get(PURGE_TARGET_GUILD_ID);
  if (!guild) {
    console.error(
      `[${functionName}] Guild ${PURGE_TARGET_GUILD_ID} not found in cache`,
    );
    return;
  }

  const role = guild.roles.cache.get(REVOKE_ROLE_ID);
  if (!role) {
    console.error(
      `[${functionName}] Role ${REVOKE_ROLE_ID} not found in guild ${guild.name}`,
    );
    return;
  }

  console.log(
    `[${functionName}] Fetching members with role "${role.name}" (${REVOKE_ROLE_ID})...`,
  );
  const members = await fetchMembersWithRetry(guild);
  const membersWithRole = members.filter(
    (m: import("discord.js").GuildMember) => m.roles.cache.has(REVOKE_ROLE_ID),
  );

  if (membersWithRole.size === 0) {
    console.log(
      `[${functionName}] No members found with role "${role.name}" — nothing to do.`,
    );
    return;
  }

  console.log(
    `[${functionName}] Revoking role "${role.name}" from ${membersWithRole.size} member(s)...`,
  );
  let revoked = 0;
  let failed = 0;

  for (const [, member] of membersWithRole) {
    try {
      await member.roles.remove(
        REVOKE_ROLE_ID,
        `[${functionName}] Startup bulk role revocation`,
      );
      revoked++;
      console.log(
        `[${functionName}] ✅ Removed role from ${member.user.tag} (${member.id})`,
      );
    } catch (error: unknown) {
      failed++;
      console.error(
        `[${functionName}] ❌ Failed to remove role from ${member.user.tag} (${member.id}): ${(error as Error).message}`,
      );
    }
  }

  console.log(`[${functionName}] Done. Revoked: ${revoked}, Failed: ${failed}`);
}
