// Отрисовка интерфейса и запуск приложения
'use strict';

const UI = {
  view: null, // 'chat' | 'voice'
  banners: new Map(),

  init() {
    $('#tb-logo').innerHTML = `${logoSvg(18)}<span>LocalCord</span>`;
    $('#win-min').innerHTML = icon('winMin', 16);
    $('#win-close').innerHTML = icon('x', 16);
    const setMax = m => { $('#win-max').innerHTML = icon(m ? 'winRestore' : 'winMax', 14); $('#win-max').title = m ? 'Восстановить' : 'Развернуть'; };
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
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (sx === null || !this.isMobileLayout()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
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
      let t = dl.get(d.id);
      if (d.state === 'started') { t = toast(`Скачивание: ${d.name}`, { timeout: 0 }); dl.set(d.id, t); return; }
      if (d.state === 'progress' && t) {
        const pct = d.total ? ` — ${Math.round(d.received / d.total * 100)}%` : '';
        t.querySelector('.t-msg').textContent = `Скачивание: ${d.name}${pct}`;
        return;
      }
      if (t) { t.remove(); dl.delete(d.id); }
      if (d.state === 'done') toast(`Сохранено в «Загрузки»: ${d.name}`, { type: 'ok', timeout: 6000, action: { label: 'Показать', onClick: () => App.api.app.showItem(d.path) } });
      if (d.state === 'failed') toast(`Не удалось скачать ${d.name}`, { type: 'err' });
    });
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
      el.innerHTML = `<span class="dot"></span>${esc(App.server.name)} <span style="opacity:.6">· ${esc(Net.isLocal(App.address) ? 'ваш сервер' : App.address)}</span>`;
    } else if (App.address && Net.joinedOnce) {
      el.innerHTML = `<span class="dot wait"></span>Переподключение к ${esc(App.address)}…`;
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
    const local = Net.isLocal(App.address);
    let hostRunning = false;
    try { hostRunning = (await App.api.host.status()).running; } catch { /* ignore */ }
    rail.innerHTML = `
      <div class="rail-item logo" title="LocalCord — главная">${logoSvg(48)}</div>
      <div class="rail-sep"></div>
      ${!App.api.browser && (hostRunning || App.isHostMode()) ? `<div class="rail-item host ${local ? 'active' : ''}" data-r="host" title="Мой сервер">${icon('server', 22)}</div>` : ''}
      ${servers.map(s => `<div class="rail-item ${s.address === App.address ? 'active' : ''}" data-r="srv" data-a="${esc(s.address)}" title="${esc(s.name || s.address)}\n${esc(s.address)}">${esc(initials(s.name || 'S'))}</div>`).join('')}
      <div class="rail-item add" data-r="add" title="Подключиться к серверу">${icon('plus', 22)}</div>
      ${App.api.browser || hostRunning || App.isHostMode() ? '' : `<div class="rail-item host" data-r="newhost" title="Создать свой сервер">${icon('server', 22)}</div>`}
    `;
    rail.onclick = e => {
      const it = e.target.closest('.rail-item');
      if (!it) return;
      if (it.classList.contains('logo')) return Screens.mode();
      const r = it.dataset.r;
      if (r === 'add') return Screens.connect();
      if (r === 'newhost') return Screens.host();
      if (r === 'host') { if (!local) Flow.startHostAndConnect(); return; }
      if (r === 'srv' && it.dataset.a !== App.address) {
        const s = App.settings.servers.find(x => x.address === it.dataset.a);
        Flow.connectTo(s.address, s.password);
      }
    };
    rail.oncontextmenu = e => {
      const it = e.target.closest('.rail-item[data-r="srv"]');
      if (!it) return;
      e.preventDefault();
      ctxMenu(e.clientX, e.clientY, [
        { label: 'Скопировать адрес', icon: 'copy', onClick: () => copyText(it.dataset.a) },
        { label: 'Убрать из списка', icon: 'trash', danger: true, onClick: async () => { await App.saveSettings({ servers: App.settings.servers.filter(s => s.address !== it.dataset.a) }); this.renderRail(); } },
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
      ${isHost ? `<button class="cat-add" data-add="${type}" title="Создать канал">${icon('plus', 16)}</button>` : ''}</div>`;

    let html = cat('text', 'Текстовые каналы', 'text');
    for (const c of App.channels.filter(c => c.type === 'text')) {
      const active = App.currentChannel === c.id;
      if (collapsed.text && !active && !App.unread[c.id]) continue;
      const unread = App.unread[c.id] || 0;
      html += `<div class="chan ${active ? 'active' : ''} ${unread ? 'unread' : ''}" data-ch="${esc(c.id)}">${icon('hash', 20)}<span class="cname">${esc(c.name)}</span>${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</div>`;
    }
    html += cat('voice', 'Голосовые каналы', 'voice');
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
          html += `<div class="vm" data-vm="${esc(m.socketId)}">${avatarHtml(p, 24, { sid: m.socketId })}<span class="vm-name">${esc(p.username)}</span>
            <span class="vm-icons">${m.stream ? '<span class="live-badge">В эфире</span>' : ''}${muted ? `<span class="red">${icon('micOff', 16)}</span>` : ''}${deaf ? `<span class="red">${icon('headphonesOff', 16)}</span>` : ''}</span></div>`;
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
        const name = await promptDialog(type === 'voice' ? 'Новый голосовой канал' : 'Новый текстовый канал', 'Название канала', '', { ok: 'Создать', placeholder: type === 'voice' ? 'Например, Посиделки' : 'например, фильмы' });
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
        { label: 'Переименовать', icon: 'edit', onClick: async () => { const n = await promptDialog('Переименовать канал', 'Название', chan.name); if (n) Net.emit('channel-rename', { id: chan.id, name: n }); } },
        { label: 'Удалить канал', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDialog('Удалить канал?', `Канал «${chan.name}»${chan.type === 'text' ? ' и вся его история' : ''} будут удалены.`, { ok: 'Удалить', danger: true })) Net.emit('channel-delete', { id: chan.id });
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
      ? 'Голосовой канал · звук и трансляции идут напрямую между участниками'
      : 'Перетащите файл или картинку в окно, чтобы отправить';
    const showMembers = App.settings.ui.showMembers;
    $('#h-actions').innerHTML = `
      <button class="icon-btn ${showMembers ? 'on' : ''}" data-h="members" title="Участники">${icon('users', 22)}</button>
      <button class="icon-btn" data-h="invite" title="Пригласить друзей">${icon('link', 20)}</button>`;
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
      <div class="me" title="Мой профиль">${avatarHtml(p, 32, { status: true, sid: App.me?.id || 'me' })}
        <div class="me-text"><div class="me-name">${esc(p.username)}</div><div class="me-sub">${App.connected ? (Voice.channel ? 'В голосе' : 'В сети') : 'Не в сети'}</div></div></div>
      <button class="icon-btn ${muted ? 'off' : ''}" data-u="mic" title="${muted ? 'Включить микрофон' : 'Выключить микрофон'}">${icon(muted ? 'micOff' : 'mic', 20)}</button>
      <button class="icon-btn ${Voice.deafened ? 'off' : ''}" data-u="deaf" title="${Voice.deafened ? 'Включить звук' : 'Выключить звук'}">${icon(Voice.deafened ? 'headphonesOff' : 'headphones', 20)}</button>
      <button class="icon-btn" data-u="settings" title="Настройки">${icon('settings', 20)}</button>`;
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
        <div class="vp-info"><div class="vp-state">${icon('wifi', 16)} Голос подключён</div><div class="vp-chan" title="Открыть канал">${esc(ch ? ch.name : '')}</div></div>
        <button class="icon-btn" data-p="leave" title="Отключиться">${icon('phoneOff', 20)}</button>
      </div>
      ${Voice.canShare() ? `<div class="vp-btns">
        <button class="btn ${Voice.screen ? 'on' : ''}" data-p="share">${icon(Voice.screen ? 'screenOff' : 'screenShare', 16)} ${Voice.screen ? 'Остановить' : 'Экран'}</button>
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
    const users = App.users.slice().sort((a, b) => (b.isHost - a.isHost) || a.username.localeCompare(b.username, 'ru'));
    const row = u => {
      const p = App.profileOf(u.clientId, u);
      const vc = u.voiceChannel ? App.channel(u.voiceChannel) : null;
      return `<div class="mem" data-cid="${esc(u.clientId)}" data-sock="${esc(u.id)}">${avatarHtml(p, 32, { status: true })}
        <div class="mem-main"><div class="mem-name"><span>${esc(p.username)}</span>${u.isHost ? `<span class="crown" title="Хост сервера">${icon('crown', 14)}</span>` : ''}</div>
        ${vc ? `<div class="mem-sub">${icon('volume', 12)} ${esc(vc.name)}</div>` : ''}</div></div>`;
    };
    const hosts = users.filter(u => u.isHost);
    const others = users.filter(u => !u.isHost);
    box.innerHTML =
      (hosts.length ? `<div class="mem-group">Хост — ${hosts.length}</div>${hosts.map(row).join('')}` : '') +
      `<div class="mem-group">В сети — ${others.length}</div>${others.map(row).join('')}`;
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
      ctxMenu(x, y, [{ type: 'label', label: p.username }, { label: 'Мой профиль', icon: 'user', onClick: () => Settings.open('profile') }]);
      return;
    }
    const v = App.settings.voice;
    const vol = Math.round((v.volumes[m.clientId] ?? 1) * 100);
    const slider = h(`<div><div class="clabel">Громкость: <span>${vol}%</span></div><input type="range" min="0" max="100" value="${vol}"></div>`);
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
      { label: muted ? 'Включить звук для меня' : 'Заглушить для меня', icon: muted ? 'speaker' : 'speakerOff', onClick: async () => {
        await App.saveSettings({ voice: { localMutes: { ...v.localMutes, [m.clientId]: !muted } } });
        Voice.applyVolumes();
        Voice.renderVoiceView();
      } },
      m.stream && Voice.channel ? { label: 'Смотреть трансляцию', icon: 'eye', onClick: () => { this.selectChannel(Voice.channel); Voice.watch(m.socketId); } } : null,
    ]);
  },

  // ---------- меню сервера ----------
  serverMenu(x, y) {
    const isHost = App.me?.isHost;
    ctxMenu(x, y, [
      { label: 'Пригласить друзей', icon: 'link', onClick: () => this.inviteDialog() },
      isHost ? { type: 'sep' } : null,
      isHost ? { label: 'Создать текстовый канал', icon: 'hash', onClick: async () => { const n = await promptDialog('Новый текстовый канал', 'Название канала', '', { ok: 'Создать' }); if (n) Net.emit('channel-create', { name: n, type: 'text' }); } } : null,
      isHost ? { label: 'Создать голосовой канал', icon: 'volume', onClick: async () => { const n = await promptDialog('Новый голосовой канал', 'Название канала', '', { ok: 'Создать' }); if (n) Net.emit('channel-create', { name: n, type: 'voice' }); } } : null,
      isHost ? { label: 'Настройки сервера', icon: 'settings', onClick: () => Settings.open('host') } : null,
      { type: 'sep' },
      { label: 'Сменить сервер', icon: 'logout', danger: true, onClick: () => this.switchServer() },
    ]);
  },

  switchServer() {
    Screens.mode();
  },

  async inviteDialog({ firstTime = false } = {}) {
    const local = Net.isLocal(App.address);
    const body = h(`<div style="display:flex;flex-direction:column;gap:14px"></div>`);
    if (local) {
      const st = await App.api.host.status();
      const tags = { radmin: 'Radmin VPN', hamachi: 'Hamachi', vpn: 'VPN', lan: 'Локальная сеть' };
      body.appendChild(h(`<div class="tooltip-hint">${firstTime ? '<b style="color:var(--text-strong)">Сервер запущен!</b> ' : ''}Друзья в той же сети увидят сервер в списке автоматически. Если не видят — отправьте им адрес:</div>`));
      const list = h(`<div class="addr-list"></div>`);
      if (!st.addresses.length) list.appendChild(h(`<div class="empty-note">Сетевых подключений не найдено. Включите Radmin VPN или подключитесь к сети.</div>`));
      for (const a of st.addresses) {
        const full = `${a.address}:${st.port}`;
        const row = h(`<div class="addr"><code></code><span class="tag ${a.kind}">${tags[a.kind] || a.kind}</span><button class="btn">${icon('copy', 16)} Копировать</button></div>`);
        row.querySelector('code').textContent = full;
        row.querySelector('button').onclick = () => copyText(full);
        list.appendChild(row);
      }
      body.appendChild(list);
      if (st.hasPassword) body.appendChild(h(`<div class="tooltip-hint">${icon('lock', 14)} На сервере стоит пароль — сообщите его друзьям отдельно.</div>`));
      const fw = await App.api.firewall.status();
      if (fw.supported && !fw.allowed) {
        const fwBox = h(`<div class="sbox" style="background:rgba(240,178,50,.12)"><div class="row">${icon('shield', 22)}<div class="grow"><b>Разрешите доступ в брандмауэре</b><div class="tooltip-hint">Иначе Windows может не пускать друзей через Radmin VPN. Потребуются права администратора.</div></div><button class="btn primary">Разрешить</button></div></div>`);
        fwBox.querySelector('button').onclick = async () => {
          const r = await App.api.firewall.allow();
          if (r.ok) { fwBox.remove(); toast('Готово: подключения разрешены', { type: 'ok' }); } else toast('Разрешение не выдано', { type: 'err' });
        };
        body.appendChild(fwBox);
      }
    } else {
      body.appendChild(h(`<div class="tooltip-hint">Отправьте другу этот адрес. В LocalCord он нажмёт «Подключиться к другу» и вставит его.</div>`));
      const row = h(`<div class="addr"><code></code><button class="btn">${icon('copy', 16)} Копировать</button></div>`);
      row.querySelector('code').textContent = App.address;
      row.querySelector('button').onclick = () => copyText(App.address);
      body.appendChild(row);
    }
    modal({ title: firstTime ? 'Сервер готов — зовите друзей' : 'Пригласить друзей', body, buttons: [{ label: 'Готово', kind: 'primary' }] });
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

  checkUpdate({ manual = false } = {}) {
    const s = App.server;
    if (s && App.api.mobile && cmpVersion(s.version, App.info.version) > 0) {
      const el = this.banner('update', { html: `${icon('download', 18)}<span class="grow">У хоста LocalCord <b>${esc(s.version)}</b>. Новая версия для Android — на странице загрузки.</span><button class="btn" data-u>Открыть</button><button class="btn" data-x>${icon('x', 14)}</button>` });
      el.querySelector('[data-u]').onclick = () => App.api.app.openExternal(RELEASES_URL);
      el.querySelector('[data-x]').onclick = () => this.banner('update', null);
      return true;
    }
    if (!s || App.api.browser || !App.info.packaged) return false;
    if (cmpVersion(s.version, App.info.version) <= 0) return false;
    if (!s.update) {
      if (manual) toast(`У хоста версия ${s.version}, но он запустил её не из установщика — обновление раздать нельзя.`);
      return manual;
    }
    const el = this.banner('update', { html: `${icon('download', 18)}<span class="grow">Доступна новая версия LocalCord <b>${esc(s.version)}</b> — её раздаёт хост.</span><div class="progress hidden"><i></i></div><button class="btn" data-u>Обновить</button><button class="btn" data-x title="Позже">${icon('x', 14)}</button>` });
    const btn = el.querySelector('[data-u]');
    el.querySelector('[data-x]').onclick = () => this.banner('update', null);
    let off = null;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Загрузка…';
      const bar = el.querySelector('.progress');
      bar.classList.remove('hidden');
      off = App.api.update.onProgress(({ got, total }) => { bar.firstElementChild.style.width = (total ? got / total * 100 : 0) + '%'; });
      const r = await App.api.update.download(App.base, s.version);
      off && off();
      if (!r.ok) { btn.disabled = false; btn.textContent = 'Повторить'; toast('Не удалось скачать обновление', { type: 'err' }); return; }
      bar.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = 'Установить и перезапустить';
      btn.onclick = async () => {
        const ok = await confirmDialog('Установить обновление?',
          `LocalCord ${s.version} получен от сервера «${s.name}». Устанавливайте обновления только от хоста, которому доверяете. Программа перезапустится, профиль и настройки сохранятся.`,
          { ok: 'Установить' });
        if (ok) App.api.update.install();
      };
    };
    return true;
  },
};

// ---------- запуск ----------
(async function boot() {
  App.info = await App.api.app.info();
  App.settings = await App.api.store.get();
  Theme.apply();
  UI.init();
  Chat.init();
  Voice.init();
  UI.setTitle();

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
