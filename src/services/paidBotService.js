const crypto = require("node:crypto");
const { AppError } = require("../utils/errors");

/**
 * Servico da integracao real do Bot Pago com o Manager.
 *
 * Espelha deliberadamente o mesmo protocolo/padrao ja usado por
 * freeBotService.js (registro com chave compartilhada -> token proprio da
 * instalacao -> heartbeat/autorizacao autenticados com esse token), para nao
 * criar uma arquitetura paralela dentro do mesmo projeto.
 *
 * Diferencas para o fluxo do Bot Free:
 *  - Cada instalacao tem um installationId proprio (pode existir mais de uma
 *    instalacao do mesmo botId, embora isso nao deva ser comum). O registro
 *    e um upsert por installationId: reenviar o mesmo installationId nunca
 *    cria uma instalacao nova, apenas renova o token e os metadados.
 *  - Suporta o sentido Manager -> Bot Pago: comandos podem ser enfileirados
 *    (queueCommand, usado por uma rota administrativa autenticada com
 *    API_KEY) e sao entregues ao Bot Pago tanto no proprio heartbeat quanto
 *    via GET /paidbot/commands, e confirmados com POST /paidbot/commands/ack.
 *
 * Seguranca:
 *  - O Manager NUNCA recebe nem guarda o token do Discord do Bot Pago -
 *    apenas o hash do token proprio da instalacao (tokenHash), assim como o
 *    freeBotService faz para os Bots Free.
 *  - Toda chamada apos o registro exige o token da instalacao - o
 *    installationId/botId sozinhos nunca sao suficientes.
 */

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateToken() {
  return `paidbot_${crypto.randomBytes(24).toString("hex")}`;
}

function generateInstallationId() {
  return `inst_${crypto.randomBytes(12).toString("hex")}`;
}

function generateCommandId() {
  return `cmd_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeId(value, maxLength = 64) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, maxLength);
  return normalized || null;
}

function normalizeMetadata(value, maxLength = 150) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeGuilds(guilds) {
  if (!Array.isArray(guilds)) return null;
  return guilds
    .filter((g) => g && g.guildId)
    .slice(0, 2000)
    .map((g) => ({
      guildId: String(g.guildId),
      guildName: normalizeMetadata(g.guildName, 200) || String(g.guildId)
    }));
}

async function registerInstallation(
  paidBotsStore,
  { botId, botName, version, installationId: requestedInstallationId } = {}
) {
  const normalizedBotId = normalizeId(botId, 64);
  if (!normalizedBotId) {
    throw new AppError("botId e obrigatorio.", { statusCode: 400, code: "BOT_ID_REQUIRED" });
  }

  // Reenviar o mesmo installationId (ex: reinicio do Bot Pago) NUNCA cria
  // uma instalacao nova - so um installationId realmente novo (ou ausente)
  // gera um identificador novo. Isso evita registrar o mesmo bot varias
  // vezes sem motivo.
  const installationId = normalizeId(requestedInstallationId, 80) || generateInstallationId();
  const token = generateToken();
  const existing = await paidBotsStore.get(installationId);

  const bot = await paidBotsStore.upsert(installationId, {
    botId: normalizedBotId,
    botName: normalizeMetadata(botName, 100) || existing?.botName || normalizedBotId,
    version: normalizeMetadata(version, 100) || existing?.version || null,
    type: "paid",
    tokenHash: hashToken(token),
    // O estado de autorizado/ativo/bloqueado definido pelo Manager nunca e
    // resetado por um re-registro (mesmo motivo do freeBotService: perda do
    // token local nao pode virar uma forma de burlar um bloqueio ou
    // reativar uma instalacao desautorizada).
    authorized: existing ? existing.authorized : true,
    enabled: existing ? existing.enabled : true,
    blocked: existing ? existing.blocked : false,
    guilds: existing?.guilds || [],
    guildCount: existing?.guilds ? existing.guilds.length : 0,
    status: "online",
    lastSeenAt: new Date().toISOString(),
    lastError: null,
    pendingCommands: existing?.pendingCommands || [],
    commandHistory: existing?.commandHistory || []
  });

  return { bot, token, installationId };
}

async function verifyInstallationToken(paidBotsStore, installationId, token) {
  const normalizedId = normalizeId(installationId, 80);
  if (!normalizedId) {
    throw new AppError("installationId invalido.", { statusCode: 400, code: "INSTALLATION_ID_REQUIRED" });
  }

  const bot = await paidBotsStore.get(normalizedId);
  if (!bot || !bot.tokenHash) {
    throw new AppError("Instalacao nao registrada.", { statusCode: 401, code: "PAIDBOT_NOT_REGISTERED" });
  }

  if (!token || hashToken(token) !== bot.tokenHash) {
    throw new AppError("Token invalido.", { statusCode: 401, code: "PAIDBOT_INVALID_TOKEN" });
  }

  return bot;
}

/**
 * Marca como "delivered" (sem remover) os comandos ainda "pending" de uma
 * instalacao, devolvendo a lista que deve ser entregue nesta chamada. Os
 * comandos so saem de pendingCommands quando o Bot Pago confirma via
 * ackCommand - assim nenhum comando se perde se a resposta HTTP falhar no
 * meio do caminho.
 */
async function drainDeliverableCommands(paidBotsStore, installationId, bot) {
  const pending = bot.pendingCommands || [];
  const deliverable = pending.filter((c) => c.status === "pending" || c.status === "delivered");
  if (deliverable.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const nextPending = pending.map((c) =>
    c.status === "pending" ? { ...c, status: "delivered", deliveredAt: now } : c
  );
  await paidBotsStore.upsert(installationId, { pendingCommands: nextPending });
  return deliverable;
}

async function heartbeat(
  paidBotsStore,
  installationId,
  token,
  { guilds, status, error, version, botName } = {}
) {
  const normalizedId = normalizeId(installationId, 80);
  await verifyInstallationToken(paidBotsStore, normalizedId, token);

  const patch = {
    lastSeenAt: new Date().toISOString(),
    lastError: error ? String(error).slice(0, 300) : null
  };

  const normalizedGuilds = normalizeGuilds(guilds);
  if (normalizedGuilds) {
    patch.guilds = normalizedGuilds;
    patch.guildCount = normalizedGuilds.length;
  }
  if (normalizeMetadata(status, 40)) patch.status = normalizeMetadata(status, 40);
  if (normalizeMetadata(version, 100)) patch.version = normalizeMetadata(version, 100);
  if (normalizeMetadata(botName, 100)) patch.botName = normalizeMetadata(botName, 100);

  const updated = await paidBotsStore.upsert(normalizedId, patch);
  const deliveredCommands = await drainDeliverableCommands(paidBotsStore, normalizedId, updated);

  return { ...updated, deliveredCommands };
}

/**
 * Combina as 3 flags independentes da instalacao (authorized/enabled/
 * blocked) no formato final devolvido ao Bot Pago. NUNCA assumir que
 * enabled=false implica blocked=true ou vice-versa - sao estados
 * ortogonais:
 *
 *   Funcionando:    authorized=true,  enabled=true,  blocked=false
 *   Desativado:     authorized=true,  enabled=false, blocked=false
 *   Bloqueado:      authorized=false, enabled=true,  blocked=true
 *   Nao autorizado: authorized=false, enabled=false, blocked=false
 *
 * blocked=true sempre "veta" a authorized final, mesmo que a flag crua
 * authorized da instalacao seja true - por isso o resultado exposto e
 * bot.authorized && !bot.blocked, e nao bot.authorized sozinho.
 */
function computeAuthorization(bot) {
  const rawAuthorized = Boolean(bot?.authorized);
  const blocked = Boolean(bot?.blocked);
  return {
    authorized: rawAuthorized && !blocked,
    enabled: Boolean(bot?.enabled),
    blocked
  };
}

async function getAuthorization(paidBotsStore, installationId, token) {
  const bot = await verifyInstallationToken(paidBotsStore, installationId, token);
  return computeAuthorization(bot);
}

async function listPendingCommands(paidBotsStore, installationId, token) {
  const normalizedId = normalizeId(installationId, 80);
  const bot = await verifyInstallationToken(paidBotsStore, normalizedId, token);
  return drainDeliverableCommands(paidBotsStore, normalizedId, bot);
}

async function ackCommand(paidBotsStore, installationId, token, commandId, { status, result } = {}) {
  const normalizedId = normalizeId(installationId, 80);
  const bot = await verifyInstallationToken(paidBotsStore, normalizedId, token);

  const pending = bot.pendingCommands || [];
  const command = pending.find((c) => c.id === commandId);
  if (!command) {
    throw new AppError("Comando nao encontrado.", { statusCode: 404, code: "COMMAND_NOT_FOUND" });
  }

  const remaining = pending.filter((c) => c.id !== commandId);
  const historyEntry = {
    ...command,
    status: normalizeMetadata(status, 40) || "done",
    result: result ?? null,
    acknowledgedAt: new Date().toISOString()
  };
  const commandHistory = [historyEntry, ...(bot.commandHistory || [])].slice(0, 50);

  await paidBotsStore.upsert(normalizedId, { pendingCommands: remaining, commandHistory });
  return { ok: true };
}

async function queueCommand(paidBotsStore, installationId, { type, payload } = {}) {
  const normalizedId = normalizeId(installationId, 80);
  const bot = await paidBotsStore.get(normalizedId);
  if (!bot) {
    throw new AppError("Instalacao nao encontrada.", { statusCode: 404, code: "PAIDBOT_NOT_FOUND" });
  }

  const command = {
    id: generateCommandId(),
    type: normalizeMetadata(type, 60) || "unknown",
    payload: payload ?? null,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  const pendingCommands = [...(bot.pendingCommands || []), command];
  await paidBotsStore.upsert(normalizedId, { pendingCommands });
  return command;
}

async function listPaidBots(paidBotsStore) {
  const bots = await paidBotsStore.getAll();
  return Object.values(bots).sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
}

async function getPaidBot(paidBotsStore, installationId) {
  return paidBotsStore.get(normalizeId(installationId, 80));
}

async function setPaidBotEnabled(paidBotsStore, installationId, enabled) {
  return paidBotsStore.upsert(normalizeId(installationId, 80), { enabled: Boolean(enabled) });
}

async function setPaidBotBlocked(paidBotsStore, installationId, blocked) {
  return paidBotsStore.upsert(normalizeId(installationId, 80), { blocked: Boolean(blocked) });
}

async function setPaidBotAuthorized(paidBotsStore, installationId, authorized) {
  return paidBotsStore.upsert(normalizeId(installationId, 80), { authorized: Boolean(authorized) });
}

module.exports = {
  ackCommand,
  computeAuthorization,
  generateInstallationId,
  generateToken,
  getAuthorization,
  getPaidBot,
  hashToken,
  heartbeat,
  listPaidBots,
  listPendingCommands,
  normalizeId,
  queueCommand,
  registerInstallation,
  setPaidBotAuthorized,
  setPaidBotEnabled,
  setPaidBotBlocked,
  verifyInstallationToken
};
