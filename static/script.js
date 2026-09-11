let current = null;    // 当前题目
let submitted = false; // 是否已显示答案
let userChoice = null; // 用户作答（选择题=字母，判断=对/错，填空=文本）

let editSource = 'card';  // 编辑来源：'card' 背诵卡片 / 'list' 题库列表
let editBankId = null;    // 列表编辑时的题库 id
let editQuestionId = null;
let viewBankId = null;    // 当前查看的题库 id
let studyMode = 'kill';    // 'kill' | 'sa'
/** 本张题是否已作答 / 是否答对（影响斩时是否再记连击） */
let answeredThisDraw = false;
let answeredCorrectThisDraw = false;
let settleRunIndex = null;
let settleCache = null;
let currentBankId = null;
/** 当前会话连对（与服务端 run_streak 同步；切库/答错清零） */
let sessionStreak = 0;


function uiAlert(message, opts) {
  if (window.LykieDialog) return LykieDialog.alert(message, opts);
  window.alert(String(message == null ? '' : message));
  return Promise.resolve(true);
}
function uiConfirm(message, opts) {
  if (window.LykieDialog) return LykieDialog.confirm(message, opts);
  return Promise.resolve(!!window.confirm(String(message == null ? '' : message)));
}
function uiPrompt(message, defaultValue, opts) {
  if (window.LykieDialog) return LykieDialog.prompt(message, defaultValue, opts);
  const v = window.prompt(
    String(message == null ? '' : message),
    defaultValue == null ? '' : String(defaultValue)
  );
  return Promise.resolve(v);
}

function rewardCorrect() {
  sessionStreak += 1;
  if (window.LykieSfx) LykieSfx.onCorrect(sessionStreak);
  if (window.LykieFx) LykieFx.onCorrect(sessionStreak);
  return sessionStreak;
}

function rewardWrong() {
  sessionStreak = 0;
  if (window.LykieSfx) LykieSfx.onWrong();
  if (window.LykieFx) LykieFx.onWrong();
}

function rewardReset() {
  sessionStreak = 0;
  if (window.LykieFx) LykieFx.resetComboBadge();
}

window.LykieReward = {
  correct: rewardCorrect,
  wrong: rewardWrong,
  reset: rewardReset,
  get: () => sessionStreak,
};

const $ = id => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function redirectIfLoggedOut(res) {
  if (res && res.status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

/** 页面壳上的用户名与接口会话不一致时强制重载（防手机缓存串号）。 */
function assertSessionUser(data) {
  if (!data || !data.username) return;
  const shown = (document.body && document.body.dataset.username) || '';
  if (shown && data.username !== shown) {
    window.location.replace('/?_=' + Date.now());
    throw new Error('账号会话不一致，正在刷新');
  }
}

async function fetchAuth(path, opts) {
  const res = await fetch(path, {
    ...(opts || {}),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (redirectIfLoggedOut(res)) {
    throw new Error('未登录');
  }
  return res;
}

async function api(path, opts) {
  const res = await fetchAuth(path, opts);
  const data = await res.json();
  assertSessionUser(data);
  return data;
}

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    window.location.reload();
  }
});

function extractContent(opt) {
  const m = opt.match(/^[A-H][.、．\s]*(.*)$/);
  return m ? m[1] : opt;
}

const TYPE_MAP = { choice: '选择题', judge: '判断题', fill: '填空题', short_answer: '简答题' };

// ==================== 主题切换 ====================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem('theme', theme);
  } catch (e) { /* 忽略存储异常 */ }
  refreshCelestial();
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
}

// ==================== 题库列表 / 文件夹 ====================
let foldersCache = [];
const FOLDER_COLLAPSE_KEY = 'lykieFolderCollapsed';

function loadFolderCollapsedMap() {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_COLLAPSE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function saveFolderCollapsedMap(map) {
  try {
    localStorage.setItem(FOLDER_COLLAPSE_KEY, JSON.stringify(map || {}));
  } catch (e) { /* ignore */ }
}

function isFolderCollapsed(fid) {
  const map = loadFolderCollapsedMap();
  return !!map[String(fid)];
}

function setFolderCollapsed(fid, collapsed) {
  const map = loadFolderCollapsedMap();
  if (collapsed) map[String(fid)] = true;
  else delete map[String(fid)];
  saveFolderCollapsedMap(map);
}

function appendBankItem(listEl, b, opts) {
  opts = opts || {};
  const mockCol =
    window.LykieMock && typeof LykieMock.getActiveCollectionId === 'function'
      ? LykieMock.getActiveCollectionId()
      : null;
  const li = document.createElement('li');
  li.className = 'bank-item'
    + (!mockCol && b.id === currentBankId ? ' active' : '')
    + (b.is_sa ? ' bank-sa' : '')
    + (opts.nested ? ' bank-item-nested' : '');
  li.dataset.bankId = String(b.id);
  if (b.folder_id) li.dataset.folderId = String(b.folder_id);
  const progress = b.is_sa
    ? `简答 · ${b.total} 题`
    : `已斩 ${b.killed}/${b.total}`;
  li.innerHTML =
    `<div class="bank-name">${escapeHtml(b.name)}</div>` +
    `<div class="bank-meta">${escapeHtml(b.imported_at)}</div>` +
    `<div class="bank-progress">${progress}</div>` +
    `<div class="bank-actions">` +
      `<button class="mini-btn" data-act="view">查看</button>` +
      `<button class="mini-btn" data-act="move">移入</button>` +
      `<button class="mini-btn" data-act="rename">重命名</button>` +
      `<button class="mini-btn danger" data-act="delete">删除</button>` +
    `</div>`;
  li.onclick = () => selectBank(b.id);
  li.querySelector('[data-act="view"]').onclick = e => { e.stopPropagation(); openBankView(b.id); };
  li.querySelector('[data-act="move"]').onclick = e => { e.stopPropagation(); openMoveBankModal(b); };
  li.querySelector('[data-act="rename"]').onclick = e => { e.stopPropagation(); renameBank(b); };
  li.querySelector('[data-act="delete"]').onclick = e => { e.stopPropagation(); deleteBank(b); };
  listEl.appendChild(li);
}

function appendFolderBlock(listEl, folder, childBanks) {
  const collapsed = isFolderCollapsed(folder.id);
  const li = document.createElement('li');
  li.className = 'bank-folder' + (collapsed ? ' collapsed' : '');
  li.dataset.folderId = String(folder.id);

  const head = document.createElement('div');
  head.className = 'bank-folder-head';
  head.innerHTML =
    `<span class="bank-folder-drag" draggable="true" title="拖拽调整顺序" aria-label="拖拽调整顺序">⋮⋮</span>` +
    `<button type="button" class="bank-folder-toggle" aria-label="展开或折叠" data-act="toggle">` +
    `<span class="bank-folder-chevron">${collapsed ? '▸' : '▾'}</span></button>` +
    `<div class="bank-folder-main">` +
    `<div class="bank-name">${escapeHtml(folder.name)}</div>` +
    `<div class="bank-progress">${childBanks.length} 个题库</div>` +
    `</div>` +
    `<div class="bank-actions">` +
    `<button class="mini-btn" data-act="rename">重命名</button>` +
    `<button class="mini-btn danger" data-act="delete">删除</button>` +
    `</div>`;

  const children = document.createElement('ul');
  children.className = 'bank-folder-children';
  childBanks.forEach((b) => appendBankItem(children, b, { nested: true }));

  const toggle = () => {
    const next = !li.classList.contains('collapsed');
    li.classList.toggle('collapsed', next);
    setFolderCollapsed(folder.id, next);
    const chev = head.querySelector('.bank-folder-chevron');
    if (chev) chev.textContent = next ? '▸' : '▾';
  };
  head.querySelector('[data-act="toggle"]').onclick = (e) => { e.stopPropagation(); toggle(); };
  head.querySelector('.bank-folder-main').onclick = (e) => { e.stopPropagation(); toggle(); };
  head.querySelector('[data-act="rename"]').onclick = (e) => { e.stopPropagation(); renameFolder(folder); };
  head.querySelector('[data-act="delete"]').onclick = (e) => { e.stopPropagation(); deleteFolder(folder); };
  bindFolderDrag(li, head.querySelector('.bank-folder-drag'));

  li.appendChild(head);
  li.appendChild(children);
  listEl.appendChild(li);
}

let folderDragId = null;

function clearFolderDragMarkers() {
  document.querySelectorAll('.bank-folder.dragging, .bank-folder.drag-over-before, .bank-folder.drag-over-after')
    .forEach((el) => el.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
}

function bindFolderDrag(li, handle) {
  if (!handle) return;
  handle.addEventListener('dragstart', (e) => {
    folderDragId = li.dataset.folderId;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', folderDragId);
    } catch (_) { /* ignore */ }
  });
  handle.addEventListener('dragend', () => {
    folderDragId = null;
    clearFolderDragMarkers();
  });

  li.addEventListener('dragover', (e) => {
    if (!folderDragId || folderDragId === li.dataset.folderId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('drag-over-before', before);
    li.classList.toggle('drag-over-after', !before);
    document.querySelectorAll('.bank-folder').forEach((other) => {
      if (other !== li) other.classList.remove('drag-over-before', 'drag-over-after');
    });
  });

  li.addEventListener('dragleave', (e) => {
    if (!li.contains(e.relatedTarget)) {
      li.classList.remove('drag-over-before', 'drag-over-after');
    }
  });

  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    const fromId = folderDragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    const toId = li.dataset.folderId;
    const placeBefore = li.classList.contains('drag-over-before');
    clearFolderDragMarkers();
    folderDragId = null;
    if (!fromId || !toId || fromId === toId) return;

    const list = $('bankList');
    const folders = [...list.querySelectorAll(':scope > .bank-folder')];
    const fromEl = folders.find((el) => el.dataset.folderId === fromId);
    const toEl = folders.find((el) => el.dataset.folderId === toId);
    if (!fromEl || !toEl) return;

    if (placeBefore) list.insertBefore(fromEl, toEl);
    else list.insertBefore(fromEl, toEl.nextSibling);

    const ids = [...list.querySelectorAll(':scope > .bank-folder')].map((el) => el.dataset.folderId);
    const res = await api('/api/folders/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.ok === false) {
      await uiAlert(res.error || '排序失败');
      await refreshBanks();
      return;
    }
    foldersCache = res.folders || foldersCache;
  });
}

async function refreshBanks() {
  const data = await api('/api/banks');
  currentBankId = data.current_bank_id;
  foldersCache = data.folders || [];
  if (window.LykieMock) LykieMock.onBanksPayload(data);
  const list = $('bankList');
  list.innerHTML = '';

  const banks = data.banks || [];
  const folderIds = new Set((foldersCache || []).map((f) => String(f.id)));
  const rootBanks = banks.filter((b) => !b.folder_id || !folderIds.has(String(b.folder_id)));
  rootBanks.forEach((b) => appendBankItem(list, b, { nested: false }));

  (foldersCache || []).forEach((f) => {
    const kids = banks.filter((b) => String(b.folder_id || '') === String(f.id));
    appendFolderBlock(list, f, kids);
  });

  if (window.LykieMock) LykieMock.appendCollections(list, data.collections || []);
  return data;
}

async function createFolder() {
  const name = await uiPrompt('文件夹名称：', '', { title: '新建文件夹', placeholder: '例如：计算机组成原理' });
  if (name === null) return;
  const trimmed = String(name).trim();
  if (!trimmed) {
    await uiAlert('名称不能为空');
    return;
  }
  const res = await api('/api/folders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: trimmed }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '创建失败');
    return;
  }
  await refreshBanks();
}

async function renameFolder(folder) {
  const name = await uiPrompt('文件夹名称：', folder.name, { title: '重命名文件夹' });
  if (name === null) return;
  const trimmed = String(name).trim();
  if (!trimmed) {
    await uiAlert('名称不能为空');
    return;
  }
  const res = await api('/api/folders/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: folder.id, name: trimmed }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '重命名失败');
    return;
  }
  await refreshBanks();
}

async function deleteFolder(folder) {
  if (
    !(await uiConfirm(
      `删除文件夹「${folder.name}」？\n里面的题库会回到根列表，不会被删除。`,
      { title: '删除文件夹', okText: '删除', danger: true }
    ))
  ) {
    return;
  }
  const res = await api('/api/folders/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: folder.id }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '删除失败');
    return;
  }
  await refreshBanks();
}

function openMoveBankModal(bank) {
  const modal = $('bankMoveModal');
  const box = $('bankMoveList');
  if (!modal || !box) return;
  const folders = foldersCache || [];
  const cur = bank.folder_id ? String(bank.folder_id) : '';
  box.innerHTML =
    `<button type="button" class="bank-move-opt${cur === '' ? ' is-current' : ''}" data-fid="">` +
    `移出到根列表</button>` +
    folders
      .map(
        (f) =>
          `<button type="button" class="bank-move-opt${cur === String(f.id) ? ' is-current' : ''}" data-fid="${escapeHtml(f.id)}">` +
          `${escapeHtml(f.name)}</button>`
      )
      .join('');
  box.querySelectorAll('.bank-move-opt').forEach((btn) => {
    btn.onclick = async () => {
      const fid = btn.getAttribute('data-fid') || '';
      const res = await api('/api/banks/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bank.id, folder_id: fid || null }),
      });
      if (res.ok === false) {
        await uiAlert(res.error || '移动失败');
        return;
      }
      modal.hidden = true;
      if (typeof setModalScrollLock === 'function') setModalScrollLock(false);
      await refreshBanks();
    };
  });
  const title = $('bankMoveTitle');
  if (title) title.textContent = `移入文件夹 · ${bank.name}`;
  modal.hidden = false;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(true);
}

function closeMoveBankModal() {
  const modal = $('bankMoveModal');
  if (modal) modal.hidden = true;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(false);
}

async function selectBank(id) {
  if (window.LykieMock && typeof LykieMock.guardBankSwitch === 'function') {
    const ok = await LykieMock.guardBankSwitch();
    if (!ok) return;
  }
  // 结算详情锁 / 模考结算壳会挡住切库；切库前先卸掉
  if (typeof closeSettleDetail === 'function') closeSettleDetail();
  if (window.LykieMock && typeof LykieMock.exitMockChrome === 'function') {
    LykieMock.exitMockChrome();
  }
  setSettleView(false);
  const switched = id !== currentBankId;
  rewardReset();
  if (switched && window.LykieSfx) LykieSfx.onBankSwitch();
  await api('/api/select_bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  setBankDrawerOpen(false);
  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
}

function setModeChrome(mode) {
  studyMode = mode;
  document.body.classList.toggle('mode-sa', mode === 'sa');
  document.body.classList.toggle('mode-kill', mode === 'kill');
  document.body.classList.remove('mode-mock', 'mode-wrong');
  const sub = $('brandSub');
  if (sub) sub.textContent = mode === 'sa' ? '简答' : '背题';

  if ($('stats')) $('stats').hidden = mode !== 'kill';
  if ($('saStats')) $('saStats').hidden = mode !== 'sa';
  if ($('saControls')) $('saControls').hidden = mode !== 'sa';
  if ($('killControls')) $('killControls').hidden = mode !== 'kill';
  if ($('progress')) $('progress').hidden = mode !== 'kill';
  if ($('resetBtn')) $('resetBtn').hidden = mode !== 'kill';
  if ($('saResetBtn')) $('saResetBtn').hidden = mode !== 'sa';
  if ($('saEditKwBtn')) $('saEditKwBtn').hidden = mode !== 'sa';
  if (mode !== 'kill' && $('killBtn')) $('killBtn').hidden = true;
  if ($('mockTimer')) $('mockTimer').hidden = true;
}

async function enterSaMode() {
  setModeChrome('sa');
  setStudyCardVisible(false);
  $('killBtn').hidden = true;
  hideAllBtns();
  if ($('emptyState')) $('emptyState').hidden = true;
  if ($('progress')) $('progress').textContent = '';
  if ($('studyHost')) $('studyHost').hidden = false;
  if ($('saStack')) $('saStack').hidden = false;
  if (window.SaTrain) await window.SaTrain.boot();
}

async function enterKillMode() {
  setModeChrome('kill');
  if ($('saStack')) $('saStack').hidden = true;
  if ($('saCard')) $('saCard').hidden = true;
  if ($('saEmpty')) $('saEmpty').hidden = true;
  if ($('saControls')) $('saControls').innerHTML = '';
  await loadNext();
}

async function syncStudyMode(status) {
  if (status && status.is_sa) await enterSaMode();
  else await enterKillMode();
}

async function renameBank(bank) {
  const name = await uiPrompt('请输入新的题库名称：', bank.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) { await uiAlert('名称不能为空'); return; }
  const res = await api('/api/rename_bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bank.id, name: trimmed }),
  });
  if (res.ok === false) { await uiAlert(res.error || '重命名失败'); return; }
  await refreshBanks();
  await refreshStatus();
}

async function deleteBank(bank) {
  if (!await uiConfirm(`确定删除题库「${bank.name}」吗？\n\n题库内所有题目和进度将永久丢失，无法恢复。`, { title: '删除题库', okText: '删除', danger: true })) return;
  const res = await api('/api/delete_bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bank.id }),
  });
  if (res.ok === false) { await uiAlert(res.error || '删除失败'); return; }
  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
}

// ==================== 题库详情（可视化） ====================
async function openBankView(bankId) {
  viewBankId = bankId;
  const data = await api('/api/bank_questions?bank_id=' + encodeURIComponent(bankId));
  $('bankModalTitle').textContent = `${data.name} · 共 ${data.questions.length} 题`;
  renderQuestionList(data.questions, bankId);
  $('bankModal').hidden = false;
}

function renderQuestionList(questions, bankId) {
  const list = $('questionList');
  list.innerHTML = '';
  if (!questions.length) {
    list.innerHTML = '<div class="q-empty">题库为空</div>';
    return;
  }
  questions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'question-item';
    const optText = q.type === 'choice'
      ? q.options.map((o, i) => `${'ABCDEFGH'[i]}.${o}`).join('　')
      : '';
    div.innerHTML =
      `<div class="q-head">` +
        `<span class="q-type">${TYPE_MAP[q.type] || q.type}</span>` +
        `<span class="q-tag ${q.status === 'killed' ? 'killed' : ''}">${q.status === 'killed' ? '已斩' : '活跃'}</span>` +
        `<button class="mini-btn q-edit">编辑</button>` +
        `<button class="mini-btn q-del">删除</button>` +
      `</div>` +
      `<div class="q-stem">${escapeHtml(q.stem)}</div>` +
      (optText ? `<div class="q-options">${escapeHtml(optText)}</div>` : '') +
      `<div class="q-answer">答案：${escapeHtml(q.answer)}</div>` +
      `<div class="q-analysis">解析：${escapeHtml(q.analysis || '无')}</div>`;
    div.querySelector('.q-edit').onclick = () => openEditFromList(q, bankId);
    div.querySelector('.q-del').onclick = () => deleteQuestion(q, bankId);
    list.appendChild(div);
  });
}

async function refreshBankView() {
  if (viewBankId) {
    const data = await api('/api/bank_questions?bank_id=' + encodeURIComponent(viewBankId));
    $('bankModalTitle').textContent = `${data.name} · 共 ${data.questions.length} 题`;
    renderQuestionList(data.questions, viewBankId);
  }
}

async function deleteQuestion(q, bankId) {
  if (!await uiConfirm(`确定删除这道题吗？\n\n${q.stem}`, { title: '删除题目', okText: '删除', danger: true })) return;
  const res = await api('/api/delete_question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_id: bankId, id: q.id }),
  });
  if (res.ok === false) { await uiAlert(res.error || '删除失败'); return; }
  await refreshBankView();
  await refreshBanks();
  await refreshStatus();
}

// ==================== 状态与进度 ====================
async function refreshStatus() {
  const s = await api('/api/status');
  const stats = $('stats');
  if (s.total === 0) {
    stats.textContent = '尚未导入题库';
  } else {
    stats.textContent = `${s.name || ''} · 共 ${s.total} 题 · 已斩 ${s.killed} · 活跃 ${s.active}`;
  }
  $('progress').textContent = s.total === 0 ? '' : `已斩 ${s.killed} / ${s.total}`;
  updateKillBar(s);
  return s;
}

function updateKillBar(s) {
  const fill = $('killFill');
  fill.style.width = s.total > 0 ? (s.killed / s.total * 100).toFixed(1) + '%' : '0%';
}

// ==================== 抽题与渲染 ====================
function hideAllBtns() {
  $('confirmBtn').hidden = true;
  $('nextBtn').hidden = true;
  $('judgeBtns').hidden = true;
}

function setStudyCardVisible(show) {
  const host = $('studyHost');
  const stack = $('cardStack');
  const card = $('card');
  if (host && studyMode === 'kill') host.hidden = !show;
  if (stack) stack.hidden = !show;
  if (card) card.hidden = !show;
}

function setSettleView(on) {
  document.body.classList.toggle('settle-view', !!on);
  const stage = $('studyStage');
  if (stage) stage.hidden = !!on;
}

function setModalScrollLock(on) {
  document.body.classList.toggle('modal-scroll-lock', !!on);
}
window.setModalScrollLock = setModalScrollLock;

function showState(title, hint) {
  current = null;
  submitted = false;
  setSettleView(false);
  setStudyCardVisible(false);
  if ($('studyHost') && studyMode === 'kill') $('studyHost').hidden = true;
  $('killBtn').hidden = true;
  hideAllBtns();
  const empty = $('emptyState');
  empty.hidden = false;
  empty.innerHTML = `<p>${title}</p><p class="hint">${hint}</p>`;
}

async function showSettle(runIndex) {
  current = null;
  submitted = false;
  setSettleView(true);
  setStudyCardVisible(false);
  if ($('studyHost') && studyMode === 'kill') $('studyHost').hidden = true;
  if ($('killBtn')) $('killBtn').hidden = true;
  hideAllBtns();
  const empty = $('emptyState');
  empty.hidden = false;
  empty.innerHTML = '<p class="settle-loading">结算生成中…</p>';
  try {
    const q = runIndex != null ? `?run=${runIndex}` : '';
    const data = await api('/api/settle' + q);
    settleCache = data;
    settleRunIndex = data.run_index;
    empty.innerHTML = renderSettleHtml(data);
    bindSettleUi(empty, data);
  } catch (e) {
    console.error(e);
    empty.innerHTML =
      '<p>全部斩完</p><p class="hint">结算加载失败，仍可点「重置进度」再来一轮</p>';
  }
}

function renderSettleHtml(data) {
  const runs = data.runs || [];
  const opts = runs
    .map((r) => {
      const tag = r.abandoned ? '中断' : r.cleared_at ? '通关' : '进行中';
      const sel = r.index === data.run_index ? ' selected' : '';
      return `<option value="${r.index}"${sel}>第 ${r.index} 周目 · ${tag}</option>`;
    })
    .join('');
  const cards = (data.cards || [])
    .map((c) => {
      if (c.empty) {
        return (
          `<button type="button" class="settle-card is-empty" data-settle-key="${escapeHtml(c.key)}" disabled>` +
          `<span class="settle-card-label">${escapeHtml(c.label)}</span>` +
          `<span class="settle-card-hint">${escapeHtml(c.hint || '暂无')}</span>` +
          `</button>`
        );
      }
      const val =
        c.key === 'max_streak'
          ? `×${c.value}`
          : `${c.value}${c.unit || ''}`;
      const preview = c.preview
        ? `<span class="settle-card-preview settle-mini-q"><span class="settle-mini-q-label">代表题</span><span class="settle-mini-q-stem">${escapeHtml(c.preview.stem || '')}</span></span>`
        : c.key === 'max_streak'
          ? `<span class="settle-card-preview">点开看连击曲线与打断</span>`
          : '';
      const tie =
        c.tie_count > 1 ? `<span class="settle-card-tie">并列 ${c.tie_count} 题</span>` : '';
      const hist = c.hist_note
        ? `<span class="settle-card-hist">${escapeHtml(c.hist_note)}</span>`
        : '';
      return (
        `<button type="button" class="settle-card" data-settle-key="${escapeHtml(c.key)}">` +
        `<span class="settle-card-label">${escapeHtml(c.label)}</span>` +
        `<span class="settle-card-value">${escapeHtml(String(val))}</span>` +
        tie +
        preview +
        hist +
        `</button>`
      );
    })
    .join('');

  const compare = (data.compare || [])
    .map((row) => {
      return (
        `<tr>` +
        `<td>第 ${row.index} 周目</td>` +
        `<td>×${row.max_streak}</td>` +
        `<td>${row.answered}</td>` +
        `<td>${row.accuracy}%</td>` +
        `<td>${row.cleared_at ? (row.abandoned ? '中断' : '通关') : '进行中'}</td>` +
        `</tr>`
      );
    })
    .join('');

  return (
    `<div class="settle">` +
    `<p class="settle-title">全部斩完</p>` +
    `<p class="settle-sub">${escapeHtml(data.bank_name || '')} · 第 ${data.run_index} 周目结算</p>` +
    `<div class="settle-toolbar">` +
    `<label class="settle-run-label">查看周目` +
    `<select id="settleRunSelect" class="settle-run-select">${opts}</select>` +
    `</label>` +
    `</div>` +
    `<div class="settle-wall">${cards}</div>` +
    `<details class="settle-compare">` +
    `<summary>各周目对照</summary>` +
    `<table class="settle-compare-table"><thead><tr>` +
    `<th>周目</th><th>最高连击</th><th>作答</th><th>正确率</th><th>状态</th>` +
    `</tr></thead><tbody>${compare}</tbody></table>` +
    `</details>` +
    `<p class="hint settle-hint">点卡片看详情；顶栏「重置进度」开启下一周目</p>` +
    `</div>`
  );
}

function bindSettleUi(root, data) {
  const sel = root.querySelector('#settleRunSelect');
  if (sel) {
    sel.onchange = () => {
      const n = parseInt(sel.value, 10);
      if (!Number.isNaN(n)) showSettle(n);
    };
  }
  root.querySelectorAll('.settle-card:not([disabled])').forEach((btn) => {
    btn.onclick = () => openSettleDetail(btn.getAttribute('data-settle-key'), data);
  });
}

/** 题目卡片轮播 HTML；items 需含 stem / 可选 meta 行 */
function renderQuestionCarousel(items, opts) {
  const list = items || [];
  const emptyHint = (opts && opts.emptyHint) || '暂无题目';
  if (!list.length) {
    return `<p class="settle-muted">${escapeHtml(emptyHint)}</p>`;
  }
  const id = 'qc_' + Math.random().toString(36).slice(2, 9);
  const slides = list
    .map((it, i) => {
      const badge = it.badge
        ? `<span class="q-carousel-badge">${escapeHtml(it.badge)}</span>`
        : '';
      const meta = it.meta
        ? `<div class="q-carousel-meta">${escapeHtml(it.meta)}</div>`
        : '';
      const num = it.num
        ? `<span class="q-carousel-num">#${escapeHtml(String(it.num))}</span>`
        : '';
      return (
        `<article class="q-carousel-slide${i === 0 ? ' is-active' : ''}" data-idx="${i}">` +
        `<div class="q-carousel-card">` +
        `<div class="q-carousel-top">${num}${badge}</div>` +
        `<div class="q-carousel-stem">${escapeHtml(it.stem_full || it.stem || '(无题干)')}</div>` +
        meta +
        `</div></article>`
      );
    })
    .join('');
  const dots = list
    .map(
      (_, i) =>
        `<button type="button" class="q-carousel-dot${i === 0 ? ' is-active' : ''}" data-idx="${i}" aria-label="第 ${i + 1} 题"></button>`
    )
    .join('');
  const nav =
    list.length > 1
      ? `<div class="q-carousel-nav">` +
        `<button type="button" class="btn ghost q-carousel-prev" aria-label="上一题">‹</button>` +
        `<span class="q-carousel-count"><span class="q-carousel-cur">1</span> / ${list.length}</span>` +
        `<button type="button" class="btn ghost q-carousel-next" aria-label="下一题">›</button>` +
        `</div>` +
        `<div class="q-carousel-dots">${dots}</div>`
      : '';
  return (
    `<div class="q-carousel" id="${id}" data-len="${list.length}">` +
    `<div class="q-carousel-track">${slides}</div>` +
    nav +
    `</div>`
  );
}

function bindQuestionCarousels(root) {
  if (!root) return;
  root.querySelectorAll('.q-carousel').forEach((el) => {
    if (el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    const len = parseInt(el.dataset.len || '1', 10) || 1;
    let idx = 0;
    const go = (n, dir) => {
      const nextIdx = ((n % len) + len) % len;
      if (nextIdx === idx) return;
      const from = dir === 'left' || dir === 'right'
        ? dir
        : nextIdx > idx
          ? 'right'
          : 'left';
      idx = nextIdx;
      el.querySelectorAll('.q-carousel-slide').forEach((s, i) => {
        s.classList.remove('is-active', 'from-left', 'from-right');
        if (i === idx) {
          // 强制重启动画
          void s.offsetWidth;
          s.classList.add('is-active', from === 'left' ? 'from-left' : 'from-right');
        }
      });
      el.querySelectorAll('.q-carousel-dot').forEach((d, i) => {
        d.classList.toggle('is-active', i === idx);
      });
      const cur = el.querySelector('.q-carousel-cur');
      if (cur) cur.textContent = String(idx + 1);
    };
    const prev = el.querySelector('.q-carousel-prev');
    const next = el.querySelector('.q-carousel-next');
    if (prev) prev.onclick = () => go(idx - 1, 'left');
    if (next) next.onclick = () => go(idx + 1, 'right');
    el.querySelectorAll('.q-carousel-dot').forEach((d) => {
      d.onclick = () => {
        const t = parseInt(d.dataset.idx || '0', 10);
        go(t, t >= idx ? 'right' : 'left');
      };
    });
  });
}

/** 连击折线图：折线仅答对/打断；斩题菱形叠在对应连对点上（不单独占位，避免打平） */
function renderStreakChartSvg(curve) {
  const raw = curve || [];
  if (!raw.length) {
    return '<p class="settle-muted">暂无连击数据</p>';
  }
  // 压缩：kill 叠到前一个答对/打断点，不进入横轴
  const pts = [];
  for (const p of raw) {
    if (p.kind === 'kill') {
      if (pts.length) {
        pts[pts.length - 1].hasKill = true;
      } else {
        pts.push({
          kind: 'correct',
          streak: Number(p.streak) || 0,
          hasKill: true,
        });
      }
      continue;
    }
    pts.push({
      kind: p.kind,
      streak: p.streak,
      broke_streak: p.broke_streak,
      hasKill: false,
    });
  }
  if (!pts.length) {
    return '<p class="settle-muted">暂无连击数据</p>';
  }

  const w = 520;
  const h = 200;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const yVal = (p) =>
    p.kind === 'break' ? Number(p.broke_streak) || 0 : Number(p.streak) || 0;
  const maxY = Math.max(1, ...pts.map(yVal));
  const n = pts.length;
  const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const yAt = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  const linePts = pts
    .map((p, i) => `${xAt(i).toFixed(1)},${yAt(yVal(p)).toFixed(1)}`)
    .join(' ');

  const marks = pts
    .map((p, i) => {
      const x = xAt(i);
      const y = yAt(yVal(p));
      const isBreak = p.kind === 'break';
      const r = isBreak ? 5.5 : 2.8;
      const cls = isBreak ? 'streak-dot break' : 'streak-dot ok';
      const title = isBreak
        ? `断于 ×${p.broke_streak || 0}`
        : `×${p.streak}${p.hasKill ? ' · 斩' : ''}`;
      let html =
        `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}">` +
        `<title>${escapeHtml(title)}</title></circle>`;
      if (p.hasKill) {
        const s = 6.5;
        const diamond =
          `${x.toFixed(1)},${(y - s).toFixed(1)} ` +
          `${(x + s).toFixed(1)},${y.toFixed(1)} ` +
          `${x.toFixed(1)},${(y + s).toFixed(1)} ` +
          `${(x - s).toFixed(1)},${y.toFixed(1)}`;
        html +=
          `<polygon class="streak-mark kill" points="${diamond}">` +
          `<title>${escapeHtml(`斩 · ×${p.streak || 0}`)}</title></polygon>`;
      }
      return html;
    })
    .join('');

  const ticks = [];
  const steps = Math.min(4, maxY);
  for (let s = 0; s <= steps; s++) {
    const v = Math.round((maxY * s) / steps);
    const y = yAt(v);
    ticks.push(
      `<line class="streak-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" />` +
        `<text class="streak-ylab" x="${padL - 6}" y="${(y + 3).toFixed(1)}">${v}</text>`
    );
  }

  const hasKill = pts.some((p) => p.hasKill);
  return (
    `<div class="streak-chart-wrap">` +
    `<svg class="streak-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="连击折线图">` +
    ticks.join('') +
    `<polyline class="streak-line" fill="none" points="${linePts}" />` +
    marks +
    `</svg>` +
    `<div class="streak-chart-legend">` +
    `<span><i class="lg-ok"></i>答对</span>` +
    `<span><i class="lg-break"></i>打断</span>` +
    (hasKill ? `<span><i class="lg-kill"></i>斩题（叠在连对点上）</span>` : '') +
    `</div></div>`
  );
}

function openSettleDetail(key, data) {
  const card = (data.cards || []).find((c) => c.key === key);
  if (!card || card.empty) return;
  const modal = $('settleDetailModal');
  const title = $('settleDetailTitle');
  const body = $('settleDetailBody');
  if (!modal || !title || !body) return;
  title.textContent = card.label || '详情';
  if (key === 'max_streak') {
    const d = card.detail || {};
    const breakCards = (d.breaks || []).map((b) => ({
      stem: b.stem,
      stem_full: b.stem_full || b.stem,
      num: b.num,
      badge: `断于 ×${b.broke_streak || 0}`,
      meta: b.at ? `时间 ${b.at}` : '',
    }));
    body.innerHTML =
      `<p class="settle-detail-lead">本轮最高 <strong>×${d.max_streak || 0}</strong>` +
      (card.hist_note ? ` · ${escapeHtml(card.hist_note)}` : '') +
      `</p>` +
      `<h4 class="settle-detail-h">连击曲线</h4>` +
      renderStreakChartSvg(d.curve || []) +
      `<h4 class="settle-detail-h">打断题目</h4>` +
      `<p class="settle-muted settle-chart-note">折线为连对/打断；橙色菱形叠在斩题时的连对点上</p>` +
      renderQuestionCarousel(breakCards, { emptyHint: '本轮没有打断' });
  } else {
    const items = (card.items || []).map((it) => ({
      stem: it.stem,
      stem_full: it.stem_full || it.stem,
      num: it.num,
      badge:
        key === 'perfect'
          ? '全对'
          : key === 'lowest_accuracy'
            ? `正确率 ${it.accuracy}%`
            : `答 ${it.answer_count} 次`,
      meta:
        `作答 ${it.answer_count} · 对 ${it.correct_count} · 正确率 ${it.accuracy}%` +
        (it.killed ? ' · 已斩' : ''),
    }));
    body.innerHTML =
      `<p class="settle-detail-lead">${escapeHtml(String(card.value))}${escapeHtml(card.unit || '')}` +
      (card.tie_count > 1 ? ` · 并列 ${card.tie_count} 题` : '') +
      (card.hist_note ? `<br><span class="settle-muted">${escapeHtml(card.hist_note)}</span>` : '') +
      `</p>` +
      renderQuestionCarousel(items, { emptyHint: '暂无题目' });
  }
  bindQuestionCarousels(body);
  modal.hidden = false;
  setModalScrollLock(true);
}

function closeSettleDetail() {
  const modal = $('settleDetailModal');
  if (modal) modal.hidden = true;
  setModalScrollLock(false);
}

async function loadNext() {
  let data;
  try {
    data = await api('/api/next');
  } catch (e) {
    console.error('抽题失败', e);
    $('nextBtn').hidden = false;
    return;
  }
  current = data.question;
  submitted = false;
  userChoice = null;
  answeredThisDraw = false;
  answeredCorrectThisDraw = false;
  if (!current) {
    if (data.reason === 'empty') {
      showState('还没有题库', '点击侧栏「导入」，粘贴文本或上传 .docx 开始背题');
    } else if (data.reason === 'done') {
      await showSettle(data.run_index || null);
    }
    return;
  }
  if (typeof current.run_streak === 'number') {
    sessionStreak = current.run_streak;
    if (window.LykieFx) LykieFx.setComboBadge(sessionStreak, false);
  }
  renderQuestion();
}

function bumpCardMotion(el) {
  if (!el) return;
  unlockCardHeight();
  el.classList.remove('fx-correct', 'fx-miss', 'fx-combo', 'fx-combo-10', 'fx-kill');
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) { /* ignore */ }
  el.classList.remove('card-enter');
  void el.offsetWidth;
  el.classList.add('card-enter');
}

function renderQuestion() {
  setSettleView(false);
  $('emptyState').hidden = true;
  if ($('studyHost')) $('studyHost').hidden = false;
  setStudyCardVisible(true);
  const card = $('card');
  bumpCardMotion(card);
  $('answerBox').hidden = true;
  hideAllBtns();
  $('killBtn').hidden = false;

  $('cardType').textContent = current.type === 'choice'
    ? (current.multi ? '多选题' : '选择题')
    : (TYPE_MAP[current.type] || '');
  $('cardStem').textContent = current.stem;
  renderMeta();

  const optBox = $('options');
  optBox.innerHTML = '';
  const fillArea = $('fillArea');
  fillArea.hidden = true;
  const input = $('fillInput');
  input.value = '';
  input.disabled = false;
  userChoice = null;

  if (current.type === 'choice') {
    current.options.forEach(opt => {
      const m = opt.match(/^([A-H])[.、．\s]*(.*)$/i);
      const letter = m ? m[1].toUpperCase() : opt;
      const btn = document.createElement('button');
      btn.className = 'opt' + (current.multi ? ' multi' : '');
      btn.textContent = opt;
      btn.dataset.value = letter;
      btn.onclick = () => (current.multi ? toggleMultiChoice(btn, letter) : chooseChoice(btn, letter));
      optBox.appendChild(btn);
    });
    if (current.multi) {
      $('confirmBtn').hidden = false;
      $('confirmBtn').textContent = '提交多选';
    }
  } else if (current.type === 'judge') {
    ['对', '错'].forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'opt judge';
      btn.textContent = v;
      btn.dataset.value = v;
      btn.onclick = () => chooseJudge(btn, v);
      optBox.appendChild(btn);
    });
  } else {
    fillArea.hidden = false;
    $('confirmBtn').hidden = false;
    $('confirmBtn').textContent = '确认答案';
  }
  syncKillButton();
}

function renderMeta() {
  const meta = $('cardMeta');
  const runAc = current.run_answer_count != null ? current.run_answer_count : current.answer_count;
  const runCc = current.run_correct_count != null ? current.run_correct_count : current.correct_count;
  if (runAc > 0) {
    const rate = Math.round((runCc / runAc) * 100);
    meta.textContent = `本轮已答 ${runAc} 次 · 正确率 ${rate}%`;
    meta.hidden = false;
  } else {
    meta.textContent = '本轮尚未作答 · 两次全对可斩，或满 3 次且正确率≥50%';
    meta.hidden = false;
  }
}

function syncKillButton() {
  const btn = $('killBtn');
  if (!btn || !current) return;
  btn.hidden = studyMode !== 'kill';
  let can = !!current.can_kill;
  let reason = current.kill_block_reason || '';
  // 本张已答错：前端也锁死
  if (answeredThisDraw && !answeredCorrectThisDraw) {
    can = false;
    reason = '答错后需先答对才能斩';
  }
  btn.disabled = !can;
  btn.title = can ? '斩掉本题（不再抽出）' : reason || '暂不可斩';
  btn.setAttribute('aria-disabled', can ? 'false' : 'true');
  btn.classList.toggle('is-disabled', !can);
}

// ==================== 作答 ====================
function lockCardHeightForSettle() {
  const card = $('card');
  if (!card || card.dataset.heightLocked === '1') return;
  const h = Math.ceil(card.getBoundingClientRect().height);
  if (h > 0) {
    card.style.height = h + 'px';
    card.dataset.heightLocked = '1';
  }
}

function unlockCardHeight() {
  const card = $('card');
  if (!card) return;
  card.style.height = '';
  delete card.dataset.heightLocked;
}

function revealAnswerUi(opts) {
  // 题卡在 card-area 里靠底对齐：增高会整体上顶。先锁高度，解析在卡内滚动出现。
  lockCardHeightForSettle();
  if (!opts || opts.answer !== false) {
    showAnswer();
    const box = $('answerBox');
    if (box && typeof box.scrollIntoView === 'function') {
      try {
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) {
        box.scrollIntoView(false);
      }
    }
  }
  if (opts && opts.judge) $('judgeBtns').hidden = false;
  if (!opts || opts.next !== false) $('nextBtn').hidden = false;
}

/** 先播结算动画，再揭解析/下一题，避免卡片上移抢走注意力 */
function settleThenReveal(kind, revealOpts) {
  const streak = sessionStreak;
  const run = () => revealAnswerUi(revealOpts);
  if (window.LykieFx && LykieFx.afterReveal) LykieFx.afterReveal(kind, streak, run);
  else run();
}

function chooseChoice(btn, letter) {
  if (submitted) return;
  userChoice = letter;
  document.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  submitted = true;
  document.querySelectorAll('.opt').forEach(b => {
    const v = b.dataset.value;
    if (current.answer.includes(v)) b.classList.add('correct');
    else if (v === userChoice) b.classList.add('wrong');
    b.disabled = true;
  });
  const ok = userChoice === current.answer;
  apiAnswer(ok);
  settleThenReveal(ok ? 'correct' : 'wrong', { answer: true, next: true });
}

function toggleMultiChoice(btn, letter) {
  if (submitted) return;
  btn.classList.toggle('selected');
  const selected = [...document.querySelectorAll('.opt.selected')].map((b) => b.dataset.value);
  userChoice = selected.sort().join('');
}

async function submitMultiChoice() {
  if (submitted || !current || !current.multi) return;
  const selected = [...document.querySelectorAll('.opt.selected')].map((b) => b.dataset.value);
  if (!selected.length) {
    await uiAlert('请至少选择一个选项');
    return;
  }
  userChoice = selected.sort().join('');
  submitted = true;
  $('confirmBtn').hidden = true;
  const correctSet = new Set(String(current.answer || '').split(''));
  document.querySelectorAll('.opt').forEach((b) => {
    const v = b.dataset.value;
    const picked = b.classList.contains('selected');
    if (correctSet.has(v)) b.classList.add('correct');
    else if (picked) b.classList.add('wrong');
    b.disabled = true;
  });
  const ok = userChoice === String(current.answer || '');
  apiAnswer(ok);
  settleThenReveal(ok ? 'correct' : 'wrong', { answer: true, next: true });
}

function chooseJudge(btn, v) {
  if (submitted) return;
  userChoice = v;
  submitted = true;
  document.querySelectorAll('.opt').forEach(b => {
    if (b.dataset.value === current.answer) b.classList.add('correct');
    else if (b.dataset.value === userChoice) b.classList.add('wrong');
    b.disabled = true;
  });
  const ok = userChoice === current.answer;
  apiAnswer(ok);
  settleThenReveal(ok ? 'correct' : 'wrong', { answer: true, next: true });
}

async function confirmFill() {
  if (submitted) return;
  if (current && current.type === 'choice' && current.multi) {
    submitMultiChoice();
    return;
  }
  const val = $('fillInput').value.trim();
  if (!val) { await uiAlert('请先输入你的答案'); return; }
  userChoice = val;
  submitted = true;
  $('fillInput').disabled = true;
  $('confirmBtn').hidden = true;
  $('confirmBtn').textContent = '确认答案';
  settleThenReveal('correct', { answer: true, next: false, judge: true });
}

function showAnswer() {
  const box = $('answerBox');
  box.hidden = false;
  const ana = current.analysis || '';
  box.innerHTML =
    '<span class="label">参考答案</span>' + escapeHtml(current.answer_text || current.answer) +
    '<div class="answer-analysis">解析：' + escapeHtml(ana ? ana : '无') + '</div>';
}

async function apiAnswer(correct) {
  answeredThisDraw = true;
  answeredCorrectThisDraw = !!correct;
  current.answer_count = (current.answer_count || 0) + 1;
  if (correct) current.correct_count = (current.correct_count || 0) + 1;
  current.run_answer_count = (current.run_answer_count || 0) + 1;
  if (correct) current.run_correct_count = (current.run_correct_count || 0) + 1;
  current.phase = correct ? 'right' : 'wrong';
  renderMeta();
  if (correct) {
    rewardCorrect();
  } else {
    rewardWrong();
  }
  try {
    const res = await api('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: current.id, correct }),
    });
    if (res && typeof res.run_streak === 'number') sessionStreak = res.run_streak;
    if (res) {
      current.can_kill = !!res.can_kill;
      current.kill_block_reason = res.kill_block_reason || '';
      if (res.run_answer_count != null) current.run_answer_count = res.run_answer_count;
      if (res.run_correct_count != null) current.run_correct_count = res.run_correct_count;
    }
    syncKillButton();
    await refreshStatus();
  } catch (e) {
    console.error('提交作答失败', e);
  }
}

async function kill() {
  if (!current) return;
  if (answeredThisDraw && !answeredCorrectThisDraw) {
    await uiAlert('答错后需先答对才能斩');
    return;
  }
  const asCorrect = !answeredThisDraw;
  // 直接斩：先当答对涨连击；答对后再斩：连击不变
  if (asCorrect) {
    sessionStreak += 1;
    if (window.LykieFx) LykieFx.setComboBadge(sessionStreak, true);
  }
  if (window.LykieSfx) LykieSfx.onKill(sessionStreak);
  const fxWait = window.LykieFx ? LykieFx.onKill(sessionStreak) : Promise.resolve();
  try {
    const res = await api('/api/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: current.id, as_correct: asCorrect }),
    });
    if (res && res.ok === false) {
      await uiAlert(res.error || '无法斩题');
      if (asCorrect) {
        sessionStreak = Math.max(0, sessionStreak - 1);
        if (window.LykieFx) LykieFx.setComboBadge(sessionStreak, false);
      }
      return;
    }
    if (res && typeof res.run_streak === 'number') sessionStreak = res.run_streak;
  } catch (e) {
    await uiAlert(e.message || '无法斩题');
    if (asCorrect) {
      sessionStreak = Math.max(0, sessionStreak - 1);
      if (window.LykieFx) LykieFx.setComboBadge(sessionStreak, false);
    }
    return;
  }
  await refreshBanks();
  await refreshStatus();
  await fxWait;
  loadNext();
}

// ==================== 编辑题目 ====================
const EDIT_LETTERS = 'ABCDEFGH';

function updateEditForm() {
  const t = $('editType').value;
  $('editOptionsArea').hidden = t !== 'choice';
  const ansChoice = $('editAnswerChoice');
  if (ansChoice) ansChoice.hidden = t !== 'choice';
  $('editAnswerJudge').hidden = t !== 'judge';
  $('editAnswerFill').hidden = !(t === 'fill' || t === 'short_answer');
  const kwArea = $('editKeywordsArea');
  if (kwArea) kwArea.hidden = t !== 'short_answer';
}

function readEditOptionValues() {
  return [...document.querySelectorAll('#editOptionsList .edit-opt-input')]
    .map((inp) => inp.value.trim());
}

function selectedEditAnswerLetters() {
  return [...document.querySelectorAll('#editAnswerChoice input[type=checkbox]:checked')]
    .map((c) => c.value)
    .sort()
    .join('');
}

function rebuildEditAnswerChecks(options, selectedLetters) {
  const box = $('editAnswerChoice');
  if (!box) return;
  const selected = new Set(
    String(selectedLetters || '')
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .filter(Boolean)
  );
  box.innerHTML = '';
  options.forEach((text, i) => {
    if (!text) return;
    const letter = EDIT_LETTERS[i];
    if (!letter) return;
    const lab = document.createElement('label');
    lab.className = 'edit-ans-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = letter;
    cb.checked = selected.has(letter);
    lab.appendChild(cb);
    const brief = text.length > 28 ? text.slice(0, 27) + '…' : text;
    lab.appendChild(document.createTextNode(' ' + letter + '. ' + brief));
    box.appendChild(lab);
  });
}

function renderEditOptions(options, selectedLetters) {
  const list = $('editOptionsList');
  if (!list) return;
  const vals = (options && options.length) ? options.slice(0, 8) : ['', '', '', ''];
  while (vals.length < 2) vals.push('');
  list.innerHTML = '';
  vals.forEach((text, i) => {
    const row = document.createElement('div');
    row.className = 'edit-opt-row';
    const letter = EDIT_LETTERS[i] || '?';
    const inp = document.createElement('input');
    inp.className = 'edit-opt-input';
    inp.placeholder = '选项 ' + letter;
    inp.value = text || '';
    inp.addEventListener('input', () => {
      const letters = selectedEditAnswerLetters();
      rebuildEditAnswerChecks(readEditOptionValues().filter(Boolean), letters);
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn ghost edit-opt-remove';
    rm.textContent = '删';
    rm.title = '删除此选项';
    rm.onclick = () => {
      const cur = readEditOptionValues();
      cur.splice(i, 1);
      const letters = selectedEditAnswerLetters();
      renderEditOptions(cur.length ? cur : [''], letters);
    };
    row.appendChild(inp);
    row.appendChild(rm);
    list.appendChild(row);
  });
  rebuildEditAnswerChecks(vals.filter(Boolean), selectedLetters);
}

function answerToEditLetters(answer, options) {
  const raw = String(answer || '').trim();
  const compact = raw.toUpperCase().replace(/[\s,，、/;；+＋]+/g, '');
  if (/^[A-H]{1,8}$/.test(compact)) return compact.split('').sort().join('');
  const idx = options.indexOf(raw);
  if (idx >= 0 && idx < EDIT_LETTERS.length) return EDIT_LETTERS[idx];
  const m = raw.match(/^([A-H])[.、．\s]/i);
  if (m) return m[1].toUpperCase();
  return options.length ? 'A' : '';
}

function fillEditForm(q) {
  $('editType').value = q.type;
  $('editStem').value = q.stem;
  if (q.type === 'choice') {
    const opts = Array.isArray(q.options) ? q.options.slice() : [];
    const letters = answerToEditLetters(q.answer, opts);
    renderEditOptions(opts.length ? opts : ['', '', '', ''], letters);
  } else if (q.type === 'judge') {
    $('editAnswerJudge').value = q.answer;
  } else {
    $('editAnswerFill').value = q.answer;
  }
  const kws = q.keywords || [];
  if ($('editKeywords')) {
    $('editKeywords').value = Array.isArray(kws) ? kws.join('、') : (kws || '');
  }
  $('editAnalysis').value = q.analysis || '';
  updateEditForm();
}

function currentToRaw(c) {
  if (c.type === 'choice') {
    const options = c.options.map(extractContent);
    let answer = c.answer;
    if (c.multi && typeof answer === 'string' && /^[A-H]+$/.test(answer)) {
      const correct = [];
      c.options.forEach((opt) => {
        const m = String(opt).match(/^([A-H])[.、．\s]*(.*)$/i);
        if (m && answer.includes(m[1].toUpperCase())) correct.push(m[2]);
      });
      answer = correct
        .map((text) => {
          const i = options.indexOf(text);
          return i >= 0 ? EDIT_LETTERS[i] : '';
        })
        .filter(Boolean)
        .sort()
        .join('') || answer;
    } else {
      const idx = EDIT_LETTERS.indexOf(c.answer);
      answer = idx >= 0 ? options[idx] : (c.answer_text || c.answer);
      if (typeof answer === 'string' && /^[A-H][.、．]/.test(answer)) {
        answer = extractContent(answer);
      }
    }
    return {
      type: 'choice',
      stem: c.stem,
      options,
      answer,
      analysis: c.analysis || '',
      keywords: c.keywords || [],
    };
  }
  return {
    type: c.type,
    stem: c.stem,
    options: [],
    answer: c.answer,
    analysis: c.analysis || '',
    keywords: c.keywords || [],
  };
}

function openEditFromCard() {
  if (!current) return;
  editSource = 'card';
  editBankId = null;
  editQuestionId = current.id;
  fillEditForm(currentToRaw(current));
  $('editModal').hidden = false;
}

function openEditFromList(q, bankId) {
  editSource = 'list';
  editBankId = bankId;
  editQuestionId = q.id;
  fillEditForm(q);
  $('editModal').hidden = false;
}

function openEditNew(bankId) {
  editSource = 'new';
  editBankId = bankId;
  editQuestionId = null;
  fillEditForm({ type: 'fill', stem: '', options: [], answer: '' });
  $('editModal').hidden = false;
}

function closeEdit() {
  $('editModal').hidden = true;
}

function buildChoiceRender(options, answer) {
  const letters = EDIT_LETTERS;
  const opts = options.map((c, i) => letters[i] + '.' + c);
  let ansLetters = '';
  const compact = String(answer || '').toUpperCase().replace(/[^A-H]/g, '');
  if (/^[A-H]{2,}$/.test(compact)) {
    ansLetters = compact.split('').filter((ch, i, a) => a.indexOf(ch) === i).sort().join('');
  } else {
    const idx = options.indexOf(answer);
    ansLetters = idx >= 0 ? letters[idx] : letters[0];
  }
  const answer_text = ansLetters
    .split('')
    .map((ch) => {
      const i = letters.indexOf(ch);
      return i >= 0 ? (ch + '.' + options[i]) : ch;
    })
    .join('、');
  return {
    options: opts,
    answer: ansLetters,
    answer_text,
    multi: ansLetters.length > 1,
  };
}

async function saveEdit() {
  const type = $('editType').value;
  const stem = $('editStem').value.trim();
  if (!stem) { await uiAlert('题干不能为空'); return; }

  let options = [];
  let answer = '';
  if (type === 'choice') {
    options = readEditOptionValues().filter((x) => x);
    if (options.length < 2) { await uiAlert('请至少填写两个选项'); return; }
    if (options.length > 8) { await uiAlert('最多 8 个选项'); return; }
    answer = selectedEditAnswerLetters();
    if (!answer) { await uiAlert('请勾选至少一个正确答案'); return; }
    for (const ch of answer) {
      if (EDIT_LETTERS.indexOf(ch) >= options.length) {
        await uiAlert('答案选项已删除，请重新勾选');
        return;
      }
    }
    if (answer.length === 1) {
      answer = options[EDIT_LETTERS.indexOf(answer)];
    }
  } else if (type === 'judge') {
    answer = $('editAnswerJudge').value;
  } else {
    answer = $('editAnswerFill').value.trim();
  }

  const analysis = $('editAnalysis').value.trim();
  const keywords = ($('editKeywords') && !$('editKeywordsArea').hidden)
    ? $('editKeywords').value.trim()
    : undefined;
  const payload = { type, stem, options, answer, analysis };
  if (keywords !== undefined) payload.keywords = keywords;
  if (editBankId) payload.bank_id = editBankId;

  let res;
  if (editSource === 'new') {
    res = await api('/api/add_question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    payload.id = editQuestionId;
    res = await api('/api/update_question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  if (res.ok === false) { await uiAlert(res.error || '保存失败'); return; }

  closeEdit();
  if (editSource === 'card') {
    current.type = type;
    current.stem = stem;
    current.analysis = analysis;
    if (type === 'choice') {
      const r = buildChoiceRender(options, answer);
      current.options = r.options;
      current.answer = r.answer;
      current.answer_text = r.answer_text;
      current.multi = !!r.multi;
    } else if (type === 'judge') {
      current.options = ['对', '错'];
      current.answer = answer;
      current.answer_text = answer;
      current.multi = false;
    } else {
      current.options = [];
      current.answer = answer;
      current.answer_text = answer;
      current.multi = false;
    }
    submitted = false;
    userChoice = null;
    renderQuestion();
  } else if (editSource === 'new') {
    await refreshBankView();
    await refreshBanks();
    await refreshStatus();
  } else {
    await refreshBankView();
  }
}

// ==================== 重置 ====================
async function resetProgress() {
  if (!await uiConfirm('确定重置当前题库的进度吗？所有题目将恢复为未掌握状态（含已斩题目）。', { title: '重置进度', okText: '重置', danger: true })) return;
  await api('/api/reset', { method: 'POST' });
  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
}

// ==================== 事件绑定 ====================
if ($('folderCreateBtn')) {
  $('folderCreateBtn').onclick = () => createFolder();
}
if ($('bankMoveModalClose')) {
  $('bankMoveModalClose').onclick = () => closeMoveBankModal();
}
if ($('bankMoveModal')) {
  $('bankMoveModal').addEventListener('click', (e) => {
    if (e.target === $('bankMoveModal')) closeMoveBankModal();
  });
}
$('editBtn').onclick = openEditFromCard;
$('editCancelBtn').onclick = closeEdit;
$('editSaveBtn').onclick = saveEdit;
$('editType').onchange = () => {
  updateEditForm();
  if ($('editType').value === 'choice' && !$('editOptionsList').children.length) {
    renderEditOptions(['', '', '', ''], 'A');
  }
};
if ($('editAddOptBtn')) {
  $('editAddOptBtn').onclick = async () => {
    const cur = readEditOptionValues();
    if (cur.length >= 8) {
      await uiAlert('最多 8 个选项');
      return;
    }
    cur.push('');
    renderEditOptions(cur, selectedEditAnswerLetters());
  };
}
$('bankModalClose').onclick = () => { $('bankModal').hidden = true; };
$('addQuestionBtn').onclick = () => openEditNew(viewBankId);
$('confirmBtn').onclick = confirmFill;
$('nextBtn').onclick = () => { $('nextBtn').hidden = true; loadNext(); };
$('rightBtn').onclick = async () => { $('judgeBtns').hidden = true; await apiAnswer(true); loadNext(); };
$('wrongBtn').onclick = async () => { $('judgeBtns').hidden = true; await apiAnswer(false); loadNext(); };
$('killBtn').onclick = kill;
$('resetBtn').onclick = resetProgress;
if ($('settleDetailCloseBtn')) {
  $('settleDetailCloseBtn').onclick = closeSettleDetail;
}
if ($('settleDetailModal')) {
  const settleModal = $('settleDetailModal');
  settleModal.addEventListener('click', (e) => {
    if (e.target === settleModal) closeSettleDetail();
  });
  // 阻止滑动穿透到底层结算页（iOS/微信）
  settleModal.addEventListener(
    'touchmove',
    (e) => {
      const box = settleModal.querySelector('.settle-detail-box');
      if (!box) {
        e.preventDefault();
        return;
      }
      if (box.contains(e.target)) {
        // 内容区可滚；滚到顶/底时仍可能链式滚动，靠 overscroll-behavior + body lock
        return;
      }
      e.preventDefault();
    },
    { passive: false }
  );
}

// ==================== Lykie ====================
let lykieBusy = false;
let lykieConfigured = false;
let lastUserUtterance = '';
let feedbackTargetEl = null;
let lykieBurstSeq = 0;
let panelPersistTimer = null;
let restoringPanel = false;
let lastPanelLog = [];

function appendLykieBubble(role, text, opts) {
  const box = $('lykieMessages');
  if (!box) return null;
  const div = document.createElement('div');
  div.className = 'lykie-bubble ' + role;
  if (opts && opts.burstId) div.dataset.burstId = opts.burstId;
  if (opts && opts.noteKind) {
    div.classList.add('profile-note');
    div.classList.add('profile-' + opts.noteKind);
  }
  if (opts && opts.silence) {
    div.classList.add('silence');
    div.dataset.silence = '1';
  }

  if (role === 'assistant' && !restoringPanel && !(opts && opts.noPing)) {
    // 面板收起时才 ping；burst 内仅首条响（后续传 noPing）
    const panel = $('lykiePanel');
    const open = panel && !panel.classList.contains('collapsed');
    if (window.LykieSfx) LykieSfx.onLykieMessage(!!open);
  }

  if (role === 'assistant') {
    const body = document.createElement('span');
    body.className = 'lykie-bubble-text';
    body.textContent = text;
    div.appendChild(body);

    const storyOn = window.StoryRunner && window.StoryRunner.isActive();
    // 只在「整次回复」的最后一条气泡上放评价，避免一句一点
    if (!storyOn && !(opts && opts.noFeedback)) {
      const actions = document.createElement('div');
      actions.className = 'lykie-bubble-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'lykie-fb-btn';
      up.title = '整次回复不错（点赞）';
      up.textContent = '👍';
      up.onclick = (e) => {
        e.stopPropagation();
        submitLykieUpvote(div);
      };
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'lykie-fb-btn';
      down.title = '纠正整次回复并回退重问（点踩）';
      down.textContent = '👎';
      down.onclick = (e) => {
        e.stopPropagation();
        openLykieFeedback(div);
      };
      actions.appendChild(up);
      actions.appendChild(down);
      div.appendChild(actions);
    }
  } else {
    div.textContent = text;
  }

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  if (!(opts && (opts.skipPersist || opts.pending))) {
    schedulePersistPanel();
  }
  return div;
}

function serializePanelLog() {
  const box = $('lykieMessages');
  if (!box) return [];
  const out = [];
  [...box.children].forEach((el) => {
    if (el.classList.contains('pending')) return;
    let role = 'system';
    if (el.classList.contains('user')) role = 'user';
    else if (el.classList.contains('assistant')) role = 'assistant';
    else if (el.classList.contains('system')) role = 'system';
    else return;
    const text = bubbleText(el).trim();
    if (!text) return;
    // 跳过瞬时提示
    if (role === 'system' && (text === '…等你说完再回' || text.startsWith('已记住'))) return;
    const item = { role, text };
    if (el.dataset.silence === '1') item.silence = true;
    if (role === 'assistant' && !el.querySelector('.lykie-fb-btn')) item.no_feedback = true;
    out.push(item);
  });
  return out;
}

function schedulePersistPanel() {
  if (restoringPanel) return;
  if (window.StoryRunner && window.StoryRunner.isActive()) return;
  clearTimeout(panelPersistTimer);
  panelPersistTimer = setTimeout(() => {
    persistPanelLog();
  }, 700);
}

async function persistPanelLog() {
  if (restoringPanel) return;
  if (window.StoryRunner && window.StoryRunner.isActive()) return;
  const messages = serializePanelLog();
  lastPanelLog = messages;
  try {
    await fetchAuth('/api/lykie/panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (e) {
    /* ignore */
  }
}

function clearLykiePanelMessages() {
  const box = $('lykieMessages');
  if (box) box.innerHTML = '';
}

function restorePanelLog(messages) {
  const list = Array.isArray(messages) ? messages : [];
  restoringPanel = true;
  clearLykiePanelMessages();
  list.forEach((m) => {
    const role = m.role || 'system';
    const text = m.text || m.content || '';
    if (!text) return;
    if (role === 'assistant') {
      const el = appendLykieBubble('assistant', text, {
        noFeedback: !!m.no_feedback,
        silence: !!m.silence,
      });
      if (el && m.silence) {
        el.classList.add('silence');
        el.dataset.silence = '1';
      }
    } else {
      appendLykieBubble(role, text);
    }
  });
  restoringPanel = false;
  lastPanelLog = list;
}

function rollbackPanelBeforeAssistant(assistantEl) {
  const burst = collectBurstElements(assistantEl);
  const first = burst[0] || assistantEl;
  const remove = [...burst];
  let node = first ? first.previousElementSibling : null;
  const userTexts = [];
  while (node && node.classList.contains('user')) {
    userTexts.unshift((node.textContent || '').replace(/^（问问）/, '').replace(/^（纠正）/, '').trim());
    remove.unshift(node);
    node = node.previousElementSibling;
  }
  remove.forEach((n) => n.remove());
  return userTexts.filter(Boolean);
}

async function clearChatToOpeningEnd() {
  if (window.StoryRunner && window.StoryRunner.isActive()) {
    await uiAlert('开场播放中不能清空');
    return;
  }
  if (!await uiConfirm('将清空自由聊记录，回到「开场刚结束」。监督案例与事实记忆会保留。继续？')) {
    return;
  }
  clearChatBatchTimer();
  chatBatchQueue = [];
  chatBatchStartedAt = 0;
  showChatBatchWaiting(false);
  try {
    const res = await fetchAuth('/api/lykie/chat_reset_opening', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '清空失败');
      return;
    }
    restorePanelLog(data.panel_log || []);
    appendLykieBubble('system', '已清空到开场结束，可重新测自由聊');
    await refreshLykieState();
  } catch (e) {
    await uiAlert('网络错误');
  }
}

function bubbleText(el) {
  if (!el) return '';
  const t = el.querySelector('.lykie-bubble-text');
  return (t ? t.textContent : el.textContent) || '';
}

/** 同一用户话之后、同一次连发的多条 Lykie 气泡 */
function collectBurstElements(assistantEl) {
  if (!assistantEl) return [];
  const id = assistantEl.dataset.burstId;
  const box = $('lykieMessages');
  if (id && box) {
    return [...box.querySelectorAll(`.lykie-bubble.assistant[data-burst-id="${id}"]`)];
  }
  return [assistantEl];
}

function collectBurstText(assistantEl) {
  if (assistantEl && assistantEl.dataset.silence === '1') return '[不回复]';
  return collectBurstElements(assistantEl)
    .map(bubbleText)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

function findPrevUserTexts(assistantEl) {
  const burst = collectBurstElements(assistantEl);
  const first = burst[0] || assistantEl;
  const texts = [];
  let node = first ? first.previousElementSibling : null;
  while (node) {
    if (node.classList.contains('user')) {
      const t = (node.textContent || '')
        .replace(/^（问问）/, '')
        .replace(/^（纠正）/, '')
        .trim();
      if (t) texts.unshift(t);
      node = node.previousElementSibling;
      continue;
    }
    // 碰到上一次 Lykie / 系统提示就停：只收「这一轮」连发
    if (node.classList.contains('assistant') || node.classList.contains('system')) break;
    node = node.previousElementSibling;
  }
  if (texts.length) return texts;
  return lastUserUtterance ? [lastUserUtterance] : [];
}

function findPrevUserText(assistantEl) {
  return findPrevUserTexts(assistantEl).join('\n');
}

function openLykieFeedback(assistantEl) {
  feedbackTargetEl = assistantEl;
  const bad = collectBurstText(assistantEl);
  const userTexts = findPrevUserTexts(assistantEl);
  const modal = $('lykieFeedbackModal');
  if (!modal) return;
  const userBlock = userTexts.length
    ? userTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '';
  $('lykieFbUserSaid').textContent = userBlock
    ? `针对用户这一轮（可连发）：\n${userBlock}\n\n写出 Lykie 整次理想回复（一行一句）。若理想是先不回：好范例留空，或写 [不回复]。`
    : '请写出 Lykie 整次理想回复（可多行短句）。若先不回：留空或写 [不回复]。';
  $('lykieFbBad').value = bad;
  $('lykieFbGood').value = '';
  $('lykieFbReview').value = '';
  modal.hidden = false;
  $('lykieFbGood').focus();
}

function closeLykieFeedback() {
  const modal = $('lykieFeedbackModal');
  if (modal) modal.hidden = true;
  feedbackTargetEl = null;
}

function markFeedbackDone(el) {
  collectBurstElements(el).forEach((node) => {
    node.querySelectorAll('.lykie-fb-btn').forEach((b) => b.classList.add('done'));
  });
}

async function submitLykieUpvote(assistantEl) {
  const reply = collectBurstText(assistantEl);
  const isSilence = assistantEl && assistantEl.dataset.silence === '1';
  if (!reply && !isSilence) return;
  try {
    const res = await fetchAuth('/api/lykie/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibe: 'up',
        user_said: findPrevUserText(assistantEl),
        bad_reply: isSilence ? '[不回复]' : reply,
        good_lines: isSilence
          ? ['[不回复]']
          : reply.split(/\n+/).map((s) => s.trim()).filter(Boolean),
        review: isSilence
          ? '用户认可本轮先不回复；同类碎碎念/半截话可先沉默等连发。'
          : '用户认可这次整段回复的节奏与内容，同类情境可参考。',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      appendLykieBubble('system', data.error || '点赞失败');
      return;
    }
    markFeedbackDone(assistantEl);
    appendLykieBubble('system', isSilence ? '已记住：这轮先不回可以' : '已记住：整次这样说可以');
    await refreshLykieState();
  } catch (e) {
    appendLykieBubble('system', '网络错误');
  }
}

async function submitLykieFeedback() {
  const bad = ($('lykieFbBad').value || '').trim();
  const goodRaw = ($('lykieFbGood').value || '').trim();
  let good_lines = goodRaw
    ? goodRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [];
  const review = ($('lykieFbReview').value || '').trim();
  const user_said = findPrevUserText(feedbackTargetEl);

  const wantSilence =
    !good_lines.length ||
    (good_lines.length === 1 && /^\[?不回复\]?$|^【不回复】$/.test(good_lines[0]));

  if (wantSilence && !good_lines.length) {
    good_lines = ['[不回复]'];
  }

  if (!good_lines.length && !review) {
    await uiAlert('请填写好范例，或留空并写点评（表示应先不回）');
    return;
  }

  const btn = $('lykieFbSubmit');
  if (btn) btn.disabled = true;
  const target = feedbackTargetEl;
  try {
    const res = await fetchAuth('/api/lykie/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibe: 'down',
        user_said,
        bad_reply: bad,
        good_lines,
        review: review || (wantSilence ? '本轮应先不回复，等用户再说一句再开口。' : ''),
        rollback: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '保存失败');
      return;
    }

    const rolledUsers = target ? rollbackPanelBeforeAssistant(target) : [];
    const refill = (
      (data.removed_users && data.removed_users.length)
        ? data.removed_users
        : (rolledUsers.length ? rolledUsers : user_said.split('\n').filter(Boolean))
    ).join('\n');

    closeLykieFeedback();
    clearChatBatchTimer();
    chatBatchQueue = [];
    chatBatchStartedAt = 0;
    showChatBatchWaiting(false);

    const input = $('lykieInput');
    if (input && refill) {
      input.value = refill;
      input.style.height = 'auto';
      input.style.height = Math.min(Math.max(input.scrollHeight, 100), 220) + 'px';
      input.focus();
    }

    appendLykieBubble(
      'system',
      '已记住点评；已回退到提问前，可改口或原句重发' +
        (data.correction_count != null ? `（监督 ${data.correction_count}）` : ''),
    );
    await persistPanelLog();
    await refreshLykieState();
  } catch (e) {
    await uiAlert('网络错误');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function isMobilePortrait() {
  return window.matchMedia('(max-width: 720px)').matches;
}

/** 开场剧情等用户主动打开 Lykie 再播，避免一进站就盖住刷题。 */
let pendingOpeningStory = false;

function setBankDrawerOpen(open) {
  const next = !!open;
  const was = document.body.classList.contains('bank-drawer-open');
  document.body.classList.toggle('bank-drawer-open', next);
  if (next && !was && window.LykieSfx) LykieSfx.onUiOpen();
}

function setLykiePanelOpen(open) {
  const panel = $('lykiePanel');
  if (!panel) return;
  const next = !!open;
  const wasOpen = !panel.classList.contains('collapsed');
  if (next) setBankDrawerOpen(false);
  panel.classList.toggle('collapsed', !next);
  try {
    localStorage.setItem('lykiePanelOpen', next ? '1' : '0');
  } catch (e) { /* ignore */ }
  if (next && !wasOpen && window.LykieSfx) LykieSfx.onUiOpen();
  if (next && pendingOpeningStory && window.StoryRunner) {
    pendingOpeningStory = false;
    window.StoryRunner.startFragment01(false).catch((e) => console.error(e));
  }
}

async function refreshLykieState() {
  const status = $('lykieStatus');
  try {
    const data = await api('/api/lykie/state');
    lykieConfigured = !!data.configured;
    lastPanelLog = Array.isArray(data.panel_log) ? data.panel_log : lastPanelLog;
    if (!status) return data;
    if (lykieConfigured) {
      const bits = (data.profile && data.profile.bits) || [];
      const archive = data.profile && data.profile.loaded
        ? (`档案${data.profile.strict ? '(严)' : ''} ${bits.length ? bits.join('·') : '已接入'}`)
        : '档案缺失';
      status.textContent =
        `已连接 · ${data.model || 'model'} · ${archive} · 日常 ${data.fact_count || 0} · 口吻 ${data.style_note_count || 0} · 监督 ${data.correction_count || 0}`;
    } else {
      status.textContent = '未配置 API Key：复制 .env.example 为 .env 后填入 LYKIE_API_KEY 并重启';
    }
    return data;
  } catch (e) {
    lykieConfigured = false;
    if (status) status.textContent = '无法读取 Lykie 状态';
    return null;
  }
}

function getLastLykieReply() {
  const box = $('lykieMessages');
  if (!box) return '';
  const bubbles = box.querySelectorAll('.lykie-bubble.assistant:not(.pending)');
  if (!bubbles.length) return '';
  return bubbleText(bubbles[bubbles.length - 1]);
}

function buildQuestionPayload() {
  if (studyMode === 'sa' && window.SaTrain && typeof window.SaTrain.getCurrent === 'function') {
    const sa = window.SaTrain.getCurrent();
    if (!sa || !sa.qid) return null;
    return {
      id: sa.qid,
      type: 'short_answer',
      stem: sa.stem || '',
      options: [],
      answer: sa.answer || sa.reference_answer || '',
      answer_text: sa.answer || sa.reference_answer || '',
      analysis: '',
      include_answer: false,
      stage: sa.stage || '',
      keywords: sa.keywords || [],
    };
  }
  if (!current) return null;
  return {
    id: current.id,
    type: current.type,
    stem: current.stem,
    options: current.options || [],
    answer: current.answer,
    answer_text: current.answer_text,
    analysis: current.analysis || '',
    include_answer: !!submitted,
  };
}

/** 把模型一次返回的多句拆成多条气泡（优先按换行，其次按句号）。 */
function splitLykieReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  let parts = raw
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[-•*、]\s*/, '').trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const s = parts[0];
    const chunks = [];
    let buf = '';
    for (const ch of s) {
      buf += ch;
      if (/[。！？!?～]/.test(ch)) {
        const t = buf.trim();
        if (t) chunks.push(t);
        buf = '';
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    // 只有拆出多句且不太碎才用
    if (chunks.length >= 2 && chunks.length <= 10) parts = chunks;
  }

  return parts.slice(0, 12);
}

function typingDelayForLine(line) {
  const chars = [...String(line || '')].filter((ch) => !/[\s\p{P}]/u.test(ch)).length;
  if (chars <= 0) return 500;
  return Math.min(8000, Math.max(500, Math.round(chars * 400)));
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 分条发出 Lykie 回复（多气泡），条间按打字速度间隔；评价绑定整次回复。 */
async function appendLykieReplyBurst(text) {
  const parts = splitLykieReply(text);
  if (!parts.length) {
    appendLykieSilenceBubble();
    return [];
  }
  const burstId = 'burst_' + (++lykieBurstSeq);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await sleepMs(Math.min(2500, typingDelayForLine(parts[i])));
    else await sleepMs(Math.min(1200, Math.round(typingDelayForLine(parts[i]) * 0.35)));
    const isLast = i === parts.length - 1;
    appendLykieBubble('assistant', parts[i], {
      burstId,
      noFeedback: !isLast,
      noPing: i > 0,
    });
  }
  return parts;
}

function appendProfileNotes(notes) {
  (notes || []).forEach((n) => {
    const text = (n && n.text) || '';
    if (!text) return;
    appendLykieBubble('system', text, { noteKind: n.kind || 'used' });
  });
}
function appendLykieSilenceBubble() {
  const burstId = 'burst_' + (++lykieBurstSeq);
  return appendLykieBubble('assistant', '（先不回）', {
    burstId,
    silence: true,
  });
}

// —— 闲聊连发：发出后看输入框；3 秒内又出现字就继续等，空着超过 3 秒才回 ——
const CHAT_BATCH_IDLE_MS = 3000;
const CHAT_BATCH_MAX_LEN = 20;
let chatBatchQueue = [];
let chatBatchTimer = null;
let chatBatchWaitingEl = null;

function clearChatBatchTimer() {
  if (chatBatchTimer) {
    clearTimeout(chatBatchTimer);
    chatBatchTimer = null;
  }
}

function lykieInputHasText() {
  const input = $('lykieInput');
  return !!(input && String(input.value || '').trim());
}

function showChatBatchWaiting(on) {
  if (!on) {
    if (chatBatchWaitingEl) {
      chatBatchWaitingEl.remove();
      chatBatchWaitingEl = null;
    }
    return;
  }
  if (chatBatchWaitingEl) return;
  chatBatchWaitingEl = appendLykieBubble('system', '…等你说完再回', { skipPersist: true });
}

function queueChatMessage(text) {
  const msg = (text || '').trim();
  if (!msg) return;
  setLykiePanelOpen(true);
  lastUserUtterance = msg;
  appendLykieBubble('user', msg);
  chatBatchQueue.push(msg);
  showChatBatchWaiting(true);
  const input = $('lykieInput');
  if (input) {
    input.value = '';
    input.style.height = '100px';
    input.focus();
  }
  if (chatBatchQueue.length >= CHAT_BATCH_MAX_LEN) {
    flushChatBatch();
    return;
  }
  scheduleChatBatchFlush();
}

/** 输入框有字：她接着等；清空后再从 3 秒重新计。 */
function onChatComposeChanged() {
  if (!chatBatchQueue.length) return;
  if (lykieInputHasText()) {
    clearChatBatchTimer();
    return;
  }
  scheduleChatBatchFlush();
}

function scheduleChatBatchFlush() {
  clearChatBatchTimer();
  if (!chatBatchQueue.length) return;
  if (lykieInputHasText()) return;
  chatBatchTimer = setTimeout(() => {
    flushChatBatch();
  }, CHAT_BATCH_IDLE_MS);
}

async function flushChatBatch() {
  clearChatBatchTimer();
  if (!chatBatchQueue.length) {
    showChatBatchWaiting(false);
    return;
  }
  if (lykieInputHasText()) return;
  if (lykieBusy) {
    chatBatchTimer = setTimeout(() => flushChatBatch(), 400);
    return;
  }
  showChatBatchWaiting(false);
  const batch = chatBatchQueue.splice(0, chatBatchQueue.length);
  if (!batch.length) return;
  await sendLykie('chat', batch);
}

async function sendLykie(mode, messageOrBatch) {
  if (lykieBusy) return;

  let batch = [];
  if (Array.isArray(messageOrBatch)) {
    batch = messageOrBatch.map((s) => String(s || '').trim()).filter(Boolean);
  } else {
    const t = String(messageOrBatch || '').trim();
    if (t) batch = [t];
  }

  if ((mode === 'chat' || mode === 'correct') && !batch.length) return;
  if (mode === 'explain' && !batch.length) batch = ['这题给我讲讲？'];

  setLykiePanelOpen(true);
  lykieBusy = true;
  const sendBtn = $('lykieSendBtn');
  const askBtn = $('askLykieBtn');
  const correctBtn = $('lykieCorrectBtn');
  if (sendBtn) sendBtn.disabled = true;
  if (askBtn) askBtn.disabled = true;
  if (correctBtn) correctBtn.disabled = true;

  // chat 连发已在 queue 时画出用户气泡；explain/correct 这里画
  if (mode !== 'chat') {
    let userLabel = batch[0] || '';
    if (mode === 'explain') userLabel = `（问问）${userLabel || '这题给我讲讲？'}`;
    if (mode === 'correct') userLabel = `（纠正）${userLabel}`;
    lastUserUtterance = batch[0] || (mode === 'explain' ? '这题给我讲讲？' : '');
    appendLykieBubble('user', userLabel);
  }

  const pending = appendLykieBubble('assistant', '……', { noFeedback: true, skipPersist: true, noPing: true });
  if (pending) pending.classList.add('pending');

  const lastReply = mode === 'correct' ? getLastLykieReply() : '';

  try {
    const body = {
      mode,
      messages: batch,
      message: batch[0] || '',
      question: mode === 'explain' ? buildQuestionPayload() : null,
      last_reply: lastReply || null,
    };
    const res = await fetchAuth('/api/lykie/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (pending) pending.remove();
    if (!data.ok) {
      appendLykieBubble('system', data.error || '发送失败');
    } else if (data.typo_fix) {
      // 改错字：她心里明白，不当成新一轮，也不出「先不回」
    } else {
      const spoken = (data.reply || '').trim();
      const filling = !!data.profile_fill;
      if (spoken && !data.silent) {
        await appendLykieReplyBurst(spoken);
      } else if (!filling && (data.silent || !spoken)) {
        appendLykieSilenceBubble();
      }
      appendProfileNotes(data.profile_notes);
      if ((data.facts_added && data.facts_added.length) ||
          (data.style_notes_added && data.style_notes_added.length)) {
        if (data.style_notes_added && data.style_notes_added.length) {
          appendLykieBubble(
            'system',
            '已记住口吻：' + data.style_notes_added.join('；')
          );
        }
        await refreshLykieState();
      }
    }
  } catch (e) {
    if (pending) pending.remove();
    appendLykieBubble('system', '网络错误，稍后再试');
  } finally {
    lykieBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (askBtn) askBtn.disabled = false;
    if (correctBtn) correctBtn.disabled = false;
    const input = $('lykieInput');
    if (input && (mode === 'chat' || mode === 'correct')) {
      if (mode === 'correct') {
        input.value = '';
        input.style.height = '100px';
      }
      input.focus();
    }
    // 她回的时候用户又连发了 → 接着冲下一轮
    if (chatBatchQueue.length) scheduleChatBatchFlush();
  }
}

function onLykieSend() {
  const input = $('lykieInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  if (window.StoryRunner && window.StoryRunner.isActive()) {
    window.StoryRunner.handleSend(text);
    return;
  }
  if (/^(纠正|口吻纠正|风格纠正)[:：\s]/.test(text)) {
    if (lykieBusy) return;
    sendLykie('correct', text.replace(/^(纠正|口吻纠正|风格纠正)[:：\s]+/, '').trim() || text);
    return;
  }
  // 闲聊：先入队（她回的过程中也可以继续发）
  queueChatMessage(text);
}

function onAskLykie() {
  const payload = buildQuestionPayload();
  if (!payload) {
    appendLykieBubble('system', '现在没有题目可问');
    setLykiePanelOpen(true);
    return;
  }
  sendLykie('explain', '这题给我讲讲？');
}

function onCorrectLast() {
  if (!getLastLykieReply()) {
    appendLykieBubble('system', '还没有可纠正的上一句');
    setLykiePanelOpen(true);
    return;
  }
  const input = $('lykieInput');
  const typed = input ? input.value.trim() : '';
  if (typed) {
    sendLykie('correct', typed.replace(/^(纠正|口吻纠正|风格纠正)[:：\s]+/, '').trim() || typed);
    return;
  }
  if (input) {
    input.value = '纠正：';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  appendLykieBubble('system', '在输入框写完纠正内容后发送（也可直接以「纠正：」开头）');
}

if ($('lykieSendBtn')) $('lykieSendBtn').onclick = onLykieSend;
if ($('askLykieBtn')) $('askLykieBtn').onclick = onAskLykie;
if ($('saAskLykieBtn')) $('saAskLykieBtn').onclick = onAskLykie;
if ($('lykieCorrectBtn')) $('lykieCorrectBtn').onclick = onCorrectLast;
if ($('lykieClearChatBtn')) $('lykieClearChatBtn').onclick = clearChatToOpeningEnd;
if ($('lykieFbCancel')) $('lykieFbCancel').onclick = closeLykieFeedback;
if ($('lykieFbSubmit')) $('lykieFbSubmit').onclick = submitLykieFeedback;
if ($('lykieFeedbackModal')) {
  $('lykieFeedbackModal').addEventListener('click', (e) => {
    if (e.target === $('lykieFeedbackModal')) closeLykieFeedback();
  });
}
if ($('lykieCloseBtn')) $('lykieCloseBtn').onclick = () => setLykiePanelOpen(false);
if ($('lykiePeekerBtn')) {
  $('lykiePeekerBtn').onclick = () => {
    const panel = $('lykiePanel');
    const open = panel && panel.classList.contains('collapsed');
    setLykiePanelOpen(open);
  };
}
if ($('celestialBtn')) {
  $('celestialBtn').onclick = () => toggleTheme();
}

function syncSfxToggleBtn() {
  const btn = $('sfxToggleBtn');
  if (!btn || !window.LykieSfx) return;
  const on = LykieSfx.isEnabled();
  btn.textContent = on ? '🔊' : '🔇';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on
    ? '音效开（点击关闭；Shift+点击试听）'
    : '音效关（点击开启；Shift+点击试听）';
}
if ($('sfxToggleBtn')) {
  syncSfxToggleBtn();
  $('sfxToggleBtn').onclick = (e) => {
    if (!window.LykieSfx) return;
    if (e.shiftKey) {
      LykieSfx.previewAll();
      return;
    }
    LykieSfx.toggle();
    syncSfxToggleBtn();
  };
  window.addEventListener('lykie-sfx-toggle', syncSfxToggleBtn);
}
if ($('bankDrawerBtn')) {
  $('bankDrawerBtn').onclick = () => {
    const next = !document.body.classList.contains('bank-drawer-open');
    if (next) setLykiePanelOpen(false);
    setBankDrawerOpen(next);
  };
}
if ($('bankDrawerCloseBtn')) {
  $('bankDrawerCloseBtn').onclick = () => setBankDrawerOpen(false);
}
if ($('bankDrawerBackdrop')) {
  $('bankDrawerBackdrop').onclick = () => setBankDrawerOpen(false);
}
if ($('lykieInput')) {
  $('lykieInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onLykieSend();
    }
  });
  $('lykieInput').addEventListener('input', () => {
    const el = $('lykieInput');
    const minH = isMobilePortrait() ? 56 : 100;
    const maxH = isMobilePortrait() ? 140 : 220;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, minH), maxH) + 'px';
    onChatComposeChanged();
  });
}

function refreshCelestial() {
  const sun = $('celestialSun');
  const moon = $('celestialMoon');
  const btn = $('celestialBtn');
  if (!sun || !moon) return;
  // 浅色 → 实心太阳；深色 → 空心月亮；与现实时间无关
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  sun.hidden = dark;
  moon.hidden = !dark;
  if (btn) btn.title = dark ? '切换到浅色' : '切换到深色';
}

(async () => {
  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  } catch (e) { /* 忽略 */ }
  applyTheme(savedTheme);
  refreshCelestial();

  // 默认收起；只有用户主动打开过才记住展开（刷题测试优先，不抢主界面）
  let panelOpen = false;
  try {
    panelOpen = localStorage.getItem('lykiePanelOpen') === '1';
  } catch (e) { /* ignore */ }
  if (isMobilePortrait()) panelOpen = false;
  setLykiePanelOpen(panelOpen);

  const state = await refreshLykieState();

  // 先加载题库；开场剧情绝不能挡住背题区（否则一直「加载中」、侧栏空白）
  await refreshBanks();
  const params = new URLSearchParams(window.location.search);
  const bankParam = params.get('bank');
  if (bankParam) {
    await selectBank(bankParam);
    try {
      params.delete('bank');
      const qs = params.toString();
      window.history.replaceState({}, '', qs ? `/?${qs}` : '/');
    } catch (_) { /* ignore */ }
  } else {
    const s = await refreshStatus();
    await syncStudyMode(s);
  }

  const storyDone = !!(state && state.flags && state.flags.fragment_01_done);
  if (window.StoryRunner && !storyDone) {
    pendingOpeningStory = true;
  } else {
    const replay = $('lykieReplayStoryBtn');
    if (replay) replay.hidden = false;
    const log = (state && state.panel_log) || lastPanelLog || [];
    if (log.length) {
      restorePanelLog(log);
    } else if ($('lykieMessages') && !$('lykieMessages').children.length) {
      appendLykieBubble('system', '嗨，我是 Lykie。刷题累了可以找我聊聊；卡住了就点「问问 Lykie」。');
    }
  }
})();
