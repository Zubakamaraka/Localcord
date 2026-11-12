// Сквозная проверка возможностей 2.2: свой сервер в списке, пароль, права владельца,
// оформление профиля, проверка микрофона, язык, обновления с GitHub (подставной адрес),
// кодирование H.264, остановка и удаление сервера.
// Windows:  npm run test:e2e        Linux без экрана:  xvfb-run -a npm run test:e2e
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { _electron: electron } = require('playwright-core');
const exe = require('electron');
const { localAddresses } = require('../src/server/discovery');

const ROOT = path.join(__dirname, '..');
const VERSION = require('../package.json').version;
const PORT = 3311;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = name => { passed++; console.log(`  ✓ ${name}`); };

// ---------- подставной «GitHub»: список выпусков и файлы установщиков ----------
const goodExe = crypto.randomBytes(64 * 1024);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
let apiPort = 0;
const fakeGithub = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${apiPort}`;
  if (req.url.startsWith('/releases')) {
    const rel = (v, digest, extra = {}) => ({
      tag_name: `v${v}`, published_at: '2026-11-11T10:00:00Z', body: `notes ${v}`, html_url: `${base}/page/${v}`,
      assets: [{ name: `LocalCord-Setup-${v}.exe`, browser_download_url: `${base}/dl/${v}.exe`, size: goodExe.length, digest: `sha256:${digest}` }],
      ...extra,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([
      rel('9.9.9', sha(goodExe)),
      rel('9.9.8', 'f'.repeat(64)),            // «повреждённый»: сумма не совпадёт
      rel(VERSION, sha(goodExe)),
      rel('2.1.3', sha(goodExe)),
      { tag_name: 'v9.9.10', draft: true, assets: [] },
    ]));
  }
  if (req.url.startsWith('/dl/')) { res.writeHead(200, { 'Content-Length': goodExe.length }); return res.end(goodExe); }
  res.writeHead(404); res.end();
});

async function launch(name, settings, env = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `lc-e2e-${name}-`));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    executablePath: exe,
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, LOCALCORD_PROFILE: profile, LOCALCORD_FAKE_MEDIA: '1', LOCALCORD_UPDATE_API: `http://127.0.0.1:${apiPort}/releases`, ...env },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { app, page, errors, profile };
}

const connected = (p, timeout = 15000) => p.waitForFunction(() => App.connected && !document.getElementById('app').classList.contains('hidden') && document.getElementById('screen').classList.contains('hidden'), null, { timeout });

(async () => {
  console.log('LocalCord e2e — возможности 2.2');
  await new Promise(r => fakeGithub.listen(0, '127.0.0.1', r));
  apiPort = fakeGithub.address().port;
  const lan = localAddresses()[0];
  assert.ok(lan, 'нужен хотя бы один сетевой адрес');
  const lanAddr = `${lan.address}:${PORT}`;

  const host = await launch('host', {
    onboarded: true, mode: 'host',
    profile: { clientId: 'e2e-host', username: 'Хост', color: '#6d5dfc' },
    host: { name: 'E2E', port: PORT, autoStart: true, password: 'old1' },
    app: { lang: 'ru', checkUpdates: false },
  });
  const hp = host.page;
  await connected(hp, 20000);
  assert.ok(await hp.evaluate(() => App.me.isHost && App.own));
  ok('хост вошёл на свой сервер с паролем, не вводя его');

  // ---------- свой сервер в списке: одна строка, вход владельцем ----------
  await hp.evaluate(() => UI.switchServer());
  await hp.click('#m-join');
  await hp.waitForSelector('#c-found .server-row', { timeout: 10000 });
  const rows = await hp.evaluate(() => [...document.querySelectorAll('#c-found .server-row')].map(r => ({ own: r.classList.contains('own'), text: r.innerText })));
  assert.equal(rows.length, 1, `свой сервер должен быть одной строкой, а не ${rows.length}`);
  assert.ok(rows[0].own && /ваш сервер/i.test(rows[0].text));
  ok('свой сервер в «Найдено в сети» — одна строка с пометкой «ваш сервер»');
  await hp.click('#c-found .server-row');
  await connected(hp);
  assert.ok(await hp.evaluate(() => App.me.isHost && App.own));
  ok('вход на свой сервер из списка — владельцем и без пароля');

  await hp.evaluate(a => Flow.connectTo(a, ''), lanAddr);
  await connected(hp);
  assert.ok(await hp.evaluate(() => App.me.isHost && App.own && App.settings.mode === 'host' && !(App.settings.servers || []).length));
  ok('вход по сетевому адресу своего же сервера — тоже владельцем (раньше был «гость»)');

  // ---------- смена пароля у работающего сервера ----------
  await hp.evaluate(() => Screens.host());
  await hp.waitForSelector('#h-pass');
  assert.equal(await hp.inputValue('#h-pass'), 'old1');
  await hp.fill('#h-pass', 'new2');
  await hp.click('#h-start');
  await connected(hp);
  assert.equal(await hp.evaluate(() => document.querySelector('#h-err')), null);
  ok('пароль поменяли при работающем сервере — хост вошёл без «Неверный пароль»');

  const friend = await launch('friend', {
    onboarded: true, profile: { clientId: 'e2e-friend', username: 'Друг', color: '#3ba55c' },
    app: { lang: 'ru', checkUpdates: false },
  });
  const fp = friend.page;
  await fp.click('#m-join');
  await fp.waitForSelector('#c-found .server-row', { timeout: 10000 });
  await fp.click('#c-found .server-row');
  await fp.waitForFunction(() => /паролем/.test(document.querySelector('#c-err')?.textContent || ''));
  await fp.fill('#c-pass', 'old1');
  await fp.click('#c-go');
  await fp.waitForFunction(() => /Неверный пароль/.test(document.querySelector('#c-err')?.textContent || ''), null, { timeout: 10000 });
  await fp.fill('#c-pass', 'new2');
  await fp.click('#c-go');
  await connected(fp);
  ok('друг: старый пароль не подходит, новый — подходит');

  // пароль из настроек сервера применяется на лету
  await hp.evaluate(() => Settings.open('host'));
  await hp.waitForSelector('#hs-pass');
  await hp.fill('#hs-pass', 'third3');
  await hp.click('#hs-save');
  await hp.waitForFunction(() => [...document.querySelectorAll('.toast')].some(x => /применены/.test(x.textContent)), null, { timeout: 5000 });
  await hp.evaluate(() => Settings.close());
  const addr = await fp.evaluate(() => App.address);
  assert.equal((await fp.evaluate(a => Net.connect(a, 'new2'), addr)).error, 'bad-password');
  assert.equal((await fp.evaluate(a => Net.connect(a, 'third3'), addr)).ok, true);
  assert.ok(await hp.evaluate(() => App.connected), 'хост остался на сервере');
  ok('пароль из настроек «Мой сервер» действует сразу, участников не выбрасывает');

  // ---------- оформление профиля ----------
  await fp.evaluate(() => Settings.open('profile'));
  await fp.click('#s-frames [data-f="gold"]');
  await fp.click('#s-fonts [data-n="pixel"]');
  await hp.waitForSelector('#members .av[data-fr="gold"]', { timeout: 5000 });
  await hp.waitForSelector('#members .nf-pixel', { timeout: 5000 });
  const ring = await hp.evaluate(() => { const st = getComputedStyle(document.querySelector('#members .av[data-fr="gold"]'), '::after'); return { bg: st.backgroundImage, pos: st.position }; });
  assert.ok(/gradient/.test(ring.bg) && ring.pos === 'absolute', 'рамка нарисована');
  const fontOk = await fp.evaluate(async () => { await document.fonts.load('16px "LC Pixel"', 'Яя'); await document.fonts.load('16px "LC Lobster"', 'Яя'); return document.fonts.check('16px "LC Pixel"', 'Яя') && document.fonts.check('16px "LC Lobster"', 'Яя'); });
  assert.ok(fontOk, 'шрифты имён загрузились из папки программы');
  ok('рамка и шрифт имени видны у другого участника');

  const gif = await fp.evaluate(async () => {
    // рисуем анимированный GIF 300×200 из 6 кадров и отдаём его как «файл пользователя»
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    const enc = GIFEncoder();
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `hsl(${i * 60} 80% 50%)`; ctx.fillRect(0, 0, 300, 200);
      ctx.fillStyle = '#fff'; ctx.fillRect(20 + i * 30, 60, 60, 60);
      const { data } = ctx.getImageData(0, 0, 300, 200);
      const pal = quantize(data, 256);
      enc.writeFrame(applyPalette(data, pal), 300, 200, { palette: pal, delay: 120 });
    }
    enc.finish();
    const url = await imageToAvatar(new File([enc.bytes()], 'anim.gif', { type: 'image/gif' }));
    const dec = new ImageDecoder({ data: Uint8Array.from(atob(url.split(',')[1]), ch => ch.charCodeAt(0)).buffer, type: 'image/gif' });
    await dec.tracks.ready;
    const { image } = await dec.decode({ frameIndex: 0 });
    const res = { head: url.slice(0, 22), frames: dec.tracks.selectedTrack.frameCount, w: image.displayWidth, h: image.displayHeight, len: url.length };
    await App.saveSettings({ profile: { avatar: url } });
    Settings.onProfileChanged();
    return res;
  });
  assert.equal(gif.head, 'data:image/gif;base64,'); assert.equal(gif.frames, 6); assert.equal(gif.w, 128); assert.equal(gif.h, 128);
  await hp.waitForFunction(() => (App.profiles['e2e-friend']?.avatar || '').startsWith('data:image/gif'), null, { timeout: 5000 });
  ok(`GIF-аватар: остался анимированным (6 кадров), уменьшен до 128×128, дошёл до хоста (${Math.round(gif.len / 1024)} КБ)`);
  await fp.evaluate(() => Settings.close());

  // ---------- проверка микрофона «услышать себя» ----------
  await fp.evaluate(() => Settings.open('voice'));
  await fp.waitForSelector('#v-in option', { state: 'attached' });
  await fp.click('#v-test');
  await fp.waitForFunction(() => Settings.micTest && Settings.micTest.echo && Settings.micTest.echo.b.connectionState === 'connected', null, { timeout: 10000 });
  await wait(1500);
  const echo = await fp.evaluate(async () => {
    const e = Settings.micTest.echo;
    let packets = 0;
    let codec = '';
    const rep = await e.b.getStats();
    for (const r of rep.values()) if (r.type === 'inbound-rtp' && r.kind === 'audio') { packets = r.packetsReceived; codec = (rep.get(r.codecId) || {}).mimeType; }
    return { packets, codec, delay: e.node.delayTime.value, meter: parseFloat(document.querySelector('#v-meter').style.width) };
  });
  assert.ok(echo.packets > 20, 'звук идёт через кодек'); assert.equal(echo.codec, 'audio/opus'); assert.equal(echo.delay, 2);
  await fp.click('#v-test');
  assert.equal(await fp.evaluate(() => Settings.micTest), null);
  ok('проверка микрофона: голос проходит кодек Opus и возвращается с задержкой 2 с; остановка работает');

  // ---------- язык ----------
  await fp.evaluate(() => Settings.open('look'));
  await fp.click('#l-seg [data-l="en"]');
  await fp.waitForFunction(() => /Appearance & language/.test(document.querySelector('.settings-nav')?.innerText || ''));
  const en = await fp.evaluate(() => {
    Settings.close();
    return {
      cats: [...document.querySelectorAll('#channel-list .cat-name')].map(x => x.textContent),
      ph: document.querySelector('#message-input').placeholder,
      title: document.querySelector('#win-min').title,
      me: document.querySelector('#user-panel .me-sub').textContent,
      htmlLang: document.documentElement.lang,
    };
  });
  assert.deepEqual(en.cats, ['Text channels', 'Voice channels']);
  assert.ok(/^Message #/.test(en.ph)); assert.equal(en.title, 'Minimize'); assert.equal(en.me, 'Online'); assert.equal(en.htmlLang, 'en');
  // всё видимое в настройках — без русских букв (кроме имён и названий, которые ввели люди)
  for (const sec of ['profile', 'voice', 'notify', 'look', 'app', 'updates', 'about']) {
    const text = await fp.evaluate(async s => { Settings.open(s); await new Promise(r => setTimeout(r, 700)); return document.querySelector('.settings').innerText; }, sec);
    const ru = text.replace(/Друг|Хост|Русский|E2E/g, '').match(/[А-Яа-яЁё][А-Яа-яЁё ,.!?-]*/g);
    assert.equal(ru, null, `раздел ${sec}: остался русский текст: ${ru && ru.slice(0, 3).join(' | ')}`);
  }
  ok('английский язык: интерфейс и все разделы настроек переведены, переключение без перезапуска');

  // ---------- обновления с «GitHub» ----------
  await fp.evaluate(() => Settings.open('updates'));
  await fp.waitForSelector('#up-list .rel', { timeout: 10000 });
  const upd = await fp.evaluate(() => ({
    status: document.querySelector('#up-status').textContent,
    rows: [...document.querySelectorAll('#up-list .rel')].map(r => [r.querySelector('b').textContent, r.querySelector('button')?.textContent || '-']),
  }));
  assert.ok(/9\.9\.9/.test(upd.status));
  assert.deepEqual(upd.rows, [['LocalCord 9.9.9', 'Update'], ['LocalCord 9.9.8', 'Update'], [`LocalCord ${VERSION}`, '-'], ['LocalCord 2.1.3', 'Go back']]);
  const f1 = await fp.evaluate(() => App.api.update.fetch('v9.9.9'));
  assert.deepEqual(f1, { ok: true, version: '9.9.9' });
  const cached = path.join(friend.profile, 'update-cache', 'LocalCord-Setup-9.9.9.exe');
  assert.ok(fs.readFileSync(cached).equals(goodExe));
  const f2 = await fp.evaluate(() => App.api.update.fetch('v9.9.8'));
  assert.deepEqual(f2, { ok: false, error: 'checksum' });
  assert.ok(!fs.existsSync(path.join(friend.profile, 'update-cache', 'LocalCord-Setup-9.9.8.exe')), 'повреждённый файл не остаётся на диске');
  assert.equal((await fp.evaluate(() => App.api.update.fetch('v0.0.1'))).error, 'not-found');
  ok('обновления: список выпусков, новая версия и откат; файл с неверной контрольной суммой отвергается');
  await fp.evaluate(async () => { await App.saveSettings({ app: { lang: 'ru' } }); UI.applyLanguage(); Settings.close(); });
  assert.equal(await fp.evaluate(() => document.querySelector('#channel-list .cat-name').textContent), 'Текстовые каналы');

  // ---------- трансляция: H.264 и сведения о качестве ----------
  await hp.evaluate(() => { window.LC_FORCE_H264 = true; });
  await fp.click('.chan >> text=Общий голосовой');
  await fp.waitForFunction(() => Voice.channel);
  await hp.click('.chan >> text=Общий голосовой');
  await hp.waitForFunction(() => [...Voice.peers.values()].some(p => p.pc.connectionState === 'connected'), null, { timeout: 15000 });
  await hp.click('[data-v="share"]');
  await hp.waitForSelector('.src');
  assert.ok(await hp.evaluate(() => [...document.querySelectorAll('#q-seg [data-q]')].map(b => b.dataset.q).join()).then(s => s === '720p30,1080p30,1080p60,1440p60,source60'));
  await hp.click('.modal-foot .btn.primary');
  await fp.waitForSelector('.tile .t-watch button', { timeout: 10000 });
  await fp.click('.tile .t-watch button');
  await fp.waitForFunction(() => Viewer.video && Viewer.video.videoWidth > 0, null, { timeout: 20000 });
  const codec = await fp.evaluate(async () => {
    const pc = [...Voice.peers.values()][0].pc;
    for (let i = 0; i < 20; i++) {
      const rep = await pc.getStats();
      for (const r of rep.values()) if (r.type === 'inbound-rtp' && r.kind === 'video' && r.framesDecoded > 0) return (rep.get(r.codecId) || {}).mimeType;
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  });
  assert.equal(codec, 'video/H264');
  await hp.waitForSelector('.tile .t-stats', { timeout: 8000 });
  const badge = await hp.evaluate(() => document.querySelector('.tile .t-stats').textContent);
  assert.ok(/\d+×\d+ · \d+ к\/с · H264/.test(badge), badge);
  ok(`трансляция в H.264 доходит до зрителя; на плитке хоста видно, что уходит: «${badge}»`);
  await hp.click('[data-v="share"]');

  const stereo = await hp.evaluate(async () => {
    const pc = new RTCPeerConnection();
    pc.addTransceiver('audio'); pc.addTransceiver('audio'); pc.addTransceiver('video');
    const offer = await pc.createOffer();
    const sdp = stereoScreenAudio(offer.sdp, '0');
    await pc.setLocalDescription({ type: 'offer', sdp });
    const secs = pc.localDescription.sdp.split(/(?=^m=)/m).filter(s => s.startsWith('m=audio'));
    pc.close();
    return secs.map(s => /a=fmtp:\d+ [^\r\n]*stereo=1/.test(s));
  });
  assert.deepEqual(stereo, [false, true]);
  ok('звук трансляции помечается как стерео, линия микрофона не меняется');

  // ---------- недавние серверы: убрать из списка ----------
  await fp.evaluate(() => Screens.mode());
  await fp.waitForSelector('#m-recent .server-row .srv-x');
  await fp.click('#m-recent .server-row .srv-x');
  await fp.waitForFunction(() => !document.querySelector('#m-recent'));
  assert.equal(await fp.evaluate(() => App.settings.servers.length), 0);
  ok('сервер убирается из «Недавних» крестиком');
  await fp.evaluate(() => Screens.hide());

  // ---------- остановка и удаление своего сервера ----------
  await hp.evaluate(() => { Settings.stopServer(); });
  await hp.waitForSelector('.modal-foot .btn.danger');
  await hp.click('.modal-foot .btn.danger');
  await hp.waitForFunction(async () => !(await App.api.host.status()).running, null, { timeout: 8000 });
  const st1 = await hp.evaluate(() => App.api.host.status());
  assert.equal(st1.enabled, false); assert.equal(st1.hasData, true);
  await fp.waitForFunction(() => !App.connected, null, { timeout: 15000 });
  assert.equal((await host.app.evaluate(() => 1)), 1);
  ok('сервер остановлен: друзья отключены, данные на месте');

  // после перезапуска программы остановленный сервер сам не поднимается
  const saved = JSON.parse(fs.readFileSync(path.join(host.profile, 'settings.json'), 'utf8'));
  assert.equal(saved.host.enabled, false); assert.equal(saved.mode, 'client');
  await hp.waitForSelector('#m-host');
  assert.ok(/остановлен/.test(await hp.evaluate(() => document.querySelector('#m-host').innerText)));
  await hp.click('#m-host');
  await hp.waitForSelector('#h-start');
  await hp.click('#h-start');
  await connected(hp, 20000);
  await fp.waitForFunction(() => App.connected, null, { timeout: 25000 });
  ok('остановленный сервер запускается снова, друг возвращается сам');

  await hp.evaluate(() => { Settings.deleteServer(); });
  await hp.waitForSelector('.modal .input');
  await hp.fill('.modal .input', 'не то слово');
  await hp.click('.modal-foot .btn.primary');
  await wait(500);
  assert.equal((await hp.evaluate(() => App.api.host.status())).running, true, 'без слова-подтверждения сервер не удаляется');
  await hp.evaluate(() => { Settings.deleteServer(); });
  await hp.waitForSelector('.modal .input');
  await hp.fill('.modal .input', 'удалить');
  await hp.click('.modal-foot .btn.primary');
  await hp.waitForFunction(async () => { const s = await App.api.host.status(); return !s.running && !s.hasData; }, null, { timeout: 8000 });
  assert.ok(!fs.existsSync(path.join(host.profile, 'server-data', 'channels.json')));
  await hp.waitForSelector('#m-host');
  assert.ok(/Создать сервер/.test(await hp.evaluate(() => document.querySelector('#m-host').innerText)));
  ok('сервер удалён вместе с историей (только после слова-подтверждения)');

  assert.deepEqual(host.errors, []);
  assert.deepEqual(friend.errors, []);
  ok('ошибок JavaScript нет');
  await friend.app.close();
  await host.app.close();

  // ---------- первый запуск на английском + напоминание об обновлении ----------
  const eng = await launch('en', { app: { lang: 'en', checkUpdates: true }, host: { port: PORT + 1 } });
  const ep = eng.page;
  await ep.waitForSelector('#ob-name');
  assert.ok(/Welcome to LocalCord/.test(await ep.evaluate(() => document.querySelector('#screen').innerText)));
  await ep.click('#ob-lang [data-l="ru"]');
  await ep.waitForFunction(() => /Добро пожаловать/.test(document.querySelector('#screen').innerText));
  await ep.click('#ob-lang [data-l="en"]');
  await ep.waitForFunction(() => /Welcome/.test(document.querySelector('#screen').innerText));
  await ep.fill('#ob-name', 'Mike');
  await ep.click('#ob-next');
  await ep.click('#m-host');
  assert.equal(await ep.inputValue('#h-name'), 'Mike’s server');
  await ep.click('#h-start');
  await connected(ep, 20000);
  const chans = await ep.evaluate(() => App.channels.map(c => c.name));
  assert.deepEqual(chans, ['general', 'games', 'memes-and-screenshots', 'General voice', 'Gaming']);
  await ep.waitForSelector('.modal');
  assert.ok(/invite your friends/i.test(await ep.evaluate(() => document.querySelector('.modal').innerText)));
  await ep.click('.modal-foot .btn.primary');
  ok('первый запуск на английском: выбор языка на первом экране, сервер и каналы — по-английски');
  await ep.waitForFunction(() => /9\.9\.9/.test(document.querySelector('#banners')?.innerText || ''), null, { timeout: 15000 });
  ok('при запуске программа сама сообщает о новой версии');
  const tray = await eng.app.evaluate(({ Menu }) => 1);
  assert.equal(tray, 1);
  assert.deepEqual(eng.errors, []);
  await eng.app.close();

  fakeGithub.close();
  console.log(`\nВсе проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error('\nОШИБКА:', e); process.exit(1); });
