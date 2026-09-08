const { Router } = require("express");
const {
  ackCommand,
  computeAuthorization,
  getAuthorization,
  getPaidBot,
  heartbeat,
  listPaidBots,
  listPendingCommands,
  queueCommand,
  registerInstallation,
  setPaidBotAuthorized,
  setPaidBotEnabled,
  setPaidBotBlocked
} = require("../../services/paidBotService");

/**
 * paidBotRoutes.js
 *
 * Integracao REAL entre o Bot Pago (Python/Nextcord) e o Bot Manager.
 * Montadas em /paidbot pelo server.js. Segue o mesmo protocolo/desenho ja
 * usado em /freebot (freeBotRoutes.js) para nao duplicar arquitetura.
 *
 *   POST /paidbot/register           - registro/sincronizacao da instalacao (auth: PAID_BOT_REGISTRATION_KEY)
 *   POST /paidbot/heartbeat          - heartbeat periodico (auth: token da instalacao)
 *   GET  /paidbot/authorization      - consulta se a instalacao esta autorizada a operar (auth: token da instalacao)
 *   GET  /paidbot/commands           - consulta comandos pendentes enviados pelo Manager (auth: token da instalacao)
 *   POST /paidbot/commands/ack       - confirma execucao de um comando (auth: token da instalacao)
 *   GET  /paidbot/admin/list         - lista todas as instalacoes (auth: API_KEY)
 *   POST /paidbot/admin/:id/command  - enfileira um comando Manager -> Bot Pago (auth: API_KEY)
 *   POST /paidbot/admin/:id/enabled  - liga/desliga a instalacao (body: {enabled}) (auth: API_KEY)
 *   POST /paidbot/admin/:id/blocked  - bloqueia/desbloqueia a instalacao (body: {blocked}) (auth: API_KEY)
 *   POST /paidbot/admin/:id/authorized - autoriza/desautoriza a instalacao (body: {authorized}) (auth: API_KEY)
 *
 * Estado da instalacao (authorized/enabled/blocked sao flags INDEPENDENTES -
 * ver comentario em paidBotService.computeAuthorization para a tabela
 * completa dos 4 estados possiveis):
 *
 * Seguranca:
 *   - O registro exige uma chave compartilhada (PAID_BOT_REGISTRATION_KEY),
 *     igual ao fluxo do Bot Free.
 *   - O Manager NUNCA recebe o token do Discord do Bot Pago - apenas o hash
 *     do token proprio da instalacao, emitido no registro.
 *   - Chamadas depois do registro exigem o token da instalacao; o
 *     installationId sozinho nunca e suficiente.
 */
function createPaidBotRoutes({ paidBotsStore, paidBotRegistrationKey, apiKey, logger }) {
  const router = Router();

  function extractBearer(req) {
    const authHeader = req.headers["authorization"] ?? "";
    return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  }

  // ── POST /register ────────────────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    const key = extractBearer(req);

    if (!paidBotRegistrationKey) {
      logger.warn("[PaidBotAPI] Registro bloqueado: PAID_BOT_REGISTRATION_KEY nao configurada.");
      return res.status(503).json({
        error: "Service unavailable",
        message: "PAID_BOT_REGISTRATION_KEY not configured on the server."
      });
    }

    if (!key || key !== paidBotRegistrationKey) {
      logger.warn("[PaidBotAPI] Tentativa de registro nao autorizada.", { ip: req.ip });
      return res.status(401).json({ error: "Unauthorized", message: "Invalid or missing registration key." });
    }

    const { botId, botName, version, installationId } = req.body ?? {};
    if (!botId) {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'botId'." });
    }

    try {
      const { bot, token } = await registerInstallation(paidBotsStore, {
        botId,
        botName,
        version,
        installationId
      });
      logger.info("[PaidBotAPI] Instalacao de Bot Pago registrada.", {
        installationId: bot.installationId,
        botId: bot.botId,
        botName: bot.botName
      });
      const state = computeAuthorization(bot);
      return res.status(201).json({
        installationId: bot.installationId,
        botId: bot.botId,
        token,
        authorized: state.authorized,
        enabled: state.enabled,
        blocked: state.blocked,
        message: "Guarde este token com seguranca - ele nao sera mostrado novamente."
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Falha ao registrar instalacao.", { message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to register installation." });
    }
  });

  // ── POST /heartbeat ───────────────────────────────────────────────────────
  router.post("/heartbeat", async (req, res) => {
    const token = extractBearer(req);
    const { installationId, guilds, status, error: reportedError, version, botName } = req.body ?? {};

    if (!installationId || !token) {
      return res.status(400).json({
        error: "Bad Request",
        message: "installationId (body) e Authorization Bearer token sao obrigatorios."
      });
    }

    try {
      const updated = await heartbeat(paidBotsStore, installationId, token, {
        guilds,
        status,
        error: reportedError,
        version,
        botName
      });
      const state = computeAuthorization(updated);
      return res.status(200).json({
        ok: true,
        authorized: state.authorized,
        enabled: state.enabled,
        blocked: state.blocked,
        commands: updated.deliveredCommands || []
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Erro interno no heartbeat.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to process heartbeat." });
    }
  });

  // ── GET /authorization ────────────────────────────────────────────────────
  router.get("/authorization", async (req, res) => {
    const token = extractBearer(req);
    const installationId = req.query.installation_id;

    if (!installationId || !token) {
      return res.status(400).json({
        error: "Bad Request",
        message: "installation_id (query) e Authorization Bearer token sao obrigatorios."
      });
    }

    try {
      const result = await getAuthorization(paidBotsStore, installationId, token);
      return res.status(200).json(result);
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Erro interno na consulta de autorizacao.", {
        installationId,
        message: error?.message
      });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to check authorization." });
    }
  });

  // ── GET /commands ─────────────────────────────────────────────────────────
  router.get("/commands", async (req, res) => {
    const token = extractBearer(req);
    const installationId = req.query.installation_id;

    if (!installationId || !token) {
      return res.status(400).json({
        error: "Bad Request",
        message: "installation_id (query) e Authorization Bearer token sao obrigatorios."
      });
    }

    try {
      const commands = await listPendingCommands(paidBotsStore, installationId, token);
      return res.status(200).json({ commands });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Erro interno ao listar comandos.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list commands." });
    }
  });

  // ── POST /commands/ack ────────────────────────────────────────────────────
  router.post("/commands/ack", async (req, res) => {
    const token = extractBearer(req);
    const { installationId, commandId, status, result } = req.body ?? {};

    if (!installationId || !token || !commandId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "installationId, commandId (body) e Authorization Bearer token sao obrigatorios."
      });
    }

    try {
      await ackCommand(paidBotsStore, installationId, token, commandId, { status, result });
      return res.status(200).json({ ok: true });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Erro interno ao confirmar comando.", {
        installationId,
        commandId,
        message: error?.message
      });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to acknowledge command." });
    }
  });

  // ── Rotas administrativas (mesmo padrao de autenticacao de /license) ───────
  router.use("/admin", (req, res, next) => {
    const token = extractBearer(req);
    if (!apiKey) {
      logger.warn("[PaidBotAPI] Rota admin bloqueada: API_KEY nao configurada.");
      return res.status(503).json({ error: "Service unavailable", message: "API_KEY not configured on the server." });
    }
    if (!token || token !== apiKey) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or missing Authorization header. Use: Authorization: Bearer <API_KEY>"
      });
    }
    next();
  });

  // GET /paidbot/admin/list
  router.get("/admin/list", async (_req, res) => {
    try {
      const bots = await listPaidBots(paidBotsStore);
      return res.status(200).json({ bots });
    } catch (error) {
      logger.error("[PaidBotAPI] Erro interno ao listar instalacoes.", { message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list installations." });
    }
  });

  // POST /paidbot/admin/:installationId/command
  router.post("/admin/:installationId/command", async (req, res) => {
    const { installationId } = req.params;
    const { type, payload } = req.body ?? {};

    if (!type) {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'type'." });
    }

    try {
      const command = await queueCommand(paidBotsStore, installationId, { type, payload });
      logger.info("[PaidBotAPI] Comando enfileirado para instalacao.", {
        installationId,
        type: command.type,
        commandId: command.id
      });
      return res.status(201).json({ command });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[PaidBotAPI] Erro interno ao enfileirar comando.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to queue command." });
    }
  });

  // POST /paidbot/admin/:installationId/enabled  body: { enabled: boolean }
  router.post("/admin/:installationId/enabled", async (req, res) => {
    const { installationId } = req.params;
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'enabled' (boolean)." });
    }
    try {
      const bot = await getPaidBot(paidBotsStore, installationId);
      if (!bot) {
        return res.status(404).json({ error: "Not Found", message: "Instalacao nao encontrada." });
      }
      const updated = await setPaidBotEnabled(paidBotsStore, installationId, enabled);
      logger.info("[PaidBotAPI] Estado 'enabled' alterado.", { installationId, enabled });
      return res.status(200).json({ installationId, ...computeAuthorization(updated) });
    } catch (error) {
      logger.error("[PaidBotAPI] Erro interno ao alterar 'enabled'.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update enabled state." });
    }
  });

  // POST /paidbot/admin/:installationId/blocked  body: { blocked: boolean }
  router.post("/admin/:installationId/blocked", async (req, res) => {
    const { installationId } = req.params;
    const { blocked } = req.body ?? {};
    if (typeof blocked !== "boolean") {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'blocked' (boolean)." });
    }
    try {
      const bot = await getPaidBot(paidBotsStore, installationId);
      if (!bot) {
        return res.status(404).json({ error: "Not Found", message: "Instalacao nao encontrada." });
      }
      const updated = await setPaidBotBlocked(paidBotsStore, installationId, blocked);
      logger.info("[PaidBotAPI] Estado 'blocked' alterado.", { installationId, blocked });
      return res.status(200).json({ installationId, ...computeAuthorization(updated) });
    } catch (error) {
      logger.error("[PaidBotAPI] Erro interno ao alterar 'blocked'.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update blocked state." });
    }
  });

  // POST /paidbot/admin/:installationId/authorized  body: { authorized: boolean }
  router.post("/admin/:installationId/authorized", async (req, res) => {
    const { installationId } = req.params;
    const { authorized } = req.body ?? {};
    if (typeof authorized !== "boolean") {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'authorized' (boolean)." });
    }
    try {
      const bot = await getPaidBot(paidBotsStore, installationId);
      if (!bot) {
        return res.status(404).json({ error: "Not Found", message: "Instalacao nao encontrada." });
      }
      const updated = await setPaidBotAuthorized(paidBotsStore, installationId, authorized);
      logger.info("[PaidBotAPI] Estado 'authorized' alterado.", { installationId, authorized });
      return res.status(200).json({ installationId, ...computeAuthorization(updated) });
    } catch (error) {
      logger.error("[PaidBotAPI] Erro interno ao alterar 'authorized'.", { installationId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update authorized state." });
    }
  });

  return router;
}

module.exports = { createPaidBotRoutes };
