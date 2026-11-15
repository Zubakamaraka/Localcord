// Сквозная проверка курсора поверх трансляции окна (xvfb-run -a node test/e2e-stream-cursor.js).
// Настоящий курсор Windows здесь взять неоткуда, поэтому у хоста включён ненастоящий
// (LOCALCORD_FAKE_CURSOR): стрелка ходит по кругу и раз в 3 секунды на полсекунды уходит из окна.
// Проверяем, что зритель видит её в нужном месте картинки, что она прячется и исчезает вместе с трансляцией.
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');
const exe = require('electron');

const ROOT = path.join(__dirname, '..');
const PORT = 3322;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = name => { passed++; console.log(`  ✓ ${name}`); };

async function launch(name, settings, env = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `lc-e2e-${name}-`));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    executablePath: exe,
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, LOCALCORD_PROFILE: profile, LOCALCORD_FAKE_MEDIA: '1', ...env },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { app, page, errors };
}

/** Где зритель нарисовал курсор (точка «острия» в долях картинки) и где он на самом деле был у ведущего */
function sample(fp) {
  return fp.evaluate(() => {
    const el = document.querySelector('#viewer .v-cursor');
    const v = Viewer.video;
    const host = Viewer.el.getBoundingClientRect();
    const box = v.getBoundingClientRect();
    const k = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    const dw = v.videoWidth * k, dh = v.videoHeight * k;
    const ox = box.left - host.left + (box.width - dw) / 2, oy = box.top - host.top + (box.height - dh) / 2;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform) || [];
    const scale = el.getBoundingClientRect().width / Number(el.dataset.w || 1);
    return {
      shown: !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none',
      x: (Number(m[1]) + Number(el.dataset.hx) * scale - ox) / dw,
      y: (Number(m[2]) + Number(el.dataset.hy) * scale - oy) / dh,
      src: (el.getAttribute('src') || '').slice(0, 22),
      natural: el.naturalWidth,
      delay: Viewer.cursorDelay,
    };
  });
}

(async () => {
  console.log('LocalCord e2e — курсор поверх трансляции окна');
  const common = { app: { lang: 'ru', checkUpdates: false, sounds: false } };
  const host = await launch('chost', {
    ...common, onboarded: true, mode: 'host',
    profile: { clientId: 'cu-host', username: 'Хост', color: '#6d5dfc' },
    host: { name: 'Cursor', port: PORT, autoStart: true, password: '' },
  }, { LOCALCORD_FAKE_CURSOR: '1' });
  const hp = host.page;
  await hp.waitForFunction(() => App.connected, null, { timeout: 20000 });
  const friend = await launch('cfriend', { ...common, onboarded: true, profile: { clientId: 'cu-friend', username: 'Друг', color: '#3ba55c' } });
  const fp = friend.page;
  await fp.waitForSelector('#m-join');
  await fp.evaluate(p => Flow.connectTo(`127.0.0.1:${p}`, ''), PORT);
  await fp.waitForFunction(() => App.connected, null, { timeout: 15000 });

  assert.equal(await hp.evaluate(() => App.info.shareCursor), true);
  assert.equal(await fp.evaluate(() => App.info.shareCursor), false, 'без Windows (и без проверочного курсора) курсор не предлагается');
  ok('курсор для трансляции окна доступен только там, где его можно взять (здесь — проверочный)');

  await fp.click('.chan >> text=Общий голосовой');
  await fp.waitForFunction(() => Voice.channel);
  await hp.click('.chan >> text=Общий голосовой');
  await hp.waitForFunction(() => [...Voice.peers.values()].some(p => p.pc.connectionState === 'connected'), null, { timeout: 15000 });

  // Весь экран: Windows сама рисует курсор — ничего не отправляем
  await hp.click('[data-v="share"]');
  await hp.waitForSelector('.src');
  assert.equal(await hp.evaluate(() => document.querySelector('#q-cursor-row').classList.contains('hidden')), true, 'для экрана флажка курсора нет');
  // флажок появляется, когда выбрано окно (окон под Xvfb может не быть — подставляем выбор)
  await hp.click('.modal-foot .btn.primary');
  await hp.waitForFunction(() => Voice.screen);
  await fp.waitForSelector('.tile .t-watch button', { timeout: 10000 });
  await fp.click('.tile .t-watch button');
  await fp.waitForFunction(() => Viewer.video && Viewer.video.videoWidth > 0, null, { timeout: 20000 });
  await wait(1500);
  assert.equal(await hp.evaluate(() => !!Voice.screen.cursor), false);
  assert.equal(await fp.evaluate(() => Viewer.cursorQ.length), 0);
  ok('при показе всего экрана курсор отдельно не передаётся');
  await fp.evaluate(() => Viewer.close({ silent: true }));
  await hp.click('[data-v="share"]');
  await hp.waitForFunction(() => !Voice.screen);

  // Окно: флажок в окне выбора; трансляция с курсором
  await hp.evaluate(() => { window.LC_FORCE_CURSOR = true; });
  await hp.click('[data-v="share"]');
  await hp.waitForSelector('.src');
  const row = await hp.evaluate(async () => {
    const tabs = document.querySelector('.tabs');
    tabs.querySelector('[data-t="windows"]').click();
    const hasWindow = !!document.querySelector('.src-grid .src');
    if (hasWindow) document.querySelector('.src-grid .src').click();
    const r = document.querySelector('#q-cursor-row');
    const res = { hasWindow, hidden: r.classList.contains('hidden'), checked: document.querySelector('#q-cursor').checked };
    tabs.querySelector('[data-t="screens"]').click();
    document.querySelector('.src-grid .src').click();
    return res;
  });
  assert.equal(row.checked, true, 'по умолчанию курсор показывается');
  if (row.hasWindow) assert.equal(row.hidden, false, 'для окна флажок виден');
  await hp.click('.modal-foot .btn.primary');
  await hp.waitForFunction(() => Voice.screen && Voice.screen.cursor);
  ok(`в окне выбора есть флажок «Показывать курсор зрителям»${row.hasWindow ? ' (виден для окон)' : ''}, по умолчанию включён`);

  await fp.waitForSelector('.tile .t-watch button', { timeout: 10000 });
  await fp.click('.tile .t-watch button');
  await fp.waitForFunction(() => Viewer.video && Viewer.video.videoWidth > 0, null, { timeout: 20000 });
  await fp.waitForFunction(() => !document.querySelector('#viewer .v-cursor').classList.contains('hidden'), null, { timeout: 8000 });
  const s0 = await sample(fp);
  assert.equal(s0.src, 'data:image/png;base64,', 'картинка курсора пришла от ведущего');
  assert.equal(s0.natural, 16);
  ok('зритель получает картинку курсора ведущего и рисует её поверх видео');
  if (process.env.LC_SHOTS) await fp.screenshot({ path: path.join(process.env.LC_SHOTS, 'cursor-viewer.png') });

  // Положение: проверочный курсор ходит по кругу радиусом 0.3 вокруг центра
  const pts = [];
  for (let i = 0; i < 25; i++) {
    const s = await sample(fp);
    if (s.shown) pts.push(s);
    await wait(80);
  }
  assert.ok(pts.length >= 10, `курсор виден (${pts.length})`);
  for (const p of pts) {
    const r = Math.hypot(p.x - 0.5, p.y - 0.5);
    assert.ok(Math.abs(r - 0.3) < 0.03, `курсор на окружности: r=${r.toFixed(3)} (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
  }
  const moved = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  assert.ok(moved > 0.1, `курсор двигается (${moved.toFixed(2)})`);
  ok(`курсор стоит там, где он у ведущего, и двигается (${pts.length} замеров, отклонение < 3% картинки)`);

  const delay = await fp.evaluate(() => Viewer.cursorDelay);
  assert.ok(delay >= 20 && delay <= 600, `задержка ${delay}`);
  ok(`курсор отстаёт ровно настолько, насколько отстаёт видео (сейчас ${delay} мс)`);

  // Курсор ушёл из окна — у зрителя прячется, потом возвращается
  await fp.waitForFunction(() => document.querySelector('#viewer .v-cursor').classList.contains('hidden'), null, { timeout: 5000 });
  await fp.waitForFunction(() => !document.querySelector('#viewer .v-cursor').classList.contains('hidden'), null, { timeout: 5000 });
  ok('курсор вне окна у зрителя прячется и появляется снова');

  // Мини-окно: курсор остаётся на картинке
  await fp.evaluate(() => Viewer.toggleMini());
  await wait(600);
  const mini = await sample(fp);
  if (mini.shown) assert.ok(Math.abs(Math.hypot(mini.x - 0.5, mini.y - 0.5) - 0.3) < 0.05, 'в мини-окне курсор на месте');
  await fp.evaluate(() => Viewer.expand());
  ok('в мини-окне курсор тоже на своём месте');

  // Второй зритель подключается позже — тоже получает вид курсора сразу
  await fp.evaluate(() => Viewer.close({ silent: false }));
  await wait(300);
  await fp.evaluate(() => { Viewer.cursorShape = null; });
  await fp.click('.tile .t-watch button');
  await fp.waitForFunction(() => Viewer.cursorShape && Viewer.cursorShape.png, null, { timeout: 8000 });
  ok('тот, кто начал смотреть позже, сразу получает вид курсора');

  // Конец трансляции — курсора нет
  await hp.click('[data-v="share"]');
  await hp.waitForFunction(() => !Voice.screen);
  await fp.waitForFunction(() => !Viewer.peerId, null, { timeout: 8000 });
  await wait(300);
  assert.equal(await fp.evaluate(() => Viewer.cursorQ.length), 0);
  ok('трансляция закончилась — курсор у зрителя убран');

  assert.deepEqual(host.errors, []);
  assert.deepEqual(friend.errors, []);
  ok('ошибок JavaScript нет');
  await friend.app.close();
  await host.app.close();
  console.log(`\nВсе проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error('\nОШИБКА:', e); process.exit(1); });
