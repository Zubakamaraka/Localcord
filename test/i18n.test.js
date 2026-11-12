// Проверка переводов: каждая русская строка интерфейса обёрнута в t()/N_() и имеет английский перевод.
// Запуск: node test/i18n.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
let failed = 0;
const fail = msg => { failed++; console.log('  ✗ ' + msg); };

/** Убирает комментарии, не трогая строки (в них бывает //) */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  const tpl = []; // вложенность шаблонных строк: глубина фигурных скобок в ${...}
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n; i += 2; continue; }
      if (quote === '`' && c === '$' && n === '{') { tpl.push(0); quote = null; out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/') {
      // регулярное выражение (в нём бывают кавычки) — если перед косой чертой не значение
      const prev = out.trimEnd();
      const last = prev.slice(-1);
      if (!prev || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /(?:^|[^\w$])(?:return|typeof|case|in|of)$/.test(prev)) {
        let j = i + 1;
        let cls = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
        out += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (tpl.length) {
      if (c === '{') tpl[tpl.length - 1]++;
      if (c === '}') {
        if (tpl[tpl.length - 1] === 0) { tpl.pop(); quote = '`'; out += c; i++; continue; }
        tpl[tpl.length - 1]--;
      }
    }
    out += c; i++;
  }
  return out;
}

const KEY_RE = /(?<![\w.$])(?:t|N_)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const unescape = s => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

function collect(files) {
  const keys = new Map(); // ключ -> где встретился
  const leftovers = [];
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    let m;
    KEY_RE.lastIndex = 0;
    while ((m = KEY_RE.exec(code))) {
      const k = unescape(m[2]);
      if (!keys.has(k)) keys.set(k, path.basename(f));
    }
    const rest = code.replace(KEY_RE, 't(""');
    rest.split('\n').forEach((line, i) => {
      if (/[А-Яа-яЁё]/.test(line)) leftovers.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  return { keys, leftovers };
}

const vars = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
const tags = s => (s.match(/<\/?\w+[^>]*>/g) || []).sort().join(',');

function check(name, files, dict, { allow = [], also = [] } = {}) {
  console.log(`\n${name}`);
  const before = failed;
  const { keys, leftovers } = collect(files);
  for (const [k, where] of keys) {
    if (!/[А-Яа-яЁё]/.test(k)) continue; // строка без русских букв в переводе не нуждается
    const en = dict[k];
    if (typeof en !== 'string' || !en) { fail(`нет перевода (${where}): ${JSON.stringify(k)}`); continue; }
    if (/[А-Яа-яЁё]/.test(en)) fail(`в переводе остались русские буквы: ${JSON.stringify(k)}`);
    if (vars(k) !== vars(en)) fail(`не совпадают подстановки {…}: ${JSON.stringify(k)} → ${JSON.stringify(en)}`);
    if (tags(k) !== tags(en)) fail(`не совпадают теги: ${JSON.stringify(k)} → ${JSON.stringify(en)}`);
  }
  for (const k of Object.keys(dict)) if (!keys.has(k) && !also.includes(k)) fail(`лишний перевод (строка больше не используется): ${JSON.stringify(k)}`);
  for (const l of leftovers) if (!allow.some(a => l.includes(a))) fail(`русский текст мимо t(): ${l}`);
  if (failed === before) console.log(`  ✓ ${keys.size} строк, все переведены`);
}

// ---------- окно приложения ----------
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(JS, 'lang', 'en.js'), 'utf8'), sandbox);
const rendererFiles = fs.readdirSync(JS).filter(f => f.endsWith('.js')).map(f => path.join(JS, f));
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
check('Интерфейс (src/renderer/js)', rendererFiles, sandbox.window.LANG_EN || {}, {
  // имена по умолчанию, с которыми сравнивают сохранённые настройки, и названия языков
  allow: ['\'Сервер LocalCord\'', 'name: \'Русский\''],
  also: [...html.matchAll(/data-i18n-(?:title|ph)="([^"]+)"/g)].map(m => m[1]),
});

// index.html: подписи через data-i18n-*
console.log('\nindex.html');
{
  const before = failed;
  const used = [...html.matchAll(/data-i18n-(?:title|ph)="([^"]+)"/g)].map(m => m[1]);
  for (const k of used) if (!(sandbox.window.LANG_EN || {})[k]) fail(`нет перевода: ${JSON.stringify(k)}`);
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/data-i18n-(?:title|ph)="[^"]+"/g, '');
  body.split('\n').forEach((line, i) => { if (/[А-Яа-яЁё]/.test(line)) fail(`русский текст мимо data-i18n: index.html:${i + 1}: ${line.trim().slice(0, 100)}`); });
  if (failed === before) console.log(`  ✓ ${used.length} подписей`);
}

// ---------- главный процесс ----------
const mainDir = path.join(ROOT, 'src', 'main');
const mainDict = require(path.join(mainDir, 'lang-en.js'));
check('Главный процесс (src/main)', fs.readdirSync(mainDir).filter(f => f.endsWith('.js') && f !== 'lang-en.js').map(f => path.join(mainDir, f)), mainDict, {
  allow: ['\'Сервер LocalCord\''],
});

console.log(failed ? `\nОшибок: ${failed}` : '\nПереводы в порядке');
process.exit(failed ? 1 : 0);
