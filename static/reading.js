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
  let answerKeyNow = {};   // 当前答案键（面板侧同步；词库查词答案键反查用。answerState 在面板嵌套作用域，外层不可见）

  let bubble = null;
  let card = null;
  let seq = 0;             // 请求序号：只认最后一次
  let savedRect = null;    // 划词时选区的视口矩形（查词后 DOM 会被标记重写，Range 会失效，rect 当场缓存）

  // ---- 鼠标模式层：作答（默认）点击作答+拖动笔迹 | 查词 作答静默、全区域可查 ----
  let mouseMode = 'answer';
  try { if (localStorage.getItem('rd-mouse-mode') === 'lookup') mouseMode = 'lookup'; } catch (e) { /* ignore */ }

  /* ==================== 触屏适配层（手机端适配） ====================
   * 总原则：桌面交互零改动——新逻辑全部以 pointerType === 'touch'（含 'pen'）分支判定；
   * 触屏分支不读 mouseMode（tap 落点区域天然分流：正文=查词、控件=作答）；
   * CSS 形态变化（题目条/半屏面板/底部 sheet）全部限定在 reading.css 720px 断点内。 */
  // 窄屏断点（与 CSS 同口径 720px）：形态判定用（CSS 跟断点走、JS 行为跟 pointerType 走，两者独立）
  const narrowMq = window.matchMedia ? window.matchMedia('(max-width: 720px)') : null;
  const isNarrowScreen = () => !!(narrowMq && narrowMq.matches);
  // selectionchange / contextmenu 事件自身不带 pointerType：以最近一次 pointerdown 的
  // 类型区分触屏来源（鼠标交互路径不受任何影响）
  let lastPointerType = '';
  let touchDown = null;      // 触屏 tap 起点（位移 <10px 视为 tap，防滚动/滑动手势误触）
  let touchWordSelUntil = 0; // 点词取词主动设选区的时间窗：窗口内 selectionchange 不接管
  document.addEventListener('pointerdown', (ev) => {
    lastPointerType = ev.pointerType || '';
    if (lastPointerType === 'touch' || lastPointerType === 'pen') {
      touchDown = { x: ev.clientX, y: ev.clientY };
    }
  }, true);
  const isTouchEventSource = (ev) => !!(ev && (ev.pointerType === 'touch' || ev.pointerType === 'pen'));
  const isTouchActive = () => lastPointerType === 'touch' || lastPointerType === 'pen';

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

  /** 划词有效区：正文（多篇阅读区）+ 题目面板/弹层（做题时也能查题干生词）
   *  + 问AI消息区（AI 解析里的生词也能当场查）。 */
  function inReadArea(node) {
    if (!node) return false;
    if (readAreas.some((a) => a.contains(node))) return true;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest && el.closest('.rd-qcard-body, .rd-qall-body, .rd-picker-panel, .rd-ask-msgs'));
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
    // 注意：.rd-blank（挖空 button）不要加进来——它嵌在 .reading-p 内，
    // closest 自然冒泡到整段；若短路到 button 会让例句截断、定位失效。
    return el ? el.closest('.reading-p, .rd-q-p, .rd-match-stem, .rd-bank-item, .rd-opt') : null;
  }

  /** 句界规则：默认句点（.）结尾为完整一句，问号/叹号兜底；向两侧扩展到句界或段落边界。
   *  例外：A. / 26. 这类选项/题号后的句点是序号标记不是句界，不在此断句。 */
  /** 在 paraText 内从 idx 起的词向两侧扩到句界，返回完整句（序号句点感知）。 */
  function sentenceAround(paraText, idx, len) {
    // 序号句点模式：句点前是单个大写字母或 1-3 位数字（词首大写缩写如 U.S. 不常见于题干，先不豁免）
    const isOrdinalDot = (i) => i > 0 && (/[A-Z]/.test(paraText[i - 1]) && (i < 2 || !/[A-Za-z]/.test(paraText[i - 2]))) || /^\d{1,3}$/.test(paraText.slice(Math.max(0, i - 3), i));
    let s = idx;
    while (s > 0) {
      const ch = paraText[s - 1];
      if (ch === '.' || ch === '?' || ch === '!') {
        if (ch === '.' && isOrdinalDot(s - 1)) { s--; continue; } // 序号句点：跨过继续找
        break;
      }
      s--;
    }
    while (s < idx && /\s/.test(paraText[s])) s++;
    let e = idx + len;
    while (e < paraText.length) {
      const ch = paraText[e];
      e++;
      if (ch === '.' || ch === '?' || ch === '!') {
        if (ch === '.' && isOrdinalDot(e - 1)) continue; // 序号句点：跨过继续
        break;
      }
    }
    return paraText.slice(s, e).trim();
  }

  /** 段落净化文本：已作答回填的挖空 label 形如 "M. shed"，
   *  例句里只留词本身（去 "M. " 答案键前缀）；未作答挖空是编号，原样保留。
   *  选项/词库的字母标（span.rd-opt-key：A/B/C…）不是正文，跳过不进例句。
   *  只影响查词例句提取，标记重放仍走原文本。 */
  function paraCleanText(p) {
    let out = '';
    for (const node of p.childNodes) {
      if (node.nodeType === 3) { out += node.nodeValue; continue; }
      if (node.nodeType === 1 && node.classList.contains('rd-opt-key')) continue;
      if (node.nodeType === 1 && node.classList.contains('rd-blank')) {
        out += node.textContent.replace(/^[A-O]\.\s+/i, '');
      } else {
        out += node.textContent;
      }
    }
    return out;
  }

  function extractSentence(selText) {
    const sel = window.getSelection();
    const para = paragraphOf(sel.anchorNode);
    if (!para) return selText;
    const paraText = paraCleanText(para);
    const idx = paraText.indexOf(selText);
    if (idx < 0) return paraText.trim();
    return sentenceAround(paraText, idx, selText.length);
  }

  /** 词库候选词的语境句（三层回退）：
   *  ① 无答案键且已作答：挖空回填成 "M. shed"，正文直接匹配到词 → 取其所在句
   *    （此时系统不知道正确答案，只能以用户选择为准）；
   *  ② 有答案键：候选键（如 M）反查到空号，取挖空所在句（编号占位或已作答回填，
   *    净化后无 "M. " 前缀）——用户错填的词反查不到，天然不会污染语境；
   *  ③ 反查不到（干扰项/错选词）→ 空串，走无语境多义项提示词。
   *  选项文本（fruit 等）不是正文词，不走此函数。 */
  function findArticleSentence(word, bankKey) {
    const w = String(word || '').trim();
    if (!w) return '';
    const hasKey = Object.keys(answerKeyNow || {}).length > 0;
    // ① 有答案键时跳过正文匹配：用户错误作答回填的词会被当成原文（如把 concerns
    //    错填到应为 rest 的空，语境句就错了）。有键时一律走 ② 反查。
    if (!hasKey) {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      for (const area of readAreas) {
        for (const p of area.querySelectorAll('.reading-p')) {
          const t = paraCleanText(p); // 净化：回填挖空的 "M. " 前缀不入例句
          const m = t.match(re);
          if (m) return sentenceAround(t, m.index, m[0].length);
        }
      }
    }
    // ② 答案键反查：候选键 → 空号 → 挖空所在句
    if (bankKey) {
      for (const [num, key] of Object.entries(answerKeyNow || {})) {
        if (String(key) !== String(bankKey)) continue;
        for (const area of readAreas) {
          const blank = area.querySelector(`.rd-blank[data-num="${CSS.escape(num)}"]`);
          if (!blank) continue;
          const p = blank.closest('.reading-p');
          if (!p) continue;
          // blank 在净化文本中的字符偏移（回填挖空去 "M. " 前缀后累计）
          const cleanLen = (node) => (node.nodeType === 1 && node.classList.contains('rd-blank')
            ? node.textContent.replace(/^[A-O]\.\s+/i, '').length
            : node.textContent.length);
          let off = 0;
          for (const node of p.childNodes) {
            if (node === blank) break;
            off += cleanLen(node);
          }
          const t = paraCleanText(p);
          if (off >= t.length) continue;
          // 挖空处显示的是用户作答（可能是错选）或未作答编号——语境句里替换成
          // 正确答案词（反查命中时空 N 的正确答案就是本词），模型看到真实搭配。
          const fixed = t.slice(0, off) + w + t.slice(off + cleanLen(blank));
          return sentenceAround(fixed, off, w.length);
        }
      }
    }
    return '';
  }

  function showBubble(info, opts) {
    opts = opts || {};
    dismissBubble();
    dismissCard();
    const rect = info.sel.getRangeAt(0).getBoundingClientRect();
    info.rect = rect; // 快照：触屏点「查词」确认时选区可能已被系统清掉，runLookup 兜底用
    const isLookup = info.words <= 5;
    const noteable = !opts.noNote && isNoteableSelection(info); // 点词场景（无选区语义）不出标记按钮
    bubble = document.createElement('div');
    bubble.className = 'rd-bubble';
    bubble.innerHTML = `
      <button type="button" class="btn rd-bubble-btn rd-btn-lookup ${isLookup ? 'rd-btn-primary' : ''}">查词</button>
      <button type="button" class="btn ghost rd-bubble-btn rd-btn-translate ${isLookup ? '' : 'rd-btn-primary'}">翻译</button>
      ${noteable ? '<button type="button" class="btn ghost rd-bubble-btn rd-btn-note" title="划选高亮为做题痕迹">标记</button>' : ''}
    `;
    document.body.appendChild(bubble);
    const bw = bubble.offsetWidth;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.bottom + 8;
    if (top + bubble.offsetHeight > window.innerHeight - 8) top = rect.top - bubble.offsetHeight - 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;

    // 触屏 tap 气泡按钮前，浏览器默认会清掉文本选区（runLookup 同步段仍要读选区）：
    // touch 来源的 pointerdown 阻止默认（click 照常派发，仅抑制兼容 mouse 事件）
    bubble.addEventListener('pointerdown', (ev) => {
      if (isTouchEventSource(ev)) ev.preventDefault();
    });
    bubble.querySelector('.rd-btn-lookup').addEventListener('click', () => runLookup('lookup', info));
    bubble.querySelector('.rd-btn-translate').addEventListener('click', () => runLookup('translate', info));
    const noteBtn = bubble.querySelector('.rd-btn-note');
    if (noteBtn) noteBtn.addEventListener('click', async () => { dismissBubble(); await saveNoteFromSelection(info); });
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
    const pos = positionOfSelection(info.sel, info.text);
    // 触屏确认点击时选区可能已被系统清掉（罕见兜底路径）：实时选区优先，失效退回
    // showBubble 快照的 rect；桌面路径选区恒存活，行为与原先完全一致
    savedRect = (info.sel && info.sel.rangeCount)
      ? info.sel.getRangeAt(0).getBoundingClientRect()
      : (info.rect || savedRect);
    // 例句取「查询处所在句」：正文/题干/选项划词，例句就是选区所在的那句；
    // 词库条目本身只有一个单词无句可取——靠答案键反查正文挖空句作例句，
    // 反查不到（干扰词/错选词）才无语境走词典义。
    let sentence;
    if (pos && pos.area === 'bank') {
      sentence = findArticleSentence(info.text, pos.bankKey);
    } else {
      sentence = extractSentence(info.text);
    }
    if (mode === 'translate' && !sentence) {
      // 翻译需要整句；没取到句子上下文（词库干扰词等），引导走查词
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
    // 例句框行数按内容长度自适应（卡内容列约 48 字符/行），确保完整展示
    const rowsFor = (text, min) => Math.max(min, Math.ceil(String(text || '').length / 48));
    const exRows = hasExample ? rowsFor(sentence, 3) : 0;
    const zhRows = hasExample ? rowsFor(draft.example_zh, 2) : 0;
    card = document.createElement('div');
    card.className = 'rd-card';
    card.innerHTML = `
      <div class="rd-card-grip" title="按住拖动">⠿</div>
      ${errMsg ? `<p class="rd-card-err">${escapeHtml(errMsg)}</p>` : ''}
      ${draft.phrase ? `<div class="rd-phrase-bar">
        <span class="rd-phrase-info">句中搭配：<b>${escapeHtml(draft.phrase.text)}</b> —— ${escapeHtml(draft.phrase.meaning)}</span>
        <span class="rd-phrase-actions">
          <button type="button" class="btn ghost rd-phrase-yes">记短语</button>
          <button type="button" class="btn ghost rd-phrase-no">只记单词</button>
        </span>
      </div>` : ''}
      <div class="rd-card-row">
        <label class="reading-label" for="rdWord">词头</label>
        <div class="rd-wordline">
          <input id="rdWord" type="text" maxlength="80" value="${escapeHtml(draft.head || info.text)}">
          <select id="rdPos" class="rd-pos">${POS_OPTIONS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
        </div>
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdMeaning">语境义 <span class="opt">多义项用『；』分隔，可改</span></label>
        <textarea id="rdMeaning" rows="${Math.max(1, Math.ceil(String(draft.meaning || '').length / 30))}" maxlength="300">${escapeHtml(draft.meaning || '')}</textarea>
      </div>
      ${hasExample ? `<div class="rd-card-row">
        <label class="reading-label" for="rdExEn">例句 <span class="opt">来自原文，可改</span></label>
        <textarea id="rdExEn" rows="${exRows}">${escapeHtml(sentence)}</textarea>
      </div>
      <div class="rd-card-row">
        <label class="reading-label" for="rdExZh">例句翻译</label>
        <textarea id="rdExZh" rows="${zhRows}">${escapeHtml(draft.example_zh || '')}</textarea>
      </div>` : ''}
      <div class="rd-card-row">
        <label class="reading-label">来源</label>
        <input type="text" class="rd-source" value="${escapeHtml(source)}" readonly>
      </div>
      <div class="rd-card-actions">
        <span class="reading-hint" id="rdCardHint"></span>
        <button type="button" class="btn ghost" id="rdCardCancel">取消</button>
        <button type="button" class="btn rd-btn-primary" id="rdCardSave">存入资产库</button>
      </div>
    `;
    document.body.appendChild(card);
    setHint(''); // 双击直查的「查询中…」到站：卡片即 loading 终点
    const pos = draft.pos || 'other';
    const posSel = card.querySelector('#rdPos');
    if (POS_OPTIONS.indexOf(pos) >= 0) posSel.value = pos;

    // ---- 短语联动确认制（2026-10-18 拍板）：单次调用带回的搭配由用户拍板 ----
    if (draft.phrase) {
      const ph = draft.phrase;
      const bar = card.querySelector('.rd-phrase-bar');
      const hintEl = card.querySelector('#rdCardHint');
      card.querySelector('.rd-phrase-no').addEventListener('click', () => bar.remove());
      card.querySelector('.rd-phrase-yes').addEventListener('click', async () => {
        if (!lookupId) { bar.remove(); return; }
        try {
          const res = await api(`/api/reading/lookup/${encodeURIComponent(lookupId)}/phrase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: ph.text, meaning: ph.meaning }),
          });
          if (!res || res.ok === false) {
            if (hintEl) { hintEl.textContent = (res && res.error) || '短语记录失败'; hintEl.classList.add('is-err'); }
            return;
          }
          lookupId = res.lookup_id; // 后续「存入资产库」的 imported 落在短语记录上
          card.querySelector('#rdWord').value = res.draft.head;
          posSel.value = 'phr.';
          card.querySelector('#rdMeaning').value = res.draft.meaning;
          // 原词标记退役、短语接管（occur_index 归零与后端派生口径一致）
          const low = String(info.text || '').trim().toLowerCase();
          const qn = lastPos ? posToQNum(lastPos) : '';
          const marks = window.RD_MARKS || [];
          const idx = marks.findIndex((m) => String(m.selection || '').trim().toLowerCase() === low && String(m.q_num || '') === qn);
          if (idx >= 0) marks.splice(idx, 1);
          lastSelText = String(ph.text);
          addMark(ph.text, res.draft.meaning, false, lastPos ? Object.assign({}, lastPos, { occurIndex: 0 }) : undefined);
          rebuildMarks();
          bar.remove();
        } catch (e) {
          if (hintEl) { hintEl.textContent = e.message || '网络错误'; hintEl.classList.add('is-err'); }
        }
      });
    }

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
    if (!isNarrowScreen()) card.querySelector('#rdMeaning').focus(); // 窄屏 sheet：不自动聚焦（防唤起虚拟键盘）
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

  /* ==================== 触屏虚拟键盘：底部 sheet（rd-card）防盖 ====================
   * 键盘弹出时 visualViewport 高度差 = 键盘占位：sheet 上移（translateY），键盘收起复位；
   * 面板内聚焦输入框 scrollIntoView 兜底（老浏览器无 visualViewport 也走这条）。 */
  const syncSheetKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv || !card) return;
    const lift = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    card.style.transform = lift > 0 ? `translateY(${-Math.round(lift)}px)` : '';
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncSheetKeyboard);
    window.visualViewport.addEventListener('scroll', syncSheetKeyboard);
  }
  document.addEventListener('focusin', (ev) => {
    // 兜底：sheet / 半屏题目面板内获得焦点的输入框滚入可视区（不动形态，纯滚动）
    if (!isNarrowScreen() || !ev.target || !ev.target.scrollIntoView) return;
    const qc = $('rdQCard');
    const inSheet = card && card.contains(ev.target);
    const inQCard = qc && !qc.hidden && qc.contains(ev.target);
    if (!inSheet && !inQCard) return;
    ev.target.scrollIntoView({ block: 'nearest' });
  });

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

  /* ==================== 做题痕迹（划选高亮笔记，与查词标记独立） ==================== */

  /** 笔迹锚定基准：段落文本节点清单 + 累计基准文本。
   *  跳过内容可变/非正文子树：.rd-blank（回填内容可变）、.rd-para-marks（随作答变化的
   *  徽章）、.rd-opt-key（选项字母标，非正文）。.rd-mark/.rd-note 包裹不改字符，照常计入。
   *  注意：不能复用 paraCleanText——它对挖空有「回填词替代编号」的语义替换，锚定需要的是排除。 */
  function noteBaseEntries(para) {
    const entries = [];
    let base = '';
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) {
      const pe = tn.parentElement;
      if (pe && pe.closest('.rd-blank, .rd-para-marks, .rd-opt-key')) continue;
      entries.push({ node: tn, baseStart: base.length });
      base += tn.nodeValue;
    }
    return { entries, base };
  }

  /** 选区可否落笔迹：单段落 + 正文/题干区（选项、词库等作答控件区除外）。 */
  function isNoteableSelection(info) {
    try {
      const pa = paragraphOf(info.sel.anchorNode);
      const pf = paragraphOf(info.sel.focusNode);
      if (!pa || pa !== pf) return false;
      return !!(pa.classList.contains('reading-p') || pa.classList.contains('rd-q-p') || pa.classList.contains('rd-match-stem'));
    } catch (e) {
      return false;
    }
  }

  /** 把选区换算成基准文本上的字符区间（跨挖空自动拆段——挖空不在基准内，
   *  选区穿过挖空时前后各成一段，视觉上高亮「跳过」挖空继续延伸）。
   *  注意 compareBoundaryPoints 实测语义（Chromium，与常量名直觉相反）：
   *  A.compare(END_TO_START, B) = A.start 对 B.end 的顺序；
   *  A.compare(START_TO_END, B) = A.end 对 B.start 的顺序。 */
  function noteSegmentsOf(para, sr) {
    const { entries, base } = noteBaseEntries(para);
    const intervals = [];
    for (const en of entries) {
      const nr = document.createRange();
      nr.selectNodeContents(en.node);
      if (nr.compareBoundaryPoints(Range.START_TO_END, sr) <= 0) continue; // 节点全在选区前（nr.end <= sr.start）
      if (nr.compareBoundaryPoints(Range.END_TO_START, sr) >= 0) continue; // 节点全在选区后（nr.start >= sr.end）
      let s = 0;
      let e = en.node.nodeValue.length;
      if (en.node === sr.startContainer) s = Math.max(s, sr.startOffset);
      if (en.node === sr.endContainer) e = Math.min(e, sr.endOffset);
      if (e <= s) continue;
      intervals.push({ start: en.baseStart + s, end: en.baseStart + e });
    }
    const merged = [];
    for (const it of intervals) { // 相邻文本节点都选中则接成一段
      const last = merged[merged.length - 1];
      if (last && last.end === it.start) last.end = it.end;
      else merged.push({ start: it.start, end: it.end });
    }
    return {
      base,
      segments: merged.map((m) => ({ start: m.start, length: m.end - m.start })).filter((sg) => sg.length > 0),
    };
  }

  /** 落一条做题痕迹：换算区间 → POST 落库 → 重放。两模式数据同源
   *  （作答模式拖动直标 / 查词模式气泡「标记」按钮）。 */
  async function saveNoteFromSelection(info) {
    if (!isNoteableSelection(info)) { setHint('标记失败：需单段落正文或题干内拖选', true); return false; }
    const sr = info.sel.getRangeAt(0);
    const para = paragraphOf(info.sel.anchorNode);
    const { base, segments } = noteSegmentsOf(para, sr);
    if (!segments.length) { setHint('标记失败：选区落在挖空等无效区', true); return false; }
    let text = '';
    for (const sg of segments) text += base.substr(sg.start, sg.length);
    if (!text.trim()) { setHint('标记失败：选中内容为空', true); return false; }
    // 定位字段：正文 para_index；题干 q_num + q_para_index（与查词标记口径一致）
    let paraIndex = null;
    let qNum = '';
    let qParaIndex = null;
    if (para.classList.contains('rd-q-p')) {
      const section = para.closest('.rd-q');
      qNum = String((section && section.getAttribute('data-num')) || '').trim();
      if (!qNum) { setHint('标记失败：题目定位失败', true); return false; }
      qParaIndex = Array.prototype.indexOf.call(section.querySelectorAll('.rd-q-p'), para);
      if (qParaIndex < 0) { setHint('标记失败：题目段落定位失败', true); return false; }
    } else if (para.classList.contains('rd-match-stem')) {
      const section = para.closest('.rd-match-q');
      qNum = String((section && section.getAttribute('data-num')) || '').trim();
      if (!qNum) { setHint('标记失败：匹配题定位失败', true); return false; }
      qParaIndex = 0;
    } else {
      const allParas = document.querySelectorAll('.rd-pass .reading-p');
      paraIndex = Array.prototype.indexOf.call(allParas, para);
      if (paraIndex < 0) { setHint('标记失败：正文段落定位失败', true); return false; }
    }
    try {
      const res = await api('/api/reading/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_id: textId, segments, text, para_index: paraIndex, q_num: qNum, q_para_index: qParaIndex }),
      });
      if (!res || res.ok === false) {
        setHint(res && res.error ? res.error : '标记失败', true);
        return false;
      }
      (window.RD_NOTES = window.RD_NOTES || []).push(res.note);
      rebuildNotes();
      try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
      setHint('已标记');
      return true;
    } catch (e) {
      setHint(e.message || '网络错误', true);
      return false;
    }
  }

  /** 按 segments 在段落基准文本上重放高亮：区间文本与存文不符（内容变更错位）→ 该段静默跳过；
   *  已在 .rd-note 内 → 幂等跳过。 */
  function wrapNoteSegments(para, note) {
    const { entries, base } = noteBaseEntries(para);
    const segs = Array.isArray(note.segments) ? note.segments : [];
    const text = String(note.text || '');
    let cum = 0;
    for (const sg of segs) {
      const start = sg && sg.start;
      const len = sg && sg.length;
      if (typeof start !== 'number' || typeof len !== 'number' || len <= 0) continue;
      const expect = text.substr(cum, len);
      cum += len;
      if (base.substr(start, len) !== expect) continue; // 内容变更：静默跳过防错标
      for (const en of entries) {
        const ns = en.baseStart;
        const ne = en.baseStart + en.node.nodeValue.length;
        const os = Math.max(start, ns);
        const oe = Math.min(start + len, ne);
        if (oe <= os) continue;
        if (en.node.parentElement && en.node.parentElement.closest('.rd-note')) continue; // 幂等
        const span = document.createElement('span');
        span.className = 'rd-note';
        span.setAttribute('data-nid', String(note.id || ''));
        const tail = en.node.splitText(oe - ns);
        const mid = en.node.splitText(os - ns);
        mid.parentNode.insertBefore(span, tail);
        span.appendChild(mid);
      }
    }
  }

  /** 痕迹全量重放：先拆旧再重放（与 rebuildMarks 同纪律——记录是唯一事实源）。
   *  定位路由：正文 para_index / 题干 q_num（.rd-q 与 .rd-match-q，q_para_index 定段）。 */
  function rebuildNotes() {
    document.querySelectorAll('.rd-pass .reading-p span.rd-note, .rd-qcard-body span.rd-note')
      .forEach((span) => {
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      });
    const notes = window.RD_NOTES || [];
    if (!notes.length) return;
    const paras = document.querySelectorAll('.rd-pass .reading-p');
    const qBody = $('rdQCardBody');
    for (const n of notes) {
      if (typeof n.para_index === 'number') {
        const para = paras[n.para_index];
        if (para) wrapNoteSegments(para, n);
        continue;
      }
      const qn = String(n.q_num || '');
      if (!qn || !qBody) continue;
      const sec = qBody.querySelector(`.rd-q[data-num="${CSS.escape(qn)}"], .rd-match-q[data-num="${CSS.escape(qn)}"]`);
      if (!sec) continue;
      const para = sec.querySelectorAll('.rd-q-p')[n.q_para_index]
        || (n.q_para_index === 0 ? sec.querySelector('.rd-match-stem') : null);
      if (para) wrapNoteSegments(para, n);
    }
  }

  // ---- 痕迹删除：点击高亮弹小浮层确认 ----
  let noteDel = null;

  function dismissNoteDel() {
    if (noteDel) { noteDel.remove(); noteDel = null; }
  }

  function openNoteDel(nid, rect) {
    dismissNoteDel();
    noteDel = document.createElement('div');
    noteDel.className = 'rd-note-del';
    noteDel.innerHTML = '<span>删除这条标记？</span>' +
      '<button type="button" class="btn ghost rd-note-del-cancel">取消</button>' +
      '<button type="button" class="btn primary rd-note-del-ok">删除</button>';
    document.body.appendChild(noteDel);
    let left = rect.left + rect.width / 2 - noteDel.offsetWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - noteDel.offsetWidth - 8));
    let top = rect.bottom + 6;
    if (top + noteDel.offsetHeight > window.innerHeight - 8) top = rect.top - noteDel.offsetHeight - 6;
    noteDel.style.left = `${left}px`;
    noteDel.style.top = `${Math.max(8, top)}px`;
    noteDel.querySelector('.rd-note-del-ok').addEventListener('click', async () => {
      try {
        const res = await api(`/api/reading/note/${encodeURIComponent(nid)}`, { method: 'DELETE' });
        if (res && res.ok) {
          window.RD_NOTES = (window.RD_NOTES || []).filter((x) => String(x.id) !== String(nid));
          rebuildNotes();
        } else {
          setHint((res && res.error) || '删除失败', true);
        }
      } catch (e) {
        setHint(e.message || '网络错误', true);
      }
      dismissNoteDel();
    });
    noteDel.querySelector('.rd-note-del-cancel').addEventListener('click', dismissNoteDel);
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target : null;
    if (el && el.closest('.rd-note')) {
      const nid = el.closest('.rd-note').getAttribute('data-nid');
      if (nid) openNoteDel(nid, el.closest('.rd-note').getBoundingClientRect());
      return;
    }
    if (noteDel && !noteDel.contains(ev.target)) dismissNoteDel();
  });

  // ---- 划词气泡：两模式统一弹出（作答模式划选是辅助阅读，点「标记」才落笔迹） ----
  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      snapSelectionToWord(); // 松手吸附：外显选区以单词为单位（须在 getSelectionInfo 前执行）
      const info = getSelectionInfo();
      if (info) showBubble(info);
    }, 0);
  });

  // ---- 禁用浏览器自带的双击选区（只允许滑动拖选）：拦第二次 mousedown 默认行为，
  //      双击查词改由 caret 取词，选区残留不再出现 ----
  document.addEventListener('mousedown', (ev) => {
    if (ev.detail > 1) ev.preventDefault();
  });

  /** 拖选松手后把选区两端吸附到词边界（只向外扩、不向内缩）：端点落在词内 → 扩到
   *  词首/词尾。「落在词内」= 边界两侧都是词字符（只看外侧会把选在标点上的端点
   *  扩成整个相邻词，违反验收「不吞标点、不扩到相邻词」）。字符集与 wordInfoAt
   *  一致（[A-Za-z'-]，don't、well-known 不截断），不跨文本节点、不跨段落；
   *  吸附后保留原生高亮（外显即整词）。setBaseAndExtent 会把选区正向化
   *  （anchor 左 focus 右），现有逻辑只有 isNoteableSelection 读 anchor/focus
   *  且仅判同段落，正向化无影响。 */
  function snapSelectionToWord() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (!inReadArea(sel.anchorNode) || !inReadArea(sel.focusNode)) return;
    const r = sel.getRangeAt(0);
    const sc = r.startContainer;
    const ec = r.endContainer;
    if (!sc || !ec || sc.nodeType !== 3 || ec.nodeType !== 3) return;
    const sv = sc.nodeValue;
    const ev = ec.nodeValue;
    const CH = /[A-Za-z'-]/;
    let s = r.startOffset;
    let e = r.endOffset;
    if (s < sv.length && CH.test(sv[s]) && s > 0 && CH.test(sv[s - 1])) {
      while (s > 0 && CH.test(sv[s - 1])) s--;
    }
    if (e > 0 && CH.test(ev[e - 1]) && e < ev.length && CH.test(ev[e])) {
      while (e < ev.length && CH.test(ev[e])) e++;
    }
    if (s === r.startOffset && e === r.endOffset) return; // 已在边界：不动选区，避免重置闪烁
    sel.setBaseAndExtent(sc, s, ec, e);
  }

  /** caret 取词（双击/右键共用）：光标处向两侧扩到词边界，临时入选区供查词管道
   *  读取（runLookup 同步段用完即清）。非字母词返回 null 并清掉选区。 */
  function wordInfoAt(x, y) {
    let pos = null;
    if (document.caretRangeFromPoint) {
      pos = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const cp = document.caretPositionFromPoint(x, y);
      if (cp) {
        pos = document.createRange();
        pos.setStart(cp.offsetNode, cp.offset);
        pos.collapse(true);
      }
    }
    if (!pos) return null;
    const node = pos.startContainer;
    if (!node || node.nodeType !== 3 || !inReadArea(node)) return null;
    const v = node.nodeValue;
    const CH = /[A-Za-z'-]/;
    let s = pos.startOffset;
    let e = pos.startOffset;
    while (s > 0 && CH.test(v[s - 1])) s--;
    while (e < v.length && CH.test(v[e])) e++;
    if (e <= s || !/[A-Za-z]/.test(v.slice(s, e))) return null; // 标点/空白处无词
    const r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const info = getSelectionInfo();
    if (!info || !/^[A-Za-z][A-Za-z''-]*$/.test(info.text)) {
      sel.removeAllRanges();
      return null;
    }
    return info;
  }

  /* ==================== 触屏点词（tap 取词 → 气泡确认；已入库词本地直出） ====================
   * 单击是触屏最高频动作、误点率高，多一次确认点击换零误查（省 AI 调用红线）；
   * 已入库词 data-gloss 本地直出（零调用）保证复看场景即点即得。 */
  document.addEventListener('pointerup', (ev) => {
    if (!isTouchEventSource(ev)) return; // 鼠标路径零改动（dblclick/右键/拖选照旧）
    const down = touchDown;
    touchDown = null;
    if (!down) return;
    // 滚动/滑动手势（位移 ≥10px）不是 tap：静默放行，不弹气泡不查询
    if (Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y) >= 10) return;
    // 有选区（长按选词 / 手柄扩选中）——交 selectionchange 气泡接管，不重复处理
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
    if (!el || !el.closest) return;
    if (!touchTapWordZone(el)) return; // 控件区：作答静默（tap 落点不在取词区）
    // 取词会主动设置选区（wordInfoAt）：加时间窗，窗口内的 selectionchange 不接管
    touchWordSelUntil = Date.now() + 400;
    let info = null;
    try { info = wordInfoAt(ev.clientX, ev.clientY); } catch (e) { info = null; }
    if (!info) { dismissBubble(); return; } // 词间空隙：什么都不做，收掉现有气泡
    // 已入库标记词：本地直出 data-gloss 进底部面板（零 AI 调用、不弹确认气泡）
    const anchor = info.sel.rangeCount ? info.sel.getRangeAt(0).startContainer : null;
    const anchorEl = anchor ? (anchor.nodeType === 1 ? anchor : anchor.parentElement) : null;
    const imported = anchorEl && anchorEl.closest ? anchorEl.closest('.rd-mark-imported') : null;
    if (imported && imported.getAttribute('data-gloss')) {
      lookupId = null;          // 无查词记录：存词直接走资产库管道
      lastSelText = info.text;  // 存词后标记升级/重放走原管道
      lastPos = positionOfSelection(info.sel, info.text);
      openCard(info, extractSentence(info.text), { head: info.text, meaning: imported.getAttribute('data-gloss'), pos: 'other' }, '');
      // 同一帧内清掉临时选区（与桌面双击直查同款）：蓝色高亮不残留
      setTimeout(() => { try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } }, 0);
      return;
    }
    // 新词：弹现有气泡挂词上方（查词/翻译按钮），用户确认后才 runLookup
    showBubble(info, { noNote: true });
  });

  /** 触屏 tap 取词区：正文/题干文本 + 判分后选项；作答控件静默（复用桌面排除链语义）。 */
  function touchTapWordZone(el) {
    if (el.closest('button:not(.rd-opt), a, input, textarea, select, .rd-blank, .rd-bank-item, .rd-note, .rd-para-letter, .rd-mode-toggle, .rd-qball, .rd-qcard-head, .rd-tabs, .rd-ask, .rd-card, .rd-bubble, .rd-picker-panel, .rd-note-del')) return false;
    const opt = el.closest('.rd-opt');
    if (opt) return opt.classList.contains('is-locked'); // 判分前=作答控件静默；判分后=纯文本可查
    return !!el.closest('.reading-p, .rd-q-p, .rd-match-stem');
  }

  /* ==================== 触屏长按选短语：响应系统选区（不自实现长按定时器） ====================
   * 系统长按自己会选中词/短语；选区在阅读区且非空（单词/多词均可）→ 气泡挂选区上方
   * （复用 showBubble 定位），选区变化气泡重新定位，选区清空气泡消失、不触发查询。 */
  document.addEventListener('selectionchange', () => {
    if (Date.now() < touchWordSelUntil) return; // 点词分支 JS 设的选区：由该分支自己管理
    if (!isTouchActive()) return;               // 鼠标来源：桌面 mouseup 气泡管道照旧（零改动）
    if (bubble && bubble.classList.contains('is-loading')) return; // 查询中：等结果面板接管
    const info = getSelectionInfo();
    if (info) showBubble(info);
    else dismissBubble();
  });

  // ---- 双击直查：不弹气泡（setHint 文字提示 loading），无浏览器选区残留 ----
  document.addEventListener('dblclick', (ev) => {
    const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
    if (!el || !el.closest) return;
    if (mouseMode === 'answer') {
      // 作答模式：作答控件（button：选项/挖空/tab 等）优先，题干正文照常双击直查
      if (el.closest('button, .rd-note, .rd-picker-panel, .rd-card, .rd-bubble, .rd-qball, .rd-ask, .rd-mode-toggle, input, textarea, select, a')) return;
    } else {
      // 查词模式：作答已静默，选项（.rd-opt）/词库（.rd-bank-item）当纯文本可双击；
      // 其余按钮（tab/对答案/问AI 等）与浮层仍排除
      if (el.closest('.rd-blank, .rd-picker-panel, .rd-card, .rd-bubble, .rd-qball, .rd-ask, .rd-note, .rd-mode-toggle, input, textarea, select, a, button:not(.rd-opt)')) return;
    }
    const info = wordInfoAt(ev.clientX, ev.clientY);
    if (!info) return;
    const para = paragraphOf(info.sel.anchorNode);
    if (!para) { try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } return; }
    if ((para.classList.contains('rd-bank-item') || para.classList.contains('rd-opt')) && mouseMode !== 'lookup') {
      try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
      return;
    }
    setHint('查询中…');
    runLookup('lookup', info); // runLookup 同步段读 selection，此后不再读
    // 同一帧内清掉临时选区：蓝色高亮不渲染，页面无选区残留
    setTimeout(() => { try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } }, 0);
  });

  // ---- 右键直查：两模式行为一致（右键不触发 click，与作答天然无冲突） ----
  document.addEventListener('contextmenu', (ev) => {
    const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
    if (!el || !el.closest) return;
    if (el.closest('.rd-picker-panel, .rd-card, .rd-bubble, .rd-qball, .rd-ask, .rd-note-del, .rd-mode-toggle, input, textarea, select, a, button:not(.rd-opt)')) return;
    if (!inReadArea(ev.target)) return; // 只管阅读区，其余放行原生菜单
    // 触屏长按在 Android 会触发 contextmenu（与 selectionchange 双触发）：压制系统菜单后
    // 直接返回、不查询——查询只从气泡确认走，防重复调 AI；鼠标来源走下方原路径（零改动）
    if (isTouchActive()) { ev.preventDefault(); return; }
    let info = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      // 鼠标点位于选区内 → 查整个选区（天然支持右键查短语）
      const r = sel.getRangeAt(0);
      let pointIn = false;
      for (const rect of r.getClientRects()) {
        if (ev.clientX >= rect.left - 1 && ev.clientX <= rect.right + 1
          && ev.clientY >= rect.top - 1 && ev.clientY <= rect.bottom + 1) { pointIn = true; break; }
      }
      if (pointIn) info = getSelectionInfo();
    }
    if (!info) info = wordInfoAt(ev.clientX, ev.clientY);
    if (!info || !info.text) return;
    ev.preventDefault();
    showBubble(info);
    runLookup('lookup', info);
  });

  // 正文/题干拖字禁止升级为原生拖放（drag 会吞掉 mouseup，气泡不弹）
  document.addEventListener('dragstart', (ev) => {
    const el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
    if (el && el.closest && el.closest('.reading-p, .rd-q-p, .rd-match-stem')) ev.preventDefault();
  });

  // ---- 悬浮球题目：可拖动球 + 可拖动卡片 + 全部就地展开（v7） ----
  const qBall = $('rdQBall');
  const qCard = $('rdQCard');

  if (qBall && qCard) {
    const BALL_POS_KEY = 'rd-qball-pos';

    // ---- 题目条未答题数（窄屏专属：720px 通栏形态下显示剩余题数；桌面保持总题数，零改动） ----
    let ballTotalQs = 0;
    const updateQBallCount = () => {
      if (!isNarrowScreen()) return; // 桌面：总题数由 init 设置，不动
      const answered = sections.reduce((n, s) => n + (s.questions || [])
        .filter((q) => answerState.answers[q.num]).length, 0);
      $('rdQBallNum').textContent = String(Math.max(0, ballTotalQs - answered));
    };
    // 跨断点转屏：回桌面恢复总题数显示
    if (narrowMq && narrowMq.addEventListener) {
      narrowMq.addEventListener('change', () => {
        if (!isNarrowScreen()) $('rdQBallNum').textContent = String(ballTotalQs);
      });
    }

    // ---- 卡片尺寸：右下角原生 resize 手柄拖拽，pointerup 时持久化 ----
    // 窄屏（720px）半屏面板形态：CSS resize:none 无手柄，尺寸不恢复、不持久化
    const CARD_SIZE_KEY = 'rd-qcard-size';
    try {
      const sz = JSON.parse(localStorage.getItem(CARD_SIZE_KEY) || 'null');
      if (!isNarrowScreen() && sz && typeof sz.w === 'number' && typeof sz.h === 'number') {
        qCard.style.width = `${sz.w}px`;
        qCard.style.height = `${sz.h}px`;
      }
    } catch (e) { /* ignore */ }
    qCard.addEventListener('pointerup', () => {
      if (isNarrowScreen()) return; // 窄屏：无 resize 手柄，不写尺寸记忆
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

    // 恢复上次位置（含贴边停靠态）——窄屏题目条形态不恢复（CSS 通栏接管，禁用位置记忆）
    if (!isNarrowScreen()) {
      try {
        const saved = JSON.parse(localStorage.getItem(BALL_POS_KEY) || 'null');
        if (saved && typeof saved.left === 'number') setBallPos(saved.left, saved.top, false, saved.docked || null);
      } catch (e) { /* ignore */ }
    }

    // ---- 题目面板：分篇 tab（v11 重构；v17 多视图：状态由 RD.init 注入） ----
    const qBody = $('rdQCardBody');
    const qPos = $('rdQPos');
    const tabsEl = $('rdTabs');
    let sections = [];  // 面板节（有题目/词库的节），init 注入
    let activeTab = 0;

    // 作答状态（init 注入；作答/判分后本地同步，刷新不丢——后端持久化）
    const answerState = { answer_key: {}, answer_key_source: '', answers: {}, judged: {}, revealed: {} };
    // 翻译节状态（init 注入；逐句作答/提示/对答案后本地同步，刷新不丢）
    let trState = null;
    let trCur = 0;          // 当前作答句下标（init 续作时跳到第一句未写的）
    let trView = 'sents';   // 'sents' 逐句作答 | 'full' 整段终态（全部写完才有意义）
    let trHintStage = {};   // 提示逐阶揭示进度：'句:词' → 1/2/3（纯前端态，不落库）
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
      if (s.kind === 'translation') return '翻译';
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
      // 对答案 + 问AI 同行；无答案键时问AI 置灰（点击提示先生成/导入答案）
      html += `<div class="rd-q-actions">` +
        (hasAnswerKey() ? `<button type="button" class="btn ghost rd-judge-btn" data-num="${escapeHtml(q.num)}"${picked && !judged ? '' : ' disabled'}>对答案</button>` : '') +
        `<button type="button" class="btn ghost rd-ask-btn${answerState.answer_key[q.num] ? '' : ' is-off'}" data-num="${escapeHtml(q.num)}">问AI</button></div>`;
      return html;
    };

    const renderBankTab = (s) => {
      // 词库总览：只读；标注每个词被哪空使用，判分红绿
      const usedBy = {};
      (s.questions || []).forEach((q) => {
        // reveal 的空已锁定显示正确答案：一律按答案键的正确词标记（错选词不占位，
        // 不管此前是否作答过——作答错再 reveal 时 answers 里还是错选，不能信）
        let a = answerState.answers[q.num];
        if (isRevealed(q.num)) a = answerState.answer_key[q.num];
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
          `<button type="button" class="btn ghost rd-ask-btn${answerState.answer_key[q.num] ? '' : ' is-off'}" data-num="${escapeHtml(q.num)}">问AI</button>` +
          '</div>';
      }).join('');
      return html;
    };

    // ---- 翻译节：逐句作答 + 阶梯提示 + 对答案（2026-11-17 规格） ----
    const trFirstPending = () => {
      const s = sections.find((x) => x.kind === 'translation');
      if (!s || !trState) return 0;
      const n = (s.sents || []).length;
      for (let i = 0; i < n; i++) {
        if (!trState.answers[String(i)]) return i;
      }
      return n ? n - 1 : 0;
    };

    const renderTrHintList = (i) => {
      const hints = (trState && trState.hints && trState.hints[String(i)]) || null;
      if (!hints) return '';
      const s = sections.find((x) => x.kind === 'translation');
      const cn = s ? (s.sents || [])[i] || '' : '';
      const evalRef = (trState.evals && trState.evals[String(i)] || {}).reference || '';
      return hints.map((h, k) => {
        const open = trHintStage[i + ':' + k];
        let detail = '';
        if (open) {
          detail = '<div class="rd-tr-hint-detail">'
            + (h.variants || []).map((v, vi) => {
              const isRec = v === h.recommended;
              // 例句优先 AI 参考句（已评价过），否则不带例句
              const ex = evalRef ? `${evalRef}||${cn}` : '';
              return `<div class="rd-tr-hint-variant${isRec ? ' rd-tr-hint-rec' : ''}">`
                + `${escapeHtml(v)}${isRec ? '<span class="rd-tr-hint-rec-tag">推荐</span>' : ''}`
                + `<button type="button" class="rd-tr-hint-save" data-i="${i}" data-k="${k}" data-v="${vi}" title="存入资产库（词头+中文释义+例句）">存入库</button></div>`;
            }).join('')
            + (h.note ? `<div class="rd-tr-hint-note">${escapeHtml(h.note)}</div>` : '')
            + '</div>';
        }
        return `<div class="rd-tr-hint-item">`
          + `<button type="button" class="rd-tr-hint-row${open ? ' rd-tr-hint-open' : ''}" data-i="${i}" data-k="${k}" data-open="${open ? 1 : 0}" title="点击展开这个词块的英文表达">`
          + `${escapeHtml(h.cn || '')}</button>${detail}</div>`;
      }).join('');
    };

    const renderTrEval = (i) => {
      const ev = trState.evals && trState.evals[String(i)];
      const cur = trState.answers[String(i)] || '';
      // 快照一致才展示（改写后的旧评价不误导）
      if (!ev || !cur || ev.answer !== cur || !ev.comment) return '';
      return '<div class="rd-tr-eval">'
        + `<div class="rd-tr-eval-comment">${escapeHtml(ev.comment)}</div>`
        + (ev.reference ? `<div class="rd-tr-eval-ref"><span class="rd-tr-tag rd-tr-tag-ai">参考</span><span>${escapeHtml(ev.reference)}</span></div>` : '')
        + '</div>';
    };

    const renderTrAnswer = (sents) => {
      const i = Math.min(trCur, sents.length - 1);
      trCur = i;
      const answered = sents.filter((_, k) => trState.answers[String(k)]).length;
      const allDone = answered === sents.length;
      const cur = trState.answers[String(i)] || '';
      const last = i === sents.length - 1;
      let html = `<div class="rd-tr-head">第 ${i + 1}/${sents.length} 句 · 已写 ${answered}/${sents.length}</div>`;
      html += `<p class="rd-tr-cn">${escapeHtml(sents[i])}</p>`;
      html += `<textarea class="rd-tr-input" id="rdTrInput" data-i="${i}" maxlength="2000" placeholder="写出这句的英文译文…">${escapeHtml(cur)}</textarea>`;
      html += renderTrEval(i);
      html += `<div class="rd-tr-hints" id="rdTrHints">${renderTrHintList(i)}</div>`;
      html += '<div class="rd-tr-actions">'
        + `<button type="button" class="btn ghost rd-tr-hint-btn" data-i="${i}">提示</button>`
        + `<button type="button" class="btn ghost rd-tr-eval-btn" data-i="${i}"${cur ? '' : ' disabled'}>AI 评价</button>`
        + (i > 0 ? `<button type="button" class="btn ghost rd-tr-prev" data-i="${i}">上一句</button>` : '')
        + (last
          ? (allDone ? `<button type="button" class="btn ghost rd-tr-full-btn">完成整段</button>` : '')
          : `<button type="button" class="btn ghost rd-tr-next" data-i="${i}"${cur ? '' : ' disabled'}>下一句</button>`)
        + (allDone && !last ? `<button type="button" class="btn ghost rd-tr-full-btn">完成整段</button>` : '')
        + '</div>';
      return html;
    };

    const renderTrFull = (s) => {
      const sents = s.sents || [];
      const answers = sents.map((_, i) => trState.answers[String(i)] || '');
      if (answers.some((a) => !a)) {
        // 有句被清空：自动跌回逐句作答
        trView = 'sents';
        return renderTrAnswer(sents);
      }
      let html = '<h4 class="rd-tab-h">整段完成</h4>';
      html += `<p class="rd-tr-full-cn">${escapeHtml(sents.join(''))}</p>`;
      html += `<div class="rd-tr-full-mine">${escapeHtml(answers.join(' '))}</div>`;
      // 逐句回改入口 + 各句评价状态
      html += '<div class="rd-tr-full-sents">' + sents.map((cn, i) => {
        const ev = (trState.evals || {})[String(i)];
        const fresh = ev && ev.answer === answers[i];
        return `<button type="button" class="rd-tr-full-sent${fresh && ev.comment ? ' rd-tr-full-sent-eved' : ''}" data-i="${i}" title="点击回到这句修改">`
          + `<span class="rd-tr-full-sent-idx">${i + 1}</span>`
          + `<span class="rd-tr-full-sent-cn">${escapeHtml(cn)}</span>`
          + `<span class="rd-tr-full-sent-mark">${fresh && ev.comment ? '已评' : '未评'}</span></button>`;
      }).join('') + '</div>';
      const fullEval = (trState.evals || {})['full'];
      const freshFull = fullEval && fullEval.answer === answers.join(' ');
      if (freshFull && fullEval.comment) {
        html += '<div class="rd-tr-eval rd-tr-eval-full">'
          + `<div class="rd-tr-eval-comment">${escapeHtml(fullEval.comment)}</div>`
          + (fullEval.reference ? `<div class="rd-tr-eval-ref"><span class="rd-tr-tag rd-tr-tag-ai">整段参考</span><span>${escapeHtml(fullEval.reference)}</span></div>` : '')
          + '</div>';
      }
      html += '<div class="rd-tr-actions">'
        + `<button type="button" class="btn ghost rd-tr-evalfull-btn"${freshFull ? ' disabled' : ''}>${freshFull ? '已整段评价' : '整段 AI 评价'}</button>`
        + `<button type="button" class="btn ghost rd-tr-backsents-btn">返回逐句</button>`
        + '</div>';
      return html;
    };

    const renderTranslationTab = (s) => {
      const sents = s.sents || [];
      if (!trState || !sents.length) return '<p class="rd-tr-empty">这篇没有翻译题</p>';
      return trView === 'full' ? renderTrFull(s) : renderTrAnswer(sents);
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
      if (s.kind === 'translation') html += renderTranslationTab(s);
      else if (s.kind === 'bank') html += renderBankTab(s);
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
        const m = /^([A-Z])\)/.exec(orig.trim());
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
        html = html.replace(/^(\s*)([A-Z])\)/, '$1<span class="rd-para-letter" data-letter="$2">$2)</span>');
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
      rebuildNotes();
      updateQBallCount(); // 窄屏题目条：未答题数随作答刷新（桌面不动）
    };

    const doJudge = async (payload) => {
      const data = await post(`/api/reading/${textId}/judge`, payload);
      Object.assign(answerState.judged, data.result || {});
      rerender();
    };

    qBody.addEventListener('click', async (ev) => {
      const opt = ev.target.closest('.rd-opt');
      if (opt) {
        if (mouseMode !== 'answer') return; // 查词模式：作答静默，选项当纯文本
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

    // ---- 翻译节交互（委托在 qBody：词块提示 / AI 评价 / 翻句 / 词块存库） ----
    const saveTrAnswer = async () => {
      const el = $('rdTrInput');
      if (!el || !trState) return true;
      const i = Number(el.dataset.i) || 0;
      const val = el.value.trim();
      try {
        await post(`/api/reading/${textId}/translation/answer`, { sent_idx: i, text: val });
        if (val) trState.answers[String(i)] = val;
        else delete trState.answers[String(i)];
        return true;
      } catch (e) {
        alert(e.message);
        return false;
      }
    };

    qBody.addEventListener('click', async (ev) => {
      const hintBtn = ev.target.closest('.rd-tr-hint-btn');
      if (hintBtn && !hintBtn.disabled) {
        const i = Number(hintBtn.dataset.i) || 0;
        const host = $('rdTrHints');
        if (host) host.innerHTML = '<span class="rd-tr-hint-loading">生成中…（已生成过的不重复调用）</span>';
        try {
          const data = await post(`/api/reading/${textId}/translation/hint`, { sent_idx: i });
          trState.hints = trState.hints || {};
          trState.hints[String(i)] = data.hints || [];
          if (host) host.innerHTML = renderTrHintList(i);
        } catch (e) {
          if (host) host.innerHTML = '';
          alert(e.message);
        }
        return;
      }
      const row = ev.target.closest('.rd-tr-hint-row');
      if (row) {
        // 点中文按钮 → 展开/收起该词块的多种表达 + 推荐标记（选择权在用户：知道自己缺哪个）
        const key = row.dataset.i + ':' + row.dataset.k;
        trHintStage[key] = !trHintStage[key];
        const host = $('rdTrHints');
        if (host) host.innerHTML = renderTrHintList(Number(row.dataset.i) || 0);
        return;
      }
      const evalBtn = ev.target.closest('.rd-tr-eval-btn');
      if (evalBtn && !evalBtn.disabled) {
        // 逐句 AI 评价：先落译文（后端按快照判断是否需要重新评价）
        if (!(await saveTrAnswer())) return;
        evalBtn.disabled = true;
        evalBtn.textContent = '评价中…';
        const i = Number(evalBtn.dataset.i) || 0;
        try {
          const data = await post(`/api/reading/${textId}/translation/evaluate`, { sent_idx: i });
          trState.evals = trState.evals || {};
          trState.evals[String(i)] = data.eval;
          renderPanel();
        } catch (e) {
          alert(e.message);
          evalBtn.disabled = false;
          evalBtn.textContent = 'AI 评价';
        }
        return;
      }
      const saveBtn = ev.target.closest('.rd-tr-hint-save');
      if (saveBtn && !saveBtn.disabled) {
        // 反思沉淀：学到的词块一键入资产库（word=表达，释义=中文词块，例句=AI 参考句）
        const i = Number(saveBtn.dataset.i) || 0;
        const k = Number(saveBtn.dataset.k) || 0;
        const vi = Number(saveBtn.dataset.v) || 0;
        const h = (trState.hints || {})[String(i)] || [];
        const block = h[k];
        const word = block && (block.variants || [])[vi];
        if (!word) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '入库中…';
        const s = sections.find((x) => x.kind === 'translation');
        const cn = s ? (s.sents || [])[i] || '' : '';
        const evalRef = (trState.evals && trState.evals[String(i)] || {}).reference || '';
        const examples = evalRef ? `${evalRef}||${cn}` : '';
        try {
          await post('/api/assets/vocab', {
            word, pos: 'other', meaning: block.cn || '',
            examples, source: '四级翻译',
          });
          saveBtn.textContent = '已入库';
        } catch (e) {
          alert(e.message);
          saveBtn.disabled = false;
          saveBtn.textContent = '存入库';
        }
        return;
      }
      const fullBtn = ev.target.closest('.rd-tr-full-btn');
      if (fullBtn) {
        // 完成整段：落当前译文后进终态视图
        if (await saveTrAnswer()) { trView = 'full'; renderPanel(); }
        return;
      }
      const backsents = ev.target.closest('.rd-tr-backsents-btn');
      if (backsents) {
        trView = 'sents';
        renderPanel();
        return;
      }
      const evalFullBtn = ev.target.closest('.rd-tr-evalfull-btn');
      if (evalFullBtn && !evalFullBtn.disabled) {
        evalFullBtn.disabled = true;
        evalFullBtn.textContent = '整段评价中…';
        try {
          const data = await post(`/api/reading/${textId}/translation/evaluate`, { full: true });
          trState.evals = trState.evals || {};
          trState.evals['full'] = data.eval;
          renderPanel();
        } catch (e) {
          alert(e.message);
          evalFullBtn.disabled = false;
          evalFullBtn.textContent = '整段 AI 评价';
        }
        return;
      }
      const sentBack = ev.target.closest('.rd-tr-full-sent');
      if (sentBack) {
        // 点某句 → 回逐句作答修改该句（trHintStage 不清：词块提示仍缓存）
        trCur = Number(sentBack.dataset.i) || 0;
        trView = 'sents';
        renderPanel();
        return;
      }
      const prev = ev.target.closest('.rd-tr-prev');
      if (prev) {
        const i = Number(prev.dataset.i) || 0;
        if (await saveTrAnswer()) { trCur = Math.max(0, i - 1); renderPanel(); }
        return;
      }
      const next = ev.target.closest('.rd-tr-next');
      if (next && !next.disabled) {
        const i = Number(next.dataset.i) || 0;
        if (await saveTrAnswer()) { trCur = i + 1; renderPanel(); }
        return;
      }
    });

    // 输入联动：译文非空才放行「下一句/AI 评价」（disabled 不能只在渲染时固化，
    // 用户随后输入不会自动解锁按钮——disabled 按钮点击不触发事件，表现为无响应）
    qBody.addEventListener('input', (ev) => {
      if (!ev.target || ev.target.id !== 'rdTrInput' || !trState) return;
      const has = ev.target.value.trim().length > 0;
      const next = qBody.querySelector('.rd-tr-next');
      const evalBtn = qBody.querySelector('.rd-tr-eval-btn');
      if (next) next.disabled = !has;
      if (evalBtn) evalBtn.disabled = !has;
    });

    // 失焦静默保存：切 tab / 收卡片 / 关页面前不丢已写的译文
    qBody.addEventListener('focusout', (ev) => {
      if (ev.target && ev.target.id === 'rdTrInput' && trState) saveTrAnswer();
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
      if (isNarrowScreen()) return;           // 窄屏：CSS 半屏形态接管（fixed 通栏），不做 JS 定位
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
      // 窄屏题目条常驻（半屏面板 bottom:48px 叠在条上方），不隐藏；桌面开卡=球隐藏
      if (!isNarrowScreen()) qBall.style.display = 'none';
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
      // 窄屏：无卡片位置记忆；清行内隐藏（桌面开卡中途缩窗的兜底），题目条本就常驻
      if (isNarrowScreen()) { qBall.style.display = ''; return; }
      try {
        localStorage.setItem(CARD_POS_KEY, JSON.stringify({ left: cr.left, top: cr.top }));
      } catch (e) { /* ignore */ }
      setBallPos(cr.left, cr.top, true);
      qBall.style.display = '';
    };

    // ---- 悬浮球拖动（pointer capture；位移 <4px 视为点击） ----
    // 窄屏题目条形态：无拖动、无位置记忆，tap 即开合（形态与行为同走断点）；
    // 滑动手势（题目条上滚动页面）不做开合——位移 ≥10px 一律静默
    let ballDrag = null;
    let barTapStart = null; // 窄屏题目条 tap 起点
    qBall.addEventListener('pointerdown', (ev) => {
      if (isNarrowScreen()) { barTapStart = { x: ev.clientX, y: ev.clientY }; return; }
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
    qBall.addEventListener('pointerup', (ev) => {
      if (isNarrowScreen()) {
        // 题目条 tap = 展开/收起半屏面板（滑动 ≥10px 不算 tap，防滚动误开合）
        const st = barTapStart;
        barTapStart = null;
        if (st && Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) >= 10) return;
        if (qCard.hidden) openCard(); else closeCard();
        return;
      }
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
    qBall.addEventListener('pointercancel', () => { ballDrag = null; barTapStart = null; });

    // ---- 卡片拖动：头部空白区为手柄（按钮除外） ----
    let cardDrag = null;
    const cardHead = qCard.querySelector('.rd-qcard-head');
    cardHead.addEventListener('pointerdown', (ev) => {
      if (isNarrowScreen()) return; // 窄屏半屏面板：头部纯展示（顶部把手条装饰），禁拖动
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
      const askBtn = `<button type="button" class="btn ghost rd-ask-btn${answerState.answer_key[n] ? '' : ' is-off'}" data-num="${escapeHtml(n)}">问AI</button>`;
      openPicker(`<div class="rd-key-panel rd-picker-panel"><h3>第 ${escapeHtml(n)} 空 · 选词</h3>` +
        `<div class="rd-picker-list rd-picker-bank">${items}</div>` +
        `<div class="rd-key-actions">${revealBtn}${askBtn}<button type="button" class="btn ghost rd-key-cancel">关闭</button></div></div>`);
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
      const askBtn = ev.target.closest('.rd-ask-btn');
      if (askBtn) {
        // 无该题答案：置灰态点击提示（不用 disabled，保留提示入口）
        if (!answerState.answer_key[askBtn.dataset.num]) {
          alert('这题还没有标准答案，请先「AI 出答案」或「导入答案」');
          return;
        }
        openAsk(askBtn.dataset.num);
        return;
      }
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
        // 划选挖空里的词查词时不弹选词层（拖选会触发 click，选区非空即视为选词）
        if (!locked && mouseMode === 'answer' && !String(window.getSelection() || '').trim()) { openBankPicker(n); return; }
      }
      const letter = ev.target.closest('.rd-para-letter');
      if (letter) {
        if (mouseMode === 'answer') openMatchPicker(letter.dataset.letter); // 查词模式：选题静默
        return;
      }
    });

    // ---- 题目问 AI：逐题聊天浮窗（默认简析 → 自由追问，会话按题持久化） ----
    let askWin = null;
    let askNum = '';         // 当前窗口绑定的题号
    let askSeq = 0;          // 请求序号：只认最后一次
    let askRetryMsg = null;  // 发送失败待重试的用户消息（null=无待重试）

    const askMsgsEl = () => askWin.querySelector('.rd-ask-msgs');
    const askErrEl = () => askWin.querySelector('.rd-ask-err');
    const askInputEl = () => askWin.querySelector('.rd-ask-text');

    function renderAskMsgs(msgs) {
      const box = askMsgsEl();
      box.innerHTML = (msgs || []).map((m) =>
        `<div class="rd-ask-msg ${m.role === 'ai' ? 'is-ai' : 'is-user'}">${escapeHtml(m.content || '')}</div>`).join('');
      box.scrollTop = box.scrollHeight;
    }

    function setAskBusy(busy) {
      askInputEl().disabled = busy;
      askWin.querySelector('.rd-ask-send').disabled = busy;
      askWin.classList.toggle('is-busy', busy);
    }

    function showAskErr(msg) {
      const err = askErrEl();
      err.querySelector('.rd-ask-errmsg').textContent = msg || '请求失败';
      err.hidden = false;
    }

    async function sendAsk(message) {
      const mySeq = ++askSeq;
      const text = String(message || '').trim();
      askRetryMsg = text || null;
      askErrEl().hidden = true;
      setAskBusy(true);
      // 等待占位气泡：请求成功由全量消息替换，失败移除
      askMsgsEl().insertAdjacentHTML('beforeend',
        '<div class="rd-ask-msg is-ai rd-ask-waiting">正在解析…</div>');
      askMsgsEl().scrollTop = askMsgsEl().scrollHeight;
      try {
        const data = await post(`/api/reading/${textId}/ask/${encodeURIComponent(askNum)}`, { message: text });
        if (mySeq !== askSeq) return;
        askRetryMsg = null;
        renderAskMsgs(data.messages);
      } catch (e) {
        if (mySeq !== askSeq) return;
        askWin.querySelector('.rd-ask-waiting').remove();
        showAskErr(e.message);
      } finally {
        if (mySeq === askSeq) setAskBusy(false);
      }
    }

    function placeAskWin() {
      // 每次打开：窄屏居中、宽屏居中偏右（规格：位置不持久化）；拖动后本次打开内保持
      const w = askWin.offsetWidth || 420;
      const vw = window.innerWidth;
      const left = vw < 640
        ? Math.max(8, Math.round((vw - w) / 2))
        : Math.max(12, Math.min(Math.round(vw * 0.56), vw - w - 24));
      const top = Math.max(12, Math.round(window.innerHeight * 0.08));
      askWin.style.left = `${left}px`;
      askWin.style.top = `${top}px`;
      askWin.style.right = 'auto';
    }

    async function openAsk(num) {
      if (!askWin) buildAskWin();
      askNum = String(num);
      askSeq++; // 使此前在途请求全部失效
      askRetryMsg = null;
      askWin.hidden = false;
      askWin.style.left = '';
      askWin.style.top = '';
      placeAskWin();
      askWin.querySelector('.rd-ask-title').textContent = `第 ${num} 题 · 问 AI`;
      renderAskMsgs([]);
      askErrEl().hidden = true;
      setAskBusy(false);
      askInputEl().value = '';
      // 先回看历史；无历史自动发起首轮简析（零门槛，不用先打字）
      try {
        const res = await api(`/api/reading/${textId}/ask/${encodeURIComponent(num)}`);
        if (String(num) !== askNum) return;
        if (!res.ok) { showAskErr(res.error); return; }
        if ((res.messages || []).length) {
          renderAskMsgs(res.messages);
          askInputEl().focus();
        } else {
          sendAsk('');
        }
      } catch (e) {
        showAskErr(e.message || '网络错误');
      }
    }

    function buildAskWin() {
      askWin = document.createElement('div');
      askWin.className = 'rd-ask';
      askWin.hidden = true;
      askWin.innerHTML = `
        <header class="rd-ask-head">
          <span class="rd-ask-title"></span>
          <button type="button" class="btn ghost rd-ask-close" title="收起">✕</button>
        </header>
        <div class="rd-ask-msgs"></div>
        <div class="rd-ask-err" hidden><span class="rd-ask-errmsg"></span><button type="button" class="btn ghost rd-ask-retry">重试</button></div>
        <div class="rd-ask-input">
          <textarea class="rd-ask-text" rows="2" placeholder="没懂就追问，也可以说说你的想法"></textarea>
          <button type="button" class="btn primary rd-ask-send">发送</button>
        </div>
        <div class="rd-ask-resize" title="拖动调整大小"></div>`;
      document.body.appendChild(askWin);

      // 头部拖动（按钮除外，同题目卡片的 pointer capture 手法）
      // clamp 保证至少 160px 留在屏内——窗口永远拖不丢、随时抓得回来
      const head = askWin.querySelector('.rd-ask-head');
      let askDrag = null;
      head.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.btn')) return;
        const rect = askWin.getBoundingClientRect();
        askDrag = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
        head.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      head.addEventListener('pointermove', (ev) => {
        if (!askDrag) return;
        const left = Math.max(-askWin.offsetWidth + 160, Math.min(askDrag.left + ev.clientX - askDrag.x, window.innerWidth - 160));
        const top = Math.max(0, Math.min(askDrag.top + ev.clientY - askDrag.y, window.innerHeight - 160));
        askWin.style.left = `${left}px`;
        askWin.style.top = `${top}px`;
      });
      const endAskDrag = () => { askDrag = null; };
      head.addEventListener('pointerup', endAskDrag);
      head.addEventListener('pointercancel', endAskDrag);

      // 右下角拖动调整大小（首次拖动后才写入显式宽高，覆盖 CSS 默认值）
      const rz = askWin.querySelector('.rd-ask-resize');
      let askRz = null;
      rz.addEventListener('pointerdown', (ev) => {
        const rect = askWin.getBoundingClientRect();
        askRz = { x: ev.clientX, y: ev.clientY, w: rect.width, h: rect.height };
        rz.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        ev.stopPropagation();
      });
      rz.addEventListener('pointermove', (ev) => {
        if (!askRz) return;
        const w = Math.max(300, Math.min(askRz.w + ev.clientX - askRz.x, window.innerWidth - 16));
        const h = Math.max(260, Math.min(askRz.h + ev.clientY - askRz.y, window.innerHeight - 16));
        askWin.style.width = `${Math.round(w)}px`;
        askWin.style.height = `${Math.round(h)}px`;
        askWin.style.maxHeight = 'none'; // 显式高度接管，解除 80vh 上限
      });
      const endAskRz = () => { askRz = null; };
      rz.addEventListener('pointerup', endAskRz);
      rz.addEventListener('pointercancel', endAskRz);

      askWin.querySelector('.rd-ask-close').addEventListener('click', () => { askWin.hidden = true; });
      askWin.querySelector('.rd-ask-send').addEventListener('click', () => {
        const val = askInputEl().value.trim();
        if (!val) { askInputEl().focus(); return; }
        askInputEl().value = '';
        sendAsk(val);
      });
      askWin.querySelector('.rd-ask-retry').addEventListener('click', () => {
        sendAsk(askRetryMsg || '');
      });
      // Enter 发送 / Shift+Enter 换行（聊天窗惯例）
      askInputEl().addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          askWin.querySelector('.rd-ask-send').click();
        }
      });
    }

    const closeAsk = () => { if (askWin && !askWin.hidden) askWin.hidden = true; };
    window.__rdCloseAsk = closeAsk;

    // ---- 鼠标模式分段开关：作答（默认）| 查词。唯一状态源是 mouseMode，
    //      切换时收起现场交互，防止跨模式残留气泡/选词层/卡/选区 ----
    const modeToggle = $('rdModeToggle');
    if (modeToggle) {
      const modeBtns = modeToggle.querySelectorAll('.rd-mode-btn');
      const applyModeUi = () => {
        modeBtns.forEach((b) => { b.classList.toggle('is-active', b.dataset.mode === mouseMode); });
        document.body.classList.toggle('rd-mode-lookup', mouseMode === 'lookup');
      };
      modeBtns.forEach((b) => b.addEventListener('click', () => {
        const m = b.dataset.mode === 'lookup' ? 'lookup' : 'answer';
        if (m === mouseMode) return;
        mouseMode = m;
        try { localStorage.setItem('rd-mouse-mode', m); } catch (e) { /* ignore */ }
        applyModeUi();
        dismissBubble();
        dismissCard();
        closePicker();
        closeAsk();
        dismissNoteDel();
        try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
      }));
      applyModeUi();
    }

    // ---- 多视图初始化：script.js 侧栏切换或 RD_BOOT 直链调用，文章可反复切换 ----
    function init(payload, opts) {
      opts = opts || {};
      const text = (payload && payload.text) || {};
      textId = String(text.id || '');
      source = String(text.source || '');
      window.RD_MARKS = payload.lookup_marks || [];
      window.RD_NOTES = payload.lookup_notes || [];

      const all = payload.sections || [];
      sections = all.filter((s) => (s.questions || []).length || (s.bank || []).length || s.kind === 'translation');

      const st = payload.answer_state || {};
      answerState.answer_key = st.answer_key || {};
      answerKeyNow = answerState.answer_key;
      answerState.answers = st.answers || {};
      answerState.judged = st.judged || {};
      answerState.revealed = st.revealed || {};
      answerState.answer_key_source = st.answer_key_source || '';

      // 翻译节状态注入 + 续作定位（第一句未写的；全写完停在最后一句）
      trState = payload.translation || null;
      trHintStage = {};
      trCur = trState ? trFirstPending() : 0;
      // 全部写完 → 默认进整段终态视图；否则逐句作答
      trView = 'sents';
      if (trState) {
        const s0 = sections.find((x) => x.kind === 'translation');
        const n0 = (s0 && s0.sents || []).length;
        if (n0 && n0 === Object.keys(trState.answers || {}).length) trView = 'full';
      }

      // 标题 / 来源 / 正文（顺序与后端 para_index 定位一致）
      $('rdTitle').textContent = text.title || '';
      const srcEl = $('rdSourceTag');
      srcEl.textContent = text.source ? `来源 · ${text.source}` : '';
      srcEl.style.display = text.source ? '' : 'none';
      renderArticle(all);

      // 旧交互清理：气泡 / 弹层 / 选题层 / 题卡 / 问AI窗归位
      dismissBubble();
      dismissCard();
      closePicker();
      closeAsk();
      askSeq++; // 在途问AI请求全部失效（防旧文章响应渲染进新文章的窗口）
      qCard.hidden = true;
      qCard.style.left = '';
      qCard.style.top = '';
      document.querySelectorAll('.rd-bubble, .rd-toast').forEach((el) => el.remove());

      // 悬浮球与顶栏工具条：有题才出现（正文卡片自带隐藏态）
      const totalQs = sections.reduce((n, s) => n + (s.questions || []).length, 0);
      const hasQ = totalQs > 0;
      qBall.hidden = !hasQ;
      qBall.style.display = ''; // 清掉 openCard 遗留的行内隐藏，防止跨视图切换后悬浮球永久消失
      ballTotalQs = totalQs;
      $('rdQBallNum').textContent = String(totalQs);
      updateQBallCount(); // 窄屏题目条显示未答题数（桌面保持总题数）
      document.querySelectorAll('.rd-toolbar-only').forEach((b) => { b.hidden = !hasQ; });

      // 渲染：空块 / 段落徽章 / 查词标记重放 / 面板 / 做题痕迹重放
      activeTab = 0;
      renderBlanks();
      renderParaBadges();
      markBodyMarks();
      renderPanel();
      rebuildNotes();

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
      // 默认自动 AI 出答案（用户拍板：防止查词时不知道原文是什么、错选被当语境）。
      // 触发条件：有题目 + 无答案键；成功后落库 source='ai'，之后再打开不再触发。
      // sessionStorage 防重：生成中刷新页面不重复烧调用；失败清除，下次打开重试。
      // 有标准答案随时可点「导入答案」覆盖。
      if (hasQ && Object.keys(answerKeyNow || {}).length === 0) {
        const flag = 'rd_key_ai_' + textId;
        let pending = false;
        try { pending = sessionStorage.getItem(flag) === '1'; } catch (e) { /* ignore */ }
        if (!pending) {
          try { sessionStorage.setItem(flag, '1'); } catch (e) { /* ignore */ }
          post(`/api/reading/${textId}/answer_key/ai`, {}).then((data) => {
            if (data && data.key) {
              answerState.answer_key = data.key;
              answerKeyNow = data.key;
              answerState.answer_key_source = 'ai';
              rerender();
              const toast = document.createElement('div');
              toast.className = 'rd-toast';
              toast.textContent = `AI 已生成 ${data.count} 题答案（仅供参考，做题不受影响）；有标准答案可点「导入答案」覆盖`;
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 6000);
            } else {
              try { sessionStorage.removeItem(flag); } catch (e) { /* ignore */ }
            }
          }).catch(() => {
            try { sessionStorage.removeItem(flag); } catch (e) { /* ignore */ }
          });
        }
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
              if (data.key) { answerState.answer_key = data.key; answerKeyNow = data.key; }
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
          if (data.key) { answerState.answer_key = data.key; answerKeyNow = data.key; }
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
    if (noteDel && noteDel.contains(ev.target)) return;
    // 点空白处收起气泡与卡片（点阅读区/题目卡/悬浮球/弹层内部除外）
    if (card && !ev.target.closest('.reading-article, .rd-qcard, .rd-qball, .rd-picker-panel')) dismissCard();
    dismissBubble();
    if (noteDel) dismissNoteDel();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      dismissCard();
      dismissBubble();
      dismissNoteDel();
      if (window.__rdCloseAsk) window.__rdCloseAsk();
      if (window.__rdCloseCard) window.__rdCloseCard();
    }
  });

  // 主界面直链：/?read=<id> 服务端注入 RD_BOOT，加载即渲染阅读视图（宿主显隐由 script.js 负责）
  if (window.RD_BOOT && window.RD) {
    window.RD.init(window.RD_BOOT, { sec: window.RD_BOOT.sec || '', paper: window.RD_BOOT.paper || '' });
  }
})();
