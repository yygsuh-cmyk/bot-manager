const { JsonStore } = require("./jsonStore");

/**
 * Store das instalacoes do Bot Pago (integracao real Bot Pago <-> Manager).
 *
 * Segue exatamente o mesmo padrao ja usado por freeBotsStore.js (JsonStore,
 * escrita atomica, upsert por chave). A chave aqui e o installationId - o
 * identificador proprio de CADA instalacao do Bot Pago (um botId pode, em
 * tese, ter mais de uma instalacao rodando; o installationId e o que
 * distingue cada uma).
 *
 * Nunca guarda o token do Discord - apenas o hash da credencial propria
 * emitida pelo Manager no registro (tokenHash).
 *
 * Estado da instalacao - TRES flags independentes (nao derivar uma da
 * outra):
 *   - authorized: instalacao aprovada pelo Manager para existir/operar.
 *     Default true no primeiro registro (auto-aprovada), mas pode ser
 *     revogada manualmente (ex: instalacao pirata/nao reconhecida).
 *   - enabled: liga/desliga "normal" definido pelo operador do Manager.
 *     enabled=false NAO significa nao-autorizado; e soft (dados/serie de
 *     licenca preservados, so a UTILIZACAO fica bloqueada).
 *   - blocked: bloqueio forte. Quando true, a instalacao deve ser tratada
 *     como nao autorizada, independente do valor de authorized.
 *
 * paidBotService.computeAuthorization() e quem combina essas 3 flags no
 * formato final { authorized, enabled, blocked } devolvido ao Bot Pago.
 */
function createPaidBotsStore(filePath) {
  const store = new JsonStore(filePath, { bots: {} });

  async function getAll() {
    const data = await store.read();
    return data.bots;
  }

  async function get(installationId) {
    const bots = await getAll();
    return bots[installationId] || null;
  }

  async function upsert(installationId, patch) {
    let result = null;
    await store.update((data) => {
      const current = data.bots[installationId] || null;
      const merged = {
        installationId,
        botId: current?.botId || null,
        botName: current?.botName || installationId,
        type: "paid",
        version: current?.version || null,
        tokenHash: current?.tokenHash || null,
        authorized: current?.authorized ?? true,
        enabled: current?.enabled ?? true,
        blocked: current?.blocked ?? false,
        guilds: current?.guilds || [],
        guildCount: current?.guildCount ?? (current?.guilds ? current.guilds.length : 0),
        status: current?.status || "offline",
        lastSeenAt: current?.lastSeenAt || null,
        lastError: current?.lastError || null,
        pendingCommands: current?.pendingCommands || [],
        commandHistory: current?.commandHistory || [],
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...patch,
        installationId,
        type: "paid"
      };
      result = merged;
      data.bots[installationId] = merged;
      return data;
    });
    return result;
  }

  async function remove(installationId) {
    await store.update((data) => {
      delete data.bots[installationId];
      return data;
    });
  }

  return {
    getAll,
    get,
    upsert,
    remove
  };
}

module.exports = {
  createPaidBotsStore
};
