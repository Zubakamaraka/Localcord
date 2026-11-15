// Курсор для трансляции окна (только Windows): где он относительно окна и как выглядит.
// Зачем: при показе отдельного окна Chromium просит Windows Graphics Capture дорисовать курсор,
// а в играх (особенно полноэкранных) Windows его часто не рисует. Поэтому LocalCord передаёт
// зрителям положение и картинку курсора отдельно, и они рисуют его поверх видео.
// Функции Windows вызываются через koffi (без отдельной программы и без PowerShell).
'use strict';

const koffi = require('koffi');

let api = null;

// Запас места в стеке вызова: koffi вызывает функции Windows со своего отдельного стека, и если функция
// сразу уходит в ядро (GetCursorInfo, GetAncestor…), Wine читает чуть выше этого стека и падает.
// На x64 лишние аргументы безопасны — их убирает вызывающий, а функция их просто не видит.
const PAD = process.arch === 'x64' ? [0, 0, 0, 0, 0, 0, 0, 0] : [];
function fn(lib, proto) {
  if (!PAD.length) return lib.func(proto);
  const padded = proto.replace(/\)\s*$/, PAD.map((_, i) => `, int64 _pad${i}`).join('') + ')');
  const f = lib.func(padded);
  return (...args) => f(...args, ...PAD);
}

function load() {
  if (api) return api;
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  let dwmapi = null;
  try { dwmapi = koffi.load('dwmapi.dll'); } catch { /* без DWM — возьмём обычные границы окна */ }

  const POINT = koffi.struct('LC_POINT', { x: 'int32', y: 'int32' });
  koffi.struct('LC_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  koffi.struct('LC_CURSORINFO', { cbSize: 'uint32', flags: 'uint32', hCursor: 'intptr_t', ptScreenPos: POINT });
  koffi.struct('LC_ICONINFO', { fIcon: 'int32', xHotspot: 'uint32', yHotspot: 'uint32', hbmMask: 'intptr_t', hbmColor: 'intptr_t' });
  const BITMAP = koffi.struct('LC_BITMAP', {
    bmType: 'int32', bmWidth: 'int32', bmHeight: 'int32', bmWidthBytes: 'int32',
    bmPlanes: 'uint16', bmBitsPixel: 'uint16', bmBits: 'intptr_t',
  });
  const BIH = koffi.struct('LC_BIH', {
    biSize: 'uint32', biWidth: 'int32', biHeight: 'int32', biPlanes: 'uint16', biBitCount: 'uint16',
    biCompression: 'uint32', biSizeImage: 'uint32', biXPelsPerMeter: 'int32', biYPelsPerMeter: 'int32',
    biClrUsed: 'uint32', biClrImportant: 'uint32',
  });
  koffi.struct('LC_BMI', { bmiHeader: BIH, bmiColors: koffi.array('uint32', 4) });

  api = {
    BITMAP_SIZE: koffi.sizeof(BITMAP),
    BIH_SIZE: koffi.sizeof(BIH),
    GetCursorInfo: fn(user32, 'bool __stdcall GetCursorInfo(_Inout_ LC_CURSORINFO *pci)'),
    GetIconInfo: fn(user32, 'bool __stdcall GetIconInfo(intptr_t hIcon, _Out_ LC_ICONINFO *piconinfo)'),
    IsWindow: fn(user32, 'bool __stdcall IsWindow(intptr_t hWnd)'),
    IsIconic: fn(user32, 'bool __stdcall IsIconic(intptr_t hWnd)'),
    GetWindowRect: fn(user32, 'bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ LC_RECT *rect)'),
    WindowFromPoint: fn(user32, 'intptr_t __stdcall WindowFromPoint(LC_POINT pt)'),
    GetAncestor: fn(user32, 'intptr_t __stdcall GetAncestor(intptr_t hWnd, uint32 flags)'),
    GetDC: fn(user32, 'intptr_t __stdcall GetDC(intptr_t hWnd)'),
    ReleaseDC: fn(user32, 'int __stdcall ReleaseDC(intptr_t hWnd, intptr_t hdc)'),
    DrawIconEx: fn(user32, 'bool __stdcall DrawIconEx(intptr_t hdc, int x, int y, intptr_t hIcon, int cx, int cy, uint32 step, intptr_t hbr, uint32 flags)'),
    DwmGetWindowAttribute: dwmapi ? fn(dwmapi, 'int32 __stdcall DwmGetWindowAttribute(intptr_t hWnd, uint32 attr, _Out_ LC_RECT *pv, uint32 cb)') : null,
    GetObjectW: fn(gdi32, 'int __stdcall GetObjectW(intptr_t h, int c, _Out_ LC_BITMAP *pv)'),
    CreateCompatibleDC: fn(gdi32, 'intptr_t __stdcall CreateCompatibleDC(intptr_t hdc)'),
    CreateCompatibleBitmap: fn(gdi32, 'intptr_t __stdcall CreateCompatibleBitmap(intptr_t hdc, int cx, int cy)'),
    SelectObject: fn(gdi32, 'intptr_t __stdcall SelectObject(intptr_t hdc, intptr_t h)'),
    DeleteObject: fn(gdi32, 'bool __stdcall DeleteObject(intptr_t h)'),
    DeleteDC: fn(gdi32, 'bool __stdcall DeleteDC(intptr_t hdc)'),
    PatBlt: fn(gdi32, 'bool __stdcall PatBlt(intptr_t hdc, int x, int y, int w, int h, uint32 rop)'),
    GetDIBits: fn(gdi32, 'int __stdcall GetDIBits(intptr_t hdc, intptr_t hbm, uint32 start, uint32 lines, _Out_ uint8_t *bits, _Inout_ LC_BMI *bmi, uint32 usage)'),
  };
  return api;
}

const CURSOR_SHOWING = 0x1;
const GA_ROOT = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const BLACKNESS = 0x00000042;
const WHITENESS = 0x00FF0062;
const DI_NORMAL = 0x3;

/** Видимые границы окна в пикселях экрана (без невидимой рамки для растягивания, как их захватывает WGC) */
function windowRect(hwnd) {
  const a = load();
  const r = {};
  if (a.DwmGetWindowAttribute && a.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) === 0 && r.right > r.left) return r;
  return a.GetWindowRect(hwnd, r) ? r : null;
}

/**
 * Где курсор относительно окна. null — окна больше нет.
 * { visible, x, y } — x, y от 0 до 1 внутри окна; ww, wh — размер окна в пикселях; key — какая форма курсора.
 */
function poll(hwnd) {
  const a = load();
  if (!a.IsWindow(hwnd)) return null;
  const ci = { cbSize: 24, flags: 0, hCursor: 0, ptScreenPos: { x: 0, y: 0 } };
  if (!a.GetCursorInfo(ci)) return { visible: false };
  const r = windowRect(hwnd);
  if (!r || a.IsIconic(hwnd)) return { visible: false };
  const ww = r.right - r.left;
  const wh = r.bottom - r.top;
  const { x, y } = ci.ptScreenPos;
  const inside = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  // курсор над другим окном, которое перекрывает наше, — зрители его там не увидят
  const over = inside ? a.GetAncestor(a.WindowFromPoint({ x, y }), GA_ROOT) : 0;
  const visible = !!(ci.flags & CURSOR_SHOWING) && !!ci.hCursor && inside && Number(over) === Number(hwnd);
  return { visible, x: (x - r.left) / ww, y: (y - r.top) / wh, ww, wh, key: String(ci.hCursor) };
}

/**
 * Картинка текущего курсора: рисуем его на чёрном и на белом фоне и по разнице получаем прозрачность.
 * Так получаются и цветные курсоры с полупрозрачностью, и старые «инвертирующие» (текстовый I-образный).
 * Возвращает { w, h, hx, hy, bgra } — bgra с предумноженной прозрачностью (так её ждёт nativeImage).
 */
function shape(handle) {
  const a = load();
  let hCursor = handle;
  if (!hCursor) {
    const ci = { cbSize: 24, flags: 0, hCursor: 0, ptScreenPos: { x: 0, y: 0 } };
    if (!a.GetCursorInfo(ci) || !ci.hCursor) return null;
    hCursor = ci.hCursor;
  }
  const info = {};
  if (!a.GetIconInfo(hCursor, info)) return null;
  let w = 32, h = 32;
  try {
    const bm = {};
    if (info.hbmColor && a.GetObjectW(info.hbmColor, a.BITMAP_SIZE, bm)) { w = bm.bmWidth; h = bm.bmHeight; }
    else if (info.hbmMask && a.GetObjectW(info.hbmMask, a.BITMAP_SIZE, bm)) { w = bm.bmWidth; h = bm.bmHeight / 2; }
  } finally {
    if (info.hbmMask) a.DeleteObject(info.hbmMask);
    if (info.hbmColor) a.DeleteObject(info.hbmColor);
  }
  if (!(w > 0 && h > 0 && w <= 256 && h <= 256)) return null;

  const screen = a.GetDC(0);
  const dc = a.CreateCompatibleDC(screen);
  const bmp = a.CreateCompatibleBitmap(screen, w, h);
  const render = rop => {
    const old = a.SelectObject(dc, bmp);
    a.PatBlt(dc, 0, 0, w, h, rop);
    a.DrawIconEx(dc, 0, 0, hCursor, w, h, 0, 0, DI_NORMAL);
    a.SelectObject(dc, old);
    const buf = Buffer.alloc(w * h * 4);
    const bmi = { bmiHeader: { biSize: a.BIH_SIZE, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: 0, biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0 }, bmiColors: [0, 0, 0, 0] };
    a.GetDIBits(screen, bmp, 0, h, buf, bmi, 0);
    return buf;
  };
  let onBlack, onWhite;
  try {
    onBlack = render(BLACKNESS);
    onWhite = render(WHITENESS);
  } finally {
    a.DeleteObject(bmp);
    a.DeleteDC(dc);
    a.ReleaseDC(0, screen);
  }
  return { w, h, hx: info.xHotspot, hy: info.yHotspot, bgra: compose(onBlack, onWhite) };
}

/** Чёрный и белый фон → BGRA с предумноженной прозрачностью. Инвертирующие точки становятся белыми (с тенью у зрителя) */
function compose(onBlack, onWhite) {
  const out = Buffer.alloc(onBlack.length);
  for (let i = 0; i < onBlack.length; i += 4) {
    const b = [onBlack[i], onBlack[i + 1], onBlack[i + 2]];
    const wv = [onWhite[i], onWhite[i + 1], onWhite[i + 2]];
    const diff = (wv[0] - b[0] + wv[1] - b[1] + wv[2] - b[2]) / 3;
    if (diff < -64) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255; continue; } // инверсия
    const alpha = Math.max(0, Math.min(255, Math.round(255 - diff)));
    out[i] = Math.min(b[0], alpha);
    out[i + 1] = Math.min(b[1], alpha);
    out[i + 2] = Math.min(b[2], alpha);
    out[i + 3] = alpha;
  }
  return out;
}

module.exports = { poll, shape, compose, load };
