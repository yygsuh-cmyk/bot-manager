const PROVIDER_LABELS = {
  squarecloud: "SquareCloud",
  discloud: "Discloud"
};

function normalizeProvider(provider) {
  if (!provider) {
    return null;
  }

  const normalized = String(provider).toLowerCase().trim();
  if (!Object.hasOwn(PROVIDER_LABELS, normalized)) {
    return null;
  }

  return normalized;
}

function providerLabel(provider) {
  const normalized = normalizeProvider(provider);
  return normalized ? PROVIDER_LABELS[normalized] : "Nao configurado";
}

function maskToken(token) {
  if (!token) {
    return "nao definido";
  }

  if (token.length <= 6) {
    return `${token.slice(0, 1)}***${token.slice(-1)}`;
  }

  return `${token.slice(0, 2)}...${token.slice(-2)}`;
}

function clampText(value, maxLength = 3500) {
  const normalized = String(value ?? "");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 18))}\n...[texto truncado]`;
}

function toCodeBlock(value, language = "") {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

module.exports = {
  clampText,
  maskToken,
  normalizeProvider,
  providerLabel,
  toCodeBlock
};
