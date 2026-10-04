// Голосовые каналы и демонстрация экрана (WebRTC, прямое соединение между участниками)
'use strict';

const dbg = (...a) => { if (window.LC_DEBUG) console.log('DBG', ...a); };

const QUALITY = {
  '720p30': { label: '720p', sub: '30 к/с', w: 1280, h: 720, fps: 30, bitrate: 3_000_000 },
  '1080p30': { label: '1080p', sub: '30 к/с', w: 1920, h: 1080, fps: 30, bitrate: 6_000_000 },
  '1080p60': { label: '1080p', sub: '60 к/с', w: 1920, h: 1080, fps: 60, bitrate: 10_000_000 },
  'source60': { label: 'Исходное', sub: 'до 4K · 60 к/с', w: 3840, h: 2160, fps: 60, bitrate: 16_000_000 },
};

// ============================================================
//  Одно соединение с другим участником («perfect negotiation»)
// ============================================================
class Peer {
  /**
   * initiator=true — мы зашли в канал позже и сами начинаем соединение.
   * Второй участник только отвечает: так не бывает «встречных» предложений,
   * из-за которых Chromium иногда не подключал звук.
   */
  constructor(member, initiator = false) {
    this.id = member.socketId;
    this.member = member;
    this.polite = String(App.me.id) > String(this.id);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.queue = Promise.resolve();
    this.micSender = null;
    this.micTx = null;
    this.screenTx = { video: null, audio: null };
    this.remoteScreen = null;
    this.closed = false;

    this.audio = new Audio();
    this.audio.autoplay = true;
    this.applyVolume();
    Voice.applySink(this.audio);

    const pc = this.pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });

    pc.onnegotiationneeded = async () => {
      dbg('negotiationneeded', this.member.username, pc.signalingState);
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        Voice.signal(this.id, { description: pc.localDescription });
      } catch (e) {
        console.warn('negotiation', e);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) dbg('cand ->', this.member.username, candidate.candidate.split(' ').slice(4, 8).join(' '));
      if (candidate) Voice.signal(this.id, { candidate });
    };
    pc.oniceconnectionstatechange = () => {
      dbg('ice', this.member.username, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.ontrack = ev => this.onTrack(ev);

    if (initiator) {
      const mic = Voice.localStream && Voice.localStream.getAudioTracks()[0];
      if (mic) this.micSender = pc.addTrack(mic, Voice.localStream);
      else pc.addTransceiver('audio', { direction: 'recvonly' }); // без микрофона — только слушаем
    }
  }

  /** Отвечающая сторона: подставляем свой микрофон в аудиолинию из предложения */
  attachMicToOffer() {
    if (this.micSender) return;
    const tx = this.micTx || this.pc.getTransceivers().find(t => t.mid !== null && t.receiver.track.kind === 'audio'
      && t !== this.screenTx.audio && !t.lcStreamId);
    if (!tx) return;
    this.micTx = this.micTx || tx;
    const mic = Voice.localStream && Voice.localStream.getAudioTracks()[0];
    if (!mic) return;
    tx.sender.replaceTrack(mic);
    if (tx.sender.setStreams) tx.sender.setStreams(Voice.localStream);
    tx.direction = 'sendrecv';
    this.micSender = tx.sender;
  }

  onTrack({ track, streams, transceiver }) {
    const stream = streams[0];
    const screenId = this.member.stream?.streamId;
    const isScreen = (stream && screenId && stream.id === screenId)
      || track.kind === 'video'
      || (track.kind === 'audio' && this.micTx && transceiver !== this.micTx);

    if (isScreen) {
      // устаревший поток прошлой трансляции — пропускаем
      if (stream && screenId && stream.id !== screenId) return;
      const s = stream || new MediaStream([track]);
      this.remoteScreen = s;
      s.onremovetrack = e => {
        if (e.track.kind === 'video' && this.remoteScreen === s && Viewer.peerId === this.id && Viewer.stream === s) {
          Viewer.close({ silent: true, notify: 'Трансляция завершена' });
        }
      };
      if (Viewer.peerId === this.id) Viewer.setStream(s);
      return;
    }
    this.micTx = transceiver;
    const ms = stream || new MediaStream([track]);
    this.audio.srcObject = ms;
    this.audio.play().catch(() => {});
    Speak.attach(this.id, ms);
  }

  handle(data) {
    this.queue = this.queue.then(() => this._handle(data)).catch(e => console.warn('signal', e));
  }

  async _handle(data) {
    if (this.closed) return;
    const pc = this.pc;
    if (data.description) {
      const d = data.description;
      const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && collision;
      dbg('<-', d.type, 'from', this.member.username, 'state', pc.signalingState, 'collision', collision, 'polite', this.polite, 'ignore', this.ignoreOffer);
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription(d);
      if (d.type === 'offer') {
        this.attachMicToOffer();
        await pc.setLocalDescription();
        Voice.signal(this.id, { description: pc.localDescription });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); dbg('<- cand ok', this.member.username); } catch (e) { dbg('<- cand FAIL', this.member.username, e.message); if (!this.ignoreOffer) console.warn(e); }
    }
  }

  // --- трансляция: отправка экрана этому участнику (только если он смотрит) ---
  addScreen() {
    const s = Voice.screen;
    if (!s || this.closed) return;
    const q = QUALITY[s.quality];
    for (const track of s.stream.getTracks()) {
      const kind = track.kind;
      let tx = this.screenTx[kind];
      if (tx && tx.lcStreamId === s.stream.id && tx.currentDirection !== 'stopped') {
        // тот же сеанс трансляции: зритель вернулся — просто включаем отправку
        tx.sender.replaceTrack(track);
        tx.direction = 'sendonly';
      } else {
        if (tx) { try { tx.stop(); } catch { /* ignore */ } }
        tx = this.pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [s.stream],
          sendEncodings: kind === 'video' ? [{ maxBitrate: q.bitrate, maxFramerate: q.fps }] : [{ maxBitrate: 160_000 }],
        });
        tx.lcStreamId = s.stream.id;
        this.screenTx[kind] = tx;
      }
      if (kind === 'video') setTimeout(() => Voice.applyEncoding(tx.sender, q), 1200);
    }
  }

  /** final=true — трансляция окончена совсем: транслятор освобождается */
  removeScreen(final = false) {
    for (const kind of ['video', 'audio']) {
      const tx = this.screenTx[kind];
      if (!tx || this.closed) continue;
      try {
        if (final) { tx.stop(); this.screenTx[kind] = null; }
        else { tx.sender.replaceTrack(null); tx.direction = 'inactive'; }
      } catch { /* ignore */ }
    }
  }

  replaceMic(track, stream) {
    if (this.micSender) this.micSender.replaceTrack(track);
    else if (track) this.micSender = this.pc.addTrack(track, stream);
  }

  applyVolume() {
    const v = App.settings.voice;
    const cid = this.member.clientId;
    this.audio.volume = Math.max(0, Math.min(1, v.volumes[cid] ?? 1));
    this.audio.muted = Voice.deafened || !!v.localMutes[cid];
  }

  close() {
    this.closed = true;
    Speak.detach(this.id);
    try { this.pc.close(); } catch { /* ignore */ }
    this.audio.srcObject = null;
    this.remoteScreen = null;
  }
}

// ============================================================
//  Определение «кто говорит» (зелёная обводка)
// ============================================================
const Speak = {
  ctx: null,
  nodes: new Map(),
  timer: null,
  state: new Map(),

  attach(sid, stream) {
    this.detach(sid);
    if (!stream || !stream.getAudioTracks().length) return;
    try {
      this.ctx = this.ctx || new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.nodes.set(sid, { src, an, buf: new Uint8Array(an.fftSize), lastLoud: 0 });
      if (!this.timer) this.timer = setInterval(() => this.tick(), 100);
    } catch (e) { console.warn('analyser', e); }
  },

  detach(sid) {
    const n = this.nodes.get(sid);
    if (n) { try { n.src.disconnect(); } catch { /* ignore */ } this.nodes.delete(sid); }
    this.set(sid, false);
    if (!this.nodes.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); // не держим звуковой движок впустую
    }
  },

  level(sid) {
    const n = this.nodes.get(sid);
    if (!n) return 0;
    n.an.getByteTimeDomainData(n.buf);
    let sum = 0;
    for (let i = 0; i < n.buf.length; i++) { const x = (n.buf[i] - 128) / 128; sum += x * x; }
    return Math.sqrt(sum / n.buf.length);
  },

  tick() {
    const now = Date.now();
    for (const [sid, n] of this.nodes) {
      const isMe = sid === App.me?.id;
      const member = Voice.member(sid);
      const silenced = isMe ? Voice.muted : (member?.muted || App.settings.voice.localMutes[member?.clientId]);
      if (!silenced && this.level(sid) > 0.03) n.lastLoud = now;
      this.set(sid, !silenced && now - n.lastLoud < 300);
    }
  },

  set(sid, on) {
    if ((this.state.get(sid) || false) === on) return;
    this.state.set(sid, on);
    $$(`[data-sid="${CSS.escape(sid)}"]`).forEach(el => el.classList.toggle('speaking', on));
  },

  reapply() {
    for (const [sid, on] of this.state) if (on) $$(`[data-sid="${CSS.escape(sid)}"]`).forEach(el => el.classList.add('speaking'));
  },
};

// ============================================================
//  Просмотр трансляции: сцена, полный экран, мини-окно, «поверх окон»
// ============================================================
const Viewer = {
  el: null,
  video: null,
  peerId: null,
  stream: null,
  statsTimer: null,
  lastFrames: 0,
  waitTimer: null,

  build() {
    if (this.el) return;
    this.el = h(`<div id="viewer">
      <video autoplay playsinline></video>
      <div class="v-wait"><span class="spinner big"></span><span>Подключение к трансляции…</span></div>
      <div class="v-top">
        <div class="v-title"><span class="live-badge">В эфире</span><span class="v-name"></span></div>
        <span class="v-stats"></span>
      </div>
      <div class="v-bottom">
        <label class="v-vol" title="Громкость трансляции">${icon('speaker', 18)}<input type="range" min="0" max="100" value="100"></label>
        <button class="v-btn" data-a="mini" title="Свернуть в мини-окно">${icon('minimize', 18)}</button>
        <button class="v-btn" data-a="pip" title="Поверх всех окон">${icon('pip', 18)}</button>
        <button class="v-btn" data-a="full" title="Во весь экран (F, двойной щелчок)">${icon('maximize', 18)}</button>
        <button class="v-btn close" data-a="close" title="Прекратить просмотр">${icon('x', 18)}</button>
      </div>
    </div>`);
    this.video = this.el.querySelector('video');
    if (!document.pictureInPictureEnabled) this.el.querySelector('[data-a="pip"]').remove();
    this.video.addEventListener('dblclick', () => this.toggleFullscreen());
    this.el.querySelector('.v-vol input').oninput = e => { this.video.volume = e.target.value / 100; };
    this.el.querySelector('.v-bottom').onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'full') this.toggleFullscreen();
      if (a === 'pip') this.togglePip();
      if (a === 'mini') this.toggleMini();
      if (a === 'close') this.close();
    };
    this.video.addEventListener('click', () => { if (this.mode === 'mini') this.expand(); });
    document.addEventListener('fullscreenchange', () => {
      const b = this.el.querySelector('[data-a="full"]');
      const fs = document.fullscreenElement === this.el;
      b.innerHTML = icon(fs ? 'minimize' : 'maximize', 18);
      b.title = fs ? 'Выйти из полноэкранного режима (Esc)' : 'Во весь экран (F, двойной щелчок)';
    });
    this.video.addEventListener('leavepictureinpicture', () => this.place());
    this.makeDraggable();
  },

  makeDraggable() {
    const mp = $('#mini-player');
    const handle = $('#mp-drag');
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      const r = mp.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const top0 = App.api.mobile ? 0 : 30;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        mp.style.left = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx)) + 'px';
        mp.style.top = Math.max(top0, Math.min(innerHeight - r.height, ev.clientY - dy)) + 'px';
        mp.style.right = 'auto';
        mp.style.bottom = 'auto';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => this.expand());
  },

  open(peerId) {
    this.build();
    if (this.peerId && this.peerId !== peerId) this.close({ silent: true });
    this.peerId = peerId;
    this.forceMini = false;
    const m = Voice.member(peerId);
    const p = App.profileOf(m?.clientId, m);
    this.el.querySelector('.v-name').textContent = p.username;
    this.el.querySelector('.v-wait').classList.remove('hidden');
    this.video.muted = Voice.deafened;
    Voice.applySink(this.video);
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => {
      if (this.peerId === peerId && !this.stream) {
        toast('Не удалось подключиться к трансляции. Попробуйте ещё раз.', { type: 'err' });
        this.close({ silent: true });
      }
    }, 15000);
    const peer = Voice.peers.get(peerId);
    if (peer && peer.remoteScreen && peer.remoteScreen.getVideoTracks().length) this.setStream(peer.remoteScreen);
    this.place();
    Voice.renderVoiceView();
  },

  setStream(stream) {
    this.stream = stream;
    clearTimeout(this.waitTimer);
    this.video.srcObject = stream;
    this.video.play().catch(() => {});
    this.el.querySelector('.v-wait').classList.add('hidden');
    this.el.querySelector('.v-vol').classList.toggle('hidden', !stream.getAudioTracks().length);
    clearInterval(this.statsTimer);
    this.lastFrames = 0;
    this.statsTimer = setInterval(() => this.updateStats(), 1000);
  },

  updateStats() {
    const v = this.video;
    if (!v.videoWidth) return;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0;
    const fps = this.lastFrames ? q - this.lastFrames : 0;
    this.lastFrames = q;
    this.el.querySelector('.v-stats').textContent = `${v.videoWidth}×${v.videoHeight}${fps ? ` · ${fps} к/с` : ''}`;
  },

  get mode() {
    if (!this.peerId) return null;
    const onStage = !this.forceMini && UI.view === 'voice' && App.currentChannel === Voice.channel;
    return onStage ? 'stage' : 'mini';
  },

  /** Куда поставить окно просмотра: на «сцену» голосового канала или в мини-окно */
  place() {
    const stage = $('#stage');
    const mp = $('#mini-player');
    const vv = $('#voice-view');
    if (!this.peerId) {
      stage.classList.add('hidden');
      mp.classList.add('hidden');
      vv.classList.remove('has-stage');
      return;
    }
    if (document.pictureInPictureElement === this.video) return; // не трогаем во время «поверх окон»
    const mode = this.mode;
    const target = mode === 'stage' ? stage : mp;
    if (this.el.parentElement !== target) {
      target.appendChild(this.el);
      this.video.play().catch(() => {});
    }
    this.el.classList.toggle('mini', mode === 'mini');
    stage.classList.toggle('hidden', mode !== 'stage');
    vv.classList.toggle('has-stage', mode === 'stage');
    mp.classList.toggle('hidden', mode !== 'mini');
    const b = this.el.querySelector('[data-a="mini"]');
    b.innerHTML = icon(mode === 'mini' ? 'maximize' : 'minimize', 18);
    b.title = mode === 'mini' ? 'Развернуть в окне канала' : 'Свернуть в мини-окно';
  },

  toggleMini() {
    if (this.mode === 'mini') this.expand();
    else { this.forceMini = true; this.place(); }
  },

  expand() {
    this.forceMini = false;
    if (Voice.channel && (UI.view !== 'voice' || App.currentChannel !== Voice.channel)) UI.selectChannel(Voice.channel);
    else this.place();
  },

  toggleFullscreen() {
    if (!this.el) return;
    if (this.pseudoFs) { this.setPseudoFs(false); return; }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    // в Android WebView полноэкранный режим элемента может быть недоступен — растягиваем окно сами
    if (this.el.requestFullscreen) this.el.requestFullscreen().catch(() => this.setPseudoFs(true));
    else this.setPseudoFs(true);
  },

  setPseudoFs(on) {
    this.pseudoFs = on;
    this.el.classList.toggle('pseudo-fs', on);
    const b = this.el.querySelector('[data-a="full"]');
    b.innerHTML = icon(on ? 'minimize' : 'maximize', 18);
  },

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch { toast('Режим «поверх окон» недоступен', { type: 'err' }); }
  },

  close({ silent = false, notify = null } = {}) {
    if (!this.peerId) return;
    const pid = this.peerId;
    this.peerId = null;
    this.stream = null;
    clearTimeout(this.waitTimer);
    clearInterval(this.statsTimer);
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
    if (this.pseudoFs) this.setPseudoFs(false);
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    this.video.srcObject = null;
    this.el.remove();
    if (!silent) Voice.signal(pid, { type: 'unwatch' });
    const peer = Voice.peers.get(pid);
    if (peer) peer.remoteScreen = null;
    this.place();
    Voice.renderVoiceView();
    if (notify) toast(notify);
  },
};

// ============================================================
//  Голосовой канал
// ============================================================
const Voice = {
  channel: null,
  localStream: null,
  muted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  peers: new Map(),
  screen: null,           // { stream, quality, audio, viewers:Set }
  rejoin: null,
  tiles: new Map(),

  member(sid) {
    if (!this.channel) return null;
    const ch = App.channel(this.channel);
    return ch?.members?.find(m => m.socketId === sid) || this.peers.get(sid)?.member || null;
  },

  signal(to, data) { Net.emit('signal', { to, data }); },

  // ---------- вход / выход ----------
  async getMic() {
    const v = App.settings.voice;
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: v.inputId && v.inputId !== 'default' ? { ideal: v.inputId } : undefined,
        echoCancellation: v.echoCancellation,
        noiseSuppression: v.noiseSuppression,
        autoGainControl: v.autoGainControl,
        channelCount: 1,
      },
      video: false,
    });
  },

  async join(chId) {
    if (this.channel === chId) return;
    if (this.channel) this.leave({ silent: true });
    try {
      this.localStream = await this.getMic();
    } catch {
      this.localStream = null;
      toast('Микрофон недоступен — вы в канале только слушаете. Проверьте настройки «Голос и видео».', { type: 'err', timeout: 6000 });
    }
    this.applyMuteToTrack();
    const res = await Net.request('voice-join', { channel: chId, muted: this.muted || !this.localStream, deafened: this.deafened });
    if (!res || !res.ok) {
      this.stopMic();
      toast('Не удалось войти в голосовой канал', { type: 'err' });
      return;
    }
    this.channel = chId;
    this.rejoin = null;
    if (App.api.voice) { App.api.voice.active(true); this.speakerOn = true; }
    for (const m of res.peers) this.ensurePeer(m, true);
    if (this.localStream) Speak.attach(App.me.id, this.localStream);
    Sounds.play('join');
    UI.renderSidebar();
    UI.renderVoicePanel();
    this.renderVoiceView();
  },

  leave({ silent = false, local = false } = {}) {
    if (!this.channel) return;
    if (!local) Net.emit('voice-leave');
    if (this.screen) this.stopShare({ local: true });
    Viewer.close({ silent: true });
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.stopMic();
    Speak.detach(App.me?.id);
    this.channel = null;
    if (App.api.voice) App.api.voice.active(false);
    if (!silent) Sounds.play('leave');
    UI.renderSidebar();
    UI.renderVoicePanel();
    this.renderVoiceView();
  },

  stopMic() {
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
    this.localStream = null;
  },

  onDisconnected() {
    if (!this.channel) return;
    this.rejoin = this.channel;
    this.leave({ silent: true, local: true });
  },

  onReconnected() {
    if (this.rejoin && App.channel(this.rejoin)) {
      const ch = this.rejoin;
      this.rejoin = null;
      this.join(ch);
    }
  },

  ensurePeer(member, initiator = false) {
    let p = this.peers.get(member.socketId);
    if (p) { p.member = member; return p; }
    if (!member.socketId || member.socketId === App.me.id) return null;
    p = new Peer(member, initiator);
    this.peers.set(member.socketId, p);
    return p;
  },

  // ---------- события сервера ----------
  onUserJoined({ channel, member }) {
    if (channel !== this.channel) return;
    this.ensurePeer(member);
    Sounds.play('join');
  },

  onUserLeft({ socketId, channel }) {
    if (channel !== this.channel) return;
    if (Viewer.peerId === socketId) Viewer.close({ silent: true, notify: 'Трансляция завершена' });
    const p = this.peers.get(socketId);
    if (p) { p.close(); this.peers.delete(socketId); }
    if (this.screen) this.screen.viewers.delete(socketId);
    Sounds.play('leave');
  },

  onSignal({ from, data }) {
    if (!this.channel || !data) return;
    if (data.type === 'watch') {
      const p = this.peers.get(from) || this.ensurePeer(this.member(from) || { socketId: from });
      if (!p) return;
      if (this.screen) {
        this.screen.viewers.add(from);
        p.addScreen();
        this.renderVoiceView();
      }
      return;
    }
    if (data.type === 'unwatch') {
      const p = this.peers.get(from);
      if (p) p.removeScreen();
      if (this.screen) { this.screen.viewers.delete(from); this.renderVoiceView(); }
      return;
    }
    let p = this.peers.get(from);
    if (!p) {
      const m = this.member(from);
      if (!m) return;
      p = this.ensurePeer(m);
    }
    p && p.handle(data);
  },

  onStreamStarted({ socketId }) {
    const m = this.member(socketId);
    if (!m) return;
    const p = this.peers.get(socketId);
    if (p) p.member = m;
    const name = App.profileOf(m.clientId, m).username;
    Sounds.play('stream');
    if (!(UI.view === 'voice' && App.currentChannel === this.channel)) {
      toast(`${name} начинает трансляцию`, { action: { label: 'Смотреть', onClick: () => { UI.selectChannel(this.channel); this.watch(socketId); } }, timeout: 7000 });
    }
  },

  onStreamStopped({ socketId }) {
    if (Viewer.peerId === socketId) Viewer.close({ silent: true, notify: 'Трансляция завершена' });
    const p = this.peers.get(socketId);
    if (p) p.remoteScreen = null;
  },

  onChannels() {
    if (this.channel) {
      const ch = App.channel(this.channel);
      if (!ch) { this.leave({ silent: true, local: true }); return; }
      const mine = ch.members.find(m => m.socketId === App.me.id);
      if (!mine) { this.leave({ silent: true, local: true }); return; }
      for (const m of ch.members) { const p = this.peers.get(m.socketId); if (p) p.member = m; }
      // трансляцию, которую смотрим, завершили
      if (Viewer.peerId) {
        const sm = ch.members.find(m => m.socketId === Viewer.peerId);
        if (!sm || !sm.stream) Viewer.close({ silent: true, notify: 'Трансляция завершена' });
      }
    }
    UI.renderVoicePanel();
    this.renderVoiceView();
  },

  // ---------- микрофон / звук ----------
  applyMuteToTrack() {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted && !this.deafened; });
  },

  sendState() {
    Net.emit('voice-state', { muted: this.muted || this.deafened || !this.localStream, deafened: this.deafened });
  },

  toggleMute() {
    if (this.deafened) { this.toggleDeafen(); if (!this.muted) return; }
    this.muted = !this.muted;
    this.applyMuteToTrack();
    this.sendState();
    Sounds.play(this.muted ? 'mute' : 'unmute');
    UI.renderUserPanel();
    this.renderVoiceView();
  },

  toggleDeafen() {
    this.deafened = !this.deafened;
    if (this.deafened) { this.mutedBeforeDeafen = this.muted; }
    else { this.muted = this.mutedBeforeDeafen; }
    for (const p of this.peers.values()) p.applyVolume();
    if (Viewer.video) Viewer.video.muted = this.deafened;
    this.applyMuteToTrack();
    this.sendState();
    Sounds.play(this.deafened ? 'mute' : 'unmute');
    UI.renderUserPanel();
    this.renderVoiceView();
  },

  applySink(el) {
    const id = App.settings.voice.outputId;
    if (el && el.setSinkId && id) el.setSinkId(id === 'default' ? '' : id).catch(() => {});
  },

  applyOutput() {
    for (const p of this.peers.values()) this.applySink(p.audio);
    if (Viewer.video) this.applySink(Viewer.video);
  },

  async applyInput() {
    if (!this.channel) return;
    let stream;
    try { stream = await this.getMic(); } catch { toast('Не удалось открыть микрофон', { type: 'err' }); return; }
    const track = stream.getAudioTracks()[0];
    for (const p of this.peers.values()) p.replaceMic(track, stream);
    this.stopMic();
    this.localStream = stream;
    this.applyMuteToTrack();
    Speak.attach(App.me.id, stream);
    this.sendState();
  },

  applyVolumes() { for (const p of this.peers.values()) p.applyVolume(); },

  // ---------- демонстрация экрана ----------
  async applyEncoding(sender, q) {
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = q.bitrate;
      p.encodings[0].maxFramerate = q.fps;
      p.degradationPreference = q.fps >= 60 ? 'maintain-framerate' : 'maintain-resolution';
      await sender.setParameters(p);
    } catch {
      try {
        const p = sender.getParameters();
        if (p.encodings && p.encodings[0]) { p.encodings[0].maxBitrate = q.bitrate; await sender.setParameters(p); }
      } catch { /* ignore */ }
    }
  },

  canShare() {
    return !App.api.mobile && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  },

  async toggleShare() {
    if (this.screen) this.stopShare();
    else this.openPicker();
  },

  async openPicker() {
    if (!this.channel) return;
    const v = App.settings.voice;
    let quality = QUALITY[v.quality] ? v.quality : '1080p30';
    let shareAudio = !!v.shareAudio;

    if (App.api.browser) return this.startShare({ id: null, quality, audio: shareAudio });

    const sources = await App.api.screen.sources();
    const screens = sources.filter(s => s.isScreen);
    const windows = sources.filter(s => !s.isScreen);
    let tab = 'screens';
    let selected = screens[0]?.id || windows[0]?.id || null;

    const body = h(`<div style="display:flex;flex-direction:column;gap:16px">
      <div class="tabs"><button data-t="screens">Экраны (${screens.length})</button><button data-t="windows">Окна приложений (${windows.length})</button></div>
      <div class="src-grid"></div>
      <div class="field"><label>Качество трансляции</label><div class="seg" id="q-seg"></div>
        <span class="hint">Для игр — 60 к/с, для текста и кода — 1080p 30 к/с. Чем выше качество, тем больше нагрузка на сеть и процессор.</span></div>
      ${App.info.platform === 'win32' ? `<label class="check"><input type="checkbox" id="q-audio"><span class="check-text"><b>Транслировать звук компьютера</b><span>Звук игры или видео. Голоса собеседников тоже попадут в трансляцию — лучше использовать наушники.</span></span></label>` : ''}
    </div>`);
    const grid = body.querySelector('.src-grid');
    const renderGrid = () => {
      $$('.tabs button', body).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      const list = tab === 'screens' ? screens : windows;
      grid.innerHTML = list.length ? '' : '<div class="empty-note" style="grid-column:1/-1">Нет доступных источников</div>';
      for (const s of list) {
        const el = h(`<button class="src ${s.id === selected ? 'on' : ''}"><div class="src-th"></div><div class="src-name">${s.icon ? `<img src="${esc(s.icon)}">` : icon(s.isScreen ? 'screen' : 'popout', 16)}<span></span></div></button>`);
        if (s.thumbnail) el.querySelector('.src-th').style.backgroundImage = `url("${s.thumbnail}")`;
        el.querySelector('span').textContent = s.isScreen ? (screens.length > 1 ? s.name : 'Весь экран') : s.name;
        el.onclick = () => { selected = s.id; renderGrid(); };
        el.ondblclick = () => { selected = s.id; go(); };
        grid.appendChild(el);
      }
    };
    body.querySelector('.tabs').onclick = e => { const t = e.target.closest('[data-t]'); if (t) { tab = t.dataset.t; renderGrid(); } };
    const seg = body.querySelector('#q-seg');
    const renderSeg = () => {
      seg.innerHTML = Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}" class="${k === quality ? 'on' : ''}">${q.label} <span style="font-weight:400;opacity:.75">${q.sub}</span></button>`).join('');
    };
    seg.onclick = e => { const b = e.target.closest('[data-q]'); if (b) { quality = b.dataset.q; renderSeg(); } };
    const audioBox = body.querySelector('#q-audio');
    if (audioBox) { audioBox.checked = shareAudio; audioBox.onchange = () => { shareAudio = audioBox.checked; }; }
    renderGrid();
    renderSeg();

    let m;
    const go = () => {
      if (!selected) return;
      m && m.close();
      App.saveSettings({ voice: { quality, shareAudio } });
      this.startShare({ id: selected, quality, audio: shareAudio });
    };
    m = modal({
      title: 'Демонстрация экрана',
      body,
      wide: true,
      buttons: [
        { label: 'Отмена', kind: 'ghost' },
        { label: 'Начать трансляцию', kind: 'primary', onClick: () => { go(); return false; } },
      ],
    });
  },

  async startShare({ id, quality, audio }) {
    const q = QUALITY[quality] || QUALITY['1080p30'];
    let stream;
    try {
      if (id) await App.api.screen.select({ id, audio });
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: !!audio,
      });
    } catch (e) {
      if (e && e.name !== 'NotAllowedError') toast('Не удалось начать трансляцию: ' + (e.message || e), { type: 'err' });
      return;
    }
    if (!this.channel) { stream.getTracks().forEach(t => t.stop()); return; }
    const vt = stream.getVideoTracks()[0];
    if (vt) {
      vt.contentHint = q.fps >= 60 ? 'motion' : 'detail';
      vt.addEventListener('ended', () => this.stopShare());
    }
    this.screen = { stream, quality, audio: stream.getAudioTracks().length > 0, viewers: new Set() };
    Net.emit('stream-start', { streamId: stream.id, quality, audio: this.screen.audio });
    Sounds.play('stream');
    toast('Трансляция началась. Друзья увидят её, нажав «Смотреть».', { type: 'ok' });
    UI.renderVoicePanel();
    this.renderVoiceView();
  },

  stopShare({ local = false } = {}) {
    if (!this.screen) return;
    const s = this.screen;
    this.screen = null;
    for (const p of this.peers.values()) p.removeScreen(true);
    s.stream.getTracks().forEach(t => t.stop());
    if (!local) Net.emit('stream-stop');
    const tile = this.tiles.get(App.me?.id);
    if (tile) { const v = tile.querySelector('video'); if (v) { v.srcObject = null; v.remove(); } }
    Sounds.play('leave');
    UI.renderVoicePanel();
    this.renderVoiceView();
  },

  watch(sid) {
    if (sid === App.me.id) return;
    if (Viewer.peerId === sid) { Viewer.expand(); return; }
    Viewer.open(sid);
    this.signal(sid, { type: 'watch' });
  },

  // ---------- отрисовка голосового канала ----------
  renderVoiceView() {
    if (UI.view !== 'voice') { Viewer.place(); return; }
    const ch = App.channel(App.currentChannel);
    if (!ch || ch.type !== 'voice') return;
    const joined = this.channel === ch.id;
    const cta = $('#voice-join-cta');
    cta.classList.toggle('hidden', joined);
    $('#voice-bar').classList.toggle('hidden', !joined);

    if (!joined) {
      const ms = ch.members || [];
      const streamer = ms.find(m => m.stream);
      cta.innerHTML = `
        <div class="preview">${ms.slice(0, 6).map(m => avatarHtml(App.profileOf(m.clientId, m), 64)).join('') || `<div class="wl-ic" style="width:80px;height:80px;border-radius:50%;background:var(--bg-input);display:grid;place-items:center">${icon('volume', 40)}</div>`}</div>
        <h2>${esc(ch.name)}</h2>
        <p>${ms.length ? `Сейчас в канале: ${ms.map(m => esc(App.profileOf(m.clientId, m).username)).join(', ')}` : 'Здесь пока никого нет.'}${streamer ? `<br><span class="live-badge">В эфире</span> ${esc(App.profileOf(streamer.clientId, streamer).username)} показывает экран` : ''}</p>
        <button class="btn success big" id="vj-btn">${icon('volume', 20)} Присоединиться</button>`;
      $('#vj-btn').onclick = () => this.join(ch.id);
      for (const t of this.tiles.values()) t.remove();
      this.tiles.clear();
      Viewer.place();
      return;
    }

    // плитки участников (с сохранением элементов, чтобы видео не мигало)
    const grid = $('#voice-grid');
    const seen = new Set();
    for (const m of ch.members) {
      seen.add(m.socketId);
      let t = this.tiles.get(m.socketId);
      if (!t) {
        t = h(`<div class="tile" data-sid="${esc(m.socketId)}"><div class="t-av"></div><div class="t-live"></div><div class="t-watch"></div><div class="t-name"></div></div>`);
        t.addEventListener('contextmenu', e => { e.preventDefault(); UI.memberMenu(e.clientX, e.clientY, this.member(t.dataset.sid)); });
        t.addEventListener('dblclick', () => { const mm = this.member(t.dataset.sid); if (mm?.stream) this.watch(mm.socketId); });
        this.tiles.set(m.socketId, t);
        grid.appendChild(t);
      }
      this.updateTile(t, m);
    }
    for (const [sid, t] of this.tiles) if (!seen.has(sid)) { t.remove(); this.tiles.delete(sid); }
    Speak.reapply();

    // нижняя панель
    $('#voice-bar').innerHTML = `
      <button class="vbtn ${this.muted || this.deafened ? 'off' : ''}" data-v="mic" title="${this.muted ? 'Включить микрофон' : 'Выключить микрофон'} (Ctrl+Shift+M)">${icon(this.muted || this.deafened ? 'micOff' : 'mic', 24)}</button>
      <button class="vbtn ${this.deafened ? 'off' : ''}" data-v="deaf" title="${this.deafened ? 'Включить звук' : 'Выключить звук'} (Ctrl+Shift+D)">${icon(this.deafened ? 'headphonesOff' : 'headphones', 24)}</button>
      ${this.canShare() ? `<button class="vbtn ${this.screen ? 'on' : ''}" data-v="share" title="${this.screen ? 'Остановить трансляцию' : 'Показать экран'}">${icon(this.screen ? 'screenOff' : 'screenShare', 24)}</button>` : ''}
      ${App.api.voice ? `<button class="vbtn ${this.speakerOn ? 'on' : ''}" data-v="speaker" title="${this.speakerOn ? 'Звук через динамик' : 'Звук через наушник'}">${icon(this.speakerOn ? 'volume' : 'phone', 24)}</button>` : ''}
      <button class="vbtn leave" data-v="leave" title="Отключиться">${icon('phoneOff', 24)}</button>`;
    Viewer.place();
  },

  updateTile(t, m) {
    const p = App.profileOf(m.clientId, m);
    const isMe = m.socketId === App.me.id;
    const key = `${p.username}|${p.avatar ? p.avatar.length : 0}|${p.color}`;
    if (t.dataset.k !== key) {
      t.dataset.k = key;
      t.querySelector('.t-av').innerHTML = avatarHtml(p, 80);
    }
    const muted = isMe ? (this.muted || this.deafened || !this.localStream) : m.muted;
    const deaf = isMe ? this.deafened : m.deafened;
    const localMute = !isMe && App.settings.voice.localMutes[m.clientId];
    t.querySelector('.t-name').innerHTML = `${muted ? `<span class="red">${icon('micOff', 14)}</span>` : ''}${deaf ? `<span class="red">${icon('headphonesOff', 14)}</span>` : ''}${localMute ? `<span class="red">${icon('speakerOff', 14)}</span>` : ''}<span>${esc(p.username)}${isMe ? ' (вы)' : ''}</span>`;

    const streaming = isMe ? !!this.screen : !!m.stream;
    const watching = Viewer.peerId === m.socketId;
    t.classList.toggle('watching', watching);
    t.querySelector('.t-live').innerHTML = streaming ? `<span class="live-badge">В эфире</span>` : '';
    const w = t.querySelector('.t-watch');
    if (streaming && !isMe) {
      w.innerHTML = watching
        ? `<span class="btn" style="pointer-events:none">${icon('eye', 16)} Вы смотрите</span>`
        : `<button class="btn">${icon('eye', 16)} Смотреть трансляцию</button>`;
      w.classList.toggle('always', !watching);
      const b = w.querySelector('button');
      if (b) b.onclick = () => this.watch(m.socketId);
    } else if (streaming && isMe) {
      const n = this.screen.viewers.size;
      w.innerHTML = `<span class="btn" style="pointer-events:none">${icon('eye', 16)} Смотрят: ${n}</span>`;
      w.classList.remove('always');
    } else {
      w.innerHTML = '';
    }
    // своя трансляция — превью в плитке
    let v = t.querySelector('video');
    if (isMe && this.screen) {
      if (!v) {
        v = document.createElement('video');
        v.muted = true; v.autoplay = true; v.playsInline = true;
        t.insertBefore(v, t.firstChild);
      }
      if (v.srcObject !== this.screen.stream) { v.srcObject = this.screen.stream; v.play().catch(() => {}); }
    } else if (v) { v.srcObject = null; v.remove(); }
  },

  init() {
    $('#voice-bar').addEventListener('click', e => {
      const a = e.target.closest('[data-v]')?.dataset.v;
      if (a === 'mic') this.toggleMute();
      if (a === 'deaf') this.toggleDeafen();
      if (a === 'share') this.toggleShare();
      if (a === 'speaker') { this.speakerOn = !this.speakerOn; App.api.voice.speaker(this.speakerOn); this.renderVoiceView(); }
      if (a === 'leave') this.leave();
    });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); this.toggleMute(); }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); this.toggleDeafen(); }
      if (e.code === 'KeyF' && Viewer.peerId && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); Viewer.toggleFullscreen(); }
    });
  },
};
