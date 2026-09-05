const { SlashCommandBuilder } = require("discord.js");
const { assertManagerAccess } = require("../../utils/permissions");
const { buildBotConfigPanel } = require("../ui/panel");
const { getPanelRuntimeState } = require("../../services/panelRuntimeState");
const { buildDisplayResponse } = require("../../utils/discordResponse");

function createBotConfigCommand({ settingsStore, logger }) {
  return {
    data: new SlashCommandBuilder()
      .setName("botconfig")
      .setDescription("Painel principal do bot manager"),

    async execute(interaction) {
      await interaction.reply(
        buildDisplayResponse({
          title: "Bot Manager /botconfig",
          lines: ["-# Carregando painel principal..."],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );

      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);
      const runtime = await getPanelRuntimeState(settings, logger);

      await interaction.editReply(
        buildBotConfigPanel(settings, null, false, {
          includeFlags: false,
          appOnline: runtime.appOnline,
          statusMode: runtime.statusMode,
          liveStatusText: runtime.statusText
        })
      );
    }
  };
}

module.exports = {
  createBotConfigCommand
};
