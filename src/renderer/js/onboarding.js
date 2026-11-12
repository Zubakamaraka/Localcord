// Экраны: первый запуск (профиль), выбор режима, создание сервера, подключение
'use strict';

const COLOR_CHOICES = ['#5865f2', '#6d5dfc', '#eb459e', '#ed4245', '#faa61a', '#3ba55c', '#1abc9c', '#00a8fc', '#9b59b6', '#747f8d'];

const ERRORS = {
  'unreachable': N_('Сервер не отвечает. Проверьте адрес, что сервер запущен и вы в одной сети (Radmin VPN или локальная).'),
  'bad-password': N_('Неверный пароль сервера.'),
  'port-busy': N_('Этот порт уже занят другой программой. Укажите другой, например 3001.'),
  'timeout': N_('Сервер долго не отвечает.'),
};
const errText = e => (ERRORS[e] ? t(ERRORS[e]) : (e ? t('Ошибка: {error}', { error: e }) : ''));
const defaultServerName = () => {
  const n = (App.settings.profile.username || '').trim();
  return n ? t('Сервер {name}', { name: n }).slice(0, 40) : t('Сервер LocalCord');
};

const Screens = {
  el: () => $('#screen'),

  show(card) {
    const s = this.el();
    s.innerHTML = '';
    s.appendChild(card);
    s.classList.remove('hidden');
    UI.setTitle(null);
  },

  hide() { this.el().classList.add('hidden'); this.el().innerHTML = ''; },

  // ---------- 1. Профиль ----------
  profile({ editing = false } = {}) {
    const p = { ...App.settings.profile };
    const card = h(`<div class="card">
      ${editing ? '' : `<div class="lang-pick" id="ob-lang">${I18N.LANGS.map(l => `<button data-l="${l.id}" class="${l.id === I18N.lang ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</div>`}
      <div class="card-head">
        ${editing ? '' : '<div class="steps"><i class="on"></i><i></i></div>'}
        ${logoSvg(56)}
        <h1>${editing ? t('Ваш профиль') : t('Добро пожаловать в LocalCord')}</h1>
        <p>${t('Как вас будут видеть друзья. Профиль сохранится на этом компьютере — вводить имя каждый раз больше не нужно.')}</p>
      </div>
      <div class="avatar-pick">
        <div class="av-wrap" id="ob-av" title="${t('Выбрать фото')}"></div>
        <div class="field" style="flex:1">
          <label>${t('Цвет профиля')}</label>
          <div class="swatches" id="ob-colors"></div>
          <button class="link-btn" id="ob-av-remove" style="align-self:flex-start">${t('Убрать фото')}</button>
        </div>
      </div>
      <div class="field">
        <label for="ob-name">${t('Имя')}</label>
        <input class="input" id="ob-name" maxlength="32" placeholder="${t('Например, Миша')}" autocomplete="off">
      </div>
      <div class="err-text hidden" id="ob-err"></div>
      <button class="btn primary big block" id="ob-next">${editing ? t('Сохранить') : t('Далее')}</button>
    </div>`);

    const renderAv = () => {
      $('#ob-av', card).innerHTML = avatarHtml({ ...p, username: $('#ob-name', card).value || p.username || '?' }, 88) +
        `<div class="av-edit">${icon('image', 14)}</div>`;
      $('#ob-av-remove', card).classList.toggle('hidden', !p.avatar);
      $$('.swatch', card).forEach(s => s.classList.toggle('on', s.dataset.c === p.color));
    };
    $('#ob-colors', card).innerHTML = COLOR_CHOICES.map(c => `<button class="swatch" data-c="${c}" style="background:${c}"></button>`).join('');
    $('#ob-colors', card).onclick = e => { const s = e.target.closest('.swatch'); if (s) { p.color = s.dataset.c; renderAv(); } };
    $('#ob-av', card).onclick = async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      try { p.avatar = await imageToAvatar(f); renderAv(); } catch { toast(t('Не удалось открыть картинку'), { type: 'err' }); }
    };
    $('#ob-av-remove', card).onclick = () => { p.avatar = null; renderAv(); };
    const name = $('#ob-name', card);
    name.value = p.username || '';
    name.oninput = renderAv;
    const lang = $('#ob-lang', card);
    if (lang) lang.onclick = async e => {
      const b = e.target.closest('[data-l]');
      if (!b || b.dataset.l === I18N.lang) return;
      // язык меняется сразу; введённое имя и выбранное фото не теряются
      await App.saveSettings({ app: { lang: b.dataset.l }, profile: { ...p, username: name.value.trim() || p.username } });
      UI.applyLanguage();
      this.profile({ editing });
    };
    const next = async () => {
      const n = name.value.trim();
      if (!n) { $('#ob-err', card).textContent = t('Введите имя'); $('#ob-err', card).classList.remove('hidden'); name.classList.add('err'); name.focus(); return; }
      p.username = n;
      await App.saveSettings({ profile: p });
      if (editing) { Settings.onProfileChanged(); this.hide(); return; }
      this.mode();
    };
    name.onkeydown = e => { if (e.key === 'Enter') next(); };
    $('#ob-next', card).onclick = next;
    renderAv();
    this.show(card);
    setTimeout(() => name.focus(), 50);
  },

  // ---------- 2. Режим ----------
  async mode() {
    let st = { running: false, enabled: false };
    try { st = await App.api.host.status(); } catch { /* в браузере сервера нет */ }
    const mine = !App.api.browser && (st.running || st.enabled || st.hasData);
    const recent = (App.settings.servers || []).slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 4);
    const card = h(`<div class="card wide">
      <div class="card-head">
        ${App.settings.onboarded ? '' : '<div class="steps"><i class="on"></i><i class="on"></i></div>'}
        <h1>${t('Как начнём?')}</h1>
        <p>${t('Один из друзей создаёт сервер у себя, остальные подключаются к нему.<br>Это можно поменять в любой момент.')}</p>
      </div>
      <div class="choice-grid">
        <button class="choice green" id="m-host">
          <div class="ch-ic">${icon('server', 26)}</div>
          <b>${mine ? t('Мой сервер') : t('Создать сервер')}</b>
          <span>${mine
            ? (st.running ? t('Сервер «{name}» работает. Открыть его.', { name: esc(st.name) }) : t('Сервер «{name}» остановлен. Запустить и открыть.', { name: esc(st.name) }))
            : t('Я хост: друзья подключаются ко мне. Компьютер должен быть включён, пока вы общаетесь.')}</span>
        </button>
        <button class="choice" id="m-join">
          <div class="ch-ic">${icon('link', 26)}</div>
          <b>${t('Подключиться к другу')}</b>
          <span>${t('Найдём сервер в сети автоматически или введите адрес, который прислал хост.')}</span>
        </button>
      </div>
      ${recent.length ? `<div class="field"><label>${t('Недавние серверы')}</label><div class="server-list" id="m-recent"></div></div>` : ''}
      <div class="row" style="justify-content:space-between">
        <button class="link-btn" id="m-back">${icon('user', 14)} ${t('Изменить профиль')}</button>
        ${mine ? `<button class="link-btn" id="m-hostcfg">${icon('settings', 14)} ${t('Настройки сервера')}</button>` : ''}
        ${App.connected ? `<button class="link-btn" id="m-cancel">${t('Вернуться в чат')}</button>` : ''}
      </div>
    </div>`);
    $('#m-host', card).onclick = () => (st.running ? Flow.startHostAndConnect() : this.host());
    $('#m-join', card).onclick = () => this.connect();
    $('#m-back', card).onclick = () => this.profile();
    const cfg = $('#m-hostcfg', card);
    if (cfg) cfg.onclick = () => this.host();
    const cancel = $('#m-cancel', card);
    if (cancel) cancel.onclick = () => this.hide();
    if (recent.length) {
      const list = $('#m-recent', card);
      for (const s of recent) {
        list.appendChild(this.serverRow({ name: s.name || s.address, address: s.address, locked: !!s.password }, () => Flow.connectTo(s.address, s.password), async () => {
          await App.saveSettings({ servers: App.settings.servers.filter(x => x.address !== s.address) });
          UI.renderRail();
          this.mode();
        }));
      }
    }
    this.show(card);
  },

  /** Строка сервера. onRemove — показать крестик «убрать из списка» */
  serverRow(s, onClick, onRemove) {
    const row = h(`<div class="server-row ${s.own ? 'own' : ''}" role="button" tabindex="0">
      <div class="srv-ic">${esc(initials(s.name || 'S'))}</div>
      <div class="srv-main"><div class="srv-name"></div><div class="srv-sub"></div></div>
      <div class="srv-meta"></div>
      ${onRemove ? `<button class="icon-btn srv-x" title="${t('Убрать из списка')}">${icon('x', 16)}</button>` : ''}
    </div>`);
    $('.srv-name', row).textContent = s.name || s.address;
    $('.srv-sub', row).textContent = s.own ? t('этот компьютер') : s.address;
    const meta = [];
    if (s.own) meta.push(`<span class="tag own">${t('ваш сервер')}</span>`);
    if (Number.isFinite(s.users)) meta.push(`${icon('users', 14)} ${s.users}`);
    if (s.locked) meta.push(icon('lock', 14));
    $('.srv-meta', row).innerHTML = meta.join(' ');
    row.onclick = e => { if (!e.target.closest('.srv-x')) onClick(); };
    row.onkeydown = e => { if (e.key === 'Enter' && e.target === row) onClick(); };
    const x = $('.srv-x', row);
    if (x) x.onclick = e => { e.stopPropagation(); onRemove(); };
    return row;
  },

  // ---------- 3a. Создание и настройка сервера ----------
  async host({ error } = {}) {
    const hs = App.settings.host;
    let st = { running: false, enabled: false };
    try { st = await App.api.host.status(); } catch { /* ignore */ }
    const card = h(`<div class="card">
      <div class="card-head">
        <div class="choice green" style="padding:0;background:none;border:0;transform:none"><div class="ch-ic">${icon('server', 26)}</div></div>
        <h1>${t('Свой сервер')}</h1>
        <p>${st.running
          ? t('Сервер уже работает. Здесь можно поменять название, пароль и порт — изменения применятся сразу.')
          : t('Сервер работает прямо в этом приложении. Друзья увидят его в списке или подключатся по адресу, который мы покажем.')}</p>
      </div>
      <div class="field"><label>${t('Название сервера')}</label><input class="input" id="h-name" maxlength="40"></div>
      <div class="row">
        <div class="field grow"><label>${t('Пароль')} <span style="text-transform:none;font-weight:400">${t('(необязательно)')}</span></label>
          <div class="pass-box"><input class="input" id="h-pass" type="password" maxlength="64" placeholder="${t('Без пароля')}" autocomplete="new-password"><button class="icon-btn" id="h-eye" type="button" title="${t('Показать пароль')}">${icon('eye', 18)}</button></div></div>
        <div class="field" style="width:110px"><label>${t('Порт')}</label><input class="input" id="h-port" type="number" min="1024" max="65535"></div>
      </div>
      <label class="toggle-row">
        <div class="tr-text"><b>${t('Запускать сервер вместе с LocalCord')}</b><span>${t('Тогда друзья смогут зайти, как только вы откроете программу')}</span></div>
        <span class="switch"><input type="checkbox" id="h-auto"><i></i></span>
      </label>
      <div class="err-text ${error ? '' : 'hidden'}" id="h-err">${esc(errText(error))}</div>
      <div class="row">
        <button class="btn ghost" id="h-back">${t('Назад')}</button>
        <button class="btn success big grow" id="h-start">${icon('power', 18)} ${st.running ? t('Сохранить и открыть') : t('Запустить сервер')}</button>
      </div>
    </div>`);
    $('#h-name', card).value = hs.name === 'Сервер LocalCord' ? defaultServerName() : hs.name;
    $('#h-pass', card).value = hs.password || '';
    $('#h-port', card).value = hs.port;
    $('#h-auto', card).checked = hs.autoStart;
    $('#h-back', card).onclick = () => this.mode();
    $('#h-eye', card).onclick = () => { const i = $('#h-pass', card); i.type = i.type === 'password' ? 'text' : 'password'; };
    $('#h-start', card).onclick = async () => {
      const port = Math.max(1024, Math.min(65535, parseInt($('#h-port', card).value, 10) || 3000));
      await App.saveSettings({
        host: { name: $('#h-name', card).value.trim() || defaultServerName(), password: $('#h-pass', card).value, port, autoStart: $('#h-auto', card).checked },
      });
      await Flow.startHostAndConnect({ firstTime: !st.running && !st.hasData, apply: true });
    };
    if (App.api.browser) {
      $('#h-err', card).textContent = App.api.mobile ? t('Сервер работает на компьютере: создайте его в LocalCord для Windows, а с телефона подключайтесь к нему.') : t('Создать сервер можно только в приложении для Windows.');
      $('#h-err', card).classList.remove('hidden');
      $('#h-start', card).disabled = true;
    }
    this.show(card);
  },

  // ---------- 3b. Подключение ----------
  connect({ error, address, password } = {}) {
    const card = h(`<div class="card wide">
      <div class="card-head">
        <h1>${t('Подключиться к серверу')}</h1>
        <p>${t('Серверы друзей в вашей сети появятся ниже. Если не видно — введите адрес вручную.')}</p>
      </div>
      <div class="field">
        <div class="row"><label class="label grow">${t('Найдено в сети')}</label><button class="link-btn" id="c-scan">${icon('refresh', 14)} ${t('Обновить')}</button></div>
        <div class="server-list" id="c-found"></div>
      </div>
      <div class="row" style="align-items:flex-end">
        <div class="field grow"><label>${t('Адрес сервера')}</label><input class="input" id="c-addr" placeholder="26.123.45.67:3000" autocomplete="off" spellcheck="false"></div>
        <div class="field" style="width:200px"><label>${t('Пароль')}</label><input class="input" id="c-pass" type="password" placeholder="${t('если есть')}" autocomplete="off"></div>
      </div>
      <div class="err-text ${error ? '' : 'hidden'}" id="c-err">${esc(errText(error))}</div>
      <div class="row">
        <button class="btn ghost" id="c-back">${t('Назад')}</button>
        <div class="grow"></div>
        <button class="btn primary big" id="c-go">${t('Подключиться')}</button>
      </div>
    </div>`);
    const addr = $('#c-addr', card);
    const pass = $('#c-pass', card);
    const lastIsOwn = Net.isLocal(App.settings.lastServer);
    addr.value = address || (lastIsOwn ? '' : App.settings.lastServer) || '';
    pass.value = password || '';
    if (error === 'bad-password') setTimeout(() => pass.focus(), 50);
    $('#c-back', card).onclick = () => this.mode();
    const savedFor = s => (App.settings.servers || []).find(x => x.address === s.address || (s.id && x.id === s.id));
    const go = () => {
      const a = normalizeAddress(addr.value);
      if (!a) { addr.classList.add('err'); addr.focus(); return; }
      Flow.connectTo(a, pass.value || savedFor({ address: a })?.password || '');
    };
    $('#c-go', card).onclick = go;
    addr.onkeydown = pass.onkeydown = e => { if (e.key === 'Enter') go(); };

    const searching = () => `<div class="empty-note"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>${t('Ищем серверы…')}</div>`;
    const scan = async () => {
      const box = $('#c-found', card);
      box.innerHTML = searching();
      let list = [];
      try { list = dedupeServers(await App.api.net.discover()); } catch { /* ignore */ }
      if (!card.isConnected) return;
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = `<div class="empty-note">${App.api.net.canDiscover === false ? t('Автопоиск доступен только в приложении.') : t('В сети серверов не найдено. Попросите хоста прислать адрес — его видно в меню «Пригласить друзей».')}</div>`;
        return;
      }
      // свой сервер — первой строкой: в него входим как владелец, без пароля
      list.sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0));
      for (const s of list) {
        box.appendChild(this.serverRow(s, () => {
          if (s.own) return Flow.startHostAndConnect();
          const saved = savedFor(s);
          if (s.locked && !saved?.password && !pass.value) {
            addr.value = s.address;
            $('#c-err', card).textContent = t('Этот сервер защищён паролем — введите его и нажмите «Подключиться».');
            $('#c-err', card).classList.remove('hidden');
            pass.focus();
            return;
          }
          Flow.connectTo(s.address, pass.value || saved?.password || '');
        }));
      }
    };
    $('#c-scan', card).onclick = scan;
    this.show(card);
    scan();
  },

  // ---------- ожидание ----------
  connecting(address, onCancel) {
    const card = h(`<div class="card" style="align-items:center;text-align:center">
      <div class="spinner big"></div>
      <div class="card-head"><h1 style="font-size:20px">${t('Подключаемся…')}</h1><p class="mono"></p></div>
      <button class="btn ghost" id="cn-cancel">${t('Отмена')}</button>
    </div>`);
    $('.card-head p', card).textContent = address;
    $('#cn-cancel', card).onclick = onCancel;
    this.show(card);
  },
};

// ---------- сценарии подключения ----------
const Flow = {
  attempt: 0,

  async connectTo(address, password = '', { silent = false, label = null } = {}) {
    const my = ++this.attempt;
    Screens.connecting(label || address, () => { this.attempt++; Net.disconnect(); Screens.connect({ address: Net.isLocal(address) ? '' : address }); });
    const res = await Net.connect(address, password);
    if (my !== this.attempt) return res;
    if (res.ok) {
      Screens.hide();
      if (!App.settings.onboarded) await App.saveSettings({ onboarded: true });
      return res;
    }
    if (silent && res.error === 'unreachable') return res;
    if (Net.isLocal(address)) Screens.host({ error: res.error });
    else Screens.connect({ error: res.error, address, password: res.error === 'bad-password' ? '' : password });
    return res;
  },

  /**
   * Открыть свой сервер. apply=true — только что изменили настройки: применяем их и к уже
   * работающему серверу (иначе он оставался со старым паролем).
   */
  async startHostAndConnect({ firstTime = false, apply = false } = {}) {
    const st = await App.api.host.status();
    if (!st.running || apply) {
      Screens.connecting(t('Запуск сервера…'), () => Screens.host());
      const r = st.running ? await App.api.host.apply() : await App.api.host.start();
      if (!r.ok) { Screens.host({ error: r.error }); return; }
    }
    await App.saveSettings({ mode: 'host' });
    const port = (await App.api.host.status()).port;
    const res = await this.connectTo(`127.0.0.1:${port}`, App.settings.host.password, { label: t('Мой сервер') });
    if (res && res.ok && firstTime) UI.inviteDialog({ firstTime: true });
  },
};
