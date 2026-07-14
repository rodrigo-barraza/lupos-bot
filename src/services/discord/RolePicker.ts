// ============================================================
// RolePicker — self-role embeds + pick-role button handler
// ============================================================
// Extracted from DiscordService (R1 decomposition). Owns the
// self-roles channel embeds (WoW classes/factions/videogames),
// the section builder, and the "pick-role-" button handler.
// The ButtonRouter registration happens at module load, exactly
// as it previously did inside DiscordService.
// ============================================================

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type {
  Client,
  GuildMember,
  Message,
  TextChannel,
  Collection as DiscordCollection,
} from "discord.js";

import config from "#root/config.js";
import {
  rolesVideogames,
  warcraftClasses,
  warcraftFactions,
} from "#root/arrays/roles.js";
import DiscordUtilityService from "#root/services/DiscordUtilityService.js";
import ButtonRouter from "#root/services/discord/ButtonRouter.js";
import LogFormatter from "#root/formatters/LogFormatter.js";
import { kickIfForbiddenCombo } from "#root/services/AccountGuardService.js";

/**
 * Build a role-picker embed + button rows for a given role source array.
 * `roles` is the guild's role cache pre-sorted by raw position (descending).
 */
export function buildRolePickerSection(
  roles: DiscordCollection<string, import("discord.js").Role>,
  title: string,
  description: string,
  sourceArray: { id: string; emojiId?: string }[],
  options: Record<string, unknown> = {},
) {
  const maxButtonsPerRow = 5;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor("#00FF00");

  let filtered = roles.filter((role: import("discord.js").Role) =>
    sourceArray.some((src: { id: string }) => src.id === role.id),
  );
  if (options.sort) {
    filtered = filtered.sort(
      (a: import("discord.js").Role, b: import("discord.js").Role) =>
        a.name.localeCompare(b.name),
    );
  }
  const rolesArray = filtered.map((role: import("discord.js").Role) => role);

  const rows: import("discord.js").ActionRowBuilder<
    import("discord.js").ButtonBuilder
  >[] = [];
  for (let i = 0; i < rolesArray.length; i += maxButtonsPerRow) {
    const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>();
    const currentRoles = rolesArray.slice(i, i + maxButtonsPerRow);
    for (const role of currentRoles) {
      const emoji =
        sourceArray.find((src: { id: string }) => src.id === role.id)
          ?.emojiId || null;
      const button = new ButtonBuilder()
        .setLabel(`${role.name} (${role.members.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`pick-role-${role.id}`);
      if (emoji) button.setEmoji(emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }
  return { embed, rows };
}

export async function generateRolesEmbedMessage(client: Client) {
  // get the original message and edit it to show the new role count on the button
  // re-render the buttons with the new role count
  const guildId = config.GUILD_ID_PRIMARY;
  if (!guildId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const roles = guild.roles.cache
    .sort(
      (a: import("discord.js").Role, b: import("discord.js").Role) =>
        a.rawPosition - b.rawPosition,
    )
    .reverse();

  const classes = buildRolePickerSection(
    roles,
    "Pick Your WoW Classes",
    "Which classes do you play as?",
    warcraftClasses,
  );
  const factions = buildRolePickerSection(
    roles,
    "Pick Your WoW Faction",
    "Which faction do you play as?",
    warcraftFactions,
  );
  const videogames = buildRolePickerSection(
    roles,
    "Pick Your Videogames",
    "Which videogames do you play?",
    rolesVideogames,
    { sort: true },
  );

  // if the channel is empty, create a new message
  const channelId = config.CHANNEL_ID_SELF_ROLES;
  if (!channelId) return;
  const channel = DiscordUtilityService.getChannelById(
    client,
    channelId,
  ) as TextChannel | null;
  if (!channel) {
    return;
  }
  const messagesCacheSize =
    channel.messages.cache.size ||
    (await channel.messages
      .fetch({ limit: 10 })
      .then((messages: DiscordCollection<string, Message>) => messages.size));
  // if the channel is empty, post message, otherwise edit the first message
  if (messagesCacheSize === 0) {
    await channel.send({ embeds: [factions.embed], components: factions.rows });
    await channel.send({ embeds: [classes.embed], components: classes.rows });
    await channel.send({
      embeds: [videogames.embed],
      components: videogames.rows,
    });

    const guildMastersEmbed = new EmbedBuilder()
      .setTitle("Guild Masters / Officers")
      .setDescription(
        `If you would like access to post in our guild recruitment channel and other guild leadership channels, please post on the <#966457267417411614> channel:

- Include a screenshot of your guild tab showing you as GM or officer, as well as the name and faction of the guild.
- Put your guild tag in your Discord nickname <Like This>.
            `,
      )
      .setColor("#00FF00");

    await channel.send({ embeds: [guildMastersEmbed] });

    return;
  } else {
    const allMessages = await channel.messages.fetch({ limit: 20 });
    const message1 = allMessages.at(allMessages.size - 1);
    const message2 = allMessages.at(allMessages.size - 2);
    const message3 = allMessages.at(allMessages.size - 3);
    if (message1)
      await message1.edit({
        embeds: [factions.embed],
        components: factions.rows,
      });
    if (message2)
      await message2.edit({
        embeds: [classes.embed],
        components: classes.rows,
      });
    if (message3)
      await message3.edit({
        embeds: [videogames.embed],
        components: videogames.rows,
      });
    return;
  }
}

export async function handleRolePickerButton(
  client: Client,
  interaction: import("discord.js").ButtonInteraction,
) {
  const functionName = "handleRolePickerButton";
  if (!interaction.guild || !interaction.member) return;
  const roleId = interaction.customId.split("pick-role-")[1];
  const role = interaction.guild.roles.cache.get(roleId);
  const member = interaction.member as GuildMember;
  if (!role) {
    console.error(
      ...LogFormatter.roleNotFound(functionName, interaction, roleId),
    );
    return;
  }
  if (member.roles.cache.has(roleId)) {
    console.log(
      ...LogFormatter.roleSelfRemoved(functionName, interaction, role),
    );
    await interaction.reply({
      content: `Removing <@&${roleId}>...`,
      ephemeral: true,
    });
    await DiscordUtilityService.removeRoleFromMember(member, roleId);
    await interaction.editReply({
      content: `Removed <@&${roleId}>!`,
    });
    // wait 5 seconds before deleting the reply
    await new Promise((resolve: (value: void | PromiseLike<void>) => void) =>
      setTimeout(resolve, 5000),
    );
    await interaction.deleteReply().catch(() => {
      /* user dismissed the ephemeral */
    });
    await generateRolesEmbedMessage(client);
  } else {
    console.log(...LogFormatter.roleSelfAdded(functionName, interaction, role));
    await interaction.reply({
      content: `Adding <@&${roleId}>...`,
      ephemeral: true,
    });
    await DiscordUtilityService.addRoleToMember(member, roleId);

    // Re-fetch member so role cache reflects the newly added role
    const freshMember = await interaction.guild!.members.fetch(member.id);
    const wasKicked = await kickIfForbiddenCombo(freshMember, functionName);
    if (wasKicked) {
      await interaction.editReply({
        content:
          "Forbidden role combination detected. You have been removed from the server.",
      });
      return;
    }

    await interaction.editReply({
      content: `Added <@&${roleId}>!`,
    });
    // wait 5 seconds before deleting the reply
    await new Promise((resolve: (value: void | PromiseLike<void>) => void) =>
      setTimeout(resolve, 5000),
    );
    await interaction.deleteReply().catch(() => {
      /* user dismissed the ephemeral */
    });
    await generateRolesEmbedMessage(client);
  }
}

// Register the pick-role button handler at module load — mirrors the
// registration that previously lived in DiscordService.
ButtonRouter.register("pick-role-", handleRolePickerButton);
