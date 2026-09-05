class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
    this.expose = options.expose ?? true;
    this.details = options.details ?? null;
  }
}

function toAppError(error, fallbackMessage = "Erro interno inesperado.") {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(fallbackMessage, {
    code: "UNEXPECTED_ERROR",
    statusCode: 500,
    expose: false,
    details: normalizeErrorDetails(error)
  });
}

function getUserErrorMessage(error) {
  if (error instanceof AppError && error.expose) {
    return error.message;
  }

  return "Ocorreu um erro inesperado. Tente novamente em instantes.";
}

function normalizeErrorDetails(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

module.exports = {
  AppError,
  getUserErrorMessage,
  toAppError
};
