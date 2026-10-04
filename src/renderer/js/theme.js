// Темы оформления: палитры, цвет акцента, масштаб интерфейса
'use strict';

const THEMES = [
  { id: 'graphite', name: 'Графит', hint: 'классика, как в Discord', c: ['#1e1f22', '#2b2d31', '#313338', '#6d5dfc', '#dbdee1'] },
  { id: 'midnight', name: 'Полночь', hint: 'чёрная, для OLED-экранов', c: ['#000000', '#0b0b0d', '#111214', '#6d5dfc', '#dbdee1'] },
  { id: 'light', name: 'Светлая', hint: 'для дня и яркой комнаты', c: ['#e3e5e8', '#f2f3f5', '#ffffff', '#6d5dfc', '#313338'] },
  { id: 'ocean', name: 'Океан', hint: 'глубокий синий', c: ['#08131d', '#0f1f2d', '#132736', '#22b8cf', '#d5e5f0'] },
  { id: 'forest', name: 'Лес', hint: 'спокойный зелёный', c: ['#0d1510', '#142019', '#19281f', '#3fae6a', '#d9e7dd'] },
  { id: 'sunset', name: 'Закат', hint: 'тёплый вечерний', c: ['#1b1016', '#26161e', '#301c26', '#ff7a59', '#f0dee3'] },
  { id: 'sakura', name: 'Сакура', hint: 'светлая розовая', c: ['#f1dde6', '#faecf2', '#fff8fb', '#e0568f', '#3d2a33'] },
];

const ACCENTS = ['#6d5dfc', '#5865f2', '#00a8fc', '#22b8cf', '#3fae6a', '#23a55a', '#f0b232', '#ff7a59', '#ed4245', '#e0568f', '#9b59b6'];

const SCALES = [90, 100, 110, 125];

const Theme = {
  apply(ui = (App.settings && App.settings.ui) || {}) {
    const root = document.documentElement;
    const theme = THEMES.some(t => t.id === ui.theme) ? ui.theme : 'graphite';
    if (theme === 'graphite') delete root.dataset.theme; else root.dataset.theme = theme;
    if (ui.accent && /^#[0-9a-f]{6}$/i.test(ui.accent)) root.style.setProperty('--accent', ui.accent);
    else root.style.removeProperty('--accent');
    // текст на акцентных кнопках: белый или тёмный — по яркости цвета
    const acc = getComputedStyle(root).getPropertyValue('--accent').trim();
    root.style.setProperty('--on-accent', this.luminance(acc) > 0.62 ? '#111214' : '#ffffff');
    const scale = SCALES.includes(ui.scale) ? ui.scale : 100;
    document.body.style.zoom = scale === 100 ? '' : String(scale / 100);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg-rail').trim();
  },

  luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  },

  async set(patch) {
    await App.saveSettings({ ui: patch });
    this.apply();
  },
};
