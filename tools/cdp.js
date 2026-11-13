/* CDP 调试器：真实浏览器里加载 App，收集报错、执行脚本、截图
   用法:
     node tools/cdp.js <url> <out.png> ["js to eval 1"] ["js 2"] ...
   环境: EDGE_PATH 可覆盖浏览器路径
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = path.join(os.tmpdir(), 'whale-cdp-' + Date.now());
const URL_ = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = process.argv[3] || path.join(__dirname, '..', '_shots', 'shot.png');
const EVALS = process.argv.slice(4);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout = 20000, gap = 250) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { }
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting');
    await sleep(gap);
  }
}

(async () => {
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  try {
    targets = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      return list.find(t => t.type === 'page') || null;
    });
  } catch (e) {
    console.error('无法连接浏览器调试端口:', e.message);
    proc.kill();
    process.exit(1);
  }

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const errors = [];
  const consoles = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') errors.push('[log] ' + e.text + ' ' + (e.url || ''));
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      consoles.push(m.params.type + ': ' + txt);
      if (m.params.type === 'error') errors.push('[console] ' + txt);
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { });
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, (m) => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 900, deviceScaleFactor: Number(process.env.CDP_DPR || 2), mobile: true
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try { await send('Page.bringToFront'); } catch { }
  await send('Page.navigate', { url: URL_ });
  await sleep(1000);
  await waitFor(async () => {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    return r.result.value === 'complete';
  }, 20000);
  await sleep(Number(process.env.CDP_SETTLE || 4500));

  const results = [];
  for (const expr of EVALS) {
    /* 特殊指令：@input / @touch —— 派发原生输入事件，用于验证拖拽 */
    if (expr.startsWith('@input:') || expr.startsWith('@touch:')) {
      const isTouch = expr.startsWith('@touch:');
      try {
        const cmds = JSON.parse(expr.slice(isTouch ? 7 : 7));
        for (const c of cmds) {
          const gap = c.__gap || 80;
          delete c.__gap;
          if (isTouch) await send('Input.dispatchTouchEvent', c);
          else await send('Input.dispatchMouseEvent', c);
          await sleep(gap);
        }
        results.push({ expr: (isTouch ? 'touch' : 'mouse') + ' sequence', value: 'sent ' + cmds.length + ' events' });
      } catch (e) {
        results.push({ expr: 'native input', error: e.message });
      }
      await sleep(400);
      continue;
    }

    try {
      const r = await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true, userGesture: true
      });
      results.push({ expr, value: r.result.value, type: r.result.type, desc: r.result.description });
    } catch (e) {
      results.push({ expr, error: e.message });
    }
    await sleep(1200);
  }

  /* 截图 */
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

  const errAttr = await send('Runtime.evaluate', {
    expression: 'document.documentElement.getAttribute("data-err") || ""', returnByValue: true
  });

  console.log(JSON.stringify({
    url: URL_,
    shot: OUT,
    pageErrors: errors.slice(0, 12),
    dataErr: errAttr.result.value,
    consoles: consoles.slice(-25),
    evals: results
  }, null, 2));

  ws.close();
  proc.kill();
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
