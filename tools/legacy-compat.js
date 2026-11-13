/* 老版 WebView 兼容处理
   目标：让 Android 6~9 上那些停留在 Chromium 60~85 的系统 WebView 也能正常显示。

   做两件事：
   1. 把 inset: 简写展开成 top/right/bottom/left（Chrome 87+ 才支持 inset）
   2. 把 CSS.escape / Object.fromEntries 等在老内核缺失的写法降级
*/
'use strict';
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, '..', 'www');

/* ---------- 1. 展开 inset ---------- */
function expandInset(css) {
  let count = 0;
  const out = css.replace(/(^|[;{\s])inset\s*:\s*([^;}]+)/g, (m, lead, value) => {
    const v = value.trim();
    count++;
    return `${lead}top:${v};right:${v};bottom:${v};left:${v}`;
  });
  return { css: out, count };
}

/* ---------- 2. CSS 函数降级 ---------- */
function patchCssFunctions(css) {
  let out = css;

  /* min()/max()/clamp() 在 Chrome 79 之前不认。
     .cover-disc 的 width:min(84vw,352px) 给个固定兜底 */
  out = out.replace(
    /width:\s*min\(84vw,\s*352px\);/g,
    'width:84vw;max-width:352px;width:min(84vw,352px);'
  );

  /* aspect-ratio 兜底：老内核会算不出高度 */
  out += `

/* ============================================================
   旧版 WebView 兜底（Chromium < 88 不支持 aspect-ratio）
   只影响观感，不影响功能
   ============================================================ */
@supports not (aspect-ratio: 1 / 1) {
  .pl-cover {
    height: 0;
    padding-top: 100%;
  }
  .pl-cover > * {
    position: absolute;
  }
  .pl-cover img {
    top: 0; left: 0;
    width: 100%; height: 100%;
  }
  .cover-disc {
    height: 84vw;
    max-height: 352px;
  }
  .cover-img {
    height: 80%;
  }
}
`;

  return out;
}

/* ---------- 3. 执行 ---------- */
function walk(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, cb); }
    else cb(full);
  }
}

let totalInset = 0;
walk(WWW, (full) => {
  if (!full.endsWith('.css')) return;
  const raw = fs.readFileSync(full, 'utf8');
  let next = raw;

  const r = expandInset(next);
  next = r.css;
  totalInset += r.count;

  if (full.endsWith('app.css')) {
    next = patchCssFunctions(next);
  }

  if (next !== raw) {
    fs.writeFileSync(full, next, { encoding: 'utf8' });
    console.log('  已处理 ' + path.relative(WWW, full) + (r.count ? '  (inset ×' + r.count + ')' : ''));
  }
});

console.log('inset 共展开 ' + totalInset + ' 处');
