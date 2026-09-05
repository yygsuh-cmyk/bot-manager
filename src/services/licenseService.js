function generateLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const segment = (len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ZYON-${segment(4)}-${segment(4)}-${segment(4)}`;
}

async function createLicense(licenseStore, durationDays, options = {}) {
  const days = clampDays(durationDays);
  let key = generateLicenseKey();

  const license = {
    key,
    durationDays: days,
    status: "pending",
    guildId: null,
    guildName: null,
    userId: null,
    userName: null,
    activatedAt: null,
    expiresAt: null,
    // productId: referencia opcional a um item do painel (Gerenciar Produtos)
    // usado para montar o botao "comprar novamente" no log de ativacao (item 2).
    productId: options.productId ? String(options.productId) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await licenseStore.update((licenses) => {
    while (licenses[key]) {
      key = generateLicenseKey();
      license.key = key;
    }
    licenses[key] = license;
    return licenses;
  });

  return license;
}

async function activateLicense(licenseStore, key, guild, user) {
  const normalizedKey = normalizeLicenseKey(key);
  let activatedLicense = null;

  await licenseStore.update((licenses) => {
    const license = licenses[normalizedKey];
    if (!license) throw new Error("KEY_NOT_FOUND");
    if (license.status === "active") throw new Error("KEY_ALREADY_USED");
    if (license.status === "expired" || license.status === "revoked") throw new Error("KEY_EXPIRED");

    const now = new Date();
    const expires = new Date(now.getTime() + Number(license.durationDays) * 24 * 60 * 60 * 1000);

    activatedLicense = {
      ...license,
      status: "active",
      guildId: String(guild.id),
      guildName: guild.name,
      userId: String(user.id),
      userName: user.tag || user.username,
      activatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      updatedAt: now.toISOString()
    };

    licenses[normalizedKey] = activatedLicense;
    return licenses;
  });

  return activatedLicense;
}

async function isGuildLicensed(licenseStore, guildId) {
  const licenses = await licenseStore.getAll();
  const now = new Date();

  return Object.values(licenses).some(
    (license) =>
      license.status === "active" &&
      license.guildId === String(guildId) &&
      license.expiresAt &&
      new Date(license.expiresAt) > now
  );
}

async function checkAndExpireLicenses(licenseStore, logger) {
  const expiredLicenses = await expireLicenses(licenseStore);

  if (expiredLicenses.length > 0 && logger?.info) {
    logger.info("[LicenseService] Licencas expiradas automaticamente.", {
      count: expiredLicenses.length,
      keys: expiredLicenses.map((license) => license.key)
    });
  }

  return expiredLicenses;
}

async function expireLicenses(licenseStore) {
  const now = new Date();
  const expiredLicenses = [];

  await licenseStore.update((licenses) => {
    for (const [key, license] of Object.entries(licenses)) {
      if (license.status === "active" && license.expiresAt && new Date(license.expiresAt) <= now) {
        licenses[key] = {
          ...license,
          status: "expired",
          updatedAt: now.toISOString()
        };
        expiredLicenses.push(licenses[key]);
      }
    }
    return licenses;
  });

  return expiredLicenses;
}

async function getLicenseSummary(licenseStore) {
  // A listagem do painel tambem atualiza o estado persistido. Assim uma key
  // expirada entre duas execucoes da tarefa periodica nao volta a aparecer
  // como ativa depois de reiniciar o Manager.
  await expireLicenses(licenseStore);
  const licenses = await licenseStore.getAll();
  const list = Object.values(licenses);
  const now = new Date();
  const activeList = list.filter((license) => isLicenseVisibleAsActive(license, now));
  const summary = {
    total: list.length,
    pending: 0,
    active: 0,
    expired: 0,
    revoked: 0,
    recent: activeList
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 20)
  };

  for (const license of list) {
    if (Object.hasOwn(summary, license.status)) {
      summary[license.status] += 1;
    }
  }

  return summary;
}

function isLicenseVisibleAsActive(license, now) {
  if (!license || !["pending", "active", "suspended"].includes(license.status)) {
    return false;
  }

  // Keys novas ainda nao possuem expiresAt e devem continuar visiveis para
  // que possam ser administradas. Para uma key ja ativada, uma data ausente
  // ou invalida nao pode ser tratada como uma licenca valida.
  if (!license.expiresAt) return license.status === "pending";

  const expiresAt = new Date(license.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now;
}

async function revokeLicense(licenseStore, key) {
  const normalizedKey = normalizeLicenseKey(key);
  let revoked = null;

  await licenseStore.update((licenses) => {
    const license = licenses[normalizedKey];
    if (!license) throw new Error("KEY_NOT_FOUND");

    revoked = {
      ...license,
      status: "revoked",
      updatedAt: new Date().toISOString()
    };
    licenses[normalizedKey] = revoked;
    return licenses;
  });

  return revoked;
}

/**
 * Desativa (suspende) uma licenca ativa pelo Manager sem apagar seu historico.
 * Usado pela tela "Lista de Apps" (item 5) para desligar a autorizacao do
 * bot/app vinculado sem perder a data de expiracao original: ao reativar, a
 * validade restante continua exatamente de onde estava.
 */
async function suspendLicense(licenseStore, key) {
  const normalizedKey = normalizeLicenseKey(key);
  let updated = null;

  await licenseStore.update((licenses) => {
    const license = licenses[normalizedKey];
    if (!license) throw new Error("KEY_NOT_FOUND");
    if (license.status !== "active") throw new Error("LICENSE_NOT_ACTIVE");

    updated = {
      ...license,
      status: "suspended",
      updatedAt: new Date().toISOString()
    };
    licenses[normalizedKey] = updated;
    return licenses;
  });

  return updated;
}

/** Reativa uma licenca previamente suspensa, preservando a expiresAt original. */
async function reactivateLicense(licenseStore, key) {
  const normalizedKey = normalizeLicenseKey(key);
  let updated = null;

  await licenseStore.update((licenses) => {
    const license = licenses[normalizedKey];
    if (!license) throw new Error("KEY_NOT_FOUND");
    if (license.status !== "suspended") throw new Error("LICENSE_NOT_SUSPENDED");

    const now = new Date();
    if (license.expiresAt && new Date(license.expiresAt) <= now) {
      throw new Error("KEY_EXPIRED");
    }

    updated = {
      ...license,
      status: "active",
      updatedAt: now.toISOString()
    };
    licenses[normalizedKey] = updated;
    return licenses;
  });

  return updated;
}

/**
 * Lista licencas ativas/suspensas com dados de app/instalacao para a tela
 * "Lista de Apps" (item 5) - todos os bots/apps que estao usando uma key.
 */
async function listLicensedApps(licenseStore) {
  const licenses = await licenseStore.getAll();
  return Object.values(licenses)
    .filter((license) => license.guildId && (license.status === "active" || license.status === "suspended" || license.status === "expired"))
    .sort((a, b) => new Date(b.activatedAt || 0) - new Date(a.activatedAt || 0));
}

function maskLicenseKey(key) {
  const raw = String(key || "");
  const parts = raw.split("-");
  if (parts.length < 2) {
    return raw ? `${raw.slice(0, 4)}****` : "n/d";
  }
  return `${parts[0]}-****-****-${parts[parts.length - 1]}`;
}

function normalizeLicenseKey(key) {
  return String(key || "").trim().toUpperCase();
}

function clampDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(3650, Math.floor(parsed)));
}

module.exports = {
  activateLicense,
  checkAndExpireLicenses,
  createLicense,
  generateLicenseKey,
  getLicenseSummary,
  isGuildLicensed,
  listLicensedApps,
  maskLicenseKey,
  normalizeLicenseKey,
  reactivateLicense,
  revokeLicense,
  suspendLicense
};
