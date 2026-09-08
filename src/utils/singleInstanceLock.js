const fs = require("node:fs");
const path = require("node:path");

/**
 * singleInstanceLock.js
 *
 * Evita que duas instancias do Bot Manager fiquem logadas no Discord AO
 * MESMO TEMPO com o mesmo token.
 *
 * Sintoma que isso resolve: quando duas instancias do processo ficam ativas
 * simultaneamente (ex: um restart que nao matou o processo anterior antes de
 * subir o novo - comum com "nodemon"/"node --watch" ou reiniciar pela IDE
 * sem encerrar o terminal antigo), AMBAS recebem o mesmo evento do gateway e
 * tentam responder a mesma interaction. A que responde primeiro (geralmente
 * a instancia ANTIGA, com o painel/codigo desatualizado) "vence"; quando a
 * instancia NOVA tenta responder em seguida, a interaction ja foi consumida
 * e a chamada falha com DiscordAPIError 10062 ("Unknown interaction") ou
 * 40060 ("Interaction has already been acknowledged"). O efeito visivel
 * disso e exatamente botoes/paineis antigos reaparecendo e as mudancas
 * novas nunca sendo aplicadas.
 *
 * A trava usa um arquivo com o PID do processo atual, no mesmo DATA_DIR ja
 * usado para settings/licencas/bots - nao introduz um mecanismo novo de
 * persistencia. Ao iniciar:
 *   1. Se ja existe um lock com PID de um processo VIVO -> aborta o boot
 *      com uma mensagem clara, em vez de deixar duas instancias no ar.
 *   2. Se o lock esta orfao (processo daquele PID nao existe mais) -> e
 *      apenas um resto de um encerramento anormal; o novo processo assume o
 *      lock normalmente.
 *   3. Ao encerrar de forma graciosa (SIGTERM/SIGINT), o lock e removido.
 */
function isProcessAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    // Sinal 0 nao mata o processo - so verifica se ele existe e se temos
    // permissao para sinaliza-lo. Funciona tanto no Linux/macOS quanto no
    // Windows (o Node implementa isso via OpenProcess no Windows).
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = processo nao existe. EPERM = existe mas de outro usuario
    // (trata como "vivo" por seguranca, para nunca dar match errado).
    return error?.code === "EPERM";
  }
}

function acquireSingleInstanceLock(dataDir, logger) {
  const lockPath = path.join(dataDir, "manager.lock");

  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf8").trim();
      const existingPid = Number(raw);

      if (isProcessAlive(existingPid) && existingPid !== process.pid) {
        logger.error(
          "Outra instancia do Bot Manager ja esta rodando (mesmo DATA_DIR). Encerrando para evitar duas conexoes simultaneas com o mesmo token do Discord.",
          { lockPath, existingPid }
        );
        console.error(
          `\n[SingleInstanceLock] Ja existe um processo do Bot Manager rodando (PID ${existingPid}).\n` +
            "Encerre esse processo antes de iniciar um novo (ex: feche o terminal/janela antiga, " +
            "ou finalize o processo node.exe correspondente no Gerenciador de Tarefas) e tente novamente.\n" +
            "Isso evita respostas duplicadas/perdidas em interacoes do Discord (erros 10062/40060).\n"
        );
        process.exit(1);
      }

      if (existingPid !== process.pid) {
        logger.warn("Lock orfao encontrado (processo anterior nao esta mais rodando). Assumindo o lock.", {
          lockPath,
          previousPid: existingPid
        });
      }
    }

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid), "utf8");
  } catch (error) {
    // Uma falha ao criar/ler o lock (ex: permissao de disco) nunca deve
    // impedir o bot de subir - a trava e uma protecao extra, nao um
    // requisito de funcionamento. Loga e segue.
    logger.warn("Nao foi possivel gerenciar o lock de instancia unica. Seguindo sem essa protecao.", {
      lockPath,
      message: error?.message
    });
    return () => {};
  }

  function releaseSingleInstanceLock() {
    try {
      const raw = fs.readFileSync(lockPath, "utf8").trim();
      if (Number(raw) === process.pid) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Lock ja removido ou ilegivel - nada a fazer.
    }
  }

  return releaseSingleInstanceLock;
}

module.exports = {
  acquireSingleInstanceLock
};
