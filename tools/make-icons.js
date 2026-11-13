/* 生成 App 图标（纯 Node，无第三方依赖）
   用法: node tools/make-icons.js
*/
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 绘图工具 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 圆角矩形 SDF（负值在内） */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* ---------- 画图标 ---------- */
function drawIcon(size, graphicScale = 0.46) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;

  /* 主题色 */
  const cA = [0x46, 0xb6, 0xff];   // 亮蓝
  const cB = [0x18, 0x53, 0xd6];   // 深蓝
  const cC = [0x6a, 0x5c, 0xff];   // 紫

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = x / S, ny = y / S;

      /* 对角渐变底 */
      let t = clamp01((nx * 0.55 + ny * 0.75));
      let col = mix(cA, cB, t);
      /* 右上角紫色氛围 */
      const glow = Math.max(0, 1 - Math.hypot(nx - 0.95, ny - 0.05) / 0.85);
      col = mix(col, cC, glow * 0.45);
      /* 左上高光 */
      const hi = Math.max(0, 1 - Math.hypot(nx - 0.18, ny - 0.12) / 0.55);
      col = mix(col, [255, 255, 255], hi * hi * 0.22);
      /* 底部暗角 */
      col = mix(col, [0, 0, 0], smoothstep(0.55, 1.05, ny) * 0.18);

      let r = col[0] | 0, g = col[1] | 0, b = col[2] | 0, a = 255;

      /* ------- 前景：三根均衡器竖条 + 音符头 ------- */
      const cx = S / 2;
      const baseY = S * (0.5 + graphicScale * 0.46);

      const barW = S * graphicScale * 0.215;
      const gap = S * graphicScale * 0.135;
      const heights = [0.62, 1.0, 0.8].map(v => S * graphicScale * v);
      const xs = [-1, 0, 1].map(i => cx + i * (barW + gap));

      for (let i = 0; i < 3; i++) {
        const hw = barW / 2;
        const hh = heights[i] / 2;
        const cyBar = baseY - hh;
        const d = sdRoundRect(x, y, xs[i], cyBar, hw, hh, hw);
        const aa = 1 - smoothstep(-1.2, 1.2, d);
        if (aa > 0.001) {
          const vert = clamp01((y - (cyBar - hh)) / Math.max(1, heights[i]));
          const tone = mix([255, 255, 255], [225, 240, 255], vert * 0.5);
          r = lerp(r, tone[0], aa); g = lerp(g, tone[1], aa); b = lerp(b, tone[2], aa);
        }
      }

      /* 底部一条圆头横线，托住三根竖条 */
      const lineW = S * graphicScale * 0.92;
      const lineH = S * graphicScale * 0.09;
      const ld = sdRoundRect(x, y, cx, baseY + lineH * 1.15, lineW / 2, lineH / 2, lineH / 2);
      const la = 1 - smoothstep(-1.2, 1.2, ld);
      if (la > 0.001) {
        r = lerp(r, 255, la * 0.9); g = lerp(g, 255, la * 0.9); b = lerp(b, 255, la * 0.9);
      }

      px[(y * S + x) * 4 + 0] = Math.round(Math.max(0, Math.min(255, r)));
      px[(y * S + x) * 4 + 1] = Math.round(Math.max(0, Math.min(255, g)));
      px[(y * S + x) * 4 + 2] = Math.round(Math.max(0, Math.min(255, b)));
      px[(y * S + x) * 4 + 3] = a;
    }
  }
  return encodePNG(S, S, px);
}

/* ---------- 输出 ---------- */
module.exports = { encodePNG, drawIcon };

if (require.main === module) {
  const out = path.join(__dirname, '..', 'www', 'icons');
  fs.mkdirSync(out, { recursive: true });

  fs.writeFileSync(path.join(out, 'icon-512.png'), drawIcon(512, 0.46));
  fs.writeFileSync(path.join(out, 'icon-192.png'), drawIcon(192, 0.46));
  fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), drawIcon(512, 0.34));
  fs.writeFileSync(path.join(out, 'icon-1024.png'), drawIcon(1024, 0.46));

  /* favicon：矢量同款设计 */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#46b6ff"/><stop offset="1" stop-color="#1853d6"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="17" y="26" width="7" height="16" rx="3.5"/>
    <rect x="28.5" y="18" width="7" height="24" rx="3.5"/>
    <rect x="40" y="22" width="7" height="20" rx="3.5"/>
    <rect x="17" y="45.5" width="30" height="5" rx="2.5"/>
  </g>
</svg>
`;
  fs.writeFileSync(path.join(out, 'whale.svg'), svg);

  console.log('icons ok ->', out);
}
