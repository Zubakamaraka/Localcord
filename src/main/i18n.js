// Язык надписей главного процесса (трей, уведомления). Интерфейс переводится в окне — см. renderer/js/i18n.js
'use strict';

const { app } = require('electron');
const store = require('./store');
const EN = require('./lang-en');

/** 'ru' | 'en': выбор пользователя, иначе по языку системы */
function lang() {
  let chosen = null;
  // до готовности приложения настройки не читаем: расшифровка паролей (safeStorage) ещё недоступна
  if (app.isReady()) { try { chosen = (store.get().app || {}).lang; } catch { /* ignore */ } }
  if (chosen === 'ru' || chosen === 'en') return chosen;
  return /^(ru|uk|be|kk)/i.test(app.getLocale() || '') ? 'ru' : 'en';
}

function t(s, vars) {
  let out = (lang() === 'en' && EN[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

module.exports = { t, lang };
