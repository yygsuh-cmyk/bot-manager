const { createPainelCentralCommand } = require("./painelCentral");

function createCommands(dependencies) {
  return [
    createPainelCentralCommand(dependencies)
  ];
}

module.exports = {
  createCommands
};
