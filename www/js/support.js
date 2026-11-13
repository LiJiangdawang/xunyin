/* ============================================================
   support.js —— 赞赏入口（纯自愿，不锁定任何功能）
   ------------------------------------------------------------
   每次点开都正常显示收款码，底部只有一个「关闭」按钮。
   不记录"已赞赏过"状态，不做任何限制。
   ============================================================ */
'use strict';

const SUPPORT_ENABLED = true;
const SUPPORT_QR = 'img/qr-donate.jpg';   // 收款码图片

const Support = {
  get enabled() { return !!SUPPORT_ENABLED; },

  init() { return this; },

  open() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'sheet-title', text: '请我喝杯水' }));
    wrap.appendChild(el('div', {
      class: 'sheet-sub',
      text: '这个播放器是免费的 —— 没有广告，也不锁任何功能'
    }));

    const body = el('div', { style: { padding: '0 18px' } });

    body.appendChild(el('div', {
      style: {
        margin: '6px 0 14px', padding: '14px 16px', borderRadius: '16px',
        background: 'var(--card)', fontSize: '13px', lineHeight: '1.85', color: 'var(--sub)'
      },
      html: '写这个 App 花了不少时间。<br>' +
        '用着顺手的话，愿意可以请我喝杯水 —— <b style="color:var(--txt)">完全自愿，不给也照样全部功能可用</b>。'
    }));

    /* 收款码：每次都显示 */
    const qrBox = el('div', {
      style: {
        margin: '0 0 12px', padding: '14px', borderRadius: '16px',
        background: 'var(--card)', textAlign: 'center'
      }
    });

    const img = el('img', {
      src: SUPPORT_QR, alt: '收款码',
      style: { width: '100%', maxWidth: '300px', borderRadius: '14px', display: 'block', margin: '0 auto' }
    });
    img.onerror = () => {
      img.remove();
      qrBox.appendChild(el('div', {
        class: 'sheet-note',
        style: { margin: 0, textAlign: 'left' },
        text: '还没放收款码。把你的微信/支付宝收款码存成 www/img/qr-donate.jpg，重新构建后就会显示。'
      }));
    };
    qrBox.appendChild(img);
    body.appendChild(qrBox);

    wrap.appendChild(body);

    /* 只有关闭，没有"我喝到了" */
    const closeBtn = el('button', {
      class: 'btn-primary',
      onclick: () => Sheet.close()
    }, '关闭');

    wrap.appendChild(el('div', { class: 'sheet-actions' }, [closeBtn]));

    Sheet.open(wrap);
  }
};
