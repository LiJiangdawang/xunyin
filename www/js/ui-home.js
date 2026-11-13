/* ============================================================
   ui-home.js —— 主页
   ============================================================ */
'use strict';

const BANNERS = [
  { tag: '每日推荐', title: '今天想听点什么？', sub: '为你挑选 30 首好歌', g: 'linear-gradient(135deg,#2f7cf6,#1b48c9)', kw: '华语流行' },
  { tag: '无损专区', title: 'SQ 无损 · 原声直出', sub: 'FLAC 音频，一耳朵的差别', g: 'linear-gradient(135deg,#8a5cf6,#4526b8)', kw: '经典老歌' },
  { tag: '安静时刻', title: '戴上耳机，安静下来', sub: '钢琴 / Lo-fi / 轻音乐', g: 'linear-gradient(135deg,#12b886,#0a6f55)', kw: '纯音乐' }
];

const QUICKS = [
  { ico: 'fire', label: '排行榜', kw: '热歌', g: 'linear-gradient(140deg,#ff7a4d,#e8452c)' },
  { ico: 'sparkle', label: '每日推荐', kw: '好听的歌', g: 'linear-gradient(140deg,#4facfe,#2b6cf6)' },
  { ico: 'heart', label: '我的收藏', goto: 'favorites', g: 'linear-gradient(140deg,#ff6b95,#e93f6b)' },
  { ico: 'folder', label: '本地音乐', goto: 'local', g: 'linear-gradient(140deg,#3fe0b0,#16a97e)' }
];

const PLAYLISTS = [
  { name: '华语热歌榜', desc: '大家都在听', kw: '热歌', g: 'linear-gradient(150deg,#ff8f6b,#d63c4a)' },
  { name: '粤语经典', desc: '经典粤语金曲', kw: '粤语经典', g: 'linear-gradient(150deg,#5cc0ff,#1b6fc4)' },
  { name: '周杰伦', desc: '青春的记忆', kw: '周杰伦', g: 'linear-gradient(150deg,#9b8cff,#4b3bd0)' },
  { name: '纯音乐', desc: '专注 / 学习', kw: '纯音乐', g: 'linear-gradient(150deg,#4ee0b8,#0d8f6d)' },
  { name: '伤感情歌', desc: '夜里最懂你', kw: '伤感', g: 'linear-gradient(150deg,#7a8bff,#2f3db8)' },
  { name: '女声精选', desc: '温柔女声', kw: '女声', g: 'linear-gradient(150deg,#ff9ec4,#d63c86)' },
  { name: '摇滚现场', desc: '躁起来', kw: '摇滚', g: 'linear-gradient(150deg,#ffb056,#c2541a)' },
  { name: '古风国风', desc: '一卷山河', kw: '古风', g: 'linear-gradient(150deg,#8fd3a0,#2a7a52)' }
];

const HomePage = {
  recoTracks: [],
  recoQueue: [],
  rendered: false,

  render() {
    if (this.rendered) return;
    this.rendered = true;
    this.renderBanner();
    this.renderQuick();
    this.renderPlaylists();
    this.loadReco();
  },

  renderBanner() {
    const wrap = $('#banner-wrap');
    wrap.innerHTML = '';
    BANNERS.forEach(b => {
      const card = el('div', { class: 'banner', style: { background: b.g } }, [
        el('span', { class: 'b-tag', text: b.tag }),
        el('div', { class: 'b-title', text: b.title }),
        el('div', { class: 'b-sub', text: b.sub })
      ]);
      card.addEventListener('click', () => {
        ListPage.open({ title: b.tag, keyword: b.kw, from: b.tag });
      });
      wrap.appendChild(card);
    });
  },

  renderQuick() {
    const grid = $('#quick-grid');
    grid.innerHTML = '';
    QUICKS.forEach(q => {
      const b = el('button', { class: 'quick' }, [
        el('span', { class: 'q-ico', style: { background: q.g } }, icon(q.ico)),
        el('span', { text: q.label })
      ]);
      b.addEventListener('click', () => {
        if (q.goto) {
          ListPage.openType(q.goto);
        } else {
          ListPage.open({ title: q.label, keyword: q.kw, from: q.label });
        }
      });
      grid.appendChild(b);
    });
  },

  renderPlaylists() {
    const grid = $('#playlist-grid');
    grid.innerHTML = '';
    PLAYLISTS.forEach(pl => {
      const cover = el('div', { class: 'pl-cover', style: { background: pl.g } }, [
        el('div', { class: 'pl-ico' }, icon('music', 'pl-ic')),
        el('div', { class: 'pl-play' }, icon('play'))
      ]);
      const card = el('div', { class: 'pl-card' }, [
        cover,
        el('div', { class: 'pl-name', text: pl.name }),
        el('div', { class: 'pl-desc', text: pl.desc })
      ]);
      card.addEventListener('click', () => ListPage.open({ title: pl.name, keyword: pl.kw, from: pl.name }));
      grid.appendChild(card);
    });
  },

  async loadReco(force) {
    const list = $('#reco-list');
    if (!force && this.recoTracks.length) { this.paintReco(); return; }
    list.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      list.appendChild(el('div', { class: 'sk-song' }, [
        el('div', { class: 'a skeleton' }),
        el('div', { class: 'b' }, [el('i', { class: 'skeleton', style: { width: '62%' } }), el('i', { class: 'skeleton' })])
      ]));
    }
    const pool = ['热歌', '华语流行', '好听的歌', '钢琴', 'lofi', '陈奕迅', '周杰伦', '林俊杰', '民谣', '轻音乐'];
    const kw = pool[Math.floor(Math.random() * pool.length)];
    try {
      const res = await Sources.search(kw, { limit: 30 });
      const shuffled = res.sort(() => Math.random() - 0.5).slice(0, 12);
      this.recoTracks = shuffled;
      this.recoQueue = shuffled.map(t => t.id);
      // 落库（收藏/下载状态可共用）
      for (const t of shuffled) {
        const exist = Store.get(t.id);
        if (exist) { t.favorite = exist.favorite; t.downloaded = exist.downloaded; t.cover = exist.cover || t.cover; }
        Store.tracks.set(t.id, t);
      }
      this.paintReco();
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'empty' }, [
        icon('wave'),
        el('p', { text: '推荐内容加载失败' }),
        el('small', { text: '请检查网络，或到「我 → 音源管理」确认音源地址。你仍然可以在搜索页搜索歌曲。' })
      ]));
    }
  },

  paintReco() {
    const list = $('#reco-list');
    list.innerHTML = '';
    Covers.reset();
    this.recoTracks.forEach((t, i) => {
      list.appendChild(renderSongRow(t, {
        index: i,
        queue: this.recoQueue,
        from: '猜你喜欢'
      }));
    });
  }
};
