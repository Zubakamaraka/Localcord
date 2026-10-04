// Текстовые каналы: сообщения, история, вложения, перетаскивание файлов
'use strict';

const GROUP_GAP = 7 * 60 * 1000;
const CACHE_MAX = 500;
const CACHE_TRIM_TO = 300;
const THUMB_MIN_BYTES = 300 * 1024;

const Chat = {
  cache: new Map(),      // channelId -> { messages, hasMore, loaded, loading }
  pending: [],           // прикреплённые, ещё не отправленные файлы
  lastTypingSent: 0,
  stickToBottom: true,

  resetCache() { this.cache.clear(); },

  entry(ch) {
    let e = this.cache.get(ch);
    if (!e) { e = { messages: [], hasMore: true, loaded: false, loading: false }; this.cache.set(ch, e); }
    return e;
  },

  // ---------- открытие канала ----------
  async open(chId, { force = false } = {}) {
    const ch = App.channel(chId);
    if (!ch) return;
    $('#message-input').placeholder = `Написать в #${ch.name}`;
    this.renderTyping();
    const e = this.entry(chId);
    if (!e.loaded || force) {
      e.messages = [];
      e.hasMore = true;
      this.render();
      await this.loadOlder(chId, true);
    } else {
      this.render();
      this.scrollToBottom();
    }
    if (!document.querySelector('.overlay')) $('#message-input').focus();
  },

  async loadOlder(chId = App.currentChannel, initial = false) {
    const e = this.entry(chId);
    if (e.loading || (!e.hasMore && !initial)) return;
    e.loading = true;
    const before = initial ? null : e.messages[0]?.id;
    const res = await Net.request('history', { channel: chId, before });
    e.loading = false;
    if (!res || !res.messages) return;
    e.loaded = true;
    e.hasMore = res.hasMore;
    e.messages = [...res.messages, ...e.messages];
    if (chId !== App.currentChannel) return;
    const sc = $('#messages-scroller');
    const prevH = sc.scrollHeight, prevTop = sc.scrollTop;
    this.render();
    if (initial) this.scrollToBottom();
    else sc.scrollTop = sc.scrollHeight - prevH + prevTop;
  },

  // ---------- отрисовка ----------
  render() {
    const box = $('#messages');
    const ch = App.channel(App.currentChannel);
    if (!ch) { box.innerHTML = ''; return; }
    const e = this.entry(ch.id);
    const frag = document.createDocumentFragment();
    if (!e.loaded) {
      frag.appendChild(h(`<div class="load-more"><span class="spinner" style="display:inline-block"></span></div>`));
    } else if (e.hasMore) {
      frag.appendChild(h(`<div class="load-more">Прокрутите вверх, чтобы загрузить старые сообщения</div>`));
    } else {
      frag.appendChild(h(`<div class="chat-welcome"><div class="wl-ic">${icon('hash', 40)}</div><h2></h2><p>Это начало канала #${esc(ch.name)}. Файлы и картинки можно просто перетащить в окно.</p></div>`));
      frag.querySelector('h2').textContent = `Добро пожаловать в #${ch.name}!`;
    }
    let prev = null;
    for (const m of e.messages) { this.renderMessage(m, prev, frag); prev = m; }
    box.innerHTML = '';
    box.appendChild(frag);
  },

  isHead(m, prev) {
    return !prev || prev.author.clientId !== m.author.clientId || m.ts - prev.ts > GROUP_GAP || !sameDay(m.ts, prev.ts);
  },

  renderMessage(m, prev, parent) {
    if (!prev || !sameDay(m.ts, prev.ts)) parent.appendChild(h(`<div class="day-sep">${esc(fmtDay(m.ts))}</div>`));
    const head = this.isHead(m, prev);
    const p = App.profileOf(m.author.clientId, m.author);
    const canDelete = m.author.clientId === App.settings.profile.clientId || App.me?.isHost;
    const el = h(`<div class="msg ${head ? 'head' : ''}" data-id="${esc(m.id)}">
      ${head
        ? `<div class="m-av">${avatarHtml(p, 40)}</div><div class="m-head"><span class="m-name"></span><span class="m-time">${esc(fmtStamp(m.ts))}</span></div>`
        : `<span class="m-stamp">${fmtTime(m.ts)}</span>`}
      ${m.text ? `<div class="m-text">${linkify(m.text)}</div>` : ''}
      ${m.attachments && m.attachments.length ? `<div class="atts">${m.attachments.map(a => this.attachmentHtml(a)).join('')}</div>` : ''}
      ${canDelete ? `<div class="m-actions"><button data-del title="Удалить сообщение">${icon('trash', 18)}</button></div>` : ''}
    </div>`);
    if (head) el.querySelector('.m-name').textContent = p.username;
    parent.appendChild(el);
    return el;
  },

  attachmentHtml(a) {
    const url = App.fileUrl(a.id);
    const mime = a.mime || '';
    if (mime.startsWith('image/')) {
      const src = App.fileUrl(a.thumbId || a.id);
      let style = '';
      if (a.w && a.h) {
        const k = Math.min(1, 420 / a.w, 320 / a.h);
        style = `width:${Math.round(a.w * k)}px;height:${Math.round(a.h * k)}px`;
      }
      return `<img class="att-img" loading="lazy" src="${esc(src)}" data-full="${esc(url)}" data-name="${esc(a.name)}" data-id="${esc(a.id)}" style="${style}" alt="${esc(a.name)}">`;
    }
    if (/^video\/(mp4|webm|ogg)/.test(mime)) {
      return `<video class="att-video" controls preload="metadata" src="${esc(url)}"></video>${this.fileCard(a, true)}`;
    }
    if (/^audio\//.test(mime)) {
      return `<audio class="att-audio" controls preload="none" src="${esc(url)}"></audio>${this.fileCard(a, true)}`;
    }
    return this.fileCard(a);
  },

  fileCard(a, compact = false) {
    const ic = /zip|rar|7z|tar|gz/i.test(a.name) ? 'fileArchive' : 'file';
    return `<div class="att-file" ${compact ? 'style="padding:8px 12px"' : ''}>
      ${compact ? '' : icon(ic, 32, 'big')}
      <div class="f-main"><div class="f-name" data-dl="${esc(a.id)}" title="Скачать">${esc(a.name)}</div><div class="f-size">${fmtBytes(a.size)}</div></div>
      <button class="icon-btn" data-dl="${esc(a.id)}" title="Скачать">${icon('download', 20)}</button>
    </div>`;
  },

  refreshAuthor(clientId) {
    const e = this.cache.get(App.currentChannel);
    if (e && e.messages.some(m => m.author.clientId === clientId) && UI.view === 'chat') {
      const sc = $('#messages-scroller');
      const atBottom = this.nearBottom();
      const top = sc.scrollTop;
      this.render();
      if (atBottom) this.scrollToBottom(); else sc.scrollTop = top;
    }
  },

  nearBottom() {
    const sc = $('#messages-scroller');
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  },

  scrollToBottom() {
    const sc = $('#messages-scroller');
    sc.scrollTop = sc.scrollHeight;
    $('.new-msgs-pill')?.remove();
    // картинки догружаются позже — дотягиваем вниз
    requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
  },

  // ---------- события ----------
  onMessage(m) {
    const e = this.cache.get(m.channel);
    if (e && e.loaded) e.messages.push(m);
    const mine = m.author.clientId === App.settings.profile.clientId;
    const visible = m.channel === App.currentChannel && UI.view === 'chat';

    // кто-то отправил — он больше не «печатает»
    if (App.typing[m.channel]) { delete App.typing[m.channel][m.author.clientId]; this.renderTyping(); }

    if (visible && e) {
      const wasBottom = this.nearBottom();
      const prev = e.messages[e.messages.length - 2] || null;
      if (e.messages.length > CACHE_MAX && wasBottom) {
        e.messages = e.messages.slice(-CACHE_TRIM_TO);
        e.hasMore = true;
        this.render();
      } else {
        this.renderMessage(m, prev, $('#messages'));
      }
      if (wasBottom || mine) this.scrollToBottom();
      else if (!$('.new-msgs-pill')) {
        const pill = h(`<button class="new-msgs-pill">Новые сообщения ${icon('chevronDown', 14)}</button>`);
        pill.onclick = () => this.scrollToBottom();
        $('#chat-view').appendChild(pill);
      }
    } else if (!mine) {
      App.unread[m.channel] = (App.unread[m.channel] || 0) + 1;
      UI.renderSidebar();
    }

    if (!mine) {
      const focused = document.hasFocus() && !document.hidden;
      if (!focused || !visible) Sounds.play('message');
      if (!focused) {
        App.api.window.flash();
        if (App.settings.app.notifications && 'Notification' in window) {
          const ch = App.channel(m.channel);
          const p = App.profileOf(m.author.clientId, m.author);
          const body = m.text ? m.text.slice(0, 140) : `Файл: ${m.attachments?.[0]?.name || ''}`;
          try {
            const n = new Notification(`${p.username} · #${ch ? ch.name : ''}`, { body, silent: true, icon: p.avatar || undefined });
            n.onclick = () => { App.api.window.show(); UI.selectChannel(m.channel); };
          } catch { /* ignore */ }
        }
      }
    }
  },

  onDeleted({ channel, id }) {
    const e = this.cache.get(channel);
    if (!e) return;
    const i = e.messages.findIndex(m => m.id === id);
    if (i < 0) return;
    e.messages.splice(i, 1);
    if (channel === App.currentChannel && UI.view === 'chat') {
      const sc = $('#messages-scroller');
      const top = sc.scrollTop, atBottom = this.nearBottom();
      this.render();
      if (atBottom) this.scrollToBottom(); else sc.scrollTop = top;
    }
  },

  onTyping({ channel, clientId, username }) {
    if (clientId === App.settings.profile.clientId) return;
    App.typing[channel] = App.typing[channel] || {};
    App.typing[channel][clientId] = { name: username, until: Date.now() + 6000 };
    if (channel === App.currentChannel) this.renderTyping();
  },

  renderTyping() {
    const el = $('#typing');
    const t = App.typing[App.currentChannel] || {};
    const now = Date.now();
    const names = Object.entries(t).filter(([, v]) => v.until > now).map(([, v]) => v.name);
    if (!names.length) { el.innerHTML = ''; return; }
    const who = names.length === 1 ? `<b>${esc(names[0])}</b> печатает…`
      : names.length <= 3 ? `<b>${names.map(esc).join(', ')}</b> печатают…` : 'Несколько человек печатают…';
    el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span>${who}</span>`;
  },

  // ---------- отправка ----------
  async send() {
    const input = $('#message-input');
    const text = input.value;
    if (!text.trim() && !this.pending.length) return;
    if (text.length > 4000) { toast('Сообщение слишком длинное (максимум 4000 символов)', { type: 'err' }); return; }
    if (!App.connected) { toast('Нет связи с сервером', { type: 'err' }); return; }
    const channel = App.currentChannel;
    const files = this.pending.splice(0);
    this.renderPending();
    input.value = '';
    this.autosize();

    if (!files.length) {
      const r = await Net.request('message', { channel, text });
      if (!r.ok) { input.value = text; toast(r.error === 'rate' ? 'Слишком часто — подождите пару секунд' : 'Сообщение не отправлено', { type: 'err' }); }
      return;
    }
    await this.sendWithFiles(channel, text, files);
  },

  async sendWithFiles(channel, text, files) {
    const el = h(`<div class="msg head pending">
      <div class="m-av">${avatarHtml(App.settings.profile, 40)}</div>
      <div class="m-head"><span class="m-name"></span><span class="m-time">отправка…</span></div>
      ${text ? `<div class="m-text">${esc(text)}</div>` : ''}
      <div class="atts"></div>
    </div>`);
    el.querySelector('.m-name').textContent = App.settings.profile.username;
    const atts = el.querySelector('.atts');
    const rows = files.map(f => {
      const r = h(`<div class="att-file">${icon('upload', 28, 'big')}
        <div class="f-main"><div class="f-name" style="color:var(--text)"></div><div class="f-size"></div><div class="progress"><i></i></div></div>
        <button class="icon-btn" title="Отменить">${icon('x', 18)}</button></div>`);
      r.querySelector('.f-name').textContent = f.file.name;
      r.querySelector('.f-size').textContent = fmtBytes(f.file.size);
      atts.appendChild(r);
      return r;
    });
    if (channel === App.currentChannel && UI.view === 'chat') { $('#messages').appendChild(el); this.scrollToBottom(); }

    const uploaded = [];
    let cancelled = false;
    for (let i = 0; i < files.length && !cancelled; i++) {
      const f = files[i];
      const row = rows[i];
      const bar = row.querySelector('.progress > i');
      const size = row.querySelector('.f-size');
      const job = { xhr: null, cancelled: false };
      row.querySelector('button').onclick = () => { job.cancelled = true; job.xhr && job.xhr.abort(); };
      try {
        let thumb = null;
        if (f.file.type.startsWith('image/') && f.file.type !== 'image/gif') thumb = await this.makeThumb(f.file).catch(() => null);
        const meta = await this.upload(f.file, job, (got, total) => {
          bar.style.width = `${Math.round(got / total * 100)}%`;
          size.textContent = `${fmtBytes(got)} из ${fmtBytes(total)}`;
        });
        const att = { id: meta.id };
        if (thumb) {
          att.w = thumb.w; att.h = thumb.h;
          if (thumb.blob) {
            const tf = new File([thumb.blob], 'thumb.webp', { type: 'image/webp' });
            const tm = await this.upload(tf, { xhr: null }, () => {}).catch(() => null);
            if (tm) att.thumbId = tm.id;
          }
        }
        uploaded.push(att);
        bar.style.width = '100%';
      } catch (err) {
        if (job.cancelled) { row.remove(); continue; }
        const msg = err && err.error === 'too-large' ? `Файл больше лимита сервера (${err.maxFileMB || App.server.maxFileMB} МБ)` : 'Не удалось загрузить файл';
        toast(`${f.file.name}: ${msg}`, { type: 'err', timeout: 6000 });
        row.remove();
      } finally {
        if (f.preview) URL.revokeObjectURL(f.preview);
      }
    }
    if (!uploaded.length && !text.trim()) { el.remove(); return; }
    const r = await Net.request('message', { channel, text, attachments: uploaded });
    el.remove();
    if (!r.ok) toast('Сообщение не отправлено', { type: 'err' });
  },

  upload(file, job, onProgress) {
    return new Promise((resolve, reject) => {
      const maxMB = App.server?.maxFileMB || 4096;
      if (file.size > maxMB * 1024 * 1024) return reject({ error: 'too-large', maxFileMB: maxMB });
      const xhr = new XMLHttpRequest();
      job.xhr = xhr;
      xhr.open('POST', `${App.base}/upload`);
      xhr.setRequestHeader('X-LC-Token', App.me.token);
      xhr.setRequestHeader('X-LC-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-LC-Mime', file.type || 'application/octet-stream');
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 200) resolve(body); else reject(body);
      };
      xhr.onerror = () => reject({ error: 'network' });
      xhr.onabort = () => reject({ error: 'aborted' });
      xhr.send(file);
    });
  },

  /** Уменьшенная копия картинки для ленты — экономит память и трафик */
  async makeThumb(file) {
    const bmp = await createImageBitmap(file);
    const w = bmp.width, hh = bmp.height;
    let blob = null;
    if (file.size > THUMB_MIN_BYTES || w > 1280 || hh > 1280) {
      const k = Math.min(1, 840 / w, 640 / hh);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(hh * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
      c.width = c.height = 0;
    }
    bmp.close();
    return { blob, w, h: hh };
  },

  // ---------- прикрепление ----------
  addFiles(fileList) {
    if (!App.currentChannel || UI.view !== 'chat') return;
    for (const file of fileList) {
      if (this.pending.length >= 10) { toast('Не больше 10 файлов за раз', { type: 'err' }); break; }
      const preview = file.type.startsWith('image/') && file.size < 50 * 1024 * 1024 ? URL.createObjectURL(file) : null;
      this.pending.push({ file, preview, key: Math.random().toString(36).slice(2) });
    }
    this.renderPending();
    $('#message-input').focus();
  },

  renderPending() {
    const box = $('#pending-files');
    box.innerHTML = '';
    box.classList.toggle('hidden', !this.pending.length);
    for (const p of this.pending) {
      const el = h(`<div class="pf">
        <div class="pf-prev">${p.preview ? `<img src="${esc(p.preview)}">` : icon('file', 36)}</div>
        <div class="pf-name"></div><div class="pf-size">${fmtBytes(p.file.size)}</div>
        <button class="pf-x" title="Убрать">${icon('trash', 14)}</button>
      </div>`);
      el.querySelector('.pf-name').textContent = p.file.name;
      el.querySelector('.pf-x').onclick = () => {
        if (p.preview) URL.revokeObjectURL(p.preview);
        this.pending = this.pending.filter(x => x !== p);
        this.renderPending();
      };
      box.appendChild(el);
    }
  },

  autosize() {
    const t = $('#message-input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, innerHeight * 0.4) + 'px';
  },

  lightbox(url, name, id) {
    const lb = h(`<div class="lightbox"><img alt=""><div class="lb-bar"><span></span><button class="btn">${icon('download', 16)} Скачать</button><button class="btn">${icon('x', 16)} Закрыть</button></div></div>`);
    lb.querySelector('img').src = url;
    lb.querySelector('.lb-bar span').textContent = name || '';
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey, true); };
    lb._close = close;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const [dl, x] = lb.querySelectorAll('.lb-bar .btn');
    dl.onclick = () => App.api.app.download(App.fileUrl(id, true));
    x.onclick = close;
    lb.onclick = e => { if (e.target === lb) close(); };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(lb);
  },

  // ---------- инициализация ----------
  init() {
    const input = $('#message-input');
    $('#attach-btn').innerHTML = icon('plusCircle', 22);
    $('#send-btn').innerHTML = icon('send', 20);
    $('#attach-btn').onclick = () => $('#file-input').click();
    $('#file-input').onchange = e => { this.addFiles(e.target.files); e.target.value = ''; };
    $('#send-btn').onclick = () => this.send();
    input.addEventListener('input', () => {
      this.autosize();
      const now = Date.now();
      if (input.value && now - this.lastTypingSent > 3000) {
        this.lastTypingSent = now;
        Net.emit('typing', { channel: App.currentChannel });
      }
    });
    input.addEventListener('keydown', e => {
      // на телефоне Enter — новая строка, отправка — кнопкой
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !App.api.mobile) { e.preventDefault(); this.send(); }
    });
    input.addEventListener('paste', e => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); this.addFiles(files); }
    });

    const sc = $('#messages-scroller');
    sc.addEventListener('scroll', () => {
      if (sc.scrollTop < 300) this.loadOlder();
      if (this.nearBottom()) $('.new-msgs-pill')?.remove();
    }, { passive: true });

    $('#messages').addEventListener('click', async e => {
      const ext = e.target.closest('a[data-ext]');
      if (ext) { e.preventDefault(); App.api.app.openExternal(ext.dataset.ext); return; }
      const img = e.target.closest('img.att-img');
      if (img) { this.lightbox(img.dataset.full, img.dataset.name, img.dataset.id); return; }
      const dl = e.target.closest('[data-dl]');
      if (dl) { App.api.app.download(App.fileUrl(dl.dataset.dl, true)); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const id = del.closest('.msg').dataset.id;
        const ok = e.shiftKey || await confirmDialog('Удалить сообщение', 'Сообщение и его вложения будут удалены у всех. (Подсказка: Shift+клик — удалить без вопроса.)', { ok: 'Удалить', danger: true });
        if (ok) Net.emit('message-delete', { channel: App.currentChannel, id });
      }
    });

    // меню сообщения: правая кнопка мыши или долгое нажатие на телефоне
    $('#messages').addEventListener('contextmenu', e => {
      const el = e.target.closest('.msg[data-id]');
      if (!el || e.target.closest('a, video, audio')) return;
      e.preventDefault();
      const m = this.entry(App.currentChannel).messages.find(x => x.id === el.dataset.id);
      if (!m) return;
      const mine = m.author.clientId === App.settings.profile.clientId || App.me?.isHost;
      ctxMenu(e.clientX, e.clientY, [
        m.text ? { label: 'Копировать текст', icon: 'copy', onClick: () => copyText(m.text) } : null,
        ...(m.attachments || []).map(a => ({ label: `Скачать «${a.name.length > 28 ? a.name.slice(0, 26) + '…' : a.name}»`, icon: 'download', onClick: () => App.api.app.download(App.fileUrl(a.id, true)) })),
        mine ? { type: 'sep' } : null,
        mine ? { label: 'Удалить сообщение', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDialog('Удалить сообщение', 'Сообщение и его вложения будут удалены у всех.', { ok: 'Удалить', danger: true })) Net.emit('message-delete', { channel: App.currentChannel, id: m.id });
        } } : null,
      ]);
    });

    // перетаскивание файлов в окно
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    const overlay = $('#drop-overlay');
    overlay.innerHTML = `<div class="drop-box">${icon('upload', 48)}<b>Отпустите, чтобы прикрепить</b><span>Файлы любого размера, картинки и видео</span></div>`;
    document.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (UI.view === 'chat' && App.connected) overlay.classList.remove('hidden');
    });
    document.addEventListener('dragleave', e => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.classList.add('hidden');
    });
    document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.classList.add('hidden');
      if (UI.view === 'chat' && App.connected) this.addFiles(e.dataTransfer.files);
    });

    setInterval(() => { if (Object.keys(App.typing[App.currentChannel] || {}).length) this.renderTyping(); }, 1500);
  },
};
