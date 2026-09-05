const { SlashCommandBuilder } = require("discord.js");
const { assertManagerAccess } = require("../../utils/permissions");
const { buildDisplayResponse } = require("../../utils/discordResponse");

function createPingCommand({ settingsStore }) {
  return {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Mostra latencia do bot manager"),

    async execute(interaction) {
      const settings = await settingsStore.get();
      assertManagerAccess(interaction, settings);

      await interaction.reply(
        buildDisplayResponse({
          title: "Latencia",
          lines: [
            `**Gateway Ping:** \`${interaction.client.ws.ping}ms\``,
            `**Shard:** \`${interaction.guild?.shardId ?? 0}\``,
            `**Uptime:** \`${Math.floor(process.uptime())}s\``
          ],
          accentColor: 0x5865f2,
          ephemeral: true
        })
      );
    }
  };
}

module.exports = {
  createPingCommand
};
