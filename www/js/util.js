/* ============================================================
   util.js —— 基础工具
   ============================================================ */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  return node;
}

/** 图标 */
function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic ' + cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

/** 秒 -> mm:ss */
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** 数字 -> 万 / 亿 */
function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

function fmtSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 简易唯一 id */
function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 字符串哈希（本地文件 id 用） */
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function debounce(fn, ms = 320) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/** 路径取值：pick(obj,'a.b.0.c') */
function pick(obj, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    const m = key.match(/^(.*?)\[(\d+)\]$/);
    if (m) {
      const base = m[1] ? acc[m[1]] : acc;
      return base ? base[Number(m[2])] : undefined;
    }
    return acc[key];
  }, obj);
}

/** 模板替换 {kw} {id} {level} {page} */
function fillTpl(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] === undefined ? '' : encodeURIComponent(vars[k]));
}

/** 取数组（保证是数组） */
function asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

/** 颜色 hash（无封面时生成渐变） */
function gradientOf(seed) {
  const h = parseInt(hashStr(String(seed || 'x')).replace(/[^0-9]/g, '').slice(0, 3) || '137', 10) % 360;
  return `linear-gradient(140deg,hsl(${h} 62% 46%),hsl(${(h + 48) % 360} 58% 32%))`;
}

/** 图片代理/回退：加载失败时替换为渐变块 */
function attachCover(box, url, seed) {
  box.innerHTML = '';
  box.style.background = gradientOf(seed);
  if (!url) {
    box.appendChild(el('div', { class: 's-fallback' }, icon('music')));
    return;
  }
  const img = el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
  img.onerror = () => {
    img.remove();
    box.appendChild(el('div', { class: 's-fallback' }, icon('music')));
  };
  box.appendChild(img);
}

/** fetch 超时封装 */
function fetchTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** 判断是否原生壳（Capacitor） */
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/** 安全存储（本地） */
const Storage = {
  get(k, d) {
    try { const v = localStorage.getItem('whale:' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('whale:' + k, JSON.stringify(v)); } catch { }
  },
  del(k) { try { localStorage.removeItem('whale:' + k); } catch { } }
};
