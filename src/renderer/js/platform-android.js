// Android (Capacitor): нативные функции через встроенный мост, без сборщиков
'use strict';

const IS_ANDROID = !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());

function makeAndroidApi(base) {
  const call = (method, opts) => Capacitor.nativePromise('LocalCord', method, opts || {});
  return {
    ...base,
    browser: true,   // нет окна Electron и встроенного сервера
    mobile: true,
    android: true,
    app: {
      ...base.app,
      info: async () => {
        const i = await call('getInfo').catch(() => ({}));
        return { version: i.version || '0.0.0', platform: 'android', packaged: true, model: i.model || '' };
      },
      openExternal: url => call('openUrl', { url }).catch(() => {}),
      download: url => call('openUrl', { url }).catch(() => toast('Не удалось открыть загрузку', { type: 'err' })),
    },
    net: {
      ...base.net,
      canDiscover: true,
      discover: () => call('discover', { timeout: 1500 }).then(r => r.servers || []).catch(() => []),
    },
    voice: {
      active: on => call('setVoiceActive', { active: !!on }).catch(() => {}),
      speaker: on => call('setSpeaker', { on: !!on }).catch(() => {}),
    },
    onBack: cb => Capacitor.addListener('App', 'backButton', cb),
    minimize: () => Capacitor.nativePromise('App', 'minimizeApp', {}).catch(() => {}),
  };
}
