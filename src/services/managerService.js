const { AppError } = require("../utils/errors");
const { createProvider } = require("./providerFactory");

async function getConfiguredProvider(settingsStore, logger) {
  const settings = await settingsStore.get();
  const provider = createProvider(settings, logger);

  return {
    settings,
    provider
  };
}

function resolveTargetAppId(settings, explicitAppId) {
  const appId = explicitAppId ? String(explicitAppId).trim() : "";
  if (appId) {
    return appId;
  }

  if (settings.defaultAppId) {
    return settings.defaultAppId;
  }

  throw new AppError("Nenhum app_id informado e nenhum app padrao foi configurado.", {
    statusCode: 400,
    code: "APP_ID_REQUIRED"
  });
}

module.exports = {
  getConfiguredProvider,
  resolveTargetAppId
};
