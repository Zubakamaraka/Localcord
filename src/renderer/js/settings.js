// Окно настроек (как в Discord: разделы слева)
'use strict';

const Settings = {
  el: null,
  section: 'profile',
  micTest: null,

  open(section = 'profile') {
    this.close();
    this.section = section;
    const isElectron = !App.api.browser;
    this.el = h(`<div class="settings">
      <div class="settings-nav thin-scroll"><nav>
        <div class="nav-cat">${t('Пользователь')}</div>
        <button data-s="profile">${icon('user', 18)} ${t('Мой профиль')}</button>
        <button data-s="voice">${icon('mic', 18)} ${t('Голос и видео')}</button>
        <button data-s="notify">${icon('bell', 18)} ${t('Уведомления')}</button>
        <button data-s="look">${icon('palette', 18)} ${t('Внешний вид и язык')}</button>
        ${isElectron ? `<div class="nav-cat">${t('Сервер')}</div><button data-s="host">${icon('server', 18)} ${t('Мой сервер')}</button>` : ''}
        <div class="nav-cat">${t('Приложение')}</div>
        ${isElectron ? `<button data-s="app">${icon('settings', 18)} ${t('Приложение')}</button>` : ''}
        <button data-s="updates">${icon('download', 18)} ${t('Обновления')}</button>
        <button data-s="about">${icon('info', 18)} ${t('О программе')}</button>
        <hr>
        <button data-s="disconnect" class="danger">${icon('logout', 18)} ${t('Сменить сервер')}</button>
      </nav></div>
      <div class="settings-body"><div class="inner"></div></div>
      <div class="settings-close"><button class="icon-btn" title="${t('Закрыть (Esc)')}">${icon('x', 20)}</button><span>ESC</span></div>
    </div>`);
    this.el.querySelector('.settings-nav').onclick = e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'disconnect') { this.close(); UI.switchServer(); return; }
      this.show(b.dataset.s);
    };
    this.el.querySelector('.settings-close button').onclick = () => this.close();
    document.body.appendChild(this.el);
    this.show(section);
  },

  close() {
    this.stopMicTest();
    if (this.el) { this.el.remove(); this.el = null; }
  },

  show(section) {
    this.stopMicTest();
    this.section = section;
    $$('.settings-nav [data-s]', this.el).forEach(b => b.classList.toggle('on', b.dataset.s === section));
    const inner = $('.settings-body .inner', this.el);
    inner.innerHTML = '';
    const fn = { profile: this.profile, voice: this.voice, notify: this.notify, look: this.look, host: this.host, app: this.app, updates: this.updates, about: this.about }[section];
    fn && fn.call(this, inner);
  },

  toggle(label, desc, checked, onChange) {
    const el = h(`<label class="toggle-row"><div class="tr-text"><b></b><span></span></div><span class="switch"><input type="checkbox"><i></i></span></label>`);
    el.querySelector('b').textContent = label;
    el.querySelector('.tr-text span').textContent = desc || '';
    const inp = el.querySelector('input');
    inp.checked = !!checked;
    inp.onchange = () => onChange(inp.checked);
    return el;
  },

  // ---------- профиль ----------
  profile(root) {
    const p = App.settings.profile;
    root.appendChild(h(`<h2>${t('Мой профиль')}</h2>`));
    const box = h(`<div class="sbox">
      <div class="avatar-pick">
        <div class="av-wrap" id="s-av" title="${t('Сменить фото')}"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
          <div style="font-size:20px;font-weight:700;color:var(--text-strong)" id="s-name-view"></div>
          <div class="tooltip-hint">${t('Профиль хранится на этом компьютере и автоматически передаётся серверу при входе.')}</div>
        </div>
      </div>
      <div class="field"><label>${t('Имя')}</label><div class="row"><input class="input grow" id="s-name" maxlength="32"><button class="btn primary" id="s-save">${t('Сохранить')}</button></div></div>
      <div class="field"><label>${t('Цвет')}</label><div class="swatches" id="s-colors"></div></div>
      <div class="row"><button class="btn" id="s-photo">${icon('image', 16)} ${t('Загрузить фото или GIF')}</button><button class="btn ghost" id="s-photo-rm">${t('Убрать фото')}</button></div>
      <div class="tooltip-hint">${t('Анимированный GIF останется анимированным: LocalCord сам уменьшит его до размера аватара.')}</div>
    </div>`);
    root.appendChild(box);

    const style = h(`<div class="sbox">
      <h4>${t('Рамка аватара')}</h4>
      <div class="frame-grid" id="s-frames"></div>
      <h4 style="margin-top:6px">${t('Шрифт имени')}</h4>
      <div class="font-grid" id="s-fonts"></div>
      <h4 style="margin-top:6px">${t('Так вас видят друзья')}</h4>
      <div class="profile-preview" id="s-preview"></div>
    </div>`);
    root.appendChild(style);

    const draw = () => {
      const s = App.settings.profile;
      $('#s-av', box).innerHTML = avatarHtml(s, 80) + `<div class="av-edit">${icon('image', 14)}</div>`;
      $('#s-name-view', box).innerHTML = nameHtml(s);
      $('#s-colors', box).innerHTML = COLOR_CHOICES.map(c => `<button class="swatch ${c === s.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
      $('#s-photo-rm', box).classList.toggle('hidden', !s.avatar);
      $('#s-frames', style).innerHTML = FRAMES.map(f => `<button class="frame-opt ${frameId(s) === f.id ? 'on' : ''}" data-f="${f.id}">${avatarHtml({ ...s, frame: f.id || null }, 48)}<span>${esc(t(f.name))}</span></button>`).join('');
      $('#s-fonts', style).innerHTML = NAME_FONTS.map(f => `<button class="font-opt ${(s.font || '') === f.id ? 'on' : ''}" data-n="${f.id}"><b class="${f.id ? `nf nf-${f.id}` : ''}">${esc(s.username || 'LocalCord')}</b><span>${esc(t(f.name))}</span></button>`).join('');
      $('#s-preview', style).innerHTML = `<div class="msg head" style="pointer-events:none">
        <div class="m-av">${avatarHtml(s, 40)}</div>
        <div class="m-head"><span class="m-name ${fontClass(s)}">${esc(s.username)}</span><span class="m-time">${esc(fmtStamp(Date.now()))}</span></div>
        <div class="m-text">${t('Всем привет! Кто сегодня играет?')}</div></div>`;
    };
    $('#s-name', box).value = p.username;
    const save = async patch => { await App.saveSettings({ profile: patch }); draw(); this.onProfileChanged(); };
    $('#s-save', box).onclick = () => { const n = $('#s-name', box).value.trim(); if (n) save({ username: n }); };
    $('#s-name', box).onkeydown = e => { if (e.key === 'Enter') $('#s-save', box).click(); };
    $('#s-colors', box).onclick = e => { const s = e.target.closest('.swatch'); if (s) save({ color: s.dataset.c }); };
    $('#s-frames', style).onclick = e => { const b = e.target.closest('[data-f]'); if (b) save({ frame: b.dataset.f || null }); };
    $('#s-fonts', style).onclick = e => { const b = e.target.closest('[data-n]'); if (b) save({ font: b.dataset.n || null }); };
    const pick = async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      const busy = f.type === 'image/gif' ? toast(t('Обрабатываем GIF…'), { timeout: 0 }) : null;
      try { await save({ avatar: await imageToAvatar(f) }); }
      catch { toast(t('Не удалось открыть картинку'), { type: 'err' }); }
      finally { busy && busy.remove(); }
    };
    $('#s-av', box).onclick = pick;
    $('#s-photo', box).onclick = pick;
    $('#s-photo-rm', box).onclick = () => save({ avatar: null });
    draw();
  },

  onProfileChanged() {
    const p = App.settings.profile;
    Net.emit('profile-update', { username: p.username, color: p.color, avatar: p.avatar, frame: p.frame, font: p.font });
    UI.renderUserPanel();
  },

  // ---------- голос ----------
  async voice(root) {
    const v = App.settings.voice;
    root.appendChild(h(`<h2>${t('Голос и видео')}</h2>`));
    const box = h(`<div class="sbox">
      <div class="row">
        <div class="field grow"><label>${t('Микрофон')}</label><select class="select" id="v-in"></select></div>
        <div class="field grow"><label>${t('Динамики / наушники')}</label><select class="select" id="v-out"></select></div>
      </div>
      <div class="field"><label>${t('Проверка микрофона')}</label>
        <div class="row"><button class="btn" id="v-test">${icon('mic', 16)} ${t('Проверить')}</button><div class="meter grow"><i id="v-meter"></i></div></div>
        <span class="hint">${t('Скажите что-нибудь — полоска должна двигаться.')}</span></div>
      <label class="check"><input type="checkbox" id="v-echo"><span class="check-text"><b>${t('Слышать себя во время проверки')}</b><span>${t('Ваш голос вернётся через 2 секунды — таким, каким его слышат друзья: с шумоподавлением и после сжатия. Лучше в наушниках.')}</span></span></label>
    </div>`);
    root.appendChild(box);
    const proc = h(`<div class="sbox"><h4>${t('Обработка звука')}</h4></div>`);
    const retest = () => { if (this.micTest) this.startMicTest(box); };
    const setV = async (patch, apply) => { await App.saveSettings({ voice: patch }); apply && apply(); };
    proc.appendChild(this.toggle(t('Шумоподавление'), t('Убирает гул, клавиатуру и фоновые шумы'), v.noiseSuppression, on => setV({ noiseSuppression: on }, () => { Voice.applyInput(); retest(); })));
    proc.appendChild(this.toggle(t('Эхоподавление'), t('Нужно, если вы без наушников'), v.echoCancellation, on => setV({ echoCancellation: on }, () => { Voice.applyInput(); retest(); })));
    proc.appendChild(this.toggle(t('Автоусиление'), t('Выравнивает громкость голоса'), v.autoGainControl, on => setV({ autoGainControl: on }, () => { Voice.applyInput(); retest(); })));
    root.appendChild(proc);

    if (Voice.canShare()) {
      const st = h(`<div class="sbox"><h4>${t('Трансляция экрана')}</h4></div>`);
      st.appendChild(this.toggle(t('Кодировать видеокартой, если она умеет'),
        t('Нужно для плавных 1440p и 4K: процессор такие трансляции не успевает сжимать, и картинка мутнеет. Выключите, если у зрителей артефакты или чёрный экран.'),
        v.hwEncode !== false, on => setV({ hwEncode: on })));
      st.appendChild(h(`<div class="tooltip-hint">${t('Во время трансляции на вашей плитке видно, что реально уходит зрителям: разрешение, кадры в секунду и что именно ограничивает качество — процессор или сеть.')}</div>`));
      root.appendChild(st);
    }

    root.appendChild(h(`<div class="sbox"><h4>${t('Горячие клавиши (когда окно LocalCord активно)')}</h4>
      <div class="hotkeys">
        <span class="kbd">Ctrl+Shift+M</span><span>${t('Выключить / включить микрофон')}</span>
        <span class="kbd">Ctrl+Shift+D</span><span>${t('Выключить / включить звук')}</span>
        <span class="kbd">F</span><span>${t('Трансляция на весь экран (или двойной щелчок по ней)')}</span>
        <span class="kbd">Esc</span><span>${t('Выйти из полноэкранного режима, ещё раз — свернуть трансляцию в мини-окно')}</span>
      </div></div>`));

    let devices = [];
    try {
      // доступ к названиям устройств появляется после разрешения микрофона
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      devices = await navigator.mediaDevices.enumerateDevices();
      tmp && tmp.getTracks().forEach(tr => tr.stop());
    } catch { /* ignore */ }
    if (!this.el) return;
    const fill = (sel, kind, cur) => {
      const list = devices.filter(d => d.kind === kind && d.deviceId !== 'communications');
      sel.innerHTML = `<option value="default">${t('По умолчанию (как в системе)')}</option>` +
        list.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || t('Устройство'))}</option>`).join('');
      sel.value = list.some(d => d.deviceId === cur) ? cur : 'default';
    };
    fill($('#v-in', box), 'audioinput', v.inputId);
    fill($('#v-out', box), 'audiooutput', v.outputId);
    $('#v-in', box).onchange = e => setV({ inputId: e.target.value }, () => { Voice.applyInput(); retest(); });
    $('#v-out', box).onchange = e => setV({ outputId: e.target.value }, () => { Voice.applyOutput(); retest(); });
    $('#v-echo', box).checked = this.echoTest !== false;
    $('#v-echo', box).onchange = e => { this.echoTest = e.target.checked; retest(); };
    $('#v-test', box).onclick = () => (this.micTest ? this.stopMicTest() : this.startMicTest(box));
  },

  /**
   * «Как меня слышат»: микрофон проходит тот же путь, что и в голосовом канале
   * (обработка Chromium → кодек Opus → декодер), и возвращается с задержкой 2 секунды.
   */
  async makeEcho(stream, ctx) {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = e => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
    b.onicecandidate = e => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };
    const remote = new Promise(resolve => { b.ontrack = e => resolve(e.streams[0] || new MediaStream([e.track])); });
    stream.getAudioTracks().forEach(tr => a.addTrack(tr, stream));
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    const rs = await remote;
    // Chromium отдаёт звук удалённого потока в WebAudio, только если поток ещё и «играет» в элементе
    const keep = new Audio();
    keep.muted = true;
    keep.srcObject = rs;
    keep.play().catch(() => {});
    const src = ctx.createMediaStreamSource(rs);
    const delay = ctx.createDelay(3);
    delay.delayTime.value = 2;
    src.connect(delay).connect(ctx.destination);
    const out = App.settings.voice.outputId;
    if (ctx.setSinkId && out && out !== 'default') ctx.setSinkId(out).catch(() => {});
    return { a, b, keep, node: delay };
  },

  async startMicTest(box) {
    this.stopMicTest();
    try {
      const stream = await Voice.getMic();
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const meter = $('#v-meter', box);
      const timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (const x0 of buf) { const x = (x0 - 128) / 128; s += x * x; }
        meter.style.width = Math.min(100, Math.sqrt(s / buf.length) * 400) + '%';
      }, 60);
      this.micTest = { stream, ctx, timer, meter, btn: $('#v-test', box), echo: null };
      this.micTest.btn.innerHTML = `${icon('x', 16)} ${t('Остановить')}`;
      if (this.echoTest !== false) {
        const test = this.micTest;
        const echo = await this.makeEcho(stream, ctx).catch(() => null);
        if (this.micTest === test) test.echo = echo; else if (echo) { echo.a.close(); echo.b.close(); }
      }
    } catch { toast(t('Микрофон недоступен'), { type: 'err' }); }
  },

  stopMicTest() {
    const m = this.micTest;
    if (!m) return;
    this.micTest = null;
    clearInterval(m.timer);
    if (m.echo) { try { m.echo.a.close(); m.echo.b.close(); m.echo.keep.srcObject = null; } catch { /* ignore */ } }
    m.stream.getTracks().forEach(x => x.stop());
    m.ctx.close();
    if (m.meter) m.meter.style.width = '0';
    if (m.btn && m.btn.isConnected) m.btn.innerHTML = `${icon('mic', 16)} ${t('Проверить')}`;
  },

  // ---------- уведомления ----------
  notify(root) {
    const a = App.settings.app;
    root.appendChild(h(`<h2>${t('Уведомления')}</h2>`));
    const box = h(`<div class="sbox"></div>`);
    box.appendChild(this.toggle(t('Уведомления на рабочем столе'), t('Когда окно LocalCord свёрнуто или неактивно'), a.notifications, on => App.saveSettings({ app: { notifications: on } })));
    box.appendChild(this.toggle(t('Звуки'), t('Вход и выход из голосового канала, новые сообщения, микрофон'), a.sounds, on => App.saveSettings({ app: { sounds: on } })));
    root.appendChild(box);
  },

  // ---------- внешний вид и язык ----------
  look(root) {
    const ui = App.settings.ui;
    root.appendChild(h(`<h2>${t('Внешний вид и язык')}</h2>`));

    const lang = h(`<div class="sbox"><h4>${t('Язык')}${I18N.lang === 'en' ? '' : ' / Language'}</h4><div class="seg" id="l-seg"></div></div>`);
    const cur = App.settings.app.lang || '';
    lang.querySelector('.seg').innerHTML = `<button data-l="" class="${cur ? '' : 'on'}">${t('Как в системе')}</button>` +
      I18N.LANGS.map(l => `<button data-l="${l.id}" class="${cur === l.id ? 'on' : ''}">${esc(l.name)}</button>`).join('');
    lang.querySelector('.seg').onclick = async e => {
      const b = e.target.closest('[data-l]');
      if (!b) return;
      await App.saveSettings({ app: { lang: b.dataset.l || null } });
      UI.applyLanguage();
      this.open('look');
    };
    root.appendChild(lang);

    const themes = h(`<div class="sbox"><h4>${t('Тема')}</h4><div class="theme-grid"></div></div>`);
    const grid = themes.querySelector('.theme-grid');
    for (const th of THEMES) {
      const [r, sd, m, a, tx] = th.c;
      const card = h(`<button class="theme-card ${(ui.theme || 'graphite') === th.id ? 'on' : ''}" data-t="${th.id}" title="${esc(t(th.hint))}">
        <div class="tp"><i class="r" style="background:${r}"></i>
          <div class="s" style="background:${sd}"><b style="background:${tx};width:80%"></b><b style="background:${tx};width:60%"></b><b style="background:${a};opacity:1;width:70%"></b></div>
          <div class="m" style="background:${m}"><b style="background:${tx};opacity:.5;width:70%"></b><b style="background:${tx};opacity:.35;width:45%"></b><b style="background:${a};width:30%"></b></div></div>
        <div class="tn">${esc(t(th.name))}</div></button>`);
      grid.appendChild(card);
    }
    grid.onclick = async e => {
      const c = e.target.closest('[data-t]');
      if (!c) return;
      await Theme.set({ theme: c.dataset.t });
      $$('.theme-card', grid).forEach(x => x.classList.toggle('on', x === c));
    };
    root.appendChild(themes);

    const acc = h(`<div class="sbox"><h4>${t('Цвет акцента')}</h4>
      <div class="tooltip-hint">${t('Кнопки, выделение, ссылки. «Как в теме» — цвет, подобранный к выбранной палитре.')}</div>
      <div class="accent-row"></div></div>`);
    const row = acc.querySelector('.accent-row');
    const drawAcc = () => {
      const c0 = App.settings.ui.accent;
      row.innerHTML = `<button class="accent-dot auto ${!c0 ? 'on' : ''}" data-a="" title="${t('Как в теме')}"></button>` +
        ACCENTS.map(c => `<button class="accent-dot ${c0 === c ? 'on' : ''}" data-a="${c}" style="background:${c}" title="${c}"></button>`).join('') +
        `<label class="accent-dot custom ${c0 && !ACCENTS.includes(c0) ? 'on' : ''}" title="${t('Свой цвет')}" ${c0 && !ACCENTS.includes(c0) ? `style="background:${c0};color:#fff"` : ''}>${icon('plus', 16)}<input type="color" value="${c0 || '#6d5dfc'}"></label>`;
      row.querySelector('input').oninput = debounce(async ev => { await Theme.set({ accent: ev.target.value }); drawAcc(); }, 120);
    };
    row.onclick = async e => {
      const d = e.target.closest('[data-a]');
      if (!d) return;
      await Theme.set({ accent: d.dataset.a || null });
      drawAcc();
    };
    drawAcc();
    root.appendChild(acc);

    const size = h(`<div class="sbox"><h4>${t('Размер интерфейса')}</h4><div class="seg"></div>
      <div class="tooltip-hint">${t('Увеличивает текст и кнопки целиком, без потери чёткости.')}</div></div>`);
    const seg = size.querySelector('.seg');
    const drawSize = () => {
      const z = App.settings.ui.scale || 100;
      seg.innerHTML = SCALES.map(v => `<button data-z="${v}" class="${v === z ? 'on' : ''}">${v}%</button>`).join('');
    };
    seg.onclick = async e => { const b = e.target.closest('[data-z]'); if (b) { await Theme.set({ scale: Number(b.dataset.z) }); drawSize(); } };
    drawSize();
    root.appendChild(size);
  },

  // ---------- мой сервер ----------
  async host(root) {
    const hs = App.settings.host;
    const st = await App.api.host.status();
    if (!this.el) return;
    root.appendChild(h(`<h2>${t('Мой сервер')}</h2>`));
    const status = h(`<div class="sbox">
      <div class="status-line"><span class="dot ${st.running ? 'on' : ''}"></span>${st.running ? t('Сервер работает · порт {port}', { port: st.port }) : t('Сервер остановлен')}</div>
      <div class="tooltip-hint">${st.running ? t('Пока LocalCord открыт (или свёрнут в трей), друзья могут подключаться. Закрытие окна не останавливает сервер.') : t('Запустите сервер, чтобы друзья могли подключиться к вам.')}</div>
      <div class="row">${st.running
        ? `<button class="btn" id="hs-invite">${icon('link', 16)} ${t('Пригласить друзей')}</button><button class="btn danger" id="hs-stop">${icon('power', 16)} ${t('Остановить сервер')}</button>`
        : `<button class="btn success" id="hs-start">${icon('power', 16)} ${t('Запустить и подключиться')}</button>`}
      </div>
    </div>`);
    root.appendChild(status);
    const sv = $('#hs-stop', status);
    if (sv) sv.onclick = () => this.stopServer();
    const ss = $('#hs-start', status);
    if (ss) ss.onclick = () => { this.close(); Flow.startHostAndConnect(); };
    const iv = $('#hs-invite', status);
    if (iv) iv.onclick = () => UI.inviteDialog();

    const form = h(`<div class="sbox">
      <h4>${t('Параметры')}</h4>
      <div class="field"><label>${t('Название сервера')}</label><input class="input" id="hs-name" maxlength="40"></div>
      <div class="row">
        <div class="field grow"><label>${t('Пароль')}</label>
          <div class="pass-box"><input class="input" id="hs-pass" type="password" placeholder="${t('Без пароля')}" autocomplete="new-password"><button class="icon-btn" id="hs-eye" type="button" title="${t('Показать пароль')}">${icon('eye', 18)}</button></div></div>
        <div class="field" style="width:120px"><label>${t('Порт')}</label><input class="input" id="hs-port" type="number" min="1024" max="65535"></div>
      </div>
      <div class="field"><label>${t('Максимальный размер файла, МБ')}</label><input class="input" id="hs-max" type="number" min="1" max="102400" style="width:160px">
        <span class="hint">${t('Файлы хранятся на этом компьютере в папке сервера. При удалении сообщения файл удаляется.')}</span></div>
      <div class="row"><button class="btn primary" id="hs-save">${t('Сохранить')}</button><span class="tooltip-hint" id="hs-note">${t('Вам как владельцу пароль вводить не нужно — он только для друзей.')}</span></div>
    </div>`);
    $('#hs-name', form).value = hs.name;
    $('#hs-pass', form).value = hs.password || '';
    $('#hs-port', form).value = hs.port;
    $('#hs-max', form).value = hs.maxFileMB;
    $('#hs-eye', form).onclick = () => { const i = $('#hs-pass', form); i.type = i.type === 'password' ? 'text' : 'password'; };
    $('#hs-save', form).onclick = async () => {
      const port = Math.max(1024, Math.min(65535, parseInt($('#hs-port', form).value, 10) || 3000));
      const patch = {
        name: $('#hs-name', form).value.trim() || defaultServerName(),
        password: $('#hs-pass', form).value,
        maxFileMB: Math.max(1, parseInt($('#hs-max', form).value, 10) || 4096),
        port,
      };
      const portChanged = port !== st.port;
      if (portChanged && st.running && !await confirmDialog(t('Порт изменён'), t('Чтобы применить новый порт, сервер нужно перезапустить. Участники переподключатся, а адрес для друзей изменится.'), { ok: t('Перезапустить') })) return;
      await App.saveSettings({ host: patch });
      if (!st.running) { toast(t('Настройки сервера сохранены'), { type: 'ok' }); return; }
      if (portChanged) { this.close(); await Flow.startHostAndConnect({ apply: true }); return; }
      const r = await App.api.host.apply();
      toast(r.ok ? t('Настройки сервера сохранены и применены') : errText(r.error), { type: r.ok ? 'ok' : 'err' });
    };
    root.appendChild(form);

    const more = h(`<div class="sbox"></div>`);
    more.appendChild(this.toggle(t('Запускать сервер вместе с LocalCord'), t('Друзья смогут зайти, как только вы откроете программу'), hs.autoStart, on => App.saveSettings({ host: { autoStart: on } })));
    const fw = await App.api.firewall.status();
    if (fw.supported) {
      const fwRow = h(`<div class="toggle-row"><div class="tr-text"><b>${t('Брандмауэр Windows')}</b><span></span></div><button class="btn"></button></div>`);
      const drawFw = s => {
        fwRow.querySelector('span').textContent = s.allowed ? t('Входящие подключения разрешены для всех сетей, включая Radmin VPN.') : t('Windows может блокировать подключения друзей (особенно через Radmin VPN). Нужны права администратора — Windows спросит один раз.');
        const b = fwRow.querySelector('button');
        b.textContent = s.allowed ? t('Разрешено') : t('Разрешить');
        b.className = s.allowed ? 'btn' : 'btn primary';
        b.disabled = s.allowed;
      };
      drawFw(fw);
      fwRow.querySelector('button').onclick = async () => { const r = await App.api.firewall.allow(); drawFw({ allowed: r.ok }); if (!r.ok) toast(t('Разрешение не выдано'), { type: 'err' }); };
      more.appendChild(fwRow);
    }
    const data = h(`<div class="toggle-row"><div class="tr-text"><b>${t('Папка сервера')}</b><span>${t('История сообщений, вложения и каналы')}</span></div><button class="btn">${icon('folder', 16)} ${t('Открыть')}</button></div>`);
    data.querySelector('button').onclick = () => App.api.host.openData();
    more.appendChild(data);
    const upd = h(`<div class="toggle-row"><div class="tr-text"><b>${t('Раздача обновлений')}</b><span>${st.canDistributeUpdate ? t('Готова: друзья со старой версией получат версию {version} в один клик.', { version: esc(App.info.version) }) : t('Файл обновления загрузится с GitHub при подключении к интернету, затем хост раздаст его друзьям.')}</span></div></div>`);
    more.appendChild(upd);
    root.appendChild(more);

    if (st.running || st.hasData) {
      const danger = h(`<div class="sbox danger-zone">
        <h4>${t('Удаление сервера')}</h4>
        <div class="tooltip-hint">${t('Сервер будет остановлен, а его каналы, история сообщений и все загруженные файлы — стёрты с этого компьютера. Ваш профиль и настройки останутся.')}</div>
        <div class="row"><button class="btn danger" id="hs-delete">${icon('trash', 16)} ${t('Удалить сервер')}</button></div>
      </div>`);
      $('#hs-delete', danger).onclick = () => this.deleteServer();
      root.appendChild(danger);
    }
  },

  /** Остановить свой сервер (данные остаются — его можно запустить снова) */
  async stopServer() {
    if (!await confirmDialog(t('Остановить сервер?'), t('Все участники будут отключены. Каналы и история сохранятся — сервер можно запустить снова.'), { ok: t('Остановить'), danger: true })) return false;
    if (App.own) Net.disconnect();
    await App.api.host.stop();
    await App.saveSettings({ mode: 'client' });
    this.close();
    UI.renderRail();
    if (!App.connected) Screens.mode();
    return true;
  },

  /** Удалить свой сервер вместе с каналами, историей и файлами */
  async deleteServer() {
    const name = App.settings.host.name;
    const typed = await promptDialog(t('Удалить сервер «{name}»?', { name }), t('Это нельзя отменить: история и файлы будут стёрты. Чтобы подтвердить, введите слово {word}', { word: t('УДАЛИТЬ') }), '', { ok: t('Удалить навсегда'), placeholder: t('УДАЛИТЬ') });
    if (typed === null) return false;
    if (typed.trim().toLowerCase() !== t('УДАЛИТЬ').toLowerCase()) { toast(t('Слово введено неверно — сервер не удалён'), { type: 'err' }); return false; }
    if (App.own) Net.disconnect();
    const r = await App.api.host.remove();
    if (!r.ok) { toast(t('Не удалось удалить файлы сервера: {error}', { error: r.error }), { type: 'err', timeout: 7000 }); return false; }
    await App.saveSettings({ mode: 'client', host: { name: 'Сервер LocalCord', password: '' } });
    this.close();
    UI.renderRail();
    toast(t('Сервер удалён'), { type: 'ok' });
    if (!App.connected) Screens.mode();
    return true;
  },

  // ---------- приложение ----------
  app(root) {
    const a = App.settings.app;
    root.appendChild(h(`<h2>${t('Приложение')}</h2>`));
    const box = h(`<div class="sbox"></div>`);
    box.appendChild(this.toggle(t('Сворачивать в трей при закрытии'), t('Крестик прячет окно, а голос и сервер продолжают работать. Выйти — правой кнопкой по значку в трее.'), a.closeToTray, on => App.saveSettings({ app: { closeToTray: on } })));
    box.appendChild(this.toggle(t('Запускать вместе с Windows'), t('LocalCord стартует свёрнутым в трей'), a.startWithWindows, async on => { await App.saveSettings({ app: { startWithWindows: on } }); App.api.app.setLoginItem(on); }));
    root.appendChild(box);

    const danger = h(`<div class="sbox">
      <h4>${t('Удаление программы')}</h4>
      <label class="check"><input type="checkbox" id="u-wipe"><span class="check-text"><b>${t('Удалить также профиль и историю')}</b><span>${t('Иначе при повторной установке всё сохранится')}</span></span></label>
      <div class="row"><button class="btn danger" id="u-go">${icon('trash', 16)} ${t('Удалить LocalCord')}</button><button class="btn ghost" id="u-quit">${icon('power', 16)} ${t('Выйти из LocalCord')}</button></div>
    </div>`);
    $('#u-go', danger).onclick = async () => {
      if (!await confirmDialog(t('Удалить LocalCord?'), t('Программа закроется и будет удалена с компьютера. Ярлыки тоже исчезнут.'), { ok: t('Удалить'), danger: true })) return;
      const r = await App.api.app.uninstall($('#u-wipe', danger).checked);
      if (!r.ok) toast(r.error === 'not-installed' ? t('Программа запущена не из установленной копии — удалите папку вручную.') : t('Не найден деинсталлятор. Удалите через «Параметры → Приложения».'), { type: 'err', timeout: 7000 });
    };
    $('#u-quit', danger).onclick = () => App.api.app.quit();
    root.appendChild(danger);
  },

  // ---------- обновления ----------
  async updates(root) {
    root.appendChild(h(`<h2>${t('Обновления')}</h2>`));
    const box = h(`<div class="sbox">
      <div class="row">${logoSvg(44)}<div class="grow"><div style="font-size:18px;font-weight:700;color:var(--text-strong)">${t('Установлена версия {version}', { version: esc(App.info.version) })}</div>
        <div class="tooltip-hint" id="up-status">${t('Проверяем…')}</div></div>
        <button class="btn" id="up-check">${icon('refresh', 16)} ${t('Проверить обновления')}</button></div>
      <div id="up-latest"></div>
    </div>`);
    root.appendChild(box);
    const opt = h(`<div class="sbox"></div>`);
    opt.appendChild(this.toggle(t('Проверять обновления при запуске'), t('Раз в день LocalCord спрашивает у GitHub номер последней версии. Больше ничего никуда не отправляется.'), App.settings.app.checkUpdates !== false, on => App.saveSettings({ app: { checkUpdates: on } })));
    root.appendChild(opt);
    const older = h(`<div class="sbox"><h4>${t('Все версии')}</h4>
      <div class="tooltip-hint">${App.api.mobile
        ? t('Android не ставит старую версию поверх новой. Чтобы вернуться, удалите приложение и установите нужный APK со страницы выпусков.')
        : t('Если новая версия работает хуже, можно вернуться на прошлую. Профиль, настройки и история сервера сохраняются.')}</div>
      <div class="rel-list" id="up-list"></div></div>`);
    root.appendChild(older);

    const load = async force => {
      $('#up-status', box).textContent = t('Проверяем…');
      $('#up-check', box).disabled = true;
      const r = await App.api.update.list(force);
      if (!this.el || this.section !== 'updates') return;
      $('#up-check', box).disabled = false;
      const latestBox = $('#up-latest', box);
      const list = $('#up-list', older);
      latestBox.innerHTML = '';
      list.innerHTML = '';
      if (!r.ok) {
        $('#up-status', box).textContent = t('Не удалось связаться с GitHub. Проверьте интернет и попробуйте позже.');
        const b = h(`<div class="row"><button class="btn">${icon('link', 16)} ${t('Открыть страницу загрузки')}</button></div>`);
        b.querySelector('button').onclick = () => App.api.app.openExternal(SITE_URL);
        latestBox.appendChild(b);
        return;
      }
      await App.saveSettings({ app: { lastUpdateCheck: Date.now() } });
      const rels = r.releases.filter(x => UI.releaseAsset(x));
      const latest = rels.find(x => !x.prerelease) || rels[0];
      const date = d => (d ? new Date(d).toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '');
      if (latest && cmpVersion(latest.version, App.info.version) > 0) {
        $('#up-status', box).textContent = t('Доступна версия {version} от {date}', { version: latest.version, date: date(latest.date) });
        const b = h(`<div class="row"><button class="btn primary">${icon('download', 16)} ${UI.canSelfUpdate() ? t('Скачать и установить') : t('Скачать версию {version}', { version: esc(latest.version) })}</button>
          <button class="btn ghost">${t('Что нового')}</button></div>`);
        const [go, notes] = b.querySelectorAll('button');
        go.onclick = () => UI.installRelease(latest);
        notes.onclick = () => App.api.app.openExternal(latest.page);
        latestBox.appendChild(b);
      } else {
        $('#up-status', box).textContent = t('У вас последняя версия.');
      }
      for (const rel of rels.slice(0, 10)) {
        const cmp = cmpVersion(rel.version, App.info.version);
        const row = h(`<div class="rel"><div class="rel-main"><b>LocalCord ${esc(rel.version)}</b><span>${esc(date(rel.date))}${cmp === 0 ? ` · ${t('установлена сейчас')}` : ''}</span></div>
          ${cmp === 0 || (cmp < 0 && App.api.mobile) ? '' : `<button class="btn">${cmp > 0 ? t('Обновить') : t('Вернуться')}</button>`}</div>`);
        const b = row.querySelector('button');
        if (b) b.onclick = () => UI.installRelease(rel);
        list.appendChild(row);
      }
      if (!rels.length) list.innerHTML = `<div class="empty-note">${t('Выпусков пока нет.')}</div>`;
    };
    $('#up-check', box).onclick = () => load(true);
    load(false);
  },

  about(root) {
    root.appendChild(h(`<h2>${t('О программе')}</h2>`));
    const box = h(`<div class="sbox">
      <div class="row">${logoSvg(56)}<div><div style="font-size:20px;font-weight:700;color:var(--text-strong)">LocalCord ${esc(App.info.version)}</div><div class="tooltip-hint">${t('Голос, чат и демонстрация экрана для своей сети. Без внешних серверов.')}</div></div></div>
      <div class="tooltip-hint">${t('Сервер:')} ${App.server ? t('{name} ({address}), версия {version}', { name: esc(App.server.name), address: esc(App.own ? t('ваш сервер') : App.address), version: esc(App.server.version) }) : t('не подключён')}</div>
      <div class="row"><button class="btn" id="ab-upd">${icon('download', 16)} ${t('Обновления')}</button>
        <button class="btn ghost" id="ab-site">${icon('link', 16)} ${t('Сайт LocalCord')}</button>
        <button class="btn ghost" id="ab-src">${t('Исходный код')}</button></div>
      <div class="tooltip-hint">${t('Бесплатно для личного некоммерческого использования (лицензия PolyForm Noncommercial). Шрифты имён — SIL Open Font License.')}</div>
    </div>`);
    $('#ab-upd', box).onclick = () => this.show('updates');
    $('#ab-site', box).onclick = () => App.api.app.openExternal(SITE_URL + (I18N.lang === 'en' ? 'en/' : ''));
    $('#ab-src', box).onclick = () => App.api.app.openExternal(`https://github.com/${GITHUB_REPO}`);
    root.appendChild(box);
  },
};
