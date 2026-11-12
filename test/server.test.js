// Автотесты сервера: node test/server.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { io } = require('socket.io-client');
const { createServer } = require('../src/server/server');
const { discover, startResponder, mergeReplies, localAddresses } = require('../src/server/discovery');
const { parseReleases, downloadRelease } = require('../src/main/updater');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'));
let passed = 0;
const step = (name) => { passed++; console.log(`  ✓ ${name}`); };

function client(port, host = '127.0.0.1') {
  return io(`http://${host}:${port}`, { transports: ['websocket'], reconnection: false, forceNew: true });
}
const once = (s, ev) => new Promise(r => s.once(ev, r));
const req = (s, ev, data) => new Promise(r => s.emit(ev, data, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = (s, ev, pred) => new Promise(r => { const fn = d => { if (pred(d)) { s.off(ev, fn); r(d); } }; s.on(ev, fn); });

function httpReq(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body && typeof body.pipe === 'function') body.pipe(r);
    else r.end(body);
  });
}

(async () => {
  console.log('LocalCord server tests');
  const lanIp = (localAddresses()[0] || {}).address;

  // ---------- сервер с паролем ----------
  const srv = await createServer({ port: 0, dataDir: tmp, password: 'secret', appVersion: '2.0.0', maxFileMB: 100, log: () => {} });
  const port = srv.port;
  const base = `http://127.0.0.1:${port}`;

  const info = JSON.parse((await httpReq('GET', `${base}/info`)).body);
  assert.equal(info.app, 'localcord'); assert.equal(info.locked, true);
  step('/info отвечает и сообщает о пароле');

  const bad = client(port);
  await once(bad, 'connect');
  const badRes = await req(bad, 'join', { username: 'Hacker', password: 'nope' });
  assert.equal(badRes.ok, false); assert.equal(badRes.error, 'bad-password');
  await once(bad, 'disconnect');
  step('неверный пароль отклоняется и соединение закрывается');

  const a = client(port);
  await once(a, 'connect');
  const ja = await req(a, 'join', { username: '<b>Миша</b>', password: 'secret', clientId: 'cid-a', color: '#123456', avatar: 'javascript:alert(1)' });
  assert.ok(ja.ok); assert.ok(ja.me.token); assert.equal(ja.me.isHost, true);
  assert.equal(ja.profiles['cid-a'].avatar, null);
  step('вход с паролем, хост определяется по localhost, опасный аватар отбрасывается');

  const ignored = client(port);
  await once(ignored, 'connect');
  const r0 = await new Promise(r => { ignored.emit('history', { channel: 'general' }, r); setTimeout(() => r('no-answer'), 400); });
  assert.equal(r0, 'no-answer');
  ignored.close();
  step('без входа сервер ничего не отдаёт');

  // второй клиент — через сетевой адрес (не хост)
  const b = client(port, lanIp || '127.0.0.1');
  await once(b, 'connect');
  const jb = await req(b, 'join', { username: 'Друг', password: 'secret', clientId: 'cid-b' });
  assert.ok(jb.ok);
  if (lanIp) { assert.equal(jb.me.isHost, false); step('участник из сети — не хост'); }

  // ---------- сообщения ----------
  const got = once(b, 'message');
  const sent = await req(a, 'message', { channel: 'general', text: 'Привет!' });
  assert.ok(sent.ok);
  const m = await got;
  assert.equal(m.text, 'Привет!'); assert.equal(m.author.username, '<b>Миша</b>');
  step('сообщение доходит до другого участника');

  const long = await req(a, 'message', { channel: 'general', text: 'x'.repeat(10000) });
  assert.ok(long.ok);
  const h1 = await req(b, 'history', { channel: 'general' });
  assert.equal(h1.messages[h1.messages.length - 1].text.length, 4000);
  step('слишком длинный текст обрезается до 4000 символов');

  const empty = await req(a, 'message', { channel: 'general', text: '   ' });
  assert.equal(empty.ok, false);
  const nochan = await req(a, 'message', { channel: 'voice-main', text: 'hi' });
  assert.equal(nochan.ok, false);
  step('пустые сообщения и сообщения в голосовой канал не принимаются');

  let rateHit = false;
  for (let i = 0; i < 15; i++) { const r = await req(b, 'message', { channel: 'games', text: 'spam ' + i }); if (!r.ok && r.error === 'rate') rateHit = true; }
  assert.ok(rateHit);
  step('защита от флуда срабатывает');

  // ---------- история и подгрузка ----------
  srv.setOptions({ rateMax: 100000 });
  for (let i = 0; i < 60; i++) await req(a, 'message', { channel: 'media', text: 'm' + i });
  const page1 = await req(b, 'history', { channel: 'media' });
  assert.equal(page1.messages.length, 50); assert.equal(page1.hasMore, true);
  assert.equal(page1.messages[49].text, 'm59');
  const page2 = await req(b, 'history', { channel: 'media', before: page1.messages[0].id });
  assert.equal(page2.messages.length, 10); assert.equal(page2.hasMore, false);
  assert.equal(page2.messages[0].text, 'm0');
  step('история отдаётся страницами по 50 с подгрузкой старых');

  // ---------- файлы ----------
  const size = 30 * 1024 * 1024;
  const fileBuf = crypto.randomBytes(size);
  const up = await httpReq('POST', `${base}/upload`, {
    headers: { 'X-LC-Token': ja.me.token, 'X-LC-Name': encodeURIComponent('видео отпуск.mp4'), 'X-LC-Mime': 'video/mp4', 'Content-Length': size },
    body: fileBuf,
  });
  assert.equal(up.status, 200);
  const meta = JSON.parse(up.body);
  assert.equal(meta.size, size); assert.equal(meta.name, 'видео отпуск.mp4');
  step('загрузка файла 30 МБ потоком');

  const noTok = await httpReq('POST', `${base}/upload`, { body: 'x' });
  assert.equal(noTok.status, 401);
  const tooBig = await httpReq('POST', `${base}/upload`, { headers: { 'X-LC-Token': ja.me.token, 'Content-Length': 200 * 1024 * 1024 }, body: '' });
  assert.equal(tooBig.status, 413);
  step('без токена — 401, больше лимита — 413');

  const traversal = await httpReq('POST', `${base}/upload`, { headers: { 'X-LC-Token': ja.me.token, 'X-LC-Name': encodeURIComponent('../../evil.exe') }, body: 'x' });
  assert.equal(JSON.parse(traversal.body).name.includes('/'), false);
  assert.ok(!fs.existsSync(path.join(tmp, '..', 'evil.exe')));
  step('имя файла очищается (нет выхода за папку)');

  // чужой файл прикрепить нельзя
  const stolen = await req(b, 'message', { channel: 'general', text: 'look', attachments: [{ id: meta.id }] });
  assert.ok(stolen.ok);
  const hs = await req(b, 'history', { channel: 'general' });
  assert.equal(hs.messages[hs.messages.length - 1].attachments.length, 0);
  step('чужую загрузку прикрепить нельзя');

  const withFile = await req(a, 'message', { channel: 'general', text: '', attachments: [{ id: meta.id, w: 1920, h: 1080 }] });
  assert.ok(withFile.ok);

  const dl = await httpReq('GET', `${base}/files/${meta.id}?t=${jb.me.token}`);
  assert.equal(dl.status, 200);
  assert.ok(dl.body.equals(fileBuf));
  const range = await httpReq('GET', `${base}/files/${meta.id}?t=${jb.me.token}`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(range.status, 206); assert.equal(range.body.length, 100);
  assert.ok(range.body.equals(fileBuf.subarray(100, 200)));
  const anon = await httpReq('GET', `${base}/files/${meta.id}`);
  assert.equal(anon.status, 401);
  step('скачивание целиком и по частям (Range), без токена — 401');

  // удаление сообщения: чужое нельзя, своё можно, файл стирается
  const hist = await req(a, 'history', { channel: 'general' });
  const fileMsg = hist.messages.find(x => x.attachments.length);
  b.emit('message-delete', { channel: 'general', id: fileMsg.id });
  await wait(200);
  assert.ok(fs.existsSync(path.join(tmp, 'uploads', meta.id)));
  const del = once(b, 'message-deleted');
  a.emit('message-delete', { channel: 'general', id: fileMsg.id });
  await del;
  await wait(200);
  assert.ok(!fs.existsSync(path.join(tmp, 'uploads', meta.id)));
  step('чужое сообщение удалить нельзя; при удалении своего файл стирается с диска');

  // ---------- каналы ----------
  if (lanIp) {
    const nope = await req(b, 'channel-create', { name: 'хак', type: 'text' });
    assert.equal(nope.ok, false);
  }
  const chg = once(b, 'channels');
  const cr = await req(a, 'channel-create', { name: 'Новый Канал', type: 'text' });
  assert.ok(cr.ok);
  const list = await chg;
  assert.ok(list.find(c => c.id === cr.id && c.name === 'новый-канал'));
  step('создавать каналы может только хост');

  // ---------- голос и сигналинг ----------
  const vj = await req(a, 'voice-join', { channel: 'voice-main' });
  assert.ok(vj.ok); assert.equal(vj.peers.length, 0);
  // b не в голосе: сигнал от b к a не проходит
  let leaked = false;
  a.once('signal', () => { leaked = true; });
  b.emit('signal', { to: ja.me.id, data: { type: 'test' } });
  await wait(200);
  assert.equal(leaked, false);
  const joined = once(a, 'voice-user-joined');
  const vjb = await req(b, 'voice-join', { channel: 'voice-main' });
  assert.equal(vjb.peers.length, 1);
  await joined;
  const sig = once(a, 'signal');
  b.emit('signal', { to: ja.me.id, data: { description: { type: 'offer', sdp: 'x' } } });
  const s1 = await sig;
  assert.equal(s1.from, jb.me.id);
  step('сигналы WebRTC ходят только внутри одного голосового канала');

  const st = once(b, 'stream-started');
  a.emit('stream-start', { streamId: 'abc', quality: '1080p30' });
  await st;
  const sp = once(b, 'stream-stopped');
  a.emit('stream-stop');
  await sp;
  step('начало и конец трансляции рассылаются участникам');

  const left = once(a, 'voice-user-left');
  b.close();
  await left;
  step('при отключении участник убирается из голосового канала');

  // ---------- сохранение на диск ----------
  a.close();
  await srv.close();
  const srv2 = await createServer({ port: 0, dataDir: tmp, appVersion: '2.0.0', log: () => {} });
  const c = client(srv2.port);
  await once(c, 'connect');
  const jc = await req(c, 'join', { username: 'C' });
  assert.ok(jc.channels.find(ch => ch.name === 'новый-канал'));
  const hh = await req(c, 'history', { channel: 'general' });
  assert.ok(hh.messages.find(x => x.text === 'Привет!'));
  step('история и каналы сохраняются после перезапуска сервера');
  c.close();

  // ---------- раздача обновления ----------
  const fakeInstaller = path.join(tmp, 'LocalCord-Setup.exe');
  fs.writeFileSync(fakeInstaller, crypto.randomBytes(1024 * 1024));
  const srv3 = await createServer({ port: 0, dataDir: path.join(tmp, 'd3'), appVersion: '2.1.0', installerPath: fakeInstaller, log: () => {} });
  const i3 = JSON.parse((await httpReq('GET', `http://127.0.0.1:${srv3.port}/info`)).body);
  assert.equal(i3.update, true); assert.equal(i3.version, '2.1.0');
  const inst = await httpReq('GET', `http://127.0.0.1:${srv3.port}/update/installer`);
  assert.equal(inst.status, 200); assert.ok(inst.body.equals(fs.readFileSync(fakeInstaller)));
  await srv3.close();
  const noInst = JSON.parse((await httpReq('GET', `http://127.0.0.1:${srv2.port}/info`)).body);
  assert.equal(noInst.update, false);
  step('хост раздаёт свой установщик как обновление');

  // ---------- автопоиск ----------
  const disc = startResponder(() => ({ ...srv2.info(), port: srv2.port }), { port: 41299 });
  await wait(100);
  const found = await discover({ timeout: 800, port: 41299 });
  disc.close();
  if (found.length) {
    assert.equal(found[0].port, srv2.port);
    assert.equal(found[0].id, srv2.id);
    assert.equal(found.length, 1, 'один сервер — одна запись, даже если он ответил с нескольких адресов');
    step('автопоиск находит сервер в сети и показывает его одной записью');
  } else console.log('  (автопоиск: широковещание недоступно в этой среде — пропущено)');
  await srv2.close();

  // ---------- один сервер на нескольких адресах ----------
  const mine = [{ address: '192.168.0.5', netmask: '255.255.255.0', kind: 'lan' }, { address: '26.10.0.5', netmask: '255.0.0.0', kind: 'radmin' }];
  const merged = mergeReplies([
    { id: 'srv-A', name: 'A', port: 3000, host: '26.124.126.29', address: '26.124.126.29:3000' },
    { id: 'srv-A', name: 'A', port: 3000, host: '192.168.0.230', address: '192.168.0.230:3000' },
    { id: 'srv-A', name: 'A', port: 3000, host: '192.168.137.1', address: '192.168.137.1:3000' },
    { id: 'srv-A', name: 'A', port: 3000, host: '127.0.0.1', address: '127.0.0.1:3000' },
    { id: 'srv-B', name: 'B', port: 3000, host: '26.1.2.3', address: '26.1.2.3:3000' },
    { name: 'старая версия без id', port: 3000, host: '192.168.0.77', address: '192.168.0.77:3000' },
  ], mine);
  assert.equal(merged.length, 3);
  const mA = merged.find(x => x.id === 'srv-A');
  assert.equal(mA.address, '192.168.0.230:3000', 'для подключения выбирается адрес своей локальной сети');
  assert.equal(mA.addresses.length, 4);
  step('четыре адреса одного сервера склеиваются в одну запись с лучшим адресом');

  // ---------- владелец: секрет вместо пароля, права хоста по любому адресу ----------
  const srv4 = await createServer({ port: 0, dataDir: path.join(tmp, 'd4'), password: 'old', adminKey: 'owner-secret', lang: 'en', log: () => {} });
  const meta4 = JSON.parse(fs.readFileSync(path.join(tmp, 'd4', 'server.json'), 'utf8'));
  assert.equal(meta4.id, srv4.id); assert.ok(srv4.id.length >= 12);
  assert.equal(JSON.parse((await httpReq('GET', `http://127.0.0.1:${srv4.port}/info`)).body).id, srv4.id);
  const o1 = client(srv4.port, lanIp || '127.0.0.1');
  await once(o1, 'connect');
  const jo1 = await req(o1, 'join', { username: 'Owner', clientId: 'own', adminKey: 'owner-secret', password: 'совсем не тот' });
  assert.equal(jo1.ok, true); assert.equal(jo1.me.isHost, true);
  assert.equal(jo1.server.id, srv4.id);
  assert.ok(jo1.channels.some(ch => ch.name === 'General voice'), 'каналы нового сервера — на языке владельца');
  const g1 = client(srv4.port);
  await once(g1, 'connect');
  const jg1 = await req(g1, 'join', { username: 'Guest', clientId: 'guest', password: 'old' });
  assert.equal(jg1.ok, true); assert.equal(jg1.me.isHost, false, 'с секретом владельца localhost сам по себе прав не даёт');
  const g2 = client(srv4.port);
  await once(g2, 'connect');
  assert.equal((await req(g2, 'join', { username: 'X', adminKey: 'wrong', password: 'nope' })).error, 'bad-password');
  step('владелец входит без пароля и с правами хоста по сетевому адресу; чужой секрет не подходит');

  // смена пароля на работающем сервере
  srv4.setOptions({ password: 'new' });
  const g3 = client(srv4.port);
  await once(g3, 'connect');
  assert.equal((await req(g3, 'join', { username: 'Y', password: 'old' })).error, 'bad-password');
  const g4 = client(srv4.port);
  await once(g4, 'connect');
  assert.equal((await req(g4, 'join', { username: 'Y', clientId: 'y', password: 'new' })).ok, true);
  step('новый пароль действует сразу, без перезапуска сервера');

  // оформление профиля
  const gifData = 'data:image/gif;base64,' + crypto.randomBytes(300 * 1024).toString('base64');
  const prof = waitFor(o1, 'profile', d => d.clientId === 'y' && !!d.profile.avatar);
  g4.emit('profile-update', { username: 'Y', color: '#112233', avatar: gifData, frame: 'gold', font: 'pixel' });
  const pu = await prof;
  assert.equal(pu.profile.frame, 'gold'); assert.equal(pu.profile.font, 'pixel'); assert.equal(pu.profile.avatar, gifData);
  const prof2 = waitFor(o1, 'profile', d => d.clientId === 'y' && !d.profile.avatar);
  g4.emit('profile-update', { username: 'Y', avatar: 'data:image/gif;base64,' + 'A'.repeat(800 * 1024), frame: '<img onerror=1>', font: 'x'.repeat(50) });
  const pu2 = await prof2;
  assert.equal(pu2.profile.avatar, null); assert.equal(pu2.profile.frame, undefined); assert.equal(pu2.profile.font, undefined);
  step('рамка, шрифт и GIF-аватар сохраняются и рассылаются; мусор и слишком большой аватар отбрасываются');
  o1.close(); g1.close(); g4.close();
  await srv4.close();

  // идентификатор сервера переживает перезапуск
  const srv5 = await createServer({ port: 0, dataDir: path.join(tmp, 'd4'), log: () => {} });
  assert.equal(srv5.id, srv4.id);
  await srv5.close();
  step('идентификатор сервера постоянный');

  // ---------- обновления с GitHub ----------
  const rels = parseReleases([
    { tag_name: 'v2.2.0', published_at: '2026-11-11T10:00:00Z', body: 'notes', html_url: 'https://github.com/x/y/releases/tag/v2.2.0', assets: [
      { name: 'LocalCord-Setup.exe', browser_download_url: 'https://github.com/x/y/a.exe', size: 5, digest: 'sha256:' + 'a'.repeat(64) },
      { name: 'LocalCord-Setup-2.2.0.exe', browser_download_url: 'https://github.com/x/y/b.exe', size: 5, digest: 'sha256:' + 'B'.repeat(64) },
      { name: 'LocalCord-2.2.0.apk', browser_download_url: 'https://github.com/x/y/b.apk', size: 7 }] },
    { tag_name: 'v2.3.0-draft', draft: true, assets: [] },
    { tag_name: 'nightly', assets: [] },
    { tag_name: 'v2.1.3', assets: [{ name: 'LocalCord-Setup-2.1.3.exe', browser_download_url: 'https://github.com/x/y/c.exe', size: 9 }] },
  ]);
  assert.deepEqual(rels.map(r => r.version), ['2.2.0', '2.1.3']);
  assert.equal(rels[0].exe.name, 'LocalCord-Setup-2.2.0.exe'); assert.equal(rels[0].exe.sha256, 'b'.repeat(64));
  assert.equal(rels[0].apk.name, 'LocalCord-2.2.0.apk'); assert.equal(rels[1].exe.sha256, null);
  await assert.rejects(downloadRelease({ version: '9.9.9', exe: { url: 'http://evil.example/LocalCord-Setup.exe', size: 1 } }, path.join(tmp, 'upd')), /bad-url/);
  await assert.rejects(downloadRelease({ version: '9.9.9', exe: null }, path.join(tmp, 'upd')), /no-installer/);
  step('список выпусков разбирается; установщик берётся только с github.com');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nВсе проверки пройдены: ${passed}`);
  process.exit(0);
})().catch(e => {
  console.error('\nОШИБКА ТЕСТА:', e);
  process.exit(1);
});
