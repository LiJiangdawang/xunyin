/* ============================================================
   player.js —— 播放引擎（队列 / 播放模式 / 音质 / 锁屏控制）
   ============================================================ */
'use strict';

const Player = {
  audio: null,
  queue: [],          // track id 数组
  index: -1,
  current: null,
  quality: null,      // 实际播放音质
  preferQuality: null,
  mode: 'list',       // list | single | shuffle
  playing: false,
  loading: false,
  offline: false,
  from: '主页',
  _blobUrl: null,
  _errStreak: 0,
  _lrc: [],

  init() {
    const a = document.createElement('audio');
    a.id = 'whale-audio';
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    document.getElementById('audio-holder').appendChild(a);
    this.audio = a;
    this.mode = Settings.get('mode') || 'list';
    this.preferQuality = Settings.get('playQuality');

    a.addEventListener('timeupdate', () => this._emitTime());
    a.addEventListener('durationchange', () => this._emitTime());
    a.addEventListener('loadedmetadata', () => {
      this._emitTime();
      if (this.current && isFinite(a.duration) && a.duration > 1 && Math.abs((this.current.duration || 0) - a.duration) > 1) {
        Store.patch(this.current.id, { duration: a.duration }).catch(() => { });
        this.current.duration = a.duration;
        Bus.emit('player:meta', this.current);
      }
    });
    a.addEventListener('play', () => { this.playing = true; Bus.emit('player:state', { playing: true }); this._mediaSession(); });
    a.addEventListener('pause', () => { this.playing = false; Bus.emit('player:state', { playing: false }); });
    a.addEventListener('waiting', () => Bus.emit('player:buffering', true));
    a.addEventListener('playing', () => { Bus.emit('player:buffering', false); });
    a.addEventListener('ended', () => this._onEnded());
    a.addEventListener('error', () => this._onError());

    this._setupMediaSession();
    return this;
  },

  /* ---------------- 队列 ---------------- */
  setQueue(ids, startIndex = 0, opts = {}) {
    this.queue = Array.from(new Set(ids.filter(Boolean)));
    this.index = clamp(startIndex, 0, Math.max(0, this.queue.length - 1));
    if (opts.from) this.from = opts.from;
    Bus.emit('queue:changed', { queue: this.queue, index: this.index });
  },

  addToQueue(id) {
    if (!id || this.queue.includes(id)) return;
    this.queue.push(id);
    Bus.emit('queue:changed', { queue: this.queue, index: this.index });
  },

  /* ---------------- 核心播放 ---------------- */
  async playById(id, opts = {}) {
    const track = Store.get(id);
    if (!track) { Toast.show('歌曲不存在'); return false; }

    if (opts.queue) {
      const i = opts.queue.indexOf(id);
      this.setQueue(opts.queue, i < 0 ? 0 : i, opts);
    } else if (!this.queue.includes(id)) {
      this.setQueue([id], 0, opts);
    } else {
      this.index = this.queue.indexOf(id);
      if (opts.from) this.from = opts.from;
    }
    return this._load(track);
  },

  async _load(track, opts = {}) {
    this.current = track;
    this.loading = true;
    this._emitTime();
    Bus.emit('player:track', track);
    Bus.emit('player:buffering', true);

    const wantQ = this.preferQuality || Settings.get('playQuality');
    const preferLocal = opts.preferLocal !== false;
    let got = null;
    let err = null;

    try {
      got = await Store.getPlayableUrl(track, wantQ, { preferLocal });
      if (!got || !got.url) throw new Error('无可用音频地址');
    } catch (e) {
      err = e;
      // 降级：无损失败 → 高品 → 标准
      for (const q of ['high', 'standard']) {
        if (q === wantQ) continue;
        try {
          got = await Store.getPlayableUrl(track, q, { preferLocal: true });
          if (got && got.url) { err = null; break; }
        } catch { }
      }
    }

    if (!got || !got.url) {
      this.loading = false;
      Bus.emit('player:buffering', false);
      Toast.show('播放失败：' + ((err && err.message) || '音源无响应'));
      Bus.emit('player:error', { track, error: err });
      this._autoSkip();
      return false;
    }

    /* 释放旧 blob */
    if (this._blobUrl) { try { URL.revokeObjectURL(this._blobUrl); } catch { } this._blobUrl = null; }
    if (got.offline) this._blobUrl = got.url;

    this.quality = got.quality;
    this.offline = !!got.offline;
    this.loading = false;
    if (this._errStreak) this._errStreak = 0;

    this.audio.src = got.url;
    try {
      await this.audio.play();
      this.playing = true;
    } catch (e) {
      // iOS 需用户手势；此处播放均来自点击，偶发 AbortError 忽略
      if (e && e.name !== 'AbortError') {
        Bus.emit('player:state', { playing: false });
      }
    }
    Bus.emit('player:buffering', false);

    /* 记录播放 */
    Store.patch(track.id, {
      lastPlayed: Date.now(),
      playCount: (track.playCount || 0) + 1
    }).catch(() => { });

    /* 歌词 */
    this._lrc = [];
    Sources.lyric(track).then(lrc => {
      this._lrc = Sources.parseLrc(lrc);
      Bus.emit('player:lyric', this._lrc);
    }).catch(() => { });

    /* 封面异步补齐 */
    if (!track.cover) {
      Sources.pic(track).then(url => { if (url) Bus.emit('player:meta', Store.get(track.id) || track); }).catch(() => { });
    }

    this._mediaSession();
    return true;
  },

  async toggle() {
    if (!this.current) {
      if (this.queue.length) return this.playById(this.queue[0]);
      return false;
    }
    if (this.audio.paused) {
      try { await this.audio.play(); } catch { Toast.show('无法播放，请再点一次'); }
    } else {
      this.audio.pause();
    }
    return true;
  },

  pause() { if (this.audio) this.audio.pause(); },

  next(user = true) {
    if (!this.queue.length) return false;
    if (this.mode === 'shuffle' && this.queue.length > 1) {
      let i = this.index;
      while (i === this.index) i = Math.floor(Math.random() * this.queue.length);
      this.index = i;
    } else {
      this.index = (this.index + 1) % this.queue.length;
    }
    void user;
    return this.playById(this.queue[this.index], { from: this.from });
  },

  prev() {
    if (!this.queue.length) return false;
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return true;
    }
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    return this.playById(this.queue[this.index], { from: this.from });
  },

  _onEnded() {
    if (this.mode === 'single') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => { });
      return;
    }
    if (!Settings.get('autoNext')) { Bus.emit('player:state', { playing: false }); return; }
    this.next(false);
  },

  _onError() {
    if (!this.current) return;
    this._errStreak++;
    Bus.emit('player:buffering', false);
    if (this._errStreak <= 2) {
      Toast.show('播放出错，切换下一首…');
      this._autoSkip();
    } else {
      Toast.show('连续播放失败，请检查网络或音源设置');
      this._errStreak = 0;
    }
  },

  _autoSkip() {
    if (!Settings.get('autoNext') || this.queue.length < 2) {
      Bus.emit('player:state', { playing: false });
      return;
    }
    setTimeout(() => this.next(false), 400);
  },

  seek(pct) {
    if (!this.audio || !isFinite(this.audio.duration)) return;
    this.audio.currentTime = clamp(pct, 0, 1) * this.audio.duration;
    this._emitTime();
  },

  seekTo(sec) {
    if (!this.audio || !isFinite(this.audio.duration)) return;
    this.audio.currentTime = clamp(sec, 0, this.audio.duration);
    this._emitTime();
  },

  setMode(mode) {
    this.mode = mode || ({ list: 'single', single: 'shuffle', shuffle: 'list' })[this.mode];
    Settings.set('mode', this.mode);
    Bus.emit('player:mode', this.mode);
    return this.mode;
  },

  async setQuality(qk) {
    Settings.set('playQuality', qk);
    this.preferQuality = qk;
    Bus.emit('player:quality', qk);
    if (!this.current) return;
    const before = this.audio.currentTime;
    const wasPlaying = !this.audio.paused;
    // 显式切音质：优先按新档位重新取流（本地没有该档位时走在线）
    const ok = await this._load(this.current, { preferLocal: false });
    if (ok) {
      try { this.audio.currentTime = before; } catch { }
      if (wasPlaying) this.audio.play().catch(() => { });
    }
  },

  setVolume(v) {
    if (this.audio) this.audio.volume = clamp(v, 0, 1);
    Settings.set('lastVolume', clamp(v, 0, 1));
  },

  _emitTime() {
    const a = this.audio;
    if (!a) return;
    const dur = isFinite(a.duration) ? a.duration : (this.current && this.current.duration) || 0;
    const cur = a.currentTime || 0;
    Bus.emit('player:time', { cur, dur, pct: dur ? cur / dur : 0 });
  },

  /* ---------------- 系统媒体控制 ---------------- */
  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => this.toggle());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('nexttrack', () => this.next());
      ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) this.seekTo(d.seekTime); });
    } catch { }
  },

  _mediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || '未知歌手',
        album: t.album || '寻音',
        artwork: t.cover ? [
          { src: t.cover, sizes: '300x300', type: 'image/jpeg' },
          { src: t.cover, sizes: '512x512', type: 'image/jpeg' }
        ] : []
      });
      navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
    } catch { }
  },

  /** 当前歌词行 */
  currentLyricIndex() {
    if (!this._lrc || !this._lrc.length || !this.audio) return -1;
    const t = this.audio.currentTime || 0;
    let idx = -1;
    for (let i = 0; i < this._lrc.length; i++) {
      if (this._lrc[i].t <= t) idx = i; else break;
    }
    return idx;
  }
};
