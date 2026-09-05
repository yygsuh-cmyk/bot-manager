const express = require("express");
const { createLicenseRoutes } = require("./routes/licenseRoutes");
const { createFreeBotRoutes } = require("./routes/freeBotRoutes");

/**
 * server.js
 *
 * Cria e inicializa o servidor HTTP Express do bot manager.
 * Roda em paralelo com o cliente Discord — sem bloquear o bootstrap.
 *
 * Uso:
 *   const { startApiServer } = require('./api/server');
 *   await startApiServer({ licenseStore, freeBotsStore, config, logger });
 */
async function startApiServer({ licenseStore, freeBotsStore, config, logger }) {
  const app = express();

  // ── Middlewares globais ───────────────────────────────────────────────────
  app.use(express.json());

  // Remove o header "X-Powered-By: Express" por segurança
  app.disable("x-powered-by");

  // ── Health check (sem autenticação) ──────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ── Rotas de licença ──────────────────────────────────────────────────────
  const licenseRoutes = createLicenseRoutes({
    licenseStore,
    apiKey: config.apiKey,
    logger
  });
  app.use("/license", licenseRoutes);

  // ── Rotas dos Bots Free (estrutura preparatoria - itens 9, 10, 11) ────────
  const freeBotRoutes = createFreeBotRoutes({
    freeBotsStore,
    freeBotRegistrationKey: config.freeBotRegistrationKey,
    logger
  });
  app.use("/freebot", freeBotRoutes);

  // ── 404 fallback ─────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found", message: "Endpoint not found." });
  });

  // ── Error handler global ─────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error("[LicenseAPI] Erro não tratado no Express.", { message: err?.message });
    res.status(500).json({ error: "Internal Server Error" });
  });

  // ── Inicializa o servidor ─────────────────────────────────────────────────
  const port = config.apiPort;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info(`[LicenseAPI] Servidor HTTP iniciado na porta ${port}.`, {
        port,
        endpoints: [
          "GET /health",
          "GET /license/check/:guildId",
          "POST /license/activate",
          "POST /freebot/register",
          "POST /freebot/heartbeat",
          "GET /freebot/authorization"
        ]
      });
      resolve(server);
    });

    server.on("error", (err) => {
      logger.error("[LicenseAPI] Falha ao iniciar servidor HTTP.", { message: err?.message });
      reject(err);
    });
  });
}

module.exports = { startApiServer };
