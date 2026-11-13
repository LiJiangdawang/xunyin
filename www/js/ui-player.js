/* ============================================================
   ui-player.js —— 全屏播放器 + 迷你播放条
   ============================================================ */
'use strict';

const PlayerUI = {
  seeking: false,
  lyricMode: false,
  lastLyricIdx: -2,

  init() {
    /* ---- 打开 / 关闭 ---- */
    $('#mini-open').addEventListener('click', () => this.open());
    $('#player-close').addEventListener('click', () => this.close());

    /* ---- 播放控制 ---- */
    $('#btn-play').addEventListener('click', () => Player.toggle());
    $('#btn-prev').addEventListener('click', () => Player.prev());
    $('#btn-next').addEventListener('click', () => Player.next());
    $('#mini-toggle').addEventListener('click', (e) => { e.stopPropagation(); Player.toggle(); });
    $('#mini-next').addEventListener('click', (e) => { e.stopPropagation(); Player.next(); });
    $('#btn-mode').addEventListener('click', () => {
      const m = Player.setMode();
      this.paintMode();
      Toast.show({ list: '列表循环', single: '单曲循环', shuffle: '随机播放' }[m], 1200);
    });

    /* ---- 收藏 ---- */
    const toggleFav = async () => {
      if (!Player.current) return;
      const on = await Store.toggleFavorite(Player.current.id);
      this.paintFav();
      Toast.show(on ? '已收藏' : '已取消收藏', 1200);
    };
    $('#pm-fav').addEventListener('click', toggleFav);
    $('#mini-fav').addEventListener('click', (e) => { e.stopPropagation(); toggleFav(); });

    /* ---- 进度 ---- */
    const seek = $('#seek');
    seek.addEventListener('input', () => {
      this.seeking = true;
      const p = Number(seek.value) / 1000;
      seek.style.setProperty('--p', (p * 100) + '%');
      const dur = Player.audio && isFinite(Player.audio.duration) ? Player.audio.duration : 0;
      $('#t-cur').textContent = fmtTime(p * dur);
      if (this.lyricMode) this.paintLyric(p * dur);
    });
    seek.addEventListener('change', () => {
      Player.seek(Number(seek.value) / 1000);
      this.seeking = false;
    });

    /* ---- 音质 ---- */
    $('#pm-quality').addEventListener('click', () => this.openQualityPick());
    $('#pm-download').addEventListener('click', () => {
      if (!Player.current) return;
      DownloadPick.open(Player.current);
    });
    $('#pm-share').addEventListener('click', () => this.share());
    $('#btn-queue').addEventListener('click', () => this.openQueue());

    /* ---- 歌词切换 ---- */
    $('#cover-disc').addEventListener('click', () => this.toggleLyric());

    /* ---- 事件订阅 ---- */
    Bus.on('player:track', (t) => { this.paintTrack(t); this.paintFav(); });
    Bus.on('player:meta', () => { this.paintCover(); });
    Bus.on('player:state', (s) => {
      this.paintPlayState(s.playing);
      if (Player.audio && Player.audio.duration) this.paintTime(Player.audio.currentTime, Player.audio.duration);
      else this.paintTime(0, Player.current ? Player.current.duration : 0);
    });
    Bus.on('player:time', ({ cur, dur, pct }) => {
      if (!this.seeking) this.paintTime(cur, dur, pct);
      if (this.lyricMode && !this.seeking) this.paintLyric(cur);
    });
    Bus.on('player:quality', () => { this.paintQuality(); this.paintTrack(Player.current); });
    Bus.on('queue:changed', () => this.paintQueueCount());
    Bus.on('favorite:changed', ({ id }) => {
      if (Player.current && Player.current.id === id) this.paintFav();
      this.syncListHearts(id);
    });
    Bus.on('library:changed', () => {
      MinePage.refreshStats();
      this.paintFav();
    });
    Bus.on('download:start', ({ id }) => this.markDownloadState(id, 'loading'));
    Bus.on('download:progress', ({ id, pct }) => this.markDownloadState(id, 'progress', pct));
    Bus.on('download:done', ({ id }) => this.markDownloadState(id, 'done'));
    Bus.on('download:error', ({ id }) => this.markDownloadState(id, 'error'));

    this.paintMode();
    this.paintQuality();
  },

  /* ---------------- 开合 ---------------- */
  open() {
    const p = $('#player');
    if (!Player.current && Player.queue.length) Player.playById(Player.queue[0]);
    p.classList.add('open');
    this.paintTrack(Player.current);
    this.paintFav();
    this.paintQuality();
  },

  close() {
    $('#player').classList.remove('open');
    this.lyricMode = false;
    $('#lyric-panel').classList.remove('show');
    $('#cover-disc').style.opacity = '';
  },

  /* ---------------- 绘制 ---------------- */
  paintTrack(track) {
    if (!track) {
      $('#pm-title').textContent = '未在播放';
      $('#pm-artist').textContent = '—';
      return;
    }
    $('#pm-title').textContent = track.title;
    $('#pm-artist').textContent = [track.artist || '未知歌手', track.album].filter(Boolean).join(' · ');
    $('#player-from').textContent = '正在播放 · ' + (Player.from || '音乐库');
    this.paintCover();
    this.paintMini();
    this.paintLyric(0);
    this.paintPlayState(Player.playing);
    /* 列表高亮 */
    $$('#pages .song').forEach(li => li.classList.toggle('playing', li.dataset.id === track.id));
  },

  paintCover() {
    const t = Player.current;
    if (!t) return;
    const box = $('#cover-img');
    box.innerHTML = '';
    if (t.cover) {
      const img = el('img', { src: t.cover, alt: '' });
      img.onerror = () => { box.style.background = gradientOf(t.id); };
      box.appendChild(img);
      $('#player-bg').style.backgroundImage = 'url("' + t.cover + '")';
    } else {
      box.style.background = gradientOf(t.id);
      $('#player-bg').style.backgroundImage = 'none';
      Sources.pic(t).then(url => {
        if (!url || !Player.current || Player.current.id !== t.id) return;
        this.paintCover();
        this.paintMini();
      }).catch(() => { });
    }
  },

  paintPlayState(playing) {
    const big = $('#btn-play');
    big.innerHTML = '';
    const icn = icon(playing ? 'pause' : 'play');
    if (playing) icn.classList.add('pause-ic');
    big.appendChild(icn);

    const miniBtn = $('#mini-toggle');
    miniBtn.innerHTML = '';
    miniBtn.appendChild(icon(playing ? 'pause' : 'play'));

    const disc = $('#cover-disc');
    disc.classList.toggle('spinning', !!playing);
  },

  paintTime(cur, dur, pct) {
    const p = pct !== undefined ? pct : (dur ? cur / dur : 0);
    const seek = $('#seek');
    seek.value = String(Math.round(clamp(p, 0, 1) * 1000));
    seek.style.setProperty('--p', (clamp(p, 0, 1) * 100) + '%');
    $('#t-cur').textContent = fmtTime(cur);
    $('#t-dur').textContent = fmtTime(dur);
    $('#mini-bar').style.width = (clamp(p, 0, 1) * 100) + '%';
  },

  paintFav() {
    const on = Player.current ? Store.isFav(Player.current.id) : false;
    $('#pm-fav').classList.toggle('liked', on);
    $('#mini-fav').classList.toggle('liked', on);
  },

  paintMode() {
    const btn = $('#btn-mode');
    btn.innerHTML = '';
    btn.appendChild(icon(Player.mode === 'single' ? 'repeat1' : Player.mode === 'shuffle' ? 'shuffle' : 'repeat'));
    btn.classList.toggle('on', Player.mode !== 'list');
  },

  paintQuality() {
    const t = Player.current;
    const qk = Player.quality || (t ? Store.resolveQuality(t, Settings.get('playQuality')) : Settings.get('playQuality'));
    const q = QMAP[qk] || QMAP.standard;
    const pill = $('#pm-quality');
    pill.innerHTML = '';
    pill.appendChild(icon('wave', 'tiny'));
    pill.appendChild(el('span', { text: q.short + (Player.offline ? ' · 本地' : '') }));
  },

  paintQueueCount() {
    const btn = $('#btn-queue');
    const n = Player.queue.length;
    btn.setAttribute('title', n + ' 首');
  },

  paintMini() {
    const t = Player.current;
    const mini = $('#mini');
    if (!t) { mini.hidden = true; $('#app').classList.remove('has-mini'); return; }
    mini.hidden = false;
    $('#app').classList.add('has-mini');
    $('#mini-title').textContent = t.title;
    $('#mini-sub').textContent = (t.artist || '未知歌手') + (Player.offline ? ' · 已下载' : '');
    const box = $('#mini-cover');
    box.innerHTML = '';
    if (t.cover) {
      const img = el('img', { src: t.cover, alt: '' });
      img.onerror = () => { box.style.background = gradientOf(t.id); };
      box.appendChild(img);
    } else {
      box.style.background = gradientOf(t.id);
      box.appendChild(el('div', { class: 's-fallback' }, icon('music')));
    }
  },

  /* ---------------- 歌词 ---------------- */
  toggleLyric() {
    this.lyricMode = !this.lyricMode;
    $('#lyric-panel').classList.toggle('show', this.lyricMode);
    $('#cover-disc').style.opacity = this.lyricMode ? '0' : '';
    if (this.lyricMode) this.paintLyric(Player.audio ? Player.audio.currentTime : 0);
  },

  paintLyric(cur) {
    const panel = $('#lyric-panel');
    if (!panel.classList.contains('show') && this.lyricMode) return;
    const lrc = Player._lrc || [];
    if (!lrc.length) {
      panel.innerHTML = '';
      panel.appendChild(el('div', { class: 'lyric-line', text: Player.current ? Player.current.title : '寻音' }));
      panel.appendChild(el('div', { class: 'lyric-line dim', text: '暂无歌词 · 点一下封面对返回' }));
      return;
    }
    let idx = -1;
    const t = typeof cur === 'number' ? cur : (Player.audio ? Player.audio.currentTime : 0);
    for (let i = 0; i < lrc.length; i++) { if (lrc[i].t <= t) idx = i; else break; }
    if (idx === this.lastLyricIdx) return;
    this.lastLyricIdx = idx;
    panel.innerHTML = '';
    const lines = [
      { text: lrc[idx - 1] ? lrc[idx - 1].text : '', dim: true },
      { text: lrc[idx] ? lrc[idx].text : (lrc[0] ? lrc[0].text : ''), dim: false },
      { text: lrc[idx + 1] ? lrc[idx + 1].text : '', dim: true }
    ];
    lines.forEach(l => {
      if (!l.text) return;
      panel.appendChild(el('div', { class: 'lyric-line' + (l.dim ? ' dim' : ''), text: l.text }));
    });
    if (!panel.children.length) {
      panel.appendChild(el('div', { class: 'lyric-line dim', text: '♪' }));
    }
  },

  /* ---------------- 音质选择（当前曲） ---------------- */
  openQualityPick() {
    const t = Player.current;
    if (!t) { Toast.show('先播放一首歌', 1400); return; }
    const avail = Store.availableQualities(t);
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '切换音质' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: t.title + ' — ' + (t.artist || '') }));

    const list = el('div', { class: 'sheet-list' });
    QUALITIES.forEach(q => {
      const has = avail.includes(q.key);
      const cur = (Player.quality || Settings.get('playQuality')) === q.key;
      const item = el('div', {
        class: 'sheet-item' + (cur ? ' selected' : ''),
        style: has ? {} : { opacity: .4 }
      }, [
        el('span', { class: 'si-ico' }, icon(q.key === 'lossless' ? 'sparkle' : q.key === 'high' ? 'wave' : 'music')),
        el('div', { class: 'si-body' }, [el('b', { text: q.label }), el('small', { text: q.desc }) ]),
        el('div', { class: 'si-right' }, [
          el('span', { class: 'badge ' + q.cls, text: q.key === 'lossless' ? 'SQ' : q.key === 'high' ? 'HQ' : '标准' }),
          cur ? icon('check') : (has ? null : el('span', { text: '不可用' }))
        ])
      ]);
      if (has) {
        item.addEventListener('click', async () => {
          Sheet.close();
          Toast.show('正在切换为 ' + q.label + '…', 1400);
          await Player.setQuality(q.key);
          this.paintQuality();
        });
      }
      list.appendChild(item);
    });
    wrap.appendChild(list);
    wrap.appendChild(el('div', { class: 'sheet-note', text: '已下载的歌曲会直接播放本地原文件，音质与下载时的档位一致。' }));
    Sheet.open(wrap);
  },

  /* ---------------- 队列 ---------------- */
  openQueue() {
    const wrap = el('div');
    const clearBtn = el('button', {
      class: 'link',
      onclick: () => {
        Player.setQueue(Player.current ? [Player.current.id] : [], 0);
        Sheet.close();
        Toast.show('已清空播放队列', 1400);
      }
    }, [icon('trash', 'tiny'), el('span', { text: '清空' })]);
    wrap.appendChild(el('div', { class: 'sheet-title' }, [
      el('span', { text: '播放队列 (' + Player.queue.length + ')' }),
      clearBtn
    ]));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '来自：' + (Player.from || '列表') }));

    const list = el('div', { class: 'sheet-list' });
    const tracks = Player.queue.map(id => Store.get(id)).filter(Boolean);
    if (!tracks.length) {
      list.appendChild(el('div', { class: 'empty' }, [icon('list'), el('p', { text: '队列是空的' })]));
    }
    tracks.forEach((t, i) => {
      const cur = Player.current && Player.current.id === t.id;
      const item = el('div', { class: 'sheet-item' + (cur ? ' selected' : '') }, [
        el('span', { class: 'si-ico', style: { fontSize: '12px', fontWeight: '700' }, text: String(i + 1) }),
        el('div', { class: 'si-body' }, [
          el('b', { text: t.title, style: cur ? { color: 'var(--pri)' } : {} }),
          el('small', { text: t.artist || '未知歌手' })
        ]),
        el('div', { class: 'si-right' }, cur ? icon('play', 'tiny') : null)
      ]);
      item.addEventListener('click', () => {
        Player.playById(t.id, { from: Player.from });
        Sheet.close();
      });
      list.appendChild(item);
    });
    wrap.appendChild(list);
    Sheet.open(wrap);
  },

  /* ---------------- 分享 ---------------- */
  async share() {
    const t = Player.current;
    if (!t) return;
    const text = '我正在寻音听《' + t.title + '》- ' + (t.artist || '未知歌手');
    try {
      if (navigator.share) {
        await navigator.share({ title: '寻音', text });
        return;
      }
      throw new Error('no-share');
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        Toast.show('已复制到剪贴板');
      } catch {
        Toast.show(text, 2600);
      }
    }
  },

  /* ---------------- 下载状态联动 ---------------- */
  markDownloadState(id, state, pct) {
    const li = $('.song[data-id="' + CSS.escape(id) + '"]');
    if (li) {
      const btn = li.querySelector('.s-actions .icon-btn:nth-child(2)');
      if (btn) {
        btn.innerHTML = '';
        if (state === 'done') btn.classList.add('dled');
        btn.appendChild(icon(state === 'done' ? 'done' : 'download'));
        btn.style.color = state === 'done' ? 'var(--green)' : (state === 'error' ? 'var(--pink)' : 'var(--pri)');
        if (state === 'done') btn.style.color = '';
        if (state === 'progress' || state === 'loading') {
          btn.title = pct ? pct + '%' : '下载中';
          btn.style.opacity = state === 'progress' ? String(0.5 + (pct || 0) / 200) : '.6';
        } else {
          btn.title = '';
          btn.style.opacity = '';
        }
      }
    }
    if (state === 'done' && Player.current && Player.current.id === id) {
      Player.current.downloaded = 1;
    }
  },

  syncListHearts(id) {
    const li = $('.song[data-id="' + CSS.escape(id) + '"]');
    if (!li) return;
    const btn = li.querySelector('.s-actions .icon-btn:nth-child(1)');
    if (btn) btn.classList.toggle('liked', Store.isFav(id));
  }
};
