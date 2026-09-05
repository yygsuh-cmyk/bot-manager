const crypto = require("node:crypto");
const fs = require("node:fs");

// SIRIUSXAI_CREDITS_LOCK_V2
const LOCK_MARKER = "SIRIUSXAI_CREDITS_LOCK_V2";
const EXPECTED_OWNER = "SiriusX.AI";
const EXPECTED_SEAL = "e3bf490c23346d15e19f626dc1b4013a29d09bcea487b413a20579e8979a76d3";
const SALT_HEX = "5a4be633b798187a3feb0bf97dd99565";
const IV_HEX = "5bb5a59511f252465a57e777";
const CIPHER_HEX = "a07b6ab7fb23baeffc43";
const AUTH_TAG_HEX = "b915fca9c7cf5a2ffafe2fccaef2ce82";

function assertCreditsIntegrity() {
  if (globalThis.__SIRIUSXAI_GUARD__ === EXPECTED_OWNER) {
    return EXPECTED_OWNER;
  }

  const owner = decryptOwner();
  const seal = buildSeal(owner);
  const selfHasMarker = readSelf().includes(LOCK_MARKER);

  if (owner !== EXPECTED_OWNER) {
    throw buildTamperError("owner_mismatch");
  }

  if (seal !== EXPECTED_SEAL) {
    throw buildTamperError("seal_mismatch");
  }

  if (!selfHasMarker) {
    throw buildTamperError("marker_missing");
  }

  lockGlobalGuard(owner);
  return owner;
}

function logCreditsBanner(logger) {
  const owner = assertCreditsIntegrity();
  console.log("====================================");
  console.log(` CREDITS LOCKED | OWNER: ${owner}`);
  console.log(" Protection: ACTIVE");
  console.log("====================================");
  logger.info("Credito protegido carregado.", { owner });
}

function decryptOwner() {
  const passphrase = buildPassphrase();
  const key = crypto.scryptSync(passphrase, Buffer.from(SALT_HEX, "hex"), 32);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(IV_HEX, "hex")
  );
  decipher.setAuthTag(Buffer.from(AUTH_TAG_HEX, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(CIPHER_HEX, "hex")),
    decipher.final()
  ]);
  return plain.toString("utf8");
}

function buildPassphrase() {
  return ["no", "va", "::", "guard", "::", "sirius", "x", ".", "ai", "::", "v3"].join("");
}

function buildSeal(owner) {
  return crypto
    .createHash("sha256")
    .update(`${owner}|${LOCK_MARKER}|runtime-guard`)
    .digest("hex");
}

function readSelf() {
  try {
    return fs.readFileSync(__filename, "utf8");
  } catch {
    return "";
  }
}

function lockGlobalGuard(owner) {
  if (globalThis.__SIRIUSXAI_GUARD__ === owner) {
    return;
  }

  Object.defineProperty(globalThis, "__SIRIUSXAI_GUARD__", {
    value: owner,
    writable: false,
    configurable: false,
    enumerable: false
  });
}

function buildTamperError(reason) {
  const error = new Error("Protecao de creditos violada.");
  error.code = "CREDITS_TAMPERED";
  error.reason = reason;
  return error;
}

module.exports = {
  assertCreditsIntegrity,
  logCreditsBanner
};
