const { REST, Routes } = require("discord.js");

async function registerCommands(options) {
  const {
    discordToken,
    settingsStore,
    commands,
    client,
    logger
  } = options;

  const settings = await settingsStore.get();
  const guildId = settings.guildId;
  const applicationId = settings.clientId || client.application?.id || client.user?.id;

  if (!applicationId) {
    throw new Error("Nao foi possivel determinar o applicationId para registrar comandos.");
  }

  const body = commands.map((command) => command.data.toJSON());
  if (body.length !== 1 || body[0].name !== "painel_central") {
    throw new Error("Registro bloqueado: somente /painel_central pode ser registrado.");
  }

  const rest = new REST({ version: "10" }).setToken(discordToken);
  const scopes = [];

  await rest.put(Routes.applicationCommands(applicationId), { body });
  scopes.push("global");

  if (guildId) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
      scopes.push("guild");
    } catch (error) {
      logger.warn("Nao foi possivel limpar comandos antigos da guild.", {
        guildId,
        code: error.code,
        status: error.status,
        message: error.message
      });
    }
  }

  if (!settings.clientId || settings.clientId !== applicationId) {
    await settingsStore.patch({ clientId: applicationId });
  }

  logger.info("Slash commands registrados com sucesso.", {
    guildId: guildId || null,
    scope: scopes.join("+"),
    applicationId,
    commandCount: body.length
  });
}

module.exports = {
  registerCommands
};
