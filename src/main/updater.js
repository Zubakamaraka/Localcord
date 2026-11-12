// Обновления с GitHub: список выпусков, загрузка установщика с проверкой контрольной суммы.
// Тот же код ставит и новую версию, и любую из прошлых («откат»).
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'Zubakamaraka/Localcord';
// LOCALCORD_UPDATE_API — подмена адреса для проверок (обычный http-сервер с тем же форматом ответа)
const API = process.env.LOCALCORD_UPDATE_API || `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const MIN_INSTALLER = process.env.LOCALCORD_UPDATE_API ? 1 : 50 * 1024 * 1024;

function request(url, { headers = {}, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'LocalCord', ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).toString(), { headers, redirects: redirects + 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

async function getJson(url) {
  const res = await request(url, { headers: { Accept: 'application/vnd.github+json' } });
  const chunks = [];
  let size = 0;
  for await (const c of res) {
    size += c.length;
    if (size > 4 * 1024 * 1024) throw new Error('response too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asset(a) {
  if (!a) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '');
  return { name: a.name, url: a.browser_download_url, size: a.size, sha256: digest ? digest[1].toLowerCase() : null };
}

/** Ответ GitHub → короткий список выпусков, новые сверху */
function parseReleases(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(r => r && !r.draft && typeof r.tag_name === 'string')
    .map(r => {
      const assets = Array.isArray(r.assets) ? r.assets : [];
      return {
        tag: r.tag_name,
        version: r.tag_name.replace(/^v/i, ''),
        date: r.published_at || r.created_at || null,
        notes: String(r.body || '').slice(0, 4000),
        prerelease: !!r.prerelease,
        page: r.html_url || `https://github.com/${REPO}/releases/tag/${r.tag_name}`,
        exe: asset(assets.find(a => /^LocalCord-Setup-\d.*\.exe$/i.test(a.name)) || assets.find(a => /^LocalCord-Setup\.exe$/i.test(a.name))),
        apk: asset(assets.find(a => /^LocalCord-\d.*\.apk$/i.test(a.name)) || assets.find(a => /^LocalCord\.apk$/i.test(a.name))),
      };
    })
    .filter(r => /^\d+\.\d+\.\d+/.test(r.version));
}

let cache = null; // { at, list }

async function listReleases({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.list;
  const list = parseReleases(await getJson(API));
  cache = { at: Date.now(), list };
  return list;
}

/** Скачивает установщик выбранного выпуска. Возвращает путь к файлу. */
async function downloadRelease(rel, dir, onProgress = () => {}) {
  if (!rel || !rel.exe || !rel.exe.url) throw new Error('no-installer');
  if (!/^https:\/\/github\.com\//i.test(rel.exe.url) && !process.env.LOCALCORD_UPDATE_API) throw new Error('bad-url');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `LocalCord-Setup-${rel.version.replace(/[^0-9a-z.\-]/gi, '')}.exe`);
  const check = file => new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
  // уже скачан и цел — не качаем заново
  if (rel.exe.sha256 && fs.existsSync(dest) && await check(dest).catch(() => '') === rel.exe.sha256) {
    onProgress({ got: rel.exe.size, total: rel.exe.size });
    return dest;
  }
  const res = await request(rel.exe.url);
  const total = Number(res.headers['content-length'] || rel.exe.size || 0);
  const tmp = dest + '.part';
  const hash = crypto.createHash('sha256');
  let got = 0;
  let last = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on('data', c => {
      got += c.length;
      hash.update(c);
      const now = Date.now();
      if (now - last > 200) { last = now; onProgress({ got, total }); }
    });
    res.on('error', reject);
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
    out.on('error', reject);
  }).catch(e => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; });
  const sum = hash.digest('hex');
  if (got < MIN_INSTALLER || (rel.exe.sha256 && sum !== rel.exe.sha256)) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error('checksum');
  }
  fs.renameSync(tmp, dest);
  onProgress({ got, total: got });
  return dest;
}

module.exports = { REPO, listReleases, downloadRelease, parseReleases };
