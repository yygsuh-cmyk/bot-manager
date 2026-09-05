const { assertCreditsIntegrity } = require("./creditsGuard");

const ARMOR_GLOBAL_FLAG = "__SIRIUSXAI_ARMOR_OK__";

function verifyRuntimeArmor() {
  // Runtime simplificado: apenas garante que o lock de creditos segue integro.
  assertCreditsIntegrity();
  armGlobalFlag();

  return {
    ok: true,
    mode: "credits_lock_only"
  };
}

function startArmorWatch(options = {}) {
  const {
    logger,
    intervalMs = 30_000
  } = options;

  const timer = setInterval(() => {
    try {
      assertCreditsIntegrity();
      assertArmorArmed();
    } catch (error) {
      if (logger) {
        logger.error("Protecao de creditos detectou adulteracao em runtime.", {
          code: error.code ?? "RUNTIME_GUARD_TAMPERED",
          reason: error.reason ?? "unknown",
          details: error.details ?? null
        });
      }
      process.exit(87);
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

function assertArmorArmed() {
  if (globalThis[ARMOR_GLOBAL_FLAG] !== true) {
    throw buildArmorError("armor_not_armed");
  }
}

function armGlobalFlag() {
  if (globalThis[ARMOR_GLOBAL_FLAG] === true) {
    return;
  }

  Object.defineProperty(globalThis, ARMOR_GLOBAL_FLAG, {
    value: true,
    writable: false,
    configurable: false,
    enumerable: false
  });
}

function buildArmorError(reason, details = null) {
  const error = new Error("Runtime guard violation");
  error.code = "RUNTIME_GUARD_TAMPERED";
  error.reason = reason;
  error.details = details;
  return error;
}

module.exports = {
  assertArmorArmed,
  startArmorWatch,
  verifyRuntimeArmor
};
