// Сквозная проверка: два настоящих окна LocalCord (хост и друг) на одном компьютере.
// Windows:  npm run test:e2e        Linux без экрана:  xvfb-run -a npm run test:e2e
// Проверяет: автопоиск, чат, файлы, голос, трансляцию, полный экран, мини-окно,
// автозакрытие после конца трансляции, повторный просмотр, переподключение.
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');
const exe = require('electron');
const { localAddresses } = require('../src/server/discovery');

const ROOT = path.join(__dirname, '..');
const PORT = 3299;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = name => { passed++; console.log(`  ✓ ${name}`); };

async function launch(name, settings) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `lc-e2e-${name}-`));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    executablePath: exe,
    args: [ROOT, '--no-sandbox'],
    // отдельный профиль + виртуальные микрофон/камера Chromium
    env: { ...process.env, LOCALCORD_PROFILE: profile, LOCALCORD_FAKE_MEDIA: '1' },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { app, page, errors, profile };
}

(async () => {
  console.log('LocalCord e2e');
  const lan = localAddresses()[0];
  assert.ok(lan, 'нужен хотя бы один сетевой адрес');

  const host = await launch('host', {
    onboarded: true, mode: 'host',
    profile: { clientId: 'e2e-host', username: 'Хост', color: '#6d5dfc' },
    host: { name: 'E2E', port: PORT, autoStart: true, password: '' },
  });
  await host.page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  ok('хост запустил встроенный сервер и вошёл');

  const friend = await launch('friend', {
    onboarded: true, profile: { clientId: 'e2e-friend', username: 'Друг', color: '#3ba55c' },
  });
  await friend.page.click('#m-join');
  await friend.page.waitForSelector('#c-found .server-row', { timeout: 10000 });
  ok('друг нашёл сервер автопоиском');
  await friend.page.click('#c-found .server-row');
  await friend.page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  ok('друг подключился');

  // чат
  await friend.page.fill('#message-input', 'Привет из теста');
  await friend.page.keyboard.press('Enter');
  await host.page.waitForFunction(() => [...document.querySelectorAll('.m-text')].some(e => e.textContent === 'Привет из теста'), null, { timeout: 5000 });
  ok('сообщение дошло до хоста');

  // файл 200 МБ
  await friend.page.evaluate(() => Chat.addFiles([new File([new Uint8Array(200 * 1024 * 1024)], 'big.bin')]));
  await friend.page.keyboard.press('Enter');
  await host.page.waitForFunction(() => [...document.querySelectorAll('.f-name')].some(e => e.textContent === 'big.bin'), null, { timeout: 60000 });
  ok('файл 200 МБ загружен и виден у хоста');

  // голос
  await friend.page.click('.chan >> text=Общий голосовой');
  await friend.page.waitForFunction(() => Voice.channel);
  await host.page.click('.chan >> text=Общий голосовой');
  await host.page.waitForFunction(() => [...Voice.peers.values()].some(p => p.pc.connectionState === 'connected'), null, { timeout: 15000 });
  ok('голосовое соединение установлено');

  // трансляция
  await host.page.click('[data-v="share"]');
  await host.page.waitForSelector('.src');
  await host.page.click('.modal-foot .btn.primary');
  await friend.page.waitForSelector('.tile .t-watch button', { timeout: 10000 });
  await friend.page.click('.tile .t-watch button');
  await friend.page.waitForFunction(() => Viewer.video.videoWidth > 0, null, { timeout: 20000 });
  ok('друг смотрит трансляцию');

  await friend.page.click('#viewer [data-a="full"]');
  await wait(600);
  assert.ok(await friend.page.evaluate(() => !!document.fullscreenElement));
  await friend.page.keyboard.press('Escape');
  await wait(600);
  assert.ok(!(await friend.page.evaluate(() => !!document.fullscreenElement)));
  ok('полный экран и выход по Esc');

  await friend.page.click('.chan >> text=общий');
  await wait(600);
  assert.ok(await friend.page.evaluate(() => !document.getElementById('mini-player').classList.contains('hidden')));
  ok('при переходе в чат трансляция уходит в мини-окно');

  await host.page.click('.chan >> text=Общий голосовой');
  await host.page.click('[data-v="share"]');
  await friend.page.waitForFunction(() => !Viewer.peerId && document.getElementById('mini-player').classList.contains('hidden'), null, { timeout: 5000 });
  ok('после конца трансляции окно у зрителя закрывается само');

  await host.page.click('[data-v="share"]');
  await host.page.waitForSelector('.src');
  await host.page.click('.modal-foot .btn.primary');
  await friend.page.click('.chan >> text=Общий голосовой');
  await friend.page.waitForSelector('.tile .t-watch button', { timeout: 10000 });
  await friend.page.click('.tile .t-watch button');
  await friend.page.waitForFunction(() => Viewer.video.videoWidth > 0, null, { timeout: 20000 });
  ok('повторная трансляция смотрится без перезахода');
  await host.page.click('[data-v="share"]');

  // перезапуск сервера
  await host.page.evaluate(() => App.api.host.stop());
  await wait(1000);
  await host.page.evaluate(() => App.api.host.start());
  await friend.page.waitForFunction(() => App.connected && Voice.channel, null, { timeout: 20000 });
  ok('после перезапуска сервера друг сам вернулся в чат и голос');

  assert.deepEqual(host.errors, []);
  assert.deepEqual(friend.errors, []);
  ok('ошибок JavaScript нет');

  await friend.app.close();
  await host.app.close();
  console.log(`\nВсе проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error('\nОШИБКА:', e); process.exit(1); });
