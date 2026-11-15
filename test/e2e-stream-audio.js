// Сквозная проверка звука трансляции: голос друга не должен возвращаться к нему внутри трансляции.
// Нужен захват звука системы: на Linux — PulseAudio (xvfb-run -a node test/e2e-stream-audio.js).
// Без PulseAudio проверка пропускается.
//
// Сценарий: друг говорит (виртуальный микрофон Chromium пищит раз в секунду), у хоста этот голос
// играет в колонки, хост показывает экран со звуком компьютера. Друг слушает звук трансляции
// и меряет, сколько в нём его собственного голоса. Для сравнения — тот же захват без вычитания.
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { _electron: electron } = require('playwright-core');
const exe = require('electron');

const ROOT = path.join(__dirname, '..');
const PORT = 3321;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = name => { passed++; console.log(`  ✓ ${name}`); };

function pulseReady() {
  try { execSync('pactl info', { stdio: 'ignore' }); return true; } catch { return false; }
}

async function launch(name, settings, { fakeMedia = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `lc-e2e-${name}-`));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    executablePath: exe,
    args: [ROOT, '--no-sandbox'],
    // у хоста — настоящий захват экрана и звука системы (виртуальное устройство Chromium подменило бы их своим писком)
    env: { ...process.env, LOCALCORD_PROFILE: profile, LOCALCORD_TEST_LOOPBACK: '1', ...(fakeMedia ? { LOCALCORD_FAKE_MEDIA: '1' } : {}) },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { app, page, errors };
}

/** Уровень звука трансляции у зрителя, dBFS (среднеквадратичный за seconds секунд) */
function measureStream(page, seconds) {
  return page.evaluate(async sec => {
    const tr = Viewer.stream && Viewer.stream.getAudioTracks()[0];
    if (!tr) return null;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([tr]));
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let sum = 0, n = 0;
    const until = performance.now() + sec * 1000;
    while (performance.now() < until) {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) { sum += x * x; n++; }
      await new Promise(r => setTimeout(r, 40));
    }
    ctx.close();
    return 10 * Math.log10(sum / n + 1e-12);
  }, seconds);
}

async function shareWithAudio(hp, mode) {
  await hp.evaluate(m => { window.LC_SHARE_AUDIO_MODE = m; }, mode);
  await hp.click('[data-v="share"]');
  await hp.waitForSelector('#q-audio');
  await hp.evaluate(() => { const b = document.querySelector('#q-audio'); if (!b.checked) b.click(); });
  await hp.click('.modal-foot .btn.primary');
  await hp.waitForFunction(() => Voice.screen && Voice.screen.audio, null, { timeout: 15000 });
  return hp.evaluate(() => ({ mode: Voice.screen.audioMode, settings: Voice.screen.stream.getAudioTracks()[0].getSettings() }));
}

(async () => {
  console.log('LocalCord e2e — голоса друзей в звуке трансляции');
  if (!pulseReady()) {
    console.log('  (нет PulseAudio — захват звука системы недоступен, проверка пропущена)');
    process.exit(0);
  }

  let game = null;
  try {
    game = path.join(os.tmpdir(), 'lc-e2e-game.wav');
    execSync(`sox -n -r 48000 -c 2 "${game}" synth 12 sine 220 sine 330 tremolo 3 40 gain -12`, { stdio: 'ignore' });
  } catch { game = null; }
  const common = { app: { lang: 'ru', checkUpdates: false, sounds: false } };
  const host = await launch('host', {
    ...common, onboarded: true, mode: 'host',
    profile: { clientId: 'sa-host', username: 'Хост', color: '#6d5dfc' },
    host: { name: 'Audio', port: PORT, autoStart: true, password: '' },
  }, { fakeMedia: false });
  const hp = host.page;
  await hp.waitForFunction(() => App.connected, null, { timeout: 20000 });
  const friend = await launch('friend', { ...common, onboarded: true, profile: { clientId: 'sa-friend', username: 'Друг', color: '#3ba55c' } });
  const fp = friend.page;
  await fp.waitForSelector('#m-join');
  await fp.evaluate(p => Flow.connectTo(`127.0.0.1:${p}`, ''), PORT);
  await fp.waitForFunction(() => App.connected, null, { timeout: 15000 });

  await fp.click('.chan >> text=Общий голосовой');
  await fp.waitForFunction(() => Voice.channel);
  await hp.click('.chan >> text=Общий голосовой');
  await hp.waitForFunction(() => [...Voice.peers.values()].some(p => p.pc.connectionState === 'connected'), null, { timeout: 15000 });
  // Хост молчит (иначе друг сыграет его голос в общие колонки этого стенда), друг ничего не играет вслух:
  // на одном компьютере «колонки» у обоих общие, а в жизни это разные компьютеры.
  await hp.evaluate(() => { if (!Voice.muted) Voice.toggleMute(); });
  await fp.evaluate(async () => { await App.saveSettings({ voice: { localMutes: { 'sa-host': true } } }); Voice.applyVolumes(); });

  const results = {};
  for (const mode of ['raw', 'cancel']) {
    const info = await shareWithAudio(hp, mode);
    assert.equal(info.mode, mode);
    await fp.waitForSelector('.tile .t-watch button', { timeout: 10000 });
    await fp.click('.tile .t-watch button');
    await fp.waitForFunction(() => Viewer.stream && Viewer.stream.getAudioTracks().length && Viewer.video.videoWidth > 0, null, { timeout: 20000 });
    await fp.evaluate(() => { Viewer.video.muted = true; });
    await wait(3000); // эхоподавителю нужно пару секунд, чтобы «услышать» голоса
    results[mode] = await measureStream(fp, 4);
    if (mode === 'cancel' && game) {
      // «игра»: отдельная программа играет музыку в те же колонки — её звук должен остаться в трансляции
      const pl = spawn('paplay', [game], { stdio: 'ignore' });
      await wait(1500);
      results.game = await measureStream(fp, 3);
      pl.kill();
    }
    console.log(`    звук трансляции (${mode === 'raw' ? 'без вычитания' : 'с вычитанием голосов'}): ${results[mode].toFixed(1)} dBFS; захват: ${JSON.stringify({ echoCancellation: info.settings.echoCancellation, restrictOwnAudio: info.settings.restrictOwnAudio, device: info.settings.deviceId })}`);
    await fp.evaluate(() => Viewer.close({ silent: true }));
    await hp.click('[data-v="share"]'); // остановить
    await hp.waitForFunction(() => !Voice.screen);
    await wait(800);
  }
  assert.ok(results.raw > -55, `без вычитания голос друга должен быть слышен в трансляции (${results.raw.toFixed(1)} dBFS)`);
  ok(`без вычитания друг слышит в трансляции свой голос (${results.raw.toFixed(1)} dBFS) — так было в 2.2`);
  assert.ok(results.cancel < results.raw - 20, `голос должен стать тише хотя бы на 20 дБ (${results.raw.toFixed(1)} → ${results.cancel.toFixed(1)})`);
  ok(`с вычитанием голос друга в трансляции тише на ${(results.raw - results.cancel).toFixed(0)} дБ (${results.cancel.toFixed(1)} dBFS)`);
  if (game) {
    assert.ok(results.game > -35, `звук игры должен остаться (${results.game.toFixed(1)} dBFS)`);
    ok(`звук игры при этом остаётся в трансляции (${results.game.toFixed(1)} dBFS)`);
  } else console.log('  (нет sox — проверка звука игры пропущена)');

  // Windows 11: если исключение не сработало, программа сама переходит на вычитание
  await hp.evaluate(() => { App.info.ownAudioExclusion = true; window.LC_SHARE_AUDIO_MODE = null; });
  await hp.click('[data-v="share"]');
  await hp.waitForSelector('#q-audio');
  await hp.click('.modal-foot .btn.primary');
  await hp.waitForFunction(() => Voice.screen && Voice.screen.audio, null, { timeout: 15000 });
  const fb = await hp.evaluate(() => ({ mode: Voice.screen.audioMode, ec: Voice.screen.stream.getAudioTracks()[0].getSettings().echoCancellation }));
  assert.deepEqual(fb, { mode: 'cancel', ec: true });
  ok('если система не исключила звук LocalCord (здесь — Linux), трансляция перезапускается с вычитанием голосов');
  await hp.click('[data-v="share"]');

  assert.deepEqual(host.errors, []);
  assert.deepEqual(friend.errors, []);
  ok('ошибок JavaScript нет');
  await friend.app.close();
  await host.app.close();
  console.log(`\nВсе проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => { console.error('\nОШИБКА:', e); process.exit(1); });
