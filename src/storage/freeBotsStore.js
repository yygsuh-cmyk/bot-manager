const { JsonStore } = require("./jsonStore");

/**
 * Store dos Bots Free (itens 9, 10 e 11).
 * Estrutura preparatoria: os bots Free ainda nao estao conectados, mas o
 * formato de dados e os metodos abaixo ja sao os que o Manager vai usar
 * quando eles passarem a se registrar via POST /freebot/register.
 */
function createFreeBotsStore(filePath) {
  const store = new JsonStore(filePath, { bots: {} });

  async function getAll() {
    const data = await store.read();
    return data.bots;
  }

  async function get(botId) {
    const bots = await getAll();
    return bots[botId] || null;
  }

  async function upsert(botId, patch) {
    let result = null;
    await store.update((data) => {
      const current = data.bots[botId] || null;
      const { active: patchedActive, enabled: patchedEnabled, ...metadataPatch } = patch || {};
      const active = typeof patchedActive === "boolean"
        ? patchedActive
        : typeof patchedEnabled === "boolean"
          ? patchedEnabled
          : current?.active ?? current?.enabled ?? true;

      result = {
        botId,
        name: current?.name || botId,
        product: current?.product || null,
        version: current?.version || null,
        type: "free",
        tokenHash: current?.tokenHash || null,
        active,
        enabled: active,
        blocked: current?.blocked ?? false,
        guilds: current?.guilds || [],
        status: current?.status || "offline",
        lastSeenAt: current?.lastSeenAt || null,
        lastError: current?.lastError || null,
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...metadataPatch,
        botId,
        type: "free",
        active,
        enabled: active
      };
      data.bots[botId] = result;
      return data;
    });
    return result;
  }

  async function remove(botId) {
    await store.update((data) => {
      delete data.bots[botId];
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
  createFreeBotsStore
};
