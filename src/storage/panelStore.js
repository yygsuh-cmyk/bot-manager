const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("./jsonStore");

const DEFAULT_PANEL = {
  version: 1,
  visual: {
    title: "Zyon Bot Manager",
    description: "Sistema visual profissional para gerenciar bots, licencas, produtos, anuncios e logs.",
    color: "#2b87ff",
    successColor: "#57f287",
    dangerColor: "#ed4245",
    bannerUrl: "",
    thumbnailUrl: "",
    footer: "Zyon Bot Manager"
  },
  logChannels: {
    activation: "",
    key_generation: "",
    license_expiration: "",
    command_usage: "",
    announcement_sent: "",
    errors: "",
    bot_added: "",
    purchases: "",
    tickets: "",
    system: ""
  },
  announcements: [],
  updatedAt: null
};

class PanelStore {
  constructor(filePath) {
    this.store = new JsonStore(filePath || path.resolve(process.cwd(), "data", "panel.json"), DEFAULT_PANEL);
  }

  async init() {
    await this.store.ensureFile();
    await this.store.update((current) => normalizePanel(current));
  }

  async get() {
    return normalizePanel(await this.store.read());
  }

  async patchVisual(partial) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      next.visual = normalizeVisual({ ...next.visual, ...partial });
      next.updatedAt = now();
      return next;
    });
  }

  async setLogChannel(type, channelId) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      if (Object.hasOwn(next.logChannels, type)) {
        next.logChannels[type] = String(channelId || "");
        next.updatedAt = now();
      }
      return next;
    });
  }

  async createAnnouncement(input) {
    const item = normalizeAnnouncement({
      id: createId("ann"),
      ...input,
      buttons: [],
      createdAt: now(),
      updatedAt: now()
    });

    await this.store.update((current) => {
      const next = normalizePanel(current);
      next.announcements.unshift(item);
      next.updatedAt = now();
      return next;
    });

    return item;
  }

  async updateAnnouncement(id, partial) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      const index = next.announcements.findIndex((item) => item.id === id);
      if (index >= 0) {
        next.announcements[index] = normalizeAnnouncement({
          ...next.announcements[index],
          ...partial,
          updatedAt: now()
        });
        next.updatedAt = now();
      }
      return next;
    });
  }

  async removeAnnouncement(id) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      next.announcements = next.announcements.filter((item) => item.id !== id);
      next.updatedAt = now();
      return next;
    });
  }

  async addButton(announcementId, input) {
    const button = normalizeButton({
      id: createId("btn"),
      ...input,
      createdAt: now(),
      updatedAt: now()
    });

    await this.store.update((current) => {
      const next = normalizePanel(current);
      const item = next.announcements.find((entry) => entry.id === announcementId);
      if (item) {
        item.buttons.push(button);
        item.updatedAt = now();
        next.updatedAt = now();
      }
      return next;
    });

    return button;
  }

  async updateButton(announcementId, buttonId, partial) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      const item = next.announcements.find((entry) => entry.id === announcementId);
      if (!item) return next;
      const index = item.buttons.findIndex((button) => button.id === buttonId);
      if (index >= 0) {
        item.buttons[index] = normalizeButton({ ...item.buttons[index], ...partial, updatedAt: now() });
        item.updatedAt = now();
        next.updatedAt = now();
      }
      return next;
    });
  }

  async removeButton(announcementId, buttonId) {
    return this.store.update((current) => {
      const next = normalizePanel(current);
      const item = next.announcements.find((entry) => entry.id === announcementId);
      if (item) {
        item.buttons = item.buttons.filter((button) => button.id !== buttonId);
        item.updatedAt = now();
        next.updatedAt = now();
      }
      return next;
    });
  }
}

function normalizePanel(state) {
  const source = state && typeof state === "object" ? state : {};
  return {
    version: 1,
    visual: normalizeVisual({ ...DEFAULT_PANEL.visual, ...(source.visual || {}) }),
    logChannels: { ...DEFAULT_PANEL.logChannels, ...(source.logChannels || {}) },
    announcements: Array.isArray(source.announcements) ? source.announcements.map(normalizeAnnouncement) : [],
    updatedAt: source.updatedAt || null
  };
}

function normalizeVisual(visual) {
  return {
    title: clamp(visual.title || DEFAULT_PANEL.visual.title, 120),
    description: clamp(visual.description || DEFAULT_PANEL.visual.description, 1200),
    color: normalizeColor(visual.color || visual.accentColor || DEFAULT_PANEL.visual.color),
    successColor: normalizeColor(visual.successColor || DEFAULT_PANEL.visual.successColor),
    dangerColor: normalizeColor(visual.dangerColor || DEFAULT_PANEL.visual.dangerColor),
    bannerUrl: normalizeUrl(visual.bannerUrl),
    thumbnailUrl: normalizeUrl(visual.thumbnailUrl),
    footer: clamp(visual.footer || DEFAULT_PANEL.visual.footer, 200)
  };
}

function normalizeAnnouncement(input) {
  return {
    id: String(input.id || createId("ann")),
    type: input.type === "product" ? "product" : "announcement",
    name: clamp(input.name || input.title || "Novo item", 90),
    title: clamp(input.title || input.name || "Novo anuncio", 250),
    description: clamp(input.description || "Descricao do anuncio.", 4000),
    color: normalizeColor(input.color || DEFAULT_PANEL.visual.color),
    imageUrl: normalizeUrl(input.imageUrl),
    thumbnailUrl: normalizeUrl(input.thumbnailUrl),
    footer: clamp(input.footer || DEFAULT_PANEL.visual.footer, 200),
    channelId: String(input.channelId || ""),
    buttons: Array.isArray(input.buttons) ? input.buttons.map(normalizeButton) : [],
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now()
  };
}

function normalizeButton(input) {
  return {
    id: String(input.id || createId("btn")),
    label: clamp(input.label || "Abrir", 80),
    emoji: clamp(input.emoji || "", 80),
    url: normalizeUrl(input.url),
    style: normalizeStyle(input.style),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now()
  };
}

function normalizeStyle(style) {
  const value = String(style || "link").toLowerCase().trim();
  return ["link", "primary", "secondary", "success", "danger"].includes(value) ? value : "link";
}

function normalizeColor(value) {
  const raw = String(value || "").trim();
  const color = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_PANEL.visual.color;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? raw : "";
  } catch {
    return "";
  }
}

function clamp(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  DEFAULT_PANEL,
  PanelStore,
  normalizeColor
};
