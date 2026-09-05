const { JsonStore } = require("./jsonStore");

const SUPPORTED_PROVIDERS = ["squarecloud", "discloud"];

const DEFAULT_SETTINGS = {
  version: 2,
  guildId: "1459746824712618207",
  clientId: "1471269585918492742",
  provider: null,
  apiToken: "",
  defaultAppId: "",
  providerTokens: {
    squarecloud: "",
    discloud: ""
  },
  defaultAppByProvider: {
    squarecloud: "",
    discloud: ""
  },
  adminUserIds: [],
  updatedAt: null
};

class SettingsStore {
  constructor(filePath, envDefaults = {}) {
    this.store = new JsonStore(filePath, DEFAULT_SETTINGS);
    this.envDefaults = envDefaults;
  }

  async init() {
    await this.store.ensureFile();
    await this.bootstrapFromEnv();
  }

  async get() {
    return this.store.read();
  }

  async patch(partial) {
    return this.store.update((current) =>
      normalizeSettingsState({
        ...current,
        ...partial,
        updatedAt: new Date().toISOString()
      })
    );
  }

  async setProvider(provider) {
    return this.store.update((current) => {
      const next = normalizeSettingsState(current);
      next.provider = provider;
      next.apiToken = next.providerTokens[provider] || "";
      next.defaultAppId = next.defaultAppByProvider[provider] || "";
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  async setApiToken(apiToken) {
    return this.store.update((current) => {
      const next = normalizeSettingsState(current);
      next.apiToken = apiToken;
      if (next.provider && SUPPORTED_PROVIDERS.includes(next.provider)) {
        next.providerTokens[next.provider] = apiToken;
      }
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  async setProviderAndToken(provider, apiToken) {
    return this.store.update((current) => {
      const next = normalizeSettingsState(current);
      next.provider = provider;
      next.apiToken = apiToken;
      next.defaultAppId = next.defaultAppByProvider[provider] || "";
      if (SUPPORTED_PROVIDERS.includes(provider)) {
        next.providerTokens[provider] = apiToken;
      }
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  async setDefaultAppId(defaultAppId) {
    return this.store.update((current) => {
      const next = normalizeSettingsState(current);
      next.defaultAppId = defaultAppId;
      if (next.provider && SUPPORTED_PROVIDERS.includes(next.provider)) {
        next.defaultAppByProvider[next.provider] = defaultAppId;
      }
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  async bootstrapFromEnv() {
    const { discordGuildId, discordClientId, adminUserIds } = this.envDefaults;

    return this.store.update((current) => {
      const next = normalizeSettingsState(current);

      if (discordGuildId) {
        next.guildId = discordGuildId;
      }

      if (discordClientId) {
        next.clientId = discordClientId;
      }

      if (Array.isArray(adminUserIds) && adminUserIds.length > 0) {
        next.adminUserIds = Array.from(new Set([...next.adminUserIds, ...adminUserIds]));
      }

      if (!next.updatedAt) {
        next.updatedAt = new Date().toISOString();
      }

      return next;
    });
  }
}

function isHostConfigured(settings) {
  return Boolean(settings.provider && settings.apiToken);
}

module.exports = {
  SettingsStore,
  isHostConfigured
};

function normalizeSettingsState(state) {
  const next = {
    ...DEFAULT_SETTINGS,
    ...state
  };

  next.providerTokens = {
    ...DEFAULT_SETTINGS.providerTokens,
    ...(state?.providerTokens ?? {})
  };

  next.defaultAppByProvider = {
    ...DEFAULT_SETTINGS.defaultAppByProvider,
    ...(state?.defaultAppByProvider ?? {})
  };

  if (!Array.isArray(next.adminUserIds)) {
    next.adminUserIds = [];
  }

  next.adminUserIds = Array.from(new Set(next.adminUserIds.map((id) => String(id))));

  if (next.provider && SUPPORTED_PROVIDERS.includes(next.provider)) {
    if (next.apiToken && !next.providerTokens[next.provider]) {
      next.providerTokens[next.provider] = next.apiToken;
    }

    if (next.defaultAppId && !next.defaultAppByProvider[next.provider]) {
      next.defaultAppByProvider[next.provider] = next.defaultAppId;
    }

    next.apiToken = next.providerTokens[next.provider] || "";
    next.defaultAppId = next.defaultAppByProvider[next.provider] || "";
  } else {
    next.provider = null;
    next.apiToken = "";
    next.defaultAppId = "";
  }

  next.version = 2;
  return next;
}
