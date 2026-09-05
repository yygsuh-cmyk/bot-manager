/**
 * Rastreia (em memoria) quais mensagens do Discord estao mostrando o painel
 * "Bots Free" (lista ou detalhe) agora, para que o Manager possa atualizar o
 * embed sozinho quando o estado real mudar (heartbeat, registro, ativar,
 * desativar, bloquear, desbloquear, ou o bot ficar offline por falta de
 * heartbeat) - sem exigir que alguem clique em algo.
 *
 * Isso NAO e uma segunda arquitetura de autorizacao: e so um espelho, em
 * memoria, de qual mensagem mostra qual bot/pagina, usado exclusivamente
 * para decidir quais mensagens re-renderizar. A fonte de verdade continua
 * sendo o freeBotsStore (arquivo em disco).
 */

const detailViews = new Map(); // botId -> Map(messageKey -> { channelId, messageId })
const listViews = new Map(); // messageKey -> { channelId, messageId, page }

function messageKey(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

function untrackMessage(channelId, messageId) {
  const key = messageKey(channelId, messageId);
  listViews.delete(key);
  for (const views of detailViews.values()) {
    views.delete(key);
  }
}

function trackDetailView(botId, channelId, messageId) {
  if (!channelId || !messageId) return;
  untrackMessage(channelId, messageId); // uma mensagem so mostra uma coisa por vez
  if (!detailViews.has(botId)) detailViews.set(botId, new Map());
  detailViews.get(botId).set(messageKey(channelId, messageId), { channelId, messageId });
}

function trackListView(channelId, messageId, page) {
  if (!channelId || !messageId) return;
  untrackMessage(channelId, messageId);
  listViews.set(messageKey(channelId, messageId), { channelId, messageId, page });
}

function getTrackedDetailViews(botId) {
  return Array.from(detailViews.get(botId)?.values() || []);
}

function getAllTrackedDetailBotIds() {
  return Array.from(detailViews.keys());
}

function getTrackedListViews() {
  return Array.from(listViews.values());
}

module.exports = {
  trackDetailView,
  trackListView,
  untrackMessage,
  getTrackedDetailViews,
  getAllTrackedDetailBotIds,
  getTrackedListViews
};
