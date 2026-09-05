const { Router } = require("express");
const {
  getAuthorization,
  heartbeat,
  registerBot
} = require("../../services/freeBotService");

/**
 * freeBotRoutes.js
 *
 * Protocolo HTTP preparatorio para os futuros Bots Free (itens 9, 10, 11).
 * Nenhum Bot Free esta conectado ainda - estas rotas existem para que,
 * quando o Bot Free for adaptado, ele consiga se integrar usando EXATAMENTE
 * esta estrutura, sem precisar reprojetar nada no Manager.
 *
 * Montadas em /freebot pelo server.js.
 *
 *   POST /freebot/register     - registro inicial (auth: FREE_BOT_REGISTRATION_KEY)
 *   POST /freebot/heartbeat    - relata status/servidores (auth: token da instancia)
 *   GET  /freebot/authorization - consulta se esta autorizado a operar (auth: token da instancia)
 *
 * Seguranca (item 12):
 *   - Registro exige uma chave compartilhada (FREE_BOT_REGISTRATION_KEY), evitando
 *     que qualquer pessoa registre bots falsos.
 *   - Apos o registro, cada instancia recebe um token proprio; o Manager guarda
 *     apenas o hash desse token. Chamadas seguintes (heartbeat/authorization)
 *     precisam do token - o botId sozinho nunca e suficiente.
 *   - Nenhum token e devolvido em heartbeat/authorization (so no registro).
 */
function createFreeBotRoutes({ freeBotsStore, freeBotRegistrationKey, logger }) {
  const router = Router();

  router.post("/register", async (req, res) => {
    const authHeader = req.headers["authorization"] ?? "";
    const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!freeBotRegistrationKey) {
      logger.warn("[FreeBotAPI] Registro bloqueado: FREE_BOT_REGISTRATION_KEY nao configurada.");
      return res.status(503).json({ error: "Service unavailable", message: "FREE_BOT_REGISTRATION_KEY not configured on the server." });
    }

    if (!key || key !== freeBotRegistrationKey) {
      logger.warn("[FreeBotAPI] Tentativa de registro nao autorizada.", { ip: req.ip });
      return res.status(401).json({ error: "Unauthorized", message: "Invalid or missing registration key." });
    }

    const { bot_id: botId, name, product, version } = req.body ?? {};
    if (!name && !botId) {
      return res.status(400).json({ error: "Bad Request", message: "Informe 'name' ou 'bot_id'." });
    }

    try {
      const { bot, token } = await registerBot(freeBotsStore, { botId, name, product, version });
      logger.info("[FreeBotAPI] Novo Bot Free registrado.", { botId: bot.botId, name: bot.name });
      return res.status(201).json({
        botId: bot.botId,
        token,
        message: "Guarde este token com seguranca - ele nao sera mostrado novamente."
      });
    } catch (error) {
      logger.error("[FreeBotAPI] Falha ao registrar Bot Free.", { message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to register bot." });
    }
  });

  router.post("/heartbeat", async (req, res) => {
    const { bot_id, token, guilds, status, error: reportedError, name, version } = req.body ?? {};
    if (!bot_id || !token) {
      return res.status(400).json({ error: "Bad Request", message: "bot_id e token sao obrigatorios." });
    }

    try {
      const updated = await heartbeat(freeBotsStore, bot_id, token, {
        guilds,
        status,
        error: reportedError,
        name,
        version
      });
      return res.status(200).json({
        ok: true,
        authorized: updated.active && !updated.blocked,
        active: updated.active,
        enabled: updated.enabled,
        blocked: updated.blocked
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[FreeBotAPI] Erro interno no heartbeat.", { botId: bot_id, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to process heartbeat." });
    }
  });

  router.get("/authorization", async (req, res) => {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const botId = req.query.bot_id;

    if (!botId || !token) {
      return res.status(400).json({ error: "Bad Request", message: "bot_id (query) e Authorization Bearer token sao obrigatorios." });
    }

    try {
      const result = await getAuthorization(freeBotsStore, botId, token);
      return res.status(200).json(result);
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      logger.error("[FreeBotAPI] Erro interno na consulta de autorizacao.", { botId, message: error?.message });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to check authorization." });
    }
  });

  return router;
}

module.exports = { createFreeBotRoutes };
