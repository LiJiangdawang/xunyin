/* ============================================================
   sources.js —— 音源层（搜索 / 音质直链 / 封面 / 歌词）
   协议：GD Studio music-api 兼容（开源，可自建实例替换 apiBase）
   ============================================================ */
'use strict';

const SRC_DEFAULTS = {
  apiBase: 'https://music-api.gdstudio.xyz/api.php',
  preferSource: 'netease',
  qualityMap: { standard: 128, high: 320, lossless: 999 }
};

/** 全局默认（用户可在「音源管理」里改，存 localStorage） */
const SourceConfig = {
  get() {
    return { ...SRC_DEFAULTS, ...Storage.get('sourceConfig', {}) };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    Storage.set('sourceConfig', next);
    Bus.emit('source:changed', next);
    return next;
  }
};

const Sources = (() => {
  const urlCache = new Map();   // key -> {url, br, size, at}
  const picCache = new Map();
  const TTL = 18 * 60 * 1000;

  /* ---------------- 底层请求（带重试） ---------------- */
  async function apiGet(params, { retries = 4 } = {}) {
    const cfg = SourceConfig.get();
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    const url = cfg.apiBase + (cfg.apiBase.includes('?') ? '&' : '?') + qs;

    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetchTimeout(url, { headers: { Accept: 'application/json' } }, 14000);
        if (res.status === 503 || res.status === 429) throw new Error('SERVER_BUSY');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text) throw new Error('EMPTY');
        try { return JSON.parse(text); }
        catch { throw new Error('BAD_JSON'); }
      } catch (e) {
        lastErr = e;
        const busy = e && (e.message === 'SERVER_BUSY' || e.message === 'HTTP 503');
        const wait = busy ? 1150 * Math.pow(1.55, i) : 420 * Math.pow(1.45, i);
        await new Promise(r => setTimeout(r, wait + Math.random() * 200));
      }
    }
    throw lastErr || new Error('请求失败');
  }

  /* ---------------- 搜索 ---------------- */
  const SOURCE_FALLBACK = ['netease', 'joox'];

  async function search(keyword, { limit = 30, source } = {}) {
    const cfg = SourceConfig.get();
    const wanted = source || cfg.preferSource || 'netease';

    /* 失效的音源直接换到可用的，避免"选了酷狗就搜不出东西" */
    const order = [wanted, ...SOURCE_FALLBACK.filter(s => s !== wanted)];

    let lastErr = null;
    for (const src of order) {
      try {
        const raw = await apiGet({
          types: 'search',
          source: src,
          name: keyword,
          count: limit,
          pages: 1
        }, { retries: src === wanted ? 5 : 2 });

        if (!Array.isArray(raw) || !raw.length) {
          if (src === wanted) continue;   // 首选源没结果，试下一个
          return [];
        }

        return raw.map(item => {
          const sid = String(item.id || item.url_id || '');
          const artist = Array.isArray(item.artist)
            ? item.artist.join(' / ')
            : String(item.artist || '未知歌手');
          return {
            id: 'gd:' + (item.source || src) + ':' + sid,
            sourceId: 'gd',
            sid,
            urlId: String(item.url_id || sid),
            picId: item.pic_id ? String(item.pic_id) : '',
            lyricId: item.lyric_id ? String(item.lyric_id) : '',
            nativeSource: item.source || src,
            title: String(item.name || '未知歌曲'),
            artist,
            album: String(item.album || ''),
            cover: '',
            duration: 0,
            qualities: {
              standard: { ext: 'mp3', bitrate: 128 },
              high: { ext: 'mp3', bitrate: 320 },
              lossless: { ext: 'flac', bitrate: 0 }
            },
            favorite: 0,
            downloaded: 0,
            createdAt: Date.now()
          };
        });
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }

  /* ---------------- 取直链 ---------------- */
  async function resolveUrl(track, qualityKey) {
    /* 1. 已有直链（本地导入 / 已解析缓存） */
    const q = track.qualities && track.qualities[qualityKey];
    if (q && q.url) return { url: q.url, br: q.bitrate || 0 };

    if (track.sourceId !== 'gd') throw new Error('该曲目没有在线直链');

    const cfg = SourceConfig.get();
    const key = track.id + '|' + qualityKey;
    const hit = urlCache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit;

    /* 2. 按音质档位请求，失败则逐级降级 */
    const order = { standard: ['standard'], high: ['high', 'standard'], lossless: ['lossless', 'high', 'standard'] };
    const tryList = order[qualityKey] || ['high', 'standard'];
    let lastErr = null;

    for (const qk of tryList) {
      const br = cfg.qualityMap[qk] || 320;
      try {
        const data = await apiGet({
          types: 'url',
          source: track.nativeSource || cfg.preferSource,
          id: track.urlId || track.sid,
          br
        });
        const url = data && data.url;
        if (!url) { lastErr = new Error('NO_URL'); continue; }
        const rec = { url, br: data.br || br, size: data.size || 0, at: Date.now(), quality: qk };
        urlCache.set(key, rec);
        // 回填到内存曲目，方便 UI 标音质
        if (track.qualities[qk]) { track.qualities[qk].url = url; track.qualities[qk].size = data.size || 0; }
        return rec;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('无法获取音频地址（可能无版权或需会员）');
  }

  /** 探测某曲最高可用音质（用于列表/播放器显示） */
  async function probeBest(track) {
    const bq = Store.bestQuality(track);
    if (bq && track.qualities[bq] && track.qualities[bq].url) return bq;
    try {
      const r = await resolveUrl(track, 'lossless');
      return r.quality || 'high';
    } catch {
      try { const r2 = await resolveUrl(track, 'high'); return r2.quality || 'standard'; }
      catch { return 'standard'; }
    }
  }

  /* ---------------- 封面 ---------------- */
  async function pic(track) {
    if (track.cover) return track.cover;
    if (track.sourceId === 'gd' && track.picId) {
      const k = track.nativeSource + ':' + track.picId;
      if (picCache.has(k)) return picCache.get(k);
      try {
        const d = await apiGet({ types: 'pic', source: track.nativeSource, id: track.picId, size: 300 }, { retries: 2 });
        const url = d && d.url;
        if (url) {
          picCache.set(k, url);
          Store.patchMem(track.id, { cover: url });
          return url;
        }
      } catch { /* 静默失败，用渐变封面 */ }
    }
    return '';
  }

  /* ---------------- 歌词 ---------------- */
  async function lyric(track) {
    if (!track || track.sourceId !== 'gd') return '';
    try {
      const d = await apiGet({
        types: 'lyric',
        source: track.nativeSource,
        id: track.lyricId || track.sid
      }, { retries: 3 });
      const lrc = (d && (d.lyric || d.tlyric)) || '';
      return typeof lrc === 'string' ? lrc : '';
    } catch { return ''; }
  }

  /** 解析 LRC 为 [{t, text}] */
  function parseLrc(lrc) {
    const out = [];
    if (!lrc) return out;
    const lines = lrc.split(/\r?\n/);
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (const line of lines) {
      const tags = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const min = Number(m[1]), sec = Number(m[2]);
        const frac = m[3] ? Number('0.' + m[3]) : 0;
        tags.push(min * 60 + sec + frac);
      }
      if (!tags.length) continue;
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!text) continue;
      tags.forEach(t => out.push({ t, text }));
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /* ---------------- 热词 ---------------- */
  const HOT_WORDS = [
    '周杰伦', '晴天', '夜曲', 'lofi', '钢琴', '爵士', '陈奕迅', '孤勇者',
    '林俊杰', '邓紫棋', '薛之谦', '李荣浩', '毛不易', '纯音乐', '轻音乐', '摇滚'
  ];

  return { search, resolveUrl, probeBest, pic, lyric, parseLrc, apiGet, HOT_WORDS };
})();
