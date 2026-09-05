const crypto = require("node:crypto");
const { AppError } = require("../utils/errors");

/**
 * Servico dos Bots Free - arquitetura preparatoria (itens 9, 10, 11 e 12).
 *
 * Os Bots Free ainda NAO estao conectados ao Manager. Esta camada define o
 * protocolo que sera usado quando eles passarem a se conectar:
 *
 *  1. registerBot(): o Bot Free se registra uma unica vez (autenticado com
 *     FREE_BOT_REGISTRATION_KEY) e recebe de volta um token proprio da
 *     instancia. O Manager guarda apenas o HASH desse token (nunca o valor
 *     em texto puro), seguindo o item 12 (nao expor segredos em logs/DB).
 *  2. heartbeat(): o Bot Free chama periodicamente (autenticado com o token
 *     recebido no registro) informando servidores/status. Isso atualiza
 *     lastSeenAt (usado para online/offline no painel).
 *  3. getAuthorization(): o Bot Free consulta se esta autorizado a operar
 *     (nao bloqueado e ativo).
 *  4. setActive()/setBlocked(): controles que o painel do Manager usa para
 *     ativar/desativar/bloquear um bot - afetam de verdade o retorno de
 *     getAuthorization(), entao o Bot Free (quando implementado) deve
 *     respeitar esse retorno antes de operar em cada servidor.
 */

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateToken() {
  return `freebot_${crypto.randomBytes(24).toString("hex")}`;
}

function generateBotId(name) {
  const slug = String(name || "bot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24);
  return `${slug || "bot"}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeBotId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  return normalized || null;
}

function normalizeMetadata(value, maxLength = 100) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

async function registerBot(freeBotsStore, { botId: requestedBotId, name, product, version } = {}) {
  const botId = normalizeBotId(requestedBotId) || generateBotId(name);
  const token = generateToken();

  // Se este botId ja existe (reregistro: ex. o Bot Free perdeu o token local e
  // precisou se registrar de novo, mas manteve o mesmo bot_id persistido), o
  // registro NUNCA deve resetar o estado de ativo/bloqueado definido pelo painel
  // do Manager. So um botId realmente novo comeca com active=true/blocked=false.
  const existing = await freeBotsStore.get(botId);

  const bot = await freeBotsStore.upsert(botId, {
    name: name || existing?.name || botId,
    product: product || existing?.product || null,
    version: normalizeMetadata(version) || existing?.version || null,
    type: "free",
    tokenHash: hashToken(token),
    active: existing ? existing.active : true,
    enabled: existing ? existing.active : true,
    blocked: existing ? existing.blocked : false,
    guilds: existing?.guilds || [],
    status: "online",
    lastSeenAt: new Date().toISOString(),
    lastError: null
  });

  return { bot, token };
}

async function verifyBotToken(freeBotsStore, botId, token) {
  const bot = await freeBotsStore.get(botId);
  if (!bot || !bot.tokenHash) {
    throw new AppError("Bot nao registrado.", { statusCode: 401, code: "FREEBOT_NOT_REGISTERED" });
  }

  // Nunca confia apenas no ID enviado pelo cliente (item 12): o token tem
  // que bater com o hash guardado no registro.
  if (hashToken(token) !== bot.tokenHash) {
    throw new AppError("Token invalido.", { statusCode: 401, code: "FREEBOT_INVALID_TOKEN" });
  }

  return bot;
}

async function heartbeat(freeBotsStore, botId, token, { guilds, status, error, name, version } = {}) {
  await verifyBotToken(freeBotsStore, botId, token);

  const patch = {
    lastSeenAt: new Date().toISOString(),
    lastError: error ? String(error).slice(0, 300) : null
  };
  if (Array.isArray(guilds)) patch.guilds = guilds.slice(0, 500);
  if (normalizeMetadata(status, 40)) patch.status = normalizeMetadata(status, 40);
  if (normalizeMetadata(name, 100)) patch.name = normalizeMetadata(name, 100);
  if (normalizeMetadata(version, 100)) patch.version = normalizeMetadata(version, 100);

  return freeBotsStore.upsert(botId, patch);
}

async function getAuthorization(freeBotsStore, botId, token) {
  const bot = await verifyBotToken(freeBotsStore, botId, token);
  return {
    authorized: bot.active && !bot.blocked,
    active: bot.active,
    enabled: bot.enabled,
    blocked: bot.blocked
  };
}

async function listFreeBots(freeBotsStore) {
  const bots = await freeBotsStore.getAll();
  return Object.values(bots).sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
}

async function getFreeBot(freeBotsStore, botId) {
  return freeBotsStore.get(botId);
}

async function setFreeBotActive(freeBotsStore, botId, active) {
  const enabled = Boolean(active);
  return freeBotsStore.upsert(botId, { active: enabled, enabled });
}

async function setFreeBotBlocked(freeBotsStore, botId, blocked) {
  return freeBotsStore.upsert(botId, { blocked: Boolean(blocked) });
}

module.exports = {
  generateBotId,
  generateToken,
  getAuthorization,
  getFreeBot,
  hashToken,
  heartbeat,
  listFreeBots,
  normalizeBotId,
  registerBot,
  setFreeBotActive,
  setFreeBotBlocked,
  verifyBotToken
};
