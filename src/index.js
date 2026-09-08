const { Client, Collection, GatewayIntentBits } = require("discord.js");
const { config, validateRuntimeConfig } = require("./config/appConfig");
const { createLogger } = require("./utils/logger");
const { SettingsStore } = require("./storage/settingsStore");
const { PanelStore } = require("./storage/panelStore");
const { LicenseStore } = require("./storage/licenseStore");
const { createFreeBotsStore } = require("./storage/freeBotsStore");
const { createPaidBotsStore } = require("./storage/paidBotsStore");
const { checkAndExpireLicenses } = require("./services/licenseService");
const { startApiServer } = require("./api/server");
const { sendPanelLog } = require("./services/logService");
const { createCommands } = require("./discord/commands");
const { createInteractionRouter } = require("./discord/interactionRouter");
const { refreshTrackedFreeBotPanels } = require("./discord/panel/centralPanelController");
const { registerCommands } = require("./bootstrap/registerCommands");
const { syncApplicationEmojis } = require("./services/applicationEmojiService");
const { setEmojiMap } = require("./services/emojiRegistry");
const { assertCreditsIntegrity, logCreditsBanner } = require("./security/creditsGuard");
const { verifyRuntimeArmor, startArmorWatch } = require("./security/runtimeArmor");
const { acquireSingleInstanceLock } = require("./utils/singleInstanceLock");

const logger = createLogger({
  level: config.logLevel,
  errorLogPath: config.errorLogPath
});

async function bootstrap() {
  validateRuntimeConfig();

  // Impede que duas instancias deste processo fiquem logadas no Discord ao
  // mesmo tempo com o mesmo token (ex: um restart que nao encerrou o
  // processo anterior antes de subir o novo). Duas instancias simultaneas
  // causam respostas duplicadas/perdidas em interactions (DiscordAPIError
  // 10062/40060) e paineis desatualizados "vencendo" os atualizados.
  const releaseSingleInstanceLock = acquireSingleInstanceLock(config.dataDir, logger);

  verifyRuntimeArmor();
  startArmorWatch({ logger });
  assertCreditsIntegrity();
  logCreditsBanner(logger);

  logger.info(`Diretorio de dados persistentes: ${config.dataDir}`, {
    dataDir: config.dataDir,
    dica: process.env.DATA_DIR
      ? "DATA_DIR configurado."
      : "DATA_DIR nao configurado - em plataformas como o Render, use um Persistent Disk e defina DATA_DIR para nao perder licencas em reinicios/deploys."
  });

  const settingsStore = new SettingsStore(config.settingsPath, {
    discordGuildId: config.discordGuildId,
    discordClientId: config.discordClientId,
    adminUserIds: config.adminUserIds
  });
  await settingsStore.init();

  const panelStore = new PanelStore(config.panelPath);
  await panelStore.init();
  if (config.licenseLogChannelId) {
    await panelStore.setLogChannel("activation", config.licenseLogChannelId);
  }

  const licenseStore = new LicenseStore(config.licensesPath);
  await licenseStore.init();
  await checkAndExpireLicenses(licenseStore, logger);

  const freeBotsStore = createFreeBotsStore(config.freeBotsPath);
  const paidBotsStore = createPaidBotsStore(config.paidBotsPath);

  try {
    await startApiServer({ licenseStore, freeBotsStore, paidBotsStore, config, logger });
  } catch (error) {
    logger.error("Falha ao iniciar API HTTP de licencas. O bot continuara sem a API.", serializeError(error));
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  const commands = createCommands({
    settingsStore,
    panelStore,
    licenseStore,
    config,
    logger
  });

  const commandMap = new Collection(commands.map((command) => [command.data.name, command]));
  const interactionRouter = createInteractionRouter({
    commandMap,
    settingsStore,
    panelStore,
    licenseStore,
    freeBotsStore,
    paidBotsStore,
    config,
    logger
  });

  client.once("clientReady", async () => {
    logger.info(`Bot online como ${client.user.tag}`, {
      userId: client.user.id
    });

    setInterval(async () => {
      try {
        const expiredLicenses = await checkAndExpireLicenses(licenseStore, logger);
        for (const license of expiredLicenses) {
          await sendPanelLog({
            client,
            panelStore,
            type: "license_expiration",
            payload: {
              action: "Licenca expirada automaticamente",
              key: license.key,
              guild: license.guildId ? { id: license.guildId, name: license.guildName || license.guildId } : null,
              user: license.userId ? { id: license.userId, username: license.userName || license.userId } : null,
              details: `Expirou em ${license.expiresAt}`,
              color: 0xed4245
            },
            logger,
            fallbackChannelId: config.licenseLogChannelId
          });
        }
      } catch (error) {
        logger.warn("[LicenseService] Erro na task de expiracao automatica.", {
          message: error?.message
        });
      }
    }, 10 * 60 * 1000);

    // Mantem os embeds de "Bots Free" (lista/detalhe) sincronizados com o
    // estado real do freeBotsStore sem exigir clique: cobre heartbeat, novo
    // registro, mudanca de servidores e a transicao para offline quando o
    // Bot Free para de mandar heartbeat (ver isBotOnline/FREEBOT_OFFLINE_AFTER_MS).
    setInterval(() => {
      refreshTrackedFreeBotPanels(client, freeBotsStore).catch((error) => {
        logger.warn("[FreeBotPanel] Erro ao atualizar paineis automaticamente.", {
          message: error?.message
        });
      });
    }, config.freeBotPanelRefreshIntervalMs);

    if (config.syncApplicationEmojisOnStart) {
      try {
        const emojiMap = await syncApplicationEmojis({
          applicationId: client.application?.id || client.user.id,
          botToken: config.discordToken,
          assetsDir: config.assetsDir,
          logger
        });
        setEmojiMap(emojiMap);
      } catch (error) {
        logger.warn("Falha no sync de application emojis. Seguindo com fallback padrao.", serializeError(error));
      }
    }

    try {
      await registerCommands({
        discordToken: config.discordToken,
        settingsStore,
        commands,
        client,
        logger
      });
    } catch (error) {
      logger.error("Falha ao registrar slash commands.", serializeError(error));
    }
  });

  client.on("interactionCreate", interactionRouter);

  process.on("unhandledRejection", (reason) => {
    logger.error("UnhandledRejection capturada.", serializeError(reason));
  });

  process.on("uncaughtException", (error) => {
    logger.error("UncaughtException capturada.", serializeError(error));
  });

  // Encerramento gracioso (item 14): o Render envia SIGTERM em todo
  // deploy/restart. Sem tratar esse sinal, o processo pode ser morto no meio
  // de uma escrita em disco. O JsonStore ja grava de forma atomica (tmp+rename),
  // mas encerrar a conexao do Discord de forma limpa evita reprocessamento
  // duplicado de interactions (relacionado ao bug do item 3) em deploys com
  // sobreposicao de instancias.
  let shuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Sinal ${signal} recebido. Encerrando graciosamente...`);
    client.destroy();
    releaseSingleInstanceLock();
    setTimeout(() => process.exit(0), 250).unref();
  };
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  await client.login(config.discordToken);
}

function serializeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { raw: String(error) };
}

bootstrap().catch((error) => {
  logger.error("Falha critica no bootstrap do bot.", serializeError(error));
  process.exit(1);
});
