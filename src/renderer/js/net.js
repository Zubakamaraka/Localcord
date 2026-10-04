// Связь с сервером (Socket.IO)
'use strict';

const Net = {
  joinedOnce: false,

  isLocal(address) { return /^(127\.0\.0\.1|localhost)(:|$)/.test(address || ''); },

  /** Подключиться. Возвращает { ok } или { ok:false, error } */
  connect(address, password = '') {
    this.disconnect({ keepScreen: true });
    address = normalizeAddress(address);
    const base = `http://${address}`;
    App.address = address;
    App.base = base;
    this.password = password;
    this.joinedOnce = false;

    return new Promise(resolve => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
      const timer = setTimeout(() => { this.disconnect({ keepScreen: true }); done({ ok: false, error: 'unreachable' }); }, 7000);

      const socket = io(base, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 6000,
      });
      App.socket = socket;

      socket.on('connect_error', () => {
        if (!this.joinedOnce) { this.disconnect({ keepScreen: true }); done({ ok: false, error: 'unreachable' }); }
      });

      socket.on('connect', () => {
        const p = App.settings.profile;
        socket.emit('join', {
          username: p.username, color: p.color, avatar: p.avatar, clientId: p.clientId,
          password: this.password, clientVersion: App.info.version,
        }, async (res) => {
          if (!res || !res.ok) {
            this.disconnect({ keepScreen: true });
            return done({ ok: false, error: res?.error || 'unreachable' });
          }
          const first = !this.joinedOnce;
          this.joinedOnce = true;
          await this.onJoined(res, first);
          done({ ok: true });
        });
      });

      socket.on('disconnect', reason => {
        if (!this.joinedOnce) return;
        App.connected = false;
        Voice.onDisconnected();
        UI.setTitle();
        if (reason === 'io client disconnect') return;
        // сервер сам закрыл соединение (например, перезапуск) — пробуем вернуться
        if (reason === 'io server disconnect') setTimeout(() => { if (App.socket === socket) socket.connect(); }, 2000);
        UI.banner('conn', { kind: 'warn', html: `<span class="spinner"></span><span class="grow">Связь с сервером потеряна. Переподключаемся…</span>` });
      });

      this.bindEvents(socket);
    });
  },

  async onJoined(res, first) {
    App.connected = true;
    App.me = res.me;
    App.server = res.server;
    App.channels = res.channels;
    App.users = res.users;
    App.profiles = res.profiles || {};
    UI.banner('conn', null);

    // запоминаем сервер
    const isLocal = this.isLocal(App.address);
    const servers = (App.settings.servers || []).filter(s => s.address !== App.address);
    if (!isLocal) servers.unshift({ address: App.address, name: res.server.name, password: this.password, lastUsed: Date.now() });
    await App.saveSettings({ servers: servers.slice(0, 12), lastServer: isLocal ? App.settings.lastServer : App.address, mode: isLocal ? 'host' : 'client' });

    UI.showApp();
    UI.setTitle();
    UI.renderAll();
    if (first) {
      Sounds.play('connect');
      const firstText = App.channels.find(c => c.type === 'text');
      const target = App.channel(App.currentChannel) ? App.currentChannel : firstText?.id;
      Chat.resetCache();
      if (target) UI.selectChannel(target);
    } else {
      // переподключение — обновляем открытый канал и возвращаемся в голос
      Chat.resetCache();
      if (App.currentChannel) UI.selectChannel(App.currentChannel, { force: true });
      Voice.onReconnected();
    }
    UI.checkUpdate();
  },

  bindEvents(socket) {
    socket.on('channels', list => {
      App.channels = list;
      if (App.currentChannel && !App.channel(App.currentChannel)) {
        const t = list.find(c => c.type === 'text');
        if (t) UI.selectChannel(t.id);
      }
      UI.renderSidebar();
      Voice.onChannels();
    });
    socket.on('users', list => { App.users = list; UI.renderMembers(); });
    socket.on('profile', ({ clientId, profile }) => {
      App.profiles[clientId] = profile;
      UI.renderMembers();
      UI.renderSidebar();
      Chat.refreshAuthor(clientId);
      Voice.onChannels();
    });
    socket.on('server-info', info => { App.server = info; UI.setTitle(); UI.renderSidebarHeader(); });
    socket.on('message', msg => Chat.onMessage(msg));
    socket.on('message-deleted', d => Chat.onDeleted(d));
    socket.on('typing', d => Chat.onTyping(d));

    socket.on('voice-user-joined', d => Voice.onUserJoined(d));
    socket.on('voice-user-left', d => Voice.onUserLeft(d));
    socket.on('signal', d => Voice.onSignal(d));
    socket.on('stream-started', d => Voice.onStreamStarted(d));
    socket.on('stream-stopped', d => Voice.onStreamStopped(d));
  },

  emit(event, data, ack) {
    if (!App.socket || !App.connected) { if (ack) ack({ ok: false, error: 'offline' }); return false; }
    if (ack) App.socket.emit(event, data, ack); else App.socket.emit(event, data);
    return true;
  },

  request(event, data, timeout = 8000) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout);
      this.emit(event, data, r => { clearTimeout(t); resolve(r); });
    });
  },

  disconnect({ keepScreen = false } = {}) {
    if (App.socket) {
      Voice.leave({ silent: true });
      const s = App.socket;
      App.socket = null;
      s.removeAllListeners();
      s.io.removeAllListeners?.();
      s.disconnect();
    }
    App.connected = false;
    this.joinedOnce = false;
    if (!keepScreen) UI.setTitle();
  },
};
