/* 导入：输入 → 题型总览 → 单题型样板 → 预览 → 入库 */
(function () {
  const $ = (id) => document.getElementById(id);

  const TYPE_MAP = {
    choice: '选择题',
    judge: '判断题',
    fill: '填空题',
    short_answer: '简答题',
  };

  const WASH_PROMPT = [
    '请把我提供的题目材料整理成纯文本题库，方便导入刷题软件。',
    '',
    '硬性要求：',
    '1. 严格保留原题考点与措辞，禁止扩写、改写、删减考点，禁止发明选项或答案。',
    '2. 只调整结构与排版；去掉「AI解析」等批注噪声，但请保留「一、单选题」「二、填空题」等大题标题。',
    '3. 选择题答案用「答案：X」或「参考答案：X」单独一行；解析另起「解析：」行。',
    '4. 多节内容连续输出，保留章节与大题标题，便于归并同型题。',
    '5. 看不清的题跳过并注明「跳过：…」，不要瞎编。',
    '',
    '下面是材料：',
  ].join('\n');

  let step = 1;
  let file = null;
  let fullText = '';
  let suggestedName = '';
  let preview = null;
  let detectedTypes = [];
  let scanPools = {};
  /** @type {Record<string, string>} */
  let exemplarsState = {};
  /** 用户确认「只导入已选样板题型」后，入库时跳过的未覆盖题型 */
  let ackSkippedTypes = [];
  let activeKind = null;
  /** 进入样板页时的快照，点「返回不保存」时恢复 */
  let exemplarDraftBackup = '';
  /** pool | source */
  let exemplarMode = 'pool';
  /** 学习通网页粘贴：剪贴板 text/html（含学习通题目 DOM 特征时缓存，供后端直解） */
  let pasteHtml = '';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  async function uiAlert(msg) {
    if (window.LykieDialog && typeof LykieDialog.alert === 'function') {
      return LykieDialog.alert(msg);
    }
    window.alert(msg);
  }

  async function uiConfirm(msg, opts) {
    if (window.LykieDialog && typeof LykieDialog.confirm === 'function') {
      return LykieDialog.confirm(msg, opts || {});
    }
    return window.confirm(msg);
  }

  async function uiChoose(msg, opts) {
    if (window.LykieDialog && typeof LykieDialog.choose === 'function') {
      return LykieDialog.choose(msg, opts || {});
    }
    // 无对话框时退化为 confirm：确定=ok，取消=cancel（无法微调）
    const ok = window.confirm(String(msg) + '\n\n确定=确认，取消=放弃');
    return ok ? 'ok' : 'cancel';
  }

  async function fetchAuth(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('未登录');
    }
    return res;
  }

  async function apiJson(path, opts) {
    const res = await fetchAuth(path, opts);
    return res.json();
  }

  function setStep(n) {
    step = n;
    $('panelInput').hidden = n !== 1;
    $('panelScan').hidden = n !== 2;
    $('panelExemplar').hidden = n !== 3;
    $('panelPreview').hidden = n !== 4;
    $('panelSave').hidden = n !== 5;

    [1, 2, 3, 4, 5].forEach((i) => {
      const tab = $('stepTab' + i);
      if (!tab) return;
      tab.classList.toggle('is-active', i === n);
      tab.classList.toggle('is-done', i < n);
      if (i === 1) tab.disabled = false;
      else if (i === 2) tab.disabled = !(fullText || n >= 2);
      else if (i === 3) tab.disabled = !activeKind && n < 3;
      else if (i === 4) tab.disabled = !preview && n < 4;
      else tab.disabled = !preview && n < 5;
    });
  }

  function syncFileUi() {
    const pasteWrap = $('pasteSourceWrap');
    const fileCard = $('fileSourceCard');
    const modeHint = $('importSourceModeHint');
    if (file) {
      if (pasteWrap) pasteWrap.hidden = true;
      if (fileCard) fileCard.hidden = false;
      if (modeHint) modeHint.hidden = true;
      if ($('importFileCardName')) $('importFileCardName').textContent = file.name;
      if ($('importFileCardMeta')) {
        $('importFileCardMeta').textContent =
          '已选定 Word。下一步将抽出文本并扫描题型；正文不在此页展开，避免大段刷屏。需要改字时点「改用粘贴」。';
      }
      if ($('inputHint')) {
        $('inputHint').textContent = '下一步抽出 Word 并扫描题型。';
      }
    } else {
      if (pasteWrap) pasteWrap.hidden = false;
      if (fileCard) fileCard.hidden = true;
      if (modeHint) modeHint.hidden = false;
      if ($('inputHint')) {
        $('inputHint').textContent = '选 Word 或直接粘贴。请保留大题标题以便归并。';
      }
    }
  }

  function clearSelectedFile() {
    file = null;
    if ($('importFile')) $('importFile').value = '';
  }

  function switchToPasteMode() {
    // 若已抽出过正文，灌进粘贴框方便按需改；否则只切回粘贴 UI
    if (fullText && $('importText') && !($('importText').value || '').trim()) {
      $('importText').value = fullText;
    }
    clearSelectedFile();
    syncFileUi();
    setStep(1);
  }

  function collectExemplars() {
    const map = {};
    Object.keys(TYPE_MAP).forEach((kind) => {
      const v = (exemplarsState[kind] || '').trim();
      if (v) map[kind] = v;
    });
    return map;
  }

  function coveredFromExemplars(ex) {
    return new Set(Object.keys(ex || {}));
  }

  function uncoveredNeedAck(detected, covered) {
    const need = new Set(['judge', 'fill', 'short_answer']);
    const out = [];
    (detected || []).forEach((d) => {
      if (need.has(d.kind) && !covered.has(d.kind)) out.push(d.kind);
    });
    return out;
  }

  function missingDetectedKinds(ex) {
    return (detectedTypes || []).filter((d) => !(ex || {})[d.kind]);
  }

  function renderScanOverview() {
    const host = $('scanOverview');
    const summary = $('scanSummary');
    if (!host) return;

    const ex = collectExemplars();
    const hasSa = detectedTypes.some((d) => d.kind === 'short_answer');
    if ($('importSaWrap')) {
      $('importSaWrap').hidden = !hasSa || !ex.short_answer;
    }

    if (!detectedTypes.length) {
      summary.textContent = '未识别到「一、单选题 / 填空题」等大题标题。可手贴选择题样板后继续。';
      host.innerHTML =
        `<button type="button" class="import-type-card import-type-card-manual" data-kind="choice">` +
        `<span class="import-type-card-title">手贴选择题样板</span>` +
        `<span class="import-type-card-meta">${ex.choice ? '已有样板' : '未选样板'}</span>` +
        `</button>`;
      return;
    }

    const totalItems = detectedTypes.reduce((n, d) => n + (d.count || 0), 0);
    const coveredN = detectedTypes.filter((d) => ex[d.kind]).length;
    summary.textContent =
      `检出 ${detectedTypes.length} 类题型，粗计 ${totalItems} 题；已选样板 ${coveredN}/${detectedTypes.length}。` +
      '点卡片进入该题型样板。';

    host.innerHTML = detectedTypes.map((d) => {
      const pool = scanPools[d.kind] || {};
      const count = d.count || (pool.items || []).length || 0;
      const ok = !!ex[d.kind];
      const state = ok ? '已选样板' : '未选样板';
      const sec = d.section_count ? ` · ${d.section_count} 处大题` : '';
      return (
        `<button type="button" class="import-type-card${ok ? ' is-ok' : ''}" data-kind="${escapeHtml(d.kind)}">` +
        `<span class="import-type-card-title">${escapeHtml(d.label || TYPE_MAP[d.kind] || d.kind)}</span>` +
        `<span class="import-type-card-count">${count} 题${escapeHtml(sec)}</span>` +
        `<span class="import-type-card-meta">${state}</span>` +
        `</button>`
      );
    }).join('');
  }

  function applyScanResult(pools, detected) {
    scanPools = pools || {};
    detectedTypes = detected || [];
    renderScanOverview();
  }

  function kindHint(kind) {
    if (kind === 'choice') return '标准答案行如「答案：C」或「参考答案：C」；解析请另起一行。';
    if (kind === 'judge') return '样板需含题干与「答案：对/错」。';
    if (kind === 'fill') return '样板需含题干与「答案：…」（可多空）。';
    return '样板需含题干与「答案：」及要点。';
  }

  function showExemplarPoolMode() {
    exemplarMode = 'pool';
    if ($('exemplarPoolMode')) $('exemplarPoolMode').hidden = false;
    if ($('exemplarSourceMode')) $('exemplarSourceMode').hidden = true;
    $('exemplarLead').hidden = false;
    $('exemplarLead').textContent =
      activeKind === 'short_answer'
        ? '从归并池挑一道简答作样板；点「用作样板」后确认即可。'
        : `从归并池挑一道${TYPE_MAP[activeKind] || ''}；点「用作样板」后确认即可。`;
    hideTweakPanel();
  }

  function hideTweakPanel() {
    if ($('exemplarTweakWrap')) $('exemplarTweakWrap').hidden = true;
  }

  function showTweakPanel(prefill) {
    if ($('exemplarTweakWrap')) $('exemplarTweakWrap').hidden = false;
    if (prefill != null && $('exemplarActive')) {
      $('exemplarActive').value = prefill;
    }
    if ($('exemplarActiveLabel') && activeKind) {
      $('exemplarActiveLabel').textContent = `微调${TYPE_MAP[activeKind] || ''}样板`;
    }
    if ($('exemplarHint')) $('exemplarHint').textContent = kindHint(activeKind);
    const ta = $('exemplarActive');
    if (ta) {
      ta.focus();
      try { ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  async function askPickExemplar(text) {
    const preview = String(text || '').trim();
    if (!preview) {
      await uiAlert('这道题内容为空，换一道或对照原文手选。');
      return;
    }
    const snippet = preview.length > 160 ? preview.slice(0, 159) + '…' : preview;
    const choice = await uiChoose(
      `确定用下面这道作${TYPE_MAP[activeKind] || ''}样板吗？\n\n${snippet}`,
      {
        title: '确认样板',
        cancelValue: 'cancel',
        buttons: [
          { label: '取消', value: 'cancel' },
          { label: '微调样板', value: 'tweak' },
          { label: '确认', value: 'ok', primary: true },
        ],
      }
    );
    if (choice === 'ok') {
      if ($('exemplarActive')) $('exemplarActive').value = preview;
      confirmKindExemplarFromText(preview);
      return;
    }
    if (choice === 'tweak') {
      showTweakPanel(preview);
      return;
    }
    // cancel：不动
  }

  async function askOpenTweakFromTop() {
    const current =
      (activeKind && exemplarsState[activeKind]) ||
      ($('exemplarActive') ? $('exemplarActive').value : '') ||
      '';
    const poolFirst =
      activeKind &&
      scanPools[activeKind] &&
      scanPools[activeKind].items &&
      scanPools[activeKind].items[0]
        ? scanPools[activeKind].items[0].text
        : '';
    showTweakPanel(current || poolFirst || '');
  }

  function showExemplarSourceMode() {
    exemplarMode = 'source';
    // 清掉池子展示，把版面留给原文对照
    if ($('exemplarPool')) $('exemplarPool').innerHTML = '';
    if ($('exemplarPoolMode')) $('exemplarPoolMode').hidden = true;
    if ($('exemplarSourceMode')) $('exemplarSourceMode').hidden = false;
    $('exemplarLead').hidden = true;
    if ($('sourcePick')) $('sourcePick').value = fullText || ($('importText').value || '');
    const draft = ($('exemplarFromSource').value || '').trim()
      || ($('exemplarActive').value || '').trim()
      || (exemplarsState[activeKind] || '');
    if ($('exemplarFromSource')) $('exemplarFromSource').value = draft;
    if ($('exemplarFromSourceLabel')) {
      $('exemplarFromSourceLabel').textContent = `${TYPE_MAP[activeKind] || ''}样板文本`;
    }
    if ($('exemplarSourceHint')) $('exemplarSourceHint').textContent = kindHint(activeKind);
    $('exemplarHeading').textContent = `${TYPE_MAP[activeKind] || ''}样板 · 对照原文`;
  }

  function fillPoolList(kind) {
    const pool = scanPools[kind] || {};
    const items = pool.items || [];
    const host = $('exemplarPool');
    if (!items.length) {
      host.innerHTML = '<p class="hint">本池暂无切出的题。请用上方入口对照原文，或打开微调框手贴。</p>';
    } else {
      host.innerHTML = items.map((it, idx) => {
        const open = idx === 0 ? ' open' : '';
        return (
          `<details class="import-pool-item"${open}>` +
          `<summary>第 ${it.index} 题 · ${escapeHtml(it.preview || '')}` +
          (it.section_label ? ` <span class="import-pool-sec">${escapeHtml(it.section_label)}</span>` : '') +
          `</summary>` +
          `<pre class="import-pool-text">${escapeHtml(it.text || '')}</pre>` +
          `<button type="button" class="btn ghost import-use-item" data-idx="${idx}">用作样板</button>` +
          `</details>`
        );
      }).join('');
    }
    const firstBtn = $('useFirstExemplarBtn');
    if (firstBtn) firstBtn.disabled = !items.length;
    const q = $('exemplarFallbackQ');
    const hint = $('exemplarFallbackHint');
    if (q) q.textContent = items.length ? '系统没切准？' : '池子里没有可用题？';
    if (hint) {
      hint.textContent = items.length
        ? '可微调样板，或对照原文手选一道。'
        : '建议对照原文手选；也可打开微调框粘贴。';
    }
    return items;
  }

  function openExemplarKind(kind) {
    if (!TYPE_MAP[kind]) return;
    activeKind = kind;
    exemplarDraftBackup = (exemplarsState[kind] || '').trim();
    $('exemplarHeading').textContent = `${TYPE_MAP[kind]}样板`;
    if ($('exemplarActive')) $('exemplarActive').value = exemplarsState[kind] || '';
    fillPoolList(kind);
    showExemplarPoolMode();
    setStep(3);
  }

  function syncFullTextFromSource() {
    const src = $('sourcePick');
    if (src && exemplarMode === 'source') {
      fullText = (src.value || '').trim();
      if ($('importText')) $('importText').value = fullText;
    }
    return fullText;
  }

  function confirmKindExemplarFromText(text) {
    if (!activeKind) return;
    const t = (text || '').trim();
    if (t) exemplarsState[activeKind] = t;
    else delete exemplarsState[activeKind];
    ackSkippedTypes = [];
    preview = null;
    activeKind = null;
    exemplarMode = 'pool';
    hideTweakPanel();
    renderScanOverview();
    setStep(2);
  }

  function confirmKindExemplar() {
    if (!activeKind) return;
    let text = '';
    if (exemplarMode === 'source') {
      syncFullTextFromSource();
      text = ($('exemplarFromSource').value || '').trim();
    } else {
      text = ($('exemplarActive').value || '').trim();
    }
    confirmKindExemplarFromText(text);
  }

  function cancelKindExemplar() {
    if (activeKind) {
      if (exemplarDraftBackup) exemplarsState[activeKind] = exemplarDraftBackup;
      else delete exemplarsState[activeKind];
    }
    activeKind = null;
    exemplarMode = 'pool';
    hideTweakPanel();
    renderScanOverview();
    setStep(2);
  }

  function backToPoolFromSource() {
    const draft = ($('exemplarFromSource').value || '').trim();
    syncFullTextFromSource();
    if (!activeKind) {
      showExemplarPoolMode();
      return;
    }
    const kind = activeKind;
    fillPoolList(kind);
    $('exemplarHeading').textContent = `${TYPE_MAP[kind]}样板`;
    if ($('exemplarActive')) $('exemplarActive').value = draft;
    showExemplarPoolMode();
    if (draft) showTweakPanel(draft);
  }

  function pendingConfirmCount() {
    if (!preview || !preview.questions) return 0;
    return preview.questions.filter((q) => q.needs_answer_confirm && !q._picked).length;
  }

  function buildAnswerPicks() {
    const picks = {};
    (preview.questions || []).forEach((q, i) => {
      if (q._picked) picks[String(i)] = q._picked;
    });
    return picks;
  }

  function ackSkippedPayload() {
    const ex = collectExemplars();
    const uncovered = uncoveredNeedAck(detectedTypes, coveredFromExemplars(ex));
    const importSa = !!( $('importSaCheck') && $('importSaCheck').checked );
    const still = uncovered.filter((k) => !(k === 'short_answer' && importSa && ex.short_answer));
    if (!still.length) return [];
    // 继续预览时已确认「只导入已选样板题型」
    if (ackSkippedTypes.length) return still;
    return [];
  }

  function clientGateError() {
    const ex = collectExemplars();
    const uncovered = uncoveredNeedAck(detectedTypes, coveredFromExemplars(ex));
    const importSa = !!( $('importSaCheck') && $('importSaCheck').checked );
    const still = uncovered.filter((k) => !(k === 'short_answer' && importSa && ex.short_answer));
    if (!still.length) return '';
    if (ackSkippedTypes.length && still.every((k) => ackSkippedTypes.indexOf(k) >= 0)) return '';
    return `原文有${still.map((k) => TYPE_MAP[k] || k).join('、')}未覆盖。请返回题型页补样板，或在继续预览时确认只导入已选类型。`;
  }

  function renderPreview(res) {
    preview = res;
    (preview.questions || []).forEach((q) => {
      if (q._picked) return;
      q._picked = null;
    });
    const meta = res.meta || {};
    if (meta.detected_types) {
      detectedTypes = meta.detected_types;
    }

    const pending = pendingConfirmCount();
    const saTotal = res.sa_total || (meta.sa_total || 0);
    let summary = `共解析出客观题 ${res.total} 道`;
    if (saTotal) summary += `，简答 ${saTotal} 道（将另建库）`;
    summary += '。';
    if (pending > 0) summary += ` 有 ${pending} 题待确认答案，已置顶。`;
    const uncovered = meta.uncovered_types || [];
    if (uncovered.length && ackSkippedTypes.length) {
      summary += ` 已跳过：${uncovered.map((k) => TYPE_MAP[k] || k).join('、')}。`;
    }
    if (meta.platform === 'xuexitong-html') {
      summary += ' 已按学习通网页格式解析。';
    }
    $('previewSummary').textContent = summary;
    $('previewHint').textContent = pending > 0
      ? '待确认题已置顶。点选 A/B/C/D 后才能入库。'
      : '扫一眼即可。可返回题型页补其它样板后重新预览。';

    const importSa = !!( $('importSaCheck') && $('importSaCheck').checked );
    let saveMsg = `将导入客观题 ${res.total} 道`;
    if (saTotal && importSa) saveMsg += `，并另建简答库 ${saTotal} 道`;
    $('saveSummary').textContent = saveMsg + '。';

    const list = $('previewList');
    const indexed = (res.questions || []).map((q, i) => ({ q, i }));
    indexed.sort((a, b) => {
      const na = a.q.needs_answer_confirm && !a.q._picked ? 0 : 1;
      const nb = b.q.needs_answer_confirm && !b.q._picked ? 0 : 1;
      if (na !== nb) return na - nb;
      return a.i - b.i;
    });
    let html = '';
    indexed.forEach(({ q, i }) => {
      const opts = (q.options || [])
        .map((o, idx) => `<li>${String.fromCharCode(65 + idx)}. ${escapeHtml(o)}</li>`)
        .join('');
      const need = !!q.needs_answer_confirm && !q._picked;
      const picked = q._picked || '';
      let answerBlock = '';
      if (need) {
        const letters = (q.options || []).map((_, idx) => {
          const L = String.fromCharCode(65 + idx);
          return `<button type="button" class="import-pick-btn" data-qi="${i}" data-letter="${L}">${L}</button>`;
        }).join('');
        const raw = q.answer_line_raw
          ? `<div class="import-q-raw">原文答案行：${escapeHtml(q.answer_line_raw)}</div>`
          : '';
        answerBlock =
          `<div class="import-q-confirm"><div class="import-q-confirm-label">待确认答案 — 请点选</div>` +
          `<div class="import-pick-row">${letters}</div>${raw}</div>`;
      } else if (picked) {
        const idx = picked.charCodeAt(0) - 65;
        const content = (q.options && q.options[idx]) || '';
        answerBlock =
          `<div class="import-q-answer">答案：${escapeHtml(picked)}` +
          (content ? `. ${escapeHtml(content)}` : '') +
          ` <button type="button" class="import-repick" data-qi="${i}">重选</button></div>`;
      } else {
        answerBlock = `<div class="import-q-answer">答案：${escapeHtml(q.answer)}</div>`;
      }
      html +=
        `<article class="import-q${need ? ' is-need-confirm' : ''}" data-qi="${i}">` +
        `<div class="import-q-head">` +
        `<span class="import-q-type">${escapeHtml(TYPE_MAP[q.type] || q.type)}</span>` +
        `<span>第 ${i + 1} 题</span>` +
        (need ? `<span class="import-q-badge">待确认</span>` : '') +
        `</div>` +
        `<div class="import-q-stem">${escapeHtml(q.stem)}</div>` +
        (opts ? `<ul class="import-q-opts">${opts}</ul>` : '') +
        answerBlock +
        (q.analysis ? `<div class="import-q-analysis">解析：${escapeHtml(q.analysis)}</div>` : '') +
        `</article>`;
    });

    if ((res.sa_preview || []).length) {
      html += `<div class="import-sa-preview"><h3 class="import-sa-title">简答预览（另库）</h3>`;
      res.sa_preview.forEach((q, i) => {
        html +=
          `<article class="import-q">` +
          `<div class="import-q-head"><span class="import-q-type">简答题</span><span>简答 ${i + 1}</span></div>` +
          `<div class="import-q-stem">${escapeHtml(q.stem)}</div>` +
          `<div class="import-q-answer">答案：${escapeHtml(q.answer || '')}</div></article>`;
      });
      html += `</div>`;
    }

    list.innerHTML = html || '<p class="hint">没有客观题</p>';
    if (!$('importName').value.trim()) {
      $('importName').value = res.suggested_name || suggestedName || '粘贴导入';
    }
  }

  async function runScan() {
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetchAuth('/api/import/extract', { method: 'POST', body: fd }).then((r) => r.json());
      if (res.ok === false) {
        await uiAlert(res.error || '读取 Word 失败');
        return;
      }
      fullText = res.text || '';
      suggestedName = res.suggested_name || file.name.replace(/\.docx$/i, '');
      $('importText').value = fullText;
      applyScanResult(res.pools || {}, res.detected_types || []);
      if (!res.pools || !Object.keys(res.pools).length) {
        const scanned = await apiJson('/api/import/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fullText }),
        });
        applyScanResult(scanned.pools || {}, scanned.detected_types || []);
      }
    } else {
      fullText = ($('importText').value || '').trim();
      if (!fullText) {
        await uiAlert('请先粘贴题库文本，或选择 .docx 文件');
        return;
      }
      const scanned = await apiJson('/api/import/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText }),
      });
      if (scanned.ok === false) {
        await uiAlert(scanned.error || '扫描失败');
        return;
      }
      applyScanResult(scanned.pools || {}, scanned.detected_types || []);
    }
    preview = null;
    exemplarsState = {};
    ackSkippedTypes = [];
    activeKind = null;
    renderScanOverview();
    setStep(2);
  }

  async function tryContinueFromScan() {
    const ex = collectExemplars();
    if (!Object.keys(ex).length) {
      if (detectedTypes.length === 1) {
        openExemplarKind(detectedTypes[0].kind);
        await uiAlert(`请先为${TYPE_MAP[detectedTypes[0].kind]}选好样板。`);
        return;
      }
      if (!detectedTypes.length) {
        openExemplarKind('choice');
        await uiAlert('请先手贴一道选择题样板。');
        return;
      }
      await uiAlert('请先点一种题型，选好样板后再继续。');
      return;
    }

    const missing = missingDetectedKinds(ex);
    if (missing.length) {
      const coveredLabels = Object.keys(ex).map((k) => TYPE_MAP[k] || k).join('、');
      const missLabels = missing.map((d) => d.label || TYPE_MAP[d.kind] || d.kind).join('、');
      const ok = await uiConfirm(
        `目前只为${coveredLabels}选了样板，继续将只导入这些题型（跳过：${missLabels}）。\n\n要继续预览，还是返回题型页补选？`,
        { title: '只导入部分题型', okText: '继续预览', cancelText: '返回补选' }
      );
      if (!ok) return;
      ackSkippedTypes = uncoveredNeedAck(detectedTypes, coveredFromExemplars(ex));
    } else {
      ackSkippedTypes = [];
    }

    await runPreview();
  }

  async function runPreview() {
    const exemplars = collectExemplars();
    if (!Object.keys(exemplars).length) {
      await uiAlert('请至少为一种题型选好样板。');
      return;
    }
    fullText = ($('importText').value || '').trim() || fullText;
    if (!String(fullText).trim()) {
      await uiAlert('题库文本为空');
      return;
    }
    const importSa = !!( $('importSaCheck') && $('importSaCheck').checked );
    const res = await apiJson('/api/import_text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: fullText,
        html: pasteHtml || undefined,
        exemplar: exemplars.choice || '',
        exemplars,
        preview: true,
        import_sa: importSa,
      }),
    });
    if (res.ok === false) {
      await uiAlert(res.error || '解析失败');
      return;
    }
    renderPreview(res);
    setStep(4);
  }

  async function confirmImport() {
    if (!preview) {
      await uiAlert('请先预览');
      return;
    }
    if (pendingConfirmCount() > 0) {
      await uiAlert('还有待确认答案，请返回预览点选。');
      return;
    }
    const gate = clientGateError();
    if (gate) {
      await uiAlert(gate);
      setStep(2);
      return;
    }
    const exemplars = collectExemplars();
    const name = ($('importName').value || '').trim() || suggestedName || '粘贴导入';
    fullText = ($('importText').value || '').trim() || fullText;
    const importSa = !!( $('importSaCheck') && $('importSaCheck').checked );
    const btn = $('confirmImportBtn');
    btn.disabled = true;
    try {
      const res = await apiJson('/api/import_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fullText,
          html: pasteHtml || undefined,
          exemplar: exemplars.choice || '',
          exemplars,
          name,
          preview: false,
          answer_picks: buildAnswerPicks(),
          ack_skipped_types: ackSkippedPayload(),
          import_sa: importSa,
        }),
      });
      if (res.ok === false) {
        await uiAlert(res.error || '导入失败');
        return;
      }
      if (res.sa_bank_id) {
        await uiAlert(`已另建简答库「${name}·简答」共 ${res.sa_total || 0} 题。`);
      }
      const bankId = res.bank_id || res.sa_bank_id || '';
      window.location.href = bankId ? `/?bank=${encodeURIComponent(bankId)}` : '/';
    } catch (e) {
      await uiAlert('导入失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  async function copyWashPrompt() {
    const text = WASH_PROMPT;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      await uiAlert('洗稿提示词已复制。');
    } catch (e) {
      await uiAlert('复制失败，请手动复制。\n\n' + text);
    }
  }

  $('importFile').addEventListener('change', (e) => {
    file = (e.target.files && e.target.files[0]) || null;
    preview = null;
    fullText = '';
    pasteHtml = '';
    detectedTypes = [];
    scanPools = {};
    exemplarsState = {};
    ackSkippedTypes = [];
    syncFileUi();
    setStep(1);
  });

  $('clearFileBtn').onclick = () => {
    clearSelectedFile();
    preview = null;
    syncFileUi();
    setStep(1);
  };
  // 学习通答题页复制时剪贴板带 text/html（结构化题目 DOM）：
  // 命中特征就缓存给 /api/import_text 后端直解；text/plain 照旧落入文本框兜底展示
  $('importText').addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    const html = cd ? cd.getData('text/html') : '';
    pasteHtml = html && (html.indexOf('questionLi') >= 0 || html.indexOf('rightAnswerContent') >= 0)
      ? html
      : '';
  });
  if ($('switchToPasteBtn')) {
    $('switchToPasteBtn').onclick = () => switchToPasteMode();
  }

  $('toScanBtn').onclick = () => runScan();
  $('backToInputBtn').onclick = () => setStep(1);
  $('toPreviewFromScanBtn').onclick = () => tryContinueFromScan();
  $('backToScanBtn').onclick = () => cancelKindExemplar();
  if ($('confirmKindExemplarBtn')) {
    $('confirmKindExemplarBtn').onclick = () => confirmKindExemplar();
  }
  if ($('toSourceExemplarBtn')) {
    $('toSourceExemplarBtn').onclick = () => showExemplarSourceMode();
  }
  if ($('toTweakExemplarBtn')) {
    $('toTweakExemplarBtn').onclick = () => askOpenTweakFromTop();
  }
  if ($('hideTweakExemplarBtn')) {
    $('hideTweakExemplarBtn').onclick = () => hideTweakPanel();
  }
  if ($('backToPoolExemplarBtn')) {
    $('backToPoolExemplarBtn').onclick = () => backToPoolFromSource();
  }
  if ($('confirmSourceExemplarBtn')) {
    $('confirmSourceExemplarBtn').onclick = () => confirmKindExemplar();
  }
  $('useFirstExemplarBtn').onclick = () => {
    if (!activeKind) return;
    const item = scanPools[activeKind] && scanPools[activeKind].items && scanPools[activeKind].items[0];
    if (!item) {
      uiAlert('该题型池里还没有可作样板的题。');
      return;
    }
    askPickExemplar(item.text || '');
  };
  if ($('clearKindExemplarBtn')) {
    $('clearKindExemplarBtn').onclick = () => {
      $('exemplarActive').value = '';
    };
  }

  $('backToScanFromPreviewBtn').onclick = () => {
    renderScanOverview();
    setStep(2);
  };
  $('toSaveBtn').onclick = async () => {
    if (!preview) return;
    if (pendingConfirmCount() > 0) {
      await uiAlert('还有待确认答案，请先点选。');
      return;
    }
    const gate = clientGateError();
    if (gate) {
      await uiAlert(gate);
      setStep(2);
      return;
    }
    setStep(5);
  };
  $('backToPreviewBtn').onclick = () => setStep(4);
  $('confirmImportBtn').onclick = () => confirmImport();
  if ($('copyWashPromptBtn')) $('copyWashPromptBtn').onclick = () => copyWashPrompt();

  if ($('importSaCheck')) {
    $('importSaCheck').addEventListener('change', () => {
      ackSkippedTypes = [];
    });
  }

  $('scanOverview').addEventListener('click', (e) => {
    const card = e.target.closest('.import-type-card[data-kind]');
    if (!card) return;
    openExemplarKind(card.getAttribute('data-kind'));
  });

  $('exemplarPool').addEventListener('click', (e) => {
    const one = e.target.closest('.import-use-item[data-idx]');
    if (!one || !activeKind) return;
    const idx = Number(one.getAttribute('data-idx'));
    const item = scanPools[activeKind] && scanPools[activeKind].items && scanPools[activeKind].items[idx];
    if (!item) return;
    askPickExemplar(item.text || '');
  });

  $('previewList').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-letter][data-qi]');
    if (pick) {
      const i = Number(pick.getAttribute('data-qi'));
      const letter = pick.getAttribute('data-letter');
      if (!preview || !preview.questions || !preview.questions[i]) return;
      preview.questions[i]._picked = letter;
      renderPreview(preview);
      return;
    }
    const repick = e.target.closest('.import-repick[data-qi]');
    if (repick) {
      const i = Number(repick.getAttribute('data-qi'));
      if (!preview || !preview.questions || !preview.questions[i]) return;
      preview.questions[i]._picked = null;
      preview.questions[i].needs_answer_confirm = true;
      renderPreview(preview);
    }
  });

  // 步骤条：题型 / 样板可回跳
  $('stepTab1').onclick = () => setStep(1);
  $('stepTab2').onclick = () => {
    if (fullText || detectedTypes.length) {
      activeKind = null;
      renderScanOverview();
      setStep(2);
    }
  };
  $('stepTab3').onclick = () => {
    if (activeKind) setStep(3);
    else if (detectedTypes.length) openExemplarKind(detectedTypes[0].kind);
  };

  syncFileUi();
  setStep(1);
})();
