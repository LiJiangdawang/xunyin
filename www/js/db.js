/* ============================================================
   db.js —— IndexedDB：歌曲元数据 + 音频二进制（离线播放）
   ============================================================ */
'use strict';

const DB_NAME = 'xunyin';
const DB_VER = 1;

const DB = (() => {
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) {
          const s = db.createObjectStore('tracks', { keyPath: 'id' });
          s.createIndex('favorite', 'favorite');
          s.createIndex('downloaded', 'downloaded');
          s.createIndex('source', 'source');
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          // id = trackId + '::' + quality
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        void e;
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s, t); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const reqWrap = (req) => ({ __req: req });

  return {
    /* ---------- tracks ---------- */
    putTrack(track) {
      return tx('tracks', 'readwrite', s => { s.put(track); });
    },
    putTracks(list) {
      return tx('tracks', 'readwrite', s => { list.forEach(t => s.put(t)); });
    },
    getTrack(id) {
      return tx('tracks', 'readonly', s => reqWrap(s.get(id)));
    },
    allTracks() {
      return tx('tracks', 'readonly', s => reqWrap(s.getAll()));
    },
    delTrack(id) {
      return tx('tracks', 'readwrite', s => { s.delete(id); });
    },
    async tracksWhere(index, value) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('tracks', 'readonly');
        const req = t.objectStore('tracks').index(index).getAll(value);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    /* ---------- blobs ---------- */
    putBlob(id, blob, quality, mime) {
      return tx('blobs', 'readwrite', s => {
        s.put({ id, blob, quality, mime: mime || blob.type || 'audio/mpeg', size: blob.size, savedAt: Date.now() });
      });
    },
    getBlob(id) {
      return tx('blobs', 'readonly', s => reqWrap(s.get(id)));
    },
    delBlob(id) {
      return tx('blobs', 'readwrite', s => { s.delete(id); });
    },
    async allBlobs() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('blobs', 'readonly');
        const req = t.objectStore('blobs').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async blobKeys() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('blobs', 'readonly');
        const req = t.objectStore('blobs').getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    /* ---------- settings ---------- */
    async getSetting(key, def) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('settings', 'readonly');
        const req = t.objectStore('settings').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : def);
        req.onerror = () => reject(req.error);
      });
    },
    setSetting(key, value) {
      return tx('settings', 'readwrite', s => { s.put({ key, value }); });
    },

    /* ---------- playlists ---------- */
    putPlaylist(p) { return tx('playlists', 'readwrite', s => { s.put(p); }); },
    allPlaylists() {
      return tx('playlists', 'readonly', s => reqWrap(s.getAll()));
    },
    delPlaylist(id) { return tx('playlists', 'readwrite', s => { s.delete(id); }); },

    /* ---------- 头像 ---------- */
    putProfileAvatar(blob) {
      return tx('settings', 'readwrite', s => {
        s.put({ key: 'avatar', value: { blob, at: Date.now(), size: blob.size } });
      });
    },
    async getProfileAvatar() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('settings', 'readonly');
        const req = t.objectStore('settings').get('avatar');
        req.onsuccess = () => {
          const rec = req.result;
          resolve(rec && rec.value && rec.value.blob ? rec.value : null);
        };
        req.onerror = () => reject(req.error);
      });
    },
    delProfileAvatar() {
      return tx('settings', 'readwrite', s => { s.delete('avatar'); });
    },

    /** 估算占用 */
    async estimate() {
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          return { usage: est.usage || 0, quota: est.quota || 0 };
        } catch { return { usage: 0, quota: 0 }; }
      }
      return { usage: 0, quota: 0 };
    }
  };
})();
