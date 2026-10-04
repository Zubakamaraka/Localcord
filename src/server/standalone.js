// Запуск сервера без интерфейса (например, на постоянно включённом ПК):
//   node src/server/standalone.js --port 3000 --name "Мой сервер" --password 123
'use strict';

const path = require('path');
const { createServer } = require('./server');
const { startResponder, localAddresses } = require('./discovery');
const pkg = require('../../package.json');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

(async () => {
  const srv = await createServer({
    port: Number(arg('port', process.env.PORT || 3000)),
    name: arg('name', 'LocalCord'),
    password: arg('password', process.env.LOCALCORD_PASSWORD || ''),
    dataDir: path.resolve(arg('data', path.join(__dirname, '..', '..', 'server-data'))),
    appVersion: pkg.version,
  });
  const disc = startResponder(() => ({ ...srv.info(), port: srv.port }));
  console.log('\nАдреса для подключения друзей:');
  for (const a of localAddresses()) console.log(`  ${a.address}:${srv.port}   (${a.kind}, ${a.name})`);
  console.log('\nCtrl+C — остановить.\n');
  const stop = async () => { disc.close(); await srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(e => {
  console.error('Не удалось запустить сервер:', e.message);
  process.exit(1);
});
