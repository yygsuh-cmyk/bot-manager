const {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { LOG_TYPES } = require("../../services/logService");
const { maskToken, providerLabel } = require("../../utils/format");

const PAGE_SIZE = 6;

function buildHomePanel(settings, panel, notice = null) {
  const lines = [
    `✨ **${panel.visual.description}**`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `☁️ **Host:** \`${providerLabel(settings.provider)}\``,
    `🤖 **App padrao:** \`${settings.defaultAppId || "nao definido"}\``,
    `🔐 **Token:** \`${maskToken(settings.apiToken)}\``,
    `📢 **Anuncios/produtos:** \`${panel.announcements.length}\``,
    `📁 **Logs configurados:** \`${Object.values(panel.logChannels).filter(Boolean).length}/${LOG_TYPES.length}\``
  ];
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: `👑 ${panel.visual.title} | Painel Central`,
    lines,
    rows: [
      [
        button("pc:cmd:gerar_key", "gerar key", ButtonStyle.Success, "🔑"),
        button("pc:cmd:ativar", "ativar", ButtonStyle.Primary, "✅"),
        button("pc:cmd:app", "app", ButtonStyle.Primary, "🤖"),
        button("pc:admin:apps", "Lista de Apps", ButtonStyle.Secondary, "📋"),
        button("pc:admin:logs", "Configurar Logs", ButtonStyle.Primary, "📁")
      ],
      [
        button("pc:admin:announcements", "Gerenciar anuncios", ButtonStyle.Primary, "📢"),
        button("pc:admin:products", "Gerenciar produtos", ButtonStyle.Success, "🛒"),
        button("pc:admin:licenses", "Gerenciar licencas", ButtonStyle.Success, "🛡️"),
        button("pc:admin:general", "Configuracoes gerais", ButtonStyle.Secondary, "🎨")
      ],
      [
        button("pc:admin:freebots", "Bots Free", ButtonStyle.Primary, "🆓")
      ]
    ],
    accentColor: color(panel.visual.color),
    ephemeral: false
  });
}

function buildAppPanel(settings, notice = null, isError = false) {
  const ready = Boolean(settings.provider && settings.apiToken && settings.defaultAppId);
  const hostConfigured = Boolean(settings.provider && settings.apiToken);
  const lines = [
    "🤖 **Gerenciamento de aplicacoes**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    // Selecao de API (Square/Discloud) - movida para o painel App (item 8).
    `**API selecionada:** \`${providerLabel(settings.provider)}\``,
    `**Token:** \`${maskToken(settings.apiToken)}\``,
    `**App padrao:** \`${settings.defaultAppId || "nao definido"}\``,
    `**Status:** \`${ready ? "pronto" : "configure a API e o app padrao"}\``
  ];
  if (notice) lines.push(`-# ${isError ? "❌" : "✅"} ${notice}`);

  const hostSelect = new StringSelectMenuBuilder()
    .setCustomId("cfg:host_select")
    .setPlaceholder("Selecionar API: Square ou Discloud")
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

  return buildDisplayResponse({
    title: "Painel Central | app",
    lines,
    rows: [
      [hostSelect],
      [
        button("cfg:set_token", "Definir token", ButtonStyle.Primary, "🔐", !settings.provider),
        button("cfg:set_default_app", "Definir app padrao", ButtonStyle.Secondary, "⚙️", !hostConfigured),
        button("cfg:sync_apps", "Sincronizar apps", ButtonStyle.Success, "🔁", !hostConfigured)
      ],
      [
        button("pc:app:list", "Listar apps", ButtonStyle.Primary, "📋", !hostConfigured),
        button("pc:app:status", "Status", ButtonStyle.Secondary, "📡", !ready),
        button("pc:app:start", "Start", ButtonStyle.Success, "▶️", !ready),
        button("pc:app:restart", "Restart", ButtonStyle.Secondary, "🔄", !ready),
        button("pc:app:stop", "Stop", ButtonStyle.Danger, "⏹️", !ready)
      ],
      [
        button("pc:app:logs", "Logs", ButtonStyle.Secondary, "📜", !ready),
        button("pc:app:backup", "Backup", ButtonStyle.Secondary, "💾", !ready),
        button("pc:app:delete", "Delete app", ButtonStyle.Danger, "🗑️", !ready),
        button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: 0x2b87ff,
    ephemeral: false
  });
}

function buildProductsPanel(panel, page = 0, notice = null) {
  return buildItemsPanel(panel, {
    type: "product",
    page,
    notice,
    selectId: "pc:products:select",
    createId: "pc:products:create",
    pageId: "pc:products:page"
  });
}

function buildAnnouncementsPanel(panel, page = 0, notice = null) {
  return buildItemsPanel(panel, {
    type: "announcement",
    page,
    notice,
    selectId: "pc:announcements:select",
    createId: "pc:announcements:create",
    pageId: "pc:announcements:page"
  });
}

function buildItemsPanel(panel, { type, page = 0, notice = null, selectId, createId, pageId }) {
  const items = panel.announcements.filter((item) => item.type === type);
  const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const visible = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const title = type === "product" ? "Gerenciar produtos" : "Gerenciar anuncios";
  const lines = [
    `${type === "product" ? "🛒" : "📢"} **${title}**`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Total:** \`${items.length}\``,
    `**Pagina:** \`${safePage + 1}/${maxPage + 1}\``
  ];
  for (const item of visible) {
    lines.push(`• \`${item.id}\` **${item.name}** | botoes: \`${item.buttons.length}\``);
  }
  if (visible.length === 0) lines.push("-# Nenhum item criado.");
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: `Painel Central | ${title}`,
    lines,
    rows: [
      [itemSelect(visible, selectId)],
      [
        button(createId, type === "product" ? "Criar produto" : "Criar anuncio", ButtonStyle.Success, type === "product" ? "🛒" : "➕"),
        button(`${pageId}:${safePage - 1}`, "Anterior", ButtonStyle.Secondary, "◀️", safePage <= 0),
        button(`${pageId}:${safePage + 1}`, "Proxima", ButtonStyle.Secondary, "▶️", safePage >= maxPage),
        button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: color(panel.visual.color),
    ephemeral: false
  });
}

function buildItemEditor(panel, item, notice = null, buttonPage = 0) {
  const maxButtonPage = Math.max(0, Math.ceil(item.buttons.length / 25) - 1);
  const safeButtonPage = Math.max(0, Math.min(buttonPage, maxButtonPage));
  const visibleButtons = item.buttons.slice(safeButtonPage * 25, safeButtonPage * 25 + 25);
  const lines = [
    `📝 **${item.name}**`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Tipo:** \`${item.type === "product" ? "produto" : "anuncio"}\``,
    `**Titulo:** ${item.title}`,
    `**Cor:** \`${item.color}\``,
    `**Canal:** ${item.channelId ? `<#${item.channelId}>` : "`nao definido`"}`,
    `**Botoes:** \`${item.buttons.length}\``,
    `**Pagina de botoes:** \`${safeButtonPage + 1}/${maxButtonPage + 1}\``
  ];
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: "Painel Central | Editor",
    lines,
    rows: [
      [
        button(`pc:item:edit:${item.id}`, "Editar embed", ButtonStyle.Primary, "📝"),
        button(`pc:item:meta:${item.id}`, "Footer/canal", ButtonStyle.Secondary, "⚙️"),
        button(`pc:item:addbtn:${item.id}`, "Adicionar botao", ButtonStyle.Success, "➕"),
        button(`pc:item:send:${item.id}:configured`, "Enviar", ButtonStyle.Success, "📤"),
        button(`pc:item:send:${item.id}:current`, "Enviar aqui", ButtonStyle.Secondary, "📍")
      ],
      [channelSelect(`pc:item:channel:${item.id}`, "Escolher canal de envio")],
      [buttonSelect(visibleButtons, item.id, "edit")],
      [buttonSelect(visibleButtons, item.id, "remove")],
      [
        button(`pc:item:bpage:${item.id}:${safeButtonPage - 1}`, "Botoes ant.", ButtonStyle.Secondary, "◀️", safeButtonPage <= 0),
        button(`pc:item:bpage:${item.id}:${safeButtonPage + 1}`, "Botoes prox.", ButtonStyle.Secondary, "▶️", safeButtonPage >= maxButtonPage),
        button(`pc:item:remove:${item.id}`, item.type === "product" ? "Remover produto" : "Remover anuncio", ButtonStyle.Danger, "🗑️"),
        button(`pc:admin:${item.type === "product" ? "products" : "announcements"}`, "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: color(item.color),
    ephemeral: false
  });
}

function buildLogsPanel(panel, selected = "activation", notice = null) {
  const type = LOG_TYPES.some((entry) => entry.key === selected) ? selected : "activation";
  const current = LOG_TYPES.find((entry) => entry.key === type);
  const lines = [
    "📁 **Configurar Logs**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Categoria:** ${current.emoji} ${current.label}`,
    `**Canal atual:** ${panel.logChannels[type] ? `<#${panel.logChannels[type]}>` : "`nao definido`"}`
  ];
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: "Painel Central | Logs",
    lines,
    rows: [
      [logSelect(type)],
      [channelSelect(`pc:logs:channel:${type}`, "Selecionar canal desta categoria")],
      [
        button(`pc:logs:clear:${type}`, "Limpar canal", ButtonStyle.Danger, "🗑️"),
        button(`pc:logs:test:${type}`, "Testar log", ButtonStyle.Success, "✅"),
        button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: color(panel.visual.color),
    ephemeral: false
  });
}

function buildLicensesPanel(summary, notice = null) {
  const lines = [
    "🛡️ **Gerenciar licencas**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Total:** \`${summary.total}\``,
    `**Pendentes:** \`${summary.pending}\``,
    `**Ativas:** \`${summary.active}\``,
    `**Expiradas:** \`${summary.expired}\``,
    `**Revogadas:** \`${summary.revoked}\``
  ];
  for (const license of summary.recent.slice(0, 8)) {
    lines.push(`• \`${license.key}\` | ${license.status} | ${license.durationDays} dia(s)`);
  }
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: "Painel Central | Licencas",
    lines,
    rows: [[
      button("pc:cmd:gerar_key", "gerar key", ButtonStyle.Success, "🔑"),
      button("pc:license:revoke", "Revogar key", ButtonStyle.Danger, "🗑️"),
      button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
    ]],
    accentColor: 0x57f287,
    ephemeral: false
  });
}

const APP_PAGE_SIZE = 5;

/**
 * Lista de Apps (item 5): mostra todos os bots/apps usando uma key do Manager,
 * com controles reais de ativar/desativar (afetam a autorizacao consultada
 * pela API /license/check, usada pelo bot de filas e futuros bots).
 */
function buildAppsListPanel(licenses, page = 0, notice = null, isError = false) {
  const maxPage = Math.max(0, Math.ceil(licenses.length / APP_PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const visible = licenses.slice(safePage * APP_PAGE_SIZE, safePage * APP_PAGE_SIZE + APP_PAGE_SIZE);

  const lines = [
    "📋 **Lista de Apps**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Total de apps com licenca:** \`${licenses.length}\``,
    `**Pagina:** \`${safePage + 1}/${maxPage + 1}\``,
    "-# Selecione um app abaixo para ver detalhes e ativar/desativar."
  ];
  if (visible.length === 0) lines.push("-# Nenhum app ativado ainda.");
  if (notice) lines.push(`-# ${isError ? "❌" : "✅"} ${notice}`);

  const select = new StringSelectMenuBuilder().setCustomId("pc:apps:select").setPlaceholder("Selecionar app");
  if (visible.length === 0) {
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Nenhum app").setValue("none"));
    select.setDisabled(true);
  } else {
    for (const license of visible) {
      select.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel((license.guildName || license.guildId || license.key).slice(0, 100))
          .setDescription(`${license.status} • ${maskKeyForUi(license.key)}`.slice(0, 100))
          .setValue(license.key)
      );
    }
  }

  return buildDisplayResponse({
    title: "Painel Central | Lista de Apps",
    lines,
    rows: [
      [select],
      [
        button(`pc:apps:page:${safePage - 1}`, "Anterior", ButtonStyle.Secondary, "◀️", safePage <= 0),
        button(`pc:apps:page:${safePage + 1}`, "Proxima", ButtonStyle.Secondary, "▶️", safePage >= maxPage),
        button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: 0x2b87ff,
    ephemeral: false
  });
}

function buildAppDetailPanel(license, notice = null, isError = false) {
  const active = license.status === "active";
  const lines = [
    `📱 **${license.guildName || "Servidor desconhecido"}**`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Servidor (ID):** \`${license.guildId || "n/d"}\``,
    `**Cliente:** ${license.userName || "n/d"} \`${license.userId || "n/d"}\``,
    `**Key:** \`${maskKeyForUi(license.key)}\``,
    `**Status:** \`${license.status}\``,
    `**Ativado em:** ${license.activatedAt ? new Date(license.activatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "n/d"}`,
    `**Expira em:** ${license.expiresAt ? new Date(license.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "n/d"}`
  ];
  if (notice) lines.push(`-# ${isError ? "❌" : "✅"} ${notice}`);

  return buildDisplayResponse({
    title: "Painel Central | Detalhe do App",
    lines,
    rows: [
      [
        button(`pc:apps:toggle:${license.key}`, active ? "Desativar bot" : "Ativar bot", active ? ButtonStyle.Danger : ButtonStyle.Success, active ? "⛔" : "✅", license.status === "expired" || license.status === "revoked"),
        button("pc:admin:apps", "Voltar a lista", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: active ? 0x57f287 : 0xed4245,
    ephemeral: false
  });
}

function maskKeyForUi(key) {
  const parts = String(key || "").split("-");
  if (parts.length < 2) return key || "n/d";
  return `${parts[0]}-****-****-${parts[parts.length - 1]}`;
}

const FREEBOT_PAGE_SIZE = 5;

/**
 * Painel administrativo dos Bots Free (itens 9-11). Os bots free ainda nao
 * estao conectados; este painel ja opera sobre a estrutura de dados/endpoints
 * preparados para quando eles passarem a se registrar no Manager.
 */
function buildFreeBotsPanel(bots, page = 0, notice = null, isError = false) {
  const maxPage = Math.max(0, Math.ceil(bots.length / FREEBOT_PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const visible = bots.slice(safePage * FREEBOT_PAGE_SIZE, safePage * FREEBOT_PAGE_SIZE + FREEBOT_PAGE_SIZE);

  const lines = [
    "🆓 **Gerenciar Bots Free**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Bots registrados:** \`${bots.length}\``,
    `**Pagina:** \`${safePage + 1}/${maxPage + 1}\``
  ];
  if (bots.length === 0) {
    lines.push(
      "-# Nenhum Bot Free conectado ainda. A estrutura (registro, heartbeat, ativar/desativar, bloqueio) ja esta pronta em `/freebot/*` para quando os bots Free forem integrados."
    );
  } else {
    for (const bot of visible) {
      const online = isBotOnline(bot);
      lines.push(
        `• **${bot.name || bot.botId}** \`${bot.botId}\` | ${bot.blocked ? "🔒 bloqueado" : bot.active ? "✅ ativo" : "⏸️ inativo"} | ${bot.status || (online ? "online" : "offline")} | servidores: \`${(bot.guilds || []).length}\``
      );
    }
  }
  if (notice) lines.push(`-# ${isError ? "❌" : "✅"} ${notice}`);

  const select = new StringSelectMenuBuilder().setCustomId("pc:freebot:select").setPlaceholder("Selecionar bot free");
  if (visible.length === 0) {
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Nenhum bot").setValue("none"));
    select.setDisabled(true);
  } else {
    for (const bot of visible) {
      select.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel((bot.name || bot.botId).slice(0, 100))
          .setDescription(`v${bot.version || "n/d"} • ${(bot.guilds || []).length} servidor(es)`.slice(0, 100))
          .setValue(bot.botId)
      );
    }
  }

  return buildDisplayResponse({
    title: "Painel Central | Bots Free",
    lines,
    rows: [
      [select],
      [
        button(`pc:freebot:page:${safePage - 1}`, "Anterior", ButtonStyle.Secondary, "◀️", safePage <= 0),
        button(`pc:freebot:page:${safePage + 1}`, "Proxima", ButtonStyle.Secondary, "▶️", safePage >= maxPage),
        button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
      ]
    ],
    accentColor: 0x2b87ff,
    ephemeral: false
  });
}

function buildFreeBotDetailPanel(bot, notice = null, isError = false) {
  const online = isBotOnline(bot);
  const guildLines = (bot.guilds || []).slice(0, 10).map((g) => `• ${g.name || g.id} \`${g.id}\``);
  const lines = [
    `🆓 **${bot.name || bot.botId}**`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Bot ID:** \`${bot.botId}\``,
    `**Tipo:** \`${bot.type || "free"}\``,
    `**Versao:** \`${bot.version || "n/d"}\``,
    `**Produto:** \`${bot.product || "n/d"}\``,
    `**Status:** \`${bot.blocked ? "bloqueado" : bot.active ? "ativo" : "inativo"}\``,
    `**Status reportado:** \`${bot.status || "n/d"}\``,
    `**Conexao:** ${online ? "🟢 online" : "🔴 offline"}`,
    `**Servidores (${(bot.guilds || []).length}):**`,
    ...(guildLines.length ? guildLines : ["-# nenhum servidor informado"]),
    `**Ultima comunicacao:** ${bot.lastSeenAt ? new Date(bot.lastSeenAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}`,
    `**Ultimo erro:** ${bot.lastError || "nenhum"}`
  ];
  if (!online) {
    lines.push("-# Nenhuma instalacao/conexao esta disponivel agora. As alteracoes de ativacao e bloqueio ficam salvas no Manager e serao aplicadas na proxima consulta de autorizacao.");
  }
  if (notice) lines.push(`-# ${isError ? "❌" : "✅"} ${notice}`);

  const guildButtons = (bot.guilds || [])
    .slice(0, 3)
    .filter((g) => g.id)
    .map((g) =>
      new ButtonBuilder()
        .setLabel(`Abrir ${String(g.name || g.id).slice(0, 60)}`)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${g.id}`)
    );

  const rows = [
    [
      button(`pc:freebot:toggle_active:${bot.botId}`, bot.active ? "Desativar" : "Ativar", bot.active ? ButtonStyle.Danger : ButtonStyle.Success, bot.active ? "⏸️" : "▶️"),
      button(`pc:freebot:toggle_block:${bot.botId}`, bot.blocked ? "Desbloquear" : "Bloquear", bot.blocked ? ButtonStyle.Success : ButtonStyle.Danger, bot.blocked ? "🔓" : "🔒"),
      button("pc:admin:freebots", "Voltar a lista", ButtonStyle.Secondary, "↩️")
    ]
  ];
  if (guildButtons.length) rows.push(guildButtons);

  return buildDisplayResponse({
    title: "Painel Central | Bot Free",
    lines,
    rows,
    accentColor: bot.blocked ? 0xed4245 : bot.active ? 0x57f287 : 0x99aab5,
    ephemeral: false
  });
}

function isBotOnline(bot) {
  if (!bot.lastSeenAt) return false;
  return Date.now() - new Date(bot.lastSeenAt).getTime() < 5 * 60 * 1000;
}

function buildGeneralPanel(panel, notice = null) {
  const visual = panel.visual;
  const lines = [
    "🎨 **Configuracoes gerais**",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `**Titulo:** ${visual.title}`,
    `**Cor:** \`${visual.color}\``,
    `**Banner:** \`${visual.bannerUrl ? "definido" : "nao definido"}\``,
    `**Thumbnail:** \`${visual.thumbnailUrl ? "definido" : "nao definido"}\``,
    `**Footer:** ${visual.footer}`
  ];
  if (notice) lines.push(`-# ✅ ${notice}`);

  return buildDisplayResponse({
    title: "Painel Central | Configuracoes",
    lines,
    rows: [[
      button("pc:general:visual", "Editar visual", ButtonStyle.Primary, "🎨"),
      button("pc:general:media", "Banner/thumbnail", ButtonStyle.Secondary, "🖼️"),
      button("pc:home", "Voltar", ButtonStyle.Secondary, "↩️")
    ]],
    accentColor: color(visual.color),
    ephemeral: false
  });
}

function button(customId, label, style, emoji, disabled = false) {
  const builder = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(Boolean(disabled));
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

function itemSelect(items, customId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Selecione para editar")
    .setDisabled(items.length === 0)
    .setMinValues(1)
    .setMaxValues(1);

  if (items.length === 0) {
    return select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Nenhum item").setValue("none"));
  }

  return select.addOptions(items.map((item) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(item.name.slice(0, 100))
      .setDescription(`${item.type === "product" ? "Produto" : "Anuncio"} • ${item.buttons.length} botao(oes)`.slice(0, 100))
      .setValue(item.id)
      .setEmoji(item.type === "product" ? "🛒" : "📢")
  ));
}

function buttonSelect(buttons, itemId, action) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`pc:item:button_${action}:${itemId}`)
    .setPlaceholder(action === "edit" ? "Editar botao" : "Remover botao")
    .setDisabled(buttons.length === 0)
    .setMinValues(1)
    .setMaxValues(1);

  if (buttons.length === 0) {
    return select.addOptions(new StringSelectMenuOptionBuilder().setLabel("Nenhum botao").setValue("none"));
  }

  return select.addOptions(buttons.slice(0, 25).map((buttonItem) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(buttonItem.label.slice(0, 100))
      .setDescription(`${buttonItem.style} • ${buttonItem.url ? "link definido" : "sem link"}`.slice(0, 100))
      .setValue(buttonItem.id)
      .setEmoji("🔘")
  ));
}

function logSelect(selected) {
  return new StringSelectMenuBuilder()
    .setCustomId("pc:logs:type")
    .setPlaceholder("Selecione o tipo de log")
    .addOptions(LOG_TYPES.map((entry) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(entry.label.slice(0, 100))
        .setValue(entry.key)
        .setEmoji(entry.emoji)
        .setDefault(entry.key === selected)
    ));
}

function channelSelect(customId, placeholder) {
  return new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
}

function color(hex) {
  const parsed = Number.parseInt(String(hex || "#2b87ff").replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2b87ff;
}

module.exports = {
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
  buildProductsPanel,
  color
};
