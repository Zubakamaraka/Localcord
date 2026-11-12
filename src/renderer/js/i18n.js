// Язык интерфейса. Русский текст в коде — он же ключ: t('Отмена') вернёт «Отмена» или “Cancel”.
// Переводы лежат в lang/en.js; непереведённая строка остаётся русской (это ловит test/i18n.test.js).
'use strict';

const I18N = {
  lang: 'ru',
  dict: {},
  LANGS: [{ id: 'ru', name: 'Русский' }, { id: 'en', name: 'English' }],

  /** Язык по умолчанию — как в системе: русский для ru/uk/be/kk, иначе английский */
  detect() {
    return /^(ru|uk|be|kk)/i.test(navigator.language || '') ? 'ru' : 'en';
  },

  set(lang) {
    this.lang = lang === 'en' ? 'en' : 'ru';
    this.dict = this.lang === 'en' ? (window.LANG_EN || {}) : {};
    document.documentElement.lang = this.lang;
  },

  locale() { return this.lang === 'en' ? 'en-US' : 'ru-RU'; },
};

/** Перевод строки с подстановкой: t('Порт {port}', { port: 3000 }) */
function t(s, vars) {
  let out = I18N.dict[s] || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

/** Пометка для строк в таблицах: переводятся позже, в момент показа — t(item.name) */
const N_ = s => s;

/** Статичные подписи из index.html: data-i18n-title / data-i18n-ph */
function applyStaticI18n(root = document) {
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}
