const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { AppError } = require("../../utils/errors");
const { activateLicense } = require("../../services/licenseService");

/**
 * /ativar <key>
 *
 * Ativa uma licença para o servidor onde o comando é executado.
 * Pode ser usado por qualquer membro do servidor (não requer permissão de admin
 * do bot manager, pois é executado em servidores clientes, não no servidor manager).
 *
 * O log de ativação é enviado para o canal configurado em LICENSE_LOG_CHANNEL_ID.
 */
function createAtivarCommand({ licenseStore, logger, config }) {
  return {
    data: new SlashCommandBuilder()
      .setName("ativar")
      .setDescription("Ativa uma licença para este servidor")
      .addStringOption((option) =>
        option
          .setName("key")
          .setDescription("Sua key de licença (formato: ZYON-XXXX-XXXX-XXXX)")
          .setRequired(true)
          .setMinLength(18)
          .setMaxLength(19)
      ),

    async execute(interaction) {
      if (!interaction.inGuild()) {
        await interaction.reply(
          buildDisplayResponse({
            title: "Erro",
            lines: ["-# Este comando deve ser usado dentro de um servidor Discord."],
            accentColor: 0xed4245,
            ephemeral: true
          })
        );
        return;
      }

      const rawKey = interaction.options.getString("key", true);
      const key = rawKey.trim().toUpperCase();

      // Resposta imediata para não estourar o timeout do Discord (3s)
      await interaction.reply(
        buildDisplayResponse({
          title: "Ativando Licença...",
          lines: ["-# Verificando sua key, aguarde um momento."],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );

      let license;
      try {
        license = await activateLicense(
          licenseStore,
          key,
          interaction.guild,
          interaction.user
        );
      } catch (error) {
        const msgMap = {
          KEY_NOT_FOUND: "Key inválida. Verifique se digitou corretamente.",
          KEY_ALREADY_USED: "Esta key já foi utilizada em outro servidor.",
          KEY_EXPIRED: "Esta key está expirada e não pode mais ser ativada."
        };
        const userMsg = msgMap[error.message] || "Ocorreu um erro ao ativar a licença. Tente novamente.";

        logger.warn("[LicenseService] Falha na ativação de key.", {
          key,
          reason: error.message,
          guildId: interaction.guildId,
          userId: interaction.user.id
        });

        await interaction.editReply(
          buildDisplayResponse({
            title: "Falha na Ativação",
            lines: [`-# ${userMsg}`],
            accentColor: 0xed4245,
            ephemeral: true
          })
        );
        return;
      }

      // ── Sucesso ───────────────────────────────────────────────────────────
      const expiresDate = new Date(license.expiresAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      });

      logger.info("[LicenseService] Licença ativada com sucesso.", {
        key: license.key,
        guildId: license.guildId,
        guildName: license.guildName,
        userId: license.userId,
        expiresAt: license.expiresAt
      });

      await interaction.editReply(
        buildDisplayResponse({
          title: "Licença Ativada!",
          lines: [
            `**Servidor:** \`${interaction.guild.name}\``,
            `**Duração:** \`${license.durationDays} dia(s)\``,
            `**Expira em:** \`${expiresDate}\``,
            `-# Obrigado! Sua licença está ativa.`
          ],
          accentColor: 0x57f287,
          ephemeral: true
        })
      );

      // ── Log no canal configurado ──────────────────────────────────────────
      await sendActivationLog(interaction, license, expiresDate, config, logger);
    }
  };
}

/**
 * Envia embed de log de ativação para o canal definido em LICENSE_LOG_CHANNEL_ID.
 */
async function sendActivationLog(interaction, license, expiresDateStr, config, logger) {
  const logChannelId = config?.licenseLogChannelId;
  if (!logChannelId) return;

  try {
    const channel = await interaction.client.channels.fetch(logChannelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle("Nova Licença Ativada")
      .setColor(0x57f287)
      .addFields(
        { name: "Servidor", value: `${license.guildName}`, inline: true },
        { name: "ID do Servidor", value: `\`${license.guildId}\``, inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Usuário", value: `${license.userName}`, inline: true },
        { name: "ID do Usuário", value: `\`${license.userId}\``, inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Key Utilizada", value: `\`${license.key}\``, inline: false },
        { name: "Duração", value: `${license.durationDays} dia(s)`, inline: true },
        { name: "Expira em", value: expiresDateStr, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Bot License Manager" });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn("[LicenseService] Falha ao enviar log de ativação.", {
      logChannelId,
      error: error?.message
    });
  }
}

module.exports = { createAtivarCommand };
