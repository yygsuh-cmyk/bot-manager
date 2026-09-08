const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { AppError } = require("../../utils/errors");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { assertManagerAccess } = require("../../utils/permissions");
const { clampText, providerLabel, toCodeBlock } = require("../../utils/format");
const {
  buildAppDetailPanel,
  buildAppPanel,
  buildAppsListPanel,
  buildAnnouncementsPanel,
  buildFreeBotDetailPanel,
  buildFreeBotsPanel,
  buildGeneralPanel,
  buildHomePanel,
  buildItemEditor,
  buildLicensesPanel,
  buildLogsPanel,
  buildPaidBotDetailPanel,
  buildPaidBotsPanel,
  buildProductsPanel,
  color
} = require("../ui/centralPanel");
const { createProvider } = require("../../services/providerFactory");
const {
  activateLicense,
  createLicense,
  getLicenseSummary,
  listLicensedApps,
  normalizeLicenseKey,
  reactivateLicense,
  revokeLicense,
  suspendLicense
} = require("../../services/licenseService");
const {
  getFreeBot,
  listFreeBots,
  setFreeBotActive,
  setFreeBotBlocked
} = require("../../services/freeBotService");
const {
  getPaidBot,
  listPaidBots,
  setPaidBotBlocked: setPaidBotBlockedFlag,
  setPaidBotEnabled: setPaidBotEnabledFlag
} = require("../../services/paidBotService");
const freeBotPanelTracker = require("./freeBotPanelTracker");
const { formatExtendedDate, sendPanelLog } = require("../../services/logService");
const { normalizeColor } = require("../../storage/panelStore");

function createCentralPanelController(deps) {
  return {
    executePanelCommand: (interaction) => executePanelCommand(interaction, deps),
    handleButton: (interaction) => handleButton(interaction, deps),
    handleChannelSelect: (interaction) => handleChannelSelect(interaction, deps),
    handleModal: (interaction) => handleModal(interaction, deps),
    handleStringSelect: (interaction) => handleStringSelect(interaction, deps)
  };
}

async function executePanelCommand(interaction, deps) {
  const settings = await deps.settingsStore.get();
  const panel = await deps.panelStore.get();

  if (!hasAdminAccess(interaction, settings)) {
    await interaction.reply(buildActivationOnlyPanel(panel));
    return;
  }

  await logAction(interaction, deps, "command_usage", "/painel_central", "Painel central enviado.");
  await interaction.reply(buildHomePanel(settings, panel));
}

async function handleButton(interaction, deps) {
  maybeUntrackFreeBotPanel(interaction);

  if (interaction.customId === "pc:cmd:ativar") {
    await showActivateModal(interaction);
    return;
  }

  if (interaction.customId.startsWith("pc:adclick:")) {
    await handleAdClick(interaction, deps);
    return;
  }

  const settings = await requireAdmin(interaction, deps.settingsStore);

  if (interaction.customId === "pc:home") {
    await updateHome(interaction, deps, settings);
    return;
  }

  if (interaction.customId === "pc:cmd:gerar_key") {
    await showKeyModal(interaction);
    return;
  }

  if (interaction.customId === "pc:cmd:app") {
    await interaction.update(asUpdate(buildAppPanel(settings)));
    return;
  }

  // Gerenciar Anuncios e Gerenciar Produtos agora abrem paineis distintos
  // (item 6). "embeds"/"buttons" como paineis proprios foram removidos
  // (item 1); a edicao de embeds/botoes continua disponivel dentro do editor
  // de cada anuncio/produto.
  if (interaction.customId === "pc:admin:announcements") {
    await openAnnouncements(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:admin:products") {
    await openProducts(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:announcements:create") {
    await showCreateItemModal(interaction, "announcement");
    return;
  }

  if (interaction.customId === "pc:products:create") {
    await showCreateItemModal(interaction, "product");
    return;
  }

  if (interaction.customId.startsWith("pc:announcements:page:")) {
    const page = Number(interaction.customId.replace("pc:announcements:page:", "")) || 0;
    await openAnnouncements(interaction, deps, page);
    return;
  }

  if (interaction.customId.startsWith("pc:products:page:")) {
    const page = Number(interaction.customId.replace("pc:products:page:", "")) || 0;
    await openProducts(interaction, deps, page);
    return;
  }

  if (interaction.customId === "pc:admin:logs") {
    await openLogs(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:admin:licenses") {
    await openLicenses(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:admin:apps") {
    await openAppsList(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:apps:page:")) {
    const page = Number(interaction.customId.replace("pc:apps:page:", "")) || 0;
    await openAppsList(interaction, deps, page);
    return;
  }

  if (interaction.customId.startsWith("pc:apps:toggle:")) {
    await handleAppToggle(interaction, deps, interaction.customId.replace("pc:apps:toggle:", ""));
    return;
  }

  if (interaction.customId === "pc:admin:freebots") {
    await openFreeBots(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:freebot:page:")) {
    const page = Number(interaction.customId.replace("pc:freebot:page:", "")) || 0;
    await openFreeBots(interaction, deps, page);
    return;
  }

  if (interaction.customId.startsWith("pc:freebot:toggle_active:")) {
    await handleFreeBotToggleActive(interaction, deps, interaction.customId.replace("pc:freebot:toggle_active:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:freebot:toggle_block:")) {
    await handleFreeBotToggleBlock(interaction, deps, interaction.customId.replace("pc:freebot:toggle_block:", ""));
    return;
  }

  if (interaction.customId === "pc:admin:paidbots") {
    await openPaidBots(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:paidbot:page:")) {
    const page = Number(interaction.customId.replace("pc:paidbot:page:", "")) || 0;
    await openPaidBots(interaction, deps, page);
    return;
  }

  if (interaction.customId.startsWith("pc:paidbot:toggle_enabled:")) {
    await handlePaidBotToggleEnabled(interaction, deps, interaction.customId.replace("pc:paidbot:toggle_enabled:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:paidbot:toggle_blocked:")) {
    await handlePaidBotToggleBlocked(interaction, deps, interaction.customId.replace("pc:paidbot:toggle_blocked:", ""));
    return;
  }

  if (interaction.customId === "pc:admin:general") {
    await openGeneral(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:app:")) {
    await handleAppAction(interaction, deps, interaction.customId.replace("pc:app:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:item:")) {
    await handleItemButton(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:logs:")) {
    await handleLogButton(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:license:")) {
    await handleLicenseButton(interaction);
    return;
  }

  if (interaction.customId.startsWith("pc:general:")) {
    await handleGeneralButton(interaction, deps);
  }
}

async function handleStringSelect(interaction, deps) {
  maybeUntrackFreeBotPanel(interaction);
  await requireAdmin(interaction, deps.settingsStore);

  const itemPanelType = getItemPanelType(interaction.customId);
  if (itemPanelType) {
    const id = interaction.values[0];
    if (id === "none") return;
    const panel = await deps.panelStore.get();
    const item = findItem(panel, id);
    if (item.type !== itemPanelType) {
      throw new AppError("Item nao pertence a este painel.", { statusCode: 400, code: "ITEM_PANEL_MISMATCH" });
    }
    await interaction.update(asUpdate(buildItemEditor(panel, item)));
    return;
  }

  if (interaction.customId.startsWith("pc:item:button_edit:")) {
    const itemId = interaction.customId.replace("pc:item:button_edit:", "");
    const buttonId = interaction.values[0];
    if (buttonId === "none") return;
    const panel = await deps.panelStore.get();
    const item = findItem(panel, itemId);
    const itemButton = findButton(item, buttonId);
    await showButtonModal(interaction, item, itemButton);
    return;
  }

  if (interaction.customId.startsWith("pc:item:button_remove:")) {
    const itemId = interaction.customId.replace("pc:item:button_remove:", "");
    const buttonId = interaction.values[0];
    if (buttonId === "none") return;
    await deps.panelStore.removeButton(itemId, buttonId);
    await updateEditor(interaction, deps, itemId, "Botao removido.");
    return;
  }

  if (interaction.customId === "pc:logs:type") {
    const panel = await deps.panelStore.get();
    await interaction.update(asUpdate(buildLogsPanel(panel, interaction.values[0])));
    return;
  }

  if (interaction.customId === "pc:apps:select") {
    const value = interaction.values[0];
    if (value === "none") return;
    await openAppDetail(interaction, deps, value);
    return;
  }

  if (interaction.customId === "pc:freebot:select") {
    const value = interaction.values[0];
    if (value === "none") return;
    await openFreeBotDetail(interaction, deps, value);
    return;
  }

  if (interaction.customId === "pc:paidbot:select") {
    const value = interaction.values[0];
    if (value === "none") return;
    await openPaidBotDetail(interaction, deps, value);
  }
}

async function handleChannelSelect(interaction, deps) {
  maybeUntrackFreeBotPanel(interaction);
  await requireAdmin(interaction, deps.settingsStore);
  const channelId = interaction.values[0];

  if (interaction.customId.startsWith("pc:logs:channel:")) {
    const type = interaction.customId.replace("pc:logs:channel:", "");
    const panel = await deps.panelStore.setLogChannel(type, channelId);
    await interaction.update(asUpdate(buildLogsPanel(panel, type, "Canal atualizado.")));
    return;
  }

  if (interaction.customId.startsWith("pc:item:channel:")) {
    const itemId = interaction.customId.replace("pc:item:channel:", "");
    await deps.panelStore.updateAnnouncement(itemId, { channelId });
    await updateEditor(interaction, deps, itemId, "Canal de envio atualizado.");
  }
}

async function handleModal(interaction, deps) {
  maybeUntrackFreeBotPanel(interaction);

  if (interaction.customId === "pc:modal:activate") {
    await handleActivateModal(interaction, deps);
    return;
  }

  await requireAdmin(interaction, deps.settingsStore);

  if (interaction.customId === "pc:modal:key") {
    await handleKeyModal(interaction, deps);
    return;
  }

  if (interaction.customId.startsWith("pc:modal:item_create:")) {
    await handleCreateItemModal(interaction, deps, interaction.customId.replace("pc:modal:item_create:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:modal:item_edit:")) {
    await handleEditItemModal(interaction, deps, interaction.customId.replace("pc:modal:item_edit:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:modal:item_meta:")) {
    await handleMetaItemModal(interaction, deps, interaction.customId.replace("pc:modal:item_meta:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:modal:button_add:")) {
    await handleAddButtonModal(interaction, deps, interaction.customId.replace("pc:modal:button_add:", ""));
    return;
  }

  if (interaction.customId.startsWith("pc:modal:button_edit:")) {
    const [, itemId, buttonId] = interaction.customId.match(/^pc:modal:button_edit:([^:]+):([^:]+)$/) || [];
    await handleEditButtonModal(interaction, deps, itemId, buttonId);
    return;
  }

  if (interaction.customId === "pc:modal:revoke") {
    await handleRevokeModal(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:modal:visual") {
    await handleVisualModal(interaction, deps);
    return;
  }

  if (interaction.customId === "pc:modal:media") {
    await handleMediaModal(interaction, deps);
  }
}

async function updateHome(interaction, deps, settings = null) {
  const currentSettings = settings || await deps.settingsStore.get();
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildHomePanel(currentSettings, panel)));
}

async function openAnnouncements(interaction, deps, page = 0, notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildAnnouncementsPanel(panel, page, notice)));
}

async function openProducts(interaction, deps, page = 0, notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildProductsPanel(panel, page, notice)));
}

// Mantem suporte a componentes antigos ja enviados, sem misturar as Views novas.
async function openItems(interaction, deps, type, page = 0, notice = null) {
  if (type === "product") {
    await openProducts(interaction, deps, page, notice);
    return;
  }
  await openAnnouncements(interaction, deps, page, notice);
}

async function openLogs(interaction, deps, selected = "activation", notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildLogsPanel(panel, selected, notice)));
}

async function openLicenses(interaction, deps, notice = null) {
  const summary = await getLicenseSummary(deps.licenseStore);
  await interaction.update(asUpdate(buildLicensesPanel(summary, notice)));
}

async function openGeneral(interaction, deps, notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildGeneralPanel(panel, notice)));
}

// ── Lista de Apps (item 5) ───────────────────────────────────────────────────

async function openAppsList(interaction, deps, page = 0, notice = null) {
  const apps = await listLicensedApps(deps.licenseStore);
  await interaction.update(asUpdate(buildAppsListPanel(apps, page, notice)));
}

async function openAppDetail(interaction, deps, key, notice = null, isError = false) {
  const license = await findLicenseOrThrow(deps.licenseStore, key);
  await interaction.update(asUpdate(buildAppDetailPanel(license, notice, isError)));
}

async function handleAppToggle(interaction, deps, key) {
  const license = await findLicenseOrThrow(deps.licenseStore, key);

  try {
    let updated;
    if (license.status === "active") {
      updated = await suspendLicense(deps.licenseStore, key);
      await logAction(
        interaction,
        deps,
        "system",
        "App desativado pelo Manager",
        `Servidor ${updated.guildName || updated.guildId}`,
        updated.key,
        0xed4245
      );
    } else if (license.status === "suspended") {
      updated = await reactivateLicense(deps.licenseStore, key);
      await logAction(
        interaction,
        deps,
        "system",
        "App reativado pelo Manager",
        `Servidor ${updated.guildName || updated.guildId}`,
        updated.key,
        0x57f287
      );
    } else {
      throw new AppError("Este app nao pode ser ativado/desativado neste estado.", {
        statusCode: 400,
        code: "APP_TOGGLE_INVALID_STATE"
      });
    }

    await interaction.update(asUpdate(buildAppDetailPanel(updated, "Status atualizado com sucesso.")));
  } catch (error) {
    await interaction.update(
      asUpdate(buildAppDetailPanel(license, error.message === "LICENSE_NOT_ACTIVE" || error.message === "LICENSE_NOT_SUSPENDED" ? "Estado do app mudou, tente novamente." : "Falha ao atualizar status.", true))
    );
  }
}

async function findLicenseOrThrow(licenseStore, key) {
  const normalized = normalizeLicenseKey(key);
  const licenses = await licenseStore.getAll();
  const license = licenses[normalized];
  if (!license) {
    throw new AppError("App/licenca nao encontrado.", { statusCode: 404, code: "LICENSE_NOT_FOUND" });
  }
  return license;
}

// ── Bots Free (itens 9-11) ───────────────────────────────────────────────────

async function openFreeBots(interaction, deps, page = 0, notice = null) {
  const bots = await listFreeBots(deps.freeBotsStore);
  await interaction.update(asUpdate(buildFreeBotsPanel(bots, page, notice)));
  freeBotPanelTracker.trackListView(interaction.channelId, interaction.message.id, page);
}

async function openFreeBotDetail(interaction, deps, botId, notice = null, isError = false) {
  const bot = await getFreeBot(deps.freeBotsStore, botId);
  if (!bot) throw new AppError("Bot Free nao encontrado.", { statusCode: 404, code: "FREEBOT_NOT_FOUND" });
  await interaction.update(asUpdate(buildFreeBotDetailPanel(bot, notice, isError)));
  freeBotPanelTracker.trackDetailView(botId, interaction.channelId, interaction.message.id);
}

async function handleFreeBotToggleActive(interaction, deps, botId) {
  const bot = await getFreeBot(deps.freeBotsStore, botId);
  if (!bot) throw new AppError("Bot Free nao encontrado.", { statusCode: 404, code: "FREEBOT_NOT_FOUND" });

  const updated = await setFreeBotActive(deps.freeBotsStore, botId, !bot.active);
  await logAction(
    interaction,
    deps,
    "system",
    `Bot Free ${updated.active ? "ativado" : "desativado"} pelo Manager`,
    updated.name || updated.botId,
    updated.botId,
    updated.active ? 0x57f287 : 0xed4245
  );
  await interaction.update(asUpdate(buildFreeBotDetailPanel(updated, "Status atualizado com sucesso.")));
  freeBotPanelTracker.trackDetailView(botId, interaction.channelId, interaction.message.id);
}

async function openPaidBots(interaction, deps, page = 0, notice = null) {
  const bots = await listPaidBots(deps.paidBotsStore);
  await interaction.update(asUpdate(buildPaidBotsPanel(bots, page, notice)));
}

async function openPaidBotDetail(interaction, deps, installationId, notice = null, isError = false) {
  const bot = await getPaidBot(deps.paidBotsStore, installationId);
  if (!bot) throw new AppError("Instalacao do Bot Pago nao encontrada.", { statusCode: 404, code: "PAIDBOT_NOT_FOUND" });
  await interaction.update(asUpdate(buildPaidBotDetailPanel(bot, notice, isError)));
}

/**
 * Alterna 'enabled' de uma instalacao do Bot Pago (item 10). Chama
 * paidBotService diretamente (mesmo processo/mesmo store usado pela rota
 * HTTP /paidbot/admin/:id/enabled) em vez de bater na propria API HTTP - a
 * alteracao e persistida no paidBotsStore imediatamente e sera aplicada
 * pelo Bot Pago no proximo heartbeat/consulta de autorizacao (nao exige
 * reinicio do Bot Pago).
 */
async function handlePaidBotToggleEnabled(interaction, deps, installationId) {
  const bot = await getPaidBot(deps.paidBotsStore, installationId);
  if (!bot) throw new AppError("Instalacao do Bot Pago nao encontrada.", { statusCode: 404, code: "PAIDBOT_NOT_FOUND" });

  const updated = await setPaidBotEnabledFlag(deps.paidBotsStore, installationId, !bot.enabled);

  await logAction(
    interaction,
    deps,
    "paidbot_toggle",
    `Bot Pago ${updated.enabled ? "ativado" : "desativado"}`,
    `Instalacao \`${installationId}\` (${updated.botName || updated.botId}) foi ${updated.enabled ? "ativada" : "desativada"}.`
  );

  await interaction.update(asUpdate(buildPaidBotDetailPanel(updated, "Status atualizado com sucesso.")));
}

/**
 * Alterna 'blocked' de uma instalacao do Bot Pago (item 10). Mesmo
 * raciocinio de handlePaidBotToggleEnabled - blocked=true faz
 * computeAuthorization() (paidBotService) devolver authorized=false ao Bot
 * Pago mesmo que a flag crua authorized continue true.
 */
async function handlePaidBotToggleBlocked(interaction, deps, installationId) {
  const bot = await getPaidBot(deps.paidBotsStore, installationId);
  if (!bot) throw new AppError("Instalacao do Bot Pago nao encontrada.", { statusCode: 404, code: "PAIDBOT_NOT_FOUND" });

  const updated = await setPaidBotBlockedFlag(deps.paidBotsStore, installationId, !bot.blocked);

  await logAction(
    interaction,
    deps,
    "paidbot_toggle",
    `Bot Pago ${updated.blocked ? "bloqueado" : "desbloqueado"}`,
    `Instalacao \`${installationId}\` (${updated.botName || updated.botId}) foi ${updated.blocked ? "bloqueada" : "desbloqueada"}.`
  );

  await interaction.update(asUpdate(buildPaidBotDetailPanel(updated, "Status atualizado com sucesso.")));
}

async function handleFreeBotToggleBlock(interaction, deps, botId) {
  const bot = await getFreeBot(deps.freeBotsStore, botId);
  if (!bot) throw new AppError("Bot Free nao encontrado.", { statusCode: 404, code: "FREEBOT_NOT_FOUND" });

  const updated = await setFreeBotBlocked(deps.freeBotsStore, botId, !bot.blocked);
  await logAction(
    interaction,
    deps,
    "system",
    `Bot Free ${updated.blocked ? "bloqueado" : "desbloqueado"} pelo Manager`,
    updated.name || updated.botId,
    updated.botId,
    updated.blocked ? 0xed4245 : 0x57f287
  );
  await interaction.update(asUpdate(buildFreeBotDetailPanel(updated, "Status atualizado com sucesso.")));
  freeBotPanelTracker.trackDetailView(botId, interaction.channelId, interaction.message.id);
}

/**
 * Atualiza sozinho (sem clique) os embeds de "Bots Free" (lista e detalhe)
 * que estiverem abertos no Discord agora, refletindo o estado real gravado
 * no freeBotsStore: heartbeat, novo registro, guilds, e o bot cair para
 * offline por falta de heartbeat (o calculo de online/offline em si ja e
 * feito por isBotOnline() dentro de buildFreeBotDetailPanel/buildFreeBotsPanel
 * com base em lastSeenAt - aqui so garantimos que o embed seja re-renderizado
 * periodicamente para essa transicao aparecer sem precisar de clique).
 */
async function refreshTrackedFreeBotPanels(client, freeBotsStore) {
  const trackedLists = freeBotPanelTracker.getTrackedListViews();
  if (trackedLists.length > 0) {
    const bots = await listFreeBots(freeBotsStore);
    for (const view of trackedLists) {
      await applyPanelRefresh(client, view.channelId, view.messageId, buildFreeBotsPanel(bots, view.page));
    }
  }

  for (const botId of freeBotPanelTracker.getAllTrackedDetailBotIds()) {
    const views = freeBotPanelTracker.getTrackedDetailViews(botId);
    if (views.length === 0) continue;

    const bot = await getFreeBot(freeBotsStore, botId);
    if (!bot) {
      for (const view of views) freeBotPanelTracker.untrackMessage(view.channelId, view.messageId);
      continue;
    }

    for (const view of views) {
      await applyPanelRefresh(client, view.channelId, view.messageId, buildFreeBotDetailPanel(bot));
    }
  }
}

async function applyPanelRefresh(client, channelId, messageId, payload) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.()) {
      freeBotPanelTracker.untrackMessage(channelId, messageId);
      return;
    }
    const message = await channel.messages.fetch(messageId);
    await message.edit(asUpdate(payload));
  } catch (error) {
    // Mensagem apagada, sem permissao, ou o admin ja navegou para outra tela
    // nesse meio-tempo (o proprio handleButton/handleStringSelect ja teria
    // destravado o rastreamento nesse ultimo caso) - para de tentar essa mensagem.
    freeBotPanelTracker.untrackMessage(channelId, messageId);
  }
}

/**
 * Uma mensagem so mostra uma tela por vez. Quando o admin navega para
 * qualquer lugar que NAO seja o painel de Bots Free (lista, detalhe, ou as
 * proprias acoes de ativar/desativar/bloquear/desbloquear), essa mensagem
 * para de ser alvo do refresh automatico - senao o proximo ciclo periodico
 * sobrescreveria a tela nova com o antigo embed de Bots Free.
 */
function maybeUntrackFreeBotPanel(interaction) {
  const customId = interaction.customId || "";
  const isFreeBotNavigation = customId === "pc:admin:freebots" || customId.startsWith("pc:freebot:");
  if (!isFreeBotNavigation && interaction.message?.id) {
    freeBotPanelTracker.untrackMessage(interaction.channelId, interaction.message.id);
  }
}

async function handleAppAction(interaction, deps, action) {
  const settings = await deps.settingsStore.get();
  const provider = createProvider(settings, deps.logger);

  await interaction.reply(buildDisplayResponse({
    title: `Painel Central | app ${action}`,
    lines: ["-# Processando..."],
    accentColor: 0x5865f2,
    ephemeral: false
  }));

  if (action === "list") {
    const apps = await provider.listApps();
    const lines = [`**Host:** \`${providerLabel(settings.provider)}\``, `**Total:** \`${apps.length}\``];
    for (const app of apps.slice(0, 20)) {
      lines.push(`• \`${app.id}\` | **${app.name}** | ${app.online ? "online" : "offline"}`);
    }
    await interaction.editReply(buildDisplayResponse({
      title: "Painel Central | app list",
      lines,
      accentColor: 0x57f287,
      includeFlags: false
    }));
    return;
  }

  const appId = settings.defaultAppId;
  if (!appId) {
    throw new AppError("Defina o app padrao em botconfig.", { statusCode: 400, code: "APP_ID_REQUIRED" });
  }

  if (action === "status") {
    const status = await provider.getAppStatus(appId);
    await interaction.editReply(buildDisplayResponse({
      title: "Painel Central | app status",
      lines: [
        `**App ID:** \`${status.id}\``,
        `**Online:** \`${status.online ? "sim" : "nao"}\``,
        `**CPU:** \`${status.cpu ?? "n/d"}\``,
        `**RAM:** \`${status.ramUsage ?? "n/d"}\``,
        `**Uptime:** \`${status.uptime ?? "n/d"}\``
      ],
      accentColor: status.online ? 0x57f287 : 0xed4245,
      includeFlags: false
    }));
    return;
  }

  if (action === "logs") {
    const logs = await provider.getAppLogs(appId);
    await interaction.editReply(buildDisplayResponse({
      title: "Painel Central | app logs",
      lines: [`**App ID:** \`${appId}\``, toCodeBlock(clampText(logs, 2800), "bash")],
      accentColor: 0x5865f2,
      includeFlags: false
    }));
    return;
  }

  if (action === "backup") {
    const backup = await provider.createBackup(appId);
    await interaction.editReply(actionResult("app backup", appId, backup));
    return;
  }

  if (action === "delete") {
    const result = await provider.deleteApp(appId);
    if (result.ok) await deps.settingsStore.setDefaultAppId("");
    await interaction.editReply(actionResult("app delete", appId, result));
    return;
  }

  const current = await provider.getAppStatus(appId);
  if (action === "start" && current.online) {
    await interaction.editReply(actionResult("app start", appId, { ok: true, message: "Aplicacao ja esta online." }));
    return;
  }
  if ((action === "stop" || action === "restart") && !current.online) {
    await interaction.editReply(actionResult(`app ${action}`, appId, { ok: false, message: "Aplicacao esta offline." }));
    return;
  }

  const runners = {
    start: () => provider.startApp(appId),
    stop: () => provider.stopApp(appId),
    restart: () => provider.restartApp(appId)
  };
  if (!runners[action]) {
    throw new AppError("Acao invalida.", { statusCode: 400, code: "APP_ACTION_INVALID" });
  }

  const result = await runners[action]();
  await interaction.editReply(actionResult(`app ${action}`, appId, result));
}

async function handleItemButton(interaction, deps) {
  const customId = interaction.customId;

  if (customId.startsWith("pc:item:create:")) {
    await showCreateItemModal(interaction, customId.replace("pc:item:create:", ""));
    return;
  }

  if (customId.startsWith("pc:item:page:")) {
    const [, type, page] = customId.match(/^pc:item:page:([^:]+):(-?\d+)$/) || [];
    await openItems(interaction, deps, type || "all", Number(page || 0));
    return;
  }

  if (customId.startsWith("pc:item:bpage:")) {
    const [, itemId, page] = customId.match(/^pc:item:bpage:([^:]+):(-?\d+)$/) || [];
    const panel = await deps.panelStore.get();
    await interaction.update(asUpdate(buildItemEditor(panel, findItem(panel, itemId), null, Number(page || 0))));
    return;
  }

  if (customId.startsWith("pc:item:edit:")) {
    const panel = await deps.panelStore.get();
    await showEditItemModal(interaction, findItem(panel, customId.replace("pc:item:edit:", "")));
    return;
  }

  if (customId.startsWith("pc:item:meta:")) {
    const panel = await deps.panelStore.get();
    await showMetaItemModal(interaction, findItem(panel, customId.replace("pc:item:meta:", "")));
    return;
  }

  if (customId.startsWith("pc:item:addbtn:")) {
    const panel = await deps.panelStore.get();
    await showButtonModal(interaction, findItem(panel, customId.replace("pc:item:addbtn:", "")));
    return;
  }

  if (customId.startsWith("pc:item:remove:")) {
    const id = customId.replace("pc:item:remove:", "");
    const panel = await deps.panelStore.get();
    const item = findItem(panel, id);
    await deps.panelStore.removeAnnouncement(id);
    await openItems(interaction, deps, item.type, 0, "Item removido.");
    return;
  }

  if (customId.startsWith("pc:item:send:")) {
    const [, itemId, mode] = customId.match(/^pc:item:send:([^:]+):([^:]+)$/) || [];
    await sendItem(interaction, deps, itemId, mode);
  }
}

async function handleLogButton(interaction, deps) {
  if (interaction.customId.startsWith("pc:logs:clear:")) {
    const type = interaction.customId.replace("pc:logs:clear:", "");
    const panel = await deps.panelStore.setLogChannel(type, "");
    await interaction.update(asUpdate(buildLogsPanel(panel, type, "Canal removido.")));
    return;
  }

  if (interaction.customId.startsWith("pc:logs:test:")) {
    const type = interaction.customId.replace("pc:logs:test:", "");
    await sendPanelLog({
      client: interaction.client,
      panelStore: deps.panelStore,
      type,
      payload: { interaction, action: "Teste de log", product: "Painel Central", details: "Log enviado pelo painel." },
      logger: deps.logger,
      fallbackChannelId: deps.config?.licenseLogChannelId
    });
    await openLogs(interaction, deps, type, "Log de teste enviado.");
  }
}

async function handleLicenseButton(interaction) {
  if (interaction.customId === "pc:license:revoke") {
    await showRevokeModal(interaction);
  }
}

async function handleGeneralButton(interaction, deps) {
  const panel = await deps.panelStore.get();
  if (interaction.customId === "pc:general:visual") {
    await showVisualModal(interaction, panel.visual);
    return;
  }
  if (interaction.customId === "pc:general:media") {
    await showMediaModal(interaction, panel.visual);
  }
}

async function handleActivateModal(interaction, deps) {
  const key = normalizeLicenseKey(interaction.fields.getTextInputValue("key"));
  await interaction.reply(buildDisplayResponse({
    title: "Painel Central | ativar",
    lines: ["-# Validando key..."],
    accentColor: 0x5865f2,
    ephemeral: false
  }));

  try {
    const license = await activateLicense(deps.licenseStore, key, interaction.guild, interaction.user);
    const expires = formatDate(license.expiresAt);
    await interaction.editReply(buildDisplayResponse({
      title: "Licenca ativada",
      lines: [
        `**Servidor:** \`${interaction.guild.name}\``,
        `**Key:** \`${license.key}\``,
        `**Duracao:** \`${license.durationDays} dia(s)\``,
        `**Expira em:** \`${expires}\``
      ],
      accentColor: 0x57f287,
      includeFlags: false
    }));
    await sendActivationLog(interaction, deps, license);
  } catch (error) {
    const messages = {
      KEY_NOT_FOUND: "Key invalida.",
      KEY_ALREADY_USED: "Esta key ja foi utilizada.",
      KEY_EXPIRED: "Esta key esta expirada ou revogada."
    };
    await interaction.editReply(buildDisplayResponse({
      title: "Falha na ativacao",
      lines: [messages[error.message] || "Nao foi possivel ativar esta licenca."],
      accentColor: 0xed4245,
      includeFlags: false
    }));
    await logAction(interaction, deps, "activation", "Falha ao ativar licenca", error.message, key, 0xed4245);
  }
}

/**
 * Log de ativacao no novo formato (item 2), com botao de recompra do mesmo
 * item/produto vinculado a key (quando a key foi gerada com um productId).
 * Nao mexe na configuracao de canal (panel.logChannels.activation).
 */
async function sendActivationLog(interaction, deps, license) {
  let productName = null;
  let buyButton = null;

  if (license.productId) {
    try {
      const panel = await deps.panelStore.get();
      const product = findItem(panel, license.productId);
      if (product) {
        productName = product.name;
        const link = (product.buttons || []).find((btn) => btn.url);
        if (link?.url) {
          buyButton = new ButtonBuilder()
            .setLabel(`Comprar novamente: ${product.name}`.slice(0, 80))
            .setStyle(ButtonStyle.Link)
            .setURL(link.url);
        }
      }
    } catch {
      // segue sem botao de recompra se o produto nao existir mais
    }
  }

  await sendPanelLog({
    client: interaction.client,
    panelStore: deps.panelStore,
    type: "activation",
    payload: {
      interaction,
      activation: {
        productName,
        customerMention: `<@${interaction.user.id}>`,
        guildName: interaction.guild?.name || license.guildName,
        durationDays: license.durationDays,
        expiresAtFormatted: formatExtendedDate(license.expiresAt)
      }
    },
    components: buyButton ? [new ActionRowBuilder().addComponents(buyButton)] : [],
    logger: deps.logger,
    fallbackChannelId: deps.config?.licenseLogChannelId
  });
}

async function handleKeyModal(interaction, deps) {
  const days = Number(interaction.fields.getTextInputValue("days"));
  const productId = interaction.fields.getTextInputValue("product_id")?.trim() || null;
  const license = await createLicense(deps.licenseStore, days, { productId });
  await interaction.reply(buildDisplayResponse({
    title: "Key gerada",
    lines: [
      `**Key:** \`${license.key}\``,
      `**Duracao:** \`${license.durationDays} dia(s)\``,
      "**Status:** `pendente`",
      productId ? `**Produto vinculado:** \`${productId}\`` : null
    ].filter(Boolean),
    accentColor: 0x57f287,
    ephemeral: false
  }));
  await logAction(interaction, deps, "key_generation", "Key gerada", `${license.durationDays} dia(s)`, license.key, 0x57f287);
}

async function handleCreateItemModal(interaction, deps, type) {
  const item = await deps.panelStore.createAnnouncement({
    type: type === "product" ? "product" : "announcement",
    name: interaction.fields.getTextInputValue("name"),
    title: interaction.fields.getTextInputValue("title"),
    description: interaction.fields.getTextInputValue("description"),
    color: interaction.fields.getTextInputValue("color"),
    imageUrl: interaction.fields.getTextInputValue("image_url")
  });
  const panel = await deps.panelStore.get();
  await interaction.reply(buildItemEditor(panel, item, "Item criado."));
}

async function handleEditItemModal(interaction, deps, itemId) {
  await deps.panelStore.updateAnnouncement(itemId, {
    title: interaction.fields.getTextInputValue("title"),
    description: interaction.fields.getTextInputValue("description"),
    color: interaction.fields.getTextInputValue("color"),
    imageUrl: interaction.fields.getTextInputValue("image_url"),
    thumbnailUrl: interaction.fields.getTextInputValue("thumbnail_url")
  });
  await replyEditor(interaction, deps, itemId, "Embed atualizado.");
}

async function handleMetaItemModal(interaction, deps, itemId) {
  await deps.panelStore.updateAnnouncement(itemId, {
    name: interaction.fields.getTextInputValue("name"),
    footer: interaction.fields.getTextInputValue("footer"),
    channelId: interaction.fields.getTextInputValue("channel_id")
  });
  await replyEditor(interaction, deps, itemId, "Configuracao atualizada.");
}

async function handleAddButtonModal(interaction, deps, itemId) {
  await deps.panelStore.addButton(itemId, readButtonFields(interaction));
  await replyEditor(interaction, deps, itemId, "Botao adicionado.");
}

async function handleEditButtonModal(interaction, deps, itemId, buttonId) {
  await deps.panelStore.updateButton(itemId, buttonId, readButtonFields(interaction));
  await replyEditor(interaction, deps, itemId, "Botao atualizado.");
}

async function handleRevokeModal(interaction, deps) {
  const key = normalizeLicenseKey(interaction.fields.getTextInputValue("key"));
  const license = await revokeLicense(deps.licenseStore, key);
  await interaction.reply(buildDisplayResponse({
    title: "Key revogada",
    lines: [`**Key:** \`${license.key}\``],
    accentColor: 0x57f287,
    ephemeral: false
  }));
  await logAction(interaction, deps, "license_expiration", "Key revogada", "Revogada pelo painel.", license.key, 0xed4245);
}

async function handleVisualModal(interaction, deps) {
  const panel = await deps.panelStore.patchVisual({
    title: interaction.fields.getTextInputValue("title"),
    description: interaction.fields.getTextInputValue("description"),
    color: normalizeColor(interaction.fields.getTextInputValue("color")),
    footer: interaction.fields.getTextInputValue("footer")
  });
  await interaction.reply(buildGeneralPanel(panel, "Visual atualizado."));
}

async function handleMediaModal(interaction, deps) {
  const panel = await deps.panelStore.patchVisual({
    bannerUrl: interaction.fields.getTextInputValue("banner_url"),
    thumbnailUrl: interaction.fields.getTextInputValue("thumbnail_url")
  });
  await interaction.reply(buildGeneralPanel(panel, "Midias atualizadas."));
}

async function sendItem(interaction, deps, itemId, mode) {
  await interaction.reply(buildDisplayResponse({
    title: "Painel Central | enviar",
    lines: ["-# Enviando..."],
    accentColor: 0x5865f2,
    ephemeral: false
  }));

  const panel = await deps.panelStore.get();
  const item = findItem(panel, itemId);
  const channelId = mode === "current" ? interaction.channelId : item.channelId;
  if (!channelId) {
    throw new AppError("Escolha um canal de envio.", { statusCode: 400, code: "CHANNEL_REQUIRED" });
  }

  const count = await sendAnnouncement(interaction.client, item, channelId);
  await interaction.editReply(buildDisplayResponse({
    title: "Anuncio enviado",
    lines: [`**Item:** ${item.name}`, `**Canal:** <#${channelId}>`, `**Mensagens:** \`${count}\``],
    accentColor: 0x57f287,
    includeFlags: false
  }));
  await logAction(interaction, deps, "announcement_sent", "Anuncio enviado", `Canal ${channelId} | ${count} mensagem(ns)`, item.name, 0x57f287);
}

async function handleAdClick(interaction, deps) {
  const [, itemId, buttonId] = interaction.customId.match(/^pc:adclick:([^:]+):([^:]+)$/) || [];
  const panel = await deps.panelStore.get();
  const item = findItem(panel, itemId);
  const itemButton = findButton(item, buttonId);
  await logAction(interaction, deps, inferLogType(itemButton), itemButton.label, itemButton.url || "Botao sem link.", item.name);

  const rows = itemButton.url
    ? [[new ButtonBuilder().setLabel("Abrir link").setStyle(ButtonStyle.Link).setURL(itemButton.url)]]
    : [];
  await interaction.reply(buildDisplayResponse({
    title: itemButton.label,
    lines: [itemButton.url || "Botao sem link configurado."],
    rows,
    accentColor: color(item.color),
    ephemeral: false
  }));
}

function showActivateModal(interaction) {
  const modal = new ModalBuilder().setCustomId("pc:modal:activate").setTitle("ativar");
  modal.addComponents(input("key", "Key de licenca", TextInputStyle.Short, { placeholder: "ZYON-XXXX-XXXX-XXXX", required: true }));
  return interaction.showModal(modal);
}

function showKeyModal(interaction) {
  const modal = new ModalBuilder().setCustomId("pc:modal:key").setTitle("gerar key");
  modal.addComponents(
    input("days", "Duracao em dias", TextInputStyle.Short, { value: "30", required: true }),
    input("product_id", "ID do produto (opcional, para recompra)", TextInputStyle.Short, { required: false })
  );
  return interaction.showModal(modal);
}

function showCreateItemModal(interaction, type) {
  const modal = new ModalBuilder()
    .setCustomId(`pc:modal:item_create:${type === "product" ? "product" : "announcement"}`)
    .setTitle(type === "product" ? "Criar produto" : "Criar anuncio");
  modal.addComponents(
    input("name", "Nome interno", TextInputStyle.Short, { required: true }),
    input("title", "Titulo do embed", TextInputStyle.Short, { required: true }),
    input("description", "Descricao", TextInputStyle.Paragraph, { required: true }),
    input("color", "Cor HEX", TextInputStyle.Short, { value: "#2b87ff", required: true }),
    input("image_url", "Imagem/banner URL", TextInputStyle.Paragraph, { required: false })
  );
  return interaction.showModal(modal);
}

function showEditItemModal(interaction, item) {
  const modal = new ModalBuilder().setCustomId(`pc:modal:item_edit:${item.id}`).setTitle("Editar embed");
  modal.addComponents(
    input("title", "Titulo", TextInputStyle.Short, { value: item.title, required: true }),
    input("description", "Descricao", TextInputStyle.Paragraph, { value: item.description, required: true }),
    input("color", "Cor HEX", TextInputStyle.Short, { value: item.color, required: true }),
    input("image_url", "Imagem/banner URL", TextInputStyle.Paragraph, { value: item.imageUrl, required: false }),
    input("thumbnail_url", "Thumbnail URL", TextInputStyle.Paragraph, { value: item.thumbnailUrl, required: false })
  );
  return interaction.showModal(modal);
}

function showMetaItemModal(interaction, item) {
  const modal = new ModalBuilder().setCustomId(`pc:modal:item_meta:${item.id}`).setTitle("Footer e canal");
  modal.addComponents(
    input("name", "Nome interno", TextInputStyle.Short, { value: item.name, required: true }),
    input("footer", "Footer", TextInputStyle.Short, { value: item.footer, required: false }),
    input("channel_id", "ID do canal de envio", TextInputStyle.Short, { value: item.channelId, required: false })
  );
  return interaction.showModal(modal);
}

function showButtonModal(interaction, item, itemButton = null) {
  const editing = Boolean(itemButton);
  const modal = new ModalBuilder()
    .setCustomId(editing ? `pc:modal:button_edit:${item.id}:${itemButton.id}` : `pc:modal:button_add:${item.id}`)
    .setTitle(editing ? "Editar botao" : "Adicionar botao");
  modal.addComponents(
    input("label", "Nome do botao", TextInputStyle.Short, { value: itemButton?.label || "", required: true }),
    input("emoji", "Emoji", TextInputStyle.Short, { value: itemButton?.emoji || "", required: false }),
    input("url", "Link personalizado", TextInputStyle.Paragraph, { value: itemButton?.url || "", required: false }),
    input("style", "Estilo", TextInputStyle.Short, { value: itemButton?.style || "link", required: true })
  );
  return interaction.showModal(modal);
}

function showRevokeModal(interaction) {
  const modal = new ModalBuilder().setCustomId("pc:modal:revoke").setTitle("Revogar key");
  modal.addComponents(input("key", "Key", TextInputStyle.Short, { placeholder: "ZYON-XXXX-XXXX-XXXX", required: true }));
  return interaction.showModal(modal);
}

function showVisualModal(interaction, visual) {
  const modal = new ModalBuilder().setCustomId("pc:modal:visual").setTitle("Editar visual");
  modal.addComponents(
    input("title", "Titulo do painel", TextInputStyle.Short, { value: visual.title, required: true }),
    input("description", "Descricao", TextInputStyle.Paragraph, { value: visual.description, required: true }),
    input("color", "Cor HEX", TextInputStyle.Short, { value: visual.color, required: true }),
    input("footer", "Footer", TextInputStyle.Short, { value: visual.footer, required: false })
  );
  return interaction.showModal(modal);
}

function showMediaModal(interaction, visual) {
  const modal = new ModalBuilder().setCustomId("pc:modal:media").setTitle("Midias");
  modal.addComponents(
    input("banner_url", "Banner URL", TextInputStyle.Paragraph, { value: visual.bannerUrl, required: false }),
    input("thumbnail_url", "Thumbnail URL", TextInputStyle.Paragraph, { value: visual.thumbnailUrl, required: false })
  );
  return interaction.showModal(modal);
}

function input(customId, label, style, options = {}) {
  const builder = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(Boolean(options.required));
  if (options.placeholder) builder.setPlaceholder(String(options.placeholder).slice(0, 100));
  if (options.value) builder.setValue(String(options.value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 1000));
  return new ActionRowBuilder().addComponents(builder);
}

async function updateEditor(interaction, deps, itemId, notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.update(asUpdate(buildItemEditor(panel, findItem(panel, itemId), notice)));
}

async function replyEditor(interaction, deps, itemId, notice = null) {
  const panel = await deps.panelStore.get();
  await interaction.reply(buildItemEditor(panel, findItem(panel, itemId), notice));
}

async function sendAnnouncement(client, item, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new AppError("Canal invalido.", { statusCode: 400, code: "CHANNEL_INVALID" });
  }

  const embed = new EmbedBuilder()
    .setTitle(item.title)
    .setDescription(item.description)
    .setColor(color(item.color))
    .setTimestamp();
  if (item.imageUrl) embed.setImage(item.imageUrl);
  if (item.thumbnailUrl) embed.setThumbnail(item.thumbnailUrl);
  if (item.footer) embed.setFooter({ text: item.footer });

  const chunks = chunk(item.buttons, 25);
  if (chunks.length === 0) {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return 1;
  }

  let sent = 0;
  for (const [index, buttons] of chunks.entries()) {
    const components = chunk(buttons, 5).map((row) =>
      new ActionRowBuilder().addComponents(row.map((itemButton) => adButton(item, itemButton)))
    );
    await channel.send({
      embeds: index === 0 ? [embed] : [],
      content: index === 0 ? undefined : `Links extras - ${item.title}`,
      components,
      allowedMentions: { parse: [] }
    });
    sent += 1;
  }
  return sent;
}

function adButton(item, itemButton) {
  const builder = new ButtonBuilder().setLabel(itemButton.label.slice(0, 80));
  if (itemButton.emoji) {
    try {
      builder.setEmoji(itemButton.emoji);
    } catch {
    }
  }
  if (itemButton.style === "link" && itemButton.url) {
    return builder.setStyle(ButtonStyle.Link).setURL(itemButton.url);
  }
  return builder.setCustomId(`pc:adclick:${item.id}:${itemButton.id}`).setStyle(style(itemButton.style));
}

function style(value) {
  if (value === "primary") return ButtonStyle.Primary;
  if (value === "success") return ButtonStyle.Success;
  if (value === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

function actionResult(title, appId, result) {
  return buildDisplayResponse({
    title: `Painel Central | ${title}`,
    lines: [
      `**App ID:** \`${appId}\``,
      `**Resultado:** \`${result.ok ? "ok" : "falha"}\``,
      `**Mensagem:** ${result.message || "n/d"}`
    ],
    accentColor: result.ok ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

function buildActivationOnlyPanel(panel) {
  return buildDisplayResponse({
    title: `👑 ${panel.visual.title} | Ativacao`,
    lines: ["✅ **Ative sua licenca neste servidor.**", "━━━━━━━━━━━━━━━━━━━━━━━"],
    rows: [[new ButtonBuilder().setCustomId("pc:cmd:ativar").setLabel("ativar").setStyle(ButtonStyle.Primary).setEmoji("✅")]],
    accentColor: color(panel.visual.color),
    ephemeral: false
  });
}

function getItemPanelType(customId) {
  if (customId === "pc:products:select") return "product";
  if (customId === "pc:announcements:select") return "announcement";
  if (customId === "pc:item:select:product") return "product";
  if (customId === "pc:item:select:announcement") return "announcement";
  return null;
}

function findItem(panel, id) {
  const item = panel.announcements.find((entry) => entry.id === id);
  if (!item) throw new AppError("Item nao encontrado.", { statusCode: 404, code: "ITEM_NOT_FOUND" });
  return item;
}

function findButton(item, id) {
  const itemButton = item.buttons.find((entry) => entry.id === id);
  if (!itemButton) throw new AppError("Botao nao encontrado.", { statusCode: 404, code: "BUTTON_NOT_FOUND" });
  return itemButton;
}

function readButtonFields(interaction) {
  return {
    label: interaction.fields.getTextInputValue("label"),
    emoji: interaction.fields.getTextInputValue("emoji"),
    url: interaction.fields.getTextInputValue("url"),
    style: interaction.fields.getTextInputValue("style")
  };
}

function asUpdate(payload) {
  const next = { ...payload };
  delete next.flags;
  return next;
}

function hasAdminAccess(interaction, settings) {
  try {
    assertManagerAccess(interaction, settings);
    return true;
  } catch {
    return false;
  }
}

async function requireAdmin(interaction, settingsStore) {
  const settings = await settingsStore.get();
  assertManagerAccess(interaction, settings);
  return settings;
}

async function logAction(interaction, deps, type, action, details, productOrKey = "n/d", colorValue = 0x2b87ff) {
  await sendPanelLog({
    client: interaction.client,
    panelStore: deps.panelStore,
    type,
    payload: {
      interaction,
      action,
      details,
      product: productOrKey,
      key: productOrKey,
      color: colorValue
    },
    logger: deps.logger,
    fallbackChannelId: deps.config?.licenseLogChannelId
  });
}

function inferLogType(itemButton) {
  const label = String(itemButton.label || "").toLowerCase();
  if (label.includes("ticket")) return "tickets";
  if (label.includes("compr") || label.includes("loja") || label.includes("produto")) return "purchases";
  return "system";
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

module.exports = {
  createCentralPanelController,
  executePanelCommand,
  refreshTrackedFreeBotPanels
};
