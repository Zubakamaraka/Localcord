// Профиль и настройки — один JSON-файл в папке пользователя.
// Пароли серверов шифруются средствами Windows (DPAPI через safeStorage).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const DEFAULTS = () => ({
  onboarded: false,
  profile: {
    clientId: crypto.randomUUID(),
    username: '',
    color: '#5865f2',
    avatar: null,
  },
  mode: null,               // 'host' | 'client'
  lastServer: null,         // 'ip:port'
  servers: [],              // [{ address, name, password, lastUsed }]
  host: {
    name: 'Сервер LocalCord',
    port: 3000,
    password: '',
    autoStart: true,
    maxFileMB: 4096,
  },
  voice: {
    inputId: 'default',
    outputId: 'default',
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    quality: '1080p30',
    shareAudio: false,
    volumes: {},             // clientId -> 0..2
    localMutes: {},          // clientId -> true
  },
  app: {
    closeToTray: true,
    startWithWindows: false,
    notifications: true,
    sounds: true,
  },
  ui: {
    showMembers: true,
    collapsed: {},
    theme: 'graphite',
    accent: null,
    scale: 100,
  },
});

const SECRET_PATHS = [['host', 'password']];

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function enc(s) {
  if (!s) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64');
  } catch { /* ignore */ }
  return s;
}

function dec(s) {
  if (!s || typeof s !== 'string') return '';
  if (!s.startsWith('enc:')) return s;
  try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return ''; }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* первый запуск */ }
  cache = deepMerge(DEFAULTS(), raw);
  // расшифровка
  for (const [a, b] of SECRET_PATHS) cache[a][b] = dec(cache[a][b]);
  cache.servers = (cache.servers || []).map(s => ({ ...s, password: dec(s.password) }));
  return cache;
}

function persist() {
  const data = JSON.parse(JSON.stringify(cache));
  for (const [a, b] of SECRET_PATHS) data[a][b] = enc(data[a][b]);
  data.servers = data.servers.map(s => ({ ...s, password: enc(s.password) }));
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(f + '.tmp', f);
}

function get() {
  return JSON.parse(JSON.stringify(load()));
}

function set(patch) {
  load();
  cache = deepMerge(cache, patch);
  persist();
  return get();
}

module.exports = { get, set, file };
