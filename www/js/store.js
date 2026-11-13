/* ============================================================
   store.js —— 全局状态 / 曲库 / 收藏 / 下载引擎
   ============================================================ */
'use strict';

/* ---------------- 音质定义（对齐酷狗：标准 / 高品 / 无损） ---------------- */
const QUALITIES = [
  { key: 'standard', label: '标准音质', short: '标准', desc: 'MP3 · 128kbps', cls: 'q-standard', level: 1 },
  { key: 'high', label: '高品音质', short: '高品', desc: 'MP3 · 320kbps', cls: 'q-high', level: 2 },
  { key: 'lossless', label: '无损音质', short: '无损', desc: 'FLAC / WAV · 无损', cls: 'q-lossless', level: 3 }
];
/* Object.fromEntries 在 Chromium 73 之前不存在（老 WebView 会直接报错） */
const QMAP = (() => {
  const m = {};
  for (let i = 0; i < QUALITIES.length; i++) m[QUALITIES[i].key] = QUALITIES[i];
  return m;
})();

/* ---------------- 事件总线 ---------------- */
const Bus = {
  _h: {},
  on(evt, fn) { (this._h[evt] || (this._h[evt] = [])).push(fn); return () => this.off(evt, fn); },
  off(evt, fn) { this._h[evt] = (this._h[evt] || []).filter(f => f !== fn); },
  emit(evt, payload) { (this._h[evt] || []).forEach(f => { try { f(payload); } catch (e) { console.warn('[bus]', evt, e); } }); }
};

/* ---------------- 设置 ---------------- */
const Settings = {
  defaults: {
    playQuality: 'high',
    downloadQuality: 'high',
    mode: 'list',
    showLyric: false,
    autoNext: true,
    lastVolume: 1
  },
  get(key) {
    const v = Storage.get('settings', {});
    return v[key] === undefined ? this.defaults[key] : v[key];
  },
  set(key, val) {
    const v = Storage.get('settings', {});
    v[key] = val;
    Storage.set('settings', v);
    Bus.emit('settings:changed', { key, val });
  },
  all() { return { ...this.defaults, ...Storage.get('settings', {}) }; }
};

/* ---------------- 曲库 ---------------- */
const Store = {
  tracks: new Map(),          // id -> track
  dlQueue: [],                // 下载队列
  dlActive: 0,
  ready: false,

  async init() {
    const all = await DB.allTracks();
    all.forEach(t => this.tracks.set(t.id, t));
    this.ready = true;
    Bus.emit('library:changed');
    return this;
  },

  /* ---- 查询 ---- */
  get(id) { return this.tracks.get(id) || null; },
  all() { return Array.from(this.tracks.values()); },
  favorites() { return this.all().filter(t => t.favorite).sort((a, b) => (b.favAt || 0) - (a.favAt || 0)); },
  downloaded() { return this.all().filter(t => t.downloaded).sort((a, b) => (b.dlAt || 0) - (a.dlAt || 0)); },
  locals() { return this.all().filter(t => t.sourceId === 'local').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); },
  recents(n = 20) {
    return this.all().filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n);
  },
  isFav(id) { const t = this.get(id); return !!(t && t.favorite); },
  isDownloaded(id) { const t = this.get(id); return !!(t && t.downloaded); },

  /* ---- 写入 ---- */
  async upsert(track) {
    const old = this.tracks.get(track.id);
    const merged = { ...(old || {}), ...track, createdAt: (old && old.createdAt) || track.createdAt || Date.now() };
    this.tracks.set(merged.id, merged);
    await DB.putTrack(merged);
    Bus.emit('library:changed');
    return merged;
  },

  async patch(id, patch) {
    const t = this.get(id);
    if (!t) return null;
    Object.assign(t, patch);
    await DB.putTrack(t);
    Bus.emit('library:changed');
    return t;
  },

  /** 仅改内存（如封面缓存），不落库，避免曲库膨胀 */
  patchMem(id, patch) {
    const t = this.get(id);
    if (!t) return null;
    Object.assign(t, patch);
    return t;
  },

  async toggleFavorite(id) {
    const t = this.get(id);
    if (!t) return false;
    const val = t.favorite ? 0 : 1;
    await this.patch(id, { favorite: val, favAt: val ? Date.now() : 0 });
    Bus.emit('favorite:changed', { id, favorite: val });
    return !!val;
  },

  async removeTrack(id) {
    const keys = await DB.blobKeys();
    for (const k of keys) if (String(k).startsWith(id + '::')) await DB.delBlob(k);
    await DB.delTrack(id);
    this.tracks.delete(id);
    Bus.emit('library:changed');
  },

  /** 该曲可用的最高音质（只声明即可用，直链按需解析） */
  bestQuality(track) {
    const q = (track && track.qualities) || {};
    for (let i = QUALITIES.length - 1; i >= 0; i--) {
      if (q[QUALITIES[i].key]) return QUALITIES[i].key;
    }
    return null;
  },

  /** 用户偏好音质，若不可用则逐级降级 */
  resolveQuality(track, prefer) {
    const q = (track && track.qualities) || {};
    const want = prefer || Settings.get('playQuality');
    const idx = QUALITIES.findIndex(x => x.key === want);
    if (idx >= 0) {
      for (let i = idx; i >= 0; i--) {
        if (q[QUALITIES[i].key]) return QUALITIES[i].key;
      }
      for (let i = idx + 1; i < QUALITIES.length; i++) {
        if (q[QUALITIES[i].key]) return QUALITIES[i].key;
      }
    }
    return this.bestQuality(track);
  },

  /** 该曲有哪几档音质 */
  availableQualities(track) {
    const q = (track && track.qualities) || {};
    return QUALITIES.filter(x => !!q[x.key]).map(x => x.key);
  },

  /* ---- 下载 ---- */
  async download(track, qualityKey) {
    if (!track) return false;
    let qk = this.resolveQuality(track, qualityKey || Settings.get('downloadQuality'));
    if (!qk) { Toast.show('这首歌没有可下载的音频地址'); return false; }

    /* 直链按需解析（在线音源） */
    if (!track.qualities[qk].url) {
      try {
        const r = await Sources.resolveUrl(track, qk);
        qk = r.quality || qk;
      } catch (e) {
        Toast.show('取音频地址失败：' + (e.message || '网络异常'));
        return false;
      }
    }

    const q = track.qualities[qk];
    const blobId = track.id + '::' + qk;

    const exist = await DB.getBlob(blobId);
    if (exist && !track.downloaded) {
      await this.patch(track.id, { downloaded: 1, downloadedQuality: qk, dlAt: Date.now(), dlSize: exist.size });
      Bus.emit('download:done', { id: track.id, quality: qk });
      return true;
    }
    if (exist) { Toast.show('已下载：' + QMAP[qk].short + '音质'); return true; }

    Bus.emit('download:start', { id: track.id, quality: qk });
    Toast.show('开始下载 ' + QMAP[qk].short + '音质…');

    try {
      const blob = await this.fetchAudio(q.url, (pct) => {
        Bus.emit('download:progress', { id: track.id, pct });
      });
      if (!blob || blob.size < 2000) throw new Error('文件为空');
      const arr = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const mime = sniffMime(arr, blob.type, q.ext);
      await DB.putBlob(blobId, new Blob([blob], { type: mime }), qk, mime);
      await this.patch(track.id, {
        downloaded: 1, downloadedQuality: qk, dlAt: Date.now(), dlSize: blob.size
      });
      Bus.emit('download:done', { id: track.id, quality: qk, size: blob.size });
      Toast.show('「' + track.title + '」下载完成 · ' + fmtSize(blob.size));
      return true;
    } catch (err) {
      console.warn('[download]', err);
      Bus.emit('download:error', { id: track.id, error: err });
      Toast.show('下载失败：' + (err.message || '网络异常'));
      return false;
    }
  },

  /** 带进度的二进制抓取 */
  async fetchAudio(url, onProgress) {
    let res;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    } catch {
      res = await fetch(url, { mode: 'no-cors' });
      if (res.type === 'opaque') throw new Error('该音源不允许跨域下载');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) {
      const blob = await res.blob();
      if (onProgress) onProgress(100);
      return blob;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(Math.min(99, Math.round(received / total * 100)));
    }
    if (onProgress) onProgress(100);
    return new Blob(chunks);
  },

  /**
   * 取可播放的 URL
   * @param {boolean} opts.preferLocal 正常播放时本地优先（省流量、断网可用）；
   *        用户显式切换音质时传 false，让请求的档位优先走在线解析
   */
  async getPlayableUrl(track, qualityKey, opts = {}) {
    const preferLocal = opts.preferLocal !== false;
    const keys = await DB.blobKeys();
    const prefix = track.id + '::';
    const mine = keys.filter(k => String(k).startsWith(prefix));

    /* 1. 本地已有：精确命中，或（本地优先模式下）任意一档 */
    const pick = mine.find(k => k === prefix + qualityKey) || (preferLocal ? mine[0] : null);
    if (pick) {
      const rec = await DB.getBlob(pick);
      if (rec && rec.blob) {
        return { url: URL.createObjectURL(rec.blob), offline: true, quality: rec.quality, blob: rec.blob };
      }
    }

    /* 2. 在线解析请求的音质 */
    const qk = this.resolveQuality(track, qualityKey);
    if (qk) {
      try {
        const r = await Sources.resolveUrl(track, qk);
        if (r && r.url) return { url: r.url, offline: false, quality: r.quality || qk };
      } catch (e) {
        /* 断网或接口失败 → 落到本地回退 */
      }
    }

    /* 3. 回退：本地还有别的档位就播它 */
    if (mine.length) {
      const rec = await DB.getBlob(mine[0]);
      if (rec && rec.blob) {
        return { url: URL.createObjectURL(rec.blob), offline: true, quality: rec.quality, blob: rec.blob };
      }
    }
    return null;
  },

  /** 导入本地音频文件 */
  async importFiles(files) {
    let ok = 0;
    for (const file of files) {
      if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|flac|wav|ogg|aac|opus|wma)$/i.test(file.name)) continue;
      const base = file.name.replace(/\.[^.]+$/, '');
      const parts = base.split(' - ');
      const artist = parts.length > 1 ? parts[0].trim() : '未知歌手';
      const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : base;
      const id = 'local:' + hashStr(file.name + ':' + file.size);
      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
      const isLossless = /^(flac|wav)$/.test(ext);
      const duration = await probeDuration(file).catch(() => 0);
      const qk = isLossless ? 'lossless' : 'high';
      await DB.putBlob(id + '::' + qk, file, qk, file.type || (isLossless ? 'audio/flac' : 'audio/mpeg'));
      const track = {
        id, sourceId: 'local', sid: id,
        title, artist, album: '本地音乐', cover: '', duration,
        qualities: { [qk]: { url: '', ext, bitrate: isLossless ? 0 : 320, size: file.size } },
        favorite: 0, downloaded: 1,
        downloadedQuality: qk,
        dlSize: file.size, dlAt: Date.now(), createdAt: Date.now()
      };
      this.tracks.set(track.id, track);
      await DB.putTrack(track);
      ok++;
    }
    Bus.emit('library:changed');
    return ok;
  }
};

/* ---------------- 音频类型嗅探 ---------------- */
function sniffMime(bytes, fallback, ext) {
  const b = bytes || new Uint8Array();
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';           // ID3
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'audio/mpeg';                     // MP3 frame
  if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav';
  if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x00 && b.length > 8) {
    const brand = String.fromCharCode(...b.slice(4, 8));
    if (/ftyp|M4A|isom|mp42/.test(brand)) return 'audio/mp4';
  }
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'wav') return 'audio/wav';
  return fallback || 'audio/mpeg';
}

/** 用音频元素探测时长 */
function probeDuration(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    a.src = url;
    a.onloadedmetadata = () => {
      const d = a.duration;
      if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    a.onerror = () => reject(new Error('无法解析音频'));
    setTimeout(() => reject(new Error('超时')), 8000);
  });
}
