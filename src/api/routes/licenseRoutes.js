const { Router } = require("express");
const { isGuildLicensed, activateLicense } = require("../../services/licenseService");

/**
 * licenseRoutes.js
 *
 * Rotas HTTP para validação de licenças.
 * Montadas em /license pelo server.js.
 *
 * Endpoint disponível:
 *   GET /license/check/:guildId
 *
 * Headers obrigatórios:
 *   Authorization: Bearer <API_KEY>
 */
function createLicenseRoutes({ licenseStore, apiKey, logger }) {
  const router = Router();

  // ── Middleware de autenticação ────────────────────────────────────────────
  router.use((req, res, next) => {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!apiKey) {
      // Se API_KEY não estiver configurada, bloqueia todo acesso por segurança
      logger.warn("[LicenseAPI] Requisição bloqueada: API_KEY não configurada no servidor.", {
        ip: req.ip,
        path: req.path
      });
      return res.status(503).json({
        error: "Service unavailable",
        message: "API_KEY not configured on the server."
      });
    }

    if (!token || token !== apiKey) {
      logger.warn("[LicenseAPI] Requisição não autorizada.", {
        ip: req.ip,
        path: req.path,
        hasToken: Boolean(token)
      });
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or missing Authorization header. Use: Authorization: Bearer <API_KEY>"
      });
    }

    next();
  });

  // ── GET /license/check/:guildId ───────────────────────────────────────────
  /**
   * Verifica se um servidor (guild) possui licença ativa e válida.
   *
   * Resposta com licença ativa:
   *   { "licensed": true, "status": "active", "expiresAt": "...", "guildId": "...", "guildName": "..." }
   *
   * Resposta sem licença:
   *   { "licensed": false }
   */
  router.get("/check/:guildId", async (req, res) => {
    const { guildId } = req.params;

    if (!guildId || !/^\d+$/.test(guildId)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "guildId must be a valid Discord snowflake (numeric string)."
      });
    }

    try {
      const licenses = await licenseStore.getAll();
      const now = new Date();

      // Busca a licença ativa mais recente para a guild
      const activeLicense = Object.values(licenses).find(
        (lic) =>
          lic.status === "active" &&
          lic.guildId === String(guildId) &&
          lic.expiresAt &&
          new Date(lic.expiresAt) > now
      );

      if (!activeLicense) {
        return res.status(200).json({ licensed: false });
      }

      logger.info("[LicenseAPI] Consulta de licença bem-sucedida.", {
        guildId,
        key: activeLicense.key,
        expiresAt: activeLicense.expiresAt
      });

      return res.status(200).json({
        licensed: true,
        status: activeLicense.status,
        expiresAt: activeLicense.expiresAt,
        guildId: activeLicense.guildId,
        guildName: activeLicense.guildName
      });
    } catch (error) {
      logger.error("[LicenseAPI] Erro interno ao verificar licença.", {
        guildId,
        message: error?.message
      });
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to check license. Try again later."
      });
    }
  });

  // ── POST /license/activate ────────────────────────────────────────────────
  /**
   * Ativa uma licença remotamente via API.
   *
   * Body (JSON):
   *   { guild_id, guild_name, user_id, username, license_key }
   *
   * Resposta de sucesso:
   *   { "success": true, "message": "Licença ativada com sucesso" }
   *
   * Resposta de erro:
   *   { "success": false, "message": "<motivo>" }
   */
  router.post("/activate", async (req, res) => {
    const { guild_id, guild_name, user_id, username, license_key } = req.body ?? {};

    // ── Validação dos campos obrigatórios ───────────────────────────────────
    const missing = ["guild_id", "guild_name", "user_id", "username", "license_key"].filter(
      (field) => !req.body?.[field]
    );
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Campos obrigatórios ausentes: ${missing.join(", ")}`
      });
    }

    if (!/^\d+$/.test(String(guild_id))) {
      return res.status(400).json({
        success: false,
        message: "guild_id deve ser um snowflake Discord válido (somente números)."
      });
    }

    if (!/^\d+$/.test(String(user_id))) {
      return res.status(400).json({
        success: false,
        message: "user_id deve ser um snowflake Discord válido (somente números)."
      });
    }

    const key = String(license_key).trim().toUpperCase();

    // ── Tentativa de ativação ───────────────────────────────────────────────
    try {
      const license = await activateLicense(
        licenseStore,
        key,
        { id: String(guild_id), name: String(guild_name) },
        { id: String(user_id), username: String(username) }
      );

      logger.info("[LicenseAPI] Licença ativada via endpoint HTTP.", {
        key: license.key,
        guildId: license.guildId,
        guildName: license.guildName,
        userId: license.userId,
        expiresAt: license.expiresAt
      });

      return res.status(200).json({
        success: true,
        message: "Licença ativada com sucesso",
        expiresAt: license.expiresAt,
        durationDays: license.durationDays
      });
    } catch (error) {
      // Erros conhecidos do licenseService — mapear para mensagens legíveis
      const errorMessages = {
        KEY_NOT_FOUND: "Key inválida ou não encontrada.",
        KEY_ALREADY_USED: "Esta key já foi utilizada em outro servidor.",
        KEY_EXPIRED: "Esta key está expirada e não pode mais ser ativada."
      };

      const knownMessage = errorMessages[error.message];

      if (knownMessage) {
        logger.warn("[LicenseAPI] Falha na ativação via endpoint HTTP.", {
          key,
          reason: error.message,
          guildId: guild_id,
          userId: user_id
        });
        return res.status(200).json({ success: false, message: knownMessage });
      }

      // Erro inesperado
      logger.error("[LicenseAPI] Erro interno ao ativar licença via HTTP.", {
        key,
        message: error?.message
      });
      return res.status(500).json({
        success: false,
        message: "Erro interno ao ativar licença. Tente novamente."
      });
    }
  });

  return router;
}

module.exports = { createLicenseRoutes };
