(function () {
  const $ = (id) => document.getElementById(id);

  // 从阅读页跳转过来时，顶栏显示「返回阅读」直达通道
  (function backToReading() {
    const el = $('backToReading');
    if (!el) return;
    try {
      const back = new URLSearchParams(location.search).get('back') || '';
      if (back.startsWith('/reading/')) {
        el.href = back;
        el.hidden = false;
      }
    } catch (e) { /* ignore */ }
  })();

  let posOptions = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'phr.', 'other'];
  let selectedPoses = [];
  let fixedPhrase = false;
  let relatedPos = 'n.';
  let relatedDraft = [];
  /** @type {{ text: string, meaning: string, examples: string, source: string }[]} */
  let phraseDraft = [];
  /** @type {{ pos: string, meaning: string, examples: string, source: string }[]} */
  let senseDraft = [];
  let cache = [];
  let activeId = null;
  let searchTimer = null;
  let pendingLinkFrom = null;
  let pendingLinkExample = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const SOURCE_KEY = 'assetsLastSource';

  function stickySource() {
    try { return localStorage.getItem(SOURCE_KEY) || ''; } catch (e) { return ''; }
  }

  function rememberSource(senses) {
    const src = (senses || []).map((s) => (s.source || '').trim()).find(Boolean);
    if (!src) return;
    try { localStorage.setItem(SOURCE_KEY, src); } catch (e) { /* ignore */ }
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

  function setHint(msg, isErr) {
    const el = $('vocabHint');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('is-err', !!isErr);
  }

  function syncSenseDraftFromDom() {
    const host = $('senseBlocks');
    if (!host) return;
    host.querySelectorAll('.sense-block').forEach((block) => {
      const pos = block.getAttribute('data-pos') || '';
      const slot = senseDraft.find((s) => s.pos === pos);
      if (!slot) return;
      const meaning = block.querySelector('.sense-meaning');
      const examples = block.querySelector('.sense-examples');
      const source = block.querySelector('.sense-source');
      slot.meaning = meaning ? meaning.value : slot.meaning;
      // 例句框在同句再录模式下隐藏，此时保留草稿原值不清空
      slot.examples = examples ? examples.value : slot.examples;
      slot.source = source ? source.value : slot.source;
    });
  }

  function syncSenseDraftToSelectedPoses() {
    syncSenseDraftFromDom();
    const byPos = {};
    senseDraft.forEach((s) => {
      byPos[s.pos] = s;
    });
    const next = selectedPoses.map((pos) => (
      byPos[pos] || { pos, meaning: '', examples: '', source: stickySource() }
    ));
    senseDraft = next;
  }

  function renderPosMultiPills() {
    const host = $('posMultiPills');
    if (!host) return;
    host.innerHTML = posOptions.map((p) => (
      `<button type="button" class="pos-pill${selectedPoses.indexOf(p) >= 0 ? ' is-on' : ''}" data-pos="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    )).join('');
    host.querySelectorAll('.pos-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-pos') || 'other';
        syncSenseDraftFromDom();
        const idx = selectedPoses.indexOf(p);
        if (idx >= 0) {
          selectedPoses.splice(idx, 1);
        } else {
          if (selectedPoses.length >= 20) {
            setHint('一次最多 20 个词性', true);
            return;
          }
          selectedPoses.push(p);
          // 按 posOptions 顺序排列
          selectedPoses.sort((a, b) => posOptions.indexOf(a) - posOptions.indexOf(b));
        }
        setHint('');
        syncSenseDraftToSelectedPoses();
        renderPosMultiPills();
        renderSenseBlocks();
      });
    });
  }

  function renderSenseBlocks() {
    const host = $('senseBlocks');
    if (!host) return;
    if (!senseDraft.length) {
      host.innerHTML = '<p class="vocab-empty">请先点选上方词性（点几个出几个输入框）</p>';
      return;
    }
    // 同句再录模式：原句由横幅携带，隐藏例句输入框
    const hideExamples = !!pendingLinkFrom;
    host.innerHTML = senseDraft.map((s, i) => (
      `<div class="sense-block" data-i="${i}" data-pos="${escapeHtml(s.pos)}">` +
      `<div class="sense-block-head">` +
      `<span class="sense-pos-badge">${escapeHtml(s.pos)}</span>` +
      `<span class="sense-block-label">${fixedPhrase && s.pos === 'phr.' ? '固定短语' : `义项 · ${escapeHtml(s.pos)}`}</span>` +
      `</div>` +
      `<label class="vocab-label" for="senseMeaning${i}">释义 <span class="opt">选填</span></label>` +
      `<input class="sense-meaning" id="senseMeaning${i}" type="text" maxlength="500" value="${escapeHtml(s.meaning)}" placeholder="该词性下的释义">` +
      (hideExamples ? '' :
        `<label class="vocab-label" for="senseExamples${i}">例句 <span class="opt">英 || 中</span></label>` +
        `<textarea class="sense-examples" id="senseExamples${i}" rows="3" placeholder="例句…">${escapeHtml(s.examples)}</textarea>`) +
      `<label class="vocab-label" for="senseSource${i}">例句来源 <span class="opt">选填</span></label>` +
      `<input class="sense-source" id="senseSource${i}" type="text" maxlength="200" value="${escapeHtml(s.source || '')}" placeholder="如：四级真题 2020-6">` +
      `<div class="sense-ex-actions">` +
      `<button type="button" class="cosent-again" data-cosent-sense="${i}">同句再录</button>` +
      `<span class="sense-ex-hint">先存当前词，再用本句录下一个</span>` +
      `</div>` +
      `</div>`
    )).join('');

    host.querySelectorAll('.cosent-again[data-cosent-sense]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-cosent-sense'));
        onFormCoSent(i);
      });
    });
  }

  function setFixedPhrase(on) {
    fixedPhrase = !!on;
    const section = $('posSection');
    if (section) section.hidden = fixedPhrase;
    if (fixedPhrase) {
      selectedPoses = ['phr.'];
      senseDraft = [{ pos: 'phr.', meaning: '', examples: '', source: stickySource() }];
    } else {
      selectedPoses = [];
      senseDraft = [];
    }
    renderPosMultiPills();
    renderSenseBlocks();
    setHint('');
  }

  function resetSenseDraft() {
    selectedPoses = [];
    senseDraft = [];
    renderPosMultiPills();
    renderSenseBlocks();
  }

  function parseExampleField(raw) {
    const s = String(raw || '').trim();
    if (!s) return { en: '', zh: '' };
    // 单个换行视为句内软换行（PDF 粘贴常带硬换行），空行才是例句分隔符
    const blocks = s.replace(/\r\n/g, '\n').split(/\n\s*\n/);
    const first = blocks.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)[0] || '';
    if (first.includes('||')) {
      const idx = first.indexOf('||');
      return { en: first.slice(0, idx).trim(), zh: first.slice(idx + 2).trim() };
    }
    return { en: first, zh: '' };
  }

  async function onFormCoSent(senseIndex) {
    syncSenseDraftFromDom();
    const word = ($('vocabWord') && $('vocabWord').value || '').trim();
    if (!word) {
      setHint('请先填写当前单词，再同句再录', true);
      $('vocabWord') && $('vocabWord').focus();
      return;
    }
    const senses = collectSenses();
    const block = senses[senseIndex] || senses[0];
    const blockEx = parseExampleField(block && block.examples);
    let chain = null;
    if (blockEx.en || blockEx.zh) {
      chain = {
        en: blockEx.en,
        zh: blockEx.zh,
        source: ((block && block.source) || '').trim(),
      };
    } else if (pendingLinkExample && (pendingLinkExample.en || pendingLinkExample.zh)) {
      chain = pendingLinkExample;
    }
    if (!chain) {
      setHint('请先在该义项里贴上例句', true);
      return;
    }
    const btn = document.querySelector(`.cosent-again[data-cosent-sense="${senseIndex}"]`);
    if (btn) btn.disabled = true;
    setHint('正在保存当前词…');
    try {
      const phrases = collectPhrases();
      attachPendingExample(senses);
      const payload = {
        word,
        senses,
        related: relatedDraft.slice(),
      };
      if (phrases.length) payload.phrases = phrases;
      if (pendingLinkFrom) {
        payload.link_from = pendingLinkFrom;
        if (pendingLinkExample) payload.link_example = pendingLinkExample;
      }
      const res = await api('/api/assets/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok === false) {
        setHint(res.error || '保存失败', true);
        return;
      }
      rememberSource(senses);
      $('vocabWord').value = '';
      resetSenseDraft();
      relatedDraft = [];
      renderRelatedChips();
      phraseDraft = [];
      renderPhraseBlocks();
      await refreshList();
      if (res.entry) renderDetail(res.entry);
      const syncedN = Number(res.synced_examples || 0);
      startCoSentRecord(res.entry.id, chain);
      setHint(`「${res.entry.word}」已存，填下一个词${syncedN ? `（自动同步 ${syncedN} 条相关例句）` : ''}。`);
    } catch (err) {
      setHint(err.message || '网络错误', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function collectSenses() {
    syncSenseDraftFromDom();
    return senseDraft.map((s) => ({
      pos: s.pos || 'other',
      meaning: (s.meaning || '').trim(),
      examples: (s.examples || '').trim(),
      source: (s.source || '').trim(),
    }));
  }

  function syncPhraseDraftFromDom() {
    const host = $('phraseBlocks');
    if (!host) return;
    host.querySelectorAll('.phrase-block').forEach((block) => {
      const i = Number(block.getAttribute('data-i'));
      if (!phraseDraft[i]) return;
      const text = block.querySelector('.phrase-text');
      const meaning = block.querySelector('.phrase-meaning');
      const examples = block.querySelector('.phrase-examples');
      const source = block.querySelector('.phrase-source');
      phraseDraft[i].text = text ? text.value : '';
      phraseDraft[i].meaning = meaning ? meaning.value : '';
      phraseDraft[i].examples = examples ? examples.value : '';
      phraseDraft[i].source = source ? source.value : '';
    });
  }

  function renderPhraseBlocks() {
    const host = $('phraseBlocks');
    if (!host) return;
    if (!phraseDraft.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = phraseDraft.map((p, i) => (
      `<div class="phrase-block" data-i="${i}">` +
      `<div class="sense-block-head">` +
      `<span class="sense-block-label">短语 ${i + 1}</span>` +
      `<button type="button" class="btn ghost phrase-remove" data-remove-i="${i}">移除</button>` +
      `</div>` +
      `<label class="vocab-label" for="phraseText${i}">短语</label>` +
      `<input class="phrase-text" id="phraseText${i}" type="text" maxlength="200" value="${escapeHtml(p.text || '')}" placeholder="如 play a crucial role">` +
      `<label class="vocab-label" for="phraseMeaning${i}">释义 <span class="opt">选填</span></label>` +
      `<input class="phrase-meaning" id="phraseMeaning${i}" type="text" maxlength="500" value="${escapeHtml(p.meaning || '')}" placeholder="如：发挥关键的作用">` +
      `<label class="vocab-label" for="phraseExamples${i}">例句 <span class="opt">英 || 中</span></label>` +
      `<textarea class="phrase-examples" id="phraseExamples${i}" rows="2" placeholder="例句…">${escapeHtml(p.examples || '')}</textarea>` +
      `<label class="vocab-label" for="phraseSource${i}">例句来源 <span class="opt">选填</span></label>` +
      `<input class="phrase-source" id="phraseSource${i}" type="text" maxlength="200" value="${escapeHtml(p.source || '')}" placeholder="如：四级真题 2020-6">` +
      `</div>`
    )).join('');
    host.querySelectorAll('.phrase-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncPhraseDraftFromDom();
        const i = Number(btn.getAttribute('data-remove-i'));
        phraseDraft.splice(i, 1);
        renderPhraseBlocks();
      });
    });
    host.querySelectorAll('.phrase-text, .phrase-meaning, .phrase-examples, .phrase-source').forEach((el) => {
      el.addEventListener('input', () => syncPhraseDraftFromDom());
      el.addEventListener('change', () => syncPhraseDraftFromDom());
    });
  }

  function collectPhrases() {
    syncPhraseDraftFromDom();
    return phraseDraft
      .map((p) => ({
        text: (p.text || '').trim(),
        meaning: (p.meaning || '').trim(),
        examples: (p.examples || '').trim(),
        source: (p.source || '').trim(),
      }))
      .filter((p) => p.text);
  }

  function addPhraseDraft() {
    syncPhraseDraftFromDom();
    if (phraseDraft.length >= 40) {
      setHint('一次最多 40 条短语', true);
      return;
    }
    phraseDraft.push({ text: '', meaning: '', examples: '', source: '' });
    renderPhraseBlocks();
    setHint('');
  }

  function renderRelatedPos() {
    const host = $('relatedPosPills');
    if (!host) return;
    host.innerHTML = posOptions.map((p) => (
      `<button type="button" class="pos-pill${p === relatedPos ? ' is-on' : ''}" data-pos="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    )).join('');
    host.querySelectorAll('.pos-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        relatedPos = btn.getAttribute('data-pos') || 'other';
        renderRelatedPos();
      });
    });
  }

  function renderRelatedChips() {
    const host = $('relatedChips');
    if (!host) return;
    if (!relatedDraft.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = relatedDraft.map((r, i) => (
      `<span class="related-chip">` +
      `<span class="related-chip-word">${escapeHtml(r.word)}</span>` +
      (r.pos ? `<span class="related-chip-pos">${escapeHtml(r.pos)}</span>` : '') +
      `<button type="button" class="related-chip-x" data-i="${i}" aria-label="移除">×</button>` +
      `</span>`
    )).join('');
    host.querySelectorAll('.related-chip-x').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-i'));
        relatedDraft.splice(i, 1);
        renderRelatedChips();
      });
    });
  }

  function addRelatedDraft() {
    const input = $('relatedWord');
    const word = ((input && input.value) || '').trim();
    if (!word) {
      setHint('请先填写旁系词形', true);
      return;
    }
    const key = word.toLowerCase();
    if (relatedDraft.some((r) => r.word.toLowerCase() === key)) {
      setHint('旁系里已有这个词形', true);
      return;
    }
    relatedDraft.push({ word, pos: relatedPos });
    if (input) input.value = '';
    setHint('');
    renderRelatedChips();
    if (input) input.focus();
  }

  function sensePreview(entry) {
    const senses = entry.senses || [];
    if (!senses.length) return '';
    return senses
      .map((s) => [s.pos, s.meaning].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');
  }

  function renderList(items) {
    const list = $('vocabList');
    if (!list) return;
    cache = items || [];
    if (!cache.length) {
      list.innerHTML = '<p class="vocab-empty">还没有词。中间录入后会出现在这里。</p>';
      return;
    }
    list.innerHTML = cache.map((it) => {
      const count = it.show_count ? `记过 ${it.record_count} 次` : '';
      const preview = sensePreview(it);
      return (
        `<button type="button" class="vocab-item" data-id="${escapeHtml(it.id)}">` +
        `<div class="vocab-item-top">` +
        `<span class="vocab-item-word">${escapeHtml(it.word || '')}</span>` +
        `<span class="vocab-item-meta">${escapeHtml(count || it.updated_at || '')}</span>` +
        `</div>` +
        (preview ? `<div class="vocab-item-preview">${escapeHtml(preview)}</div>` : '') +
        `</button>`
      );
    }).join('');
  }

  function exampleDisplay(e) {
    if (e == null) return { line: '', en: '', zh: '' };
    if (typeof e === 'string') {
      const s = e.trim();
      if (!s) return { line: '', en: '', zh: '' };
      if (s.includes('||')) {
        const i = s.indexOf('||');
        const en = s.slice(0, i).trim();
        const zh = s.slice(i + 2).trim();
        return { line: zh ? `${en} — ${zh}` : en, en, zh };
      }
      return { line: s, en: s, zh: '' };
    }
    const en = String(e.en || '').trim();
    const zh = String(e.zh || '').trim();
    const line = zh ? `${en} — ${zh}` : (en || zh);
    return { line, en, zh };
  }

  function formatExampleLine(e) {
    const d = exampleDisplay(e);
    if (d.en && d.zh) return `${d.en} || ${d.zh}`;
    return d.en || d.zh || '';
  }

  function attachPendingExample(senses) {
    // 同句再录：原句由横幅携带，提交时自动挂到首个尚无例句的义项
    if (!pendingLinkFrom || !pendingLinkExample) return;
    const first = senses && senses[0];
    if (!first || (first.examples || '').trim()) return;
    const line = formatExampleLine(pendingLinkExample);
    if (!line) return;
    first.examples = line;
    const src = String(pendingLinkExample.source || '').trim();
    if (src && !(first.source || '').trim()) first.source = src;
  }

  function renderCoSentBanner() {
    const el = $('coSentBanner');
    if (!el) return;
    const line = pendingLinkFrom && pendingLinkExample
      ? formatExampleLine(pendingLinkExample)
      : '';
    el.hidden = !line;
    if (!line) return;
    const text = $('coSentBannerText');
    if (text) {
      text.textContent = line;
      text.title = line;
    }
  }

  function startCoSentRecord(fromId, example) {
    pendingLinkFrom = fromId || null;
    pendingLinkExample = example
      ? {
          en: (example.en || '').trim(),
          zh: (example.zh || '').trim(),
          source: String((example && example.source) || '').trim(),
        }
      : null;
    renderCoSentBanner();
    const src = (pendingLinkExample && pendingLinkExample.source) || stickySource();
    const wordInput = $('vocabWord');
    const curWord = (wordInput && wordInput.value || '').trim();
    syncSenseDraftFromDom();
    const hasDraft = curWord
      || senseDraft.some((s) => (s.meaning || '').trim() || (s.examples || '').trim());

    if (hasDraft) {
      // 保留用户已输入的词与释义，仅补来源到空槽、刷新例句框显隐
      senseDraft.forEach((s) => {
        if (!(s.source || '').trim() && src) s.source = src;
      });
      renderSenseBlocks();
      setHint('已带上原句，当前填写内容已保留；保存后会自动关联本句。');
      return;
    }

    selectedPoses = [];
    senseDraft = [];
    renderPosMultiPills();
    renderSenseBlocks();
    relatedDraft = [];
    renderRelatedChips();
    phraseDraft = [];
    renderPhraseBlocks();
    if (wordInput) {
      wordInput.value = '';
      wordInput.focus();
    }
    const capture = document.querySelector('.assets-col-capture');
    if (capture && capture.scrollIntoView) {
      capture.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setHint('已带上原句，填词保存后会自动关联本句，无需再贴例句。');
  }

  function clearPendingLink() {
    pendingLinkFrom = null;
    pendingLinkExample = null;
    renderCoSentBanner();
  }

  function relatedCircleHtml(entry) {
    const rel = entry.related || [];
    const chips = rel.map((r) => {
      const stub = r.stub ? '<span class="related-stub-tag">待补</span>' : '';
      const pos = r.pos ? `<span class="related-chip-pos">${escapeHtml(r.pos)}</span>` : '';
      return (
        `<button type="button" class="related-link-chip" data-entry-id="${escapeHtml(r.entry_id || '')}">` +
        `<span class="related-chip-word">${escapeHtml(r.word || '')}</span>` +
        pos + stub +
        `</button>`
      );
    }).join('');

    const cos = entry.co_sents || [];
    const coChips = cos.map((c) => {
      const exHint = (c.example && c.example.en)
        ? ` title="${escapeHtml(c.example.en)}"`
        : '';
      return (
        `<button type="button" class="related-link-chip cosent-chip" data-entry-id="${escapeHtml(c.entry_id || '')}"${exHint}>` +
        `<span class="related-chip-word">${escapeHtml(c.word || '')}</span>` +
        `<span class="related-chip-pos">同句</span>` +
        `</button>`
      );
    }).join('');

    return (
      `<div class="vocab-related">` +
      `<div class="vocab-related-title">旁系</div>` +
      (chips || '<p class="vocab-related-empty">还没有旁系。词族其它词形可以挂在这里。</p>') +
      `<div class="related-compose related-compose-inline">` +
      `<input id="detailRelatedWord" type="text" maxlength="80" placeholder="添加旁系词形" autocomplete="off">` +
      `<button type="button" class="btn ghost" id="detailRelatedAdd">添加</button>` +
      `</div>` +
      `</div>` +
      `<div class="vocab-related vocab-cosents">` +
      `<div class="vocab-related-title">同句</div>` +
      (coChips || '<p class="vocab-related-empty">还没有同句词。点例句旁「同句再录」即可。</p>') +
      `</div>`
    );
  }

  // ---- AI 整理：模型给建议 → 用户过目确认 → 应用（原义项自动备份） ----
  let tidyOverlay = null;

  function closeTidy() {
    if (tidyOverlay) { tidyOverlay.remove(); tidyOverlay = null; }
  }

  async function runTidy(entry) {
    if (!entry || entry.stub) return;
    closeTidy();
    const ov = document.createElement('div');
    ov.className = 'tidy-overlay';
    ov.innerHTML = `<div class="tidy-panel"><p class="tidy-note">AI 正在分析「${escapeHtml(entry.word)}」的义项与例句…</p></div>`;
    document.body.appendChild(ov);
    tidyOverlay = ov;

    const res = await api('/api/assets/vocab/' + encodeURIComponent(entry.id) + '/tidy_suggest', {
      method: 'POST',
    });
    if (!res.ok) {
      ov.querySelector('.tidy-panel').innerHTML =
        `<p class="tidy-note">${escapeHtml(res.error || '整理失败，请稍后再试')}</p>` +
        `<div class="tidy-actions"><button type="button" class="btn ghost" id="tidyCancel">关闭</button></div>`;
      $('tidyCancel').onclick = closeTidy;
      return;
    }

    const exById = {};
    (res.examples || []).forEach((e) => { exById[e.id] = e.en; });
    const kept = new Set();
    const senseRows = (res.suggestion || []).map((s) => {
      const exs = (s.example_ids || []).map((id) => kept.add(id) && id);
      return (
        `<div class="tidy-sense">` +
        `<div class="tidy-sense-head"><span class="vocab-sense-pos">${escapeHtml(s.pos || '')}</span>` +
        `<span>${escapeHtml(s.meaning)}</span></div>` +
        (exs.length ? exs.map((id) =>
          `<p class="tidy-ex">保留 · ${escapeHtml(exById[id] || '')}</p>`).join('') : '') +
        `</div>`
      );
    }).join('');
    const dropped = (res.examples || []).filter((e) => !kept.has(e.id));
    const droppedHtml = dropped.length
      ? `<div class="tidy-dropped"><div class="vocab-related-title">将删除的例句（${dropped.length} 条）</div>` +
        dropped.map((e) => `<p class="tidy-ex drop">${escapeHtml(e.en)}</p>`).join('') + `</div>`
      : '';

    ov.querySelector('.tidy-panel').innerHTML =
      `<div class="tidy-head">AI 整理建议 · ${escapeHtml(res.word || entry.word)}</div>` +
      `<div class="tidy-scroll">` +
      `<p class="tidy-note">确认后将合并相近义项、只保留代表性例句。原结构已自动备份，可让开发者恢复。</p>` +
      senseRows + droppedHtml +
      `</div>` +
      `<div class="tidy-actions">` +
      `<button type="button" class="btn ghost" id="tidyCancel">取消</button>` +
      `<button type="button" class="btn primary" id="tidyConfirm">确认整理</button>` +
      `</div>`;
    $('tidyCancel').onclick = closeTidy;
    $('tidyConfirm').onclick = async () => {
      const btn = $('tidyConfirm');
      btn.disabled = true;
      btn.textContent = '应用中…';
      const apply = await api('/api/assets/vocab/' + encodeURIComponent(entry.id) + '/tidy_apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senses: res.suggestion }),
      });
      if (apply.ok === false) {
        btn.disabled = false;
        btn.textContent = '确认整理';
        setHint(apply.error || '应用失败', true);
        return;
      }
      closeTidy();
      setHint(`「${entry.word}」整理完成`);
      renderDetail(apply.entry);
      await refreshList();
    };
  }

  function renderDetail(entry) {
    const box = $('vocabDetail');
    if (!box) return;
    if (!entry) {
      activeId = null;
      box.innerHTML = '<p class="vocab-detail-empty">点左侧档案中的词，这里显示详细信息。</p>';
      document.querySelectorAll('.vocab-item.is-active').forEach((el) => el.classList.remove('is-active'));
      return;
    }
    activeId = entry.id;
    document.querySelectorAll('.vocab-item.is-active').forEach((el) => el.classList.remove('is-active'));
    Array.from(document.querySelectorAll('.vocab-item')).some((el) => {
      if (String(el.getAttribute('data-id')) === String(entry.id)) {
        el.classList.add('is-active');
        return true;
      }
      return false;
    });

    const stubBadge = entry.stub
      ? '<span class="related-stub-tag">待补</span>'
      : '';
    const countLine = entry.stub
      ? '<span class="vocab-item-meta">空壳 · 尚未正式录入</span>'
      : (entry.show_count
        ? `<span class="vocab-item-meta">记过 ${entry.record_count} 次</span>`
        : `<span class="vocab-item-meta">${escapeHtml(entry.updated_at || '')}</span>`);
    const senses = (entry.senses || []).map((s, si) => {
      const examples = Array.isArray(s.examples) ? s.examples : [];
      const ex = examples.map((e, ei) => {
        const d = exampleDisplay(e);
        if (!d.line) return '';
        const src = (e && e.source) ? `<div class="vocab-ex-source">来源 · ${escapeHtml(e.source)}</div>` : '';
        return (
          `<div class="vocab-ex-row">` +
          `<div class="vocab-ex-main">` +
          `<p class="vocab-ex-text">${escapeHtml(d.line)}</p>` +
          src +
          `</div>` +
          `<button type="button" class="cosent-again" data-si="${si}" data-ei="${ei}">同句再录</button>` +
          `</div>`
        );
      }).join('');
      return (
        `<div class="vocab-sense">` +
        `<span class="vocab-sense-pos">${escapeHtml(s.pos || '')}</span>` +
        `<span class="vocab-sense-meaning">${escapeHtml(s.meaning || '（无释义）')}</span>` +
        (ex ? `<div class="vocab-ex-list">${ex}</div>` : '') +
        `</div>`
      );
    }).join('');
    const sourceLine = '';
    const phrases = entry.phrases || [];
    const phrasesHtml = phrases.length
      ? (
        `<div class="vocab-phrases">` +
        `<div class="vocab-related-title">短语</div>` +
        phrases.map((p) => {
          const text = typeof p === 'string' ? p : (p.text || '');
          const meaning = (typeof p === 'object' && p && p.meaning) ? p.meaning : '';
          let exs = [];
          if (typeof p === 'object' && p) {
            if (Array.isArray(p.examples)) exs = p.examples;
            else if (typeof p.examples === 'string' && p.examples.trim()) exs = [p.examples];
          }
          const exHtml = exs.map((e) => {
            const d = exampleDisplay(e);
            if (!d.line) return '';
            const src = (e && typeof e === 'object' && e.source)
              ? `<div class="vocab-ex-source">来源 · ${escapeHtml(e.source)}</div>`
              : '';
            return (
              `<div class="vocab-ex-row">` +
              `<div class="vocab-ex-main">` +
              `<p class="vocab-ex-text">${escapeHtml(d.line)}</p>` +
              src +
              `</div>` +
              `</div>`
            );
          }).join('');
          return (
            `<div class="vocab-phrase-item">` +
            `<div class="vocab-phrase-text">${escapeHtml(text)}</div>` +
            (meaning ? `<div class="vocab-phrase-meaning">${escapeHtml(meaning)}</div>` : '') +
            (exHtml ? `<div class="vocab-ex-list">${exHtml}</div>` : '') +
            `</div>`
          );
        }).join('') +
        `</div>`
      )
      : '';
    box.innerHTML =
      `<div class="vocab-detail-head">` +
      `<span class="vocab-detail-word">${escapeHtml(entry.word || '')}${stubBadge}</span>` +
      countLine +
      `</div>` +
      sourceLine +
      senses +
      phrasesHtml +
      relatedCircleHtml(entry) +
      `<div class="vocab-detail-actions">` +
      `<button type="button" class="btn ghost" id="vocabDetailTidy">AI 整理</button>` +
      `<button type="button" class="btn ghost" id="vocabDetailClose">收起</button>` +
      `<button type="button" class="btn ghost danger" id="vocabDetailDelete">删除</button>` +
      `</div>`;

    const tidyBtn = $('vocabDetailTidy');
    if (tidyBtn) tidyBtn.onclick = () => runTidy(entry);

    const closeBtn = $('vocabDetailClose');
    const delBtn = $('vocabDetailDelete');
    if (closeBtn) closeBtn.onclick = () => renderDetail(null);
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!window.confirm('确定删除这个词的全部档案？')) return;
        const res = await api('/api/assets/vocab/' + encodeURIComponent(entry.id) + '/delete', {
          method: 'POST',
        });
        if (res.ok === false) {
          setHint(res.error || '删除失败', true);
          return;
        }
        renderDetail(null);
        await refreshList();
      };
    }

    box.querySelectorAll('.related-link-chip[data-entry-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-entry-id');
        if (!id) return;
        const res = await api('/api/assets/vocab/' + encodeURIComponent(id));
        if (res && res.entry) renderDetail(res.entry);
      });
    });

    box.querySelectorAll('.cosent-again').forEach((btn) => {
      btn.addEventListener('click', () => {
        const si = Number(btn.getAttribute('data-si'));
        const ei = Number(btn.getAttribute('data-ei'));
        const sense = (entry.senses || [])[si];
        const ex = sense && (sense.examples || [])[ei];
        if (!ex) return;
        startCoSentRecord(entry.id, ex);
      });
    });

    const addBtn = $('detailRelatedAdd');
    if (addBtn) {
      addBtn.onclick = async () => {
        const input = $('detailRelatedWord');
        const word = ((input && input.value) || '').trim();
        if (!word) return;
        const res = await api('/api/assets/vocab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: entry.word,
            related: [{ word, pos: relatedPos }],
          }),
        });
        if (res.ok === false) {
          setHint(res.error || '添加旁系失败', true);
          return;
        }
        if (input) input.value = '';
        setHint(`已为「${entry.word}」挂上旁系「${word}」`);
        renderDetail(res.entry);
        await refreshList();
      };
    }
  }

  async function refreshList() {
    const q = ($('vocabSearch') && $('vocabSearch').value) || '';
    const res = await api('/api/assets/vocab?q=' + encodeURIComponent(q) + '&limit=40');
    if (res.ok === false) {
      $('vocabList').innerHTML = `<p class="vocab-empty">${escapeHtml(res.error || '加载失败')}</p>`;
      return;
    }
    if (Array.isArray(res.pos_options) && res.pos_options.length) {
      const next = res.pos_options.join('|');
      const prev = posOptions.join('|');
      posOptions = res.pos_options;
      if (next !== prev) {
        syncSenseDraftFromDom();
        renderPosMultiPills();
        renderSenseBlocks();
        renderRelatedPos();
      }
    }
    renderList(res.items || []);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const word = ($('vocabWord').value || '').trim();
    if (!word) {
      setHint('请输入单词', true);
      return;
    }
    const senses = collectSenses();
    if (!fixedPhrase && !senses.length) {
      setHint('请至少点选一个词性（或勾选固定短语）', true);
      return;
    }
    attachPendingExample(senses);
    const phrases = collectPhrases();
    const btn = $('vocabSubmit');
    if (btn) btn.disabled = true;
    setHint('');
    try {
      const payload = {
        word,
        senses,
        related: relatedDraft.slice(),
      };
      if (phrases.length) payload.phrases = phrases;
      if (pendingLinkFrom) {
        payload.link_from = pendingLinkFrom;
        if (pendingLinkExample) payload.link_example = pendingLinkExample;
      }
      const res = await api('/api/assets/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok === false) {
        setHint(res.error || '保存失败', true);
        return;
      }
      const entry = res.entry;
      rememberSource(senses);
      const n = (entry.senses || []).length;
      const linked = pendingLinkFrom && (entry.co_sents || []).length;
      const synced = Number(res.synced_examples || 0);
      const syncedNote = synced > 0 ? `，自动同步 ${synced} 条库内相关例句` : '';
      if (res.created) {
        setHint(
          linked
            ? `已收入「${entry.word}」并标记同句${syncedNote}`
            : (n > 1 ? `已收入「${entry.word}」· ${n} 个义项${syncedNote}` : `已收入「${entry.word}」${syncedNote}`)
        );
      } else if (entry.show_count) {
        setHint(`「${entry.word}」记忆加深 · 记过 ${entry.record_count} 次${syncedNote}`);
      } else {
        setHint(linked ? `「${entry.word}」已更新并标记同句${syncedNote}` : `「${entry.word}」已更新${syncedNote}`);
      }
      $('vocabWord').value = '';
      relatedDraft = [];
      renderRelatedChips();
      phraseDraft = [];
      renderPhraseBlocks();
      resetSenseDraft();
      const fixedToggle = $('fixedPhraseToggle');
      if (fixedToggle && fixedToggle.checked) {
        fixedToggle.checked = false;
        setFixedPhrase(false);
      }
      clearPendingLink();
      const phrasePanel = $('phrasePanel');
      const phraseToggle = $('phraseToggleBtn');
      if (phrasePanel) phrasePanel.hidden = true;
      if (phraseToggle) {
        phraseToggle.setAttribute('aria-expanded', 'false');
        phraseToggle.textContent = '添加短语';
      }
      const panel = $('relatedPanel');
      const toggle = $('relatedToggleBtn');
      if (panel) panel.hidden = true;
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '添加旁系';
      }
      $('vocabWord').focus();
      await refreshList();
      if (entry && entry.id) renderDetail(entry);
    } catch (err) {
      setHint(err.message || '网络错误', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    renderPosMultiPills();
    renderSenseBlocks();
    renderPhraseBlocks();
    renderRelatedPos();
    const form = $('vocabForm');
    if (form) form.addEventListener('submit', onSubmit);

    function bindMetaToggle(btnId, panelId, openLabel, closeLabel, onOpen) {
      const btn = $(btnId);
      const panel = $(panelId);
      if (!btn || !panel) return;
      btn.addEventListener('click', () => {
        const opening = panel.hidden;
        if (!opening && panelId === 'phrasePanel') {
          syncPhraseDraftFromDom();
        }
        panel.hidden = !opening;
        btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        btn.textContent = opening ? closeLabel : openLabel;
        if (opening && typeof onOpen === 'function') onOpen();
      });
    }

    bindMetaToggle('phraseToggleBtn', 'phrasePanel', '添加短语', '收起短语', () => {
      // 面板只是 hidden，勿整表重绘，否则未 sync 的例句/来源会被冲掉
      if (!phraseDraft.length) addPhraseDraft();
    });
    bindMetaToggle('relatedToggleBtn', 'relatedPanel', '添加旁系', '收起旁系');

    const fixedToggle = $('fixedPhraseToggle');
    if (fixedToggle) {
      fixedToggle.addEventListener('change', () => {
        setFixedPhrase(fixedToggle.checked);
      });
    }

    const coCancel = $('coSentCancel');
    if (coCancel) {
      coCancel.addEventListener('click', () => {
        clearPendingLink();
        setHint('已取消同句再录。');
      });
    }

    const addBtn = $('relatedAddBtn');
    if (addBtn) addBtn.addEventListener('click', addRelatedDraft);
    const relatedInput = $('relatedWord');
    if (relatedInput) {
      relatedInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addRelatedDraft();
        }
      });
    }
    const phraseAdd = $('phraseAddBtn');
    if (phraseAdd) phraseAdd.addEventListener('click', addPhraseDraft);
    const search = $('vocabSearch');
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => refreshList(), 200);
      });
    }
    const list = $('vocabList');
    if (list) {
      list.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.vocab-item[data-id]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const entry = cache.find((x) => String(x.id) === String(id));
        if (entry) renderDetail(entry);
        else {
          api('/api/assets/vocab/' + encodeURIComponent(id)).then((res) => {
            if (res && res.entry) renderDetail(res.entry);
          });
        }
      });
    }
  }

  bind();
  refreshList();
})();
