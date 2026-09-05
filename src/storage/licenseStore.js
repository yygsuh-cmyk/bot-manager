const path = require("node:path");
const { JsonStore } = require("./jsonStore");

const DEFAULT_LICENSES = { licenses: {} };

/**
 * Camada de armazenamento para licenças.
 * Usa o JsonStore existente do projeto para consistência e segurança de concorrência.
 */
class LicenseStore {
  constructor(filePath) {
    const resolvedPath = filePath || path.resolve(process.cwd(), "data", "licenses.json");
    this.store = new JsonStore(resolvedPath, DEFAULT_LICENSES);
  }

  async init() {
    await this.store.ensureFile();
  }

  /** Retorna o mapa de todas as licenças { [key]: licenseObject } */
  async getAll() {
    const data = await this.store.read();
    return data.licenses || {};
  }

  /**
   * Aplica uma função de atualização sobre o mapa de licenças.
   * @param {(licenses: object) => object} updater
   */
  async update(updater) {
    return this.store.update((current) => {
      const safeCurrent = {
        ...DEFAULT_LICENSES,
        ...current,
        licenses: { ...(current?.licenses || {}) }
      };
      safeCurrent.licenses = updater(safeCurrent.licenses);
      return safeCurrent;
    });
  }
}

module.exports = { LicenseStore };
