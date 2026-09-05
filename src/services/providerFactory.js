const { AppError } = require("../utils/errors");
const { normalizeProvider } = require("../utils/format");
const { SquareCloudProvider } = require("./providers/squareCloudProvider");
const { DiscloudProvider } = require("./providers/discloudProvider");

function createProvider(settings, logger) {
  const providerKey = normalizeProvider(settings.provider);

  if (!providerKey) {
    throw new AppError("Host nao configurado. Use /botconfig para selecionar o host.", {
      statusCode: 400,
      code: "HOST_NOT_CONFIGURED"
    });
  }

  if (!settings.apiToken) {
    throw new AppError("Token da API nao configurado. Use /botconfig para definir o token.", {
      statusCode: 400,
      code: "HOST_TOKEN_NOT_CONFIGURED"
    });
  }

  if (providerKey === "squarecloud") {
    return new SquareCloudProvider({
      apiToken: settings.apiToken,
      logger
    });
  }

  if (providerKey === "discloud") {
    return new DiscloudProvider({
      apiToken: settings.apiToken,
      logger
    });
  }

  throw new AppError("Host informado nao e suportado.", {
    statusCode: 400,
    code: "HOST_UNSUPPORTED"
  });
}

module.exports = {
  createProvider
};
