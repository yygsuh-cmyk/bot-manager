const fs = require("node:fs/promises");
const path = require("node:path");
const axios = require("axios");

const DEFAULT_EMOJI_BLUEPRINT = [
  { key: "brand_cloud", name: "bm_cloud", file: "cloud.png" },
  { key: "brand_bot", name: "bm_bot", file: "robot.png" },
  { key: "state_on", name: "bm_on", file: "on.png" },
  { key: "state_off", name: "bm_off", file: "off.png" },
  { key: "action_power", name: "bm_power", file: "power.png" },
  { key: "action_restart", name: "bm_restart", file: "reload.png" },
  { key: "action_sync", name: "bm_sync", file: "sync.png" },
  { key: "action_logs", name: "bm_logs", file: "message.png" },
  { key: "action_status", name: "bm_info", file: "information.png" },
  { key: "action_settings", name: "bm_settings", file: "settings.png" },
  { key: "action_delete", name: "bm_delete", file: "delete.png" },
  { key: "state_ok", name: "bm_ok", file: "correct.png" },
  { key: "state_error", name: "bm_error", file: "wrong.png" },
  { key: "state_warn", name: "bm_warn", file: "warn.png" },
  { key: "state_time", name: "bm_time", file: "clock.png" },
  { key: "state_light", name: "bm_light", file: "light_on.png" },
  { key: "state_grid", name: "bm_grid", file: "commands.png" },
  { key: "state_folder", name: "bm_folder", file: "folder.png" },
  { key: "state_lock", name: "bm_lock", file: "lock.png" }
];

async function syncApplicationEmojis(options) {
  const {
    applicationId,
    botToken,
    assetsDir,
    logger
  } = options;

  if (!applicationId || !botToken) {
    logger.warn("Sync de application emojis ignorado por falta de applicationId/token.");
    return {};
  }

  if (!(await pathExists(assetsDir))) {
    logger.warn("Pasta de assets nao encontrada para sync de emojis.", { assetsDir });
    return {};
  }

  const http = axios.create({
    baseURL: "https://discord.com/api/v10",
    timeout: 20_000,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });

  const existing = await fetchExistingEmojis(http, applicationId, logger);
  const byName = new Map(existing.map((emoji) => [emoji.name, emoji]));
  const map = {};

  for (const blueprint of DEFAULT_EMOJI_BLUEPRINT) {
    const filePath = path.join(assetsDir, blueprint.file);
    if (!(await pathExists(filePath))) {
      logger.warn("Asset de emoji nao encontrado.", {
        key: blueprint.key,
        filePath
      });
      continue;
    }

    const known = byName.get(blueprint.name);
    if (known) {
      map[blueprint.key] = {
        id: String(known.id),
        name: known.name,
        animated: Boolean(known.animated)
      };
      continue;
    }

    try {
      const image = await toDataUri(filePath);
      const created = await createEmoji(http, applicationId, blueprint.name, image);
      map[blueprint.key] = {
        id: String(created.id),
        name: created.name,
        animated: Boolean(created.animated)
      };
      await sleep(350);
    } catch (error) {
      logger.warn("Falha ao criar application emoji.", {
        key: blueprint.key,
        name: blueprint.name,
        message: error.message,
        details: error.details ?? null
      });
    }
  }

  logger.info("Sync de application emojis finalizado.", {
    total: Object.keys(map).length
  });

  return map;
}

async function fetchExistingEmojis(http, applicationId, logger) {
  const response = await http.get(`/applications/${applicationId}/emojis`);
  if (response.status < 200 || response.status >= 300) {
    logger.warn("Nao foi possivel listar application emojis existentes.", {
      status: response.status,
      body: response.data
    });
    return [];
  }

  const payload = response.data;
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.emojis)) {
    return payload.emojis;
  }
  return [];
}

async function createEmoji(http, applicationId, name, image) {
  const response = await http.post(`/applications/${applicationId}/emojis`, {
    name,
    image
  });

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Falha ao criar emoji ${name}. HTTP ${response.status}`);
    error.details = response.data;
    throw error;
  }

  return response.data;
}

async function toDataUri(filePath) {
  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".gif"
      ? "image/gif"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : "image/png";

  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  syncApplicationEmojis
};
