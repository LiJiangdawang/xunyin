/* Web 资源混淆（安全版）
   ------------------------------------------------------------
   只做“确定安全”的三件事，宁可少混淆也不破坏语义：

     1. CSS 类名统一加短前缀（不改名，只加后缀哈希）
        .song → .song_k3f   —— 前缀保留可读性，避免与其他标识符冲突
     2. 只替换“确定的类名字符串位置”：
        · HTML 的 class="..."
        · JS 的 el(...{class:'...'}) / classList.add/remove/toggle/contains('...')
        · JS 的 querySelector('.xxx') 中的点选择器
        · CSS 选择器
        绝不碰 id、标签名、字符串里的普通单词。
     3. 去掉注释与多余空白（不做行内正则抽取）

   目标：让 APK 里的前端代码难以直接阅读和定位，同时保证零行为变化。
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'www');
const OUT = process.argv[2] || path.join(ROOT, 'dist_stage');

/* ---------------- 生成稳定短后缀 ---------------- */
function hashSuffix(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  let n = h;
  for (let i = 0; i < 3; i++) { s += chars[n % 26]; n = Math.floor(n / 26); }
  return s;
}

const classMap = new Map();   // 原类名 -> 混淆名

function registerClass(name) {
  if (!name || classMap.has(name)) return;
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return;
  classMap.set(name, name + '_' + hashSuffix(name));
}

function mapped(name) { return classMap.get(name) || name; }

/* ---------------- CSS ---------------- */
function collectFromCss(css) {
  /* 只从选择器部分（{ 之前）提取类名 */
  const blocks = css.split('{');
  for (let i = 0; i < blocks.length - 1; i++) {
    const selector = blocks[i].split('}').pop();
    const m = selector.matchAll(/\.([a-zA-Z_][\w-]*)/g);
    for (const x of m) registerClass(x[1]);
  }
}

function mapCss(css) {
  /* 按选择器分段替换，声明块内（属性值）不替换 */
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => {
    const newSel = sel.replace(/\.([a-zA-Z_][\w-]*)/g, (m, n) => '.' + mapped(n));
    return newSel + '{' + body + '}';
  })
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

/* ---------------- HTML ---------------- */
function mapHtml(html) {
  let out = html.replace(/class="([^"]*)"/g, (m, cls) => {
    const parts = cls.trim().split(/\s+/).filter(Boolean).map(mapped);
    return 'class="' + parts.join(' ') + '"';
  });
  out = out.replace(/<!--(?!\[)(?:(?!-->)[\s\S])*?-->/g, '');
  return out;
}

/* 逐个扫描字符串字面量，只处理“看起来是 CSS 选择器”的串 */
function mapSelectorStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch !== '"' && ch !== "'" && ch !== '`') { out += ch; i++; continue; }

    const q = ch;
    let j = i + 1;
    let body = '';
    let closed = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { body += c + (src[j + 1] || ''); j += 2; continue; }
      if (c === q) { closed = true; break; }
      body += c;
      j++;
    }

    if (!closed) {
      /* 没闭合（例如跨行模板串），原样吐出剩余内容，避免吞字符 */
      out += src.slice(i);
      return out;
    }
    out += q + mapOneSelector(body) + q;
    i = j + 1;
  }
  return out;
}

function mapOneSelector(body) {
  const t = body.trim();
  if (!t || t.length > 120) return body;
  if (/^(https?:|\/\/|www\.)/i.test(t)) return body;      // URL
  if (/^#i-/.test(t)) return body;                        // SVG 图标引用

  /* A) 纯类名列表，如 'ic ' / 'icon-btn liked' / 'banner'
        —— 每个 token 都是已登记的类名才替换（用于 setAttribute('class', ...)） */
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.length <= 6) {
    const allKnown = tokens.every(tk => classMap.has(tk));
    if (allKnown) {
      const mappedTxt = tokens.map(tk => mapped(tk)).join(' ');
      /* 保留原字符串首尾空格形态 */
      return body.replace(t, mappedTxt);
    }
  }

  /* B) 含点选择器：只处理选择器风格字符串 */
  if (!/\.[a-zA-Z_]/.test(t)) return body;
  if (/[\u4e00-\u9fa5]/.test(t)) return body;             // 含中文，是文案
  if (!/^[\w.#\[\]="':>+~,()\s-]+$/.test(t)) return body;
  if (!/^[.#]?[a-zA-Z_]/.test(t)) return body;
  return body.replace(/\.([a-zA-Z_][\w-]*)/g, (m, name) => classMap.has(name) ? '.' + mapped(name) : m);
}

/* ---------------- JS ---------------- */
function mapJs(src) {
  let out = src;

  /* 1) class:'a b c' / class: "a b" —— el() 的属性写法 */
  out = out.replace(/(\bclass\s*:\s*)(['"`])([^'"`]*)['"`]/g, (m, head, q, cls) => {
    const parts = cls.trim().split(/\s+/).filter(Boolean).map(mapped);
    return head + q + parts.join(' ') + q;
  });

  /* 2) classList.add/remove/toggle/contains('a','b') */
  out = out.replace(/(classList\.(?:add|remove|toggle|contains)\()([^)]*)\)/g, (m, head, args) => {
    const newArgs = args.replace(/(['"])([a-zA-Z][\w-]*)\1/g, (m2, q, name) => q + mapped(name) + q);
    return head + newArgs + ')';
  });

  /* 3) 逐字符串扫描，替换选择器里的类名 */
  out = mapSelectorStrings(out);

  /* 4) icon('name', 'extra-class') 的第二参数也是类名 */
  out = out.replace(/icon\((['"][\w-]+['"])\s*,\s*(['"])([^'"\n]*)\2\)/g, (m, first, q, cls) => {
    const parts = cls.trim().split(/\s+/).filter(Boolean).map(mapped);
    return 'icon(' + first + ', ' + q + parts.join(' ') + q + ')';
  });

  return out;
}

/* ---------------- 主流程 ---------------- */
function walk(dir, base, cb) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, rel, cb);
    else cb(full, rel);
  }
}

function run() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const files = [];
  walk(SRC, '', (full, rel) => files.push({ full, rel }));

  /* 收集：CSS 选择器 + HTML class + JS 里出现的 class 属性 */
  for (const f of files) {
    if (f.rel.endsWith('.css')) collectFromCss(fs.readFileSync(f.full, 'utf8'));
  }
  for (const f of files) {
    if (f.rel.endsWith('.html')) {
      const h = fs.readFileSync(f.full, 'utf8');
      for (const m of h.matchAll(/class="([^"]*)"/g)) {
        m[1].trim().split(/\s+/).filter(Boolean).forEach(registerClass);
      }
    }
  }
  for (const f of files) {
    if (f.rel.endsWith('.js')) {
      const j = fs.readFileSync(f.full, 'utf8');
      for (const m of j.matchAll(/\bclass\s*:\s*['"`]([^'"`]*)['"`]/g)) {
        m[1].trim().split(/\s+/).filter(Boolean).forEach(registerClass);
      }
      for (const m of j.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) {
        for (const n of m[1].matchAll(/['"]([a-zA-Z][\w-]*)['"]/g)) registerClass(n[1]);
      }
    }
  }

  let jsRaw = 0, jsOut = 0, cssRaw = 0, cssOut = 0;
  for (const f of files) {
    const dst = path.join(OUT, f.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });

    const isText = /\.(html|js|css|webmanifest|json|txt|svg)$/i.test(f.rel);
    if (!isText) { fs.copyFileSync(f.full, dst); continue; }

    const raw = fs.readFileSync(f.full, 'utf8');
    let out = raw;
    if (f.rel.endsWith('.css')) { out = mapCss(raw); cssRaw += Buffer.byteLength(raw, 'utf8'); cssOut += Buffer.byteLength(out, 'utf8'); }
    else if (f.rel.endsWith('.js')) { out = mapJs(raw); jsRaw += Buffer.byteLength(raw, 'utf8'); jsOut += Buffer.byteLength(out, 'utf8'); }
    else if (f.rel.endsWith('.html')) { out = mapHtml(raw); }

    fs.writeFileSync(dst, out, { encoding: 'utf8' });
  }

  console.log('混淆类名 ' + classMap.size + ' 个');
  console.log('CSS ' + (cssRaw / 1024).toFixed(1) + 'KB → ' + (cssOut / 1024).toFixed(1) + 'KB');
  console.log('JS  ' + (jsRaw / 1024).toFixed(1) + 'KB → ' + (jsOut / 1024).toFixed(1) + 'KB');
  console.log('输出 ' + OUT);
}

run();
