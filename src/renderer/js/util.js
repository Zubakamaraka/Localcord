// Общие помощники интерфейса
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return s.toUpperCase();
}

function safeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#5865f2';
}

// ---------- оформление профиля: рамки аватара и шрифты имени ----------
// Идентификаторы уходят на сервер и к друзьям; незнакомый идентификатор просто не рисуется.
const FRAMES = [
  { id: '', name: N_('Без рамки') },
  { id: 'accent', name: N_('Акцент') },
  { id: 'gold', name: N_('Золото') },
  { id: 'emerald', name: N_('Изумруд') },
  { id: 'ice', name: N_('Лёд') },
  { id: 'neon', name: N_('Неон') },
  { id: 'fire', name: N_('Огонь') },
  { id: 'galaxy', name: N_('Галактика') },
  { id: 'rainbow', name: N_('Радуга') },
];
const NAME_FONTS = [
  { id: '', name: N_('Обычный') },
  { id: 'serif', name: N_('Классика') },
  { id: 'mono', name: N_('Терминал') },
  { id: 'comfortaa', name: N_('Округлый') },
  { id: 'russo', name: N_('Техно') },
  { id: 'caveat', name: N_('От руки') },
  { id: 'lobster', name: N_('Вывеска') },
  { id: 'pixel', name: N_('Пиксели') },
];
const frameId = p => (p && FRAMES.some(f => f.id && f.id === p.frame) ? p.frame : '');
const fontClass = p => (p && NAME_FONTS.some(f => f.id && f.id === p.font) ? `nf nf-${p.font}` : '');
/** Имя участника его шрифтом */
const nameHtml = p => `<span class="${fontClass(p)}">${esc(p.username)}</span>`;

/** Аватар: картинка или цветной кружок с инициалами, по желанию — с рамкой */
function avatarHtml(p, size = 32, opts = {}) {
  p = p || {};
  const fs = Math.round(size * 0.38);
  const inner = p.avatar
    ? `<img src="${esc(p.avatar)}" alt="">`
    : esc(initials(p.username));
  const bg = p.avatar ? 'transparent' : safeColor(p.color);
  const st = opts.status ? '<i class="st"></i>' : '';
  const data = opts.sid ? ` data-sid="${esc(opts.sid)}"` : '';
  const fr = frameId(p);
  const ring = fr ? `;--ring:${Math.max(2, Math.round(size * 0.07))}px` : '';
  return `<div class="av ${opts.cls || ''}"${data}${fr ? ` data-fr="${fr}"` : ''} style="width:${size}px;height:${size}px;background:${bg};font-size:${fs}px${ring}">${inner}${st}</div>`;
}

const pad = n => String(n).padStart(2, '0');

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function fmtDay(ts) {
  const now = Date.now();
  if (sameDay(ts, now)) return t('Сегодня');
  if (sameDay(ts, now - 86400000)) return t('Вчера');
  return new Date(ts).toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtStamp(ts) {
  const now = Date.now();
  if (sameDay(ts, now)) return t('Сегодня в {time}', { time: fmtTime(ts) });
  if (sameDay(ts, now - 86400000)) return t('Вчера в {time}', { time: fmtTime(ts) });
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${fmtTime(ts)}`;
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  const u = [t('Б'), t('КБ'), t('МБ'), t('ГБ'), t('ТБ')];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 10 ? 1 : 0)} ${u[i]}`;
}

/** Ссылки в тексте — кликабельные (открываются в браузере) */
function linkify(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((p, i) => i % 2
    ? `<a href="#" data-ext="${esc(p)}">${esc(p)}</a>`
    : esc(p)).join('');
}

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function debounce(fn, ms) {
  let timer;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('Скопировано'), { type: 'ok', timeout: 1500 }); }
  catch { toast(t('Не удалось скопировать'), { type: 'err' }); }
}

// ---------- тосты ----------
function toast(msg, opts = {}) {
  const el = h(`<div class="toast ${opts.type || ''}"><span class="t-msg"></span></div>`);
  el.querySelector('.t-msg').textContent = msg;
  if (opts.action) {
    const a = h(`<button class="t-act"></button>`);
    a.textContent = opts.action.label;
    a.onclick = () => { opts.action.onClick(); el.remove(); };
    el.appendChild(a);
  }
  $('#toasts').appendChild(el);
  const timeout = opts.timeout ?? 3500;
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

// ---------- модальные окна ----------
const modalStack = [];

function modal({ title, body, buttons = [], wide = false, onClose, closable = true }) {
  const ov = h(`<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h3></h3>${closable ? `<button class="icon-btn" data-x>${icon('x', 22)}</button>` : ''}</div>
    <div class="modal-body"></div>
    ${buttons.length ? '<div class="modal-foot"></div>' : ''}
  </div></div>`);
  ov.querySelector('h3').textContent = title || '';
  const bodyEl = ov.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);

  let closed = false;
  const api = {
    el: ov,
    body: bodyEl,
    close() {
      if (closed) return;
      closed = true;
      ov.remove();
      const i = modalStack.indexOf(api);
      if (i >= 0) modalStack.splice(i, 1);
      onClose && onClose();
    },
    closable,
  };
  const foot = ov.querySelector('.modal-foot');
  for (const b of buttons) {
    const btn = h(`<button class="btn ${b.kind || ''}"></button>`);
    btn.textContent = b.label;
    btn.onclick = async () => {
      if (!b.onClick) return api.close();
      btn.disabled = true;
      try {
        const r = await b.onClick(api);
        if (r !== false) api.close();
      } finally { btn.disabled = false; }
    };
    if (b.id) btn.id = b.id;
    foot.appendChild(btn);
  }
  if (closable) {
    ov.querySelector('[data-x]').onclick = () => api.close();
    ov.addEventListener('mousedown', e => { if (e.target === ov) api.close(); });
  }
  document.body.appendChild(ov);
  modalStack.push(api);
  setTimeout(() => { const f = ov.querySelector('input, textarea, select'); f && f.focus(); }, 30);
  return api;
}

function confirmDialog(title, text, { ok = t('Подтвердить'), danger = false } = {}) {
  return new Promise(resolve => {
    let result = false;
    const body = document.createElement('div');
    body.textContent = text;
    modal({
      title, body,
      buttons: [
        { label: t('Отмена'), kind: 'ghost' },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

function promptDialog(title, label, value = '', { ok = t('Сохранить'), placeholder = '' } = {}) {
  return new Promise(resolve => {
    let result = null;
    const body = h(`<div class="field"><label></label><input class="input" maxlength="40"></div>`);
    body.querySelector('label').textContent = label;
    const inp = body.querySelector('input');
    inp.value = value;
    inp.placeholder = placeholder;
    const m = modal({
      title, body,
      buttons: [
        { label: t('Отмена'), kind: 'ghost' },
        { label: ok, kind: 'primary', onClick: () => { result = inp.value.trim() || null; } },
      ],
      onClose: () => resolve(result),
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { result = inp.value.trim() || null; m.close(); } });
  });
}

// ---------- контекстное меню ----------
function ctxMenu(x, y, items) {
  const el = $('#ctx-menu');
  el.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'sep') { el.appendChild(h('<div class="cs"></div>')); continue; }
    if (it.type === 'label') { const l = h('<div class="clabel"></div>'); l.textContent = it.label; el.appendChild(l); continue; }
    if (it.type === 'custom') { el.appendChild(it.el); continue; }
    const b = h(`<button class="ci ${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon, 16) : ''}<span></span></button>`);
    b.querySelector('span').textContent = it.label;
    b.onclick = () => { hideCtx(); it.onClick && it.onClick(); };
    el.appendChild(b);
  }
  el.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  el.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function hideCtx() { $('#ctx-menu').classList.add('hidden'); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx-menu')) hideCtx(); });
window.addEventListener('blur', hideCtx);

// ---------- звуки (синтез, без файлов) ----------
const Sounds = (() => {
  let ctx = null;
  const tones = {
    join: [[523, 0], [784, 0.09]],
    leave: [[784, 0], [523, 0.09]],
    mute: [[440, 0]],
    unmute: [[660, 0]],
    message: [[880, 0], [1175, 0.07]],
    stream: [[660, 0], [880, 0.08], [1046, 0.16]],
    connect: [[392, 0], [523, 0.08], [659, 0.16]],
  };
  return {
    play(name) {
      if (!App.settings || !App.settings.app.sounds) return;
      try {
        ctx = ctx || new AudioContext();
        const now = ctx.currentTime;
        for (const [f, at] of tones[name] || []) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, now + at);
          g.gain.exponentialRampToValueAtTime(0.12, now + at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
          o.connect(g).connect(ctx.destination);
          o.start(now + at);
          o.stop(now + at + 0.18);
        }
      } catch { /* без звука */ }
    },
  };
})();

const AVATAR_GIF_MAX = 480 * 1024; // байт: анимированный аватар должен пролезать в один пакет профиля

/** Картинка → квадратный аватар 128×128. GIF остаётся анимированным, остальное сохраняется как webp */
async function imageToAvatar(file) {
  if (file.type === 'image/gif') {
    const gif = await gifToAvatar(file).catch(() => null);
    if (gif) return gif;
  }
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 128, 128);
  bmp.close();
  return c.toDataURL('image/webp', 0.85);
}

/**
 * Анимированный GIF любого размера → маленький квадратный GIF для аватара.
 * Кадры читает встроенный декодер Chromium, собирает обратно библиотека gifenc.
 * Если получается слишком тяжело — уменьшаем сторону и число кадров. null — не анимация или не вышло.
 */
async function gifToAvatar(file) {
  if (!('ImageDecoder' in window) || !window.gifenc) return null;
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = track ? track.frameCount : 0;
    if (!track || !track.animated || count < 2) return null;
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    for (const [size, maxFrames] of [[128, 60], [112, 48], [96, 40], [80, 30], [64, 24]]) {
      const step = Math.ceil(count / maxFrames);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const enc = GIFEncoder();
      for (let i = 0; i < count; i += step) {
        const { image } = await dec.decode({ frameIndex: i });
        const w = image.displayWidth, hh = image.displayHeight, s = Math.min(w, hh);
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(image, (w - s) / 2, (hh - s) / 2, s, s, 0, 0, size, size);
        const delay = Math.max(20, Math.round((image.duration || 100000) / 1000) * step);
        image.close();
        const { data } = ctx.getImageData(0, 0, size, size);
        const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
        const index = applyPalette(data, palette, 'rgba4444');
        const ti = palette.findIndex(col => col[3] === 0);
        enc.writeFrame(index, size, size, { palette, delay, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: ti >= 0 ? 2 : 0 });
      }
      enc.finish();
      const bytes = enc.bytes();
      if (bytes.length <= AVATAR_GIF_MAX) {
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(new Blob([bytes], { type: 'image/gif' }));
        });
      }
    }
    return null;
  } finally {
    try { dec.close(); } catch { /* ignore */ }
  }
}

function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

/** Один сервер — одна строка: ответы с разных адресов одного сервера склеиваются по его id */
function dedupeServers(list) {
  const seen = new Map();
  for (const s of list || []) {
    const key = s.id ? `id:${s.id}` : `addr:${s.address}`;
    const cur = seen.get(key);
    if (!cur) seen.set(key, { ...s, addresses: s.addresses || [s.address] });
    else if (!cur.addresses.includes(s.address)) cur.addresses.push(s.address);
  }
  return [...seen.values()];
}

function normalizeAddress(raw) {
  let a = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!a) return '';
  if (!/:\d+$/.test(a)) a += ':3000';
  return a;
}
