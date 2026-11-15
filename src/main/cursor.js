// Курсор поверх трансляции окна: следим, где курсор в показываемом окне и как он выглядит,
// и сообщаем это странице — она передаёт зрителям, а те рисуют курсор поверх видео.
// Работает на Windows (cursor-win.js). LOCALCORD_FAKE_CURSOR=1 — ненастоящий курсор для проверок:
// ходит по кругу внутри любого показываемого источника.
'use strict';

const { nativeImage } = require('electron');

const FAKE = !!process.env.LOCALCORD_FAKE_CURSOR;
const INTERVAL = 16; // ~60 раз в секунду: дёшево, а движение плавное

let backend = null;
function getBackend() {
  if (backend !== null) return backend;
  backend = false;
  if (FAKE) backend = fakeBackend();
  else if (process.platform === 'win32') {
    try { const w = require('./cursor-win'); w.load(); backend = w; } catch { backend = false; }
  }
  return backend;
}

/** Есть ли у этой системы курсор для трансляции окна */
function supported() { return !!getBackend(); }

/** Ненастоящий курсор: стрелка, которая ходит по кругу и раз в 3 секунды на полсекунды «уходит» из окна */
function fakeBackend() {
  const w = 16, h = 24;
  const bgra = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x <= y * 0.7 && y < 20;
    const edge = inside && (x === 0 || x >= Math.floor(y * 0.7) - 1 || y >= 19);
    if (!inside) continue;
    const i = (y * w + x) * 4;
    const c = edge ? 0 : 255;
    bgra[i] = bgra[i + 1] = bgra[i + 2] = c;
    bgra[i + 3] = 255;
  }
  const t0 = Date.now();
  return {
    poll: () => {
      const t = (Date.now() - t0) / 1000;
      const away = t % 3 > 2.5;
      return { visible: !away, x: 0.5 + 0.3 * Math.cos(t), y: 0.5 + 0.3 * Math.sin(t), ww: 1280, wh: 720, key: 'fake' };
    },
    shape: () => ({ w, h, hx: 0, hy: 0, bgra }),
  };
}

/** Номер окна из id источника Electron: "window:197442:0" → 197442 */
function windowHandle(sourceId) {
  const m = /^window:(\d+):/.exec(String(sourceId || ''));
  return m ? Number(m[1]) : 0;
}

let timer = null;

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Начать следить за курсором в окне sourceId. send(channel, data) — отправка странице:
 *  'cursor:shape' { key, png, w, h, hx, hy } — когда меняется вид курсора;
 *  'cursor:pos'   { v, x, y, w }             — когда меняется положение (x, y — доли окна, w — его ширина);
 *  'cursor:end'                               — окна больше нет.
 */
function start(sourceId, send) {
  stop();
  const be = getBackend();
  const hwnd = FAKE ? 1 : windowHandle(sourceId);
  if (!be || !hwnd) return false;
  const shapes = new Map(); // key → { ... } (чтобы не делать картинку заново на каждый кадр)
  let lastKey = null, last = '';
  timer = setInterval(() => {
    let p;
    try { p = be.poll(hwnd); } catch { p = { visible: false }; }
    if (!p) { stop(); send('cursor:end'); return; }
    if (p.visible && p.key !== lastKey) {
      let sh = shapes.get(p.key);
      if (sh === undefined) {
        sh = null;
        try {
          const raw = be.shape();
          if (raw) {
            const img = nativeImage.createFromBitmap(raw.bgra, { width: raw.w, height: raw.h });
            sh = { key: p.key, png: img.toDataURL(), w: raw.w, h: raw.h, hx: raw.hx, hy: raw.hy };
          }
        } catch { sh = null; }
        if (shapes.size > 64) shapes.clear();
        shapes.set(p.key, sh);
      }
      lastKey = p.key;
      // не получилось взять картинку (бывает с курсорами чужих программ) — у зрителя будет обычная стрелка
      send('cursor:shape', sh || { key: p.key, png: null });
    }
    const v = !!p.visible;
    const x = v ? Math.round(p.x * 10000) / 10000 : 0;
    const y = v ? Math.round(p.y * 10000) / 10000 : 0;
    const w = v ? Math.round(p.ww) : 0; // ширина окна — чтобы зритель нарисовал курсор в нужном размере
    const sig = `${v}|${x}|${y}|${w}`;
    if (sig !== last) { last = sig; send('cursor:pos', { v, x, y, w }); }
  }, INTERVAL);
  return true;
}

module.exports = { start, stop, supported, windowHandle };
