(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(url, opts) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: {
        ...(opts && opts.headers ? opts.headers : {}),
      },
    });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('未登录');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data && data.ok === false) return data;
    return data;
  }

  /* ==================== 列表页 ==================== */

  if (document.body.classList.contains('reading-page')) {
    const listEl = $('readingTextList');

    function setNewHint(msg, isErr) {
      const el = $('newTextHint');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('is-err', !!isErr);
    }

    async function loadTexts() {
      listEl.textContent = '加载中…';
      try {
        const res = await api('/api/reading/texts');
        if (!res.ok) {
          listEl.textContent = res.error || '加载失败';
          return;
        }
        const items = res.items || [];
        if (!items.length) {
          listEl.innerHTML = '<p class="reading-empty">还没有文章。点右上「新建文章」，粘贴一篇真题阅读开始。</p>';
          return;
        }
        listEl.innerHTML = items.map((t) => (
          `<div class="reading-text-item" data-id="${escapeHtml(t.id)}">
            <div class="reading-text-main">
              <a class="reading-text-title" href="/reading/${encodeURIComponent(t.id)}">${escapeHtml(t.title || '无标题')}</a>
              <span class="reading-text-source">${escapeHtml(t.source || '')}</span>
              <span class="reading-text-time">${escapeHtml(t.created_at || '')}</span>
            </div>
            <div class="reading-text-actions">
              <a class="btn ghost" href="/reading/${encodeURIComponent(t.id)}">阅读</a>
              <button type="button" class="btn ghost reading-text-del">删除</button>
            </div>
          </div>`
        )).join('');
      } catch (err) {
        listEl.textContent = '网络错误';
      }
    }

    listEl.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.reading-text-del');
      if (!btn) return;
      const item = btn.closest('.reading-text-item');
      if (!item || !window.confirm('删除这篇文章？相关查词记录会一并清除。')) return;
      btn.disabled = true;
      try {
        const res = await api(`/api/reading/texts/${encodeURIComponent(item.dataset.id)}/delete`, { method: 'POST' });
        if (!res.ok) {
          window.alert(res.error || '删除失败');
          btn.disabled = false;
          return;
        }
        await loadTexts();
      } catch (err) {
        btn.disabled = false;
      }
    });

    $('newTextBtn').addEventListener('click', () => {
      const panel = $('newTextPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('newTitle').focus();
    });
    $('newTextCancel').addEventListener('click', () => {
      $('newTextPanel').hidden = true;
      setNewHint('');
    });

    $('newTextForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      setNewHint('');
      const btn = $('newTextSubmit');
      btn.disabled = true;
      try {
        const res = await api('/api/reading/texts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: $('newTitle').value,
            source: $('newSource').value,
            content: $('newContent').value,
          }),
        });
        if (!res.ok) {
          setNewHint(res.error || '保存失败', true);
          return;
        }
        window.location.href = `/reading/${encodeURIComponent(res.item.id)}`;
      } catch (err) {
        setNewHint(err.message || '网络错误', true);
      } finally {
        btn.disabled = false;
      }
    });

    // ---- 导入实时分段预览（所见即所得，与保存走同一后端分段器） ----
    const previewBox = $('newTextPreview');
    const previewBody = $('newTextPreviewBody');
    const previewCount = $('newTextPreviewCount');
    let previewTimer = null;
    let previewSeq = 0;

    async function runPreview() {
      const my = ++previewSeq;
      try {
        const res = await api('/api/reading/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: $('newContent').value }),
        });
        if (my !== previewSeq || !res.ok) return;
        const ps = res.paragraphs || [];
        previewCount.textContent = ps.length ? `共 ${ps.length} 段` : '正文为空';
        previewBody.innerHTML = ps.map((p) => `<p class="reading-p">${escapeHtml(p)}</p>`).join('');
        previewBox.hidden = false;
      } catch (err) { /* 预览失败静默，不阻塞录入 */ }
    }

    $('newContent').addEventListener('input', () => {
      clearTimeout(previewTimer);
      if (!$('newContent').value.trim()) {
        previewBox.hidden = true;
        return;
      }
      previewTimer = setTimeout(runPreview, 400);
    });

    loadTexts();
    return;
  }

  /* ==================== 阅读页：划词查词 ==================== */

  const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'phr.', 'other'];
  const article = $('readingArticle');
  const body = document.body;
  const textId = body.dataset.textId || '';
  const source = body.dataset.source || '';

  let bubble = null;
  let card = null;
  let seq = 0;             // 请求序号：只认最后一次
  let savedRange = null;   // 气泡打开时的选区，存词后用于加下划线

  // 进入页面即恢复已查词标记（后端注入 window.RD_MARKS，持久于刷新）
  markLookuped(article);

  function setHint(msg, isErr) {
    const el = $('readingHint');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-err', !!isErr);
  }

  function dismissBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
  }

  function dismissCard() {
    if (card) { card.remove(); card = null; }
  }

  /** 划词有效区：正文 + 题目卡片/全部题目列表（做题时也能查题干生词）。 */
  function inReadArea(node) {
    if (!node) return false;
    return article.contains(node)
      || !!(node.nodeType === 1 ? node : node.parentElement)?.closest?.('.rd-qcard-body, .rd-qall-body');
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (!inReadArea(sel.anchorNode) || !inReadArea(sel.focusNode)) return null;
    const words = text.split(' ').filter(Boolean).length;
    return { sel, text, words };
  }

  function paragraphOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest('.reading-p, .rd-q-p') : null;
  }

  /** 句界规则：默认句点（.）结尾为完整一句，问号/叹号兜底；向两侧扩展到句界或段落边界。 */
  function extractSentence(selText) {
    const sel = window.getSelection();
    const para = paragraphOf(sel.anchorNode);
    if (!para) return selText;
    const paraText = para.textContent;
    const idx = paraText.indexOf(selText);
    if (idx < 0) return paraText.trim();
    let s = idx;
    while (s > 0) {
      const ch = paraText[s - 1];
      if (ch === '.' || ch === '?' || ch === '!') break;
      s--;
    }
    while (s < idx && /\s/.test(paraText[s])) s++;
    let e = idx + selText.length;
    while (e < paraText.length) {
      const ch = paraText[e];
      e++;
      if (ch === '.' || ch === '?' || ch === '!') break;
    }
    return paraText.slice(s, e).trim();
  }

  function showBubble(info) {
    dismissBubble();
    dismissCard();
    const rect = info.sel.getRangeAt(0).getBoundingClientRect();
    const isLookup = info.words <= 5;
    bubble = document.createElement('div');
    bubble.className = 'rd-bubble';
    bubble.innerHTML = `
      <button type="button" class="btn rd-bubble-btn rd-btn-lookup ${isLookup ? 'rd-btn-primary' : ''}">查词</button>
      <button type="button" class="btn ghost rd-bubble-btn rd-btn-translate ${isLookup ? '' : 'rd-btn-primary'}">翻译</button>
    `;
    document.body.appendChild(bubble);
    const bw = bubble.offsetWidth;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.bottom + 8;
    if (top + bubble.offsetHeight > window.innerHeight - 8) top = rect.top - bubble.offsetHeight - 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;

    bubble.querySelector('.rd-btn-lookup').addEventListener('click', () => runLookup('lookup', info));
    bubble.querySelector('.rd-btn-translate').addEventListener('click', () => runLookup('translate', info));
  }

  function bubbleLoading(mode) {
    if (!bubble) return;
    bubble.querySelectorAll('.rd-bubble-btn').forEach((b) => { b.disabled = true; });
    const mark = bubble.querySelector('.rd-bubble-state');
    if (!mark) {
      const s = document.createElement('span');
      s.className = 'rd-bubble-state';
      bubble.appendChild(s);
    }
    bubble.querySelector('.rd-bubble-state').textContent = mode === 'translate' ? '翻译中…' : '查询中…';
    bubble.classList.add('is-loading'); // CSS 转圈动画，让等待可见
  }

  function bubbleLoaded() {
    if (bubble) bubble.classList.remove('is-loading');
  }

  function bubbleTranslateResult(zh, isErr, errMsg) {
    if (!bubble) return;
    bubble.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'rd-bubble-zh' + (isErr ? ' is-err' : '');
    box.textContent = isErr ? (errMsg || '翻译失败') : zh;
    bubble.appendChild(box);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn ghost rd-bubble-close';
    close.textContent = '关闭';
    close.addEventListener('click', dismissBubble);
    bubble.appendChild(close);
  }

  async function runLookup(mode, info) {
    const mySeq = ++seq;
    bubbleLoading(mode);
    const sentence = extractSentence(info.text);
    savedRange = info.sel.getRangeAt(0).cloneRange();
    const pos = mode === 'lookup' ? positionOfSelection(info.sel, info.text) : null;
    try {
      const res = await api('/api/reading/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_id: textId,
          selection: info.text,
          sentence,
          mode,
          para_index: pos && pos.area === 'body' ? pos.paraIndex : null,
          occur_index: pos ? pos.occurIndex : null,
          q_num: pos && pos.area === 'q' ? pos.qNum : '',
          q_para_index: pos && pos.area === 'q' ? pos.qParaIndex : null,
        }),
      });
      if (mySeq !== seq) return; // 已有更新的查询，丢弃旧响应
      bubbleLoaded();
      if (mode === 'translate') {
        if (!res.ok) {
          bubbleTranslateResult('', true, res.error);
          return;
        }
        bubbleTranslateResult(res.zh || '');
        return;
      }
      lookupId = res.ok ? (res.lookup_id || null) : null;
      const draft = res.ok ? (res.draft || {}) : {};
      if (res.ok) {
        // 查词成功即标记查词时的那一处，释义悬浮可看
        lastSelText = info.text;
        addMark(info.text, draft.meaning || '', false, pos);
        markLookuped(pos && pos.area === 'q' ? $('rdQCardBody') : article);
      }
      openCard(info, sentence, draft, res.ok ? '' : (res.error || ''));
    } catch (err) {
      if (mySeq !== seq) return;
      bubbleLoaded();
      if (mode === 'translate') {
        bubbleTranslateResult('', true, err.message);
      } else {
        lookupId = null;
        openCard(info, sentence, {}, err.message || '网络错误');
      }
    }
  }

  function openCard(info, sentence, draft, errMsg) {
    dismissBubble();
    dismissCard();
    card = document.createElement('div');
    card.className = 'rd-card';
    card.innerHTML = `
      <div class="rd-card-grip" title="按住拖动">⠿</div>
      ${errMsg ? `<p class="rd-card-err">${escapeHtml(errMsg)}</p>` : ''}
      <div class="rd-card-row">
        <label class="reading-label" for="rdWord">词头</label>
        <div class="rd-wordline">
          <input id="rdWord" type="text" maxlength="80" value="${escapeHtml(draft.head || info.text)}">
          <select id="rdPos" class="rd-pos">${POS_OPTIONS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
        </div>
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdMeaning">语境义 <span class="opt">此句中的意思，可改</span></label>
        <input id="rdMeaning" type="text" maxlength="300" value="${escapeHtml(draft.meaning || '')}">
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdExEn">例句 <span class="opt">来自原文，可改</span></label>
        <textarea id="rdExEn" rows="3">${escapeHtml(sentence)}</textarea>
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdExZh">例句翻译</label>
        <textarea id="rdExZh" rows="2">${escapeHtml(draft.example_zh || '')}</textarea>
      </div>
      <div class="rd-card-row">
        <label class="reading-label">来源</label>
        <input type="text" class="rd-source" value="${escapeHtml(source)}" readonly>
      </div>
      <div class="rd-card-actions">
        <span class="reading-hint" id="rdCardHint"></span>
        <button type="button" class="btn ghost" id="rdCardCancel">取消</button>
        <button type="button" class="btn" id="rdCardSave">存入资产库</button>
      </div>
    `;
    document.body.appendChild(card);
    const pos = draft.pos || 'other';
    const posSel = card.querySelector('#rdPos');
    if (POS_OPTIONS.indexOf(pos) >= 0) posSel.value = pos;

    // 定位：选区下方，视口边缘收敛
    const rect = savedRange ? savedRange.getBoundingClientRect() : { left: 40, top: 80, width: 0, bottom: 80 };
    let left = Math.max(8, Math.min(rect.left, window.innerWidth - card.offsetWidth - 8));
    let top = rect.bottom + 10;
    if (top + card.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - card.offsetHeight - 8);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    // 卡片可拖动：grip 手柄（pointer capture）
    const grip = card.querySelector('.rd-card-grip');
    let cardDrag = null;
    grip.addEventListener('pointerdown', (ev) => {
      const r = card.getBoundingClientRect();
      cardDrag = { x: ev.clientX, y: ev.clientY, left: r.left, top: r.top };
      grip.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    grip.addEventListener('pointermove', (ev) => {
      if (!cardDrag) return;
      card.style.left = `${Math.max(0, Math.min(cardDrag.left + ev.clientX - cardDrag.x, window.innerWidth - 80))}px`;
      card.style.top = `${Math.max(0, Math.min(cardDrag.top + ev.clientY - cardDrag.y, window.innerHeight - 40))}px`;
    });
    const endGripDrag = () => { cardDrag = null; };
    grip.addEventListener('pointerup', endGripDrag);
    grip.addEventListener('pointercancel', endGripDrag);

    card.querySelector('#rdCardCancel').addEventListener('click', dismissCard);
    card.querySelector('#rdCardSave').addEventListener('click', () => saveCard());
    card.querySelector('#rdMeaning').focus();
  }

  let lookupId = null; // 最近一次查词的记录 id，存词成功后回写 imported
  let lastSelText = ''; // 最近一次查词的原始选中文本（存词后标记用）

  async function saveCard() {
    const word = card.querySelector('#rdWord').value.trim();
    const pos = card.querySelector('#rdPos').value;
    const meaning = card.querySelector('#rdMeaning').value.trim();
    const exEn = card.querySelector('#rdExEn').value.trim();
    const exZh = card.querySelector('#rdExZh').value.trim();
    const hint = card.querySelector('#rdCardHint');
    if (!word) {
      hint.textContent = '词头必填';
      hint.classList.add('is-err');
      return;
    }
    const btn = card.querySelector('#rdCardSave');
    btn.disabled = true;
    hint.textContent = '保存中…';
    hint.classList.remove('is-err');
    try {
      const examples = exEn ? (exZh ? `${exEn}||${exZh}` : exEn) : '';
      const res = await api('/api/assets/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          senses: [{ pos, meaning, examples, source }],
        }),
      });
      if (!res.ok) {
        hint.textContent = res.error || '保存失败';
        hint.classList.add('is-err');
        btn.disabled = false;
        return;
      }
      const syncedN = Number(res.synced_examples || 0);
      setHint(`「${res.entry.word}」已存入资产库${syncedN ? `（自动同步 ${syncedN} 条相关例句）` : ''}。`);
      if (lookupId) {
        api(`/api/reading/lookup/${encodeURIComponent(lookupId)}/imported`, { method: 'POST' }).catch(() => {});
      }
      decorateSaved();
      // 标记升级为已入库（保存时的释义悬浮可看）；不再全文重复标注
      addMark(lastSelText, meaning, true);
      const savedEl = article.querySelector('.rd-saved:last-of-type');
      if (savedEl) {
        savedEl.classList.add('rd-mark', 'rd-mark-imported');
        if (meaning) savedEl.setAttribute('data-gloss', meaning);
      }
      dismissCard();
    } catch (err) {
      hint.textContent = err.message || '网络错误';
      hint.classList.add('is-err');
      btn.disabled = false;
    }
  }

  function decorateSaved() {
    if (!savedRange) return;
    try {
      const span = document.createElement('span');
      span.className = 'rd-saved';
      savedRange.surroundContents(span);
    } catch (e) { /* 跨节点选区，跳过装饰 */
    } finally {
      savedRange = null;
    }
  }

  // ---- 已查词持久标记：只标记查词时的那一处（按 lookup 记录的位置信息） ----
  function addMark(selection, gloss, imported, pos) {
    const sel = String(selection || '').trim();
    if (!sel) return;
    const marks = window.RD_MARKS || (window.RD_MARKS = []);
    const found = marks.find((m) => String(m.selection || '').trim().toLowerCase() === sel.toLowerCase());
    const fields = pos ? {
      para_index: (pos.area === 'body') ? pos.paraIndex : null,
      occur_index: pos ? pos.occurIndex : null,
      q_num: (pos.area === 'q') ? pos.qNum : '',
      q_para_index: (pos.area === 'q') ? pos.qParaIndex : null,
    } : {};
    if (found) {
      if (gloss) found.gloss = gloss;
      if (imported) found.imported = true;
      Object.assign(found, fields);
    } else {
      marks.push(Object.assign({
        selection: sel, gloss: gloss || '', imported: !!imported,
        para_index: null, occur_index: null, q_num: '', q_para_index: null,
      }, fields));
    }
  }

  /** 计算选区位置：正文 {area:'body', paraIndex, occurIndex}
   *  题目 {area:'q', qNum, qParaIndex, occurIndex}；无法定位返回 null。 */
  function positionOfSelection(sel, selText) {
    try {
      const para = paragraphOf(sel.anchorNode);
      if (!para) return null;
      const occurIndex = (() => {
        const r = sel.getRangeAt(0);
        const pre = document.createRange();
        pre.selectNodeContents(para);
        pre.setEnd(r.startContainer, r.startOffset);
        const needle = selText.toLowerCase();
        const hay = pre.toString().toLowerCase();
        let idx = 0;
        let count = 0;
        while ((idx = hay.indexOf(needle, idx)) !== -1) {
          count++;
          idx += needle.length;
        }
        return count;
      })();
      if (para.classList.contains('rd-q-p')) {
        const section = para.closest('.rd-q');
        const qNum = String((section && section.getAttribute('data-num')) || '').trim();
        if (!qNum) return null;
        const qParaIndex = Array.prototype.indexOf.call(section.querySelectorAll('.rd-q-p'), para);
        if (qParaIndex < 0) return null;
        return { area: 'q', qNum, qParaIndex, occurIndex };
      }
      if (!article.contains(para)) return null;
      const paraIndex = Array.prototype.indexOf.call(article.children, para);
      if (paraIndex < 0) return null;
      return { area: 'body', paraIndex, occurIndex };
    } catch (e) {
      return null;
    }
  }

  /** 在段落内把第 occurIndex 次出现（0 起，大小写不敏感）包进标记 span。 */
  function wrapOccurrence(para, selText, occurIndex, imported, gloss) {
    const texts = [];
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest('.rd-mark, .rd-saved')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) texts.push(walker.currentNode);
    const needle = selText.toLowerCase();
    let remaining = occurIndex;
    for (const node of texts) {
      const hay = node.nodeValue.toLowerCase();
      let idx = 0;
      while ((idx = hay.indexOf(needle, idx)) !== -1) {
        if (remaining === 0) {
          const span = document.createElement('span');
          span.className = 'rd-mark' + (imported ? ' rd-mark-imported' : '');
          if (gloss) span.setAttribute('data-gloss', gloss);
          const tail = node.splitText(idx + needle.length);
          const mid = node.splitText(idx);
          mid.parentNode.insertBefore(span, tail);
          span.appendChild(mid);
          return true;
        }
        remaining--;
        idx += needle.length;
      }
    }
    return false;
  }

  function markLookuped(root) {
    const marks = window.RD_MARKS || [];
    if (!marks.length || !root) return;
    if (root === article) {
      // 正文：按段序号定位
      for (const m of marks) {
        if (typeof m.para_index !== 'number' || typeof m.occur_index !== 'number') continue;
        const para = article.children[m.para_index];
        if (para) wrapOccurrence(para, String(m.selection || '').trim(),
                                 m.occur_index, !!m.imported, String(m.gloss || ''));
      }
      return;
    }
    // 题目区（卡片/全部）：按题号+题内段序号定位
    for (const m of marks) {
      if (typeof m.q_para_index !== 'number' || typeof m.occur_index !== 'number' || !m.q_num) continue;
      const sec = root.querySelector(`.rd-q[data-num="${CSS.escape(String(m.q_num))}"]`);
      if (!sec) continue;
      const para = sec.querySelectorAll('.rd-q-p')[m.q_para_index];
      if (para) wrapOccurrence(para, String(m.selection || '').trim(),
                               m.occur_index, !!m.imported, String(m.gloss || ''));
    }
  }


  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const info = getSelectionInfo();
      if (info) showBubble(info);
    }, 0);
  });

  // ---- 悬浮球题目：可拖动球 + 可拖动卡片 + 全部就地展开（v7） ----
  const qBall = $('rdQBall');
  const qCard = $('rdQCard');

  if (qBall && qCard) {
    const qs = window.RD_QUESTIONS || [];
    let qi = 0;
    let qMode = 'single'; // single | all

    const BALL_POS_KEY = 'rd-qball-pos';

    const clampBall = (left, top) => {
      const w = qBall.offsetWidth || 58;
      const h = qBall.offsetHeight || 58;
      return {
        left: Math.max(4, Math.min(left, window.innerWidth - w - 4)),
        top: Math.max(4, Math.min(top, window.innerHeight - h - 4)),
      };
    };

    const setBallPos = (left, top, save) => {
      const p = clampBall(left, top);
      qBall.style.left = `${p.left}px`;
      qBall.style.top = `${p.top}px`;
      qBall.style.right = 'auto';
      qBall.style.bottom = 'auto';
      if (save) {
        try { localStorage.setItem(BALL_POS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
      }
    };

    // 恢复上次位置
    try {
      const saved = JSON.parse(localStorage.getItem(BALL_POS_KEY) || 'null');
      if (saved && typeof saved.left === 'number') setBallPos(saved.left, saved.top, false);
    } catch (e) { /* ignore */ }

    // ---- 卡片渲染 ----
    const qBody = $('rdQCardBody');
    const qPos = $('rdQPos');

    const renderQ = () => {
      qMode = 'single';
      qi = Math.max(0, Math.min(qi, qs.length - 1));
      const q = qs[qi];
      qPos.textContent = `${q.num} · ${qi + 1}/${qs.length}`;
      qBody.innerHTML = `<section class="rd-q" data-num="${escapeHtml(q.num)}">` +
        q.paras.map((p, i) =>
          `<p class="rd-q-p${i === 0 ? ' rd-q-stem' : ''}">${escapeHtml(p)}</p>`).join('') +
        '</section>';
      $('rdQPrev').hidden = false;
      $('rdQNext').hidden = false;
      $('rdQAllBtn').hidden = false;
      $('rdQSingleBtn').hidden = true;
      $('rdQPrev').disabled = qi === 0;
      $('rdQNext').disabled = qi === qs.length - 1;
      qCard.classList.remove('rd-qcard-all');
      markLookuped(qBody); // 题目区历史标记
    };

    const renderAll = () => {
      qMode = 'all';
      qPos.textContent = `全部 · ${qs.length} 题`;
      qBody.innerHTML = qs.map((q) =>
        `<section class="rd-q" data-num="${escapeHtml(q.num)}">` +
        q.paras.map((p, i) =>
          `<p class="rd-q-p${i === 0 ? ' rd-q-stem' : ''}">${escapeHtml(p)}</p>`).join('') +
        '</section>').join('');
      $('rdQPrev').hidden = true;
      $('rdQNext').hidden = true;
      $('rdQAllBtn').hidden = true;
      $('rdQSingleBtn').hidden = false;
      qCard.classList.add('rd-qcard-all');
      markLookuped(qBody); // 题目区历史标记
    };

    // ---- 卡片开合：开=球隐藏；关=球出现在卡片当前位置并记忆 ----
    // 展开/收起统一锚点：卡片位置持久化（rd-qcard-pos），展开时原路恢复；
    // 收起时球落在卡片左上角 —— 下次展开卡片左上角仍在这里，位置不再漂移。
    const CARD_POS_KEY = 'rd-qcard-pos';

    const clampCardPos = (left, top) => {
      const w = qCard.offsetWidth || 440;
      const h = qCard.offsetHeight || 200;
      return {
        left: Math.max(4, Math.min(left, window.innerWidth - Math.min(w, window.innerWidth) - 4)),
        top: Math.max(4, Math.min(top, window.innerHeight - 40)),
      };
    };

    const restoreCardPos = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(CARD_POS_KEY) || 'null');
        if (!saved || typeof saved.left !== 'number') return false;
        const p = clampCardPos(saved.left, saved.top);
        qCard.style.left = `${p.left}px`;
        qCard.style.top = `${p.top}px`;
        qCard.style.right = 'auto';
        qCard.style.bottom = 'auto';
        return true;
      } catch (e) {
        return false;
      }
    };

    const placeCard = () => {
      if (qCard.style.left) return;           // 已被拖动过，保持
      if (restoreCardPos()) return;           // 上次关闭的位置，原路展开
      const br = qBall.getBoundingClientRect();
      const cw = Math.min(440, window.innerWidth - 44);
      let left = br.left + br.width / 2 - cw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
      let top = br.top - qCard.offsetHeight - 12;
      if (top < 8) top = Math.min(br.bottom + 12, window.innerHeight - 120);
      qCard.style.left = `${left}px`;
      qCard.style.top = `${Math.max(8, top)}px`;
      qCard.style.right = 'auto';
      qCard.style.bottom = 'auto';
    };

    const openCard = () => {
      qBall.style.display = 'none';
      qCard.hidden = false;
      placeCard();
      if (qMode === 'all') renderAll(); else renderQ();
    };

    const closeCard = () => {
      // 球出现在卡片左上角（clamp 收敛），卡片位置持久化，下次原路展开
      const cr = qCard.getBoundingClientRect();
      qCard.hidden = true;
      qCard.style.left = '';
      qCard.style.top = '';
      try {
        localStorage.setItem(CARD_POS_KEY, JSON.stringify({ left: cr.left, top: cr.top }));
      } catch (e) { /* ignore */ }
      setBallPos(cr.left, cr.top, true);
      qBall.style.display = '';
    };

    // ---- 悬浮球拖动（pointer capture；位移 <4px 视为点击） ----
    let ballDrag = null;
    qBall.addEventListener('pointerdown', (ev) => {
      const rect = qBall.getBoundingClientRect();
      ballDrag = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top, moved: false };
      qBall.setPointerCapture(ev.pointerId);
    });
    qBall.addEventListener('pointermove', (ev) => {
      if (!ballDrag) return;
      const dx = ev.clientX - ballDrag.x;
      const dy = ev.clientY - ballDrag.y;
      if (!ballDrag.moved && Math.abs(dx) + Math.abs(dy) > 4) ballDrag.moved = true;
      if (ballDrag.moved) setBallPos(ballDrag.left + dx, ballDrag.top + dy, false);
    });
    qBall.addEventListener('pointerup', () => {
      if (!ballDrag) return;
      if (ballDrag.moved) {
        const rect = qBall.getBoundingClientRect();
        setBallPos(rect.left, rect.top, true);
      } else {
        if (qCard.hidden) openCard(); else closeCard();
      }
      ballDrag = null;
    });
    qBall.addEventListener('pointercancel', () => { ballDrag = null; });

    // ---- 卡片拖动：头部空白区为手柄（按钮除外） ----
    let cardDrag = null;
    const cardHead = qCard.querySelector('.rd-qcard-head');
    cardHead.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.btn')) return;
      const rect = qCard.getBoundingClientRect();
      cardDrag = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
      cardHead.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    cardHead.addEventListener('pointermove', (ev) => {
      if (!cardDrag) return;
      const left = Math.max(-qCard.offsetWidth + 80, Math.min(cardDrag.left + ev.clientX - cardDrag.x, window.innerWidth - 80));
      const top = Math.max(0, Math.min(cardDrag.top + ev.clientY - cardDrag.y, window.innerHeight - 40));
      qCard.style.left = `${left}px`;
      qCard.style.top = `${top}px`;
    });
    const endCardDrag = () => { cardDrag = null; };
    cardHead.addEventListener('pointerup', endCardDrag);
    cardHead.addEventListener('pointercancel', endCardDrag);

    $('rdQPrev').addEventListener('click', () => { qi--; renderQ(); });
    $('rdQNext').addEventListener('click', () => { qi++; renderQ(); });
    $('rdQAllBtn').addEventListener('click', renderAll);
    $('rdQSingleBtn').addEventListener('click', renderQ);
    $('rdQClose').addEventListener('click', closeCard);
    window.__rdCloseCard = closeCard;
  }

  document.addEventListener('mousedown', (ev) => {
    if (bubble && bubble.contains(ev.target)) return;
    if (card && card.contains(ev.target)) return;
    // 点空白处收起气泡与卡片（点卡片内部除外）
    if (card && !article.contains(ev.target)) dismissCard();
    dismissBubble();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      dismissCard();
      dismissBubble();
      if (window.__rdCloseCard) window.__rdCloseCard();
    }
  });
})();
