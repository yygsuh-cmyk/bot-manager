const { createProvider } = require("./providerFactory");

async function getPanelRuntimeState(settings, logger) {
  const hostConfigured = Boolean(settings.provider && settings.apiToken);
  const appReady = hostConfigured && Boolean(settings.defaultAppId);

  if (!appReady) {
    return {
      available: false,
      appOnline: null,
      statusMode: "setup",
      statusText: "Host/app padrao ainda nao configurado."
    };
  }

  try {
    const provider = createProvider(settings, logger);
    const status = await provider.getAppStatus(settings.defaultAppId);
    const online = Boolean(status.online);
    const cpu = normalizeMetricForDisplay(status.cpu);
    const ram = normalizeMetricForDisplay(status.ramUsage);
    const offlineHints = [];

    if (!online && status.exitCode !== null && typeof status.exitCode !== "undefined") {
      offlineHints.push(`exit ${status.exitCode}`);
    }

    if (!online && status.lastRestart && String(status.lastRestart).toLowerCase() !== "offline") {
      offlineHints.push(`last restart ${status.lastRestart}`);
    }

    const hintText = offlineHints.length > 0 ? ` | ${offlineHints.join(" | ")}` : "";

    return {
      available: true,
      appOnline: online,
      statusMode: online ? "online" : "offline",
      statusText: `App ${status.id}: ${online ? "online" : "offline"} | CPU ${cpu} | RAM ${ram}${hintText}`
    };
  } catch (error) {
    return {
      available: false,
      appOnline: null,
      statusMode: "unknown",
      statusText: "Nao foi possivel consultar o status em tempo real no momento."
    };
  }
}

module.exports = {
  getPanelRuntimeState
};

function normalizeMetricForDisplay(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "n/d";
  }

  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "null" || normalized.toLowerCase() === "undefined") {
    return "n/d";
  }

  return normalized;
}
