// Безопасный мост между интерфейсом и системой.
// Наружу торчат только перечисленные функции — без доступа к Node.js.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const h = (e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    show: () => ipcRenderer.send('window:show'),
    flash: () => ipcRenderer.send('window:flash'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: listen('window:maximized'),
  },
  store: {
    get: () => ipcRenderer.invoke('store:get'),
    set: (patch) => ipcRenderer.invoke('store:set', patch),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    setLoginItem: (on) => ipcRenderer.invoke('app:setLoginItem', on),
    uninstall: (wipe) => ipcRenderer.invoke('app:uninstall', wipe),
    openExternal: (url) => ipcRenderer.send('app:openExternal', url),
    showItem: (p) => ipcRenderer.send('app:showItem', p),
    download: (url) => ipcRenderer.send('app:download', url),
    quit: () => ipcRenderer.send('app:quit'),
    onDownload: listen('download'),
  },
  screen: {
    sources: () => ipcRenderer.invoke('screen:sources'),
    select: (sel) => ipcRenderer.invoke('screen:select', sel),
  },
  host: {
    start: () => ipcRenderer.invoke('host:start'),
    stop: () => ipcRenderer.invoke('host:stop'),
    status: () => ipcRenderer.invoke('host:status'),
    update: (patch) => ipcRenderer.invoke('host:update', patch),
    openData: () => ipcRenderer.send('host:openData'),
  },
  net: {
    addresses: () => ipcRenderer.invoke('net:addresses'),
    discover: () => ipcRenderer.invoke('net:discover'),
  },
  firewall: {
    status: () => ipcRenderer.invoke('firewall:status'),
    allow: () => ipcRenderer.invoke('firewall:allow'),
  },
  update: {
    download: (baseUrl, version) => ipcRenderer.invoke('update:download', { baseUrl, version }),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: listen('update:progress'),
  },
});
