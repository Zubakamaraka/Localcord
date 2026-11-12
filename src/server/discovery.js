// =============================================================
//  Автопоиск серверов LocalCord в локальной сети / Radmin VPN.
//  Клиент шлёт широковещательный UDP-запрос, хост отвечает.
// =============================================================
'use strict';

const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 41234;
const MAGIC_Q = 'LOCALCORD_DISCOVER_V1';
const MAGIC_A = 'LOCALCORD_HERE_V1';

/** IPv4-адреса компьютера (без 127.0.0.1) с пометкой типа сети */
function localAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      let kind = 'lan';
      if (/radmin/i.test(name) || a.address.startsWith('26.')) kind = 'radmin';
      else if (/hamachi/i.test(name) || a.address.startsWith('25.')) kind = 'hamachi';
      else if (/zerotier|tailscale|wireguard|openvpn|tap|tun/i.test(name)) kind = 'vpn';
      out.push({ name, address: a.address, netmask: a.netmask, kind });
    }
  }
  const order = { radmin: 0, hamachi: 1, vpn: 2, lan: 3 };
  return out.sort((x, y) => order[x.kind] - order[y.kind]);
}

function broadcastAddresses() {
  const set = new Set(['255.255.255.255']);
  for (const a of localAddresses()) {
    const ip = a.address.split('.').map(Number);
    const mask = String(a.netmask || '255.255.255.0').split('.').map(Number);
    if (ip.length !== 4 || mask.length !== 4) continue;
    set.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
  }
  return [...set];
}

/** Ответчик на стороне хоста */
function startResponder(getInfo, { port = DISCOVERY_PORT, log = () => {} } = {}) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', err => {
    log('discovery error: ' + err.message);
    try { sock.close(); } catch { /* ignore */ }
  });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString() !== MAGIC_Q) return;
    const payload = Buffer.from(MAGIC_A + JSON.stringify(getInfo()));
    sock.send(payload, rinfo.port, rinfo.address);
  });
  sock.bind(port);
  return { close: () => { try { sock.close(); } catch { /* ignore */ } } };
}

/** Насколько адрес удобен для подключения: своя подсеть лучше VPN, VPN лучше петли */
function addressRank(host, mine) {
  if (host === '127.0.0.1') return 9;
  const ip = host.split('.').map(Number);
  for (const a of mine) {
    const my = a.address.split('.').map(Number);
    const mask = String(a.netmask || '255.255.255.0').split('.').map(Number);
    if (ip.length === 4 && ip.every((b, i) => (b & mask[i]) === (my[i] & mask[i]))) return a.kind === 'lan' ? 0 : 1;
  }
  return 5;
}

/**
 * Склеивает ответы одного и того же сервера, пришедшие с разных его адресов
 * (Wi-Fi, Radmin VPN, раздача интернета и т. д.), в одну запись.
 * Сервер узнаётся по постоянному id; у старых версий без id — по адресу.
 */
function mergeReplies(replies, mine = localAddresses()) {
  const byKey = new Map();
  for (const r of replies) {
    const key = r.id ? `id:${r.id}` : `addr:${r.address}`;
    const rank = addressRank(r.host, mine);
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { ...r, addresses: [r.address], rank }); continue; }
    if (!cur.addresses.includes(r.address)) cur.addresses.push(r.address);
    if (rank < cur.rank) Object.assign(cur, { ...r, addresses: cur.addresses, rank });
  }
  return [...byKey.values()].map(({ rank, ...s }) => s);
}

/** Поиск серверов. Возвращает [{ id, address, addresses, port, name, version, locked, users }] — по одной записи на сервер */
function discover({ timeout = 1500, port = DISCOVERY_PORT } = {}) {
  return new Promise(resolve => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    const finish = () => {
      try { sock.close(); } catch { /* ignore */ }
      resolve(mergeReplies([...found.values()]));
    };
    sock.on('error', finish);
    sock.on('message', (msg, rinfo) => {
      const s = msg.toString();
      if (!s.startsWith(MAGIC_A)) return;
      try {
        const info = JSON.parse(s.slice(MAGIC_A.length));
        const key = `${rinfo.address}:${info.port}`;
        found.set(key, { ...info, address: `${rinfo.address}:${info.port}`, host: rinfo.address });
      } catch { /* ignore */ }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const q = Buffer.from(MAGIC_Q);
      const targets = broadcastAddresses();
      const send = () => targets.forEach(t => sock.send(q, port, t, () => {}));
      send();
      setTimeout(send, 400);
      setTimeout(finish, timeout);
    });
  });
}

module.exports = { startResponder, discover, mergeReplies, localAddresses, DISCOVERY_PORT };
