const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * JsonStore
 *
 * Camada de persistencia em arquivo JSON usada por licenseStore, panelStore,
 * settingsStore, appsStore e freeBotsStore.
 *
 * Correcoes aplicadas (persistencia de licencas - item 14):
 *  - Escrita ATOMICA (grava em arquivo temporario e faz rename) para que um
 *    crash/kill do processo (ex: SIGTERM do Render durante deploy/restart)
 *    NUNCA deixe o arquivo principal truncado/corrompido.
 *  - Backup automatico (.bak) do ultimo estado valido antes de cada escrita.
 *  - Leitura NUNCA volta silenciosamente para o valor padrao (vazio) quando o
 *    JSON esta corrompido: tenta recuperar do .bak e, se nao houver backup
 *    valido, lanca erro (fail-loud) em vez de apagar os dados existentes.
 *    Esse era o bug raiz que fazia licencas "sumirem"/resetarem: qualquer
 *    falha de parsing fazia o updater persistir o valor padrao vazio,
 *    sobrescrevendo o arquivo real.
 */
class JsonStore {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.backupPath = `${filePath}.bak`;
    this.tmpPath = `${filePath}.tmp`;
    this.defaultValue = cloneValue(defaultValue);
    this.ready = false;
    this.queue = Promise.resolve();
  }

  async ensureFile() {
    if (this.ready) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeDirect(this.defaultValue);
    }

    this.ready = true;
  }

  async read() {
    await this.ensureFile();
    return this.enqueue(async () => this.readDirect());
  }

  async write(nextValue) {
    await this.ensureFile();
    return this.enqueue(async () => {
      await this.writeDirect(nextValue);
      return cloneValue(nextValue);
    });
  }

  async update(updater) {
    await this.ensureFile();
    return this.enqueue(async () => {
      const currentValue = await this.readDirect();
      const clonedCurrent = cloneValue(currentValue);
      const nextValue = await updater(clonedCurrent);

      if (typeof nextValue === "undefined") {
        throw new Error("Updater do JsonStore retornou undefined.");
      }

      await this.writeDirect(nextValue);
      return cloneValue(nextValue);
    });
  }

  enqueue(task) {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  async readDirect() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return cloneValue(this.defaultValue);
      }
      throw error;
    }

    if (!raw.trim()) {
      return cloneValue(this.defaultValue);
    }

    try {
      return JSON.parse(raw);
    } catch (parseError) {
      // NUNCA descarta dados silenciosamente. Tenta recuperar do backup.
      const recovered = await this.tryRecoverFromBackup();
      if (recovered !== undefined) {
        return recovered;
      }

      throw new Error(
        `Arquivo de dados corrompido e sem backup valido: ${this.filePath}. ` +
          `Nada foi apagado; corrija/restaure o arquivo manualmente. Detalhe: ${parseError.message}`
      );
    }
  }

  async tryRecoverFromBackup() {
    try {
      const raw = await fs.readFile(this.backupPath, "utf8");
      if (!raw.trim()) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async writeDirect(nextValue) {
    const serialized = JSON.stringify(nextValue, null, 2);

    // Faz backup do estado anterior valido antes de sobrescrever, se existir.
    try {
      const previous = await fs.readFile(this.filePath, "utf8");
      if (previous.trim()) {
        JSON.parse(previous); // so faz backup se o conteudo anterior for JSON valido
        await fs.writeFile(this.backupPath, previous, "utf8");
      }
    } catch {
      // Sem arquivo anterior ou anterior corrompido: segue sem backup novo.
    }

    // Escrita atomica: grava em arquivo temporario e faz rename (operacao atomica
    // no mesmo filesystem), evitando arquivo truncado em caso de crash no meio da escrita.
    await fs.writeFile(this.tmpPath, serialized, "utf8");
    await fs.rename(this.tmpPath, this.filePath);
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  JsonStore
};
