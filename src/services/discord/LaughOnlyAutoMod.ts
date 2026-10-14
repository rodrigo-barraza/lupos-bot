// ============================================================
// LaughOnlyAutoMod — the laugh-only rule, read by Discord's AutoMod
// ============================================================
// LaughOnlyMessages reads message.content, and Discord has withheld the
// content of other people's messages from Lupos since 2026-10-09 (no
// MessageContent intent — see wrappers/DiscordWrapper.ts): a listed
// member's "lmao" arrives as "" and is kept. AutoMod reads the text on
// Discord's side. In every guild that holds a member of
// USER_IDS_LAUGH_ONLY_DELETED, Lupos keeps a keyword rule whose regex
// matches a laugh-only message, with one action: an alert in a hidden
// #lupos-automod channel. For each match Discord sends Lupos an
// AutoModerationActionExecution — user, channel and message ids, none of
// which need an intent. A listed author's message is deleted and its
// alert kept as the record (the alert shows the text Lupos cannot read);
// every other alert is cleared. The rule is removed from a guild with no
// listed member, and from every guild while Lupos holds MessageContent,
// when LaughOnlyMessages sees the text again.
// ============================================================

import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ChannelType,
  DiscordAPIError,
  GatewayIntentBits,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
import type {
  AutoModerationActionExecution,
  AutoModerationRule,
  Client,
  Collection,
  Guild,
  GuildMember,
  NonThreadGuildBasedChannel,
  TextChannel,
} from "discord.js";

import config from "#root/config.ts";
import BotSettingsService from "#root/services/BotSettingsService.ts";
import utilities from "#root/utilities.ts";
import { hasGatewayIntent } from "#root/wrappers/DiscordWrapper.ts";

export const AUTOMOD_RULE_NAME = "Lupos: laugh-only messages";
export const ALERT_CHANNEL_NAME = "lupos-automod";
const RECONCILE_INTERVAL_MS = 10 * 60_000;
const AUDIT_LOG_REASON =
  "Lupos's laugh-only rule (USER_IDS_LAUGH_ONLY_DELETED)";

// ─── The pattern ───────────────────────────────────────────────
// Rust regex, as AutoMod runs it, matched against the whole message
// (\A … \z). Discord refuses a pattern over 260 characters, or one nested
// deeper than 10 levels as regex-syntax counts them: every group,
// repetition, alternation, concatenation and bracketed class is a level,
// and a class of two or more items one more. So the tokens of
// LaughOnlyMessages' LAUGH_TOKEN are written flat — no group inside a
// token — and the pattern sits at exactly 10. That costs three
// differences, measured on Whitemane's last two weeks of readable
// messages (219 of the 220 laugh-only ones match, plus three typos like
// "HAHHAHA"): tokens may run together without a separator ("lolhaha");
// a custom emote counts only when its name laughs (LaughOnlyMessages also
// reads <:hehe:…> as "hehe"); and the text alone decides, so a laugh with
// an attachment matches too.

/** Whitespace, punctuation (\pP) and the ASCII symbols people pad laughs with. */
const SEPARATOR = "[\\s\\pP~^+=<>|`\u{FE0F}]";

/** One token of laughter, case-insensitive through the (?i) flag. */
const LAUGH_TOKENS = [
  "l+o[lo]*l[sz]?", // lol lool lolol lolll lolz
  "l+m+f*a+o+[sz]?", // lmao lmfao lmaooo lmaos
  "r+o+t?f+l+[mfao]*", // rofl rotfl roflmao
  "k+e[ek]*kw?", // kek kekw kekek
  "a?[hj][ae]+[hj][ae][hjae]*", // haha hehe jaja ahaha hahah jeje
  "[hj]a+h?", // ha hah ja
  "heh+", // heh
  "x+d+", // xd xdd
  "l+[ue]+l+z?", // lul lulz lel
  "l+a+w+l+", // lawl
  "[\u{1F602}\u{1F923}\u{1F606}\u{1F639}\u{1F480}]", // 😂 🤣 😆 😹 💀
  "<a?:\\w*(?:kek|lul|lmao|lol|rofl|laugh|haha|jaja|xd)\\w*:\\d+>", // <:KEKW:123>
];

/** A message that is nothing but laughter, in AutoMod's regex dialect. */
export const LAUGH_ONLY_AUTOMOD_PATTERN = `(?i)\\A${SEPARATOR}*(?:(?:${LAUGH_TOKENS.join("|")})${SEPARATOR}*)+\\z`;

// ─── Keeping the rule ──────────────────────────────────────────

/** Lupos's rule id per guild it keeps one in; executions of other rules are ignored. */
const ruleIdByGuild = new Map<string, string>();
const warned = new Set<string>();
let reconciling = false;
let reconcileTimer: NodeJS.Timeout | null = null;

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/**
 * Whether a listed member belongs to the guild (a REST lookup each, cached
 * once found). Only Discord's answer that they are not — a 4xx, Unknown
 * Member or an id it rejects — counts as absent; any other failure throws,
 * so a hiccup leaves the rule as it is until the next run.
 */
async function holdsListedMember(
  guild: Guild,
  userIds: string[],
): Promise<boolean> {
  for (const userId of userIds) {
    if (guild.members.cache.has(userId)) return true;
    const member = await guild.members.fetch(userId).catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.status < 500) return null;
      throw error;
    });
    if (member) return true;
  }
  return false;
}

/** The alert action, aimed at `channelId`. */
function alertAction(channelId: string) {
  return {
    type: AutoModerationActionType.SendAlertMessage,
    metadata: { channel: channelId },
  };
}

/** Whether the rule no longer runs this pattern into this channel. */
function ruleDrifted(rule: AutoModerationRule, channelId: string): boolean {
  const patterns = rule.triggerMetadata.regexPatterns;
  return (
    rule.eventType !== AutoModerationRuleEventType.MessageSend ||
    patterns.length !== 1 ||
    patterns[0] !== LAUGH_ONLY_AUTOMOD_PATTERN ||
    rule.actions.length !== 1 ||
    rule.actions[0].type !== AutoModerationActionType.SendAlertMessage ||
    rule.actions[0].metadata.channelId !== channelId
  );
}

/** The channel the moderators' own AutoMod rules alert in, when one still exists. */
function moderatorAlertChannel(
  guild: Guild,
  rules: Collection<string, AutoModerationRule>,
  botId: string,
): NonThreadGuildBasedChannel | null {
  for (const rule of rules.values()) {
    if (rule.creatorId === botId) continue;
    for (const action of rule.actions) {
      if (action.type !== AutoModerationActionType.SendAlertMessage) continue;
      const channel = guild.channels.cache.get(action.metadata.channelId ?? "");
      if (channel && !channel.isThread()) return channel;
    }
  }
  return null;
}

/**
 * The #lupos-automod channel. Created when missing, hidden from @everyone
 * and seen by whoever sees the moderators' own AutoMod alerts: it takes
 * their alert channel's category and overwrites.
 */
async function resolveAlertChannel(
  guild: Guild,
  me: GuildMember,
  rules: Collection<string, AutoModerationRule>,
): Promise<TextChannel | null> {
  const existing = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name === ALERT_CHANNEL_NAME,
  );
  if (existing) return existing as TextChannel;

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    warnOnce(
      `channel:${guild.id}`,
      `⚠️ [LaughOnlyAutoMod] Lupos cannot create #${ALERT_CHANNEL_NAME} in "${guild.name}" (Manage Channels) — the laugh-only rule is off there`,
    );
    return null;
  }
  const everyoneId = guild.roles.everyone.id;
  const template = moderatorAlertChannel(guild, rules, me.id);
  const staffOverwrites = template
    ? [
        ...template.permissionOverwrites.cache
          .filter(
            (overwrite) =>
              overwrite.id !== everyoneId && overwrite.id !== me.id,
          )
          .values(),
      ]
    : [];
  return guild.channels.create({
    name: ALERT_CHANNEL_NAME,
    type: ChannelType.GuildText,
    ...(template?.parentId ? { parent: template.parentId } : {}),
    topic:
      "AutoMod alerts for Lupos's laugh-only rule. A listed member's laugh-only message is deleted and its alert kept here as the record; every other alert is cleared.",
    permissionOverwrites: [
      ...staffOverwrites,
      { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
    reason: AUDIT_LOG_REASON,
  });
}

async function reconcileGuild(
  guild: Guild,
  contentVisible: boolean,
  listedUserIds: string[],
): Promise<void> {
  const me = guild.members.me;
  // AutoMod is out of reach without Manage Server: no rules, no executions.
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    ruleIdByGuild.delete(guild.id);
    return;
  }

  // Grobbulus never had the laugh-only rule (processMessage leaves it first).
  const wanted =
    !contentVisible &&
    guild.id !== config.GUILD_ID_GROBBULUS &&
    (await holdsListedMember(guild, listedUserIds));
  const rules = await guild.autoModerationRules.fetch();
  const ours = rules.filter(
    (rule) => rule.creatorId === me.id && rule.name === AUTOMOD_RULE_NAME,
  );

  if (!wanted) {
    ruleIdByGuild.delete(guild.id);
    for (const rule of ours.values()) {
      await rule.delete(
        contentVisible
          ? "Lupos reads message content again; the laugh-only rule runs on it"
          : "No member on the laugh-only list is in this server",
      );
      console.log(
        `🤐 [LaughOnlyAutoMod] Removed the AutoMod rule from "${guild.name}"`,
      );
    }
    return;
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) {
    warnOnce(
      `messages:${guild.id}`,
      `⚠️ [LaughOnlyAutoMod] Lupos cannot delete messages in "${guild.name}" (Manage Messages) — the laugh-only rule is off there`,
    );
    return;
  }
  const channel = await resolveAlertChannel(guild, me, rules);
  if (!channel) return;

  let rule = ours.first();
  if (!rule) {
    rule = await guild.autoModerationRules.create({
      name: AUTOMOD_RULE_NAME,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: [LAUGH_ONLY_AUTOMOD_PATTERN] },
      actions: [alertAction(channel.id)],
      enabled: true,
      reason: AUDIT_LOG_REASON,
    });
    console.log(
      `🤐 [LaughOnlyAutoMod] Created the AutoMod rule in "${guild.name}" (alerts in #${channel.name})`,
    );
  } else if (ruleDrifted(rule, channel.id)) {
    // The pattern and the alert channel follow the code; whether the rule
    // is enabled, and whom it exempts, stay as the moderators set them.
    rule = await rule.edit({
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerMetadata: { regexPatterns: [LAUGH_ONLY_AUTOMOD_PATTERN] },
      actions: [alertAction(channel.id)],
      reason: AUDIT_LOG_REASON,
    });
    console.log(
      `🤐 [LaughOnlyAutoMod] Updated the AutoMod rule in "${guild.name}"`,
    );
  }
  if (!rule.enabled) {
    warnOnce(
      `disabled:${guild.id}`,
      `⚠️ [LaughOnlyAutoMod] The AutoMod rule is disabled in "${guild.name}" — the laugh-only rule is off there until a moderator enables it`,
    );
  }
  ruleIdByGuild.set(guild.id, rule.id);
}

/**
 * Bring every guild's rule in line with the list and the intents: one
 * where a listed member is and message content is withheld, none
 * elsewhere. A guild that fails is logged and retried on the next run.
 */
export async function reconcileLaughOnlyAutoMod(client: Client): Promise<void> {
  const contentVisible = hasGatewayIntent(
    client,
    GatewayIntentBits.MessageContent,
  );
  const listedUserIds = BotSettingsService.get("USER_IDS_LAUGH_ONLY_DELETED");
  for (const guild of client.guilds.cache.values()) {
    await reconcileGuild(guild, contentVisible, listedUserIds).catch(
      (error: unknown) => {
        console.warn(
          `⚠️ [LaughOnlyAutoMod] Could not keep the AutoMod rule in "${guild.name}": ${utilities.errorMessage(error)}`,
        );
      },
    );
  }
}

/** Reconcile now and every ten minutes, which picks up edits to the list. */
export function startLaughOnlyAutoMod(client: Client): void {
  const run = () => {
    if (reconciling) return;
    reconciling = true;
    void reconcileLaughOnlyAutoMod(client).finally(() => {
      reconciling = false;
    });
  };
  run();
  if (!reconcileTimer) {
    reconcileTimer = setInterval(run, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref?.();
  }
}

// ─── Acting on a match ─────────────────────────────────────────

/** Delete the flagged message; true when it was deleted. */
async function deleteFlaggedMessage(
  execution: AutoModerationActionExecution,
): Promise<boolean> {
  const { guild, channelId, messageId, userId } = execution;
  if (!channelId || !messageId) return false;
  try {
    const channel =
      execution.channel ?? (await guild.client.channels.fetch(channelId));
    if (!channel?.isTextBased()) return false;
    const message = await channel.messages.fetch(messageId);
    // Stickers survive the withheld content, so a laugh with a sticker is
    // kept, as LaughOnlyMessages keeps it. Attachments do not survive: a
    // laugh with one cannot be told from a bare laugh.
    if (message.author.id !== userId || message.stickers.size > 0) return false;
    await message.delete();
    console.log(
      `🤐 [LaughOnlyAutoMod] Deleted laugh-only message ${messageId} from ${message.author.tag} in #${"name" in channel ? channel.name : channelId} (flagged by AutoMod)`,
    );
    return true;
  } catch (error: unknown) {
    console.log(
      `Error deleting laugh-only message ${messageId} from ${userId}:`,
      error,
    );
    return false;
  }
}

/**
 * An AutoMod verdict on a message. Lupos's rule only: a listed author's
 * laugh is deleted and its alert kept as the record of what it said;
 * every other alert is cleared.
 */
export async function luposOnAutoModerationActionExecution(
  _client: Client,
  execution: AutoModerationActionExecution,
): Promise<void> {
  if (ruleIdByGuild.get(execution.guild.id) !== execution.ruleId) return;
  if (execution.action.type !== AutoModerationActionType.SendAlertMessage) {
    return;
  }
  const listed = BotSettingsService.get("USER_IDS_LAUGH_ONLY_DELETED").includes(
    execution.userId,
  );
  if (listed && (await deleteFlaggedMessage(execution))) return;

  const alertChannelId = execution.action.metadata.channelId;
  if (!execution.alertSystemMessageId || !alertChannelId) return;
  await execution.guild.client.rest
    .delete(
      Routes.channelMessage(alertChannelId, execution.alertSystemMessageId),
    )
    .catch(() => {
      // Already gone: a moderator cleared it first.
    });
}

const LaughOnlyAutoMod = {
  start: startLaughOnlyAutoMod,
  reconcile: reconcileLaughOnlyAutoMod,
  onExecution: luposOnAutoModerationActionExecution,
};
export default LaughOnlyAutoMod;
