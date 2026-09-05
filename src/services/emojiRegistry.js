const registry = new Map();

function setEmojiMap(nextMap) {
  registry.clear();
  for (const [key, value] of Object.entries(nextMap ?? {})) {
    if (!value || !value.id || !value.name) {
      continue;
    }
    registry.set(key, {
      id: String(value.id),
      name: String(value.name),
      animated: Boolean(value.animated)
    });
  }
}

function getButtonEmoji(key) {
  const emoji = registry.get(key);
  if (!emoji) {
    return null;
  }

  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated
  };
}

function getInlineEmoji(key, fallback = "") {
  const emoji = registry.get(key);
  if (!emoji) {
    return fallback;
  }

  const prefix = emoji.animated ? "a" : "";
  return `<${prefix}:${emoji.name}:${emoji.id}>`;
}

module.exports = {
  getButtonEmoji,
  getInlineEmoji,
  setEmojiMap
};
