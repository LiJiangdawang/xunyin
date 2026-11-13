/* ============================================================
   profile.js —— 个人资料：头像 + 昵称
   ------------------------------------------------------------
   全部存本机（localStorage + IndexedDB），不上传任何地方。
   头像会被裁剪成正方形并压到 320px，避免占空间。
   ============================================================ */
'use strict';

const Profile = {
  defaults: { name: '寻音听歌的人' },
  name: '',
  avatar: '',       // blob URL
  _avatarBlob: null,

  async init() {
    this.name = Storage.get('profileName', this.defaults.name) || this.defaults.name;
    await this.loadAvatar();
    this.paint();
    Bus.on('profile:changed', () => this.paint());
    return this;
  },

  async loadAvatar() {
    try {
      const rec = await DB.getProfileAvatar();
      if (rec && rec.blob) {
        this._avatarBlob = rec.blob;
        if (this.avatar) URL.revokeObjectURL(this.avatar);
        this.avatar = URL.createObjectURL(rec.blob);
      }
    } catch (e) {
      console.warn('[profile] 头像读取失败', e);
    }
  },

  /* ---------------- 绘制 ---------------- */
  paint() {
    const box = $('#profile-avatar');
    if (box) {
      box.innerHTML = '';
      if (this.avatar) {
        const img = el('img', { src: this.avatar, alt: '' });
        box.appendChild(img);
        box.classList.add('has-img');
      } else {
        box.appendChild(icon('user'));
        box.classList.remove('has-img');
      }
    }
    const nameNode = $('#profile-name');
    if (nameNode) nameNode.textContent = this.name;
  },

  /* ---------------- 编辑面板 ---------------- */
  openEditor() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '编辑个人资料' }));
    wrap.appendChild(el('div', { class: 'sheet-sub', text: '只保存在本机，不会上传到任何服务器' }));

    const body = el('div', { style: { padding: '6px 18px 0' } });

    /* 头像 + 换一张 */
    const avatarWrap = el('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', margin: '4px 0 18px' }
    });
    const bigAvatar = el('div', { class: 'editor-avatar' });
    if (this.avatar) bigAvatar.appendChild(el('img', { src: this.avatar, alt: '' }));
    else bigAvatar.appendChild(icon('user'));
    avatarWrap.appendChild(bigAvatar);

    const btnRow = el('div', { style: { display: 'flex', gap: '10px' } });
    const pickBtn = el('button', { class: 'chip', style: { padding: '7px 16px' }, text: '从相册选一张' });
    const clearBtn = el('button', {
      class: 'chip',
      style: { padding: '7px 16px' },
      text: this.avatar ? '恢复默认' : '默认头像'
    });
    clearBtn.disabled = !this.avatar;
    if (!this.avatar) clearBtn.style.opacity = '.4';

    pickBtn.addEventListener('click', () => this.pickImage(async (blob, url) => {
      bigAvatar.innerHTML = '';
      bigAvatar.appendChild(el('img', { src: url, alt: '' }));
      clearBtn.disabled = false;
      clearBtn.style.opacity = '1';
      clearBtn.textContent = '恢复默认';
      await this.setAvatar(blob);
    }));

    clearBtn.addEventListener('click', async () => {
      await this.clearAvatar();
      bigAvatar.innerHTML = '';
      bigAvatar.appendChild(icon('user'));
      clearBtn.disabled = true;
      clearBtn.style.opacity = '.4';
      clearBtn.textContent = '默认头像';
    });

    btnRow.appendChild(pickBtn);
    btnRow.appendChild(clearBtn);
    avatarWrap.appendChild(btnRow);
    body.appendChild(avatarWrap);

    /* 昵称 */
    body.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--sub-2)', margin: '0 0 8px 2px' }, text: '昵称'
    }));
    const input = el('input', {
      class: 'profile-input',
      type: 'text',
      maxlength: '20',
      placeholder: '给自己起个名字',
      value: this.name
    });
    body.appendChild(input);
    body.appendChild(el('div', {
      style: { fontSize: '11px', color: 'var(--sub-2)', margin: '8px 2px 0', text: '最多 20 个字' }
    }));

    wrap.appendChild(body);

    const saveBtn = el('button', {
      class: 'btn-primary',
      /* 用 onpointerup 之外的 click 且显式 preventDefault，避免输入法"确定"键
         与按钮 click 双重触发；同时在闭包里先取值班再关面板 */
      onclick: (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const v = String(input.value || '').trim().slice(0, 20);
        /* 同步保存，不依赖 Promise，保证点了立刻生效 */
        this.setNameSync(v || this.defaults.name);
        try { input.blur(); } catch { }
        Sheet.close();
        Toast.show('已保存：' + this.name, 1600);
      }
    }, '保存');
    const cancelBtn = el('button', {
      class: 'btn-ghost',
      onclick: () => { try { input.blur(); } catch { } Sheet.close(); this.paint(); }
    }, '取消');

    wrap.appendChild(el('div', { class: 'sheet-actions' }, [cancelBtn, saveBtn]));
    this._sheetInput = input;
    Sheet.open(wrap, { onDismiss: () => { this._sheetInput = null; } });

    /* 移动端：不自动聚焦，避免键盘立刻顶起把保存按钮挤出视口 */
    this.bindSheetKeyboard(input, saveBtn);
  },

  /** 记住当前弹层输入框，供安卓返回键/键盘收起时读值 */
  _sheetInput: null,

  /** 输入框回车直接保存；键盘弹起时把按钮滚进可视区 */
  bindSheetKeyboard(input, saveBtn) {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        try { input.blur(); } catch { }
        saveBtn.click();
      }
    });
    /* 键盘弹起后把操作区滚到可见位置（iOS/安卓都会触发 resize） */
    const ensureVisible = () => {
      setTimeout(() => {
        try { saveBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { }
      }, 260);
    };
    input.addEventListener('focus', ensureVisible);
    window.addEventListener('resize', ensureVisible, { once: true });
  },

  /** 同步版本：手机端保存失败时用于兜底 */
  setNameSync(name) {
    this.name = String(name || '').slice(0, 20) || this.defaults.name;
    try { Storage.set('profileName', this.name); } catch { }
    try { this.paint(); } catch { }
    try { Bus.emit('profile:changed'); } catch { }
    return this.name;
  },

  /* ---------------- 选图 + 裁剪压缩 ---------------- */
  pickImage(onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    /* 关键：不能用 display:none —— Android WebView 与部分 iOS 上，
       display:none 的 file input 调用 click() 不会唤起选择器。
       改成"存在但不可见"，并贴在屏幕内，保证能被点击授权。 */
    input.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;' +
      'border:0;padding:0;margin:0;z-index:-1;pointer-events:none;';
    document.body.appendChild(input);

    const cleanup = () => { try { input.remove(); } catch { } };

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { cleanup(); return; }
      if (file.type && !/^image\//.test(file.type)) {
        Toast.show('请选择图片文件', 1800);
        cleanup();
        return;
      }
      try {
        Toast.show('正在处理图片…', 1200);
        const blob = await this.squarify(file);
        const url = URL.createObjectURL(blob);
        onDone(blob, url);
      } catch (e) {
        console.warn('[profile] squarify failed', e);
        Toast.show('图片处理失败，换一张试试', 2000);
      } finally {
        cleanup();
      }
    });

    /* 原生壳里由 Java 端 onShowFileChooser 接管；网页端走浏览器默认 */
    try {
      input.click();
    } catch (e) {
      console.warn('[profile] input.click error', e);
      cleanup();
      Toast.show('无法打开相册，请重试', 2000);
    }
  },

  /** 居中裁剪成正方形并压到 320px */
  squarify(file, size = 320) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          URL.revokeObjectURL(url);
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 失败')), 'image/jpeg', 0.9);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
      img.src = url;
    });
  },

  /* ---------------- 保存 ---------------- */
  async setAvatar(blob) {
    await DB.putProfileAvatar(blob);
    if (this.avatar) URL.revokeObjectURL(this.avatar);
    this._avatarBlob = blob;
    this.avatar = URL.createObjectURL(blob);
    this.paint();
    Bus.emit('profile:changed');
  },

  async clearAvatar() {
    await DB.delProfileAvatar();
    if (this.avatar) { URL.revokeObjectURL(this.avatar); this.avatar = ''; }
    this._avatarBlob = null;
    this.paint();
    Bus.emit('profile:changed');
    Toast.show('已恢复默认头像', 1400);
  },

  async setName(name) {
    this.name = String(name || '').slice(0, 20) || this.defaults.name;
    Storage.set('profileName', this.name);
    this.paint();
    Bus.emit('profile:changed');
    return this.name;
  }
};
