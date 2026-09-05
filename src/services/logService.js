const { EmbedBuilder } = require("discord.js");

const LOG_TYPES = [
  { key: "activation", label: "logs de ativacao de licenca", emoji: "✅" },
  { key: "key_generation", label: "logs de geracao de keys", emoji: "🔑" },
  { key: "license_expiration", label: "logs de expiracao de licenca", emoji: "⏳" },
  { key: "command_usage", label: "logs de uso de comandos", emoji: "🧭" },
  { key: "announcement_sent", label: "logs de anuncios enviados", emoji: "📢" },
  { key: "errors", label: "logs de erros", emoji: "🚨" },
  { key: "bot_added", label: "logs de bots adicionados", emoji: "🤖" },
  { key: "purchases", label: "logs de compras", emoji: "🛒" },
  { key: "tickets", label: "logs de tickets", emoji: "🎫" },
  { key: "system", label: "logs gerais do sistema", emoji: "⚙️" }
];

async function sendPanelLog({ client, panelStore, type, payload = {}, logger, fallbackChannelId = "", components = [] }) {
  const panel = await panelStore.get();
  const channelId = panel.logChannels[type] || fallbackChannelId;
  if (!channelId) return false;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return false;
    await channel.send({ embeds: [buildLogEmbed(type, payload)], components });
    return true;
  } catch (error) {
    logger?.warn?.("[PanelLogs] Falha ao enviar log.", {
      type,
      channelId,
      message: error?.message
    });
    return false;
  }
}

function buildLogEmbed(type, payload) {
  if (type === "activation" && payload.activation) {
    return buildActivationLogEmbed(payload);
  }

  const logType = LOG_TYPES.find((item) => item.key === type) || LOG_TYPES[LOG_TYPES.length - 1];
  const interaction = payload.interaction || null;
  const user = payload.user || interaction?.user || null;
  const guild = payload.guild || interaction?.guild || null;

  return new EmbedBuilder()
    .setTitle(`${logType.emoji} ${logType.label}`)
    .setColor(payload.color || 0x2b87ff)
    .addFields(
      {
        name: "Usuario",
        value: user ? `${user.tag || user.username || "Usuario"}\n\`${user.id}\`` : "`n/d`",
        inline: true
      },
      {
        name: "Servidor",
        value: guild ? `${guild.name || "Servidor"}\n\`${guild.id}\`` : "`n/d`",
        inline: true
      },
      {
        name: "Horario",
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: true
      },
      {
        name: "Acao realizada",
        value: field(payload.action || logType.label),
        inline: false
      },
      {
        name: "Produto/Key utilizada",
        value: field(payload.product || payload.key || "n/d"),
        inline: false
      },
      {
        name: "Detalhes do evento",
        value: field(payload.details || "n/d", 900),
        inline: false
      }
    )
    .setTimestamp()
    .setFooter({ text: "Zyon Bot Manager • Logs" });
}

/**
 * Formato pedido no item 2: log de ativacao de licenca reformulado, com
 * cliente/servidor/dias/expiracao e o "carimbo" de data/hora no rodape.
 * Mantem o mesmo mecanismo de escolha de canal (panel.logChannels.activation),
 * so muda a APARENCIA do embed.
 */
function buildActivationLogEmbed(payload) {
  const { activation } = payload;
  const now = new Date();

  return new EmbedBuilder()
    .setTitle(`ATIVAÇÃO ${activation.productName ? String(activation.productName).toUpperCase() : "BOT FILAS"}`)
    .setColor(payload.color || 0x57f287)
    .addFields(
      { name: "👤 Cliente:", value: activation.customerMention || "n/d", inline: false },
      { name: "🏠 Servidor:", value: activation.guildName || "n/d", inline: false },
      { name: "📅 Dias:", value: String(activation.durationDays ?? "n/d"), inline: false },
      { name: "⏳ Expira em:", value: activation.expiresAtFormatted || "n/d", inline: false }
    )
    .setFooter({ text: formatActivationTimestamp(now) });
}

function formatActivationTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const tz = "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Formata "quinta-feira, 2 de julho de 2026 16:00" no fuso America/Sao_Paulo. */
function formatExtendedDate(isoDate) {
  if (!isoDate) return "n/d";
  const date = new Date(isoDate);
  const tz = "America/Sao_Paulo";
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, month: "long" }).format(date);
  const year = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return `${weekday}, ${day} de ${month} de ${year} ${time}`;
}

function field(value, max = 1024) {
  const text = String(value ?? "n/d").trim() || "n/d";
  return text.length > max ? `${text.slice(0, max - 15)}...[truncado]` : text;
}

module.exports = {
  LOG_TYPES,
  buildLogEmbed,
  formatExtendedDate,
  sendPanelLog
};
