const axios = require("axios");
const { SlashCommandBuilder } = require("discord.js");
const { AppError } = require("../../utils/errors");
const { assertManagerAccess } = require("../../utils/permissions");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { getConfiguredProvider } = require("../../services/managerService");
const { clampText, providerLabel, toCodeBlock } = require("../../utils/format");
const { getInlineEmoji } = require("../../services/emojiRegistry");
const { createProvider } = require("../../services/providerFactory");

function createHostApiCommand({ settingsStore, logger }) {
  return {
    data: buildHostApiCommandData(),

    async execute(interaction) {
      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);

      await interaction.reply(
        buildDisplayResponse({
          title: "Host API",
          lines: ["-# Executando requisicao avancada..."],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );

      const { provider } = await getConfiguredProvider(settingsStore, logger);
      const method = String(interaction.options.getString("method", true)).toUpperCase();
      const endpointInput = interaction.options.getString("endpoint", true);
      const queryJson = interaction.options.getString("query_json");
      const bodyJson = interaction.options.getString("body_json");
      const file = interaction.options.getAttachment("arquivo");

      const appId = interaction.options.getString("app_id");
      const dbId = interaction.options.getString("db_id");
      const workspaceId = interaction.options.getString("workspace_id");

      const query = parseJsonOption(queryJson, "query_json", true);
      const body = parseJsonOption(bodyJson, "body_json", false);
      const endpoint = normalizeEndpoint(endpointInput, { appId, dbId, workspaceId });

      const startedAt = Date.now();
      let responsePayload;
      let mode = "json";

      if (file) {
        const downloaded = await downloadAttachmentFile(file, logger);
        const fields = buildMultipartFields(body);
        responsePayload = await provider.rawMultipart({
          method,
          url: endpoint,
          params: query,
          fileBuffer: downloaded.buffer,
          fileName: downloaded.name,
          fileContentType: file.contentType || "application/octet-stream",
          fields
        });
        mode = "multipart";
      } else {
        responsePayload = await provider.rawRequest({
          method,
          url: endpoint,
          params: query,
          data: body
        });
      }

      await interaction.editReply(
        buildDisplayResponse({
          title: "Host API",
          lines: [
            `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
            `**Metodo:** \`${method}\``,
            `**Endpoint:** \`${endpoint}\``,
            `**Modo:** \`${mode}\``,
            `**Tempo:** \`${Date.now() - startedAt}ms\``,
            toCodeBlock(clampText(JSON.stringify(responsePayload, null, 2), 3000), "json")
          ],
          accentColor: 0x57f287,
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
      if (!settings.provider || (settings.guildId && settings.guildId !== interaction.guildId)) {
        await interaction.respond([]);
        return;
      }

      const query = String(focused.value ?? "").toLowerCase().trim();
      let pool = mergeDefaultApp([], settings.defaultAppId);
      try {
        const provider = createProvider(settings, logger);
        const liveApps = await provider.listApps();
        pool = mergeDefaultApp(liveApps, settings.defaultAppId);
      } catch {
        pool = mergeDefaultApp([], settings.defaultAppId);
      }

      await interaction.respond(
        pool
          .filter((entry) => !query || entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((entry) => ({
            name: `${entry.name} (${entry.id})`,
            value: entry.id
          }))
      );
    }
  };
}

module.exports = {
  createHostApiCommand
};

function buildHostApiCommandData() {
  const data = new SlashCommandBuilder()
    .setName("hostapi")
    .setDescription("Executor avancado dos endpoints da API do host ativo");

  data.addSubcommand((sub) =>
    sub
      .setName("call")
      .setDescription("Executa endpoint da API (SquareCloud/Discloud)")
      .addStringOption((option) =>
        option
          .setName("method")
          .setDescription("Metodo HTTP")
          .setRequired(true)
          .addChoices(
            { name: "GET", value: "GET" },
            { name: "POST", value: "POST" },
            { name: "PUT", value: "PUT" },
            { name: "PATCH", value: "PATCH" },
            { name: "DELETE", value: "DELETE" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("endpoint")
          .setDescription("Ex: /app/{appID}/status ou /apps/{app_id}/envs")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("query_json")
          .setDescription("JSON de query string (objeto), ex: {\"scope\":\"applications\"}")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("body_json")
          .setDescription("JSON body (objeto/array), ex: {\"ramMB\":512}")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("app_id")
          .setDescription("Substitui {app_id}/{appID}/{appId} no endpoint")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("db_id")
          .setDescription("Substitui {db_id}/{dbID}/{dbId} no endpoint")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("workspace_id")
          .setDescription("Substitui {workspace_id}/{workspaceID}/{workspaceId}")
          .setRequired(false)
      )
      .addAttachmentOption((option) =>
        option
          .setName("arquivo")
          .setDescription("Arquivo para multipart/form-data (campo file)")
          .setRequired(false)
      )
  );

  return data;
}

function parseJsonOption(raw, optionName, requireObject) {
  if (!raw || !String(raw).trim()) {
    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(`Opcao ${optionName} contem JSON invalido.`, {
      statusCode: 400,
      code: "INVALID_JSON_INPUT"
    });
  }

  if (requireObject && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new AppError(`Opcao ${optionName} precisa ser um objeto JSON.`, {
      statusCode: 400,
      code: "INVALID_JSON_OBJECT"
    });
  }

  return parsed;
}

function normalizeEndpoint(rawEndpoint, values) {
  let endpoint = String(rawEndpoint || "").trim();
  if (!endpoint) {
    throw new AppError("Endpoint nao pode ser vazio.", {
      statusCode: 400,
      code: "ENDPOINT_REQUIRED"
    });
  }

  if (/^https?:\/\//i.test(endpoint)) {
    throw new AppError("Informe endpoint relativo (sem dominio), ex: /app/{appID}/status.", {
      statusCode: 400,
      code: "ENDPOINT_RELATIVE_REQUIRED"
    });
  }

  if (!endpoint.startsWith("/")) {
    endpoint = `/${endpoint}`;
  }

  if (endpoint === "/v2") {
    endpoint = "/";
  } else if (endpoint.startsWith("/v2/")) {
    endpoint = endpoint.slice(3);
  }

  endpoint = applyPlaceholder(endpoint, "app_id", values.appId);
  endpoint = applyPlaceholder(endpoint, "appID", values.appId);
  endpoint = applyPlaceholder(endpoint, "appId", values.appId);
  endpoint = applyPlaceholder(endpoint, "db_id", values.dbId);
  endpoint = applyPlaceholder(endpoint, "dbID", values.dbId);
  endpoint = applyPlaceholder(endpoint, "dbId", values.dbId);
  endpoint = applyPlaceholder(endpoint, "workspace_id", values.workspaceId);
  endpoint = applyPlaceholder(endpoint, "workspaceID", values.workspaceId);
  endpoint = applyPlaceholder(endpoint, "workspaceId", values.workspaceId);

  const unresolved = endpoint.match(/\{[^}]+\}/g);
  if (unresolved) {
    throw new AppError(
      `Endpoint contem placeholders sem valor: ${unresolved.join(", ")}`,
      {
        statusCode: 400,
        code: "ENDPOINT_PLACEHOLDER_MISSING"
      }
    );
  }

  return endpoint;
}

function applyPlaceholder(endpoint, placeholder, value) {
  if (!value) {
    return endpoint;
  }

  const token = `{${placeholder}}`;
  return endpoint.split(token).join(String(value));
}

function buildMultipartFields(body) {
  if (typeof body === "undefined") {
    return {};
  }

  if (!Array.isArray(body) && body && typeof body === "object") {
    return body;
  }

  return {
    payload_json: JSON.stringify(body)
  };
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
    logger.warn("Falha ao baixar attachment para hostapi.", {
      status: response.status,
      fileName: attachment?.name ?? "upload.bin"
    });

    throw new AppError("Falha ao baixar arquivo anexado do Discord.", {
      statusCode: 502,
      code: "ATTACHMENT_DOWNLOAD_FAILED"
    });
  }

  return {
    name: attachment?.name ?? "upload.bin",
    buffer: Buffer.from(response.data)
  };
}

function mergeDefaultApp(apps, defaultAppId) {
  const normalized = Array.isArray(apps)
    ? apps.map((entry) => ({
        id: String(entry.id),
        name: String(entry.name || entry.id)
      }))
    : [];

  if (!defaultAppId || normalized.some((entry) => entry.id === defaultAppId)) {
    return normalized;
  }

  return [{ id: defaultAppId, name: "app-padrao" }, ...normalized];
}
