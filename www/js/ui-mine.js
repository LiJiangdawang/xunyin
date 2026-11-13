/* ============================================================
   ui-mine.js —— 「我」页面 + 设置弹层（音质 / 音源 / 关于）
   ============================================================ */
'use strict';

const MinePage = {
  render() {
    this.refreshStats();
  },

  refreshStats() {
    const fav = Store.favorites().length;
    const dl = Store.downloaded().length;
    const local = Store.locals().length;
    const setTxt = (id, v) => { const n = $(id); if (n) n.textContent = String(v); };
    setTxt('#stat-fav', fav);
    setTxt('#stat-dl', dl);
    setTxt('#stat-local', local);

    const q = Settings.get('playQuality');
    const qh = $('#quality-hint');
    if (qh) qh.textContent = QMAP[q] ? QMAP[q].label : '标准音质';

    const cfg = SourceConfig.get();
    const sh = $('#source-hint');
    if (sh) {
      const names = { netease: '网易云', kuwo: '酷我', tencent: 'QQ音乐', kugou: '酷狗', migu: '咪咕', joox: 'JOOX', ytmusic: 'YouTube' };
      sh.textContent = (names[cfg.preferSource] || cfg.preferSource) + ' · ' + (cfg.apiBase.includes('gdstudio') ? '公共音源' : '自定义音源');
    }

    /* 赞助入口：只有在 SUPPORT_ENABLED 打开时才出现，且不锁任何功能 */
    const supLi = $('#menu-support');
    if (supLi) {
      const on = typeof Support !== 'undefined' && Support.enabled;
      supLi.hidden = !on;
    }
  }
};

/* ---------------- 设置弹层 ---------------- */
const SettingSheets = {
  /* ----- 音质 ----- */
  quality() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '音质设置' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '播放与下载使用不同档位，可按网络情况分开设置' }));

    const play = Settings.get('playQuality');
    const dl = Settings.get('downloadQuality');

    const section = (title, current, onPick) => {
      wrap.appendChild(el('div', { class: 'sheet-sub', style: { fontWeight: '700', color: 'var(--txt)', marginTop: '4px' }, text: title }));
      const list = el('div', { class: 'sheet-list' });
      QUALITIES.forEach(q => {
        const item = el('div', { class: 'sheet-item' + (current === q.key ? ' selected' : '') }, [
          el('span', { class: 'si-ico' }, icon(q.key === 'lossless' ? 'sparkle' : q.key === 'high' ? 'wave' : 'music')),
          el('div', { class: 'si-body' }, [
            el('b', { text: q.label }),
            el('small', { text: q.desc })
          ]),
          el('div', { class: 'si-right' }, [
            el('span', { class: 'badge ' + q.cls, text: q.key === 'lossless' ? 'SQ' : q.key === 'high' ? 'HQ' : '标准' }),
            current === q.key ? icon('check') : null
          ])
        ]);
        item.addEventListener('click', () => { onPick(q.key); Sheet.close(); });
        list.appendChild(item);
      });
      wrap.appendChild(list);
    };

    section('默认播放音质', play, (k) => {
      Settings.set('playQuality', k);
      Player.preferQuality = k;
      MinePage.refreshStats();
      if (Player.current) Player.setQuality(k);
      Toast.show('播放音质已设为「' + QMAP[k].label + '」', 1600);
    });

    section('默认下载音质', dl, (k) => {
      Settings.set('downloadQuality', k);
      MinePage.refreshStats();
      Toast.show('下载音质已设为「' + QMAP[k].label + '」', 1600);
    });

    wrap.appendChild(el('div', {
      class: 'sheet-note',
      text: '说明：无损音质为 FLAC 原版文件，单曲通常 30–70MB；若某首歌没有无损版本，会自动降级到高品。'
    }));
    Sheet.open(wrap);
  },

  /* ----- 音源 ----- */
  sources() {
    const cfg = SourceConfig.get();
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '音源管理' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '当前音源地址' }));

    const inputWrap = el('div', { class: 'sheet-input' }, [
      icon('shield'),
      el('input', { type: 'url', value: cfg.apiBase, placeholder: 'https://your-api/api.php', id: 'src-api-input' })
    ]);
    wrap.appendChild(inputWrap);

    const SRC_LIST = [
      { k: 'netease', n: '网易云音乐', d: '中文曲库最全' },
      { k: 'kuwo', n: '酷我音乐', d: '备用源' },
      { k: 'tencent', n: 'QQ 音乐', d: '备用源' },
      { k: 'kugou', n: '酷狗音乐', d: '备用源' },
      { k: 'migu', n: '咪咕音乐', d: '备用源' },
      { k: 'joox', n: 'JOOX', d: '港台 / 东南亚' },
      { k: 'ytmusic', n: 'YouTube Music', d: '海外曲库' }
    ];
    wrap.appendChild(el('div', { class: 'sheet-sub', style: { fontWeight: '700', color: 'var(--txt)' }, text: '优先音源' }));
    const list = el('div', { class: 'sheet-list' });
    SRC_LIST.forEach(s => {
      const item = el('div', { class: 'sheet-item' + (cfg.preferSource === s.k ? ' selected' : '') }, [
        el('span', { class: 'si-ico' }, icon('wave')),
        el('div', { class: 'si-body' }, [el('b', { text: s.n }), el('small', { text: s.d })]),
        el('div', { class: 'si-right' }, cfg.preferSource === s.k ? icon('check') : null)
      ]);
      item.addEventListener('click', () => {
        SourceConfig.set({ preferSource: s.k });
        MinePage.refreshStats();
        $$('.sheet-item', list).forEach(x => x.classList.remove('selected'));
        item.classList.add('selected');
        Toast.show('优先音源已切换为「' + s.n + '」', 1500);
      });
      list.appendChild(item);
    });
    wrap.appendChild(list);

    const actions = el('div', { class: 'sheet-actions' }, [
      el('button', {
        class: 'btn-ghost',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.textContent = '测试中…';
          const api = $('#src-api-input').value.trim() || SRC_DEFAULTS.apiBase;
          SourceConfig.set({ apiBase: api });
          try {
            const r = await Sources.search('晴天', { limit: 3 });
            btn.textContent = r.length ? '连接成功 ✓' : '无结果';
            Toast.show(r.length ? '音源可用，找到 ' + r.length + ' 首' : '接口有响应但没有结果', 2200);
          } catch (err) {
            btn.textContent = '测试失败';
            Toast.show('接口不通：' + (err.message || '网络异常'), 2400);
          }
          setTimeout(() => { btn.textContent = '测试连接'; }, 2400);
        }
      }, '测试连接'),
      el('button', {
        class: 'btn-primary',
        onclick: () => {
          const api = $('#src-api-input').value.trim();
          if (api) SourceConfig.set({ apiBase: api });
          MinePage.refreshStats();
          Sheet.close();
          Toast.show('音源设置已保存', 1500);
        }
      }, '保存')
    ]);
    wrap.appendChild(actions);

    wrap.appendChild(el('div', {
      class: 'sheet-note',
      html: '默认使用开源音乐聚合接口（GD Studio music-api）的公共实例，不收费、不需要登录。<br>' +
        '七个音源都可以选。如果某个源在当前公共实例上没响应，搜索时会自动换到能用的源，不影响你搜歌。<br>' +
        '想用完整版音源，可以自己部署同一个开源项目，把上面地址换成你的实例。<br>' +
        '音质映射：标准 = 128kbps MP3，高品 = 320kbps MP3，无损 = FLAC 原版。'
    }));

    Sheet.open(wrap);
  },

  /* ----- 数据与备份 ----- */
  async data() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '数据与备份' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '收藏、下载、设置都存在本机，不上传任何服务器' }));

    const body = el('div', { style: { padding: '4px 18px 0' } });

    const info = el('div', {
      style: {
        padding: '14px 16px', borderRadius: '16px', marginBottom: '12px',
        background: 'var(--card)', fontSize: '12.5px', lineHeight: '2', color: 'var(--sub)'
      },
      text: '读取中…'
    });
    body.appendChild(info);

    try {
      const s = await Store$guard.summary();
      info.innerHTML = '';
      const row = (k, v) => el('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: '12px' }
      }, [
        el('span', { text: k }),
        el('span', { style: { color: 'var(--txt)', textAlign: 'right', wordBreak: 'break-all' }, text: v })
      ]);
      info.appendChild(row('数据位置', s.origin));
      info.appendChild(row('持久化', s.persisted ? '已开启 ✓' : '未开启'));
      info.appendChild(row('曲库', s.trackCount + ' 首（收藏 ' + s.favoriteCount + '）'));
      info.appendChild(row('已下载', s.downloadCount + ' 首 / ' + fmtSize(s.audioSize)));
      info.appendChild(row('占用空间', fmtSize(s.usage) + (s.quota ? ' / 可用 ' + fmtSize(s.quota) : '')));
    } catch (e) {
      info.textContent = '读取失败：' + (e.message || e);
    }

    body.appendChild(el('div', {
      class: 'sheet-note',
      style: { margin: '0 0 12px' },
      html: '数据按「地址」隔离存放。如果你换了一个网址打开（比如从 192.168.x.x 换成 127.0.0.1，' +
        '或更换了电脑 IP），看到的就是另一套空数据 —— 这不是丢失，是两套独立存储。<br>' +
        '建议固定用同一个地址访问，并定期导出备份。'
    }));

    const btnRow = el('div', { class: 'sheet-actions' });

    btnRow.appendChild(el('button', {
      class: 'btn-ghost',
      onclick: () => this.exportBackup()
    }, '导出备份'));

    btnRow.appendChild(el('button', {
      class: 'btn-ghost',
      onclick: () => this.importBackup()
    }, '恢复备份'));

    wrap.appendChild(body);
    wrap.appendChild(btnRow);

    wrap.appendChild(el('div', { class: 'sheet-actions' }, [
      el('button', { class: 'btn-primary', onclick: () => Sheet.close() }, '关闭')
    ]));

    Sheet.open(wrap);
  },

  /** 导出：收藏、曲目元数据、设置（不含音频文件本身，体积小） */
  async exportBackup() {
    try {
      const tracks = Store.all().map(t => ({
        id: t.id, sourceId: t.sourceId, sid: t.sid, urlId: t.urlId,
        picId: t.picId, lyricId: t.lyricId, nativeSource: t.nativeSource,
        title: t.title, artist: t.artist, album: t.album, cover: t.cover,
        duration: t.duration, favorite: t.favorite, favAt: t.favAt,
        downloaded: t.downloaded, downloadedQuality: t.downloadedQuality,
        createdAt: t.createdAt, lastPlayed: t.lastPlayed, playCount: t.playCount
      }));
      const data = {
        app: '寻音', version: 1, at: Date.now(),
        origin: location.origin,
        settings: Settings.all(),
        sourceConfig: SourceConfig.get(),
        profileName: Storage.get('profileName', ''),
        searchHistory: Storage.get('searchHistory', []),
        tracks
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'xunyin-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      Toast.show('已导出 ' + tracks.length + ' 首曲目信息', 2200);
    } catch (e) {
      Toast.show('导出失败：' + (e.message || e), 2400);
    }
  },

  /** 恢复 */
  importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (!data || data.app !== '寻音') throw new Error('不是寻音的备份文件');

        if (data.settings) Object.entries(data.settings).forEach(([k, v]) => Settings.set(k, v));
        if (data.sourceConfig) SourceConfig.set(data.sourceConfig);
        if (data.profileName) Storage.set('profileName', data.profileName);
        if (Array.isArray(data.searchHistory)) Storage.set('searchHistory', data.searchHistory);

        let n = 0;
        for (const t of (data.tracks || [])) {
          const old = Store.get(t.id);
          const merged = { ...(old || {}), ...t };
          Store.tracks.set(merged.id, merged);
          await DB.putTrack(merged);
          n++;
        }
        Bus.emit('library:changed');
        if (typeof Profile !== 'undefined') { await Profile.init(); }
        MinePage.refreshStats();
        Sheet.close();
        Toast.show('已恢复 ' + n + ' 首曲目与全部设置', 2600);
      } catch (e) {
        Toast.show('恢复失败：' + (e.message || e), 2600);
      }
    });
    input.click();
  },

  /* ----- 关于作者 ----- */
  author() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '关于作者' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '寻音 XunYin · v1.0.0' }));

    const body = el('div', { style: { padding: '4px 18px 0' } });

    /* 作者卡 */
    body.appendChild(el('div', {
      style: {
        padding: '20px 18px', borderRadius: '18px', marginBottom: '14px',
        background: 'linear-gradient(150deg,rgba(44,162,249,.16),rgba(106,92,255,.12))',
        border: '1px solid rgba(44,162,249,.22)', textAlign: 'center'
      }
    }, [
      el('div', {
        style: {
          width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto 12px',
          display: 'grid', placeItems: 'center',
          background: 'linear-gradient(140deg,#3aa8ff,#6a5cff)',
          boxShadow: '0 8px 22px rgba(44,162,249,.35),inset 0 1px 0 rgba(255,255,255,.35)'
        }
      }, icon('user')),
      el('div', { style: { fontSize: '19px', fontWeight: '800', letterSpacing: '.5px' }, text: '李江' }),
      el('div', { style: { fontSize: '12px', color: 'var(--sub)', marginTop: '4px' }, text: '寻音 作者' })
    ]));

    /* 介绍 */
    body.appendChild(el('div', {
      style: {
        padding: '15px 16px', borderRadius: '16px', marginBottom: '14px',
        background: 'var(--card)', fontSize: '13.5px', lineHeight: '1.9', color: 'var(--txt)'
      },
      html: '这是我用 <b style="color:var(--pri-l)">AI</b> 打造的软件。'
    }));

    /* 联系方式 */
    const contact = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '14px 16px', borderRadius: '16px', background: 'var(--card)'
      }
    }, [
      el('span', {
        class: 'mi ico-blue',
        style: { width: '36px', height: '36px', borderRadius: '11px', display: 'grid', placeItems: 'center', flex: '0 0 auto' }
      }, icon('share')),
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { style: { fontSize: '11.5px', color: 'var(--sub-2)' }, text: '联系作者 QQ' }),
        el('div', { style: { fontSize: '17px', fontWeight: '700', letterSpacing: '.5px' }, text: '3814766402' })
      ]),
      el('button', {
        class: 'chip',
        style: { padding: '6px 14px', fontSize: '12px' },
        onclick: async (e) => {
          const qq = '3814766402';
          try {
            await navigator.clipboard.writeText(qq);
            e.currentTarget.textContent = '已复制';
            Toast.show('QQ 号已复制', 1500);
            setTimeout(() => { try { e.currentTarget.textContent = '复制'; } catch { } }, 1600);
          } catch {
            Toast.show('QQ：' + qq, 2600);
          }
        }
      }, '复制')
    ]);
    body.appendChild(contact);

    body.appendChild(el('div', {
      class: 'sheet-note',
      style: { margin: '14px 2px 4px' },
      text: '有 bug、想法或者想定制，都可以加 QQ 找作者。这个 App 永久免费、无广告、不锁功能。'
    }));

    wrap.appendChild(body);

    wrap.appendChild(el('div', { class: 'sheet-actions' }, [
      el('button', { class: 'btn-primary', onclick: () => Sheet.close() }, '好的')
    ]));

    Sheet.open(wrap);
  },

  /* ----- 关于 ----- */
  about() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '寻音 XunYin' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: 'v1.0.0 · 本地优先 · 零广告 · 零订阅' }));

    const list = el('div', { class: 'sheet-list' });
    const rows = [
      ['heart', '收藏与下载', '下载的是原版音频文件，存在本机数据库，飞行模式也能听'],
      ['wave', '三档音质', '标准 128k / 高品 320k / 无损 FLAC，随时切换'],
      ['shield', '数据不出本机', '没有账号、没有服务器，收藏和文件只在你手机上'],
      ['folder', '本地导入', '支持 mp3 / flac / m4a / wav / ogg 导入管理']
    ];
    rows.forEach(([ico, t, d]) => {
      list.appendChild(el('div', { class: 'sheet-item' }, [
        el('span', { class: 'si-ico' }, icon(ico)),
        el('div', { class: 'si-body' }, [el('b', { text: t }), el('small', { text: d })])
      ]));
    });
    wrap.appendChild(list);

    wrap.appendChild(el('div', { class: 'sheet-actions' }, [
      el('button', {
        class: 'btn-ghost',
        onclick: async () => {
          const est = await DB.estimate();
          const blobs = await DB.allBlobs();
          const used = blobs.reduce((a, b) => a + (b.size || 0), 0);
          Toast.show('本地已存 ' + blobs.length + ' 个音频 · ' + fmtSize(used) +
            (est.quota ? ' / 可用空间 ' + fmtSize(est.quota) : ''), 3200);
        }
      }, '存储占用'),
      el('button', { class: 'btn-primary', onclick: () => Sheet.close() }, '好的')
    ]));

    Sheet.open(wrap);
  }
};
