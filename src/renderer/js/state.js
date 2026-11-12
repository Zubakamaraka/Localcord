// Общее состояние приложения
'use strict';

// В браузере (или будущей Android-версии) нет Electron — даём заглушки,
// чтобы интерфейс работал хотя бы в режиме «подключиться к серверу».
const browserApi = (() => {
  const KEY = 'localcord-settings';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const merge = (a, b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
    const o = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k], v) : v;
    return o;
  };
  const defaults = {
    onboarded: false,
    profile: { clientId: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2), username: '', color: '#5865f2', avatar: null, frame: null, font: null },
    mode: null, lastServer: null, servers: [],
    host: { name: 'Сервер LocalCord', port: 3000, password: '', autoStart: true, maxFileMB: 4096 },
    voice: { inputId: 'default', outputId: 'default', noiseSuppression: true, echoCancellation: true, autoGainControl: true, quality: '1080p30', shareAudio: false, hwEncode: true, volumes: {}, localMutes: {} },
    app: { closeToTray: true, startWithWindows: false, notifications: true, sounds: true, lang: null, checkUpdates: true, lastUpdateCheck: 0 },
    ui: { showMembers: true, collapsed: {}, theme: 'graphite', accent: null, scale: 100 },
  };
  const noop = () => {};
  const unsupported = async () => ({ ok: false, error: 'unsupported' });
  return {
    browser: true,
    window: { minimize: noop, maximize: noop, close: noop, show: noop, flash: noop, isMaximized: async () => false, onMaximized: () => noop },
    store: {
      get: async () => merge(defaults, read()),
      set: async (patch) => { const v = merge(merge(defaults, read()), patch); localStorage.setItem(KEY, JSON.stringify(v)); return v; },
    },
    app: {
      info: async () => ({ version: '2.2.0', platform: 'browser', packaged: false }),
      setLoginItem: async () => false, uninstall: unsupported,
      openExternal: url => window.open(url, '_blank', 'noopener'),
      showItem: noop, quit: noop,
      download: url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); },
      onDownload: () => noop,
    },
    screen: { sources: async () => null, select: async () => true },
    host: { start: unsupported, stop: unsupported, apply: unsupported, remove: unsupported, status: async () => ({ running: false, addresses: [] }), update: unsupported, openData: noop },
    net: { addresses: async () => [], discover: async () => [], canDiscover: false },
    firewall: { status: async () => ({ supported: false, allowed: true }), allow: unsupported },
    update: {
      download: unsupported, install: unsupported, fetch: unsupported, onProgress: () => noop,
      // в браузере и на телефоне список выпусков читаем с GitHub напрямую (ставит APK сам пользователь)
      list: async () => {
        try {
          const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, { headers: { Accept: 'application/vnd.github+json' } });
          if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
          const pick = (assets, re) => { const a = assets.find(x => re.test(x.name)); return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null; };
          const releases = (await r.json()).filter(x => !x.draft && /^v?\d+\.\d+\.\d+/.test(x.tag_name || '')).map(x => ({
            tag: x.tag_name, version: x.tag_name.replace(/^v/i, ''), date: x.published_at, notes: String(x.body || '').slice(0, 4000),
            prerelease: !!x.prerelease, page: x.html_url,
            exe: pick(x.assets || [], /^LocalCord-Setup-\d.*\.exe$/i), apk: pick(x.assets || [], /^LocalCord-\d.*\.apk$/i),
          }));
          return { ok: true, current: (await App.api.app.info()).version, releases };
        } catch (e) { return { ok: false, error: e.message }; }
      },
    },
  };
})();

// Репозиторий и страницы: отсюда берутся обновления, установщик и APK
const GITHUB_REPO = 'Zubakamaraka/Localcord';
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const SITE_URL = 'https://zubakamaraka.github.io/Localcord/';

const App = {
  api: window.electronAPI || (IS_ANDROID ? makeAndroidApi(browserApi) : browserApi),
  settings: null,
  info: null,

  // подключение
  socket: null,
  address: null,      // 'ip:port'
  base: null,         // 'http://ip:port'
  server: null,       // информация о сервере
  me: null,           // { id, clientId, username, color, isHost, token }
  connected: false,
  own: false,         // подключены к серверу, который запущен в этом же приложении

  // данные сервера
  channels: [],
  users: [],
  profiles: {},       // clientId -> { username, color, avatar }

  // интерфейс
  currentChannel: null,
  unread: {},         // channelId -> число
  typing: {},         // channelId -> { clientId: { name, until } }

  async saveSettings(patch) {
    this.settings = await this.api.store.set(patch);
    return this.settings;
  },

  channel(id) { return this.channels.find(c => c.id === id) || null; },

  profileOf(clientId, fallback = {}) {
    const p = this.profiles[clientId] || {};
    return { username: p.username || fallback.username || '?', color: p.color || fallback.color, avatar: p.avatar || null, frame: p.frame || null, font: p.font || null };
  },

  fileUrl(id, download = false) {
    return `${this.base}/files/${encodeURIComponent(id)}?t=${encodeURIComponent(this.me?.token || '')}${download ? '&dl=1' : ''}`;
  },

  isHostMode() { return this.settings?.mode === 'host'; },
};
