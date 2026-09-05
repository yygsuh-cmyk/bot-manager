const fs = require("node:fs");
const path = require("node:path");

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function createLogger(options = {}) {
  const level = options.level ?? "info";
  const errorLogPath = options.errorLogPath;
  const minimumLevelWeight = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;

  function write(levelName, message, meta) {
    if ((LEVEL_WEIGHT[levelName] ?? 0) < minimumLevelWeight) {
      return;
    }

    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${levelName.toUpperCase()}] ${message}`;
    const suffix = meta ? ` ${safeJson(meta)}` : "";
    const finalText = `${base}${suffix}`;

    if (levelName === "error") {
      console.error(finalText);
    } else if (levelName === "warn") {
      console.warn(finalText);
    } else {
      console.log(finalText);
    }

    if (levelName === "error" && errorLogPath) {
      ensureDirectory(path.dirname(errorLogPath));
      fs.appendFileSync(errorLogPath, `${finalText}\n`, "utf8");
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable_meta]";
  }
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

module.exports = {
  createLogger
};
