/* ============================================================
   app.js —— 启动、路由、全局事件
   ============================================================ */
'use strict';

/* ---------------- 层栈（安卓返回键 / 手势返回） ---------------- */
const Layer = {
  stack: [],
  push(type, closeFn) {
    this.stack.push({ type, closeFn });
    try { history.pushState({ whaleLayer: type, n: this.stack.length }, ''); } catch { }
  },
  topType() { return this.stack.length ? this.stack[this.stack.length - 1].type : null; },
  popTop() {
    const top = this.stack.pop();
    if (top && top.closeFn) { try { top.closeFn(); } catch (e) { console.warn(e); } }
    return !!top;
  },
  closeTop() {
    if (!this.stack.length) return false;
    try { history.back(); } catch { this.popTop(); }
    return true;
  },
  has(type) { return this.stack.some(s => s.type === type); }
};

window.addEventListener('popstate', () => {
  if (!Layer.popTop()) {
    // 已在根层：原生壳里交给系统
    if (isNative()) { /* 由系统处理退出 */ }
  }
});

/* ---------------- 文件导入 ---------------- */
function pickAudioFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.mp3,.flac,.m4a,.wav,.ogg,.aac';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) { input.remove(); return; }
    Toast.show('正在导入 ' + files.length + ' 个文件…', 2000);
    const ok = await Store.importFiles(files);
    Toast.show(ok ? '已导入 ' + ok + ' 首到本地音乐' : '没有识别到音频文件', 2400);
    ListPage.openType('local');
    input.remove();
  });
  input.click();
}

/* ---------------- 启动页 ---------------- */
const Splash = {
  shownAt: 0,
  minMs: 2200,

  mount() {
    this.shownAt = Date.now();
  },

  hide() {
    const node = $('#splash');
    if (!node) return;
    const wait = Math.max(0, this.minMs - (Date.now() - this.shownAt));
    setTimeout(() => {
      node.classList.add('hide');
      setTimeout(() => { try { node.remove(); } catch { } }, 500);
    }, wait);
  }
};
Splash.mount();

/* ---------------- 原生壳接口（返回键分层） ---------------- */
window.XunYinShell = {
  onBack() {
    if (Sheet.isOpen()) { Sheet.close(); return true; }
    if (document.querySelector('#player').classList.contains('open')) {
      PlayerUI.close();
      return true;
    }
    const opened = $$('.page').find(p => p.classList.contains('active') && p.id !== 'page-home' && p.id !== 'page-mine');
    if (opened) { Nav.go(Nav.tab); return true; }
    return false;
  }
};

/* ---------------- 键盘 / 视口高度锁定 ----------------
   问题：安卓键盘弹起时视口变矮，#app 用 inset:0 会跟着缩，
        整页内容（含底部导航）看起来"往上移"。
   做法：启动时记一次可视高度写进 --base-h 并锁死，
        再把键盘实际占用的高度写进 --kb，让弹层浮在键盘上方。
   ------------------------------------------------ */
const Viewport = {
  baseH: 0,
  kb: 0,

  init() {
    this.measure(true);
    window.addEventListener('resize', () => this.measure(false));
    window.addEventListener('orientationchange', () => setTimeout(() => this.measure(true), 300));

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', () => this.onVisual());
      vv.addEventListener('scroll', () => this.onVisual());
      this.onVisual();
    }
  },

  /** 记录基准高度：只在首次或视口"变大"时更新，键盘导致变矮不更新 */
  measure(force) {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (!h) return;
    if (force || this.baseH === 0 || h > this.baseH + 80) {
      this.baseH = h;
      document.documentElement.style.setProperty('--base-h', h + 'px');
    }
  },

  /** 键盘高度 = 布局视口高 - 可视视口高 */
  onVisual() {
    const vv = window.visualViewport;
    if (!vv) return;
    const layoutH = window.innerHeight;
    const kb = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop));
    /* 小于 80px 视为浏览器地址栏变化，不算键盘 */
    this.kb = kb > 80 ? kb : 0;
    document.documentElement.style.setProperty('--kb', this.kb + 'px');
    Bus.emit('viewport:keyboard', this.kb);
  }
};

/* ---------------- 存储加固 ----------------
   1. 向浏览器申请"持久化存储"，防止空间不足时被自动清理
   2. 记录当前 origin，方案变了要能看出来（数据是按 origin 隔离的）
   ------------------------------------------------ */
const Store$guard = {
  async init() {
    /* 申请持久化 */
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!already) await navigator.storage.persist();
      }
    } catch { }

    /* 记录首次使用的 origin，变了就提示 */
    const nowOrigin = location.origin;
    const savedOrigin = Storage.get('appOrigin', '');
    if (!savedOrigin) {
      Storage.set('appOrigin', nowOrigin);
    } else if (savedOrigin !== nowOrigin) {
      Storage.set('appOrigin', nowOrigin);
      console.warn('[storage] origin 变化：', savedOrigin, '->', nowOrigin);
      Bus.emit('storage:origin-changed', { from: savedOrigin, to: nowOrigin });
    }
  },

  /** 数据概况，给"数据与备份"面板用 */
  async summary() {
    const est = await DB.estimate();
    const blobs = await DB.allBlobs();
    const audioSize = blobs.reduce((a, b) => a + (b.size || 0), 0);
    let persisted = false;
    try {
      if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch { }
    return {
      origin: location.origin,
      persisted,
      audioCount: blobs.length,
      audioSize,
      usage: est.usage,
      quota: est.quota,
      trackCount: Store.all().length,
      favoriteCount: Store.favorites().length,
      downloadCount: Store.downloaded().length
    };
  }
};

/* ---------------- 老内核兼容兜底 ----------------
   Android 6~9 上有些设备的系统 WebView 停留在 Chromium 60~85，
   下面这些 API 缺失时会直接抛错，把缺失的补上或降级。
   ------------------------------------------------ */
const Compat = {
  apply() {
    /* CSS.escape：CSS 选择器转义，Chromium 46 起才有 */
    if (typeof CSS !== 'undefined' && !CSS.escape) {
      CSS.escape = function (s) {
        return String(s).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, ch => '\\' + ch);
      };
    }

    /* Element.closest：Chromium 41 起 */
    if (typeof Element !== 'undefined' && !Element.prototype.closest) {
      Element.prototype.closest = function (sel) {
        let el = this;
        const matches = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
        while (el && el.nodeType === 1) {
          if (matches.call(el, sel)) return el;
          el = el.parentElement || el.parentNode;
        }
        return null;
      };
    }

    /* NodeList.forEach：Chromium 51 起 */
    if (typeof NodeList !== 'undefined' && !NodeList.prototype.forEach) {
      NodeList.prototype.forEach = Array.prototype.forEach;
    }

    /* Object.assign：Chromium 45 起 */
    if (!Object.assign) {
      Object.assign = function (target) {
        for (let i = 1; i < arguments.length; i++) {
          const src = arguments[i];
          if (!src) continue;
          for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
      };
    }

    /* CSS.supports：Chromium 61 起，缺了就当不支持 */
    if (typeof CSS !== 'undefined' && !CSS.supports) {
      CSS.supports = function () { return false; };
    }

    /* 检测内核版本，太旧就提示 */
    this.checkEngine();
  },

  /** 粗略判断 Chromium 版本 */
  engineVersion() {
    const ua = navigator.userAgent;
    let m = ua.match(/Chrome\/(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = ua.match(/Chromium\/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return 0;
  },

  checkEngine() {
    const v = this.engineVersion();
    Storage.set('engineVer', v);
    /* 低于 70 的 WebView，下面这些新特性会明显影响观感 */
    if (v && v < 70) {
      setTimeout(() => {
        Toast.show('系统 WebView 版本较旧（Chromium ' + v + '），部分界面可能显示不完美。建议在应用商店更新「Android System WebView」', 5200);
      }, 3000);
    }
    return v;
  }
};

/* ---------------- 启动 ---------------- */
const App = {
  async init() {
    /* 老内核补丁必须在一切之前 */
    try { Compat.apply(); } catch (e) { console.warn('compat', e); }

    /* 视口高度锁死：必须在渲染前执行，否则首帧会跳一下 */
    Viewport.init();

    /* 播放器 & 曲库 */
    Player.init();
    try { await Store.init(); } catch (e) { console.warn('DB init', e); }
    try { await Store$guard.init(); } catch (e) { console.warn('storage guard', e); }

    /* UI 绑定 */
    this.bindGlobal();
    SearchPage.init();
    PlayerUI.init();
    if (typeof Support !== 'undefined') Support.init();
    if (typeof Profile !== 'undefined') { try { await Profile.init(); } catch (e) { console.warn('profile', e); } }
    MinePage.render();
    HomePage.render();

    /* 恢复上次偏好 */
    Player.preferQuality = Settings.get('playQuality');

    /* 状态栏（原生） */
    this.statusBar();

    /* 离线缓存 */
    this.registerSW();

    /* 首屏已就绪，收起启动页 */
    Splash.hide();

    /* 启动自检提示 */
    if (!navigator.onLine) Toast.show('当前无网络，已下载的歌曲仍可播放', 2600);
  },

  bindGlobal() {
    /* 底部导航 */
    $$('#tabbar .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (Nav.tab === tab) return;
        Nav.go(tab);
        if (tab === 'mine') MinePage.refreshStats();
      });
    });

    /* data-goto 跳转 */
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-goto]');
      if (!t) return;
      const type = t.dataset.goto;
      Nav.go('mine');
      ListPage.openType(type);
    });

    /* 列表页返回 */
    $('#list-back').addEventListener('click', () => Nav.go(Nav.tab));
    $('#list-action').addEventListener('click', () => pickAudioFiles());

    /* 关于 / 更多 */
    $('#menu-about').addEventListener('click', () => SettingSheets.about());
    $('#menu-author').addEventListener('click', () => SettingSheets.author());
    $('#menu-data').addEventListener('click', () => SettingSheets.data());
    $('#menu-support').addEventListener('click', () => {
      if (typeof Support !== 'undefined') Support.open();
    });

    /* 个人资料：点头像或名字编辑 */
    const openProfile = () => {
      if (typeof Profile !== 'undefined') Profile.openEditor();
    };
    const pOpen = $('#profile-open');
    if (pOpen) pOpen.addEventListener('click', openProfile);
    const pEdit = $('#profile-edit');
    if (pEdit) pEdit.addEventListener('click', (e) => { e.stopPropagation(); openProfile(); });
    $('#player-more').addEventListener('click', () => {
      if (Player.current) openTrackMenu(Player.current, { queue: Player.queue, from: Player.from });
      else Toast.show('先播放一首歌', 1400);
    });
    $('#home-more').addEventListener('click', () => {
      const wrap = el('div');
      wrap.appendChild(el('div', { class: 'sheet-title', text: '更多' }));
      const list = el('div', { class: 'sheet-list' });
      const mk = (ico, title, sub, fn) => {
        const it = el('div', { class: 'sheet-item' }, [
          el('span', { class: 'si-ico' }, icon(ico)),
          el('div', { class: 'si-body' }, [el('b', { text: title }), el('small', { text: sub })])
        ]);
        it.addEventListener('click', () => { Sheet.close(); setTimeout(fn, 220); });
        list.appendChild(it);
      };
      mk('download', '下载管理', Store.downloaded().length + ' 首已下载', () => ListPage.openType('downloads'));
      mk('heart', '我的收藏', Store.favorites().length + ' 首', () => ListPage.openType('favorites'));
      mk('wave', '音质设置', QMAP[Settings.get('playQuality')].label, () => SettingSheets.quality());
      mk('shield', '音源管理', '切换 / 自定义音源接口', () => SettingSheets.sources());
      mk('sparkle', '关于寻音', 'v1.0.0', () => SettingSheets.about());
      wrap.appendChild(list);
      Sheet.open(wrap);
    });

    /* 换一批 */
    $('#refresh-reco').addEventListener('click', () => {
      HomePage.recoTracks = [];
      HomePage.loadReco(true);
      Toast.show('正在为你换一批', 1200);
    });

    /* 遮罩关闭 */
    $('#sheet-mask').addEventListener('click', (e) => {
      if (e.target.id === 'sheet-mask') Sheet.close();
    });

    /* 网络状态 */
    window.addEventListener('online', () => Toast.show('网络已恢复', 1500));
    window.addEventListener('offline', () => Toast.show('已断网，可播放已下载歌曲', 2200));

    /* 键盘快捷键（桌面预览） */
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); Player.toggle(); }
      if (e.code === 'ArrowRight') Player.next();
      if (e.code === 'ArrowLeft') Player.prev();
      if (e.code === 'Escape') {
        if (Sheet.isOpen()) Sheet.close();
        else PlayerUI.close();
      }
    });
  },

  statusBar() {
    if (!isNative()) return;
    try {
      const { StatusBar } = window.Capacitor.Plugins;
      if (StatusBar) {
        StatusBar.setStyle({ style: 'DARK' });
        StatusBar.setBackgroundColor({ color: '#0b0e14' });
      }
    } catch { }
  },

  registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
};

/* ---------------- Toast / Sheet 的层栈兼容 ---------------- */
(function patchOverlays() {
  /* 切 Tab 时丢弃二级页层级，避免返回键绕回旧页面 */
  const rawNavGo = Nav.go.bind(Nav);
  Nav.go = function (tab) {
    Layer.stack = Layer.stack.filter(s => s.type !== 'page');
    rawNavGo(tab);
  };

  /* 页面栈：让安卓返回键能逐层退回 */
  const rawNavOpen = Nav.open.bind(Nav);
  Nav.open = function (pageId, opts) {
    const prev = $$('.page').find(p => p.classList.contains('active'));
    const samePage = prev && prev.id === 'page-' + pageId;
    rawNavOpen(pageId, opts);
    if (samePage) return;
    Layer.push('page', () => {
      if (prev && prev.isConnected) {
        $$('.page').forEach(p => p.classList.remove('active'));
        prev.classList.add('active');
      } else {
        Nav.go(Nav.tab);
      }
    });
  };

  const rawSheetOpen = Sheet.open.bind(Sheet);
  Sheet.open = function (content, opts) {
    const before = Layer.topType();
    rawSheetOpen(content, opts);
    if (before !== 'sheet') Layer.push('sheet', () => Sheet.forceClose());
  };
  Sheet.forceClose = function () {
    const mask = $('#sheet-mask');
    mask.classList.remove('show');
  };
  const rawClose = Sheet.close.bind(Sheet);
  Sheet.close = function () {
    if (Layer.topType() === 'sheet') { Layer.closeTop(); return; }
    Sheet.forceClose();
    void rawClose;
  };

  const rawPlayerOpen = PlayerUI.open.bind(PlayerUI);
  PlayerUI.open = function () {
    rawPlayerOpen();
    Layer.push('player', () => PlayerUI.forceClose());
  };
  PlayerUI.forceClose = function () {
    $('#player').classList.remove('open');
    PlayerUI.lyricMode = false;
    $('#lyric-panel').classList.remove('show');
    $('#cover-disc').style.opacity = '';
  };
  const rawPlayerClose = PlayerUI.close.bind(PlayerUI);
  PlayerUI.close = function () {
    if (Layer.topType() === 'player') { Layer.closeTop(); return; }
    PlayerUI.forceClose();
    void rawPlayerClose;
  };
})();

/* ---------------- 启动 ---------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
