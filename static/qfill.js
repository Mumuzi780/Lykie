// 补图台：扫描全部题库，集中补充标记为【含图片】的缺图题目。
// 流程：上传/粘贴截图（复用 /api/bank_images 上传接口）→ 预览完成后的题干
// （自动在缺图标记处插入 [图:imgN]、移除【含图片：…】与文字描述）→ 保存题干。
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const MISS_MARK_RE = /【含图片[^】]*】/;
  const MISS_MARK_ALL_RE = /【含图片[^】]*】/g;
  const MISS_DESC_ALL_RE = /（图片(?:表格)?内容：(?:[^（）]|（[^（）]*）)*）/g;
  const IMG_MARK_RE = /\[图:([A-Za-z0-9_\-]+)\]/g;

  const TYPE_MAP = { choice: '选择题', judge: '判断题', fill: '填空题', short_answer: '简答题', cloze: '一题多空' };

  let groups = [];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function uiAlert(msg) {
    if (window.LykieDialog && typeof LykieDialog.alert === 'function') return LykieDialog.alert(msg);
    window.alert(msg);
  }

  async function uiConfirm(msg, opts) {
    if (window.LykieDialog && typeof LykieDialog.confirm === 'function') return LykieDialog.confirm(msg, opts);
    return window.confirm(msg);
  }

  async function apiJson(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('未登录');
    }
    return res.json();
  }

  // ---- 完成后的题干推演 ----

  // 尚未写入题干的图片标记（刚上传的）插到首个【含图片】标记的位置；没有标记则追加到末尾。
  // 之后移除所有【含图片：…】与（图片内容：…）描述，得到保存用题干。
  function computeFinalStem(q) {
    let stem = String(q.stem || '');
    const have = new Set();
    let m;
    const re = new RegExp(IMG_MARK_RE.source, 'g');
    while ((m = re.exec(stem))) have.add(m[1]);
    const missing = (q.images || [])
      .filter((e) => e && e.id && !have.has(e.id))
      .map((e) => `[图:${e.id}]`);
    if (missing.length) {
      const insert = missing.join(' ');
      if (MISS_MARK_RE.test(stem)) stem = stem.replace(MISS_MARK_RE, insert);
      else stem = `${stem.replace(/\s+$/, '')} ${insert}`;
    }
    stem = stem.replace(MISS_MARK_ALL_RE, '').replace(MISS_DESC_ALL_RE, '');
    return stem.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  }

  // 题干渲染：[图:imgN] → <img>，残留的【含图片：…】红标提示
  function stemHtml(text, images, bankId) {
    let html = window.qimgRender(text, images, bankId);
    html = html.replace(/【含图片[^】]*】/g, (s) => `<span class="miss-mark">${s}</span>`);
    return html;
  }

  function badge(text, cls) {
    const b = document.createElement('span');
    b.className = 'qfill-badge' + (cls ? ` ${cls}` : '');
    b.textContent = text;
    return b;
  }

  // ---- 卡片 ----

  function buildCard(group, q) {
    const card = document.createElement('article');
    card.className = 'qfill-card';
    let dirty = false; // 用户手动改过题干后，不再自动重算
    let manualStem = '';

    const finalStem = () => (dirty ? manualStem : computeFinalStem(q));
    const hasImages = () => (q.images || []).length > 0;

    async function uploadFile(file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiJson(
        `/api/bank_images/${encodeURIComponent(group.bank_id)}/${encodeURIComponent(q.id)}`,
        { method: 'POST', body: fd },
      );
      if (!res || res.ok === false) { await uiAlert((res && res.error) || '上传失败'); return; }
      q.images = res.images || [];
      dirty = false;
      render();
    }

    async function deleteImage(imgId) {
      const ok = await uiConfirm(`删除图片 ${imgId}？`, { title: '删除图片', okText: '删除', danger: true });
      if (!ok) return;
      const res = await apiJson(
        `/api/bank_images/${encodeURIComponent(group.bank_id)}/${encodeURIComponent(q.id)}/${encodeURIComponent(imgId)}`,
        { method: 'DELETE' },
      );
      if (!res || res.ok === false) { await uiAlert((res && res.error) || '删除失败'); return; }
      q.images = res.images || [];
      dirty = false;
      render();
    }

    async function complete() {
      const stem = finalStem().trim();
      const res = await apiJson('/api/update_question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank_id: group.bank_id, id: q.id, stem }),
      });
      if (!res || res.ok === false) { await uiAlert((res && res.error) || '保存失败'); return; }
      card.classList.add('is-leaving');
      setTimeout(() => {
        const head = card.previousElementSibling; // 先取组标题再移除卡片
        card.remove();
        group.questions = group.questions.filter((x) => x !== q);
        updateCounts();
        if (!group.questions.length) {
          if (head && head.classList.contains('qfill-group-title')) head.remove();
        }
        if (!groups.some((g) => g.questions.length)) renderEmpty();
      }, 250);
    }

    function render() {
      card.innerHTML = '';

      const meta = document.createElement('div');
      meta.className = 'qfill-card-meta';
      meta.appendChild(badge(`题号 ${q.num || q.id}`));
      meta.appendChild(badge(TYPE_MAP[q.type] || q.type || '题目'));
      MISS_MARK_ALL_RE.lastIndex = 0;
      const marks = String(q.stem || '').match(MISS_MARK_ALL_RE) || [];
      marks.forEach((mk) => {
        meta.appendChild(badge(mk.replace(/^【含图片：?/, '').replace(/】$/, '') || '缺图', 'is-warn'));
      });

      const stemEl = document.createElement('div');
      stemEl.className = 'qfill-stem';
      const preview = hasImages() || dirty ? finalStem() : q.stem;
      stemEl.innerHTML = stemHtml(preview, q.images, group.bank_id);

      const imgs = document.createElement('div');
      imgs.className = 'qfill-imgs';
      (q.images || []).forEach((e) => {
        const thumb = document.createElement('div');
        thumb.className = 'qfill-thumb';
        const im = document.createElement('img');
        im.src = `/api/bank_images/${encodeURIComponent(group.bank_id)}/${encodeURIComponent(e.file)}`;
        im.alt = e.alt || e.id;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'qfill-thumb-del';
        del.textContent = '×';
        del.title = '删除这张图片';
        del.onclick = () => deleteImage(e.id);
        thumb.appendChild(im);
        thumb.appendChild(del);
        imgs.appendChild(thumb);
      });
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn ghost';
      upBtn.textContent = hasImages() ? '继续补图' : '上传图片';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
      fileInput.hidden = true;
      upBtn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (f) await uploadFile(f);
      };
      imgs.appendChild(upBtn);
      imgs.appendChild(fileInput);

      const actions = document.createElement('div');
      actions.className = 'qfill-actions';
      const hint = document.createElement('span');
      hint.className = 'qfill-paste-hint';
      hint.textContent = '支持 Ctrl+V 直接粘贴截图；可连续补多张';
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn primary qfill-done-btn';
      doneBtn.textContent = '完成补图';
      doneBtn.disabled = !hasImages();
      doneBtn.title = hasImages() ? '保存题干并移除缺图标记' : '先上传至少一张图片';
      doneBtn.onclick = complete;
      actions.appendChild(hint);
      actions.appendChild(doneBtn);

      const edit = document.createElement('details');
      edit.className = 'qfill-stem-edit';
      const summary = document.createElement('summary');
      summary.textContent = '手动调整题干（图片标记位置不对时改这里）';
      const ta = document.createElement('textarea');
      ta.value = finalStem();
      ta.oninput = () => { dirty = true; manualStem = ta.value; stemEl.innerHTML = stemHtml(manualStem, q.images, group.bank_id); };
      edit.appendChild(summary);
      edit.appendChild(ta);

      card.appendChild(meta);
      card.appendChild(stemEl);
      card.appendChild(imgs);
      card.appendChild(actions);
      card.appendChild(edit);
    }

    // 卡片内 Ctrl+V 粘贴截图
    card.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); uploadFile(f); return; }
        }
      }
    });

    render();
    return card;
  }

  // ---- 列表 ----

  function updateCounts() {
    const total = groups.reduce((n, g) => n + g.questions.length, 0);
    const lead = $('qfillLead');
    if (lead) {
      lead.textContent = total
        ? `共 ${total} 道缺图题，分布在 ${groups.filter((g) => g.questions.length).length} 个题库。上传或粘贴截图，确认效果后点「完成补图」。`
        : '全部题库都没有缺图标记，无需补图。';
    }
  }

  function renderEmpty() {
    const list = $('qfillList');
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'qfill-empty';
    p.textContent = '全部补图完成 🎉';
    list.appendChild(p);
    updateCounts();
  }

  function renderList() {
    const list = $('qfillList');
    list.innerHTML = '';
    groups.forEach((g) => {
      if (!g.questions.length) return;
      const title = document.createElement('h2');
      title.className = 'qfill-group-title';
      title.textContent = g.bank_name;
      const count = document.createElement('span');
      count.className = 'qfill-group-count';
      count.textContent = `${g.questions.length} 题`;
      title.appendChild(count);
      list.appendChild(title);
      g.questions.forEach((q) => list.appendChild(buildCard(g, q)));
    });
    updateCounts();
    if (!groups.some((g) => g.questions.length)) renderEmpty();
  }

  async function load() {
    const list = $('qfillList');
    const res = await apiJson('/api/missing_images');
    if (res.ok === false) {
      list.innerHTML = `<p class="hint">${escapeHtml(res.error || '加载失败')}</p>`;
      return;
    }
    groups = res.groups || [];
    renderList();
  }

  document.addEventListener('DOMContentLoaded', load);
})();
