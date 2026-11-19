// 题目图片统一渲染：[图:imgId] 标记 → <img>，点击放大。
// 依赖全局约定：题目带 images: [{id, file, alt}]，按当前题库 id 拼
// /api/bank_images/<bank_id>/<file>；导入预览等场景传 dataURL 映射对象。
(function (global) {
  'use strict';

  const IMG_RE = /\[图:([A-Za-z0-9_\-]+)\]/g;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function urlOf(img, bankId) {
    if (!img) return '';
    const file = img.file || img.url || img.src || img.data || '';
    if (!file) return '';
    if (/^(https?:|data:|blob:)/i.test(file)) return file;
    const bid = bankId == null ? '' : String(bankId);
    return '/api/bank_images/' + encodeURIComponent(bid) + '/' + encodeURIComponent(file);
  }

  // images：题目 images 数组，或 {imgId: dataURL/url} 映射对象
  function toMap(images) {
    const byId = {};
    if (Array.isArray(images)) {
      images.forEach((i) => { if (i && i.id) byId[i.id] = i; });
    } else if (images && typeof images === 'object') {
      Object.keys(images).forEach((k) => {
        const v = images[k];
        if (typeof v === 'string') byId[k] = { id: k, url: v };
        else if (v && typeof v === 'object') byId[k] = v.id ? v : Object.assign({ id: k }, v);
      });
    }
    return byId;
  }

  global.qimgRender = function (text, images, bankId) {
    const byId = toMap(images);
    const raw = String(text == null ? '' : text);
    let html = '';
    let last = 0;
    let m;
    IMG_RE.lastIndex = 0;
    while ((m = IMG_RE.exec(raw))) {
      html += esc(raw.slice(last, m.index));
      const img = byId[m[1]];
      const u = img ? urlOf(img, bankId) : '';
      if (u) {
        html += `<img class="qimg" src="${esc(u)}" alt="${esc(img.alt || '题目图片')}" loading="lazy">`;
      } else {
        html += esc(m[0]);
      }
      last = m.index + m[0].length;
    }
    html += esc(raw.slice(last));
    return html;
  };

  global.qimgStrip = function (text) {
    return String(text == null ? '' : text).replace(IMG_RE, '[图片]');
  };

  global.qimgStripId = function (text, imgId) {
    return String(text == null ? '' : text).replace(
      new RegExp('\\[图:' + String(imgId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'g'),
      ''
    );
  };

  global.qimgCount = function (text) {
    const m = String(text == null ? '' : text).match(IMG_RE);
    return m ? m.length : 0;
  };

  // 点击放大（事件委托，整个页面只挂一次）
  if (!global.__qimgLightboxBound) {
    global.__qimgLightboxBound = true;
    document.addEventListener('click', (e) => {
      const img = e.target && e.target.closest && e.target.closest('img.qimg');
      if (!img) return;
      const overlay = document.createElement('div');
      overlay.className = 'qimg-lightbox';
      const big = document.createElement('img');
      big.src = img.src;
      big.alt = img.alt || '';
      overlay.appendChild(big);
      overlay.addEventListener('click', () => overlay.remove());
      document.body.appendChild(overlay);
    });
  }
})(window);
