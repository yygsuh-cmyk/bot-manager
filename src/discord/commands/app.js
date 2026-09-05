const { ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const { AppError } = require("../../utils/errors");
const { assertManagerAccess } = require("../../utils/permissions");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { getConfiguredProvider, resolveTargetAppId } = require("../../services/managerService");
const { clampText, providerLabel, toCodeBlock } = require("../../utils/format");
const { getButtonEmoji, getInlineEmoji } = require("../../services/emojiRegistry");
const { createProvider } = require("../../services/providerFactory");

function createAppCommand({ settingsStore, logger }) {
  return {
    data: buildAppCommandData(),

    async execute(interaction) {
      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);

      const { provider } = await getConfiguredProvider(settingsStore, logger);
      const subcommand = interaction.options.getSubcommand();

      await interaction.reply(
        buildDisplayResponse({
          title: "App Manager",
          lines: ["-# Processando comando, aguarde..."],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );

      if (subcommand === "list") {
        const payload = await handleList({ provider, settings });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "upload") {
        const attachment = interaction.options.getAttachment("arquivo", true);
        const payload = await handleUpload({ provider, settings, attachment, logger });
        await interaction.editReply(payload);
        return;
      }

      const appId = resolveTargetAppId(
        settings,
        interaction.options.getString("app_id")
      );

      if (subcommand === "status") {
        const payload = await handleStatus({ provider, settings, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "start") {
        const payload = await handleStart({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "stop") {
        const payload = await handleStop({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "restart") {
        const payload = await handleRestart({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "logs") {
        const payload = await handleLogs({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "backup") {
        const payload = await handleBackup({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "commit") {
        const attachment = interaction.options.getAttachment("arquivo", true);
        const payload = await handleCommit({ provider, appId, attachment, logger });
        await interaction.editReply(payload);
        return;
      }

      if (subcommand === "delete") {
        const payload = await handleDelete({ provider, appId });
        await interaction.editReply(payload);
        return;
      }

      await interaction.editReply(
        buildDisplayResponse({
          title: "Comando Invalido",
          lines: ["Subcomando nao suportado."],
          accentColor: 0xed4245,
          includeFlags: false
        })
      );
    },

    async autocomplete(interaction) {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== "app_id") {
        await interaction.respond([]);
        return;
      }

      const settings = await settingsStore.get();
      if (settings.guildId && interaction.guildId !== settings.guildId) {
        await interaction.respond([]);
        return;
      }

      const providerKey = settings.provider;
      if (!providerKey) {
        await interaction.respond([]);
        return;
      }

      const query = String(focused.value ?? "").toLowerCase().trim();
      let merged = [];
      try {
        const provider = createProvider(settings, logger);
        const liveApps = await provider.listApps();
        merged = mergeWithDefaultApp(liveApps, settings.defaultAppId);
      } catch {
        merged = mergeWithDefaultApp([], settings.defaultAppId);
      }

      const filtered = merged
        .filter((app) => {
          if (!query) {
            return true;
          }

          return (
            app.id.toLowerCase().includes(query) ||
            app.name.toLowerCase().includes(query)
          );
        })
        .slice(0, 25)
        .map((app) => ({
          name: `${app.name} (${app.id})`,
          value: app.id
        }));

      await interaction.respond(filtered);
    }
  };
}

async function handleList({ provider, settings }) {
  const apps = await provider.listApps();

  const lines = [
    `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
    `${getInlineEmoji("state_grid", "")} **Total:** \`${apps.length}\``
  ];

  if (apps.length === 0) {
    lines.push(`${getInlineEmoji("state_warn", "")} Nenhuma aplicacao encontrada para esta conta.`);
  } else {
    const visibleApps = apps.slice(0, 20);
    for (const app of visibleApps) {
      lines.push(
        `- \`${app.id}\` | **${app.name}** | ${app.online ? `${getInlineEmoji("state_on", "")} online` : `${getInlineEmoji("state_off", "")} offline`}`
      );
    }

    if (apps.length > visibleApps.length) {
      lines.push(`- ...e mais ${apps.length - visibleApps.length} aplicacoes.`);
    }
  }

  return buildDisplayResponse({
    title: "Aplicacoes",
    lines,
    accentColor: 0x57f287,
    includeFlags: false
  });
}

async function handleStatus({ provider, settings, appId }) {
  const status = await provider.getAppStatus(appId);
  return buildDisplayResponse({
    title: "Status da Aplicacao",
    lines: [
      `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
      `${getInlineEmoji("brand_bot", "")} **App ID:** \`${status.id}\``,
      `**Online:** \`${status.online ? "sim" : "nao"}\``,
      `**CPU:** \`${status.cpu ?? "n/d"}\``,
      `**RAM:** \`${status.ramUsage ?? "n/d"}\``,
      `**Uptime:** \`${status.uptime ?? "n/d"}\``
    ],
    accentColor: status.online ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

async function handleStart({ provider, appId }) {
  const current = await provider.getAppStatus(appId);
  if (current.online) {
    return buildDisplayResponse({
      title: "Start Ignorado",
      lines: [
        `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
        "A aplicacao ja esta online."
      ],
      accentColor: 0x57f287,
      includeFlags: false
    });
  }

  const result = await provider.startApp(appId);
  return actionResultPayload("Start Executado", appId, result);
}

async function handleStop({ provider, appId }) {
  const current = await provider.getAppStatus(appId);
  if (!current.online) {
    return buildDisplayResponse({
      title: "Stop Ignorado",
      lines: [
        `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
        "A aplicacao ja esta offline."
      ],
      accentColor: 0x57f287,
      includeFlags: false
    });
  }

  const result = await provider.stopApp(appId);
  return actionResultPayload("Stop Executado", appId, result);
}

async function handleRestart({ provider, appId }) {
  const current = await provider.getAppStatus(appId);
  if (!current.online) {
    return buildDisplayResponse({
      title: "Restart Bloqueado",
      lines: [
        `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
        "A aplicacao esta offline. Use /app start primeiro."
      ],
      accentColor: 0xed4245,
      includeFlags: false
    });
  }

  const result = await provider.restartApp(appId);
  return actionResultPayload("Restart Executado", appId, result);
}

async function handleLogs({ provider, appId }) {
  const logs = await provider.getAppLogs(appId);
  return buildDisplayResponse({
    title: "Logs da Aplicacao",
    lines: [
      `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
      toCodeBlock(clampText(logs, 2800), "bash")
    ],
    accentColor: 0x5865f2,
    includeFlags: false
  });
}

async function handleBackup({ provider, appId }) {
  const backup = await provider.createBackup(appId);
  const backupInfo = extractBackupInfo(backup.details);
  const lines = [
    `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
    `**Resultado:** \`${backup.ok ? "ok" : "falha"}\``
  ];
  const rows = [];

  if (backupInfo.validUrl) {
    lines.push("**Link backup:** valido");
    if (backupInfo.expireAtUnix) {
      lines.push(`**Expira em:** <t:${backupInfo.expireAtUnix}:F> (<t:${backupInfo.expireAtUnix}:R>)`);
    } else {
      lines.push("**Expira em:** nao identificado");
    }

    rows.push([
      withOptionalButtonEmoji(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(backupInfo.url)
          .setLabel("Baixar backup"),
        "state_folder"
      )
    ]);
  } else {
    lines.push("**Link backup:** nao encontrado ou invalido");
    lines.push(toCodeBlock(clampText(JSON.stringify(backup.details, null, 2), 2500), "json"));
  }

  return buildDisplayResponse({
    title: "Backup/Snapshot",
    lines,
    rows,
    accentColor: backup.ok ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

async function handleUpload({ provider, settings, attachment, logger }) {
  assertZipAttachment(attachment);
  const file = await downloadAttachmentFile(attachment, logger);
  if (settings.provider === "discloud") {
    assertDiscloudConfigAtZipRoot(file.buffer);
  }
  const result = await provider.uploadAppArchive(file.buffer, file.name);

  return buildDisplayResponse({
    title: "Upload de Aplicacao",
    lines: [
      `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
      `**Arquivo:** \`${file.name}\``,
      `**Resultado:** \`${result.ok ? "ok" : "falha"}\``,
      `**Mensagem:** ${result.message}`,
      toCodeBlock(clampText(JSON.stringify(result.details, null, 2), 2000), "json")
    ],
    accentColor: result.ok ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

async function handleCommit({ provider, appId, attachment, logger }) {
  assertZipAttachment(attachment);
  const file = await downloadAttachmentFile(attachment, logger);
  if (provider.providerKey === "discloud") {
    assertDiscloudConfigAtZipRoot(file.buffer);
  }
  const result = await provider.commitAppArchive(appId, file.buffer, file.name);

  return buildDisplayResponse({
    title: "Commit da Aplicacao",
    lines: [
      `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
      `**Arquivo:** \`${file.name}\``,
      `**Resultado:** \`${result.ok ? "ok" : "falha"}\``,
      `**Mensagem:** ${result.message}`,
      toCodeBlock(clampText(JSON.stringify(result.details, null, 2), 2000), "json")
    ],
    accentColor: result.ok ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

async function handleDelete({ provider, appId }) {
  const result = await provider.deleteApp(appId);
  return actionResultPayload("Delete Executado", appId, result);
}

function actionResultPayload(title, appId, result) {
  return buildDisplayResponse({
    title,
    lines: [
      `${getInlineEmoji("brand_bot", "")} **App ID:** \`${appId}\``,
      `**Resultado:** \`${result.ok ? "ok" : "falha"}\``,
      `**Mensagem:** ${result.message}`
    ],
    accentColor: result.ok ? 0x57f287 : 0xed4245,
    includeFlags: false
  });
}

function mergeWithDefaultApp(tracked, defaultAppId) {
  const list = Array.isArray(tracked) ? [...tracked] : [];
  if (!defaultAppId) {
    return list;
  }

  if (list.some((entry) => entry.id === defaultAppId)) {
    return list;
  }

  return [{ id: defaultAppId, name: "app-padrao" }, ...list];
}

function buildAppCommandData() {
  const data = new SlashCommandBuilder()
    .setName("app")
    .setDescription("Gerencia aplicacoes no host configurado");

  data.addSubcommand((sub) =>
    sub.setName("list").setDescription("Lista apps disponiveis no host")
  );

  data.addSubcommand((sub) =>
    sub
      .setName("upload")
      .setDescription("Faz upload de uma nova aplicacao (.zip) para o host ativo")
      .addAttachmentOption((option) =>
        option
          .setName("arquivo")
          .setDescription("Arquivo .zip da aplicacao")
          .setRequired(true)
      )
  );

  addActionSubcommand(data, "status", "Mostra status da aplicacao");
  addActionSubcommand(data, "start", "Liga a aplicacao");
  addActionSubcommand(data, "stop", "Desliga a aplicacao");
  addActionSubcommand(data, "restart", "Reinicia a aplicacao");
  addActionSubcommand(data, "logs", "Busca logs da aplicacao");
  addActionSubcommand(data, "backup", "Cria backup/snapshot da aplicacao");
  addActionSubcommandWithFile(data, "commit", "Envia commit (.zip) para a aplicacao");
  addActionSubcommand(data, "delete", "Remove a aplicacao permanentemente");

  return data;
}

function addActionSubcommand(commandBuilder, name, description) {
  commandBuilder.addSubcommand((sub) =>
    sub
      .setName(name)
      .setDescription(description)
      .addStringOption((option) =>
        option
          .setName("app_id")
          .setDescription("ID da aplicacao (autocomplete habilitado)")
          .setRequired(false)
          .setAutocomplete(true)
      )
  );
}

function addActionSubcommandWithFile(commandBuilder, name, description) {
  commandBuilder.addSubcommand((sub) =>
    sub
      .setName(name)
      .setDescription(description)
      .addAttachmentOption((option) =>
        option
          .setName("arquivo")
          .setDescription("Arquivo .zip para upload")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("app_id")
          .setDescription("ID da aplicacao (autocomplete habilitado)")
          .setRequired(false)
          .setAutocomplete(true)
      )
  );
}

function extractBackupInfo(details) {
  const url = findFirstUrl(details);
  const validUrl = isValidBackupUrl(url);
  const expireAtUnix = validUrl ? parseSignedUrlExpiryToUnix(url) : null;

  return {
    url: validUrl ? url : null,
    validUrl,
    expireAtUnix
  };
}

function findFirstUrl(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return looksLikeUrl(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstUrl(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const preferredKeys = ["url", "downloadUrl", "link", "backupUrl"];
    for (const key of preferredKeys) {
      const candidate = value[key];
      if (typeof candidate === "string" && looksLikeUrl(candidate)) {
        return candidate;
      }
    }

    for (const nested of Object.values(value)) {
      const found = findFirstUrl(nested);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function looksLikeUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidBackupUrl(url) {
  if (!looksLikeUrl(url)) {
    return false;
  }

  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const trusted =
    host.endsWith("discloud.com") ||
    host.endsWith("discloud.app") ||
    host.endsWith("squarecloud.app") ||
    host.endsWith("amazonaws.com");

  return trusted;
}

function parseSignedUrlExpiryToUnix(url) {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    const amzDateRaw = params.get("X-Amz-Date") || params.get("x-amz-date");
    const amzExpiresRaw = params.get("X-Amz-Expires") || params.get("x-amz-expires");

    if (amzDateRaw && amzExpiresRaw) {
      const base = parseAmzDate(amzDateRaw);
      const expiresIn = Number(amzExpiresRaw);
      if (base && Number.isFinite(expiresIn) && expiresIn > 0) {
        return Math.floor((base.getTime() + expiresIn * 1000) / 1000);
      }
    }

    const expiresRaw = params.get("Expires") || params.get("expires");
    if (expiresRaw) {
      const unix = Number(expiresRaw);
      if (Number.isFinite(unix) && unix > 0) {
        return Math.floor(unix);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function parseAmzDate(value) {
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function withOptionalButtonEmoji(button, emojiKey) {
  const emoji = getButtonEmoji(emojiKey);
  if (emoji) {
    button.setEmoji(emoji);
  }
  return button;
}

function assertZipAttachment(attachment) {
  const fileName = String(attachment?.name ?? "").toLowerCase();
  if (fileName.endsWith(".zip")) {
    return;
  }

  throw new AppError("Envie um arquivo .zip valido para upload/commit.", {
    statusCode: 400,
    code: "ZIP_REQUIRED"
  });
}

async function downloadAttachmentFile(attachment, logger) {
  const url = attachment?.url;
  if (!url) {
    throw new AppError("Arquivo anexado nao possui URL valida.", {
      statusCode: 400,
      code: "ATTACHMENT_URL_MISSING"
    });
  }

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60_000,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    logger.warn("Falha ao baixar attachment do Discord.", {
      status: response.status,
      fileName: attachment?.name ?? "arquivo.zip"
    });

    throw new AppError("Falha ao baixar arquivo anexado do Discord.", {
      statusCode: 502,
      code: "ATTACHMENT_DOWNLOAD_FAILED"
    });
  }

  return {
    name: attachment?.name ?? "upload.zip",
    buffer: Buffer.from(response.data)
  };
}

function assertDiscloudConfigAtZipRoot(zipBuffer) {
  const fileName = "discloud.config";
  const entries = extractZipEntries(zipBuffer);

  const normalized = entries.map((entry) =>
    String(entry || "").replace(/\\/g, "/").replace(/^\.?\//, "")
  );

  const atRoot = normalized.some(
    (entry) => entry.toLowerCase() === fileName
  );

  if (atRoot) {
    return;
  }

  const foundNested = normalized.some(
    (entry) => entry.toLowerCase().endsWith(`/${fileName}`)
  );

  const message = foundNested
    ? "Seu .zip tem discloud.config, mas nao esta na raiz. Compacte o conteudo interno da pasta (nao a pasta inteira)."
    : "Seu .zip nao contem discloud.config na raiz. Adicione o arquivo e tente novamente.";

  throw new AppError(message, {
    statusCode: 400,
    code: "DISCLOUD_CONFIG_MISSING"
  });
}

function extractZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new AppError("Arquivo .zip invalido ou corrompido.", {
      statusCode: 400,
      code: "ZIP_INVALID"
    });
  }

  const eocdOffset = findEocdOffset(buffer);
  if (eocdOffset < 0) {
    throw new AppError("Nao foi possivel ler o indice central do .zip.", {
      statusCode: 400,
      code: "ZIP_INVALID"
    });
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  const entries = [];

  let cursor = centralDirectoryOffset;
  while (cursor + 46 <= end && cursor + 46 <= buffer.length) {
    const signature = buffer.readUInt32LE(cursor);
    if (signature !== 0x02014b50) {
      break;
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);

    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > buffer.length) {
      break;
    }

    entries.push(buffer.toString("utf8", fileNameStart, fileNameEnd));
    cursor = fileNameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEocdOffset(buffer) {
  const signature = 0x06054b50;
  const maxBacktrack = Math.min(buffer.length - 22, 0xffff + 22);
  const start = buffer.length - 22;
  const min = Math.max(0, start - maxBacktrack);

  for (let i = start; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === signature) {
      return i;
    }
  }

  return -1;
}

module.exports = {
  createAppCommand
};
