// Отрисовка интерфейса и запуск приложения
'use strict';

const UI = {
  view: null, // 'chat' | 'voice'
  banners: new Map(),

  init() {
    $('#tb-logo').innerHTML = `${logoSvg(18)}<span>LocalCord</span>`;
    $('#win-min').innerHTML = icon('winMin', 16);
    $('#win-close').innerHTML = icon('x', 16);
    const setMax = m => { this.maximized = m; $('#win-max').innerHTML = icon(m ? 'winRestore' : 'winMax', 14); $('#win-max').title = m ? t('Восстановить') : t('Развернуть'); };
    this.setMax = setMax;
    applyStaticI18n();
    App.api.window.isMaximized().then(setMax);
    App.api.window.onMaximized(setMax);
    $('#win-min').onclick = () => App.api.window.minimize();
    $('#win-max').onclick = () => App.api.window.maximize();
    $('#win-close').onclick = () => App.api.window.close();
    if (App.api.browser) $('#win-ctrls').classList.add('hidden');
    $('#server-chev').innerHTML = icon('chevronDown', 18);
    $('#server-header').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); this.serverMenu(r.left + 10, r.bottom + 4); };

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.handleBack();
    });

    // ----- телефон: шторки, кнопка «Назад», жесты -----
    if (App.api.mobile) document.documentElement.classList.add('mobile');
    $('#nav-toggle').innerHTML = icon('menu', 22);
    $('#nav-toggle').onclick = () => this.toggleDrawer('nav');
    $('#drawer-backdrop').onclick = () => this.closeDrawers();
    if (App.api.onBack) App.api.onBack(() => { if (!this.handleBack()) App.api.minimize(); });
    let sx = null, sy = 0;
    document.addEventListener('touchstart', e => {
      const tc = e.touches[0];
      sx = tc.clientX; sy = tc.clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (sx === null || !this.isMobileLayout()) return;
      const tc = e.changedTouches[0];
      const dx = tc.clientX - sx, dy = Math.abs(tc.clientY - sy);
      const app = $('#app');
      if (dy < 60 && Math.abs(dx) > 70 && !document.querySelector('.overlay, .settings, .lightbox') && !e.target.closest('#viewer, #mini-player')) {
        if (dx > 0 && app.classList.contains('members-open')) this.closeDrawers();
        else if (dx > 0 && sx < 40) this.toggleDrawer('nav', true);
        else if (dx < 0 && app.classList.contains('nav-open')) this.closeDrawers();
        else if (dx < 0 && sx > innerWidth - 40) this.toggleDrawer('members', true);
      }
      sx = null;
    }, { passive: true });

    // всплывающие подсказки по скачиванию
    const dl = new Map();
    App.api.app.onDownload(d => {
      let tip = dl.get(d.id);
      if (d.state === 'started') { tip = toast(t('Скачивание: {name}', { name: d.name }), { timeout: 0 }); dl.set(d.id, tip); return; }
      if (d.state === 'progress' && tip) {
        const pct = d.total ? ` — ${Math.round(d.received / d.total * 100)}%` : '';
        tip.querySelector('.t-msg').textContent = t('Скачивание: {name}', { name: d.name }) + pct;
        return;
      }
      if (tip) { tip.remove(); dl.delete(d.id); }
      if (d.state === 'done') toast(t('Сохранено в «Загрузки»: {name}', { name: d.name }), { type: 'ok', timeout: 6000, action: { label: t('Показать'), onClick: () => App.api.app.showItem(d.path) } });
      if (d.state === 'failed') toast(t('Не удалось скачать {name}', { name: d.name }), { type: 'err' });
    });
  },

  /** Язык сменили в настройках: перерисовываем всё, что уже на экране */
  applyLanguage() {
    I18N.set(App.settings.app.lang || App.info.lang || I18N.detect());
    applyStaticI18n();
    if (this.setMax) this.setMax(!!this.maximized);
    Chat.initTexts();
    if (!Viewer.peerId) Viewer.el = null; // подписи кнопок просмотра пересоздадутся при следующем открытии
    this.setTitle();
    if (App.connected) {
      this.renderAll();
      if (this.view === 'chat') Chat.open(App.currentChannel);
      else Voice.renderVoiceView();
    }
  },

  isMobileLayout() { return matchMedia('(max-width: 760px)').matches; },

  toggleDrawer(which, force) {
    const app = $('#app');
    const cls = which === 'nav' ? 'nav-open' : 'members-open';
    const open = force ?? !app.classList.contains(cls);
    app.classList.remove('nav-open', 'members-open');
    if (open) app.classList.add(cls);
    $('#drawer-backdrop').classList.toggle('show', open);
    if (open && which === 'members') this.renderMembers();
  },

  closeDrawers() {
    $('#app').classList.remove('nav-open', 'members-open');
    $('#drawer-backdrop').classList.remove('show');
  },

  /** Esc на компьютере и «Назад» на телефоне: закрываем самое верхнее. false — закрывать нечего */
  handleBack() {
    if (!$('#ctx-menu').classList.contains('hidden')) { hideCtx(); return true; }
    const lb = document.querySelector('.lightbox');
    if (lb && lb._close) { lb._close(); return true; }
    const top = modalStack[modalStack.length - 1];
    if (top) { if (top.closable) top.close(); return true; }
    if (Settings.el) { Settings.close(); return true; }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return true; }
    if (Viewer.pseudoFs) { Viewer.toggleFullscreen(); return true; }
    const app = $('#app');
    if (app.classList.contains('nav-open') || app.classList.contains('members-open')) { this.closeDrawers(); return true; }
    if (Viewer.peerId && Viewer.mode === 'stage') { Viewer.toggleMini(); return true; }
    if (!$('#screen').classList.contains('hidden') && App.connected) { Screens.hide(); return true; }
    return false;
  },

  showApp() {
    $('#app').classList.remove('hidden');
  },

  setTitle() {
    const el = $('#tb-center');
    if (App.connected && App.server) {
      el.innerHTML = `<span class="dot"></span>${esc(App.server.name)} <span style="opacity:.6">· ${esc(App.own ? t('ваш сервер') : App.address)}</span>`;
    } else if (App.address && Net.joinedOnce) {
      el.innerHTML = `<span class="dot wait"></span>${t('Переподключение к {address}…', { address: esc(App.own ? t('своему серверу') : App.address) })}`;
    } else {
      el.textContent = '';
    }
  },

  renderAll() {
    this.renderRail();
    this.renderSidebarHeader();
    this.renderSidebar();
    this.renderUserPanel();
    this.renderVoicePanel();
    this.renderMembers();
    this.renderHeader();
  },

  // ---------- левая колонка серверов ----------
  async renderRail() {
    const rail = $('#rail');
    const servers = (App.settings.servers || []).slice(0, 8);
    const local = App.own;
    let st = { running: false, enabled: false };
    try { st = await App.api.host.status(); } catch { /* ignore */ }
    const hasHost = !App.api.browser && (st.running || st.enabled || st.hasData || App.isHostMode());
    rail.innerHTML = `
      <div class="rail-item logo" title="${t('LocalCord — главная')}">${logoSvg(48)}</div>
      <div class="rail-sep"></div>
      ${hasHost ? `<div class="rail-item host ${local ? 'active' : ''} ${st.running ? '' : 'off'}" data-r="host" title="${t('Мой сервер')}${st.running ? '' : ` — ${t('остановлен')}`}">${icon('server', 22)}</div>` : ''}
      ${servers.map(s => `<div class="rail-item ${!local && s.address === App.address ? 'active' : ''}" data-r="srv" data-a="${esc(s.address)}" title="${esc(s.name || s.address)}\n${esc(s.address)}">${esc(initials(s.name || 'S'))}</div>`).join('')}
      <div class="rail-item add" data-r="add" title="${t('Подключиться к серверу')}">${icon('plus', 22)}</div>
      ${App.api.browser || hasHost ? '' : `<div class="rail-item host" data-r="newhost" title="${t('Создать свой сервер')}">${icon('server', 22)}</div>`}
    `;
    rail.onclick = e => {
      const it = e.target.closest('.rail-item');
      if (!it) return;
      if (it.classList.contains('logo')) return Screens.mode();
      const r = it.dataset.r;
      if (r === 'add') return Screens.connect();
      if (r === 'newhost') return Screens.host();
      if (r === 'host') { if (!App.own) Flow.startHostAndConnect(); return; }
      if (r === 'srv' && (App.own || it.dataset.a !== App.address)) {
        const s = App.settings.servers.find(x => x.address === it.dataset.a);
        if (s) Flow.connectTo(s.address, s.password);
      }
    };
    rail.oncontextmenu = e => {
      const host = e.target.closest('.rail-item[data-r="host"]');
      if (host) {
        e.preventDefault();
        ctxMenu(e.clientX, e.clientY, [
          { type: 'label', label: App.settings.host.name },
          st.running ? { label: t('Пригласить друзей'), icon: 'link', onClick: () => this.inviteDialog({ own: true }) } : { label: t('Запустить сервер'), icon: 'power', onClick: () => Flow.startHostAndConnect() },
          { label: t('Настройки сервера'), icon: 'settings', onClick: () => Settings.open('host') },
          { type: 'sep' },
          st.running ? { label: t('Остановить сервер'), icon: 'power', danger: true, onClick: () => Settings.stopServer() } : null,
          { label: t('Удалить сервер'), icon: 'trash', danger: true, onClick: () => Settings.deleteServer() },
        ]);
        return;
      }
      const it = e.target.closest('.rail-item[data-r="srv"]');
      if (!it) return;
      e.preventDefault();
      ctxMenu(e.clientX, e.clientY, [
        { label: t('Скопировать адрес'), icon: 'copy', onClick: () => copyText(it.dataset.a) },
        { label: t('Убрать из списка'), icon: 'trash', danger: true, onClick: async () => { await App.saveSettings({ servers: App.settings.servers.filter(s => s.address !== it.dataset.a) }); this.renderRail(); } },
      ]);
    };
  },

  renderSidebarHeader() {
    $('#server-title').textContent = App.server?.name || 'LocalCord';
  },

  // ---------- каналы ----------
  renderSidebar() {
    const list = $('#channel-list');
    if (!App.connected && !App.channels.length) { list.innerHTML = ''; return; }
    const collapsed = App.settings.ui.collapsed || {};
    const isHost = App.me?.isHost;
    const cat = (key, title, type) => `<div class="cat ${collapsed[key] ? 'collapsed' : ''}" data-cat="${key}">
      <span class="chev">${icon('chevronDown', 12)}</span><span class="cat-name">${title}</span>
      ${isHost ? `<button class="cat-add" data-add="${type}" title="${t('Создать канал')}">${icon('plus', 16)}</button>` : ''}</div>`;

    let html = cat('text', t('Текстовые каналы'), 'text');
    for (const c of App.channels.filter(c => c.type === 'text')) {
      const active = App.currentChannel === c.id;
      if (collapsed.text && !active && !App.unread[c.id]) continue;
      const unread = App.unread[c.id] || 0;
      html += `<div class="chan ${active ? 'active' : ''} ${unread ? 'unread' : ''}" data-ch="${esc(c.id)}">${icon('hash', 20)}<span class="cname">${esc(c.name)}</span>${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</div>`;
    }
    html += cat('voice', t('Голосовые каналы'), 'voice');
    for (const c of App.channels.filter(c => c.type === 'voice')) {
      const active = App.currentChannel === c.id;
      const members = c.members || [];
      if (collapsed.voice && !active && !members.length) continue;
      html += `<div class="chan ${active ? 'active' : ''} ${Voice.channel === c.id ? 'connected' : ''}" data-ch="${esc(c.id)}">${icon('volume', 20)}<span class="cname">${esc(c.name)}</span></div>`;
      if (members.length) {
        html += `<div class="vmembers">`;
        for (const m of members) {
          const p = App.profileOf(m.clientId, m);
          const isMe = m.socketId === App.me?.id;
          const muted = isMe ? (Voice.muted || Voice.deafened || !Voice.localStream) : m.muted;
          const deaf = isMe ? Voice.deafened : m.deafened;
          html += `<div class="vm" data-vm="${esc(m.socketId)}">${avatarHtml(p, 24, { sid: m.socketId })}<span class="vm-name ${fontClass(p)}">${esc(p.username)}</span>
            <span class="vm-icons">${m.stream ? `<span class="live-badge">${t('В эфире')}</span>` : ''}${muted ? `<span class="red">${icon('micOff', 16)}</span>` : ''}${deaf ? `<span class="red">${icon('headphonesOff', 16)}</span>` : ''}</span></div>`;
        }
        html += `</div>`;
      }
    }
    list.innerHTML = html;
    Speak.reapply();

    list.onclick = async e => {
      const add = e.target.closest('[data-add]');
      if (add) {
        e.stopPropagation();
        const type = add.dataset.add;
        const name = await promptDialog(type === 'voice' ? t('Новый голосовой канал') : t('Новый текстовый канал'), t('Название канала'), '', { ok: t('Создать'), placeholder: type === 'voice' ? t('Например, Посиделки') : t('например, фильмы') });
        if (name) Net.emit('channel-create', { name, type });
        return;
      }
      const c = e.target.closest('.cat');
      if (c) {
        const key = c.dataset.cat;
        await App.saveSettings({ ui: { collapsed: { ...collapsed, [key]: !collapsed[key] } } });
        this.renderSidebar();
        return;
      }
      const ch = e.target.closest('.chan');
      if (ch) {
        const chan = App.channel(ch.dataset.ch);
        this.selectChannel(chan.id);
        if (chan.type === 'voice' && !Voice.channel) Voice.join(chan.id);
      }
    };
    list.oncontextmenu = e => {
      const vm = e.target.closest('.vm');
      if (vm) {
        e.preventDefault();
        const sid = vm.dataset.vm;
        const ch = App.channels.find(c => (c.members || []).some(m => m.socketId === sid));
        this.memberMenu(e.clientX, e.clientY, ch?.members.find(m => m.socketId === sid));
        return;
      }
      const ch = e.target.closest('.chan');
      if (!ch || !App.me?.isHost) return;
      e.preventDefault();
      const chan = App.channel(ch.dataset.ch);
      ctxMenu(e.clientX, e.clientY, [
        { type: 'label', label: chan.name },
        { label: t('Переименовать'), icon: 'edit', onClick: async () => { const n = await promptDialog(t('Переименовать канал'), t('Название'), chan.name); if (n) Net.emit('channel-rename', { id: chan.id, name: n }); } },
        { label: t('Удалить канал'), icon: 'trash', danger: true, onClick: async () => {
          const text = chan.type === 'text' ? t('Канал «{name}» и вся его история будут удалены.', { name: chan.name }) : t('Канал «{name}» будет удалён.', { name: chan.name });
          if (await confirmDialog(t('Удалить канал?'), text, { ok: t('Удалить'), danger: true })) Net.emit('channel-delete', { id: chan.id });
        } },
      ]);
    };
  },

  selectChannel(id, { force = false } = {}) {
    const ch = App.channel(id);
    if (!ch) return;
    const same = App.currentChannel === id && this.view === ch.type;
    App.currentChannel = id;
    delete App.unread[id];
    this.view = ch.type === 'voice' ? 'voice' : 'chat';
    $('#chat-view').classList.toggle('hidden', this.view !== 'chat');
    $('#voice-view').classList.toggle('hidden', this.view !== 'voice');
    this.closeDrawers();
    this.renderHeader();
    this.renderSidebar();
    if (this.view === 'chat') { if (!same || force) Chat.open(id, { force }); }
    else { Voice.renderVoiceView(); }
    Viewer.place();
  },

  renderHeader() {
    const ch = App.channel(App.currentChannel);
    $('#h-icon').innerHTML = ch ? icon(ch.type === 'voice' ? 'volume' : 'hash', 24) : '';
    $('#h-name').textContent = ch ? ch.name : '';
    $('#h-topic').textContent = !ch ? '' : ch.type === 'voice'
      ? t('Голосовой канал · звук и трансляции идут напрямую между участниками')
      : t('Перетащите файл или картинку в окно, чтобы отправить');
    const showMembers = App.settings.ui.showMembers;
    $('#h-actions').innerHTML = `
      <button class="icon-btn ${showMembers ? 'on' : ''}" data-h="members" title="${t('Участники')}">${icon('users', 22)}</button>
      <button class="icon-btn" data-h="invite" title="${t('Пригласить друзей')}">${icon('link', 20)}</button>`;
    $('#h-actions').onclick = async e => {
      const a = e.target.closest('[data-h]')?.dataset.h;
      if (a === 'members' && this.isMobileLayout()) { this.toggleDrawer('members'); return; }
      if (a === 'members') { await App.saveSettings({ ui: { showMembers: !App.settings.ui.showMembers } }); this.renderMembers(); this.renderHeader(); }
      if (a === 'invite') this.inviteDialog();
    };
  },

  // ---------- панель пользователя ----------
  renderUserPanel() {
    const p = App.settings.profile;
    const muted = Voice.muted || Voice.deafened;
    $('#user-panel').innerHTML = `
      <div class="me" title="${t('Мой профиль')}">${avatarHtml(p, 32, { status: true, sid: App.me?.id || 'me' })}
        <div class="me-text"><div class="me-name ${fontClass(p)}">${esc(p.username)}</div><div class="me-sub">${App.connected ? (Voice.channel ? t('В голосе') : t('В сети')) : t('Не в сети')}</div></div></div>
      <button class="icon-btn ${muted ? 'off' : ''}" data-u="mic" title="${muted ? t('Включить микрофон') : t('Выключить микрофон')}">${icon(muted ? 'micOff' : 'mic', 20)}</button>
      <button class="icon-btn ${Voice.deafened ? 'off' : ''}" data-u="deaf" title="${Voice.deafened ? t('Включить звук') : t('Выключить звук')}">${icon(Voice.deafened ? 'headphonesOff' : 'headphones', 20)}</button>
      <button class="icon-btn" data-u="settings" title="${t('Настройки')}">${icon('settings', 20)}</button>`;
    $('#user-panel').onclick = e => {
      if (e.target.closest('.me')) return Settings.open('profile');
      const a = e.target.closest('[data-u]')?.dataset.u;
      if (a === 'mic') Voice.toggleMute();
      if (a === 'deaf') Voice.toggleDeafen();
      if (a === 'settings') Settings.open();
    };
    Speak.reapply();
  },

  renderVoicePanel() {
    const el = $('#voice-panel');
    if (!Voice.channel) { el.classList.add('hidden'); el.innerHTML = ''; this.renderUserPanel(); return; }
    const ch = App.channel(Voice.channel);
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="vp-top">
        <div class="vp-info"><div class="vp-state">${icon('wifi', 16)} ${t('Голос подключён')}</div><div class="vp-chan" title="${t('Открыть канал')}">${esc(ch ? ch.name : '')}</div></div>
        <button class="icon-btn" data-p="leave" title="${t('Отключиться')}">${icon('phoneOff', 20)}</button>
      </div>
      ${Voice.canShare() ? `<div class="vp-btns">
        <button class="btn ${Voice.screen ? 'on' : ''}" data-p="share">${icon(Voice.screen ? 'screenOff' : 'screenShare', 16)} ${Voice.screen ? t('Остановить') : t('Экран')}</button>
      </div>` : ''}`;
    el.onclick = e => {
      if (e.target.closest('.vp-chan')) return this.selectChannel(Voice.channel);
      const a = e.target.closest('[data-p]')?.dataset.p;
      if (a === 'leave') Voice.leave();
      if (a === 'share') Voice.toggleShare();
    };
    this.renderUserPanel();
  },

  // ---------- участники ----------
  renderMembers() {
    const box = $('#members');
    const show = App.settings.ui.showMembers || this.isMobileLayout();
    box.classList.toggle('hidden', !show);
    if (!show) return;
    const users = App.users.slice().sort((a, b) => (b.isHost - a.isHost) || a.username.localeCompare(b.username, I18N.lang));
    const row = u => {
      const p = App.profileOf(u.clientId, u);
      const vc = u.voiceChannel ? App.channel(u.voiceChannel) : null;
      return `<div class="mem" data-cid="${esc(u.clientId)}" data-sock="${esc(u.id)}">${avatarHtml(p, 32, { status: true })}
        <div class="mem-main"><div class="mem-name"><span class="${fontClass(p)}">${esc(p.username)}</span>${u.isHost ? `<span class="crown" title="${t('Хост сервера')}">${icon('crown', 14)}</span>` : ''}</div>
        ${vc ? `<div class="mem-sub">${icon('volume', 12)} ${esc(vc.name)}</div>` : ''}</div></div>`;
    };
    const hosts = users.filter(u => u.isHost);
    const others = users.filter(u => !u.isHost);
    box.innerHTML =
      (hosts.length ? `<div class="mem-group">${t('Хост')} — ${hosts.length}</div>${hosts.map(row).join('')}` : '') +
      `<div class="mem-group">${t('В сети')} — ${others.length}</div>${others.map(row).join('')}`;
    box.oncontextmenu = e => {
      const m = e.target.closest('.mem');
      if (!m) return;
      e.preventDefault();
      const vm = Voice.member(m.dataset.sock);
      this.memberMenu(e.clientX, e.clientY, vm || { clientId: m.dataset.cid, socketId: m.dataset.sock });
    };
  },

  memberMenu(x, y, m) {
    if (!m) return;
    const p = App.profileOf(m.clientId, m);
    const isMe = m.socketId === App.me?.id || m.clientId === App.settings.profile.clientId;
    if (isMe) {
      ctxMenu(x, y, [{ type: 'label', label: p.username }, { label: t('Мой профиль'), icon: 'user', onClick: () => Settings.open('profile') }]);
      return;
    }
    const v = App.settings.voice;
    const vol = Math.round((v.volumes[m.clientId] ?? 1) * 100);
    const slider = h(`<div><div class="clabel">${t('Громкость:')} <span>${vol}%</span></div><input type="range" min="0" max="100" value="${vol}"></div>`);
    const inp = slider.querySelector('input');
    inp.oninput = () => {
      slider.querySelector('span').textContent = inp.value + '%';
      v.volumes[m.clientId] = inp.value / 100;
      Voice.applyVolumes();
    };
    inp.onchange = () => App.saveSettings({ voice: { volumes: { [m.clientId]: inp.value / 100 } } });
    const muted = !!v.localMutes[m.clientId];
    ctxMenu(x, y, [
      { type: 'label', label: p.username },
      Voice.channel ? { type: 'custom', el: slider } : null,
      { label: muted ? t('Включить звук для меня') : t('Заглушить для меня'), icon: muted ? 'speaker' : 'speakerOff', onClick: async () => {
        await App.saveSettings({ voice: { localMutes: { ...v.localMutes, [m.clientId]: !muted } } });
        Voice.applyVolumes();
        Voice.renderVoiceView();
      } },
      m.stream && Voice.channel ? { label: t('Смотреть трансляцию'), icon: 'eye', onClick: () => { this.selectChannel(Voice.channel); Voice.watch(m.socketId); } } : null,
    ]);
  },

  // ---------- меню сервера ----------
  serverMenu(x, y) {
    const isHost = App.me?.isHost;
    ctxMenu(x, y, [
      { label: t('Пригласить друзей'), icon: 'link', onClick: () => this.inviteDialog() },
      isHost ? { type: 'sep' } : null,
      isHost ? { label: t('Создать текстовый канал'), icon: 'hash', onClick: async () => { const n = await promptDialog(t('Новый текстовый канал'), t('Название канала'), '', { ok: t('Создать') }); if (n) Net.emit('channel-create', { name: n, type: 'text' }); } } : null,
      isHost ? { label: t('Создать голосовой канал'), icon: 'volume', onClick: async () => { const n = await promptDialog(t('Новый голосовой канал'), t('Название канала'), '', { ok: t('Создать') }); if (n) Net.emit('channel-create', { name: n, type: 'voice' }); } } : null,
      App.own ? { label: t('Настройки сервера'), icon: 'settings', onClick: () => Settings.open('host') } : null,
      { type: 'sep' },
      App.own ? { label: t('Остановить сервер'), icon: 'power', danger: true, onClick: () => Settings.stopServer() } : null,
      { label: t('Сменить сервер'), icon: 'logout', danger: true, onClick: () => this.switchServer() },
    ]);
  },

  switchServer() {
    Screens.mode();
  },

  async inviteDialog({ firstTime = false, own = App.own } = {}) {
    const body = h(`<div style="display:flex;flex-direction:column;gap:14px"></div>`);
    if (own) {
      const st = await App.api.host.status();
      const tags = { radmin: 'Radmin VPN', hamachi: 'Hamachi', vpn: 'VPN', lan: t('Локальная сеть') };
      body.appendChild(h(`<div class="tooltip-hint">${firstTime ? `<b style="color:var(--text-strong)">${t('Сервер запущен!')}</b> ` : ''}${t('Друзья в той же сети увидят сервер в списке автоматически. Если не видят — отправьте им адрес:')}</div>`));
      const list = h(`<div class="addr-list"></div>`);
      if (!st.addresses.length) list.appendChild(h(`<div class="empty-note">${t('Сетевых подключений не найдено. Включите Radmin VPN или подключитесь к сети.')}</div>`));
      for (const a of st.addresses) {
        const full = `${a.address}:${st.port}`;
        const row = h(`<div class="addr"><code></code><span class="tag ${a.kind}">${tags[a.kind] || a.kind}</span><button class="btn">${icon('copy', 16)} ${t('Копировать')}</button></div>`);
        row.querySelector('code').textContent = full;
        row.querySelector('button').onclick = () => copyText(full);
        list.appendChild(row);
      }
      body.appendChild(list);
      if (st.addresses.length > 1) body.appendChild(h(`<div class="tooltip-hint">${t('Это один и тот же сервер по разным сетям. Другу из другого города нужен адрес Radmin VPN, соседу по Wi-Fi — адрес локальной сети.')}</div>`));
      if (st.hasPassword) body.appendChild(h(`<div class="tooltip-hint">${icon('lock', 14)} ${t('На сервере стоит пароль — сообщите его друзьям отдельно.')}</div>`));
      const fw = await App.api.firewall.status();
      if (fw.supported && !fw.allowed) {
        const fwBox = h(`<div class="sbox" style="background:rgba(240,178,50,.12)"><div class="row">${icon('shield', 22)}<div class="grow"><b>${t('Разрешите доступ в брандмауэре')}</b><div class="tooltip-hint">${t('Иначе Windows может не пускать друзей через Radmin VPN. Потребуются права администратора.')}</div></div><button class="btn primary">${t('Разрешить')}</button></div></div>`);
        fwBox.querySelector('button').onclick = async () => {
          const r = await App.api.firewall.allow();
          if (r.ok) { fwBox.remove(); toast(t('Готово: подключения разрешены'), { type: 'ok' }); } else toast(t('Разрешение не выдано'), { type: 'err' });
        };
        body.appendChild(fwBox);
      }
    } else {
      body.appendChild(h(`<div class="tooltip-hint">${t('Отправьте другу этот адрес. В LocalCord он нажмёт «Подключиться к другу» и вставит его.')}</div>`));
      const row = h(`<div class="addr"><code></code><button class="btn">${icon('copy', 16)} ${t('Копировать')}</button></div>`);
      row.querySelector('code').textContent = App.address;
      row.querySelector('button').onclick = () => copyText(App.address);
      body.appendChild(row);
    }
    modal({ title: firstTime ? t('Сервер готов — зовите друзей') : t('Пригласить друзей'), body, buttons: [{ label: t('Готово'), kind: 'primary' }] });
  },

  // ---------- баннеры ----------
  banner(id, opts) {
    const old = this.banners.get(id);
    if (old) { old.remove(); this.banners.delete(id); }
    if (!opts) return null;
    const el = h(`<div class="banner ${opts.kind || ''}">${opts.html}</div>`);
    $('#banners').appendChild(el);
    this.banners.set(id, el);
    return el;
  },

  // ---------- обновления ----------
  /** Обновление, которое раздаёт хост (без интернета). true — предложение показано */
  checkUpdate({ manual = false } = {}) {
    const s = App.server;
    if (s && App.api.mobile && cmpVersion(s.version, App.info.version) > 0) {
      const el = this.banner('update', { html: `${icon('download', 18)}<span class="grow">${t('У хоста LocalCord <b>{version}</b>. Новая версия для Android — на странице загрузки.', { version: esc(s.version) })}</span><button class="btn" data-u>${t('Открыть')}</button><button class="btn" data-x>${icon('x', 14)}</button>` });
      el.querySelector('[data-u]').onclick = () => Settings.open('updates');
      el.querySelector('[data-x]').onclick = () => this.banner('update', null);
      return true;
    }
    if (!s || App.api.browser || !App.info.packaged) return false;
    if (cmpVersion(s.version, App.info.version) <= 0) return false;
    if (!s.update) {
      if (manual) toast(t('У хоста версия {version}, но раздать её он сейчас не может. Обновитесь в разделе «Обновления».', { version: s.version }));
      return manual;
    }
    const el = this.banner('update', { html: `${icon('download', 18)}<span class="grow">${t('Доступна новая версия LocalCord <b>{version}</b> — её раздаёт хост.', { version: esc(s.version) })}</span><div class="progress hidden"><i></i></div><button class="btn" data-u>${t('Обновить')}</button><button class="btn" data-x title="${t('Позже')}">${icon('x', 14)}</button>` });
    const btn = el.querySelector('[data-u]');
    el.querySelector('[data-x]').onclick = () => this.banner('update', null);
    let off = null;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('Загрузка…');
      const bar = el.querySelector('.progress');
      bar.classList.remove('hidden');
      off = App.api.update.onProgress(({ got, total }) => { bar.firstElementChild.style.width = (total ? got / total * 100 : 0) + '%'; });
      const r = await App.api.update.download(App.base, s.version);
      off && off();
      if (!r.ok) { btn.disabled = false; btn.textContent = t('Повторить'); toast(t('Не удалось скачать обновление'), { type: 'err' }); return; }
      bar.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = t('Установить и перезапустить');
      btn.onclick = async () => {
        const ok = await confirmDialog(t('Установить обновление?'),
          t('LocalCord {version} получен от сервера «{name}». Устанавливайте обновления только от хоста, которому доверяете. Программа перезапустится, профиль и настройки сохранятся.', { version: s.version, name: s.name }),
          { ok: t('Установить') });
        if (ok) App.api.update.install();
      };
    };
    return true;
  },

  /** Может ли программа сама скачать и поставить установщик (только установленная версия для Windows) */
  canSelfUpdate() { return !App.api.browser && App.info.packaged && App.info.platform === 'win32'; },

  /** Файл выпуска для этого устройства: APK на телефоне, установщик на компьютере */
  releaseAsset(rel) { return App.api.mobile ? rel.apk : rel.exe; },

  /** Поставить выбранный выпуск с GitHub — новее (обновление) или старее (откат) */
  async installRelease(rel) {
    const asset = this.releaseAsset(rel);
    if (!asset) return;
    const older = cmpVersion(rel.version, App.info.version) < 0;
    if (!this.canSelfUpdate()) {
      // телефон, браузер или запуск из исходников: отдаём файл на скачивание
      if (App.api.mobile) toast(t('Откроется загрузка APK. После скачивания откройте файл — новая версия встанет поверх старой.'), { timeout: 7000 });
      App.api.app.openExternal(asset.url);
      return;
    }
    const text = older
      ? t('LocalCord закроется, установит версию {version} и запустится снова. Профиль, настройки и история сервера сохранятся, но возможности новых версий пропадут. В версиях до 2.2 нет этого раздела — вернуться обратно можно будет через страницу загрузки.', { version: rel.version })
      : t('LocalCord скачает версию {version} с GitHub ({size}), закроется, установит её и запустится снова. Профиль, настройки и история сохранятся.', { version: rel.version, size: fmtBytes(asset.size) });
    if (!await confirmDialog(older ? t('Вернуться на версию {version}?', { version: rel.version }) : t('Установить версию {version}?', { version: rel.version }), text, { ok: older ? t('Вернуться') : t('Установить') })) return;
    const body = h(`<div style="display:flex;flex-direction:column;gap:12px"><div class="tooltip-hint" id="ir-text">${t('Загрузка…')}</div><div class="progress"><i></i></div></div>`);
    const m = modal({ title: t('Загрузка LocalCord {version}', { version: rel.version }), body, closable: false });
    const off = App.api.update.onProgress(({ got, total }) => {
      body.querySelector('.progress > i').style.width = (total ? got / total * 100 : 0) + '%';
      body.querySelector('#ir-text').textContent = t('{got} из {total}', { got: fmtBytes(got), total: fmtBytes(total || asset.size) });
    });
    const r = await App.api.update.fetch(rel.tag);
    off && off();
    if (!r.ok) {
      m.close();
      toast(r.error === 'checksum' ? t('Файл повреждён при загрузке (не совпала контрольная сумма). Попробуйте ещё раз.') : t('Не удалось скачать версию {version}. Проверьте интернет.', { version: rel.version }), { type: 'err', timeout: 7000 });
      return;
    }
    body.querySelector('#ir-text').textContent = t('Устанавливаем… LocalCord сейчас перезапустится.');
    const inst = await App.api.update.install();
    if (inst && !inst.ok) { m.close(); toast(t('Не удалось запустить установщик'), { type: 'err' }); }
  },

  /** Раз в день после запуска: вышла ли новая версия на GitHub */
  async autoCheckUpdates() {
    const a = App.settings.app;
    if (a.checkUpdates === false || Date.now() - (a.lastUpdateCheck || 0) < 20 * 3600 * 1000) return;
    const r = await App.api.update.list(false).catch(() => null);
    if (!r || !r.ok) return;
    await App.saveSettings({ app: { lastUpdateCheck: Date.now() } });
    const latest = r.releases.find(x => !x.prerelease && this.releaseAsset(x));
    if (!latest || cmpVersion(latest.version, App.info.version) <= 0 || this.banners.has('update')) return;
    const el = this.banner('update', { html: `${icon('download', 18)}<span class="grow">${t('Вышла новая версия LocalCord <b>{version}</b>.', { version: esc(latest.version) })}</span><button class="btn" data-u>${t('Подробнее')}</button><button class="btn" data-x title="${t('Позже')}">${icon('x', 14)}</button>` });
    el.querySelector('[data-u]').onclick = () => Settings.open('updates');
    el.querySelector('[data-x]').onclick = () => this.banner('update', null);
  },
};

// ---------- запуск ----------
(async function boot() {
  App.info = await App.api.app.info();
  App.settings = await App.api.store.get();
  I18N.set(App.settings.app.lang || App.info.lang || I18N.detect());
  Theme.apply();
  UI.init();
  Chat.init();
  Voice.init();
  UI.setTitle();
  setTimeout(() => UI.autoCheckUpdates(), 8000);

  const s = App.settings;
  if (!s.onboarded || !s.profile.username) return Screens.profile();
  if (s.mode === 'host' && !App.api.browser) {
    const st = await App.api.host.status();
    if (st.running || s.host.autoStart) return Flow.startHostAndConnect();
    return Screens.host();
  }
  if (s.lastServer) {
    const saved = (s.servers || []).find(x => x.address === s.lastServer);
    return Flow.connectTo(s.lastServer, saved?.password || '');
  }
  Screens.mode();
})();
