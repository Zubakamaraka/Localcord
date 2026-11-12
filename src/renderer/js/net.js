// Связь с сервером (Socket.IO)
'use strict';

const Net = {
  joinedOnce: false,
  seq: 0,

  isLocal(address) { return /^(127\.0\.0\.1|localhost)(:|$)/.test(address || ''); },

  /**
   * Это адрес сервера, запущенного в этом же приложении? Тогда входим как владелец:
   * без пароля и с правами хоста — по любому из своих адресов, а не только по 127.0.0.1.
   */
  ownInfo(address, st) {
    if (!st || !st.running) return null;
    const m = /^(.*):(\d+)$/.exec(address || '');
    if (!m || Number(m[2]) !== Number(st.port)) return null;
    const mine = ['127.0.0.1', 'localhost', ...(st.addresses || []).map(a => a.address)];
    return mine.includes(m[1]) ? st : null;
  },

  /** Подключиться. Возвращает { ok } или { ok:false, error } */
  async connect(address, password = '') {
    this.disconnect({ keepScreen: true });
    address = normalizeAddress(address);
    const base = `http://${address}`;
    App.address = address;
    App.base = base;
    App.own = false;
    this.password = password;
    this.joinedOnce = false;
    const seq = ++this.seq;
    let own = null;
    try { own = this.ownInfo(address, await App.api.host.status()); } catch { /* нет встроенного сервера */ }
    if (seq !== this.seq) return { ok: false, error: 'cancelled' }; // пока спрашивали статус, подключение отменили или начали другое

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

      socket.on('connect', async () => {
        const p = App.settings.profile;
        // сервер мог перезапуститься с новым секретом владельца — спрашиваем заново при каждом входе
        if (own) { try { own = this.ownInfo(address, await App.api.host.status()) || own; } catch { /* ignore */ } }
        socket.emit('join', {
          username: p.username, color: p.color, avatar: p.avatar, frame: p.frame, font: p.font, clientId: p.clientId,
          password: this.password, adminKey: own ? own.adminKey : undefined, clientVersion: App.info.version,
        }, async (res) => {
          if (!res || !res.ok) {
            this.disconnect({ keepScreen: true });
            return done({ ok: false, error: res?.error || 'unreachable' });
          }
          const first = !this.joinedOnce;
          this.joinedOnce = true;
          App.own = !!own && (!own.id || !res.server.id || own.id === res.server.id);
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
        UI.banner('conn', { kind: 'warn', html: `<span class="spinner"></span><span class="grow">${t('Связь с сервером потеряна. Переподключаемся…')}</span>` });
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

    // запоминаем сервер (свой собственный в список «чужих» не попадает)
    const own = App.own;
    const servers = (App.settings.servers || []).filter(s => s.address !== App.address && !(res.server.id && s.id === res.server.id));
    if (!own) servers.unshift({ address: App.address, id: res.server.id || null, name: res.server.name, password: this.password, lastUsed: Date.now() });
    await App.saveSettings({ servers: servers.slice(0, 12), lastServer: own ? App.settings.lastServer : App.address, mode: own ? 'host' : 'client' });

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
        const t0 = list.find(c => c.type === 'text');
        if (t0) UI.selectChannel(t0.id);
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
      const tm = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout);
      this.emit(event, data, r => { clearTimeout(tm); resolve(r); });
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
    this.seq++;
    if (!keepScreen) UI.setTitle();
  },
};
