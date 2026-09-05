const { JsonStore } = require("./jsonStore");

const DEFAULT_APPS = {
  tracked: []
};

class AppsStore {
  constructor(filePath) {
    this.store = new JsonStore(filePath, DEFAULT_APPS);
  }

  async init() {
    await this.store.ensureFile();
  }

  async getAll(provider = null) {
    const state = await this.store.read();
    const list = Array.isArray(state.tracked) ? state.tracked : [];

    return list
      .filter((entry) => (provider ? entry.provider === provider : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(appId, provider = null) {
    const id = String(appId ?? "").trim();
    if (!id) {
      return null;
    }

    const list = await this.getAll(provider);
    return list.find((entry) => entry.id === id) ?? null;
  }

  async syncFromProvider(provider, apps) {
    const syncDate = new Date().toISOString();
    const normalized = apps.map((app) => ({
      id: String(app.id),
      name: app.name ? String(app.name) : String(app.id),
      provider,
      lastKnownStatus: app.online === true ? "online" : app.online === false ? "offline" : "unknown",
      lastSyncAt: syncDate
    }));

    return this.store.update((current) => {
      const tracked = Array.isArray(current.tracked) ? current.tracked : [];
      const keep = tracked.filter((entry) => entry.provider !== provider);
      return {
        tracked: [...keep, ...normalized]
      };
    });
  }
}

module.exports = {
  AppsStore
};
