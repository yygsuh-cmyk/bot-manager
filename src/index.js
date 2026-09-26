const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const net = require("node:net");
const https = require("node:https");
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}

const { Client, Collection, GatewayIntentBits } = require("discord.js");
const { Agent: UndiciAgent } = require("undici");
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

function networkPreflightCheck() {
  const targets = [
    { host: "discord.com", port: 443 },
    { host: "gateway.discord.gg", port: 443 },
    { host: "8.8.8.8", port: 53 }
  ];

  return Promise.all(
    targets.map(
      (target) =>
        new Promise((resolve) => {
          const startedAt = Date.now();
          const socket = net.connect({ host: target.host, port: target.port });
          socket.setTimeout(10000);

          const finish = (status, extra) => {
            socket.destroy();
            const elapsedMs = Date.now() - startedAt;
            if (status === "ok") {
              logger.info(`[NetPreflight] Conexao TCP OK com ${target.host}:${target.port} em ${elapsedMs}ms.`);
            } else {
              logger.error(`[NetPreflight] Falha ao conectar em ${target.host}:${target.port} apos ${elapsedMs}ms.`, {
                status,
                ...extra
              });
            }
            resolve();
          };

          socket.once("connect", () => finish("ok"));
          socket.once("timeout", () => finish("timeout"));
          socket.once("error", (error) => finish("error", serializeError(error)));
        })
    )
  ).then(() => {
    logger.info("[NetPreflight] Teste de conectividade de saida concluido.");
  });
}

function checkProxyEnvVars() {
  const proxyVars = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
  const found = proxyVars.filter((name) => process.env[name]);
  if (found.length > 0) {
    logger.warn("[NetPreflight] Variaveis de proxy detectadas no ambiente (podem estar desviando requisicoes HTTPS).", {
      variaveisDefinidas: found
    });
  } else {
    logger.info("[NetPreflight] Nenhuma variavel de proxy (HTTP_PROXY/HTTPS_PROXY/etc) definida no ambiente.");
  }
}

function httpsPreflightCheck() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = https.request(
      {
        host: "discord.com",
        path: "/api/v10/gateway",
        method: "GET",
        timeout: 10000
      },
      (res) => {
        const elapsedMs = Date.now() - startedAt;
        res.resume();
        res.on("end", () => {
          logger.info(`[NetPreflight] HTTPS GET /api/v10/gateway respondeu status ${res.statusCode} em ${elapsedMs}ms.`);
          resolve();
        });
      }
    );

    req.on("timeout", () => {
      const elapsedMs = Date.now() - startedAt;
      logger.error(`[NetPreflight] HTTPS GET /api/v10/gateway travou (timeout) apos ${elapsedMs}ms.`);
      req.destroy();
      resolve();
    });

    req.on("error", (error) => {
      const elapsedMs = Date.now() - startedAt;
      logger.error(`[NetPreflight] HTTPS GET /api/v10/gateway falhou apos ${elapsedMs}ms.`, serializeError(error));
      resolve();
    });

    req.end();
  });
}

async function bootstrap() {
  validateRuntimeConfig();

  checkProxyEnvVars();
  await networkPreflightCheck();
  await httpsPreflightCheck();

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

  const restAgent = new UndiciAgent({
    connectTimeout: 10_000,
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
    keepAliveTimeout: 10_000
  });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 20000, agent: restAgent }
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

  // Listeners de diagnostico do discord.js: ajudam a identificar falhas na
  // conexao com o gateway do Discord (rede, shard, invalidacao de sessao,
  // avisos internos da lib) que nao aparecem como excecao no client.login.
  client.on("error", (error) => {
    logger.error("[Discord] client error.", serializeError(error));
  });

  client.on("shardError", (error, shardId) => {
    logger.error(`[Discord] shardError (shard ${shardId}).`, serializeError(error));
  });

  client.on("invalidated", () => {
    logger.error("[Discord] Sessao invalidada pelo Discord (invalidated). Sera necessario novo login.");
  });

  client.on("warn", (message) => {
    logger.warn("[Discord] warn.", { message });
  });

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

  const maxLoginAttempts = 5;
  let loginAttempt = 0;
  for (;;) {
    loginAttempt += 1;
    try {
      logger.info(`[Discord] Iniciando client.login... (tentativa ${loginAttempt}/${maxLoginAttempts})`);
      await loginWithHardTimeout(client, config.discordToken, 15_000);
      logger.info("[Discord] client.login concluído.");
      break;
    } catch (error) {
      logger.error("[Discord] Falha no client.login.", serializeError(error));
      if (loginAttempt >= maxLoginAttempts) {
        throw error;
      }
      try {
        client.destroy();
      } catch {
        // Ignorado: client pode nao ter chegado a inicializar conexao nenhuma.
      }
      const backoffMs = Math.min(5000 * loginAttempt, 30000);
      logger.info(`[Discord] Tentando novamente em ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

function loginWithHardTimeout(client, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `client.login nao respondeu em ${timeoutMs}ms (timeout forcado no codigo, nao depende de config interna do discord.js/undici).`
        )
      );
    }, timeoutMs);

    client.login(token).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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
