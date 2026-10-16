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

  // 列表页已废弃（规格：阅读并入主界面）：试卷导入迁至 /import，阅读入口在 index 侧栏。

  /* ==================== 阅读页：划词查词 ==================== */

  const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'phr.', 'other'];
  let readAreas = [];      // 多视图：文章可换，init 时按当前正文重查
  const body = document.body;
  let textId = '';         // 多视图：由 RD.init 注入
  let source = '';

  let bubble = null;
  let card = null;
  let seq = 0;             // 请求序号：只认最后一次
  let savedRect = null;    // 划词时选区的视口矩形（查词后 DOM 会被标记重写，Range 会失效，rect 当场缓存）

  // ---- 多视图：正文渲染（顺序与后端 para_index 定位严格一致） ----
  function renderArticle(allSections) {
    const host = $('rdPassHost');
    if (!host) return;
    host.innerHTML = (allSections || []).map((s) => (
      `<section class="rd-pass" data-key="${escapeHtml(s.key || '')}" data-kind="${escapeHtml(s.kind || '')}">
        ${s.label ? `<h2 class="rd-pass-title">${escapeHtml(s.label)}</h2>` : ''}
        <article class="reading-article" aria-label="正文">
          ${(s.articles || []).map((p) => `<p class="reading-p">${escapeHtml(p)}</p>`).join('')}
        </article>
      </section>`
    )).join('');
    readAreas = Array.from(document.querySelectorAll('.reading-article'));
  }

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

  /** 划词有效区：正文（多篇阅读区）+ 题目面板/弹层（做题时也能查题干生词）。 */
  function inReadArea(node) {
    if (!node) return false;
    if (readAreas.some((a) => a.contains(node))) return true;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest && el.closest('.rd-qcard-body, .rd-qall-body, .rd-picker-panel'));
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
    return el ? el.closest('.reading-p, .rd-q-p, .rd-match-stem, .rd-bank-item, .rd-opt') : null;
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
    const pos = mode === 'lookup' ? positionOfSelection(info.sel, info.text) : null;
    savedRect = info.sel.getRangeAt(0).getBoundingClientRect();
    // 词库/选项区不是原文语料（"A embrace" 这类条目文本无句子上下文），查词不带例句
    const noCtx = !!(pos && (pos.area === 'bank' || pos.area === 'opt'));
    const sentence = noCtx ? '' : extractSentence(info.text);
    if (mode === 'translate' && noCtx) {
      // 翻译需要整句；词库/选项没有句子上下文，引导走查词
      bubbleLoaded();
      bubbleTranslateResult('', true, '此处无整句可译，请用「查词」');
      return;
    }
    if (mode === 'lookup') {
      lastSelText = info.text;
      lastPos = pos;
    }
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
          q_num: posToQNum(pos),
          q_para_index: pos ? (pos.area === 'q' ? pos.qParaIndex : 0) : null,
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
        // 查词成功即记录该处位置，按记录全量重放标记（释义悬浮可看）
        addMark(info.text, draft.meaning || '', false, pos);
        rebuildMarks();
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
    // 没有真实句子上下文的查词（如词库列表里的单词）不渲染例句区
    const hasExample = !!sentence && sentence.trim() !== String(info.text || '').trim();
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
      ${hasExample ? `<div class="rd-card-row">
        <label class="reading-label" for="rdExEn">例句 <span class="opt">来自原文，可改</span></label>
        <textarea id="rdExEn" rows="3">${escapeHtml(sentence)}</textarea>
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdExZh">例句翻译</label>
        <textarea id="rdExZh" rows="2">${escapeHtml(draft.example_zh || '')}</textarea>
      </div>` : ''}
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

    // 定位：划词时缓存的选区矩形（查词标记会重写 DOM，实时 Range 不可靠），视口边缘收敛
    const rect = savedRect || { left: 40, top: 80, width: 0, bottom: 80 };
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
  let lastPos = null;   // 最近一次查词的定位（body/q）；查词失败后存词也能落标记

  async function saveCard() {
    const word = card.querySelector('#rdWord').value.trim();
    const pos = card.querySelector('#rdPos').value;
    const meaning = card.querySelector('#rdMeaning').value.trim();
    const exEnEl = card.querySelector('#rdExEn');
    const exZhEl = card.querySelector('#rdExZh');
    const exEn = exEnEl ? exEnEl.value.trim() : '';
    const exZh = exZhEl ? exZhEl.value.trim() : '';
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
      // 记录升级为已入库 + 按记录全量重放：虚线当场变实线、释义可悬浮，不依赖选区现场包裹
      addMark(lastSelText, meaning, true, lastPos || undefined);
      rebuildMarks();
      dismissCard();
    } catch (err) {
      hint.textContent = err.message || '网络错误';
      hint.classList.add('is-err');
      btn.disabled = false;
    }
  }

  // ---- 已查词持久标记：一词一位置一区域（同词跨区域各自保留，同区域后查覆盖） ----
  function addMark(selection, gloss, imported, pos) {
    const sel = String(selection || '').trim();
    if (!sel) return;
    const marks = window.RD_MARKS || (window.RD_MARKS = []);
    const low = sel.toLowerCase();
    // 入库是词级事实：同词所有记录（正文/题干/词库/选项）一起升级实线
    if (imported) marks.forEach((m) => { if (String(m.selection || '').trim().toLowerCase() === low) m.imported = true; });
    const key = low + '@' + posToQNum(pos);
    const found = marks.find((m) => String(m.selection || '').trim().toLowerCase() + '@' + String(m.q_num || '') === key);
    const fields = pos ? {
      para_index: (pos.area === 'body') ? pos.paraIndex : null,
      occur_index: pos ? pos.occurIndex : null,
      q_num: posToQNum(pos),
      q_para_index: (pos.area === 'q') ? pos.qParaIndex : (pos.area === 'bank' || pos.area === 'opt') ? 0 : null,
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
  /** 位置 → q_num 编码（落库/去重共用）：题干=题号；词库=bank:词键；选项=opt:题号:选项键；正文='' */
  function posToQNum(pos) {
    if (!pos) return '';
    if (pos.area === 'q') return pos.qNum;
    if (pos.area === 'bank') return 'bank:' + pos.bankKey;
    if (pos.area === 'opt') return 'opt:' + pos.qNum + ':' + pos.optKey;
    return '';
  }

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
      if (para.classList.contains('rd-match-stem')) {
        // 段落匹配候选题干：锚 .rd-match-q[data-num]，题干唯一 → q_para_index 恒 0
        const section = para.closest('.rd-match-q');
        const qNum = String((section && section.getAttribute('data-num')) || '').trim();
        if (!qNum) return null;
        return { area: 'q', qNum, qParaIndex: 0, occurIndex };
      }
      if (para.classList.contains('rd-bank-item')) {
        // 选词填空词库候选词：锚 .rd-bank-item[data-key]
        const key = String(para.getAttribute('data-key') || '').trim();
        if (!key) return null;
        return { area: 'bank', bankKey: key, occurIndex };
      }
      if (para.classList.contains('rd-opt')) {
        // 选择题选项：锚 .rd-opt[data-num][data-key]
        const qNum = String(para.getAttribute('data-num') || '').trim();
        const optKey = String(para.getAttribute('data-key') || '').trim();
        if (!qNum || !optKey) return null;
        return { area: 'opt', qNum, optKey, occurIndex };
      }
      if (!readAreas.some((a) => a.contains(para))) return null;
      // 多篇阅读区：para_index 按全文档 .reading-p 顺序（服务端渲染顺序，稳定）
      const allParas = document.querySelectorAll('.rd-pass .reading-p');
      const paraIndex = Array.prototype.indexOf.call(allParas, para);
      if (paraIndex < 0) return null;
      return { area: 'body', paraIndex, occurIndex };
    } catch (e) {
      return null;
    }
  }

  /** 在段落内把第 occurIndex 次出现（0 起，大小写不敏感）包进标记 span。
   *  计数包含已标记文本（与 positionOfSelection 的 Range 口径一致）；
   *  目标处已标记则幂等跳过，杜绝重放时计数错位标到别的同词上。 */
  function wrapOccurrence(para, selText, occurIndex, imported, gloss) {
    const texts = [];
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) texts.push(tn);
    const needle = selText.toLowerCase();
    let remaining = occurIndex;
    for (const node of texts) {
      const inMark = !!(node.parentElement && node.parentElement.closest('.rd-mark'));
      const hay = node.nodeValue.toLowerCase();
      let idx = 0;
      while ((idx = hay.indexOf(needle, idx)) !== -1) {
        if (remaining === 0) {
          if (inMark) return true; // 该处已是标记：不重复包，计数已含它
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

  /** 正文标记重放：多篇阅读区按全文档 .reading-p 顺序定位（与 positionOfSelection 一致）。 */
  function markBodyMarks() {
    const marks = window.RD_MARKS || [];
    if (!marks.length) return;
    const paras = document.querySelectorAll('.rd-pass .reading-p');
    for (const m of marks) {
      if (typeof m.para_index !== 'number' || typeof m.occur_index !== 'number') continue;
      const para = paras[m.para_index];
      if (para) wrapOccurrence(para, String(m.selection || '').trim(),
                               m.occur_index, !!m.imported, String(m.gloss || ''));
    }
  }

  /** 题目区标记重放：按 q_num 前缀路由——bank:词库 / opt:题号:选项键 / 其余=.rd-q+.rd-match-q */
  function markLookuped(root) {
    const marks = window.RD_MARKS || [];
    if (!marks.length || !root) return;
    for (const m of marks) {
      if (typeof m.q_para_index !== 'number' || typeof m.occur_index !== 'number') continue;
      const qn = String(m.q_num || '');
      const selText = String(m.selection || '').trim();
      const imported = !!m.imported;
      const gloss = String(m.gloss || '');
      if (qn.startsWith('bank:')) {
        const item = root.querySelector(`.rd-bank-item[data-key="${CSS.escape(qn.slice(5))}"]`);
        if (item) wrapOccurrence(item, selText, m.occur_index, imported, gloss);
        continue;
      }
      if (qn.startsWith('opt:')) {
        const rest = qn.slice(4);
        const i = rest.indexOf(':');
        if (i > 0) {
          const opt = root.querySelector(`.rd-opt[data-num="${CSS.escape(rest.slice(0, i))}"][data-key="${CSS.escape(rest.slice(i + 1))}"]`);
          if (opt) wrapOccurrence(opt, selText, m.occur_index, imported, gloss);
        }
        continue;
      }
      if (!qn) continue;
      const sec = root.querySelector(`.rd-q[data-num="${CSS.escape(qn)}"], .rd-match-q[data-num="${CSS.escape(qn)}"]`);
      if (!sec) continue;
      const para = sec.querySelectorAll('.rd-q-p')[m.q_para_index]
        || (m.q_para_index === 0 ? sec.querySelector('.rd-match-stem') : null);
      if (para) wrapOccurrence(para, selText, m.occur_index, imported, gloss);
    }
  }

  /** 标记全量重放：先拆掉全部现存标记 span（保留文本），再按 RD_MARKS 记录重放。
   *  记录是唯一事实源——查词、存词、判分重写后都走这里，杜绝新旧位置叠加与嵌套 span。 */
  function rebuildMarks() {
    document.querySelectorAll('.rd-pass .reading-p span.rd-mark, .rd-qcard-body span.rd-mark')
      .forEach((span) => {
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      });
    markBodyMarks();
    const qBody = $('rdQCardBody');
    if (qBody) markLookuped(qBody);
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
    const BALL_POS_KEY = 'rd-qball-pos';

    // ---- 卡片尺寸：右下角原生 resize 手柄拖拽，pointerup 时持久化 ----
    const CARD_SIZE_KEY = 'rd-qcard-size';
    try {
      const sz = JSON.parse(localStorage.getItem(CARD_SIZE_KEY) || 'null');
      if (sz && typeof sz.w === 'number' && typeof sz.h === 'number') {
        qCard.style.width = `${sz.w}px`;
        qCard.style.height = `${sz.h}px`;
      }
    } catch (e) { /* ignore */ }
    qCard.addEventListener('pointerup', () => {
      try {
        localStorage.setItem(CARD_SIZE_KEY, JSON.stringify({ w: qCard.offsetWidth, h: qCard.offsetHeight }));
      } catch (e) { /* ignore */ }
    });

    // ---- 滚轮重定向：鼠标在卡片上滚动永远滚卡片内容，不穿透到底层页面 ----
    // body 内：原生滚动 + overscroll-behavior: contain 挡住到头穿透
    // 头部/tab 等非滚动区：原生会去滚页面，手动转给 body
    qCard.addEventListener('wheel', (ev) => {
      if (!qBody0().contains(ev.target)) {
        ev.preventDefault();
        const b = qBody0();
        b.scrollTop += ev.deltaY;
      }
    }, { passive: false });
    function qBody0() { return $('rdQCardBody'); }

    const clampBall = (left, top) => {
      const w = qBall.offsetWidth || 58;
      const h = qBall.offsetHeight || 58;
      return {
        left: Math.max(4, Math.min(left, window.innerWidth - w - 4)),
        top: Math.max(4, Math.min(top, window.innerHeight - h - 4)),
      };
    };

    // 贴边停靠：拖到左右边缘 → 半隐藏；点击露出的半边 → 弹回内侧（呼出）
    let ballDocked = null; // 'left' | 'right' | null

    const setBallPos = (left, top, save, docked = null) => {
      qBall.style.right = 'auto';
      qBall.style.bottom = 'auto';
      if (docked) {
        const w = qBall.offsetWidth || 58;
        const t = Math.max(4, Math.min(top, window.innerHeight - w - 4));
        const leftNum = docked === 'left' ? -Math.floor(w / 2) : window.innerWidth - Math.ceil(w / 2);
        qBall.style.left = `${leftNum}px`;
        qBall.style.top = `${t}px`;
        ballDocked = docked;
        if (save) {
          try { localStorage.setItem(BALL_POS_KEY, JSON.stringify({ left: leftNum, top: t, docked })); } catch (e) { /* ignore */ }
        }
        return;
      }
      ballDocked = null;
      const p = clampBall(left, top);
      qBall.style.left = `${p.left}px`;
      qBall.style.top = `${p.top}px`;
      if (save) {
        try { localStorage.setItem(BALL_POS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
      }
    };

    // 恢复上次位置（含贴边停靠态）
    try {
      const saved = JSON.parse(localStorage.getItem(BALL_POS_KEY) || 'null');
      if (saved && typeof saved.left === 'number') setBallPos(saved.left, saved.top, false, saved.docked || null);
    } catch (e) { /* ignore */ }

    // ---- 题目面板：分篇 tab（v11 重构；v17 多视图：状态由 RD.init 注入） ----
    const qBody = $('rdQCardBody');
    const qPos = $('rdQPos');
    const tabsEl = $('rdTabs');
    let sections = [];  // 面板节（有题目/词库的节），init 注入
    let activeTab = 0;

    // 作答状态（init 注入；作答/判分后本地同步，刷新不丢——后端持久化）
    const answerState = { answer_key: {}, answer_key_source: '', answers: {}, judged: {}, revealed: {} };
    const hasAnswerKey = () => Object.keys(answerState.answer_key).length > 0;
    const isJudged = (n) => Object.prototype.hasOwnProperty.call(answerState.judged, String(n));
    const isRevealed = (n) => Object.prototype.hasOwnProperty.call(answerState.revealed, String(n));

    const secOf = (kind) => sections.find((s) => s.kind === kind);
    const bankWord = (key) => {
      const sec = secOf('bank');
      const o = sec && (sec.bank || []).find((x) => x.key === key);
      return o ? o.text : '';
    };

    const shortLabel = (s) => {
      if (s.kind === 'bank') return '选词填空';
      if (s.kind === 'match') return '段落匹配';
      if (s.kind === 'legacy') return '题目';
      const m = /Passage (\w+)$/.exec(s.label || '');
      const cn = { One: '一', Two: '二', Three: '三', Four: '四', Five: '五' };
      return m ? `仔细阅读${cn[m[1]] || m[1]}` : '仔细阅读';
    };

    // ---- 各篇 tab 内容 ----
    const renderChoiceQ = (q) => {
      const picked = answerState.answers[q.num];
      const judged = isJudged(q.num);
      const correct = answerState.answer_key[q.num];
      let html = `<p class="rd-q-p rd-q-stem">${escapeHtml(q.stem || '')}</p><div class="rd-opts" data-num="${escapeHtml(q.num)}">`;
      q.options.forEach((o) => {
        let cls = 'rd-opt';
        if (picked === o.key) cls += ' is-picked';
        if (judged) {
          cls += ' is-locked';
          if (o.key === correct) cls += ' is-correct';
          else if (o.key === picked) cls += ' is-wrong';
        }
        html += `<button type="button" class="${cls}" data-num="${escapeHtml(q.num)}" data-key="${escapeHtml(o.key)}">` +
          `<span class="rd-opt-key">${escapeHtml(o.key)}</span><span class="rd-opt-text">${escapeHtml(o.text)}</span></button>`;
      });
      html += '</div>';
      if (hasAnswerKey()) {
        html += `<div class="rd-q-actions"><button type="button" class="btn ghost rd-judge-btn" data-num="${escapeHtml(q.num)}"${picked && !judged ? '' : ' disabled'}>对答案</button></div>`;
      }
      return html;
    };

    const renderBankTab = (s) => {
      // 词库总览：只读；标注每个词被哪空使用，判分红绿
      const usedBy = {};
      (s.questions || []).forEach((q) => {
        const a = answerState.answers[q.num];
        if (a) (usedBy[a] = usedBy[a] || []).push(q.num);
      });
      let html = '<div class="rd-bank">';
      (s.bank || []).forEach((o) => {
        const used = usedBy[o.key];
        let cls = 'rd-bank-item';
        if (used) {
          cls += ' is-used';
          if (used.some((n) => isRevealed(n) || (isJudged(n) && answerState.judged[n]))) cls += ' is-correct';
          else if (used.some((n) => isJudged(n))) cls += ' is-wrong';
        }
        html += `<div class="${cls}" data-key="${escapeHtml(o.key)}"><span class="rd-opt-key">${escapeHtml(o.key)}</span> <span>${escapeHtml(o.text)}</span>` +
          (used ? `<span class="rd-bank-used">→ 第 ${used.join('、')} 空</span>` : '') + '</div>';
      });
      return html + '</div>';
    };

    const renderMatchTab = (s) => {
      // 候选题目（段落已在阅读区展示，不重复；作答在阅读区点段首字母）
      let html = '<h4 class="rd-tab-h">候选题目 · 到阅读区点段首字母作答</h4>';
      html += (s.questions || []).map((q) => {
        const picked = answerState.answers[q.num];
        const judged = isJudged(q.num);
        const correct = answerState.answer_key[q.num];
        let cls = 'rd-match-q';
        if (judged) cls += answerState.judged[q.num] ? ' is-correct' : ' is-wrong';
        let verdict = picked ? `选 ${escapeHtml(picked)}` : '未选';
        if (judged) verdict += answerState.judged[q.num] ? ' ✓' : ` ✗ 正确 ${escapeHtml(correct || '?')}`;
        return `<div class="${cls}" data-num="${escapeHtml(q.num)}"><span class="rd-match-num">${escapeHtml(q.num)}.</span>` +
          `<span class="rd-match-stem">${escapeHtml(q.stem || '')}</span><span class="rd-match-pick">${verdict}</span>` +
          (hasAnswerKey() ? `<button type="button" class="btn ghost rd-judge-btn" data-num="${escapeHtml(q.num)}"${picked && !judged ? '' : ' disabled'}>对答案</button>` : '') +
          '</div>';
      }).join('');
      return html;
    };

    const renderActive = () => {
      const s = sections[activeTab];
      if (!s) { qBody.innerHTML = ''; return; }
      qPos.textContent = s.label || '题目';
      const qs = s.questions || [];
      const answered = qs.filter((q) => answerState.answers[q.num]).length;
      let html = '';
      if (hasAnswerKey() && qs.length) {
        const aiNote = answerState.answer_key_source === 'ai' ? '<span class="rd-key-ai-note">AI 生成，仅供参考</span>' : '';
        html += `<div class="rd-qall-tools"><span class="rd-qall-count">已作答 ${answered}/${qs.length}${aiNote}</span>` +
          `<button type="button" class="btn ghost rd-judgeall-btn"${answered ? '' : ' disabled'}>统一对答案</button></div>`;
      }
      if (s.kind === 'bank') html += renderBankTab(s);
      else if (s.kind === 'match') html += renderMatchTab(s);
      else if (s.kind === 'legacy') {
        html += qs.map((q) => `<section class="rd-q" data-num="${escapeHtml(q.num)}">` +
          (q.paras || []).map((p) => `<p class="rd-q-p">${escapeHtml(p)}</p>`).join('') + '</section>').join('');
      } else {
        html += qs.map((q) => `<section class="rd-q" data-num="${escapeHtml(q.num)}">${renderChoiceQ(q)}</section>`).join('');
      }
      qBody.innerHTML = html;
      markLookuped(qBody); // 题目区历史标记
    };

    const renderTabs = () => {
      if (sections.length <= 1) { tabsEl.hidden = true; return; }
      tabsEl.hidden = false;
      tabsEl.innerHTML = sections.map((s, i) =>
        `<button type="button" class="rd-tab${i === activeTab ? ' is-active' : ''}" data-i="${i}">${escapeHtml(shortLabel(s))}</button>`).join('');
    };

    const renderPanel = () => { renderTabs(); renderActive(); };

    // tab 在 #rdTabs（qBody 之外），点击处理必须绑在 tabsEl 上
    tabsEl.addEventListener('click', (ev) => {
      const tab = ev.target.closest('.rd-tab');
      if (tab) { activeTab = Number(tab.dataset.i) || 0; renderPanel(); }
    });

    // ---- 阅读区作答渲染：A 挖空块 + B 段落徽章 ----
    const blankSpanHtml = (n) => {
      // 状态优先级：已看答案 > 已判 > 已选 > 未选；判错不亮答案、可重选
      const picked = answerState.answers[n];
      const correct = answerState.answer_key[n];
      let cls = 'rd-blank';
      let label = n;
      let title = `第 ${n} 空，点击选词`;
      if (isRevealed(n)) {
        cls += ' is-revealed';
        label = `${correct}. ${bankWord(correct)}`;
        title = `已查看答案${picked ? `（你选 ${picked}. ${bankWord(picked)}）` : ''}`;
      } else if (isJudged(n)) {
        if (answerState.judged[n]) {
          cls += ' is-correct';
          label = `${picked}. ${bankWord(picked)}`;
          title = '答对了';
        } else {
          cls += ' is-wrong';
          label = `${picked}. ${bankWord(picked)}`;
          title = '选错了，点击重选；或点开弹层查看正确答案';
        }
      } else if (picked) {
        cls += ' is-picked';
        label = `${picked}. ${bankWord(picked)}`;
        title = `${picked}. ${bankWord(picked)}，点击改选`;
      }
      return `<button type="button" class="${cls}" data-num="${escapeHtml(n)}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
    };

    const renderBlanks = () => {
      const passA = document.querySelector('.rd-pass[data-kind="bank"]');
      const sec = secOf('bank');
      if (!passA || !sec) return;
      const nums = (sec.questions || []).map((q) => q.num);
      passA.querySelectorAll('.reading-p').forEach((p) => {
        // 原文存 data-orig，每次从原文重建（改选/判分后即时更新；重写 innerHTML 会毁掉查词标记，由 markBodyMarks 补放）
        if (!p.dataset.orig) p.dataset.orig = p.textContent;
        let html = escapeHtml(p.dataset.orig);
        let hit = false;
        nums.forEach((n) => {
          // 两种卷面形式：___26___（下划线包裹）与 ` 26 `（空格包裹）
          const before = html;
          html = html.replace(new RegExp(`_{2,}\\s?${n}\\s?_{2,}`, 'g'), `\u00abBLANK:${n}\u00bb`);
          html = html.replace(new RegExp(`(?<=\\s)${n}(?=[\\s,\\.])`, 'g'), `\u00abBLANK:${n}\u00bb`);
          if (html !== before) hit = true;
        });
        if (hit) {
          p.innerHTML = html.replace(/\u00abBLANK:(\d+)\u00bb/g, (_, m) => blankSpanHtml(m));
        }
      });
    };

    const renderParaBadges = () => {
      const passB = document.querySelector('.rd-pass[data-kind="match"]');
      const sec = secOf('match');
      if (!passB || !sec) return;
      const byPara = {};
      const stems = {};
      (sec.questions || []).forEach((q) => {
        stems[q.num] = q.stem || '';
        const a = answerState.answers[q.num];
        if (a) (byPara[a] = byPara[a] || []).push(q.num);
      });
      passB.querySelectorAll('.reading-p').forEach((p) => {
        // 原文存 data-orig，每次从原文重建（选题后徽章即时更新；重写 innerHTML 毁掉的查词标记由 markBodyMarks 补放）
        if (!p.dataset.orig) p.dataset.orig = p.textContent;
        const orig = p.dataset.orig;
        const m = /^([A-O])\)/.exec(orig.trim());
        if (!m) return;
        const letter = m[1];
        const nums = byPara[letter] || [];
        const marks = nums.map((n) => {
          let cls = 'rd-para-mark';
          if (isJudged(n)) cls += answerState.judged[n] ? ' is-correct' : ' is-wrong';
          // data-tip 自绘 tooltip（即时响应+卡片样式），不用原生 title（有 1 秒延迟且不美化）
          return `<span class="${cls}" data-tip="${escapeHtml(stems[n] || '')}">${escapeHtml(n)}</span>`;
        }).join('');
        let html = escapeHtml(orig);
        html = html.replace(/^(\s*)([A-O])\)/, '$1<span class="rd-para-letter" data-letter="$2">$2)</span>');
        p.innerHTML = `<span class="rd-para-marks">${marks}</span>` + html;
      });
    };

    // ---- 作答 / 判分交互 ----
    const post = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '请求失败');
      return data;
    };

    const rerender = () => {
      renderBlanks();
      renderParaBadges();
      markBodyMarks();
      renderPanel();
    };

    const doJudge = async (payload) => {
      const data = await post(`/api/reading/${textId}/judge`, payload);
      Object.assign(answerState.judged, data.result || {});
      rerender();
    };

    qBody.addEventListener('click', async (ev) => {
      const opt = ev.target.closest('.rd-opt');
      if (opt) {
        if (opt.classList.contains('is-locked')) return;
        // 划选选项文本查词时不切换选项（拖动选词会触发 click，选区非空即视为选词）
        if (String(window.getSelection() || '').trim()) return;
        try {
          await post(`/api/reading/${textId}/answer`, { num: opt.dataset.num, key: opt.dataset.key });
          answerState.answers[opt.dataset.num] = opt.dataset.key;
          rerender();
        } catch (e) { alert(e.message); }
        return;
      }
      const judgeBtn = ev.target.closest('.rd-judge-btn');
      if (judgeBtn && !judgeBtn.disabled) {
        try { await doJudge({ num: judgeBtn.dataset.num }); } catch (e) { alert(e.message); }
        return;
      }
      const judgeAllBtn = ev.target.closest('.rd-judgeall-btn');
      if (judgeAllBtn && !judgeAllBtn.disabled) {
        // 统一对答案只判当前篇已作答题（跳过已判/已看答案）
        const s = sections[activeTab];
        const nums = (s && s.questions || [])
          .filter((q) => answerState.answers[q.num] && !isJudged(q.num) && !isRevealed(q.num))
          .map((q) => q.num);
        if (!nums.length) return;
        try { await doJudge({ nums }); } catch (e) { alert(e.message); }
      }
    });

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
      renderPanel();
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
        // 贴边判定：松手时距左右屏缘 ≤20px → 停靠半隐藏
        const EDGE = 20;
        if (rect.left <= EDGE) setBallPos(rect.left, rect.top, true, 'left');
        else if (window.innerWidth - rect.right <= EDGE) setBallPos(rect.left, rect.top, true, 'right');
        else setBallPos(rect.left, rect.top, true);
      } else if (ballDocked) {
        // 停靠中点击 = 呼出：弹回内侧，不开卡
        const rect = qBall.getBoundingClientRect();
        setBallPos(ballDocked === 'left' ? 10 : window.innerWidth - rect.width - 10, rect.top, true);
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

    $('rdQClose').addEventListener('click', closeCard);
    window.__rdCloseCard = closeCard;

    // ---- 阅读区作答：A 挖空选词 / B 段落选题（弹层） ----
    let picker = null;
    const closePicker = () => { if (picker) { picker.remove(); picker = null; } };
    const openPicker = (inner) => {
      closePicker();
      picker = document.createElement('div');
      picker.className = 'rd-key-overlay rd-picker-overlay';
      picker.innerHTML = inner;
      picker.addEventListener('click', (ev) => { if (ev.target === picker) closePicker(); });
      // 滚轮隔离：列表区原生滚（contain 挡穿透）；面板其余区不滚页面
      picker.addEventListener('wheel', (ev) => {
        const list = picker.querySelector('.rd-picker-list');
        if (!list || !list.contains(ev.target)) ev.preventDefault();
      }, { passive: false });
      document.body.appendChild(picker);
    };

    // A：点空块 → 15 词选择（判错的空带「查看正确答案」）
    const openBankPicker = (n) => {
      const sec = secOf('bank');
      if (!sec) return;
      const items = (sec.bank || []).map((o) => {
        const picked = answerState.answers[n] === o.key;
        return `<button type="button" class="rd-pick-q${picked ? ' is-picked' : ''}" data-key="${escapeHtml(o.key)}" data-num="${escapeHtml(n)}">` +
          `<span class="rd-opt-key">${escapeHtml(o.key)}</span> <span>${escapeHtml(o.text)}</span></button>`;
      }).join('');
      const wrongPicked = isJudged(n) && !answerState.judged[n] && !isRevealed(n);
      const revealBtn = (wrongPicked && hasAnswerKey())
        ? `<button type="button" class="btn ghost rd-reveal-btn" data-num="${escapeHtml(n)}">查看正确答案</button>` : '';
      openPicker(`<div class="rd-key-panel rd-picker-panel"><h3>第 ${escapeHtml(n)} 空 · 选词</h3>` +
        `<div class="rd-picker-list rd-picker-bank">${items}</div>` +
        `<div class="rd-key-actions">${revealBtn}<button type="button" class="btn ghost rd-key-cancel">关闭</button></div></div>`);
    };

    // B：点段首字母 → 题目列表选题
    const openMatchPicker = (letter) => {
      const sec = secOf('match');
      if (!sec) return;
      const items = (sec.questions || []).map((q) => {
        const picked = answerState.answers[q.num];
        const judged = isJudged(q.num);
        let cls = 'rd-pick-q';
        if (picked === letter) cls += ' is-picked';
        if (judged) cls += ' is-locked';
        return `<button type="button" class="${cls}" data-num="${escapeHtml(q.num)}" data-letter="${escapeHtml(letter)}"${judged ? ' disabled' : ''}>` +
          `<span class="rd-match-num">${escapeHtml(q.num)}.</span> <span>${escapeHtml(q.stem || '')}</span>` +
          (picked ? `<span class="rd-pick-cur">当前选 ${escapeHtml(picked)}</span>` : '') + '</button>';
      }).join('');
      openPicker(`<div class="rd-key-panel rd-picker-panel"><h3>段落 ${escapeHtml(letter)} · 选择对应题目</h3>` +
        `<div class="rd-picker-list">${items}</div>` +
        `<div class="rd-key-actions"><button type="button" class="btn ghost rd-key-cancel">关闭</button></div></div>`);
    };

    document.addEventListener('click', async (ev) => {
      const cancel = ev.target.closest('.rd-key-cancel');
      if (cancel) { closePicker(); return; }
      if (picker) {
        const reveal = ev.target.closest('.rd-reveal-btn');
        if (reveal) {
          try {
            await post(`/api/reading/${textId}/reveal`, { num: reveal.dataset.num });
            answerState.revealed[reveal.dataset.num] = true;
            closePicker();
            rerender();
          } catch (e) { alert(e.message); }
          return;
        }
        const pick = ev.target.closest('.rd-pick-q');
        if (pick && !pick.disabled) {
          try {
            const body = pick.dataset.letter
              ? { num: pick.dataset.num, key: pick.dataset.letter }
              : { num: pick.dataset.num, key: pick.dataset.key };
            await post(`/api/reading/${textId}/answer`, body);
            answerState.answers[body.num] = body.key;
            delete answerState.judged[body.num]; // 判错重选：清判分态（后端同款），等再次对答案
            closePicker();
            rerender();
          } catch (e) { alert(e.message); }
          return;
        }
      }
      const blank = ev.target.closest('.rd-blank');
      if (blank) {
        const n = blank.dataset.num;
        // 锁定条件：已看答案 / 判对；判错解锁重选
        const locked = isRevealed(n) || (isJudged(n) && answerState.judged[n]);
        if (!locked) { openBankPicker(n); return; }
      }
      const letter = ev.target.closest('.rd-para-letter');
      if (letter) { openMatchPicker(letter.dataset.letter); return; }
    });

    // ---- 多视图初始化：script.js 侧栏切换或 RD_BOOT 直链调用，文章可反复切换 ----
    function init(payload, opts) {
      opts = opts || {};
      const text = (payload && payload.text) || {};
      textId = String(text.id || '');
      source = String(text.source || '');
      window.RD_MARKS = payload.lookup_marks || [];

      const all = payload.sections || [];
      sections = all.filter((s) => (s.questions || []).length || (s.bank || []).length);

      const st = payload.answer_state || {};
      answerState.answer_key = st.answer_key || {};
      answerState.answers = st.answers || {};
      answerState.judged = st.judged || {};
      answerState.revealed = st.revealed || {};
      answerState.answer_key_source = st.answer_key_source || '';

      // 标题 / 来源 / 正文（顺序与后端 para_index 定位一致）
      $('rdTitle').textContent = text.title || '';
      const srcEl = $('rdSourceTag');
      srcEl.textContent = text.source ? `来源 · ${text.source}` : '';
      srcEl.style.display = text.source ? '' : 'none';
      renderArticle(all);

      // 旧交互清理：气泡 / 弹层 / 选题层 / 题卡归位
      dismissBubble();
      dismissCard();
      closePicker();
      qCard.hidden = true;
      qCard.style.left = '';
      qCard.style.top = '';
      document.querySelectorAll('.rd-bubble, .rd-toast').forEach((el) => el.remove());

      // 悬浮球与顶栏工具条：有题才出现（正文卡片自带隐藏态）
      const totalQs = sections.reduce((n, s) => n + (s.questions || []).length, 0);
      const hasQ = totalQs > 0;
      qBall.hidden = !hasQ;
      $('rdQBallNum').textContent = String(totalQs);
      document.querySelectorAll('.rd-toolbar-only').forEach((b) => { b.hidden = !hasQ; });

      // 渲染：空块 / 段落徽章 / 查词标记重放 / 面板
      activeTab = 0;
      renderBlanks();
      renderParaBadges();
      markBodyMarks();
      renderPanel();

      // 侧栏入口定位：sec → 滚动到对应篇 + 预选对应 tab（不自动弹题卡，球保持收起态）
      const sec = String(opts.sec || '');
      if (sec) {
        const idx = sections.findIndex((s) => String(s.key || '') === sec);
        if (idx >= 0) {
          const pass = document.querySelector(`.rd-pass[data-key="${CSS.escape(sec)}"]`);
          if (pass) pass.scrollIntoView({ behavior: 'smooth', block: 'start' });
          activeTab = idx;
        }
      }

      // 试卷入库提示（导入页跳转携带；看完即清 paper 参数，保留 read 定位）
      if (opts.paper) {
        const toast = document.createElement('div');
        toast.className = 'rd-toast';
        toast.textContent = `试卷已入库：文件夹《${opts.paper}》`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
        try {
          const u = new URL(location.href);
          u.searchParams.delete('paper');
          history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : ''));
        } catch (e) { /* ignore */ }
      }
      setHint('');
    }
    window.RD = { init };

    // ---- 顶栏答案入口（有题才有这些按钮） ----
    const keyImportBtn = $('rdKeyImportBtn');
    const keyAiBtn = $('rdKeyAiBtn');
    const redoBtn = $('rdRedoBtn');

    if (keyImportBtn) {
      // 导入答案弹层：textarea 多行粘贴（36-45 FBAID / 逐行 36. F 都认）
      let overlay = null;
      const openKeyImport = () => {
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'rd-key-overlay';
          overlay.innerHTML =
            '<div class="rd-key-panel">' +
            '<h3>导入标准答案</h3>' +
            '<p class="rd-key-note">支持连写（36-45 FBAID）、逐行（36. F）或混排。导入后覆盖 AI 答案。</p>' +
            '<textarea class="rd-key-textarea" rows="8" placeholder="例如：&#10;26-35 NKAMEDGJOF&#10;36-45 FBAIDGHJECB&#10;46-55 ABDCA BDCAB"></textarea>' +
            '<p class="rd-key-err" hidden></p>' +
            '<div class="rd-key-actions">' +
            '<button type="button" class="btn ghost rd-key-cancel">取消</button>' +
            '<button type="button" class="btn primary rd-key-save">保存</button>' +
            '</div></div>';
          overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; });
          overlay.querySelector('.rd-key-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
          overlay.querySelector('.rd-key-save').addEventListener('click', async () => {
            const val = overlay.querySelector('.rd-key-textarea').value;
            const errEl = overlay.querySelector('.rd-key-err');
            errEl.hidden = true;
            try {
              const data = await post(`/api/reading/${textId}/answer_key/import`, { key: val });
              if (data.key) answerState.answer_key = data.key;
              answerState.answer_key_source = 'user';
              overlay.style.display = 'none';
              rerender();
              alert(`已导入 ${data.count} 题答案`);
            } catch (e) {
              errEl.textContent = e.message;
              errEl.hidden = false;
            }
          });
          document.body.appendChild(overlay);
        }
        overlay.style.display = '';
        overlay.querySelector('.rd-key-textarea').value = '';
        overlay.querySelector('.rd-key-err').hidden = true;
      };
      keyImportBtn.addEventListener('click', openKeyImport);
    }

    if (keyAiBtn) {
      keyAiBtn.addEventListener('click', async () => {
        if (!confirm('让 DeepSeek 生成本篇答案？仅供参考，可随时被导入答案覆盖。')) return;
        keyAiBtn.disabled = true;
        keyAiBtn.textContent = '生成中…';
        try {
          const data = await post(`/api/reading/${textId}/answer_key/ai`, {});
          if (data.key) answerState.answer_key = data.key;
          answerState.answer_key_source = 'ai';
          rerender();
          alert(`AI 已生成 ${data.count} 题答案，仅供参考`);
        } catch (e) {
          alert(e.message);
        } finally {
          keyAiBtn.disabled = false;
          keyAiBtn.textContent = 'AI 出答案';
        }
      });
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', async () => {
        if (!confirm('清空全部作答与判分？（答案键保留）')) return;
        try {
          await post(`/api/reading/${textId}/reset`, {});
          answerState.answers = {};
          answerState.judged = {};
          answerState.revealed = {};
          rerender();
        } catch (e) { alert(e.message); }
      });
    }
  }

  document.addEventListener('mousedown', (ev) => {
    if (bubble && bubble.contains(ev.target)) return;
    if (card && card.contains(ev.target)) return;
    // 点空白处收起气泡与卡片（点阅读区/题目卡/悬浮球/弹层内部除外）
    if (card && !ev.target.closest('.reading-article, .rd-qcard, .rd-qball, .rd-picker-panel')) dismissCard();
    dismissBubble();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      dismissCard();
      dismissBubble();
      if (window.__rdCloseCard) window.__rdCloseCard();
    }
  });

  // 主界面直链：/?read=<id> 服务端注入 RD_BOOT，加载即渲染阅读视图（宿主显隐由 script.js 负责）
  if (window.RD_BOOT && window.RD) {
    window.RD.init(window.RD_BOOT, { sec: window.RD_BOOT.sec || '', paper: window.RD_BOOT.paper || '' });
  }
})();
