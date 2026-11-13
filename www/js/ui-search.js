/* ============================================================
   ui-search.js —— 搜索页 + 通用列表页（收藏/下载/本地）
   ============================================================ */
'use strict';

/* ---------------- 搜索历史 ---------------- */
const SearchHistory = {
  get() { return Storage.get('searchHistory', []); },
  add(kw) {
    const list = this.get().filter(x => x !== kw);
    list.unshift(kw);
    Storage.set('searchHistory', list.slice(0, 20));
  },
  remove(kw) {
    const list = this.get().filter(x => x !== kw);
    Storage.set('searchHistory', list);
    return list;
  },
  clear() { Storage.set('searchHistory', []); }
};

/* ---------------- 搜索页 ---------------- */
const SearchPage = {
  busy: false,
  results: [],
  queue: [],

  init() {
    const input = $('#search-input');
    $('#home-search').addEventListener('click', () => this.open());
    $('#search-back').addEventListener('click', () => { Nav.go('home'); });
    $('#search-go').addEventListener('click', () => this.doSearch(input.value));
    $('#search-clear').addEventListener('click', () => {
      input.value = '';
      $('#search-clear').hidden = true;
      this.showHistory();
      input.focus();
    });
    input.addEventListener('input', () => {
      $('#search-clear').hidden = !input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); this.doSearch(input.value); }
    });
    $('#clear-history').addEventListener('click', () => {
      SearchHistory.clear();
      this.renderHistory();
      Toast.show('已清空搜索历史', 1400);
    });
    this.renderHot();
  },

  open() {
    Nav.open('page-search');
    this.showHistory();
    setTimeout(() => { const i = $('#search-input'); i.focus(); }, 120);
  },

  showHistory() {
    $('#search-history-wrap').hidden = false;
    $('#search-results').innerHTML = '';
    this.renderHistory();
  },

  renderHistory() {
    const box = $('#history-chips');
    const list = SearchHistory.get();
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--sub-2)' }, text: '还没有搜索记录' }));
      return;
    }
    list.forEach(kw => {
      const c = el('button', { class: 'chip' }, [
        el('span', { text: kw })
      ]);
      /* 点文字 = 再搜一次 */
      c.addEventListener('click', () => {
        $('#search-input').value = kw;
        this.doSearch(kw);
      });
      /* 长按 = 删这一条 */
      let timer = null;
      const start = () => {
        timer = setTimeout(() => {
          timer = null;
          SearchHistory.remove(kw);
          this.renderHistory();
          Toast.show('已删除「' + kw + '」', 1400);
        }, 600);
      };
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      c.addEventListener('touchstart', start, { passive: true });
      c.addEventListener('touchend', cancel);
      c.addEventListener('touchmove', cancel, { passive: true });
      c.addEventListener('mousedown', start);
      c.addEventListener('mouseup', cancel);
      c.addEventListener('mouseleave', cancel);
      box.appendChild(c);
    });
  },

  renderHot() {
    const box = $('#hot-chips');
    box.innerHTML = '';
    Sources.HOT_WORDS.forEach((kw, i) => {
      const c = el('button', { class: 'chip' + (i < 3 ? ' hot' : ''), text: kw });
      c.addEventListener('click', () => { $('#search-input').value = kw; this.doSearch(kw); });
      box.appendChild(c);
    });
  },

  async doSearch(rawKw) {
    const kw = String(rawKw || '').trim();
    if (!kw) { Toast.show('请输入搜索内容', 1400); return; }
    if (this.busy) return;
    this.busy = true;
    $('#search-input').value = kw;
    $('#search-clear').hidden = false;
    SearchHistory.add(kw);

    $('#search-history-wrap').hidden = true;
    const box = $('#search-results');
    box.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      box.appendChild(el('div', { class: 'sk-song' }, [
        el('div', { class: 'a skeleton' }),
        el('div', { class: 'b' }, [el('i', { class: 'skeleton', style: { width: '58%' } }), el('i', { class: 'skeleton' })])
      ]));
    }

    try {
      const res = await Sources.search(kw, { limit: 40 });
      this.results = res;
      registerSearchResults(res);
      this.queue = res.map(t => t.id);
      this.paint(box);
      if (!res.length) {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'empty' }, [
          icon('search'),
          el('p', { text: '没有找到「' + kw + '」相关歌曲' }),
          el('small', { text: '换个关键词试试，或者到「我 → 音源管理」换一个音源。' })
        ]));
      }
    } catch (e) {
      console.warn(e);
      box.innerHTML = '';
      box.appendChild(el('div', { class: 'empty' }, [
        icon('wave'),
        el('p', { text: '搜索失败' }),
        el('small', { text: '音源暂时没有响应（' + (e.message || '网络异常') + '），请稍后重试。' })
      ]));
    } finally {
      this.busy = false;
    }
  },

  paint(container) {
    const box = container || $('#search-results');
    box.innerHTML = '';
    Covers.reset();
    box.appendChild(el('div', {
      class: 'block-head tight',
      style: { margin: '4px 0 8px' }
    }, [
      el('h2', { style: { fontSize: '13px', color: 'var(--sub)' }, text: '找到 ' + this.results.length + ' 首歌曲' }),
      el('button', {
        class: 'link',
        onclick: () => this.playAll()
      }, [icon('play', 'tiny'), el('span', { text: '播放全部' })])
    ]));
    this.results.forEach((t, i) => {
      box.appendChild(renderSongRow(t, { index: i, queue: this.queue, from: '搜索' }));
    });
  },

  playAll() {
    if (!this.queue.length) return;
    Player.playById(this.queue[0], { queue: this.queue, from: '搜索' });
    Toast.show('开始播放搜索结果', 1400);
  }
};

/** 搜索结果并入内存库，保留已有收藏 / 下载状态 */
function registerSearchResults(list) {
  list.forEach(t => {
    const exist = Store.get(t.id);
    if (exist) {
      t.favorite = exist.favorite || 0;
      t.downloaded = exist.downloaded || 0;
      t.cover = exist.cover || t.cover;
      t.duration = exist.duration || t.duration;
      t.createdAt = exist.createdAt || t.createdAt;
    }
    Store.tracks.set(t.id, t);
  });
}

/* ---------------- 通用列表页 ---------------- */
const ListPage = {
  type: 'custom',
  tracks: [],
  queue: [],
  title: '',

  async openType(type) {
    if (type === 'quality') return SettingSheets.quality();
    if (type === 'sources') return SettingSheets.sources();
    if (type === 'playlists') return this.openPlaylists();

    this.type = type;
    Nav.open('page-list');
    $('#list-action').hidden = (type !== 'local');

    if (type === 'favorites') {
      this.title = '我的收藏';
      $('#list-title').textContent = this.title;
      this.tracks = Store.favorites();
      this.paint('收藏的歌曲会一直留在这里');
    } else if (type === 'downloads') {
      this.title = '下载管理';
      $('#list-title').textContent = this.title;
      this.tracks = Store.downloaded();
      this.paint('已下载的全部可在飞行模式下播放');
    } else if (type === 'local') {
      this.title = '本地音乐';
      $('#list-title').textContent = this.title;
      this.tracks = Store.locals();
      this.paint('从手机文件里导入音频（mp3 / flac / m4a / wav）');
    } else {
      this.title = '列表';
      $('#list-title').textContent = this.title;
      this.tracks = [];
      this.paint('');
    }
  },

  async open({ title, keyword, from }) {
    this.type = 'search';
    this.title = title;
    this.keyword = keyword;
    this.from = from || title;
    Nav.open('page-list');
    $('#list-title').textContent = title;
    $('#list-action').hidden = true;
    this.drawSkeleton();
    try {
      const res = await Sources.search(keyword, { limit: 40 });
      registerSearchResults(res);
      this.tracks = res;
      this.queue = res.map(t => t.id);
      this.paint('按「' + keyword + '」搜索到 ' + res.length + ' 首');
      this.paint('');
    } catch (e) {
      $('#list-items').innerHTML = '';
      $('#list-items').appendChild(el('div', { class: 'empty' }, [
        icon('wave'), el('p', { text: '加载失败（' + (e.message || '网络异常') + '）' })
      ]));
      $('#list-sub').textContent = '';
    }
  },

  openPlaylists() {
    Nav.open('page-list');
    this.type = 'playlists';
    $('#list-title').textContent = '推荐歌单';
    $('#list-sub').textContent = '点击任意歌单开始播放';
    const box = $('#list-items');
    box.innerHTML = '';
    PLAYLISTS.forEach(pl => {
      const li = el('li', { class: 'song' }, [
        el('div', { class: 's-cover', style: { background: pl.g } }, icon('wave')),
        el('div', { class: 's-meta' }, [
          el('div', { class: 's-title', text: pl.name }),
          el('div', { class: 's-sub', text: pl.desc })
        ]),
        el('div', { class: 's-actions' }, icon('next'))
      ]);
      li.addEventListener('click', () => this.open({ title: pl.name, keyword: pl.kw, from: pl.name }));
      box.appendChild(li);
    });
  },

  drawSkeleton() {
    const box = $('#list-items');
    box.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      box.appendChild(el('div', { class: 'sk-song' }, [
        el('div', { class: 'a skeleton' }),
        el('div', { class: 'b' }, [el('i', { class: 'skeleton', style: { width: '64%' } }), el('i', { class: 'skeleton' })])
      ]));
    }
    $('#list-sub').textContent = '正在加载…';
  },

  paint(subText) {
    if (subText !== undefined) {
      if (this.type === 'favorites') {
        const used = this.tracks.reduce((a, t) => a + (t.dlSize || 0), 0);
        $('#list-sub').textContent = this.tracks.length + ' 首 · 已下载 ' + fmtSize(used);
      } else if (this.type === 'downloads') {
        const size = this.tracks.reduce((a, t) => a + (t.dlSize || 0), 0);
        $('#list-sub').textContent = this.tracks.length + ' 首 · 占用 ' + fmtSize(size);
      } else {
        $('#list-sub').textContent = subText;
      }
    }
    const box = $('#list-items');
    box.innerHTML = '';
    Covers.reset();

    if (!this.tracks.length) {
      const isFav = this.type === 'favorites';
      const isDl = this.type === 'downloads';
      const isLocal = this.type === 'local';
      box.appendChild(el('div', { class: 'empty' }, [
        icon(isDl ? 'cloud' : isLocal ? 'folder' : 'heart'),
        el('p', { text: isFav ? '还没有收藏的歌曲' : isDl ? '还没有下载的歌曲' : isLocal ? '还没有导入本地音乐' : '这里空空如也' }),
        el('small', {
          text: isFav ? '在搜索页找到喜欢的歌，点右侧的心形就能收藏'
            : isDl ? '在歌曲右侧点下载按钮，选一个音质就能离线听'
              : isLocal ? '点右上角「+」选择手机里的音频文件导入'
                : ''
        })
      ]));
      return;
    }

    this.queue = this.tracks.map(t => t.id);
    const head = el('div', { class: 'block-head tight', style: { margin: '0 0 6px' } }, [
      el('h2', { style: { fontSize: '12px', color: 'var(--sub-2)', fontWeight: '500' }, text: '共 ' + this.tracks.length + ' 首' }),
      el('button', {
        class: 'link',
        onclick: () => {
          if (!this.queue.length) return;
          Player.playById(this.queue[0], { queue: this.queue, from: this.title });
          Toast.show('播放全部', 1200);
        }
      }, [icon('play', 'tiny'), el('span', { text: '播放全部' })])
    ]);
    box.appendChild(head);

    this.tracks.forEach((t, i) => {
      box.appendChild(renderSongRow(t, { index: i, queue: this.queue, from: this.title }));
    });
  }
};
