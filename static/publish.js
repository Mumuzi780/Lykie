/* 官方题库发布台：文件夹 / 试卷 → 题库市场（领取者得到同名文件夹） */
(function () {
  const $ = (id) => document.getElementById(id);

  const LEAD = {
    folder: '发布文件夹：内部题库与试卷保持独立、原样打包；领取者会收到一个同名文件夹。',
    paper: '一套试卷 = 一个文件夹：发布后领取者收到一个文件夹，里面是这张完整试卷。',
  };
  const EMPTY = {
    folder: '还没有文件夹。去背题页侧栏新建文件夹，把题库/试卷拖进去，再回来上架。',
    paper: '还没有试卷。去「导入 → 导入试卷」生成试卷，再回来上架。',
  };

  let data = { folders: [], papers: [] };
  let activeKind = 'folder';
  let formTarget = null; // { kind, id, meta }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
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

  async function loadData() {
    const list = $('publishList');
    list.innerHTML = '<p class="hint">加载中…</p>';
    const res = await apiJson('/api/official_publishables');
    if (res.ok === false) {
      list.innerHTML = `<p class="hint">${escapeHtml(res.error || '加载失败')}</p>`;
      return;
    }
    data = {
      folders: res.folders || [],
      papers: res.papers || [],
    };
    renderList();
  }

  function switchKind(kind) {
    activeKind = kind;
    document.querySelectorAll('#publishSwitch .import-switch-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.kind === kind);
    });
    $('publishLead').textContent = LEAD[kind] || LEAD.folder;
    renderList();
  }

  function liveBadge(v) {
    if (!v) return '';
    return `<span class="publish-badge is-live">已上架 v${v}</span>`;
  }

  function folderRowHtml(item) {
    const v = item.published_version || 0;
    const parts = [];
    if (item.bank_count) parts.push(`${item.bank_count} 套题库`);
    if (item.paper_count) parts.push(`${item.paper_count} 套试卷`);
    const canPublish = item.bank_count > 0 || item.paper_count > 0;
    return (
      `<div class="publish-row">` +
      `<div class="publish-row-main">` +
      `<span class="publish-row-title">${escapeHtml(item.name)}</span>` +
      `<span class="publish-row-meta">` +
      `<span>${parts.join(' · ') || '空文件夹'}</span>${liveBadge(v)}</span>` +
      `</div>` +
      `<div class="publish-row-actions">` +
      (canPublish
        ? `<button type="button" class="btn ghost" data-publish="folder" data-id="${escapeHtml(item.id)}">${v ? '更新' : '发布'}</button>`
        : `<button type="button" class="btn ghost" disabled>文件夹是空的</button>`) +
      `</div></div>`
    );
  }

  function paperRowHtml(item) {
    const v = item.published_version || 0;
    return (
      `<div class="publish-row">` +
      `<div class="publish-row-main">` +
      `<span class="publish-row-title">${escapeHtml(item.title)}</span>` +
      `<span class="publish-row-meta"><span>${item.section_count} 个节</span>${liveBadge(v)}</span>` +
      `</div>` +
      `<div class="publish-row-actions">` +
      `<button type="button" class="btn ghost" data-publish="paper" data-id="${escapeHtml(item.id)}">${v ? '更新' : '发布'}</button>` +
      `</div></div>`
    );
  }

  function renderList() {
    const list = $('publishList');
    const items = data[activeKind + 's'] || [];
    if (!items.length) {
      list.innerHTML = `<p class="hint">${EMPTY[activeKind] || '没有可发布的内容'}</p>`;
      return;
    }
    list.innerHTML = items
      .map((it) => (activeKind === 'folder' ? folderRowHtml(it) : paperRowHtml(it)))
      .join('');
    list.querySelectorAll('[data-publish]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id;
        const item = items.find((x) => String(x.id) === id);
        if (item) openPublishForm(activeKind, item);
      };
    });
  }

  function openPublishForm(kind, item) {
    formTarget = { kind, id: String(item.id) };
    const v = item.published_version || 0;
    $('publishFormTitle').textContent =
      `${kind === 'paper' ? '发布试卷' : '发布文件夹'}${v ? `（更新 v${v} → v${v + 1}）` : ''}`;
    $('publishName').value = item.published_name || item.name || item.title || '';
    $('publishDesc').value = item.published_description || '';
    $('publishTags').value = (item.published_tags || []).join(',');
    $('publishFormHint').textContent =
      kind === 'folder'
        ? `「${item.name}」将按原结构上架（${item.bank_count} 套题库、${item.paper_count} 套试卷）。领取者收到同名文件夹。`
        : '领取者会在侧栏收到一个文件夹，里面是这张完整试卷。';
    $('publishFormModal').hidden = false;
    $('publishName').focus();
  }

  function closePublishForm() {
    $('publishFormModal').hidden = true;
    formTarget = null;
  }

  async function submitPublish() {
    if (!formTarget) return;
    const name = $('publishName').value.trim();
    if (!name) {
      await uiAlert('请填写名称');
      return;
    }
    const tags = $('publishTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    const btn = $('publishFormSubmit');
    btn.disabled = true;
    try {
      const res = await apiJson('/api/official_banks/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: formTarget.kind,
          id: formTarget.id,
          name: name,
          description: $('publishDesc').value.trim(),
          tags: tags,
        }),
      });
      if (res.ok === false) {
        await uiAlert(res.error || '发布失败');
        return;
      }
      closePublishForm();
      const parts = [];
      if (res.total_banks) parts.push(`${res.total_banks} 套题库`);
      if (res.total_papers) parts.push(`${res.total_papers} 套试卷`);
      await uiAlert(
        `已上架文件夹「${res.name}」v${res.version}（${parts.join('、') || '内容包'}）。` +
        '所有账号可在题库市场领取，领取后侧栏出现同名文件夹。'
      );
      await loadData();
    } finally {
      btn.disabled = false;
    }
  }

  document.querySelectorAll('#publishSwitch .import-switch-btn').forEach((b) => {
    b.onclick = () => switchKind(b.dataset.kind);
  });
  $('publishFormClose').onclick = () => closePublishForm();
  $('publishFormCancel').onclick = () => closePublishForm();
  $('publishFormSubmit').onclick = () => submitPublish();
  $('publishFormModal').addEventListener('click', (e) => {
    if (e.target === $('publishFormModal')) closePublishForm();
  });

  loadData();
})();
