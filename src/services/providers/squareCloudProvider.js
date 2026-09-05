const { BaseProvider } = require("./baseProvider");
const { AppError } = require("../../utils/errors");

class SquareCloudProvider extends BaseProvider {
  constructor(options) {
    super({
      providerKey: "squarecloud",
      baseURL: "https://api.squarecloud.app/v2",
      authHeaderName: "Authorization",
      apiToken: options.apiToken,
      logger: options.logger
    });
  }

  async validateToken() {
    const payload = await this.get("/users/me");
    if (payload.status !== "success") {
      throw new AppError("Token da SquareCloud invalido.", {
        statusCode: 401,
        code: "SQUARE_TOKEN_INVALID",
        details: payload
      });
    }

    const user = payload.response?.user ?? {};
    return {
      provider: "squarecloud",
      userId: user.id ?? null,
      username: user.name ?? "Desconhecido",
      plan: user.plan?.name ?? "Desconhecido",
      memoryLimitMb: user.plan?.memory?.limit ?? null,
      memoryAvailableMb: user.plan?.memory?.available ?? null
    };
  }

  async listApps() {
    const [accountPayload, statusPayload] = await Promise.all([
      this.get("/users/me"),
      this.get("/apps/status").catch(() => ({ response: [] }))
    ]);

    const apps = Array.isArray(accountPayload.response?.applications)
      ? accountPayload.response.applications
      : [];

    const appStatuses = Array.isArray(statusPayload.response)
      ? statusPayload.response
      : [];

    const statusMap = new Map(appStatuses.map((entry) => [entry.id, entry]));

    return apps.map((app) => {
      const appStatus = statusMap.get(app.id) ?? {};
      return {
        id: app.id,
        name: app.name ?? app.id,
        description: app.desc ?? "",
        ramMb: app.ram ?? null,
        language: app.lang ?? "",
        domain: app.domain ?? null,
        online: Boolean(appStatus.running),
        cpu: appStatus.cpu ?? "n/d",
        ramUsage: appStatus.ram ?? "n/d"
      };
    });
  }

  async getAppStatus(appId) {
    const payload = await this.get(`/apps/${appId}/status`);
    const status = payload.response ?? {};

    return {
      id: appId,
      online: Boolean(status.running),
      cpu: status.cpu ?? "n/d",
      ramUsage: status.ram ?? "n/d"
    };
  }

  async startApp(appId) {
    try {
      const payload = await this.post(`/apps/${appId}/start`, {});
      return {
        ok: payload.status === "success",
        message: "Aplicacao iniciada com sucesso."
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
      const payload = await this.post(`/apps/${appId}/stop`, {});
      return {
        ok: payload.status === "success",
        message: "Aplicacao parada com sucesso."
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
      const payload = await this.post(`/apps/${appId}/restart`, {});
      return {
        ok: payload.status === "success",
        message: "Aplicacao reiniciada com sucesso."
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
    const payload = await this.get(`/apps/${appId}/logs`);
    const logs = payload.response?.logs;
    if (typeof logs === "string" && logs.trim()) {
      return logs;
    }

    if (logs && typeof logs === "object") {
      const json = JSON.stringify(logs, null, 2);
      if (json && json !== "{}") {
        return json;
      }
    }

    return `Nenhum log textual disponivel no momento.\n${JSON.stringify({
      status: payload?.status ?? "unknown",
      appId
    }, null, 2)}`;
  }

  async createBackup(appId) {
    const payload = await this.post(`/apps/${appId}/snapshots`, {});
    return {
      ok: payload.status === "success",
      details: payload.response ?? payload
    };
  }

  async uploadAppArchive(fileBuffer, fileName = "upload.zip") {
    const payload = await this.rawMultipart({
      method: "POST",
      url: "/apps",
      fileBuffer,
      fileName,
      fileContentType: "application/zip"
    });

    return {
      ok: payload.status === "success",
      message: payload.response?.description ?? "Aplicacao enviada com sucesso.",
      details: payload
    };
  }

  async commitAppArchive(appId, fileBuffer, fileName = "commit.zip") {
    const payload = await this.rawMultipart({
      method: "POST",
      url: `/apps/${appId}/commit`,
      fileBuffer,
      fileName,
      fileContentType: "application/zip"
    });

    return {
      ok: payload.status === "success",
      message: payload.response?.description ?? "Commit enviado com sucesso.",
      details: payload
    };
  }

  async deleteApp(appId) {
    const payload = await this.delete(`/apps/${appId}`);
    return {
      ok: payload.status === "success",
      message: payload.response?.description ?? "Aplicacao removida com sucesso.",
      details: payload
    };
  }
}

module.exports = {
  SquareCloudProvider
};

function isAlreadyStateError(error, stateKeyword) {
  const details = JSON.stringify(error?.details ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  const statusCode = Number(error?.statusCode ?? 0);
  const keyword = stateKeyword.toLowerCase();

  return statusCode === 409 && (details.includes(`already ${keyword}`) || message.includes(`already ${keyword}`));
}
