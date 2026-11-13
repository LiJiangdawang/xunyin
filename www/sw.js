/* Service Worker：让 App 外壳完全离线可用（音频另存 IndexedDB） */
const CACHE = 'xunyin-shell-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/splash.css',
  './js/util.js',
  './js/db.js',
  './js/store.js',
  './js/support.js',
  './js/profile.js',
  './js/sources.js',
  './js/player.js',
  './js/ui-core.js',
  './js/ui-home.js',
  './js/ui-mine.js',
  './js/ui-search.js',
  './js/ui-player.js',
  './js/app.js',
  './icons/xunyin.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './img/qr-donate.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* 音源接口 / 音频直链：永不缓存，直接走网络 */
  if (url.pathname.endsWith('/api.php') || /\.(mp3|flac|m4a|wav|ogg)$/i.test(url.pathname)) return;
  if (url.origin !== location.origin) return;

  /* 导航请求：网络优先，断网回退到缓存的外壳 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* 静态资源：缓存优先 + 后台更新 */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
