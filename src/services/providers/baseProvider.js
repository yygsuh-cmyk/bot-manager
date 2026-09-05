const axios = require("axios");
const FormData = require("form-data");
const { AppError } = require("../../utils/errors");
const { assertCreditsIntegrity } = require("../../security/creditsGuard");
const { assertArmorArmed } = require("../../security/runtimeArmor");

class BaseProvider {
  constructor(options) {
    this.providerKey = options.providerKey;
    this.baseURL = options.baseURL;
    this.authHeaderName = options.authHeaderName;
    this.apiToken = options.apiToken;
    this.logger = options.logger;

    this.http = axios.create({
      baseURL: this.baseURL,
      timeout: 20_000,
      validateStatus: () => true
    });
  }

  setToken(token) {
    this.apiToken = token;
  }

  async get(url, params) {
    const response = await this.request({
      method: "GET",
      url,
      params
    });
    return response.data;
  }

  async post(url, data, params) {
    const response = await this.request({
      method: "POST",
      url,
      params,
      data
    });
    return response.data;
  }

  async put(url, data, params) {
    const response = await this.request({
      method: "PUT",
      url,
      params,
      data
    });
    return response.data;
  }

  async patch(url, data, params) {
    const response = await this.request({
      method: "PATCH",
      url,
      params,
      data
    });
    return response.data;
  }

  async delete(url, data, params) {
    const response = await this.request({
      method: "DELETE",
      url,
      params,
      data
    });
    return response.data;
  }

  async rawRequest(options) {
    const response = await this.request({
      method: String(options.method || "GET").toUpperCase(),
      url: options.url,
      params: options.params,
      data: options.data,
      headers: options.headers
    });

    return response.data;
  }

  async rawMultipart(options) {
    const fieldName = options.fieldName || "file";
    const fileName = options.fileName || "upload.zip";
    const fileContentType = options.fileContentType || "application/octet-stream";
    const retries = Number.isInteger(options.retries) ? options.retries : 1;
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 120_000;

    if (!options.fileBuffer) {
      throw new AppError("Arquivo nao informado para envio multipart.", {
        statusCode: 400,
        code: "MULTIPART_FILE_REQUIRED"
      });
    }

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const form = new FormData();
      form.append(fieldName, options.fileBuffer, {
        filename: fileName,
        contentType: fileContentType
      });

      const extraFields = options.fields ?? {};
      for (const [key, value] of Object.entries(extraFields)) {
        if (value === null || typeof value === "undefined") {
          continue;
        }

        if (typeof value === "object") {
          form.append(key, JSON.stringify(value));
          continue;
        }

        form.append(key, String(value));
      }

      const headers = {
        ...form.getHeaders(),
        ...(options.headers ?? {})
      };

      const contentLength = await getFormLengthSafe(form);
      if (contentLength !== null && !hasContentLengthHeader(headers)) {
        headers["Content-Length"] = String(contentLength);
      }

      try {
        const response = await this.request(
          {
            method: String(options.method || "POST").toUpperCase(),
            url: options.url,
            params: options.params,
            data: form,
            headers,
            timeout: timeoutMs,
            maxBodyLength: Infinity,
            maxContentLength: Infinity
          },
          { retries: 0 }
        );

        return response.data;
      } catch (error) {
        lastError = error instanceof AppError ? error : this.normalizeError(error);
        if (!shouldRetryMultipartError(lastError) || attempt === retries) {
          break;
        }

        const delayMs = 1000 * (attempt + 1);
        this.logger.warn(`${this.providerKey}: multipart retry ${attempt + 1}/${retries}`, {
          statusCode: lastError.statusCode,
          code: lastError.code,
          delayMs
        });

        await sleep(delayMs);
      }
    }

    throw lastError ?? new AppError("Falha ao enviar arquivo multipart.", {
      statusCode: 503,
      code: "HOST_MULTIPART_FAILED"
    });
  }

  async request(requestConfig, options = {}) {
    assertArmorArmed();
    assertCreditsIntegrity();

    if (!this.apiToken) {
      throw new AppError("Token da API do host nao foi configurado.", {
        statusCode: 400,
        code: "HOST_TOKEN_MISSING"
      });
    }

    const retries = options.retries ?? 2;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const headers = {
          [this.authHeaderName]: this.apiToken,
          ...(requestConfig.headers ?? {})
        };

        if (!hasContentTypeHeader(headers)) {
          headers["Content-Type"] = "application/json";
        }

        const response = await this.http.request({
          ...requestConfig,
          headers
        });

        if (response.status >= 200 && response.status < 300) {
          return response;
        }

        throw this.buildRequestError(response);
      } catch (error) {
        lastError = error;
        const statusCode = error.statusCode ?? error.response?.status ?? 0;
        const shouldRetry =
          statusCode === 429 ||
          statusCode >= 500 ||
          (!statusCode && error.code !== "ERR_CANCELED");

        if (!shouldRetry || attempt === retries) {
          break;
        }

        const retryAfterHeader = Number(error.response?.headers?.["retry-after"] ?? 0);
        const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 800 * (attempt + 1);

        this.logger.warn(`${this.providerKey}: retry ${attempt + 1}/${retries}`, {
          statusCode,
          delayMs
        });

        await sleep(delayMs);
      }
    }

    throw this.normalizeError(lastError);
  }

  normalizeError(error) {
    if (error instanceof AppError) {
      return error;
    }

    if (error?.response) {
      const statusCode = error.response.status;
      const responseMessage = extractProviderMessage(error.response.data);

      if (statusCode === 401) {
        return new AppError("Token da API invalido para o host selecionado.", {
          statusCode: 401,
          code: "HOST_UNAUTHORIZED",
          details: error.response.data
        });
      }

      if (statusCode === 404) {
        return new AppError("Aplicacao ou recurso nao encontrado no host.", {
          statusCode: 404,
          code: "HOST_NOT_FOUND",
          details: error.response.data
        });
      }

      if (statusCode === 429) {
        return new AppError("Rate limit do host atingido. Aguarde alguns segundos.", {
          statusCode: 429,
          code: "HOST_RATE_LIMIT",
          details: error.response.data
        });
      }

      return new AppError(
        responseMessage || "Falha ao comunicar com a API do host.",
        {
          statusCode,
          code: "HOST_REQUEST_FAILED",
          details: error.response.data
        }
      );
    }

    return new AppError(
      error?.message || "Falha de rede ao comunicar com a API do host.",
      {
        statusCode: 503,
        code: "HOST_NETWORK_ERROR",
        details: {
          code: error?.code,
          message: error?.message
        }
      }
    );
  }

  buildRequestError(response) {
    const err = new Error(`HTTP ${response.status}`);
    err.response = response;
    return err;
  }
}

function extractProviderMessage(data) {
  if (!data) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  if (typeof data.message === "string") {
    return data.message;
  }

  if (typeof data.response === "string") {
    return data.response;
  }

  if (typeof data.error === "string") {
    return data.error;
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasContentTypeHeader(headers) {
  if (!headers || typeof headers !== "object") {
    return false;
  }

  return Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
}

function hasContentLengthHeader(headers) {
  if (!headers || typeof headers !== "object") {
    return false;
  }

  return Object.keys(headers).some((key) => key.toLowerCase() === "content-length");
}

function getFormLengthSafe(form) {
  return new Promise((resolve) => {
    form.getLength((error, length) => {
      if (error || !Number.isFinite(length)) {
        resolve(null);
        return;
      }
      resolve(length);
    });
  });
}

function shouldRetryMultipartError(error) {
  if (!(error instanceof AppError)) {
    return false;
  }

  if (error.statusCode === 429 || error.statusCode >= 500) {
    return true;
  }

  return error.code === "HOST_NETWORK_ERROR";
}

module.exports = {
  BaseProvider
};
