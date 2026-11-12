// =============================================================
//  LocalCord — главный процесс Electron
// =============================================================
'use strict';

const {
  app, BrowserWindow, ipcMain, desktopCapturer, session, shell, Tray, Menu,
  nativeImage, dialog, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

app.setName('LocalCord');
// LOCALCORD_PROFILE — отдельный профиль (например, чтобы запустить два клиента на одном ПК для проверки)
app.setPath('userData', process.env.LOCALCORD_PROFILE || path.join(app.getPath('appData'), 'LocalCord'));
// Всё общение идёт внутри локальной сети — системный прокси не нужен и только мешает
app.commandLine.appendSwitch('no-proxy-server');
// Настоящие IP в WebRTC вместо имён *.local: mDNS не ходит через Radmin VPN и ломает соединение
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
if (process.env.LOCALCORD_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
if (process.platform === 'win32') app.setAppUserModelId('com.localcord.app');

const store = require('./store');
const { t, lang } = require('./i18n');
const updater = require('./updater');
const { REPO } = updater; // репозиторий с выпусками: обновления и установщик для раздачи друзьям
const { createServer } = require('../server/server');
const { startResponder, discover, localAddresses } = require('../server/discovery');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICON = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const START_HIDDEN = process.argv.includes('--hidden');

let win = null;
let tray = null;
let isQuitting = false;
let trayHintShown = false;

// ---------- единственный экземпляр ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const s = store.get();
  const b = s.window || {};
  win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x, y: b.y,
    minWidth: 940,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#1e1f22',
    icon: ICON,
    title: 'LocalCord',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false, // голос не должен «засыпать» в свёрнутом окне
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (b.maximized) win.maximize();

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });

  const sendMax = () => win && win.webContents.send('window:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.on('focus', () => win.flashFrame(false));

  win.on('close', e => {
    saveBounds();
    const st = store.get();
    if (!isQuitting && (st.app.closeToTray || hostSrv)) {
      e.preventDefault();
      win.hide();
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true;
        new Notification({
          title: t('LocalCord работает в фоне'),
          body: hostSrv ? t('Сервер продолжает работать. Выйти — через значок в трее.') : t('Значок в трее → «Выход», чтобы закрыть полностью.'),
          icon: ICON,
        }).show();
      }
    }
  });
  win.on('closed', () => { win = null; });

  // Внешние ссылки — в браузере, никаких новых окон внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Никаких переходов со страницы приложения (в т.ч. при случайном «бросании» файла)
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
}

function saveBounds() {
  if (!win) return;
  const maximized = win.isMaximized();
  const b = maximized ? (store.get().window || {}) : win.getBounds();
  store.set({ window: { ...b, maximized } });
}

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (process.platform !== 'win32') img = img.resize({ width: 22, height: 22 });
  tray = new Tray(img);
  tray.setToolTip('LocalCord');
  const menu = () => Menu.buildFromTemplate([
    { label: t('Открыть LocalCord'), click: showWindow },
    { type: 'separator' },
    { label: hostSrv ? t('Сервер работает (порт {port})', { port: hostSrv.port }) : t('Сервер не запущен'), enabled: false },
    { type: 'separator' },
    { label: t('Выход'), click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
  tray.refresh = () => tray.setContextMenu(menu());
}

// ---------- права доступа ----------
function setupSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));

  // Демонстрация экрана: источник выбирается в нашем окне выбора,
  // затем страница вызывает getDisplayMedia, и мы подставляем выбранный источник.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const sel = pendingShare;
    pendingShare = null;
    try {
      if (!sel) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const src = sources.find(s => s.id === sel.id);
      if (!src) return callback({});
      const res = { video: src };
      if (sel.audio && process.platform === 'win32') res.audio = 'loopback';
      callback(res);
    } catch {
      callback({});
    }
  });

  // Скачивание вложений — сразу в «Загрузки» без лишних вопросов
  ses.on('will-download', (e, item) => {
    const dir = app.getPath('downloads');
    const name = item.getFilename();
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let target = path.join(dir, name);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
    item.setSavePath(target);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const send = (state) => win && win.webContents.send('download', {
      id, state, name: path.basename(target), path: target,
      received: item.getReceivedBytes(), total: item.getTotalBytes(),
    });
    send('started');
    item.on('updated', () => send('progress'));
    item.once('done', (ev, state) => send(state === 'completed' ? 'done' : 'failed'));
  });
}

let pendingShare = null;

// ---------- встроенный сервер ----------
let hostSrv = null;
let hostDisc = null;

// Путь к закэшированному установщику своей версии (его раздаёт хост друзьям).
// Файл не лежит рядом с программой — хост скачивает его с GitHub по необходимости.
let cachedInstaller = null;

function installerPath() {
  return cachedInstaller;
}

// Скачать файл по https с переходами (GitHub отдаёт релизы через редирект)
function httpsDownload(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'LocalCord' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpsDownload(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, dest); resolve(dest); } catch (e) { reject(e); } }));
      out.on('error', e => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

// Убедиться, что установщик своей версии скачан в кэш. Если нет интернета —
// вернёт null, и раздача обновлений просто будет недоступна (друзья увидят ссылку на страницу).
async function ensureInstaller() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  const v = app.getVersion();
  const dir = path.join(app.getPath('userData'), 'update-cache');
  const dest = path.join(dir, `LocalCord-Setup-${v}.exe`);
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024 * 1024) {
      cachedInstaller = dest;
      return dest;
    }
    fs.mkdirSync(dir, { recursive: true });
    const url = `https://github.com/${REPO}/releases/download/v${v}/LocalCord-Setup-${v}.exe`;
    await httpsDownload(url, dest);
    if (fs.statSync(dest).size < 50 * 1024 * 1024) throw new Error('file is too small');
    cachedInstaller = dest;
    if (hostSrv) hostSrv.setOptions({ installerPath: dest });
    return dest;
  } catch (e) {
    console.error('ensureInstaller:', e.message);
    try { fs.unlinkSync(dest); } catch { /* ignore */ }
    cachedInstaller = null;
    return null;
  }
}

// Секрет владельца: живёт только в памяти этого запуска. С ним приложение хоста входит
// на свой сервер без пароля и с правами владельца — по любому адресу, не только 127.0.0.1.
const ADMIN_KEY = crypto.randomBytes(24).toString('base64url');
const dataDir = () => path.join(app.getPath('userData'), 'server-data');

/** Сервер считается созданным, пока его не остановили или не удалили (до 2.2 это определялось по mode) */
function hostEnabled(s = store.get()) {
  return typeof s.host.enabled === 'boolean' ? s.host.enabled : s.mode === 'host';
}

function hostStatus() {
  const s = store.get().host;
  return {
    running: !!hostSrv,
    enabled: hostEnabled(),
    id: hostSrv ? hostSrv.id : null,
    adminKey: hostSrv ? ADMIN_KEY : null,
    port: hostSrv ? hostSrv.port : s.port,
    name: s.name,
    hasPassword: !!s.password,
    addresses: localAddresses(),
    dataDir: dataDir(),
    hasData: fs.existsSync(path.join(dataDir(), 'channels.json')),
    canDistributeUpdate: !!(installerPath() && fs.existsSync(installerPath())),
  };
}

async function startHost() {
  const s = store.get().host;
  if (hostSrv) await stopHost({ keepEnabled: true });
  try {
    hostSrv = await createServer({
      port: Number(s.port) || 3000,
      name: s.name,
      password: s.password,
      maxFileMB: s.maxFileMB,
      dataDir: dataDir(),
      appVersion: app.getVersion(),
      installerPath: installerPath(),
      adminKey: ADMIN_KEY,
      lang: lang(),
    });
  } catch (e) {
    hostSrv = null;
    return { ok: false, error: e.code === 'EADDRINUSE' ? 'port-busy' : e.message };
  }
  hostDisc = startResponder(() => ({ ...hostSrv.info(), port: hostSrv.port }));
  if (!store.get().host.enabled) store.set({ host: { enabled: true } });
  tray && tray.refresh();
  // В фоне подтягиваем установщик своей версии с GitHub, чтобы раздавать обновления друзьям
  ensureInstaller().then(p => { if (p && hostSrv) hostSrv.setOptions({ installerPath: p }); });
  return { ok: true, status: hostStatus() };
}

/**
 * Применить сохранённые настройки к серверу. Если он уже работает — имя, пароль и лимит
 * меняются на лету, а смена порта перезапускает сервер. Раньше работающий сервер
 * продолжал жить со старым паролем, и вход с новым давал «Неверный пароль».
 */
async function applyHost() {
  const s = store.get().host;
  if (!hostSrv || hostSrv.port !== (Number(s.port) || 3000)) return startHost();
  hostSrv.setOptions({ name: s.name, password: s.password, maxFileMB: s.maxFileMB });
  tray && tray.refresh();
  return { ok: true, status: hostStatus() };
}

async function stopHost({ keepEnabled = false } = {}) {
  if (hostDisc) { hostDisc.close(); hostDisc = null; }
  if (hostSrv) { const s = hostSrv; hostSrv = null; await s.close().catch(() => {}); }
  if (!keepEnabled && store.get().host.enabled !== false) store.set({ host: { enabled: false } });
  tray && tray.refresh();
  return { ok: true, status: hostStatus() };
}

/** Удалить сервер совсем: остановить и стереть каналы, историю и вложения */
async function deleteHost() {
  await stopHost();
  try { fs.rmSync(dataDir(), { recursive: true, force: true }); }
  catch (e) { return { ok: false, error: e.message }; }
  store.set({ host: { enabled: false, password: '' } });
  return { ok: true, status: hostStatus() };
}

// ---------- брандмауэр Windows ----------
const FW_RULE = 'LocalCord';

function firewallStatus() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ supported: false, allowed: true });
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FW_RULE}`], { windowsHide: true }, err => {
      resolve({ supported: true, allowed: !err });
    });
  });
}

function firewallAllow() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ ok: true });
    // Открытая (не закодированная) команда: один запрос прав администратора,
    // затем обычный netsh добавляет правило для брандмауэра Windows.
    const exeCmd = process.execPath;                       // путь в двойных кавычках для cmd
    const argline =
      `/c netsh advfirewall firewall delete rule name=${FW_RULE} & ` +
      `netsh advfirewall firewall add rule name=${FW_RULE} dir=in action=allow ` +
      `program="${exeCmd}" enable=yes profile=any`;
    const psArg = argline.replace(/'/g, "''");             // экранируем для строки PowerShell
    const outer = `Start-Process -FilePath cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '${psArg}'`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true }, async () => {
      resolve({ ok: (await firewallStatus()).allowed });
    });
  });
}

// ---------- обновления через хоста ----------
let updateFile = null;

function downloadUpdate(baseUrl, version) {
  return new Promise((resolve) => {
    const target = path.join(app.getPath('temp'), `LocalCord-Setup-${String(version).replace(/[^0-9a-z.\-]/gi, '')}.exe`);
    const out = fs.createWriteStream(target);
    const req = http.get(`${baseUrl.replace(/\/$/, '')}/update/installer`, res => {
      if (res.statusCode !== 200) { out.destroy(); return resolve({ ok: false, error: `HTTP ${res.statusCode}` }); }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let last = 0;
      res.on('data', c => {
        got += c.length;
        const now = Date.now();
        if (now - last > 200) { last = now; win && win.webContents.send('update:progress', { got, total }); }
      });
      res.pipe(out);
      out.on('finish', () => {
        updateFile = target;
        win && win.webContents.send('update:progress', { got: total || got, total: total || got });
        resolve({ ok: true });
      });
    });
    req.on('error', e => { out.destroy(); resolve({ ok: false, error: e.message }); });
  });
}

// ---------- обновления с GitHub и откат на прошлую версию ----------
async function listUpdates(force) {
  try {
    return { ok: true, current: app.getVersion(), releases: await updater.listReleases({ force: !!force }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchRelease(tag) {
  try {
    const rel = (await updater.listReleases()).find(r => r.tag === tag);
    if (!rel) return { ok: false, error: 'not-found' };
    updateFile = await updater.downloadRelease(rel, path.join(app.getPath('userData'), 'update-cache'),
      p => win && win.webContents.send('update:progress', p));
    return { ok: true, version: rel.version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function installUpdate() {
  if (!updateFile || !fs.existsSync(updateFile)) return { ok: false, error: 'no-file' };
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported' };
  // --updated: не удалять данные; /S: тихо; --force-run: запустить после установки
  spawn(updateFile, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { isQuitting = true; app.quit(); }, 300);
  return { ok: true };
}

// ---------- удаление ----------
function uninstall(wipe) {
  if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, error: 'not-installed' };
  const dir = path.dirname(process.execPath);
  const exe = fs.readdirSync(dir).find(f => /^Uninstall .*\.exe$/i.test(f));
  if (!exe) return { ok: false, error: 'no-uninstaller' };
  // --delete-app-data: деинсталлятор сотрёт профиль, историю и файлы сервера
  spawn(path.join(dir, exe), wipe ? ['--delete-app-data'] : [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { isQuitting = true; app.quit(); }, 300);
  return { ok: true };
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on('window:close', () => win && win.close());
  ipcMain.on('window:show', () => showWindow());
  ipcMain.on('window:flash', () => { if (win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.handle('window:isMaximized', () => !!win && win.isMaximized());

  ipcMain.handle('store:get', () => store.get());
  ipcMain.handle('store:set', (e, patch) => {
    const before = lang();
    const res = store.set(patch);
    if (lang() !== before && tray) tray.refresh(); // язык меню в трее
    return res;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    lang: lang(),
  }));
  ipcMain.handle('app:setLoginItem', (e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
    return true;
  });
  ipcMain.handle('app:uninstall', (e, wipe) => uninstall(!!wipe));
  ipcMain.on('app:openExternal', (e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.on('app:showItem', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
  ipcMain.on('app:download', (e, url) => { if (/^https?:\/\//i.test(url)) win && win.webContents.downloadURL(url); });
  ipcMain.on('app:quit', () => { isQuitting = true; app.quit(); });

  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 225 },
      fetchWindowIcons: true,
    });
    return sources
      .filter(s => s.name && !/^LocalCord$/.test(s.name))
      .map(s => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });
  ipcMain.handle('screen:select', (e, sel) => { pendingShare = sel && sel.id ? { id: sel.id, audio: !!sel.audio } : null; return true; });

  ipcMain.handle('host:start', () => startHost());
  ipcMain.handle('host:stop', () => stopHost());
  ipcMain.handle('host:apply', () => applyHost());
  ipcMain.handle('host:delete', () => deleteHost());
  ipcMain.handle('host:status', () => hostStatus());
  ipcMain.handle('host:update', (e, patch) => {
    if (hostSrv) hostSrv.setOptions(patch || {});
    return hostStatus();
  });
  ipcMain.on('host:openData', () => {
    const d = dataDir();
    fs.mkdirSync(d, { recursive: true });
    shell.openPath(d);
  });
  ipcMain.handle('net:addresses', () => localAddresses());
  ipcMain.handle('net:discover', async () => {
    const list = await discover({ timeout: 1500 });
    // свой сервер помечаем: в списке он показывается одной строкой «ваш сервер»
    return list.map(s => (hostSrv && s.id && s.id === hostSrv.id ? { ...s, own: true, address: `127.0.0.1:${hostSrv.port}` } : s));
  });
  ipcMain.handle('firewall:status', () => firewallStatus());
  ipcMain.handle('firewall:allow', () => firewallAllow());

  ipcMain.handle('update:download', (e, { baseUrl, version }) => downloadUpdate(baseUrl, version));
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('update:list', (e, force) => listUpdates(force));
  ipcMain.handle('update:fetch', (e, tag) => fetchRelease(String(tag || '')));
}

// ---------- запуск ----------
app.whenReady().then(async () => {
  setupSession();
  setupIpc();
  Menu.setApplicationMenu(null);
  const s = store.get();
  if (s.onboarded && hostEnabled(s) && s.host.autoStart) await startHost();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

let closing = false;
app.on('before-quit', e => {
  isQuitting = true;
  if (hostSrv && !closing) {
    e.preventDefault();
    closing = true;
    stopHost({ keepEnabled: true }).finally(() => app.quit());
  }
});

process.on('uncaughtException', err => {
  console.error(err);
  try { dialog.showErrorBox(t('LocalCord — ошибка'), String(err && err.stack || err)); } catch { /* ignore */ }
});
