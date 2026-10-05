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
        <div class="nav-cat">Пользователь</div>
        <button data-s="profile">${icon('user', 18)} Мой профиль</button>
        <button data-s="voice">${icon('mic', 18)} Голос и видео</button>
        <button data-s="notify">${icon('bell', 18)} Уведомления</button>
        <button data-s="look">${icon('palette', 18)} Внешний вид</button>
        ${isElectron ? `<div class="nav-cat">Сервер</div><button data-s="host">${icon('server', 18)} Мой сервер</button>` : ''}
        <div class="nav-cat">Приложение</div>
        ${isElectron ? `<button data-s="app">${icon('settings', 18)} Приложение</button>` : ''}
        <button data-s="about">${icon('info', 18)} О программе</button>
        <hr>
        <button data-s="disconnect" class="danger">${icon('logout', 18)} Сменить сервер</button>
      </nav></div>
      <div class="settings-body"><div class="inner"></div></div>
      <div class="settings-close"><button class="icon-btn" title="Закрыть (Esc)">${icon('x', 20)}</button><span>ESC</span></div>
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
    const fn = { profile: this.profile, voice: this.voice, notify: this.notify, look: this.look, host: this.host, app: this.app, about: this.about }[section];
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
    root.appendChild(h(`<h2>Мой профиль</h2>`));
    const box = h(`<div class="sbox">
      <div class="avatar-pick">
        <div class="av-wrap" id="s-av" title="Сменить фото"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div style="font-size:20px;font-weight:700;color:var(--text-strong)" id="s-name-view"></div>
          <div class="tooltip-hint">Профиль хранится на этом компьютере и автоматически передаётся серверу при входе.</div>
        </div>
      </div>
      <div class="field"><label>Имя</label><div class="row"><input class="input grow" id="s-name" maxlength="32"><button class="btn primary" id="s-save">Сохранить</button></div></div>
      <div class="field"><label>Цвет</label><div class="swatches" id="s-colors"></div></div>
      <div class="row"><button class="btn" id="s-photo">${icon('image', 16)} Загрузить фото</button><button class="btn ghost" id="s-photo-rm">Убрать фото</button></div>
    </div>`);
    root.appendChild(box);
    const draw = () => {
      const s = App.settings.profile;
      $('#s-av', box).innerHTML = avatarHtml(s, 80) + `<div class="av-edit">${icon('image', 14)}</div>`;
      $('#s-name-view', box).textContent = s.username;
      $('#s-colors', box).innerHTML = COLOR_CHOICES.map(c => `<button class="swatch ${c === s.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
      $('#s-photo-rm', box).classList.toggle('hidden', !s.avatar);
    };
    $('#s-name', box).value = p.username;
    const save = async patch => { await App.saveSettings({ profile: patch }); draw(); this.onProfileChanged(); };
    $('#s-save', box).onclick = () => { const n = $('#s-name', box).value.trim(); if (n) save({ username: n }); };
    $('#s-name', box).onkeydown = e => { if (e.key === 'Enter') $('#s-save', box).click(); };
    $('#s-colors', box).onclick = e => { const s = e.target.closest('.swatch'); if (s) save({ color: s.dataset.c }); };
    const pick = async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      try { save({ avatar: await imageToAvatar(f) }); } catch { toast('Не удалось открыть картинку', { type: 'err' }); }
    };
    $('#s-av', box).onclick = pick;
    $('#s-photo', box).onclick = pick;
    $('#s-photo-rm', box).onclick = () => save({ avatar: null });
    draw();
  },

  onProfileChanged() {
    const p = App.settings.profile;
    Net.emit('profile-update', { username: p.username, color: p.color, avatar: p.avatar });
    UI.renderUserPanel();
  },

  // ---------- голос ----------
  async voice(root) {
    const v = App.settings.voice;
    root.appendChild(h(`<h2>Голос и видео</h2>`));
    const box = h(`<div class="sbox">
      <div class="row">
        <div class="field grow"><label>Микрофон</label><select class="select" id="v-in"></select></div>
        <div class="field grow"><label>Динамики / наушники</label><select class="select" id="v-out"></select></div>
      </div>
      <div class="field"><label>Проверка микрофона</label>
        <div class="row"><button class="btn" id="v-test">${icon('mic', 16)} Проверить</button><div class="meter grow"><i id="v-meter"></i></div></div>
        <span class="hint">Скажите что-нибудь — полоска должна двигаться.</span></div>
    </div>`);
    root.appendChild(box);
    const proc = h(`<div class="sbox"><h4>Обработка звука</h4></div>`);
    const setV = async (patch, apply) => { await App.saveSettings({ voice: patch }); apply && apply(); };
    proc.appendChild(this.toggle('Шумоподавление', 'Убирает гул, клавиатуру и фоновые шумы', v.noiseSuppression, on => setV({ noiseSuppression: on }, () => Voice.applyInput())));
    proc.appendChild(this.toggle('Эхоподавление', 'Нужно, если вы без наушников', v.echoCancellation, on => setV({ echoCancellation: on }, () => Voice.applyInput())));
    proc.appendChild(this.toggle('Автоусиление', 'Выравнивает громкость голоса', v.autoGainControl, on => setV({ autoGainControl: on }, () => Voice.applyInput())));
    root.appendChild(proc);
    root.appendChild(h(`<div class="sbox"><h4>Горячие клавиши (когда окно LocalCord активно)</h4>
      <div class="hotkeys">
        <span class="kbd">Ctrl+Shift+M</span><span>Выключить / включить микрофон</span>
        <span class="kbd">Ctrl+Shift+D</span><span>Выключить / включить звук</span>
        <span class="kbd">F</span><span>Трансляция на весь экран (или двойной щелчок по ней)</span>
        <span class="kbd">Esc</span><span>Выйти из полноэкранного режима, ещё раз — свернуть трансляцию в мини-окно</span>
      </div></div>`));

    let devices = [];
    try {
      // доступ к названиям устройств появляется после разрешения микрофона
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      devices = await navigator.mediaDevices.enumerateDevices();
      tmp && tmp.getTracks().forEach(t => t.stop());
    } catch { /* ignore */ }
    if (!this.el) return;
    const fill = (sel, kind, cur) => {
      const list = devices.filter(d => d.kind === kind && d.deviceId !== 'communications');
      sel.innerHTML = `<option value="default">По умолчанию (как в Windows)</option>` +
        list.filter(d => d.deviceId !== 'default').map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Устройство')}</option>`).join('');
      sel.value = list.some(d => d.deviceId === cur) ? cur : 'default';
    };
    fill($('#v-in', box), 'audioinput', v.inputId);
    fill($('#v-out', box), 'audiooutput', v.outputId);
    $('#v-in', box).onchange = e => setV({ inputId: e.target.value }, () => { Voice.applyInput(); if (this.micTest) this.startMicTest(box); });
    $('#v-out', box).onchange = e => setV({ outputId: e.target.value }, () => Voice.applyOutput());
    $('#v-test', box).onclick = () => (this.micTest ? this.stopMicTest() : this.startMicTest(box));
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
        for (const b of buf) { const x = (b - 128) / 128; s += x * x; }
        meter.style.width = Math.min(100, Math.sqrt(s / buf.length) * 400) + '%';
      }, 60);
      this.micTest = { stream, ctx, timer, meter, btn: $('#v-test', box) };
      this.micTest.btn.innerHTML = `${icon('x', 16)} Остановить`;
    } catch { toast('Микрофон недоступен', { type: 'err' }); }
  },

  stopMicTest() {
    const t = this.micTest;
    if (!t) return;
    this.micTest = null;
    clearInterval(t.timer);
    t.stream.getTracks().forEach(x => x.stop());
    t.ctx.close();
    if (t.meter) t.meter.style.width = '0';
    if (t.btn && t.btn.isConnected) t.btn.innerHTML = `${icon('mic', 16)} Проверить`;
  },

  // ---------- уведомления ----------
  notify(root) {
    const a = App.settings.app;
    root.appendChild(h(`<h2>Уведомления</h2>`));
    const box = h(`<div class="sbox"></div>`);
    box.appendChild(this.toggle('Уведомления на рабочем столе', 'Когда окно LocalCord свёрнуто или неактивно', a.notifications, on => App.saveSettings({ app: { notifications: on } })));
    box.appendChild(this.toggle('Звуки', 'Вход и выход из голосового канала, новые сообщения, микрофон', a.sounds, on => App.saveSettings({ app: { sounds: on } })));
    root.appendChild(box);
  },

  // ---------- внешний вид ----------
  look(root) {
    const ui = App.settings.ui;
    root.appendChild(h(`<h2>Внешний вид</h2>`));
    const themes = h(`<div class="sbox"><h4>Тема</h4><div class="theme-grid"></div></div>`);
    const grid = themes.querySelector('.theme-grid');
    for (const t of THEMES) {
      const [r, sd, m, a, tx] = t.c;
      const card = h(`<button class="theme-card ${(ui.theme || 'graphite') === t.id ? 'on' : ''}" data-t="${t.id}" title="${esc(t.hint)}">
        <div class="tp"><i class="r" style="background:${r}"></i>
          <div class="s" style="background:${sd}"><b style="background:${tx};width:80%"></b><b style="background:${tx};width:60%"></b><b style="background:${a};opacity:1;width:70%"></b></div>
          <div class="m" style="background:${m}"><b style="background:${tx};opacity:.5;width:70%"></b><b style="background:${tx};opacity:.35;width:45%"></b><b style="background:${a};width:30%"></b></div></div>
        <div class="tn">${esc(t.name)}</div></button>`);
      grid.appendChild(card);
    }
    grid.onclick = async e => {
      const c = e.target.closest('[data-t]');
      if (!c) return;
      await Theme.set({ theme: c.dataset.t });
      $$('.theme-card', grid).forEach(x => x.classList.toggle('on', x === c));
    };
    root.appendChild(themes);

    const acc = h(`<div class="sbox"><h4>Цвет акцента</h4>
      <div class="tooltip-hint">Кнопки, выделение, ссылки. «Как в теме» — цвет, подобранный к выбранной палитре.</div>
      <div class="accent-row"></div></div>`);
    const row = acc.querySelector('.accent-row');
    const drawAcc = () => {
      const cur = App.settings.ui.accent;
      row.innerHTML = `<button class="accent-dot auto ${!cur ? 'on' : ''}" data-a="" title="Как в теме"></button>` +
        ACCENTS.map(c => `<button class="accent-dot ${cur === c ? 'on' : ''}" data-a="${c}" style="background:${c}" title="${c}"></button>`).join('') +
        `<label class="accent-dot custom ${cur && !ACCENTS.includes(cur) ? 'on' : ''}" title="Свой цвет" ${cur && !ACCENTS.includes(cur) ? `style="background:${cur};color:#fff"` : ''}>${icon('plus', 16)}<input type="color" value="${cur || '#6d5dfc'}"></label>`;
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

    const size = h(`<div class="sbox"><h4>Размер интерфейса</h4><div class="seg"></div>
      <div class="tooltip-hint">Увеличивает текст и кнопки целиком, без потери чёткости.</div></div>`);
    const seg = size.querySelector('.seg');
    const drawSize = () => {
      const cur = App.settings.ui.scale || 100;
      seg.innerHTML = SCALES.map(v => `<button data-z="${v}" class="${v === cur ? 'on' : ''}">${v}%</button>`).join('');
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
    root.appendChild(h(`<h2>Мой сервер</h2>`));
    const status = h(`<div class="sbox">
      <div class="status-line"><span class="dot ${st.running ? 'on' : ''}"></span>${st.running ? `Сервер работает · порт ${st.port}` : 'Сервер остановлен'}</div>
      <div class="tooltip-hint">${st.running ? 'Пока LocalCord открыт (или свёрнут в трей), друзья могут подключаться. Закрытие окна не останавливает сервер.' : 'Запустите сервер, чтобы друзья могли подключиться к вам.'}</div>
      <div class="row">${st.running
        ? `<button class="btn" id="hs-invite">${icon('link', 16)} Пригласить друзей</button><button class="btn danger" id="hs-stop">${icon('power', 16)} Остановить</button>`
        : `<button class="btn success" id="hs-start">${icon('power', 16)} Запустить и подключиться</button>`}
      </div>
    </div>`);
    root.appendChild(status);
    const sv = $('#hs-stop', status);
    if (sv) sv.onclick = async () => {
      if (!await confirmDialog('Остановить сервер?', 'Все участники будут отключены.', { ok: 'Остановить', danger: true })) return;
      if (Net.isLocal(App.address)) Net.disconnect();
      await App.api.host.stop();
      await App.saveSettings({ mode: 'client' });
      this.close();
      Screens.mode();
    };
    const ss = $('#hs-start', status);
    if (ss) ss.onclick = () => { this.close(); Flow.startHostAndConnect(); };
    const iv = $('#hs-invite', status);
    if (iv) iv.onclick = () => UI.inviteDialog();

    const form = h(`<div class="sbox">
      <h4>Параметры</h4>
      <div class="field"><label>Название сервера</label><input class="input" id="hs-name" maxlength="40"></div>
      <div class="row">
        <div class="field grow"><label>Пароль</label><input class="input" id="hs-pass" type="password" placeholder="Без пароля" autocomplete="new-password"></div>
        <div class="field" style="width:120px"><label>Порт</label><input class="input" id="hs-port" type="number" min="1024" max="65535"></div>
      </div>
      <div class="field"><label>Максимальный размер файла, МБ</label><input class="input" id="hs-max" type="number" min="1" max="102400" style="width:160px">
        <span class="hint">Файлы хранятся на этом компьютере в папке сервера. При удалении сообщения файл удаляется.</span></div>
      <div class="row"><button class="btn primary" id="hs-save">Сохранить</button><span class="tooltip-hint" id="hs-note"></span></div>
    </div>`);
    $('#hs-name', form).value = hs.name;
    $('#hs-pass', form).value = hs.password || '';
    $('#hs-port', form).value = hs.port;
    $('#hs-max', form).value = hs.maxFileMB;
    $('#hs-save', form).onclick = async () => {
      const port = Math.max(1024, Math.min(65535, parseInt($('#hs-port', form).value, 10) || 3000));
      const patch = {
        name: $('#hs-name', form).value.trim() || 'Сервер LocalCord',
        password: $('#hs-pass', form).value,
        maxFileMB: Math.max(1, parseInt($('#hs-max', form).value, 10) || 4096),
        port,
      };
      const portChanged = port !== hs.port;
      await App.saveSettings({ host: patch });
      await App.api.host.update(patch);
      if (portChanged && st.running) {
        if (await confirmDialog('Порт изменён', 'Чтобы применить новый порт, сервер нужно перезапустить. Участники переподключатся.', { ok: 'Перезапустить' })) {
          Net.disconnect();
          await App.api.host.stop();
          this.close();
          await Flow.startHostAndConnect();
          return;
        }
      }
      toast('Настройки сервера сохранены', { type: 'ok' });
    };
    root.appendChild(form);

    const more = h(`<div class="sbox"></div>`);
    more.appendChild(this.toggle('Запускать сервер вместе с LocalCord', 'Друзья смогут зайти, как только вы откроете программу', hs.autoStart, on => App.saveSettings({ host: { autoStart: on } })));
    const fw = await App.api.firewall.status();
    if (fw.supported) {
      const fwRow = h(`<div class="toggle-row"><div class="tr-text"><b>Брандмауэр Windows</b><span></span></div><button class="btn"></button></div>`);
      const drawFw = s => {
        fwRow.querySelector('span').textContent = s.allowed ? 'Входящие подключения разрешены для всех сетей, включая Radmin VPN.' : 'Windows может блокировать подключения друзей (особенно через Radmin VPN). Нужны права администратора — Windows спросит один раз.';
        const b = fwRow.querySelector('button');
        b.textContent = s.allowed ? 'Разрешено' : 'Разрешить';
        b.className = s.allowed ? 'btn' : 'btn primary';
        b.disabled = s.allowed;
      };
      drawFw(fw);
      fwRow.querySelector('button').onclick = async () => { const r = await App.api.firewall.allow(); drawFw({ allowed: r.ok }); if (!r.ok) toast('Разрешение не выдано', { type: 'err' }); };
      more.appendChild(fwRow);
    }
    const data = h(`<div class="toggle-row"><div class="tr-text"><b>Папка сервера</b><span>История сообщений, вложения и каналы</span></div><button class="btn">${icon('folder', 16)} Открыть</button></div>`);
    data.querySelector('button').onclick = () => App.api.host.openData();
    more.appendChild(data);
    const upd = h(`<div class="toggle-row"><div class="tr-text"><b>Раздача обновлений</b><span>${st.canDistributeUpdate ? 'Готова: друзья со старой версией получат версию ' + esc(App.info.version) + ' в один клик.' : 'Файл обновления загрузится с GitHub при подключении к интернету, затем хост раздаст его друзьям.'}</span></div></div>`);
    more.appendChild(upd);
    root.appendChild(more);
  },

  // ---------- приложение ----------
  app(root) {
    const a = App.settings.app;
    root.appendChild(h(`<h2>Приложение</h2>`));
    const box = h(`<div class="sbox"></div>`);
    box.appendChild(this.toggle('Сворачивать в трей при закрытии', 'Крестик прячет окно, а голос и сервер продолжают работать. Выйти — правой кнопкой по значку в трее.', a.closeToTray, on => App.saveSettings({ app: { closeToTray: on } })));
    box.appendChild(this.toggle('Запускать вместе с Windows', 'LocalCord стартует свёрнутым в трей', a.startWithWindows, async on => { await App.saveSettings({ app: { startWithWindows: on } }); App.api.app.setLoginItem(on); }));
    root.appendChild(box);

    const danger = h(`<div class="sbox">
      <h4>Удаление</h4>
      <label class="check"><input type="checkbox" id="u-wipe"><span class="check-text"><b>Удалить также профиль и историю</b><span>Иначе при повторной установке всё сохранится</span></span></label>
      <div class="row"><button class="btn danger" id="u-go">${icon('trash', 16)} Удалить LocalCord</button><button class="btn ghost" id="u-quit">${icon('power', 16)} Выйти из LocalCord</button></div>
    </div>`);
    $('#u-go', danger).onclick = async () => {
      if (!await confirmDialog('Удалить LocalCord?', 'Программа закроется и будет удалена с компьютера. Ярлыки тоже исчезнут.', { ok: 'Удалить', danger: true })) return;
      const r = await App.api.app.uninstall($('#u-wipe', danger).checked);
      if (!r.ok) toast(r.error === 'not-installed' ? 'Программа запущена не из установленной копии — удалите папку вручную.' : 'Не найден деинсталлятор. Удалите через «Параметры → Приложения».', { type: 'err', timeout: 7000 });
    };
    $('#u-quit', danger).onclick = () => App.api.app.quit();
    root.appendChild(danger);
  },

  about(root) {
    root.appendChild(h(`<h2>О программе</h2>`));
    const box = h(`<div class="sbox">
      <div class="row">${logoSvg(56)}<div><div style="font-size:20px;font-weight:700;color:var(--text-strong)">LocalCord ${esc(App.info.version)}</div><div class="tooltip-hint">Голос, чат и демонстрация экрана для своей сети. Без внешних серверов.</div></div></div>
      <div class="tooltip-hint">Сервер: ${App.server ? `${esc(App.server.name)} (${esc(App.address)}), версия ${esc(App.server.version)}` : 'не подключён'}</div>
      <div class="row"><button class="btn" id="ab-upd">${icon('refresh', 16)} Проверить обновление у хоста</button></div>
    </div>`);
    $('#ab-upd', box).onclick = () => { if (!UI.checkUpdate({ manual: true })) toast('У вас актуальная версия'); };
    root.appendChild(box);
  },
};
