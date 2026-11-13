/* 零依赖静态服务器（本地预览 / 手机同 WiFi 调试）
   用法: node tools/serve.js [port]
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', 'www');
const PORT = Number(process.argv[2]) || 8899;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  /* /__apk —— 直接下载 dist 里最新的安装包（手机同 WiFi 扫码即可装） */
  if (urlPath === '/__apk' || urlPath.startsWith('/__apk/')) {
    const distDir = path.join(__dirname, '..', 'dist');
    let files = [];
    try {
      files = fs.readdirSync(distDir).filter(f => f.toLowerCase().endsWith('.apk')).sort();
    } catch { /* dist 不存在 */ }
    if (!files.length) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('dist/ 目录里还没有 APK，先跑一次 native/android/build-apk.ps1');
      return;
    }
    const name = files[files.length - 1];
    const full = path.join(distDir, name);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': fs.statSync(full).size,
      'Content-Disposition': 'attachment; filename="' + name + '"'
    });
    fs.createReadStream(full).pipe(res);
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  Object.values(nets).forEach(list => (list || []).forEach(n => {
    if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
  }));
  console.log('鲸鱼音乐 已启动:');
  console.log('  本机   http://127.0.0.1:' + PORT);
  lan.forEach(ip => console.log('  局域网 http://' + ip + ':' + PORT + '   (手机同 WiFi 可直接打开)'));
});
