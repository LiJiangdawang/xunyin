/* ============================================================
   ui-core.js —— 通用 UI：Toast / Sheet / 导航 / 歌曲行 / 封面懒加载
   ============================================================ */
'use strict';

/* ---------------- Toast ---------------- */
const Toast = (() => {
  let timer;
  return {
    show(msg, ms = 2000) {
      const t = $('#toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => t.classList.remove('show'), ms);
    }
  };
})();

/* ---------------- 底部弹层 ---------------- */
const Sheet = (() => {
  let onClose = null;
  return {
    open(content, { onDismiss } = {}) {
      const mask = $('#sheet-mask');
      const sheet = $('#sheet');
      sheet.innerHTML = '';
      sheet.appendChild(el('div', { class: 'sheet-handle' }));
      if (typeof content === 'string') sheet.insertAdjacentHTML('beforeend', content);
      else sheet.appendChild(content);
      mask.classList.add('show');
      onClose = onDismiss || null;
      return sheet;
    },
    close() {
      const mask = $('#sheet-mask');
      if (!mask.classList.contains('show')) return;
      mask.classList.remove('show');
      if (onClose) { const f = onClose; onClose = null; setTimeout(f, 220); }
    },
    isOpen() { return $('#sheet-mask').classList.contains('show'); }
  };
})();

/* ---------------- 封面懒加载（仅可见行才请求，避免打爆接口） ---------------- */
const Covers = {
  q: [],
  active: 0,
  io: null,

  request(track, box) {
    if (!box) return;
    if (track.cover) { attachCover(box, track.cover, track.id); return; }
    box.style.background = gradientOf(track.id);
    box.appendChild(el('div', { class: 's-fallback' }, icon('music')));
    if (track.sourceId === 'local' || !track.picId) return;

    const job = { track, box, ready: false };
    this.q.push(job);
    this.observe(box, job);
  },

  observe(box, job) {
    if (!('IntersectionObserver' in window)) { job.ready = true; this.pump(); return; }
    if (!this.io) {
      this.io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const item = this.q.find(x => x.box === en.target);
          if (item) { item.ready = true; this.io.unobserve(en.target); this.pump(); }
        });
      }, { root: null, rootMargin: '180px' });
    }
    this.io.observe(box);
  },

  async pump() {
    if (this.active >= 1) return;
    const idx = this.q.findIndex(j => j.ready && j.box.isConnected);
    if (idx < 0) { this.q = this.q.filter(j => j.box.isConnected); return; }
    const job = this.q.splice(idx, 1)[0];
    this.active++;
    try {
      const url = await Sources.pic(job.track);
      if (url && job.box.isConnected) attachCover(job.box, url, job.track.id);
    } catch { }
    this.active--;
    setTimeout(() => this.pump(), 700);
  },

  reset() {
    this.q = [];
    if (this.io) { try { this.io.disconnect(); } catch { } this.io = null; }
  }
};

/* ---------------- 音质角标 ---------------- */
function qualityBadge(track) {
  if (!track) return null;
  const q = track.qualities || {};
  if (q.lossless) return el('span', { class: 'tag-q q-lossless', text: 'SQ' });
  if (q.high) return el('span', { class: 'tag-q q-high', text: 'HQ' });
  return el('span', { class: 'tag-q q-standard', text: '标准' });
}

/* ---------------- 歌曲行 ---------------- */
/**
 * @param {object} track
 * @param {object} opts { index, showIndex, onClick, queue, from, onMore }
 */
function renderSongRow(track, opts = {}) {
  const isCur = Player.current && Player.current.id === track.id;
  const li = el('li', { class: 'song' + (isCur ? ' playing' : ''), dataset: { id: track.id } });

  if (opts.showIndex !== false) {
    if (isCur && Player.playing) {
      li.appendChild(el('span', { class: 's-idx' }, el('span', { class: 'eq' }, [el('i'), el('i'), el('i')])));
    } else {
      li.appendChild(el('span', { class: 's-idx', text: String((opts.index || 0) + 1) }));
    }
  }

  const cover = el('div', { class: 's-cover' });
  Covers.request(track, cover);
  li.appendChild(cover);

  const title = el('div', { class: 's-title' }, [el('span', { text: track.title })]);
  const badge = qualityBadge(track);
  if (badge) title.appendChild(badge);

  const subParts = [track.artist || '未知歌手'];
  if (track.album) subParts.push(track.album);
  if (track.duration) subParts.push(fmtTime(track.duration));
  const sub = el('div', { class: 's-sub', text: subParts.join(' · ') });

  li.appendChild(el('div', { class: 's-meta' }, [title, sub]));

  /* 操作区 */
  const acts = el('div', { class: 's-actions' });

  const favBtn = el('button', {
    class: 'icon-btn' + (track.favorite ? ' liked' : ''),
    onclick: async (e) => {
      e.stopPropagation();
      const on = await Store.toggleFavorite(track.id);
      favBtn.classList.toggle('liked', on);
      Toast.show(on ? '已收藏到「我的收藏」' : '已取消收藏', 1400);
    }
  }, icon('heart'));
  acts.appendChild(favBtn);

  const dlBtn = el('button', {
    class: 'icon-btn' + (track.downloaded ? ' dled' : ''),
    onclick: (e) => {
      e.stopPropagation();
      if (track.downloaded) { Toast.show('已经下载过了', 1400); return; }
      DownloadPick.open(track);
    }
  }, icon(track.downloaded ? 'done' : 'download'));
  acts.appendChild(dlBtn);

  acts.appendChild(el('button', {
    class: 'icon-btn',
    onclick: (e) => { e.stopPropagation(); openTrackMenu(track, opts); }
  }, icon('more')));

  li.appendChild(acts);

  li.addEventListener('click', () => {
    if (opts.onClick) return opts.onClick(track);
    playFromList(track, opts);
  });

  return li;
}

/** 从某个列表里播放 */
function playFromList(track, opts = {}) {
  const queue = opts.queue && opts.queue.length ? opts.queue : [track.id];
  Player.playById(track.id, { queue, from: opts.from || '列表' });
}

/* ---------------- 下载音质选择 ---------------- */
const DownloadPick = {
  open(track) {
    const avail = Store.availableQualities(track);
    const preferred = Settings.get('downloadQuality');

    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '选择下载音质' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: track.title + ' — ' + (track.artist || '') }));

    const list = el('div', { class: 'sheet-list' });
    QUALITIES.forEach(q => {
      const has = avail.includes(q.key);
      const item = el('div', {
        class: 'sheet-item' + (preferred === q.key ? ' selected' : ''),
        style: has ? {} : { opacity: .38 }
      }, [
        el('span', { class: 'si-ico' }, icon(q.key === 'lossless' ? 'sparkle' : 'wave')),
        el('div', { class: 'si-body' }, [
          el('b', { text: q.label }),
          el('small', { text: q.desc + (q.key === 'lossless' ? ' · 体积较大（约 40-70MB/首）' : '') })
        ]),
        el('div', { class: 'si-right' }, [
          el('span', { class: 'badge ' + q.cls, text: q.key === 'lossless' ? 'SQ' : q.key === 'high' ? 'HQ' : '标准' }),
          has ? icon('check') : el('span', { text: '不可用' })
        ])
      ]);
      if (!has) return;
      item.addEventListener('click', async () => {
        Sheet.close();
        Settings.set('downloadQuality', q.key);
        const btn = document.querySelector('.song[data-id="' + CSS.escape(track.id) + '"] .s-actions .icon-btn:nth-child(2)');
        if (btn) btn.innerHTML = '', btn.appendChild(icon('download'));
        await Store.download(track, q.key);
      });
      list.appendChild(item);
    });

    wrap.appendChild(list);
    wrap.appendChild(el('div', {
      class: 'sheet-note',
      text: '下载后音频保存在本机数据库，断网也能播放；下载的是原版音频文件，音质与所选档位一致。'
    }));

    Sheet.open(wrap);
  }
};

/* ---------------- 歌曲更多菜单 ---------------- */
function openTrackMenu(track, opts = {}) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'sheet-title', text: track.title }));
  wrap.appendChild(el('div', { class: 'sheet-sub', text: (track.artist || '') + (track.album ? ' · ' + track.album : '') }));

  const list = el('div', { class: 'sheet-list' });
  const mk = (ico, title, sub, fn) => {
    const it = el('div', { class: 'sheet-item' }, [
      el('span', { class: 'si-ico' }, icon(ico)),
      el('div', { class: 'si-body' }, [
        el('b', { text: title }),
        sub ? el('small', { text: sub }) : null
      ])
    ]);
    it.addEventListener('click', () => { Sheet.close(); setTimeout(fn, 200); });
    list.appendChild(it);
  };

  mk('play', '立即播放', '加入当前队列播放', () => {
    playFromList(track, opts.queue ? opts : { queue: Player.queue.length ? Player.queue : [track.id], from: '菜单' });
  });
  mk('plus', '下一首播放', null, () => {
    if (!Player.queue.length) Player.setQueue([track.id], 0);
    else {
      Player.queue.splice(Player.index + 1, 0, track.id);
      Bus.emit('queue:changed', { queue: Player.queue, index: Player.index });
      Toast.show('已插入下一首');
    }
  });
  mk(track.favorite ? 'heart' : 'heart', track.favorite ? '取消收藏' : '收藏到我的收藏', null, async () => {
    const on = await Store.toggleFavorite(track.id);
    Toast.show(on ? '已收藏' : '已取消收藏', 1400);
  });
  mk('download', track.downloaded ? '重新下载（换音质）' : '下载到本机', '离线可听', () => DownloadPick.open(track));
  if (track.downloaded) {
    mk('trash', '删除下载文件', '保留收藏，释放空间', async () => {
      const keys = await DB.blobKeys();
      for (const k of keys) if (String(k).startsWith(track.id + '::')) await DB.delBlob(k);
      await Store.patch(track.id, { downloaded: 0, dlSize: 0, downloadedQuality: '' });
      Toast.show('已删除本地文件');
      Bus.emit('library:changed');
    });
  }
  if (track.sourceId === 'gd') {
    mk('share', '查看音源信息', '来源：' + track.nativeSource, () => {
      Sheet.open(el('div', {}, [
        el('div', { class: 'sheet-title', text: '音源信息' }),
        el('div', { class: 'sheet-note', html: '曲目 ID：' + escapeHtml(track.sid) + '<br>音源：' + escapeHtml(track.nativeSource) + '<br>可用音质：' + Store.availableQualities(track).map(k => QMAP[k].label).join(' / ') })
      ]));
    });
  }

  wrap.appendChild(list);
  Sheet.open(wrap);
}

/* ---------------- 底部导航 / 路由 ---------------- */
const Nav = {
  tab: 'home',
  go(tab) {
    this.tab = tab;
    $$('.page').forEach(p => p.classList.remove('active'));
    const page = $('#page-' + tab);
    if (page) page.classList.add('active');
    $$('#tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    Bus.emit('nav:tab', tab);
  },
  open(pageId, opts = {}) {
    const page = $('#' + pageId);
    if (!page) return;
    $$('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
    page.dataset.opened = '1';
    $$('#tabbar .tab').forEach(b => b.classList.remove('active'));
    Bus.emit('nav:page', { page: pageId, opts });
  },
  back() {
    const opened = $$('.page').find(p => p.dataset.opened === '1' && p.classList.contains('active'));
    if (opened) { delete opened.dataset.opened; }
    this.go(this.tab);
  }
};
