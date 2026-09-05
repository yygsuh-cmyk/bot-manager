const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { AppError, getUserErrorMessage, toAppError } = require("../utils/errors");
const { buildDisplayResponse, buildErrorResponse } = require("../utils/discordResponse");
const { assertManagerAccess } = require("../utils/permissions");
const { normalizeProvider, providerLabel, clampText, toCodeBlock } = require("../utils/format");
const { buildAppPanel } = require("./ui/centralPanel");
const { createCentralPanelController } = require("./panel/centralPanelController");
const { sendPanelLog } = require("../services/logService");
const { createProvider } = require("../services/providerFactory");
const { assertCreditsIntegrity } = require("../security/creditsGuard");
const { assertArmorArmed } = require("../security/runtimeArmor");

function createInteractionRouter({ commandMap, settingsStore, panelStore, licenseStore, freeBotsStore, config, logger }) {
  const centralPanel = createCentralPanelController({
    settingsStore,
    panelStore,
    licenseStore,
    freeBotsStore,
    config,
    logger
  });

  return async function onInteractionCreate(interaction) {
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      if (!command?.autocomplete) {
        await interaction.respond([]).catch(() => null);
        return;
      }

      try {
        assertArmorArmed();
        assertCreditsIntegrity();
        await command.autocomplete(interaction);
      } catch (error) {
        logger.warn("Falha ao processar autocomplete.", {
          commandName: interaction.commandName,
          focused: interaction.options?.getFocused?.(true) ?? null,
          message: error?.message
        });
        await interaction.respond([]).catch(() => null);
      }
      return;
    }

    try {
      assertArmorArmed();
      assertCreditsIntegrity();

      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) {
          return;
        }

        await command.execute(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId?.startsWith("pc:")) {
        await centralPanel.handleStringSelect(interaction);
        return;
      }

      if (interaction.isChannelSelectMenu?.() && interaction.customId?.startsWith("pc:")) {
        await centralPanel.handleChannelSelect(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("pc:")) {
        await centralPanel.handleButton(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith("pc:")) {
        await centralPanel.handleModal(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === "cfg:host_select") {
        await handleHostSelection(interaction, settingsStore, logger);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith("cfg:")) {
        await handleConfigButton(interaction, settingsStore, logger);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith("cfg:")) {
        await handleConfigModal(interaction, settingsStore, logger);
      }
    } catch (error) {
      await handleInteractionError(interaction, error, logger, panelStore, config);
    }
  };
}

async function handleHostSelection(interaction, settingsStore, logger) {
  const settings = await settingsStore.get();
  assertManagerAccess(interaction, settings);

  const selectedProvider = normalizeProvider(interaction.values[0]);
  if (!selectedProvider) {
    throw new AppError("Host selecionado nao e suportado.", {
      statusCode: 400,
      code: "INVALID_HOST_SELECTION"
    });
  }

  const updated = await settingsStore.setProvider(selectedProvider);
  await interaction.update(
    buildAppPanel(
      updated,
      `API definida como ${providerLabel(selectedProvider)}. Agora clique em "Definir token".`,
      false
    )
  );
}

async function handleConfigButton(interaction, settingsStore, logger) {
  const settings = await settingsStore.get();
  assertManagerAccess(interaction, settings);

  if (interaction.customId === "cfg:set_token") {
    if (!settings.provider) {
      throw new AppError("Selecione primeiro o host (SquareCloud ou Discloud).", {
        statusCode: 400,
        code: "HOST_REQUIRED_BEFORE_TOKEN"
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("cfg:token_modal")
      .setTitle(`Token ${providerLabel(settings.provider)}`);

    const tokenInput = new TextInputBuilder()
      .setCustomId("api_token")
      .setLabel("Token da API do host")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Cole o token aqui")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(tokenInput));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "cfg:set_default_app") {
    const modal = new ModalBuilder()
      .setCustomId("cfg:default_app_modal")
      .setTitle("Aplicacao Padrao");

    const appIdInput = new TextInputBuilder()
      .setCustomId("default_app_id")
      .setLabel("ID da aplicacao padrao")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: 1719010867306")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(appIdInput));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "cfg:sync_apps") {
    await interaction.deferUpdate();

    const provider = createProvider(settings, logger);
    const apps = await provider.listApps();

    const updated = await settingsStore.get();
    await interaction.editReply(
      buildAppPanel(
        updated,
        `${apps.length} aplicacoes sincronizadas com sucesso.`,
        false
      )
    );
    return;
  }

  if (interaction.customId === "cfg:quick_delete") {
    if (!settings.defaultAppId) {
      throw new AppError("Defina o app padrao antes de tentar deletar.", {
        statusCode: 400,
        code: "DEFAULT_APP_REQUIRED"
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("cfg:delete_confirm_modal")
      .setTitle("Confirmar Delete de App");

    const phraseInput = new TextInputBuilder()
      .setCustomId("delete_confirm_text")
      .setLabel("Digite DELETAR para confirmar")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("DELETAR")
      .setRequired(true);

    const appIdInput = new TextInputBuilder()
      .setCustomId("delete_confirm_app_id")
      .setLabel("Confirme o ID da aplicacao")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(settings.defaultAppId)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(phraseInput),
      new ActionRowBuilder().addComponents(appIdInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith("cfg:quick_")) {
    await runQuickAction(interaction, settingsStore, logger);
  }
}

async function runQuickAction(interaction, settingsStore, logger) {
  const settings = await settingsStore.get();
  const action = interaction.customId.replace("cfg:quick_", "");

  if (!settings.defaultAppId) {
    throw new AppError("Defina o app padrao antes de usar as acoes rapidas.", {
      statusCode: 400,
      code: "DEFAULT_APP_REQUIRED"
    });
  }

  const provider = createProvider(settings, logger);
  const appId = settings.defaultAppId;

  await interaction.deferUpdate();

  const refreshPanel = async (notice, noticeIsError = false) => {
    const latestSettings = await settingsStore.get();
    await interaction.editReply(buildAppPanel(latestSettings, notice, noticeIsError));
  };

  const startedAt = Date.now();
  await refreshPanel(buildProgressMessage(action, appId));

  if (action === "status") {
    const status = await provider.getAppStatus(appId);
    await refreshPanel(
      `Status consultado (${formatElapsedMs(startedAt)}): app ${appId} ${status.online ? "online" : "offline"} | CPU ${status.cpu} | RAM ${status.ramUsage}`
    );
    return;
  }

  if (action === "start") {
    const status = await provider.getAppStatus(appId);
    if (status.online) {
      await refreshPanel(`Start cancelado (${formatElapsedMs(startedAt)}): aplicacao ja estava online.`, false);
      return;
    }

    const result = await provider.startApp(appId);
    await refreshPanel(`Start concluido (${formatElapsedMs(startedAt)}): ${result.message}`, !result.ok);
    return;
  }

  if (action === "restart") {
    const status = await provider.getAppStatus(appId);
    if (!status.online) {
      await refreshPanel(
        `Restart bloqueado (${formatElapsedMs(startedAt)}): aplicacao offline. Use Start antes de reiniciar.`,
        true
      );
      return;
    }

    const result = await provider.restartApp(appId);
    await refreshPanel(`Restart concluido (${formatElapsedMs(startedAt)}): ${result.message}`, !result.ok);
    return;
  }

  if (action === "stop") {
    const status = await provider.getAppStatus(appId);
    if (!status.online) {
      await refreshPanel(`Stop cancelado (${formatElapsedMs(startedAt)}): aplicacao ja estava offline.`, false);
      return;
    }

    const result = await provider.stopApp(appId);
    await refreshPanel(`Stop concluido (${formatElapsedMs(startedAt)}): ${result.message}`, !result.ok);
    return;
  }

  if (action === "logs") {
    const logs = await provider.getAppLogs(appId);
    await interaction.followUp(
      buildDisplayResponse({
        title: `Logs rapidos - ${appId}`,
        lines: [toCodeBlock(clampText(logs, 2800), "bash")],
        accentColor: 0x5865f2,
        ephemeral: true
      })
    );

    await refreshPanel(`Logs enviados (${formatElapsedMs(startedAt)}): resposta separada criada com sucesso.`);
    return;
  }

  throw new AppError("Acao rapida invalida.", {
    statusCode: 400,
    code: "QUICK_ACTION_INVALID"
  });
}

async function handleConfigModal(interaction, settingsStore, logger) {
  const settings = await settingsStore.get();
  assertManagerAccess(interaction, settings);

  if (interaction.customId === "cfg:token_modal") {
    if (!settings.provider) {
      throw new AppError("Selecione o host antes de salvar token.", {
        statusCode: 400,
        code: "HOST_REQUIRED"
      });
    }

    const token = interaction.fields.getTextInputValue("api_token").trim();
    if (!token) {
      throw new AppError("Token vazio. Informe um token valido.", {
        statusCode: 400,
        code: "EMPTY_TOKEN"
      });
    }

    await interaction.reply(
      buildDisplayResponse({
        title: "Painel Central | app",
        lines: ["-# Validando token e aplicando configuracao..."],
        accentColor: 0x5865f2,
        ephemeral: true
      })
    );

    const provider = createProvider(
      {
        ...settings,
        apiToken: token
      },
      logger
    );

    const account = await provider.validateToken();
    await settingsStore.setApiToken(token);
    const updated = await settingsStore.get();

    await interaction.editReply(
      buildAppPanel(
        updated,
        `Token validado com sucesso para conta ${account.username} (${providerLabel(updated.provider)}).`,
        false
      )
    );
    return;
  }

  if (interaction.customId === "cfg:default_app_modal") {
    const appId = interaction.fields.getTextInputValue("default_app_id").trim();
    if (!appId) {
      throw new AppError("ID da aplicacao nao pode ser vazio.", {
        statusCode: 400,
        code: "EMPTY_APP_ID"
      });
    }

    await interaction.reply(
      buildDisplayResponse({
        title: "Painel Central | app",
        lines: ["-# Validando app padrao no host..."],
        accentColor: 0x5865f2,
        ephemeral: true
      })
    );

    const provider = createProvider(settings, logger);
    await provider.getAppStatus(appId);

    await settingsStore.setDefaultAppId(appId);
    const updated = await settingsStore.get();

    await interaction.editReply(
      buildAppPanel(updated, `App padrao definido para ${appId}.`, false)
    );
    return;
  }

  if (interaction.customId === "cfg:delete_confirm_modal") {
    if (!settings.defaultAppId) {
      throw new AppError("Nenhum app padrao configurado para delete.", {
        statusCode: 400,
        code: "DEFAULT_APP_REQUIRED"
      });
    }

    const confirmation = interaction.fields.getTextInputValue("delete_confirm_text").trim().toUpperCase();
    const appId = interaction.fields.getTextInputValue("delete_confirm_app_id").trim();

    if (confirmation !== "DELETAR") {
      throw new AppError("Confirmacao invalida. Digite exatamente DELETAR.", {
        statusCode: 400,
        code: "DELETE_CONFIRM_INVALID"
      });
    }

    if (appId !== settings.defaultAppId) {
      throw new AppError("O app informado nao corresponde ao app padrao atual.", {
        statusCode: 400,
        code: "DELETE_APP_ID_MISMATCH"
      });
    }

    await interaction.reply(
      buildDisplayResponse({
        title: "Painel Central | app",
        lines: [`-# Excluindo aplicacao ${appId}...`],
        accentColor: 0xed4245,
        ephemeral: true
      })
    );

    const provider = createProvider(settings, logger);
    const result = await provider.deleteApp(appId);

    if (result.ok) {
      await settingsStore.setDefaultAppId("");
    }

    const updated = await settingsStore.get();

    await interaction.editReply(
      buildAppPanel(
        updated,
        `Delete ${result.ok ? "concluido" : "falhou"} para app ${appId}: ${result.message}`,
        !result.ok
      )
    );
    return;
  }

  throw new AppError("Modal nao suportado.", {
    statusCode: 400,
    code: "UNKNOWN_MODAL"
  });
}

async function handleInteractionError(interaction, error, logger, panelStore, config) {
  const appError = toAppError(error);

  if (appError.code === "CREDITS_TAMPERED") {
    logger.error("Tamper detectado na protecao de creditos. Encerrando processo.", {
      code: appError.code,
      reason: appError.reason ?? null
    });
    process.exit(86);
    return;
  }

  const level = pickLogLevel(appError);

  // CORRECAO (item 3 - "erro falso ao gerar key"): DiscordAPIError 40060
  // ("Interaction has already been acknowledged") acontece quando a MESMA
  // interaction e reconhecida (reply/defer/showModal) mais de uma vez - por
  // exemplo quando duas instancias do processo ficam ativas ao mesmo tempo
  // (ex: deploy sobrepondo o processo antigo antes dele finalizar, ou
  // "node --watch" reiniciando sem encerrar o processo anterior) e ambas
  // recebem o mesmo evento do gateway do Discord. Isso NAO indica falha na
  // operacao em si (a key/licenca ja foi criada/ativada normalmente pela
  // instancia que respondeu primeiro) - e apenas ruido de concorrencia.
  // Continuamos logando no console/arquivo de erro para diagnostico (nao
  // escondemos o problema), mas paramos de mandar isso como "erro real" para
  // o canal de logs de erro do painel, e rebaixamos a severidade.
  const isDuplicateAckNoise = isAlreadyAcknowledgedError(appError);
  const effectiveLevel = isDuplicateAckNoise ? "warn" : level;

  logger[effectiveLevel]("Falha ao processar interaction.", {
    interactionId: interaction.id,
    customId: interaction.customId ?? null,
    commandName: interaction.commandName ?? null,
    code: appError.code,
    statusCode: appError.statusCode,
    details: appError.details,
    duplicateAcknowledgeNoise: isDuplicateAckNoise || undefined
  });

  if (panelStore && !isDuplicateAckNoise) {
    await sendPanelLog({
      client: interaction.client,
      panelStore,
      type: "errors",
      payload: {
        interaction,
        action: "Erro em interaction",
        details: `${appError.code}: ${appError.message}`,
        color: 0xed4245
      },
      logger,
      fallbackChannelId: config?.licenseLogChannelId
    }).catch(() => null);
  }

  if (isDuplicateAckNoise) {
    // A interaction ja foi respondida por outra chamada; qualquer nova
    // tentativa de reply/editReply/followUp abaixo tambem falharia com o
    // mesmo erro 40060. Nao ha nada de util a fazer aqui.
    return;
  }

  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred && !interaction.replied) {
    await interaction
      .editReply(buildErrorResponse(getUserErrorMessage(appError), { includeFlags: false }))
      .catch(() => null);
    return;
  }

  if (interaction.replied) {
    await interaction
      .editReply(buildErrorResponse(getUserErrorMessage(appError), { includeFlags: false }))
      .catch(async () => {
        await interaction
          .followUp(buildErrorResponse(getUserErrorMessage(appError)))
          .catch(() => null);
      });
    return;
  }

  await interaction
    .reply(buildErrorResponse(getUserErrorMessage(appError)))
    .catch(() => null);
}

function isAlreadyAcknowledgedError(appError) {
  const code = appError?.details?.name || "";
  const message = String(appError?.details?.message || appError?.message || "").toLowerCase();
  return code.includes("DiscordAPIError[40060]") || message.includes("already been acknowledged");
}

function pickLogLevel(appError) {
  if (!appError) {
    return "error";
  }

  if (appError.statusCode >= 500) {
    const detailsMessage = String(appError.details?.message ?? "").toLowerCase();
    if (detailsMessage.includes("unknown interaction")) {
      return "warn";
    }
    return "error";
  }

  const expectedCodes = new Set([
    "WRONG_GUILD",
    "HOST_NOT_CONFIGURED",
    "HOST_TOKEN_NOT_CONFIGURED",
    "FORBIDDEN",
    "GUILD_ONLY",
    "APP_ID_REQUIRED"
  ]);

  if (expectedCodes.has(appError.code)) {
    return "info";
  }

  return "warn";
}

module.exports = {
  createInteractionRouter
};

function buildProgressMessage(action, appId) {
  if (action === "status") {
    return `Consultando status do app ${appId}...`;
  }

  if (action === "start") {
    return `Enviando comando START para o app ${appId}...`;
  }

  if (action === "restart") {
    return `Enviando comando RESTART para o app ${appId}...`;
  }

  if (action === "stop") {
    return `Enviando comando STOP para o app ${appId}...`;
  }

  if (action === "logs") {
    return `Coletando logs do app ${appId}...`;
  }

  return `Executando acao ${action} no app ${appId}...`;
}

function formatElapsedMs(startedAt) {
  const elapsed = Date.now() - startedAt;
  return `${elapsed}ms`;
}
