const { PermissionFlagsBits } = require("discord.js");
const { AppError } = require("./errors");

function isAuthorizedUser(interaction, settings) {
  const admins = settings.adminUserIds ?? [];
  if (admins.length > 0) {
    return admins.includes(interaction.user.id);
  }

  const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
  const hasAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  return isGuildOwner || hasAdministrator;
}

function assertManagerAccess(interaction, settings) {
  if (!interaction.inGuild()) {
    throw new AppError("Use este comando apenas dentro de servidor.", {
      statusCode: 400,
      code: "GUILD_ONLY"
    });
  }

  if (settings.guildId && interaction.guildId !== settings.guildId) {
    throw new AppError(
      `Este bot manager esta restrito ao servidor ${settings.guildId}.`,
      {
        statusCode: 403,
        code: "WRONG_GUILD"
      }
    );
  }

  if (!isAuthorizedUser(interaction, settings)) {
    throw new AppError("Voce nao tem permissao para usar o bot manager.", {
      statusCode: 403,
      code: "FORBIDDEN"
    });
  }
}

module.exports = {
  assertManagerAccess,
  isAuthorizedUser
};
