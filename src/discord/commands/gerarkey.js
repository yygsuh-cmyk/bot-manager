const { SlashCommandBuilder } = require("discord.js");
const { assertManagerAccess } = require("../../utils/permissions");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { AppError } = require("../../utils/errors");
const { createLicense } = require("../../services/licenseService");

/**
 * /gerarkey <dias>
 *
 * Gera uma nova key de licença no formato ZYON-XXXX-XXXX-XXXX.
 * Apenas administradores do bot manager podem usar este comando.
 */
function createGerarKeyCommand({ settingsStore, licenseStore, logger }) {
  return {
    data: new SlashCommandBuilder()
      .setName("gerarkey")
      .setDescription("Gera uma nova key de licença [Admin]")
      .addIntegerOption((option) =>
        option
          .setName("dias")
          .setDescription("Duração da licença em dias (ex: 30)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(3650)
      ),

    async execute(interaction) {
      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);

      const dias = interaction.options.getInteger("dias", true);

      const license = await createLicense(licenseStore, dias);

      logger.info("[LicenseService] Nova key gerada.", {
        key: license.key,
        durationDays: license.durationDays,
        createdBy: interaction.user.id
      });

      await interaction.reply(
        buildDisplayResponse({
          title: "Key Gerada com Sucesso",
          lines: [
            `**Key:** \`${license.key}\``,
            `**Duração:** \`${dias} dia(s)\``,
            `**Status:** \`Pendente (aguardando ativação)\``,
            `**Criada em:** \`${new Date(license.createdAt).toLocaleString("pt-BR")}\``,
            `-# Compartilhe esta key com o cliente para que ele use /ativar.`
          ],
          accentColor: 0x57f287,
          ephemeral: true
        })
      );
    }
  };
}

module.exports = { createGerarKeyCommand };
