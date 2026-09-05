const { BaseProvider } = require("./baseProvider");
const { AppError } = require("../../utils/errors");

class DiscloudProvider extends BaseProvider {
  constructor(options) {
    super({
      providerKey: "discloud",
      baseURL: "https://api.discloud.app/v2",
      authHeaderName: "api-token",
      apiToken: options.apiToken,
      logger: options.logger
    });
  }

  async validateToken() {
    const payload = await this.get("/user");
    if (payload.status !== "ok") {
      throw new AppError("Token da Discloud invalido.", {
        statusCode: 401,
        code: "DISCLOUD_TOKEN_INVALID",
        details: payload
      });
    }

    const user = payload.user ?? {};
    return {
      provider: "discloud",
      userId: user.userID ?? null,
      username: user.userID ?? "Desconhecido",
      plan: user.plan ?? "Desconhecido",
      memoryLimitMb: user.totalRamMb ?? null,
      memoryAvailableMb:
        typeof user.totalRamMb === "number" && typeof user.ramUsedMb === "number"
          ? user.totalRamMb - user.ramUsedMb
          : null
    };
  }

  async listApps() {
    const [infoPayload, statusPayload] = await Promise.all([
      this.get("/app/all"),
      this.get("/app/all/status").catch(() => ({ apps: [] }))
    ]);

    const infoApps = normalizeApps(infoPayload?.apps);
    const statusApps = normalizeApps(statusPayload?.apps);
    const statusMap = new Map(statusApps.map((entry) => [String(entry.id), entry]));

    return infoApps.map((app) => {
      const id = String(app.id);
      const status = statusMap.get(id) ?? {};

      return {
        id,
        name: app.name ?? id,
        description: "",
        ramMb: typeof app.ram === "number" ? app.ram : null,
        language: app.lang ?? "",
        domain: app.subdomain ? `${app.subdomain}.discloud.app` : null,
        online: resolveOnlineState(app, status),
        cpu: status.cpu ?? "n/d",
        ramUsage: status.memory ?? app.ramKilled ?? "n/d"
      };
    });
  }

  async getAppStatus(appId) {
    const [infoPayload, statusPayload] = await Promise.all([
      this.get(`/app/${appId}`),
      this.get(`/app/${appId}/status`).catch(() => ({ apps: {} }))
    ]);

    const info = normalizeApps(infoPayload?.apps)[0] ?? {};
    const status = normalizeApps(statusPayload?.apps)[0] ?? {};
    const online = resolveOnlineState(info, status);

    return {
      id: String(info.id ?? status.id ?? appId),
      online,
      cpu: normalizeMetric(status.cpu, "n/d"),
      ramUsage: normalizeMetric(status.memory ?? status.ram ?? info.ramKilled, "n/d"),
      uptime: status.startedAt ?? status.uptime ?? null,
      lastRestart: status.last_restart ?? null,
      exitCode: info.exitCode ?? status.exitCode ?? null,
      container: status.container ?? null
    };
  }

  async startApp(appId) {
    try {
      const payload = await this.put(`/app/${appId}/start`, {});
      return {
        ok: payload.status === "ok",
        message: payload.message ?? "Aplicacao iniciada com sucesso."
      };
    } catch (error) {
      if (isAlreadyStateError(error, "on")) {
        return {
          ok: true,
          message: "Aplicacao ja estava online."
        };
      }
      throw error;
    }
  }

  async stopApp(appId) {
    try {
      const payload = await this.put(`/app/${appId}/stop`, {});
      return {
        ok: payload.status === "ok",
        message: payload.message ?? "Aplicacao parada com sucesso."
      };
    } catch (error) {
      if (isAlreadyStateError(error, "off")) {
        return {
          ok: true,
          message: "Aplicacao ja estava offline."
        };
      }
      throw error;
    }
  }

  async restartApp(appId) {
    try {
      const payload = await this.put(`/app/${appId}/restart`, {});
      return {
        ok: payload.status === "ok",
        message: payload.message ?? "Aplicacao reiniciada com sucesso."
      };
    } catch (error) {
      if (isAlreadyStateError(error, "off")) {
        return {
          ok: false,
          message: "Aplicacao esta offline. Ligue a aplicacao antes de reiniciar."
        };
      }
      throw error;
    }
  }

  async getAppLogs(appId) {
    const payload = await this.get(`/app/${appId}/logs`);
    const candidates = [
      payload?.logs?.full,
      payload?.logs?.terminal,
      payload?.logs?.small,
      payload?.apps?.terminal?.big,
      payload?.apps?.terminal?.small,
      payload?.apps?.logs?.big,
      payload?.apps?.logs?.small
    ];

    for (const value of candidates) {
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    const fallbackBody = {
      status: payload?.status ?? "unknown",
      message: payload?.message ?? "Sem detalhes de log retornados pela API.",
      appId
    };

    return `Nenhum log textual disponivel no momento.\n${JSON.stringify(fallbackBody, null, 2)}`;
  }

  async createBackup(appId) {
    const payload = await this.get(`/app/${appId}/backup`);
    return {
      ok: payload.status === "ok",
      details: payload.backups ?? payload
    };
  }

  async uploadAppArchive(fileBuffer, fileName = "upload.zip") {
    const payload = await this.rawMultipart({
      method: "POST",
      url: "/upload",
      fileBuffer,
      fileName,
      fileContentType: "application/zip"
    });

    return {
      ok: payload.status === "ok",
      message: payload.message ?? "Aplicacao enviada com sucesso.",
      details: payload
    };
  }

  async commitAppArchive(appId, fileBuffer, fileName = "commit.zip") {
    const payload = await this.rawMultipart({
      method: "PUT",
      url: `/app/${appId}/commit`,
      fileBuffer,
      fileName,
      fileContentType: "application/zip"
    });

    return {
      ok: payload.status === "ok",
      message: payload.message ?? "Commit enviado com sucesso.",
      details: payload
    };
  }

  async deleteApp(appId) {
    const payload = await this.delete(`/app/${appId}/delete`);
    return {
      ok: payload.status === "ok",
      message: payload.message ?? "Aplicacao removida com sucesso.",
      details: payload
    };
  }
}

module.exports = {
  DiscloudProvider
};

function normalizeApps(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return [value];
  }
  return [];
}

function resolveOnlineState(info, status) {
  const container = String(status?.container ?? "").toLowerCase().trim();
  if (container === "online") {
    return true;
  }
  if (container === "offline") {
    return false;
  }

  if (typeof info?.online === "boolean") {
    return info.online;
  }

  if (typeof info?.online === "string") {
    const normalized = info.online.toLowerCase().trim();
    if (normalized === "true" || normalized === "online") {
      return true;
    }
    if (normalized === "false" || normalized === "offline") {
      return false;
    }
  }

  if (typeof info?.online === "number") {
    return info.online > 0;
  }

  return false;
}

function normalizeMetric(value, fallback) {
  if (value === null || typeof value === "undefined") {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "null" || normalized.toLowerCase() === "undefined") {
    return fallback;
  }

  return normalized;
}

function isAlreadyStateError(error, stateKeyword) {
  const details = JSON.stringify(error?.details ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  const statusCode = Number(error?.statusCode ?? 0);
  const keyword = stateKeyword.toLowerCase();

  return statusCode === 409 && (details.includes(`already ${keyword}`) || message.includes(`already ${keyword}`));
}
