const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

function parseUserIds(rawIds) {
  if (!rawIds) {
    return [];
  }

  return rawIds
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// ── Diretorio de dados persistentes ──────────────────────────────────────────
// IMPORTANTE (item 14 - persistencia de licencas): em plataformas como o
// Render, o filesystem local do container e EFEMERO a cada novo deploy,
// restart ou crash, a menos que um Persistent Disk seja anexado. Configure a
// variavel de ambiente DATA_DIR apontando para o mount path do disco
// persistente (ex: DATA_DIR=/var/data) para que licencas, apps, settings e
// bots free sobrevivam a reinicios/deploys. Sem essa variavel, o comportamento
// padrao (pasta local "data") e mantido para compatibilidade.
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");

const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  adminUserIds: parseUserIds(process.env.ADMIN_USER_IDS ?? ""),
  logLevel: process.env.LOG_LEVEL ?? "info",
  assetsDir: path.resolve(process.cwd(), process.env.ASSETS_DIR ?? path.join("assets", "emojis")),
  syncApplicationEmojisOnStart:
    String(process.env.SYNC_APP_EMOJIS_ON_START ?? "true").toLowerCase() === "true",
  dataDir,
  settingsPath: path.join(dataDir, "settings.json"),
  panelPath: path.join(dataDir, "panel.json"),
  errorLogPath: path.join(dataDir, "error.log"),
  appsPath: path.join(dataDir, "apps.json"),
  // ── Sistema de licenças ──────────────────────────────────────────────────────
  licensesPath: path.join(dataDir, "licenses.json"),
  licenseLogChannelId: process.env.LICENSE_LOG_CHANNEL_ID ?? "",
  // ── API HTTP de licenças ─────────────────────────────────────────────────────
  apiPort: Number(process.env.PORT ?? 3000),
  apiKey: process.env.API_KEY ?? "",
  // ── Bots Free (arquitetura preparatoria - itens 9, 10 e 11) ──────────────────
  freeBotsPath: path.join(dataDir, "freebots.json"),
  // Chave usada pelo FUTURO Bot Free para se registrar no Manager pela primeira
  // vez (POST /freebot/register). Depois do registro, o Manager emite um token
  // proprio por instancia, que passa a ser usado nas chamadas seguintes.
  freeBotRegistrationKey: process.env.FREE_BOT_REGISTRATION_KEY ?? "",
  // Intervalo (ms) em que os embeds de "Bots Free" abertos no Discord (lista e
  // detalhe) sao atualizados sozinhos - reflete heartbeat, registro, guilds e
  // a transicao para offline sem precisar de clique. Padrao: 20s.
  freeBotPanelRefreshIntervalMs: Number(process.env.FREEBOT_PANEL_REFRESH_INTERVAL_MS ?? 20000),
  // ── Bot Pago (integracao real Bot Pago <-> Manager) ───────────────────────────
  paidBotsPath: path.join(dataDir, "paidbots.json"),
  // Chave usada pelo Bot Pago para se registrar no Manager pela primeira vez
  // (POST /paidbot/register). Depois do registro, o Manager emite um token
  // proprio por instalacao, usado nas chamadas seguintes (heartbeat, etc).
  // NUNCA e o token do Discord do Bot Pago - e um segredo proprio da integracao.
  paidBotRegistrationKey: process.env.PAID_BOT_REGISTRATION_KEY ?? ""
};

function validateRuntimeConfig() {
  if (!config.discordToken) {
    throw new Error("Variavel DISCORD_TOKEN nao configurada no .env.");
  }
}

module.exports = {
  config,
  validateRuntimeConfig
};
