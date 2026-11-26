// 题图渲染与查看。
// 渲染：把题干/选项里的 [图:imgN] 标记替换为 <img class="qimg">（指向 /api/bank_images/<bank_id>/<file>）。
// 查看：桌面端（hover+精确指针）点击弹出可拖拽、可调大小的悬浮窗；
//       窗口自适应图片原始尺寸（超大图按视口收缩），缩放窗口即缩放图片，
//       位置全局记忆、尺寸按图片记忆（localStorage）。
//       触屏端保持全屏灯箱，点开即放大、点任意处关闭。
(function () {
  'use strict';

  var IMG_MARKER_RE = /\[图:([A-Za-z0-9_\-]+)\]/g;

  function buildImgTag(entry, bankId) {
    if (!entry || !entry.file) return '';
    var alt = (entry.alt || entry.id || '题目图片').replace(/"/g, '&quot;');
    return '<img class="qimg" loading="lazy" alt="' + alt + '" src="/api/bank_images/' +
      encodeURIComponent(bankId) + '/' + encodeURIComponent(entry.file) + '">';
  }

  window.qimgRender = function (text, images, bankId) {
    if (text == null) return '';
    var map = {};
    (images || []).forEach(function (e) { if (e && e.id) map[e.id] = e; });
    return String(text).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    }).replace(IMG_MARKER_RE, function (_, id) {
      return buildImgTag(map[id], bankId);
    });
  };

  // ---------- 触屏端：全屏灯箱 ----------

  function ensureLightbox() {
    var lb = document.querySelector('.qimg-lightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.className = 'qimg-lightbox';
    lb.innerHTML = '<img alt="">';
    lb.addEventListener('click', function () { lb.classList.remove('show'); }, true);
    document.body.appendChild(lb);
    return lb;
  }

  function showLightbox(src, alt) {
    var lb = ensureLightbox();
    var img = lb.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    lb.classList.add('show');
  }

  // ---------- 桌面端：可拖拽悬浮窗 ----------

  var FLOAT_KEY = 'qimgFloatBox';
  var suppressSave = false; // 打开/自适应窗口尺寸会触发 ResizeObserver，抑制误保存
  var curSrc = '';          // 当前展示的图片，尺寸按图片分别记忆

  var FLOAT_CSS = [
    '.qimg-float{position:fixed;z-index:9999;display:none;flex-direction:column;',
    'min-width:200px;min-height:140px;max-width:94vw;max-height:88vh;',
    'background:var(--card,#fff);border:1px solid var(--border-fine,#ddd);',
    'border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.24);overflow:hidden;resize:both}',
    '.qimg-float.show{display:flex}',
    '.qimg-float-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;',
    'padding:6px 8px 6px 12px;background:var(--bg,#f5f5f5);cursor:move;user-select:none;touch-action:none}',
    '.qimg-float-title{font-size:12px;color:var(--muted,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.qimg-float-close{border:none;background:transparent;color:var(--muted,#888);font-size:16px;',
    'line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px;flex:none}',
    '.qimg-float-close:hover{color:var(--red,#d33)}',
    '.qimg-float-body{flex:1;min-height:0;min-width:0;overflow:hidden}',
    '.qimg-float-body img{width:100%;height:100%;object-fit:contain;display:block}',
  ].join('');

  // 状态结构：{ x, y, sizes: { <src>: {w,h} } }；旧版 {x,y,w,h} 自动迁移
  function loadFloatState() {
    var st = null;
    try { st = JSON.parse(localStorage.getItem(FLOAT_KEY) || 'null'); } catch (err) { st = null; }
    if (!st || typeof st !== 'object') st = {};
    if (!st.sizes || typeof st.sizes !== 'object') st.sizes = {};
    return st;
  }

  function saveFloatState(box) {
    if (suppressSave) return;
    try {
      var r = box.getBoundingClientRect();
      var st = loadFloatState();
      st.x = r.left;
      st.y = r.top;
      if (curSrc) {
        delete st.sizes[curSrc];
        st.sizes[curSrc] = { w: r.width, h: r.height };
        var keys = Object.keys(st.sizes);
        if (keys.length > 60) {
          keys.slice(0, keys.length - 60).forEach(function (k) { delete st.sizes[k]; });
        }
      }
      localStorage.setItem(FLOAT_KEY, JSON.stringify(st));
    } catch (err) { /* 隐私模式等存储失败可忽略 */ }
  }

  function hideFloatBox() {
    var box = document.querySelector('.qimg-float');
    if (box) box.classList.remove('show');
  }

  function getFloatBox() {
    var box = document.querySelector('.qimg-float');
    if (box) return box;

    var style = document.createElement('style');
    style.textContent = FLOAT_CSS;
    document.head.appendChild(style);

    box = document.createElement('div');
    box.className = 'qimg-float';
    box.innerHTML =
      '<div class="qimg-float-head"><span class="qimg-float-title"></span>' +
      '<button type="button" class="qimg-float-close" title="关闭 (Esc)">×</button></div>' +
      '<div class="qimg-float-body"><img alt=""></div>';
    document.body.appendChild(box);

    var head = box.querySelector('.qimg-float-head');
    var closeBtn = box.querySelector('.qimg-float-close');

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hideFloatBox();
    });

    // 标题栏拖动（指针捕获，拖完保存位置）。
    // 注意：× 按钮在标题栏内，必须放行它的事件，否则指针捕获会劫走 click 导致关不掉。
    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target === closeBtn || (e.target.closest && e.target.closest('.qimg-float-close'))) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      var rect = box.getBoundingClientRect();
      var offX = e.clientX - rect.left;
      var offY = e.clientY - rect.top;
      var move = function (ev) {
        var x = Math.min(Math.max(ev.clientX - offX, 0), window.innerWidth - 80);
        var y = Math.min(Math.max(ev.clientY - offY, 0), window.innerHeight - 40);
        box.style.left = x + 'px';
        box.style.top = y + 'px';
      };
      var up = function () {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        saveFloatState(box);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });

    // 右下角拖拽调大小（resize:both），尺寸按当前图片保存
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (box.classList.contains('show')) saveFloatState(box);
      }).observe(box);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideFloatBox();
    });

    return box;
  }

  function viewportMax() {
    return {
      w: Math.min(window.innerWidth * 0.92, 1400),
      h: window.innerHeight * 0.88,
    };
  }

  // 位置钳制：与拖动约束一致——允许窗口部分出屏，但至少留 80×40 可见，
  // 否则拖到过的位置在重开时会被 stricter 的视口钳制“拉回”。
  function clampPos(x, y) {
    x = Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - 80));
    y = Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - 40));
    return { x: x, y: y };
  }

  // 应用位置/尺寸并抑制本轮误保存（两帧后解除）
  function applyBox(box, x, y, w, h) {
    var max = viewportMax();
    w = Math.min(Math.max(w, 200), max.w);
    h = Math.min(Math.max(h, 140), max.h);
    var p = clampPos(x, y);
    suppressSave = true;
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    box.style.left = p.x + 'px';
    box.style.top = p.y + 'px';
    box.classList.add('show');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { suppressSave = false; });
    });
  }

  // 按图片原始尺寸自适应窗口（边框+内边距≈18px，标题栏实测）
  function fitToImage(box) {
    var img = box.querySelector('img');
    var fit = function () {
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (!nw || !nh) return;
      var headH = box.querySelector('.qimg-float-head').offsetHeight || 30;
      var r = box.getBoundingClientRect();
      applyBox(box, r.left, r.top, nw + 18, nh + headH + 18);
    };
    if (img.complete && img.naturalWidth) {
      requestAnimationFrame(fit);
    } else {
      img.addEventListener('load', fit, { once: true });
    }
  }

  function showFloatBox(src, alt) {
    var box = getFloatBox();
    var shown = box.classList.contains('show');
    curSrc = src;
    var img = box.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    box.querySelector('.qimg-float-title').textContent = alt || '题目图片';

    var st = loadFloatState();
    var saved = st.sizes[src];
    var hasSaved = !!(saved && saved.w > 120 && saved.h > 100);
    var r = shown ? box.getBoundingClientRect() : null;

    if (hasSaved) {
      // 这张图有记忆尺寸：直接套用（已开着换图时保持当前位置）
      var x = r ? r.left : (typeof st.x === 'number' ? st.x : (window.innerWidth - saved.w) / 2);
      var y = r ? r.top : (typeof st.y === 'number' ? st.y : Math.max(12, window.innerHeight * 0.08));
      applyBox(box, x, y, saved.w, saved.h);
    } else if (shown) {
      fitToImage(box); // 已开着换图且无记忆尺寸：按新图自适应
    } else {
      // 首次看这张图：先给个临时尺寸，图片加载完按原始尺寸自适应
      applyBox(box, (window.innerWidth - 480) / 2, Math.max(12, window.innerHeight * 0.08), 480, 360);
      fitToImage(box);
    }
  }

  // ---------- 入口 ----------

  function isDesktop() {
    return !!(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches);
  }

  document.addEventListener('click', function (e) {
    var img = e.target && e.target.closest ? e.target.closest('img.qimg') : null;
    if (!img) return;
    e.preventDefault();
    if (isDesktop()) showFloatBox(img.src, img.alt);
    else showLightbox(img.src, img.alt);
  });
})();
