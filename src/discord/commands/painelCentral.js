const { SlashCommandBuilder } = require("discord.js");
const { executePanelCommand } = require("../panel/centralPanelController");

function createPainelCentralCommand(dependencies) {
  return {
    data: new SlashCommandBuilder()
      .setName("painel_central")
      .setDescription("Abre o painel central visual do bot manager"),

    async execute(interaction) {
      await executePanelCommand(interaction, dependencies);
    }
  };
}

module.exports = {
  createPainelCentralCommand
};
