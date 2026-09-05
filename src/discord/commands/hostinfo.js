const { SlashCommandBuilder } = require("discord.js");
const { buildDisplayResponse } = require("../../utils/discordResponse");
const { assertManagerAccess } = require("../../utils/permissions");
const { getConfiguredProvider } = require("../../services/managerService");
const { providerLabel } = require("../../utils/format");
const { getInlineEmoji } = require("../../services/emojiRegistry");

function createHostInfoCommand({ settingsStore, logger }) {
  return {
    data: new SlashCommandBuilder()
      .setName("hostinfo")
      .setDescription("Mostra informacoes da conta conectada ao host"),

    async execute(interaction) {
      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);
      await interaction.reply(
        buildDisplayResponse({
          title: "Host Info",
          lines: ["-# Consultando host, aguarde..."],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );

      const { provider } = await getConfiguredProvider(settingsStore, logger);
      const account = await provider.validateToken();
      const apps = await provider.listApps();

      await interaction.editReply(
        buildDisplayResponse({
          title: "Host Info",
          lines: [
            `${getInlineEmoji("brand_cloud", "")} **Host:** \`${providerLabel(settings.provider)}\``,
            `${getInlineEmoji("brand_bot", "")} **Conta:** \`${account.username}\``,
            `**ID:** \`${account.userId ?? "n/d"}\``,
            `**Plano:** \`${account.plan ?? "n/d"}\``,
            `**Memoria total:** \`${account.memoryLimitMb ?? "n/d"} MB\``,
            `**Memoria disponivel:** \`${account.memoryAvailableMb ?? "n/d"} MB\``,
            `**Apps encontradas:** \`${apps.length}\``
          ],
          accentColor: 0x57f287,
          includeFlags: false
        })
      );
    }
  };
}

module.exports = {
  createHostInfoCommand
};
