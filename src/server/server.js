// =============================================================
//  LocalCord — сервер (чат, вложения, сигналинг WebRTC)
//  Работает внутри приложения у хоста, либо отдельно:
//    node src/server/standalone.js
// =============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const MAX_TEXT = 4000;             // символов в сообщении
const HISTORY_LIMIT = 1000;        // сообщений на канал хранится на диске
const HISTORY_PAGE = 50;           // сообщений за одну подгрузку
const ORPHAN_UPLOAD_MS = 60 * 60 * 1000; // загруженные, но не отправленные файлы
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 12;               // сообщений за окно
const COLORS = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#1abc9c'];

const DEFAULT_CHANNELS = [
  { id: 'general', name: 'общий', type: 'text' },
  { id: 'games', name: 'игры', type: 'text' },
  { id: 'media', name: 'мемы-и-скрины', type: 'text' },
  { id: 'voice-main', name: 'Общий голосовой', type: 'voice' },
  { id: 'voice-games', name: 'Игровой', type: 'voice' },
];

function rid(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function cleanName(s, max = 32) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : COLORS[Math.floor(Math.random() * COLORS.length)];
}

function cleanAvatar(a) {
  if (typeof a !== 'string') return null;
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a)) return null;
  if (a.length > 200 * 1024) return null;
  return a;
}

function cleanFileName(name) {
  let n = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!n || n === '.' || n === '..') n = 'file';
  return n.slice(0, 180);
}

// Простое атомарное сохранение JSON с отложенной записью
class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.data = fallback;
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* файла ещё нет */ }
  }
  save(delay = 800) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[LocalCord] Не удалось сохранить', this.file, e.message);
    }
  }
}

/**
 * Запуск сервера.
 * @param {object} opts
 * @param {number} [opts.port=3000]
 * @param {string} [opts.host='0.0.0.0']
 * @param {string} [opts.name='LocalCord']
 * @param {string} [opts.password='']
 * @param {string} opts.dataDir          папка для истории и вложений
 * @param {string} [opts.appVersion]     версия приложения хоста
 * @param {string} [opts.installerPath]  установщик для раздачи обновлений
 * @param {number} [opts.maxFileMB=4096]
 * @param {boolean} [opts.persist=true]  хранить историю на диске
 * @param {function} [opts.log]
 */
async function createServer(opts = {}) {
  const cfg = {
    port: 3000,
    host: '0.0.0.0',
    name: 'LocalCord',
    password: '',
    appVersion: '0.0.0',
    installerPath: null,
    maxFileMB: 4096,
    persist: true,
    rateMax: RATE_MAX,
    log: (...a) => console.log('[LocalCord]', ...a),
    ...opts,
  };
  if (!cfg.dataDir) throw new Error('dataDir is required');

  const dirs = {
    root: cfg.dataDir,
    messages: path.join(cfg.dataDir, 'messages'),
    uploads: path.join(cfg.dataDir, 'uploads'),
  };
  for (const d of Object.values(dirs)) await fsp.mkdir(d, { recursive: true });

  // ---------- состояние ----------
  const channelsFile = new JsonFile(path.join(dirs.root, 'channels.json'), DEFAULT_CHANNELS.map(c => ({ ...c })));
  const profilesFile = new JsonFile(path.join(dirs.root, 'profiles.json'), {});
  const uploadsFile = new JsonFile(path.join(dirs.root, 'uploads.json'), {});

  const channels = new Map(); // id -> { id, name, type, members?: Map }
  for (const c of channelsFile.data) {
    channels.set(c.id, { id: c.id, name: c.name, type: c.type, members: c.type === 'voice' ? new Map() : undefined });
  }

  const histories = new Map(); // channelId -> JsonFile([...messages])
  function history(chId) {
    let h = histories.get(chId);
    if (!h) {
      h = new JsonFile(path.join(dirs.messages, `${chId}.json`), []);
      if (!Array.isArray(h.data)) h.data = [];
      histories.set(chId, h);
    }
    return h;
  }

  const users = new Map();   // socketId -> user
  const uploads = uploadsFile.data; // fileId -> meta

  function saveChannels() {
    channelsFile.data = [...channels.values()].map(c => ({ id: c.id, name: c.name, type: c.type }));
    if (cfg.persist) channelsFile.save();
  }

  function channelList() {
    return [...channels.values()].map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      members: c.type === 'voice' ? [...c.members.values()] : undefined,
    }));
  }

  function publicUser(u) {
    return {
      id: u.id,
      clientId: u.clientId,
      username: u.username,
      color: u.color,
      isHost: u.isAdmin,
      voiceChannel: u.voiceChannel || null,
    };
  }

  function userList() {
    return [...users.values()].map(publicUser);
  }

  function profilesPublic() {
    return profilesFile.data;
  }

  // ---------- HTTP ----------
  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LC-Token, X-LC-Name, X-LC-Mime');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  function json(res, code, obj) {
    cors(res);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  function tokenUser(token) {
    if (!token) return null;
    for (const u of users.values()) if (u.token === token) return u;
    return null;
  }

  function installerAvailable() {
    try {
      return !!(cfg.installerPath && fs.statSync(cfg.installerPath).isFile());
    } catch { return false; }
  }

  function serverInfo() {
    return {
      app: 'localcord',
      name: cfg.name,
      version: cfg.appVersion,
      locked: !!cfg.password,
      users: users.size,
      update: installerAvailable(),
      maxFileMB: cfg.maxFileMB,
    };
  }

  async function handleUpload(req, res, url) {
    const reject = (code, body) => {
      // тело запроса не читаем — закрываем соединение после ответа
      res.setHeader('Connection', 'close');
      json(res, code, body);
      req.resume();
    };
    const user = tokenUser(req.headers['x-lc-token']);
    if (!user) return reject(401, { error: 'unauthorized' });

    const maxBytes = cfg.maxFileMB * 1024 * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBytes) return reject(413, { error: 'too-large', maxFileMB: cfg.maxFileMB });

    let name = 'file';
    try { name = cleanFileName(decodeURIComponent(req.headers['x-lc-name'] || url.searchParams.get('name') || 'file')); } catch { /* ignore */ }
    const mime = String(req.headers['x-lc-mime'] || 'application/octet-stream').slice(0, 100);
    const id = rid(12);
    const file = path.join(dirs.uploads, id);
    const out = fs.createWriteStream(file);
    let size = 0;
    let aborted = false;

    const fail = (code, err) => {
      if (aborted) return;
      aborted = true;
      out.destroy();
      fs.rm(file, { force: true }, () => {});
      if (!res.headersSent) { res.setHeader('Connection', 'close'); json(res, code, { error: err }); }
    };

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(413, 'too-large');
        req.destroy();
      }
    });
    req.on('aborted', () => fail(400, 'aborted'));
    out.on('error', () => fail(500, 'write-failed'));
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      uploads[id] = { id, name, size, mime, owner: user.token, ts: Date.now(), attached: false };
      if (cfg.persist) uploadsFile.save();
      json(res, 200, { id, name, size, mime });
    });
  }

  function handleFile(req, res, id, url) {
    const meta = uploads[id];
    const user = tokenUser(url.searchParams.get('t'));
    if (!user) { cors(res); res.writeHead(401); return res.end(); }
    if (!meta) { cors(res); res.writeHead(404); return res.end(); }
    const file = path.join(dirs.uploads, id);
    fs.stat(file, (err, st) => {
      if (err) { cors(res); res.writeHead(404); return res.end(); }
      cors(res);
      const inline = /^(image|video|audio)\//.test(meta.mime) && url.searchParams.get('dl') !== '1';
      const headers = {
        'Content-Type': meta.mime,
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      };
      // Поддержка Range — перемотка видео и докачка
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]);
        let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
        if (start < 0) start = 0;
        if (end >= st.size) end = st.size - 1;
        if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    });
  }

  function handleInstaller(req, res) {
    if (!installerAvailable()) { cors(res); res.writeHead(404); return res.end(); }
    const st = fs.statSync(cfg.installerPath);
    cors(res);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="LocalCord-Setup-${cfg.appVersion}.exe"`,
    });
    fs.createReadStream(cfg.installerPath).pipe(res);
  }

  const httpServer = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    const p = url.pathname;
    if (req.method === 'GET' && p === '/info') return json(res, 200, serverInfo());
    if (req.method === 'POST' && p === '/upload') return handleUpload(req, res, url);
    if (req.method === 'GET' && p.startsWith('/files/')) return handleFile(req, res, p.split('/')[2] || '', url);
    if (req.method === 'GET' && p === '/update/installer') return handleInstaller(req, res);
    if (req.method === 'GET' && p === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`LocalCord server "${cfg.name}" v${cfg.appVersion} работает.\nПодключайтесь через приложение LocalCord.`);
    }
    res.writeHead(404); res.end();
  });

  // ---------- Socket.IO ----------
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e6, // 1 МБ на пакет — файлы идут через HTTP
    pingInterval: 10000,
    pingTimeout: 15000,
  });

  function broadcastChannels() { io.to('authed').emit('channels', channelList()); }
  function broadcastUsers() { io.to('authed').emit('users', userList()); }

  function deleteUploadFiles(attachments = []) {
    for (const a of attachments) {
      for (const fid of [a.id, a.thumbId]) {
        if (!fid || !uploads[fid]) continue;
        delete uploads[fid];
        fs.rm(path.join(dirs.uploads, fid), { force: true }, () => {});
      }
    }
    if (cfg.persist) uploadsFile.save();
  }

  function leaveVoice(socket) {
    const user = users.get(socket.id);
    if (!user || !user.voiceChannel) return;
    const ch = channels.get(user.voiceChannel);
    if (ch && ch.members) {
      ch.members.delete(socket.id);
      io.to(`voice:${ch.id}`).emit('voice-user-left', { socketId: socket.id, channel: ch.id });
    }
    socket.leave(`voice:${user.voiceChannel}`);
    user.voiceChannel = null;
    broadcastChannels();
    broadcastUsers();
  }

  function voiceMember(socketId) {
    const u = users.get(socketId);
    if (!u || !u.voiceChannel) return null;
    return channels.get(u.voiceChannel)?.members.get(socketId) || null;
  }

  io.on('connection', socket => {
    const addr = socket.handshake.address;
    let rate = [];

    socket.on('join', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      data = data || {};
      if (users.has(socket.id)) return reply({ ok: true });
      if (cfg.password && !safeEqual(data.password || '', cfg.password)) {
        reply({ ok: false, error: 'bad-password' });
        return setTimeout(() => socket.disconnect(true), 200);
      }
      const username = cleanName(data.username, 32) || 'Гость';
      const clientId = cleanName(data.clientId, 64) || rid();
      const user = {
        id: socket.id,
        clientId,
        username,
        color: cleanColor(data.color),
        token: rid(18),
        isAdmin: isLoopback(addr),
        voiceChannel: null,
      };
      users.set(socket.id, user);
      profilesFile.data[clientId] = { username: user.username, color: user.color, avatar: cleanAvatar(data.avatar) };
      if (cfg.persist) profilesFile.save();
      socket.join('authed');
      cfg.log(`+ ${username} (${addr})`);

      reply({
        ok: true,
        me: { ...publicUser(user), token: user.token },
        server: serverInfo(),
        channels: channelList(),
        users: userList(),
        profiles: profilesPublic(),
      });
      socket.broadcast.to('authed').emit('profile', { clientId, profile: profilesFile.data[clientId] });
      broadcastUsers();
    });

    // все остальные события — только после входа
    const on = (event, handler) => socket.on(event, (...args) => {
      const user = users.get(socket.id);
      if (!user) return;
      try { handler(user, ...args); } catch (e) { cfg.log('handler error', event, e.message); }
    });

    on('profile-update', (user, data = {}) => {
      user.username = cleanName(data.username, 32) || user.username;
      user.color = cleanColor(data.color || user.color);
      profilesFile.data[user.clientId] = { username: user.username, color: user.color, avatar: cleanAvatar(data.avatar) };
      if (cfg.persist) profilesFile.save();
      io.to('authed').emit('profile', { clientId: user.clientId, profile: profilesFile.data[user.clientId] });
      if (user.voiceChannel) {
        const m = voiceMember(socket.id);
        if (m) { m.username = user.username; m.color = user.color; }
        broadcastChannels();
      }
      broadcastUsers();
    });

    on('history', (user, { channel, before } = {}, ack) => {
      if (typeof ack !== 'function') return;
      const ch = channels.get(channel);
      if (!ch || ch.type !== 'text') return ack({ messages: [], hasMore: false });
      const all = history(channel).data;
      let end = all.length;
      if (before) {
        const idx = all.findIndex(m => m.id === before);
        if (idx >= 0) end = idx;
      }
      const start = Math.max(0, end - HISTORY_PAGE);
      ack({ messages: all.slice(start, end), hasMore: start > 0 });
    });

    on('message', (user, data = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const ch = channels.get(data.channel);
      if (!ch || ch.type !== 'text') return reply({ ok: false, error: 'no-channel' });

      const now = Date.now();
      rate = rate.filter(t => now - t < RATE_WINDOW_MS);
      if (rate.length >= cfg.rateMax) return reply({ ok: false, error: 'rate' });
      rate.push(now);

      const text = String(data.text || '').slice(0, MAX_TEXT);
      const attachments = [];
      for (const a of (Array.isArray(data.attachments) ? data.attachments.slice(0, 10) : [])) {
        const meta = uploads[a && a.id];
        if (!meta || meta.owner !== user.token || meta.attached) continue;
        meta.attached = true;
        const att = { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime };
        const thumb = uploads[a.thumbId];
        if (thumb && thumb.owner === user.token && !thumb.attached) { thumb.attached = true; att.thumbId = thumb.id; }
        if (Number.isFinite(a.w) && Number.isFinite(a.h)) { att.w = Math.round(a.w); att.h = Math.round(a.h); }
        attachments.push(att);
      }
      if (!text.trim() && !attachments.length) return reply({ ok: false, error: 'empty' });
      if (attachments.length && cfg.persist) uploadsFile.save();

      const msg = {
        id: `${now.toString(36)}-${rid(4)}`,
        channel: ch.id,
        author: { clientId: user.clientId, username: user.username, color: user.color },
        text,
        attachments,
        ts: now,
      };
      const h = history(ch.id);
      h.data.push(msg);
      if (h.data.length > HISTORY_LIMIT) {
        const removed = h.data.splice(0, h.data.length - HISTORY_LIMIT);
        removed.forEach(m => deleteUploadFiles(m.attachments));
      }
      if (cfg.persist) h.save();
      io.to('authed').emit('message', msg);
      reply({ ok: true, id: msg.id });
    });

    on('message-delete', (user, { channel, id } = {}) => {
      const ch = channels.get(channel);
      if (!ch || ch.type !== 'text') return;
      const h = history(ch.id);
      const idx = h.data.findIndex(m => m.id === id);
      if (idx < 0) return;
      const msg = h.data[idx];
      if (msg.author.clientId !== user.clientId && !user.isAdmin) return;
      h.data.splice(idx, 1);
      deleteUploadFiles(msg.attachments);
      if (cfg.persist) h.save();
      io.to('authed').emit('message-deleted', { channel: ch.id, id });
    });

    on('typing', (user, { channel } = {}) => {
      if (!channels.has(channel)) return;
      socket.broadcast.to('authed').emit('typing', { channel, clientId: user.clientId, username: user.username });
    });

    // ----- управление каналами (только хост) -----
    on('channel-create', (user, { name, type } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!user.isAdmin) return reply({ ok: false, error: 'forbidden' });
      type = type === 'voice' ? 'voice' : 'text';
      let n = cleanName(name, 40);
      if (type === 'text') n = n.toLowerCase().replace(/\s+/g, '-');
      if (!n) return reply({ ok: false, error: 'name' });
      const id = `${type === 'voice' ? 'v' : 't'}-${rid(5)}`;
      channels.set(id, { id, name: n, type, members: type === 'voice' ? new Map() : undefined });
      saveChannels();
      broadcastChannels();
      reply({ ok: true, id });
    });

    on('channel-rename', (user, { id, name } = {}) => {
      const ch = channels.get(id);
      if (!user.isAdmin || !ch) return;
      let n = cleanName(name, 40);
      if (ch.type === 'text') n = n.toLowerCase().replace(/\s+/g, '-');
      if (!n) return;
      ch.name = n;
      saveChannels();
      broadcastChannels();
    });

    on('channel-delete', (user, { id } = {}) => {
      const ch = channels.get(id);
      if (!user.isAdmin || !ch) return;
      if ([...channels.values()].filter(c => c.type === ch.type).length <= 1) return; // последний канал не удаляем
      if (ch.type === 'voice') {
        for (const sid of ch.members.keys()) {
          const s = io.sockets.sockets.get(sid);
          if (s) leaveVoice(s);
        }
      } else {
        const h = history(id);
        h.data.forEach(m => deleteUploadFiles(m.attachments));
        histories.delete(id);
        fs.rm(path.join(dirs.messages, `${id}.json`), { force: true }, () => {});
      }
      channels.delete(id);
      saveChannels();
      broadcastChannels();
    });

    // ----- голос -----
    on('voice-join', (user, { channel, muted, deafened } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const ch = channels.get(channel);
      if (!ch || ch.type !== 'voice') return reply({ ok: false });
      if (user.voiceChannel === ch.id) return reply({ ok: true, peers: [...ch.members.values()].filter(m => m.socketId !== socket.id) });
      leaveVoice(socket);

      const member = {
        socketId: socket.id,
        clientId: user.clientId,
        username: user.username,
        color: user.color,
        muted: !!muted,
        deafened: !!deafened,
        stream: null,
      };
      const peers = [...ch.members.values()];
      ch.members.set(socket.id, member);
      user.voiceChannel = ch.id;
      socket.join(`voice:${ch.id}`);
      socket.to(`voice:${ch.id}`).emit('voice-user-joined', { channel: ch.id, member });
      reply({ ok: true, peers });
      broadcastChannels();
      broadcastUsers();
    });

    on('voice-leave', () => leaveVoice(socket));

    on('voice-state', (user, { muted, deafened } = {}) => {
      const m = voiceMember(socket.id);
      if (!m) return;
      m.muted = !!muted;
      m.deafened = !!deafened;
      broadcastChannels();
    });

    on('stream-start', (user, { streamId, quality, audio } = {}) => {
      const m = voiceMember(socket.id);
      if (!m) return;
      m.stream = { streamId: cleanName(streamId, 100), quality: cleanName(quality, 20), audio: !!audio, since: Date.now() };
      broadcastChannels();
      socket.to(`voice:${user.voiceChannel}`).emit('stream-started', { socketId: socket.id, stream: m.stream });
    });

    on('stream-stop', user => {
      const m = voiceMember(socket.id);
      if (!m || !m.stream) return;
      m.stream = null;
      broadcastChannels();
      socket.to(`voice:${user.voiceChannel}`).emit('stream-stopped', { socketId: socket.id });
    });

    // Пересылка сигналов WebRTC — только между участниками одного голосового канала
    on('signal', (user, { to, data } = {}) => {
      const target = users.get(to);
      if (!target || !user.voiceChannel || target.voiceChannel !== user.voiceChannel) return;
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (!user) return;
      leaveVoice(socket);
      users.delete(socket.id);
      cfg.log(`- ${user.username}`);
      broadcastUsers();
    });
  });

  // Уборка загруженных, но так и не отправленных файлов
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, meta] of Object.entries(uploads)) {
      if (!meta.attached && now - meta.ts > ORPHAN_UPLOAD_MS) {
        delete uploads[id];
        fs.rm(path.join(dirs.uploads, id), { force: true }, () => {});
        changed = true;
      }
    }
    if (changed && cfg.persist) uploadsFile.save();
  }, 10 * 60 * 1000);
  cleanupTimer.unref?.();

  await new Promise((resolve, reject) => {
    const onErr = err => reject(err);
    httpServer.once('error', onErr);
    httpServer.listen(cfg.port, cfg.host, () => {
      httpServer.off('error', onErr);
      resolve();
    });
  });

  const port = httpServer.address().port;
  cfg.log(`Сервер "${cfg.name}" запущен на порту ${port}`);

  return {
    port,
    info: serverInfo,
    setOptions(patch = {}) {
      if ('name' in patch) cfg.name = cleanName(patch.name, 40) || cfg.name;
      if ('password' in patch) cfg.password = String(patch.password || '');
      if ('rateMax' in patch) cfg.rateMax = Number(patch.rateMax) || RATE_MAX;
      if ('maxFileMB' in patch) cfg.maxFileMB = Math.max(1, Number(patch.maxFileMB) || cfg.maxFileMB);
      io.to('authed').emit('server-info', serverInfo());
    },
    async close() {
      clearInterval(cleanupTimer);
      if (cfg.persist) {
        channelsFile.flush();
        profilesFile.flush();
        uploadsFile.flush();
        for (const h of histories.values()) if (h.timer) h.flush();
      }
      // без disconnectSockets: клиенты увидят обрыв связи и сами переподключатся, когда сервер вернётся
      const closed = new Promise(r => io.close(() => r()));
      // не ждём «висящие» keep-alive соединения (загрузки/скачивания) — рвём их
      httpServer.closeAllConnections?.();
      await closed;
    },
  };
}

module.exports = { createServer, DEFAULT_CHANNELS };
