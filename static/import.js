/* 独立导入页：输入 → 预览 → 入库 */
(function () {
  const $ = (id) => document.getElementById(id);

  const TYPE_MAP = {
    choice: '选择题',
    judge: '判断题',
    fill: '填空题',
    short_answer: '简答题',
  };

  let step = 1;
  let source = 'text'; // 'text' | 'file'
  let file = null;
  let preview = null; // { total, questions, suggested_name }

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
    $('panelPreview').hidden = n !== 2;
    $('panelSave').hidden = n !== 3;

    [1, 2, 3].forEach((i) => {
      const tab = $('stepTab' + i);
      if (!tab) return;
      tab.classList.toggle('is-active', i === n);
      tab.classList.toggle('is-done', i < n);
      tab.disabled = i > n && !(i === 2 && preview) && !(i === 3 && preview);
      if (i === 2) tab.disabled = !preview && n < 2;
      if (i === 3) tab.disabled = !preview && n < 3;
    });
  }

  function syncFileUi() {
    const nameEl = $('importFileName');
    const clearBtn = $('clearFileBtn');
    if (file) {
      nameEl.textContent = file.name;
      clearBtn.hidden = false;
      source = 'file';
      $('inputHint').textContent = '将解析所选 Word 文件；确认入库前可随时清除文件改用粘贴。';
    } else {
      nameEl.textContent = '未选择文件';
      clearBtn.hidden = true;
      source = 'text';
      $('inputHint').textContent = '已选 Word 时，将以文件内容为准；也可清空文件后只粘贴文本。';
    }
  }

  function renderPreview(res) {
    preview = res;
    $('previewSummary').textContent = `共解析出 ${res.total} 题，请核对题干与答案。`;
    $('saveSummary').textContent = `将导入 ${res.total} 题到新题库。`;
    const list = $('previewList');
    let html = '';
    (res.questions || []).forEach((q, i) => {
      const opts = (q.options || [])
        .map((o, idx) => `<li>${String.fromCharCode(65 + idx)}. ${escapeHtml(o)}</li>`)
        .join('');
      html +=
        `<article class="import-q">` +
        `<div class="import-q-head">` +
        `<span class="import-q-type">${escapeHtml(TYPE_MAP[q.type] || q.type)}</span>` +
        `<span>第 ${i + 1} 题</span>` +
        `</div>` +
        `<div class="import-q-stem">${escapeHtml(q.stem)}</div>` +
        (opts ? `<ul class="import-q-opts">${opts}</ul>` : '') +
        `<div class="import-q-answer">答案：${escapeHtml(q.answer)}</div>` +
        (q.analysis ? `<div class="import-q-analysis">解析：${escapeHtml(q.analysis)}</div>` : '') +
        `</article>`;
    });
    list.innerHTML = html || '<p class="hint">没有题目</p>';

    const nameInput = $('importName');
    if (!nameInput.value.trim()) {
      nameInput.value = res.suggested_name || (source === 'file' && file ? file.name.replace(/\.docx$/i, '') : '粘贴导入');
    }
  }

  async function runPreview() {
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('preview', 'true');
      const res = await fetchAuth('/api/import', { method: 'POST', body: fd }).then((r) => r.json());
      if (res.ok === false) {
        await uiAlert(res.error || '解析失败');
        return;
      }
      renderPreview(res);
      setStep(2);
      return;
    }

    const text = ($('importText').value || '').trim();
    if (!text) {
      await uiAlert('请先粘贴题库文本，或选择 .docx 文件');
      return;
    }
    const res = await apiJson('/api/import_text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, preview: true }),
    });
    if (res.ok === false) {
      await uiAlert(res.error || '解析失败');
      return;
    }
    renderPreview(res);
    setStep(2);
  }

  async function confirmImport() {
    if (!preview) {
      await uiAlert('请先预览解析结果');
      return;
    }
    const name = ($('importName').value || '').trim() || (preview.suggested_name || '粘贴导入');
    const btn = $('confirmImportBtn');
    btn.disabled = true;
    try {
      let res;
      if (source === 'file' && file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', name);
        fd.append('preview', 'false');
        res = await fetchAuth('/api/import', { method: 'POST', body: fd }).then((r) => r.json());
      } else {
        const text = $('importText').value || '';
        res = await apiJson('/api/import_text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, name, preview: false }),
        });
      }
      if (res.ok === false) {
        await uiAlert(res.error || '导入失败');
        return;
      }
      const bankId = res.bank_id || '';
      window.location.href = bankId ? `/?bank=${encodeURIComponent(bankId)}` : '/';
    } catch (e) {
      await uiAlert('导入失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    file = f || null;
    preview = null;
    syncFileUi();
    setStep(1);
  });

  $('clearFileBtn').onclick = () => {
    file = null;
    $('importFile').value = '';
    preview = null;
    syncFileUi();
    setStep(1);
  };

  $('toPreviewBtn').onclick = () => runPreview();
  $('backToInputBtn').onclick = () => setStep(1);
  $('toSaveBtn').onclick = () => {
    if (!preview) return;
    setStep(3);
  };
  $('backToPreviewBtn').onclick = () => setStep(2);
  $('confirmImportBtn').onclick = () => confirmImport();

  syncFileUi();
  setStep(1);
})();
