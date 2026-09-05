const { ContainerBuilder, MessageFlags } = require("discord.js");

function buildDisplayResponse(options) {
  const {
    title,
    lines = [],
    rows = [],
    accentColor = 0x2b87ff,
    ephemeral = true,
    includeFlags = true
  } = options;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents((text) => text.setContent(`## ${title}`));

  for (const line of lines) {
    container.addTextDisplayComponents((text) => text.setContent(String(line)));
  }

  for (const rowComponents of rows) {
    container.addActionRowComponents((row) => row.setComponents(...rowComponents));
  }

  const payload = {
    components: [container],
    allowedMentions: { parse: [] }
  };

  if (includeFlags) {
    let flags = MessageFlags.IsComponentsV2;
    if (ephemeral) {
      flags |= MessageFlags.Ephemeral;
    }
    payload.flags = flags;
  }

  return payload;
}

function buildErrorResponse(message, options = {}) {
  return buildDisplayResponse({
    title: "Erro",
    lines: [`-# ${message}`],
    accentColor: 0xed4245,
    ephemeral: true,
    includeFlags: options.includeFlags ?? true
  });
}

module.exports = {
  buildDisplayResponse,
  buildErrorResponse
};
