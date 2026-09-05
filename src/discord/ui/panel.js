const {
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const { maskToken, providerLabel } = require("../../utils/format");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { getButtonEmoji, getInlineEmoji } = require("../../services/emojiRegistry");

function buildBotConfigPanel(
  settings,
  notice = null,
  noticeIsError = false,
  options = {}
) {
  const includeFlags = options.includeFlags ?? true;
  const appOnline = options.appOnline ?? null;
  const liveStatusText = options.liveStatusText ?? null;
  const statusMode = options.statusMode ?? "unknown";
  const hostConfigured = Boolean(settings.provider && settings.apiToken);
  const appReady = hostConfigured && Boolean(settings.defaultAppId);
  const admins = settings.adminUserIds ?? [];
  const explicitAdmins = admins.length;
  const setupStateLine = buildSetupStateLine(settings);
  const color = notice
    ? noticeIsError
      ? 0xed4245
      : 0x57f287
    : 0x2b87ff;

  const lines = [
    `-# ${setupStateLine}`,
    `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
    `${getInlineEmoji("state_lock", "")} **Token:** \`${maskToken(settings.apiToken)}\``,
    `${getInlineEmoji("brand_bot", "")} **App padrao:** \`${settings.defaultAppId || "nao definido"}\``,
    `${getInlineEmoji("state_folder", "")} **Servidor alvo:** \`${settings.guildId || "nao definido"}\``,
    `${getInlineEmoji("state_grid", "")} **Admins explicitos:** \`${explicitAdmins}\``,
    `**Acesso fallback:** \`${explicitAdmins > 0 ? "desativado (lista explicita)" : "owner/admin do servidor"}\``
  ];

  if (liveStatusText) {
    lines.push(`${getInlineEmoji("action_status", "")} **Status real-time:** ${liveStatusText}`);
  }

  if (notice) {
    const noticeEmoji = noticeIsError
      ? getInlineEmoji("state_error", "")
      : getInlineEmoji("state_ok", "");
    lines.push(`-# ${noticeEmoji} ${notice}`);
  }

  const hostSelect = new StringSelectMenuBuilder()
    .setCustomId("cfg:host_select")
    .setPlaceholder("Selecione ou troque o host principal")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("SquareCloud")
        .setDescription("API v2 da SquareCloud")
        .setValue("squarecloud")
        .setDefault(settings.provider === "squarecloud"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Discloud")
        .setDescription("API v2 da Discloud")
        .setValue("discloud")
        .setDefault(settings.provider === "discloud")
    );

  const setupRow = [
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:set_token")
      .setLabel("Definir token")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!settings.provider),
      "state_lock"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:set_default_app")
      .setLabel("Definir app padrao")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hostConfigured),
      "action_settings"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:sync_apps")
      .setLabel("Sincronizar apps")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hostConfigured),
      "action_restart"
    )
  ];

  const statusKnown = statusMode === "online" || statusMode === "offline";
  const startDisabled = !appReady || !statusKnown || appOnline !== false;
  const restartDisabled = !appReady || !statusKnown || appOnline !== true;
  const stopDisabled = !appReady || !statusKnown || appOnline !== true;

  const actionRow = [
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_status")
      .setLabel("Status")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!appReady),
      "action_status"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_start")
      .setLabel("Start")
      .setStyle(ButtonStyle.Success)
      .setDisabled(startDisabled),
      "state_on"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_restart")
      .setLabel("Restart")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(restartDisabled),
      "action_restart"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(stopDisabled),
      "action_power"
    )
  ];

  const advancedRow = [
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_logs")
      .setLabel("Logs")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!appReady),
      "action_logs"
    ),
    withOptionalEmoji(
      new ButtonBuilder()
      .setCustomId("cfg:quick_delete")
      .setLabel("Delete app")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!appReady),
      "action_delete"
    )
  ];

  const payload = buildDisplayResponse({
    title: "Bot Manager /botconfig",
    lines,
    rows: [[hostSelect], setupRow, actionRow, advancedRow],
    accentColor: color,
    ephemeral: true
  });

  if (!includeFlags) {
    delete payload.flags;
  }

  return payload;
}

module.exports = {
  buildBotConfigPanel
};

function buildSetupStateLine(settings) {
  const hasProvider = Boolean(settings.provider);
  const hasToken = Boolean(settings.apiToken);
  const hasDefaultApp = Boolean(settings.defaultAppId);

  if (!hasProvider) {
    return "Setup 1/3: selecione o host para iniciar.";
  }

  if (!hasToken) {
    return "Setup 2/3: defina o token da API do host selecionado.";
  }

  if (!hasDefaultApp) {
    return "Setup 3/3: defina o app padrao para habilitar acoes rapidas.";
  }

  return "Setup concluido: painel pronto para uso em producao.";
}

function withOptionalEmoji(button, emojiKey) {
  const emoji = getButtonEmoji(emojiKey);
  if (emoji) {
    button.setEmoji(emoji);
  }
  return button;
}
