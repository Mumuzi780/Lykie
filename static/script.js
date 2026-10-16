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

/** 斩题进度条分档：跨档才播文案/闪电 */
const KILL_BAR_TIERS = [25, 50, 75, 100];
let killBarSyncKey = null;
let killBarPrevPct = 0;
let killBarFiredTiers = new Set();
let pendingKillCheer = null; // { tier, promise }


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

// ==================== 题库列表 / 文件夹 / 归档 ====================
let foldersCache = [];
// 归档/未分类已改为左栏预设项，抽屉折叠状态（lykieArchiveCollapsed）废弃

// last_studied_at → 「N 天前」灰字文案
function agoLabel(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(t.getTime())) return '';
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOfDay(now) - startOfDay(t)) / 86400000);
  if (days < 1) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days > 60) return '60+天前';
  return `${days}天前`;
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
    + (b.archived ? ' bank-item-archived' : '');
  li.dataset.bankId = String(b.id);
  if (b.folder_id) li.dataset.folderId = String(b.folder_id);
  const progress = b.is_sa
    ? `简答 · ${b.total} 题`
    : `已斩 ${b.killed}/${b.total}`;
  const ago = agoLabel(b.last_studied_at);
  const actions = b.archived
    ? `<button class="mini-btn" data-act="restore">恢复</button>` +
      `<button class="mini-btn danger" data-act="delete">删除</button>`
    : `<button class="mini-btn" data-act="view">查看</button>` +
      `<button class="mini-btn" data-act="archive">归档</button>` +
      `<button class="mini-btn" data-act="more">⋯</button>`;
    li.innerHTML =
      `<div class="bank-name">${escapeHtml(b.name)}</div>` +
      `<div class="bank-meta">${escapeHtml(b.imported_at)}${ago ? `<span class="bank-ago"> · ${ago}</span>` : ''}</div>` +
    `<div class="bank-progress">${progress}</div>` +
      `<div class="bank-actions">` + actions + `</div>`;
    li.onclick = () => selectBank(b.id);
  // 移除原生拖拽，改用自定义拖拽实现即时响应
  li.style.cursor = 'grab';
  li.addEventListener('mousedown', (e) => {
    if (e.target.closest('.bank-actions') || e.target.closest('button')) return;
    startBankDrag(e, li, b);
  });
  if (!b.archived) {
    li.querySelector('[data-act="view"]').onclick = e => { e.stopPropagation(); openBankView(b.id); };
    li.querySelector('[data-act="archive"]').onclick = e => { e.stopPropagation(); archiveBank(b.id); };
    li.querySelector('[data-act="more"]').onclick = e => { e.stopPropagation(); openBankMoreMenu(e.currentTarget, b); };
  } else {
    li.querySelector('[data-act="restore"]').onclick = e => { e.stopPropagation(); unarchiveBank(b.id); };
    li.querySelector('[data-act="delete"]').onclick = e => { e.stopPropagation(); deleteBank(b); };
  }
  listEl.appendChild(li);
}

// ⋯ 二级菜单：分享 / 移入 / 重命名 / 删除
function openBankMoreMenu(anchor, b) {
  closeBankMoreMenu();
  const menu = document.createElement('div');
  menu.className = 'bank-more-menu';
  menu.id = 'bankMoreMenu';
  const items = [
    { label: '分享', act: () => openShareBankModal(b) },
    { label: '重命名', act: () => renameBank(b) },
    { label: '删除', act: () => deleteBank(b), danger: true },
  ];
  menu.innerHTML = items
    .map((it, i) => `<button type="button" class="bank-more-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.label}</button>`)
    .join('');
  menu.querySelectorAll('.bank-more-item').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      closeBankMoreMenu();
      items[Number(btn.dataset.i)].act();
    };
  });
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  setTimeout(() => {
    document.addEventListener('click', closeBankMoreMenu, { once: true });
  }, 0);
}

function closeBankMoreMenu() {
  const m = document.getElementById('bankMoreMenu');
  if (m) m.remove();
}

async function archiveBank(bankId) {
  const res = await api('/api/banks/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bankId }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '归档失败');
    return;
  }
  applyBanksFoldersPayload(res);
}

async function unarchiveBank(bankId) {
  const res = await api('/api/banks/unarchive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bankId }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '恢复失败');
    return;
  }
  applyBanksFoldersPayload(res);
}

// archive/unarchive 响应带完整 banks/folders，直接替换缓存并重渲染
function applyBanksFoldersPayload(res) {
  if (res && Array.isArray(res.banks)) lastBanksPayload = res.banks;
  if (res && Array.isArray(res.folders)) foldersCache = res.folders;
  const stillCurrent = (lastBanksPayload || []).some(
    (b) => String(b.id) === String(currentBankId) && !b.archived
  );
  if (!stillCurrent) currentBankId = null;
  renderBankList(lastBanksPayload || []);
  renderFolderNav();
}

async function refreshBanks() {
  const data = await api('/api/banks');
  currentBankId = data.current_bank_id;
  foldersCache = data.folders || [];
  papersCache = data.papers || [];
  if (window.LykieMock) LykieMock.onBanksPayload(data);
  renderBankList(data.banks || []);
  renderFolderNav();
  if (window.LykieMock) LykieMock.appendCollections($('bankList'), data.collections || []);
  updateNotifBadge(data.notifications_unread || 0);
  return data;
}

// ---- 双栏侧栏：左栏文件夹导航 + 右栏上下文题库列表 ----
const FOLDER_NAV_KEY = 'lykieCurrentFolder';
let currentFolderId = localStorage.getItem(FOLDER_NAV_KEY) || 'uncategorized'; // 'uncategorized' | 'archive' | folderId
let lastBanksPayload = [];
let papersCache = []; // 阅读条目（试卷+普通文章），影子条目入侧栏
let folderNavDragState = null; // 左栏文件夹拖拽（与题库拖拽状态分离）

function saveCurrentFolder() {
  try { localStorage.setItem(FOLDER_NAV_KEY, currentFolderId); } catch (e) { /* ignore */ }
}

function folderBankCount(fid) {
  // 用户文件夹：该 folder_id 的活跃题库数 + 试卷数（一卷计 1）；预设：uncategorized=根区，archive=归档
  const banks = lastBanksPayload || [];
  const papers = papersCache || [];
  const folderIds = new Set((foldersCache || []).map((f) => String(f.id)));
  if (fid === 'archive') {
    return banks.filter((b) => b.archived).length + papers.filter((p) => p.archived).length;
  }
  if (fid === 'uncategorized') {
    return banks.filter((b) => !b.archived && (!b.folder_id || !folderIds.has(String(b.folder_id)))).length
      + papers.filter((p) => !p.archived && (!p.folder_id || !folderIds.has(String(p.folder_id)))).length;
  }
  return banks.filter((b) => !b.archived && String(b.folder_id || '') === String(fid)).length
    + papers.filter((p) => !p.archived && String(p.folder_id || '') === String(fid)).length;
}

function renderFolderNav() {
  const nav = $('folderNav');
  if (!nav) return;
  nav.innerHTML = '';
  const cur = String(currentFolderId);

  // 预设：未分类（固定第一）
  nav.appendChild(makeFolderNavItem({ id: 'uncategorized', name: '未分类', preset: true }));
  // 用户文件夹（按 sort_order）
  (foldersCache || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .forEach((f) => nav.appendChild(makeFolderNavItem(f)));
  // 新建入口
  const createLi = document.createElement('button');
  createLi.type = 'button';
  createLi.className = 'folder-nav-item folder-nav-create';
  createLi.innerHTML = '<span class="folder-nav-plus">＋</span>新建文件夹';
  createLi.onclick = (e) => { e.stopPropagation(); createFolder(); };
  nav.appendChild(createLi);
  // 预设：归档（固定最后）
  nav.appendChild(makeFolderNavItem({ id: 'archive', name: '归档', preset: true }));
}

function makeFolderNavItem(f) {
  const isPreset = !!f.preset;
  const fid = String(f.id);
  const li = document.createElement('div');
  li.className = 'folder-nav-item'
    + (fid === String(currentFolderId) ? ' active' : '')
    + (isPreset ? ' preset' : '');
  li.dataset.folderId = fid;
  const count = folderBankCount(fid);
  li.innerHTML =
    `<span class="folder-nav-icon">${fid === 'archive' ? '🗄' : (isPreset ? '📚' : '📁')}</span>` +
    `<span class="folder-nav-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>` +
    `<span class="folder-nav-count" hidden>0</span>` +
    (isPreset ? '' :
      `<span class="folder-nav-ops">` +
      `<button type="button" class="folder-nav-op" data-op="rename" title="重命名">✏️</button>` +
      `<button type="button" class="folder-nav-op" data-op="delete" title="删除">🗑</button></span>`);
  const cntEl = li.querySelector('.folder-nav-count');
  if (count > 0) { cntEl.textContent = String(count); cntEl.hidden = false; }

  li.onclick = (e) => {
    if (e.target.closest('.folder-nav-op')) return;
    currentFolderId = fid;
    saveCurrentFolder();
    renderFolderNav();
    renderBankList();
  };
  if (!isPreset) {
    li.querySelector('[data-op="rename"]').onclick = (e) => { e.stopPropagation(); renameFolder(f); };
    li.querySelector('[data-op="delete"]').onclick = (e) => { e.stopPropagation(); deleteFolder(f); };
    // 左栏用户文件夹可拖拽排序（预设项不绑）
    li.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.folder-nav-op') || e.target.closest('button')) return;
      startFolderNavDrag(e, li, f);
    });
  }
  return li;
}

function renderBankList(allBanks) {
  if (allBanks) lastBanksPayload = allBanks;
  const list = $('bankList');
  if (!list) return;
  list.innerHTML = '';

  const cur = String(currentFolderId);
  const banks = lastBanksPayload || [];
  const folderIds = new Set((foldersCache || []).map((f) => String(f.id)));

  // 上下文标题
  let ctxName = '未分类';
  let ctxIcon = '📚';
  if (cur === 'archive') { ctxName = '归档'; ctxIcon = '🗄'; }
  else if (cur !== 'uncategorized') {
    const f = (foldersCache || []).find((x) => String(x.id) === cur);
    ctxName = f ? f.name : '未分类';
    if (!f) { currentFolderId = 'uncategorized'; saveCurrentFolder(); }
    ctxIcon = '📁';
  }
  const head = document.createElement('li');
  head.className = 'bank-ctx-title';
  head.innerHTML = `<span>${ctxIcon}</span> ${escapeHtml(ctxName)}`;
  list.appendChild(head);

  // 当前上下文的题库
  let shown = [];
  if (cur === 'archive') shown = banks.filter((b) => b.archived);
  else if (cur === 'uncategorized') shown = banks.filter((b) => !b.archived && (!b.folder_id || !folderIds.has(String(b.folder_id))));
  else shown = banks.filter((b) => !b.archived && String(b.folder_id || '') === cur);
  shown
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .forEach((b) => appendBankItem(list, b, { nested: false }));

  // 当前上下文的阅读条目（试卷影子条目 + 普通文章），追加在题库之后
  const shownPapers = contextPapers(cur, folderIds);
  shownPapers.forEach((p) => appendPaperItem(list, p, cur));

  // 空态提示（模考分区由 mock.js 在其后追加）
  if (!shown.length && !shownPapers.length) {
    const empty = document.createElement('li');
    empty.className = 'bank-empty-hint';
    empty.textContent = cur === 'archive' ? '抽屉是空的' : '这里还没有题库，导入或从其他文件夹拖入';
    list.appendChild(empty);
  }
}

// ---- 试卷影子条目：一卷多节入口投影（数据在 readings.json，不进题库管道） ----

function contextPapers(cur, folderIds) {
  const papers = papersCache || [];
  if (cur === 'archive') return papers.filter((p) => p.archived);
  if (cur === 'uncategorized') return papers.filter((p) => !p.archived && (!p.folder_id || !folderIds.has(String(p.folder_id))));
  return papers.filter((p) => !p.archived && String(p.folder_id || '') === cur);
}

// 节条目显示名（与球内 tab 命名统一）
function paperSectionName(s) {
  if (s.kind === 'bank') return '选词填空';
  if (s.kind === 'match') return '段落匹配';
  const cn = ['一', '二', '三', '四', '五'];
  const m = /^C(\d+)$/.exec(String(s.key || ''));
  if (m) return `仔细阅读${cn[Number(m[1]) - 1] || m[1]}`;
  return s.label || '仔细阅读';
}

function appendPaperItem(listEl, p, ctx) {
  if (p.is_paper) {
    // 试卷：归档视图=整卷单条目；文件夹/未分类=展开节条目
    if (ctx === 'archive') {
      listEl.appendChild(makePaperLi(p, {
        name: p.title,
        badge: '卷',
        meta: `${(p.sections || []).reduce((n, s) => n + (s.count || 0), 0)} 题`,
        archived: true,
      }));
      return;
    }
    (p.sections || []).forEach((s) => {
      listEl.appendChild(makePaperLi(p, {
        name: paperSectionName(s),
        badge: '卷',
        meta: s.kind === 'bank' ? `${s.count} 空` : `${s.count} 题`,
        sec: s.key,
        archived: false,
      }));
    });
    return;
  }
  // 普通文章：单条目，仅入口（不可拖拽）
  listEl.appendChild(makePaperLi(p, {
    name: p.title,
    badge: '',
    meta: '阅读',
    archived: false,
  }));
}

function makePaperLi(p, opts) {
  const li = document.createElement('li');
  li.className = 'bank-item paper-item' + (opts.archived ? ' bank-item-archived' : '');
  li.dataset.textId = String(p.id);
  li.innerHTML =
    `<div class="bank-name">${opts.badge ? `<span class="paper-badge">${escapeHtml(opts.badge)}</span>` : ''}${escapeHtml(opts.name)}</div>` +
    `<div class="bank-meta">${escapeHtml(opts.meta)}</div>`;
  li.onclick = () => {
    // 主界面多视图：原地切阅读视图（pushState 免整页刷新），不再跳 /reading
    openReadingView(String(p.id), opts.sec || '');
  };
  // 试卷可拖（活跃卷：移动/归档；归档卷：拖出恢复）；普通文章仅入口不可拖
  if (p.is_paper) {
    li.style.cursor = 'grab';
    li.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      startBankDrag(e, li, {
        id: String(p.id),
        archived: !!p.archived,
        folder_id: p.folder_id || null,
        name: opts.name,
        __paper: true,
      });
    });
  }
  return li;
}

// ---- 主界面多视图：题库 ↔ 阅读原地切换（规格：阅读并入主界面） ----

function buildReadUrl(textId, sec) {
  let u = `/?read=${encodeURIComponent(textId)}`;
  if (sec) u += `&sec=${encodeURIComponent(sec)}`;
  return u;
}

async function applyReadingView(textId, sec, paper) {
  const res = await api(`/api/reading/view/${encodeURIComponent(textId)}`);
  if (!res || res.ok === false) {
    await uiAlert(res && res.error ? res.error : '试卷不存在或已被删除');
    showStudyView();
    return;
  }
  document.body.classList.add('mode-reading');
  const rv = $('readView');
  if (rv) rv.hidden = false;
  document.querySelectorAll('.rd-bubble, .rd-toast').forEach((el) => el.remove());
  if (window.RD) window.RD.init(res, { sec: sec || '', paper: paper || '' });
  const assetsLink = $('assetsLink');
  if (assetsLink) assetsLink.href = '/assets?back=' + encodeURIComponent(`/?read=${textId}`);
}

async function openReadingView(textId, sec) {
  try { history.pushState({ read: textId }, '', buildReadUrl(textId, sec)); } catch (e) { /* ignore */ }
  await applyReadingView(textId, sec, '');
}

function showStudyView() {
  // 退出阅读：宿主隐藏即可，刷题 DOM 的显隐本就由各自的态管理（CSS 只在 mode-reading 下压掉它们）
  document.body.classList.remove('mode-reading');
  const rv = $('readView');
  if (rv) rv.hidden = true;
  document.querySelectorAll('.rd-toolbar-only').forEach((b) => { b.hidden = true; });
  ['rdQBall', 'rdQCard'].forEach((id) => { const el = $(id); if (el) el.hidden = true; });
  document.querySelectorAll('.rd-bubble, .rd-picker-panel, .rd-toast').forEach((el) => el.remove());
  const assetsLink = $('assetsLink');
  if (assetsLink) assetsLink.href = '/assets';
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  const readId = params.get('read');
  if (readId) applyReadingView(readId, params.get('sec') || '', params.get('paper') || '');
  else showStudyView();
});

// 阅读态下点题库/模考条目：退出阅读回刷题（试卷条目除外——它们本来就是进阅读）
$('bankList').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li || li.classList.contains('paper-item')) return;
  if (document.body.classList.contains('mode-reading')) {
    showStudyView();
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  }
});

function clearDropHover() {
  document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
}

// ---- 自定义拖拽：即时响应 + 拖本体 ----
let bankDragState = null; // { id, archived, folderId, el, startY, startX, offsetY, offsetX, placeholder, isDragging }

function startBankDrag(e, li, b) {
  if (e.button !== 0) return;
  e.preventDefault();
  // 只记录状态、绑定监听，不动 DOM —— 纯点击不受任何影响，click 正常触发
  const rect = li.getBoundingClientRect();
  bankDragState = {
    id: String(b.id),
    archived: !!b.archived,
    folderId: b.folder_id || null,
    bankName: String(b.name || ''),
    __paper: !!b.__paper, // 试卷影子条目：落点走 reading 专属 API，无右栏排序
    el: li,
    placeholder: null,
    startY: e.clientY,
    startX: e.clientX,
    offsetY: e.clientY - rect.top,
    offsetX: e.clientX - rect.left,
    isDragging: false,
    parent: li.parentElement,
    nextSibling: li.nextSibling,
  };
  document.addEventListener('mousemove', onBankDragMove);
  document.addEventListener('mouseup', onBankDragEnd);
}

// 超过阈值后进入拖拽视觉：原位插占位符（排序反馈），原卡片原地隐藏，鼠标旁跟随小球体徽章（方案A）
function bankDragBeginVisual() {
  const st = bankDragState;
  const el = st.el;
  const rect = el.getBoundingClientRect();
  const ph = document.createElement('li');
  ph.className = 'bank-drag-placeholder';
  ph.style.height = rect.height + 'px';
  st.placeholder = ph;
  el.parentNode.insertBefore(ph, el);
  // 原卡片原地隐藏（不移动，DOM 位置保留），占位符占据其视觉槽位
  el.style.display = 'none';
  // 球体徽章：图标 + 截断名（6 字），跟随鼠标右下偏移（试卷用 📜 与题库区分）
  const name = (st.bankName || '').trim() || '题库';
  const chip = document.createElement('div');
  chip.className = 'bank-drag-chip';
  const icon = st.__paper ? '📜 ' : (st.archived ? '🗄 ' : '📚 ');
  chip.textContent = icon + (name.length > 6 ? name.slice(0, 6) + '…' : name);
  document.body.appendChild(chip);
  st.chip = chip;
  document.body.classList.add('is-bank-dragging');
}

// 左栏悬停高亮：目标为 folder-nav-item（预设项/用户文件夹通用）
function bankDragSetNavHover(itemEl) {
  document.querySelectorAll('.folder-nav-item.drop-hover').forEach((el) => {
    if (el !== itemEl) el.classList.remove('drop-hover');
  });
  if (itemEl) itemEl.classList.add('drop-hover');
}

function bankDragAutoScroll(e) {
  const list = $('bankList');
  if (!list) return;
  const r = list.getBoundingClientRect();
  // 仅当鼠标在右栏水平范围内才自动滚动右栏（左栏拖拽时右栏不动）
  if (e.clientX < r.left || e.clientX > r.right) return;
  const edge = 48;
  if (e.clientY < r.top + edge) list.scrollTop -= 10;
  else if (e.clientY > r.bottom - edge) list.scrollTop += 10;
}

function onBankDragMove(e) {
  if (!bankDragState) return;
  const st = bankDragState;
  if (!st.isDragging) {
    const dy = Math.abs(e.clientY - st.startY);
    const dx = Math.abs(e.clientX - st.startX);
    if (dy <= 5 && dx <= 5) return;
    st.isDragging = true;
    bankDragBeginVisual();
  }
  const { el, placeholder, chip } = st;
  // 球体徽章跟随鼠标（右下偏移，不挡正下方目标），原卡片保持隐藏
  if (chip) {
    chip.style.left = Math.min(e.clientX + 14, window.innerWidth - 170) + 'px';
    chip.style.top = Math.min(e.clientY + 14, window.innerHeight - 40) + 'px';
  }
  bankDragAutoScroll(e);

  // ---- 几何命中（双栏）：先左栏导航，再右栏列表；两栏以 gap 中线互斥，杜绝串线 ----
  const nav = $('folderNav');
  const list = $('bankList');
  if (!list || !placeholder) return;

  const nr = nav ? nav.getBoundingClientRect() : null;
  const lr = list.getBoundingClientRect();
  const gapMid = nr ? (nr.right + lr.left) / 2 : lr.left - 8;
  const inNavX = !!nr && e.clientX >= nr.left - 8 && e.clientX < gapMid;
  const inListX = e.clientX > gapMid && e.clientX <= lr.right + 8;

  if (inNavX && nav) {
    // 左栏意图 = 题库进"缓冲区"：占位符保持隐藏（右侧不留槽位），整个悬停期间稳定无闪烁
    if (!placeholder.hidden) placeholder.hidden = true;
    // 命中判定带 ±2px gap 容忍（相邻项矩形无缝衔接，消除项间 4px 空隙的命中落空）
    let navHit = null;
    for (const it of nav.querySelectorAll(':scope > .folder-nav-item')) {
      if (it.classList.contains('folder-nav-create')) continue;
      const r = it.getBoundingClientRect();
      if (e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2) { navHit = it; break; }
    }
    if (navHit) {
      bankDragSetNavHover(navHit);
      st.navTargetId = navHit.dataset.folderId || null;
    } else {
      bankDragSetNavHover(null);
      st.navTargetId = null;
    }
    return;
  }
  bankDragSetNavHover(null);
  st.navTargetId = null;
  if (placeholder.hidden) placeholder.hidden = false;

  // 右栏：鼠标不在右栏水平范围内（含在左栏/gap 内）→ 冻结占位符，不排序
  if (!inListX) return;
  movePlaceholderNear(placeholder, el, list, e.clientY);
}

// 在 container 的直接子项中按垂直几何找最近插入点；已就位则跳过插入（杜绝布局反馈震荡）
function movePlaceholderNear(placeholder, draggingEl, container, y) {
  const kids = [...container.children].filter((n) => n !== placeholder && n !== draggingEl);
  if (!kids.length) {
    if (placeholder.parentElement !== container) container.appendChild(placeholder);
    return;
  }
  let best = null;
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    if (r.height === 0) continue; // 不可见（折叠容器内）
    if (y >= r.top && y <= r.bottom) { best = { el: k, before: y < r.top + r.height / 2 }; break; }
    const dTop = Math.abs(y - r.top);
    const dBot = Math.abs(y - r.bottom);
    const cand = dTop <= dBot ? { el: k, before: true, dist: dTop } : { el: k, before: false, dist: dBot };
    if (!best || cand.dist < best.dist) best = cand;
  }
  if (!best) return;
  const inPlace = best.before
    ? placeholder === best.el.previousElementSibling
    : placeholder === best.el.nextElementSibling;
  if (!inPlace) {
    if (best.before) container.insertBefore(placeholder, best.el);
    else container.insertBefore(placeholder, best.el.nextSibling);
  }
}

async function onBankDragEnd(e) {
  if (!bankDragState) return;
  const st = bankDragState;
  bankDragState = null;
  document.removeEventListener('mousemove', onBankDragMove);
  document.removeEventListener('mouseup', onBankDragEnd);
  document.body.classList.remove('is-bank-dragging');
  bankDragSetNavHover(null);

  const { el, placeholder, isDragging, id, archived, folderId, navTargetId, chip } = st;
  // 纯点击：DOM 从未动过，click 事件照常触发
  if (!isDragging) return;

  // 销毁球体徽章 + 原卡片恢复可见（本体未移动过，仅需取消隐藏）
  if (chip) chip.remove();
  el.style.display = '';

  // ---- 试卷分支：整卷移动/归档/恢复（影子条目，走 reading 专属 API；无右栏排序语义） ----
  if (st.__paper) {
    if (placeholder && placeholder.parentElement) placeholder.parentElement.removeChild(placeholder);
    st.parent.insertBefore(el, st.nextSibling);
    if (!navTargetId) return; // 右栏内松手：无排序语义，放回原位
    if (navTargetId === 'archive') {
      if (archived) return; // 归档视图内拖到归档：无操作
      const res = await api('/api/reading/paper/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_id: id }),
      });
      if (res.ok === false) { await uiAlert(res.error || '归档失败'); return; }
      await refreshBanks();
      return;
    }
    if (archived) {
      // 归档卷拖出 = 整卷恢复（回原 folder_id，与题库「恢复+移入」不同：试卷恢复固定回原处）
      const res = await api('/api/reading/paper/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_id: id }),
      });
      if (res.ok === false) { await uiAlert(res.error || '恢复失败'); await refreshBanks(); return; }
      await refreshBanks();
      return;
    }
    // 活跃卷：移入文件夹/移出
    const targetFolderId = navTargetId === 'uncategorized' ? null : navTargetId;
    if (String(folderId || '') !== String(targetFolderId || '')) {
      const res = await api('/api/reading/paper/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_id: id, folder_id: targetFolderId }),
      });
      if (res.ok === false) { await uiAlert(res.error || '移动失败'); return; }
      await refreshBanks();
    }
    return;
  }

  // ---- 落点 A：左栏导航目标（移入文件夹 / 归档 / 回未分类） ----
  if (navTargetId) {
    if (placeholder && placeholder.parentElement) placeholder.parentElement.removeChild(placeholder);
    st.parent.insertBefore(el, st.nextSibling); // 先放回原位，成功后全量重渲染
    if (navTargetId === 'archive') {
      if (archived) return; // 归档视图内拖到归档：无操作
      const res = await api('/api/banks/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok === false) { await uiAlert(res.error || '归档失败'); return; }
      applyBanksFoldersPayload(res);
      return;
    }
    const targetFolderId = navTargetId === 'uncategorized' ? null : navTargetId;
    // 恢复 + 移入 / 直接移入 / 移出
    if (archived) {
      const res = await api('/api/banks/unarchive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok === false) { await uiAlert(res.error || '恢复失败'); await refreshBanks(); return; }
      applyBanksFoldersPayload(res);
    }
    if (String(folderId || '') !== String(targetFolderId || '') || archived) {
      await moveBankTo(id, targetFolderId);
    }
    return;
  }

  // ---- 落点 B：右栏内排序（占位符位置即目标位置） ----
  const container = placeholder && placeholder.parentElement;
  if (!container || container.closest('.folder-nav')) {
    // 无有效落点（含占位符仍隐藏）：放回原位
    if (placeholder && placeholder.parentElement) placeholder.parentElement.removeChild(placeholder);
    st.parent.insertBefore(el, st.nextSibling);
    return;
  }

  // 放回占位符位置（insertBefore 会把本体从 body 摘回）
  container.insertBefore(el, placeholder);
  container.removeChild(placeholder);

  // 归档题库在归档视图内拖动 = 同级排序，继续往下走

  // 跨上下文移动（理论上拖拽引擎已阻止，防御性兜底）
  const cur = String(currentFolderId);
  const targetCtx = archived ? 'archive' : (cur === 'archive' ? 'uncategorized' : cur);
  if (String(folderId || '') !== ctxToFolderId(targetCtx) && !archived) {
    await moveBankTo(id, ctxToFolderId(targetCtx));
    return;
  }

  // 同级排序：静默保存（:scope 只取容器直接子级）
  const orderedIds = [...el.parentElement.querySelectorAll(':scope > .bank-item')].map((n) => n.dataset.bankId);
  api('/api/banks/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: archived ? '__archive__' : ctxToFolderId(cur), ordered_ids: orderedIds }),
  }).then((res) => {
    if (res.ok === false) {
      uiAlert(res.error || '排序失败');
      refreshBanks();
      return;
    }
    if (res && Array.isArray(res.banks)) lastBanksPayload = res.banks;
    if (res && Array.isArray(res.folders)) foldersCache = res.folders;
  });
}

// 上下文 → folder_id（'uncategorized'/'archive' → null）
function ctxToFolderId(ctx) {
  return ctx === 'uncategorized' || ctx === 'archive' ? null : ctx;
}

// 文件夹头部：接受题库拖入（未归档→移入；归档→恢复并移入）
// 题库拖拽目标统一由自定义拖拽引擎（onBankDragMove 命中检测）处理，此处不再绑原生事件

async function moveBankTo(bankId, folderId) {
  const res = await api('/api/banks/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bankId, folder_id: folderId }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '移动失败');
  }
  await refreshBanks();
}

// ---- 左栏文件夹拖拽（与题库拖拽状态分离，防止互相污染） ----
function startFolderNavDrag(e, li, f) {
  if (e.button !== 0) return;
  e.preventDefault();
  const rect = li.getBoundingClientRect();
  folderNavDragState = {
    id: String(f.id),
    el: li,
    placeholder: null,
    startY: e.clientY,
    startX: e.clientX,
    offsetY: e.clientY - rect.top,
    offsetX: e.clientX - rect.left,
    isDragging: false,
    parent: li.parentElement,
    nextSibling: li.nextSibling,
  };
  document.addEventListener('mousemove', onFolderNavDragMove);
  document.addEventListener('mouseup', onFolderNavDragEnd);
}

function onFolderNavDragMove(e) {
  if (!folderNavDragState) return;
  const st = folderNavDragState;
  if (!st.isDragging) {
    if (Math.abs(e.clientY - st.startY) <= 5 && Math.abs(e.clientX - st.startX) <= 5) return;
    st.isDragging = true;
    // 占位符插到左栏原位，本体挂 body 跟随（与题库拖拽同款视觉）
    const el = st.el;
    const rect = el.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'folder-nav-placeholder';
    ph.style.height = rect.height + 'px';
    st.placeholder = ph;
    el.parentNode.insertBefore(ph, el);
    el.style.width = rect.width + 'px';
    el.style.position = 'fixed';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.92';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
    el.style.cursor = 'grabbing';
    document.body.appendChild(el);
    document.body.classList.add('is-folder-dragging');
  }
  const { el } = st;
  el.style.top = (e.clientY - st.offsetY) + 'px';
  el.style.left = (e.clientX - st.offsetX) + 'px';

  // 左栏内几何排序（跳过预设项和新建入口：只有用户文件夹参与排序）
  // 鼠标在左栏水平范围外（如拖到右栏）时冻结占位符，不牵动排序
  const nav = $('folderNav');
  if (!nav || !st.placeholder) return;
  const nr = nav.getBoundingClientRect();
  if (e.clientX < nr.left - 8 || e.clientX > nr.right + 8) return;
  const kids = [...nav.children].filter((n) =>
    n !== st.placeholder && n !== st.el && n.classList.contains('folder-nav-item')
    && !n.classList.contains('preset') && !n.classList.contains('folder-nav-create'));
  let best = null;
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) { best = { el: k, before: e.clientY < r.top + r.height / 2 }; break; }
    const dTop = Math.abs(e.clientY - r.top);
    const dBot = Math.abs(e.clientY - r.bottom);
    const cand = dTop <= dBot ? { el: k, before: true, dist: dTop } : { el: k, before: false, dist: dBot };
    if (!best || cand.dist < best.dist) best = cand;
  }
  if (!best) return;
  const inPlace = best.before
    ? st.placeholder === best.el.previousElementSibling
    : st.placeholder === best.el.nextElementSibling;
  if (!inPlace) {
    if (best.before) nav.insertBefore(st.placeholder, best.el);
    else nav.insertBefore(st.placeholder, best.el.nextSibling);
  }
}

async function onFolderNavDragEnd() {
  if (!folderNavDragState) return;
  const st = folderNavDragState;
  folderNavDragState = null;
  document.removeEventListener('mousemove', onFolderNavDragMove);
  document.removeEventListener('mouseup', onFolderNavDragEnd);
  document.body.classList.remove('is-folder-dragging');

  const { el, placeholder, isDragging } = st;
  if (!isDragging) return;

  el.style.position = '';
  el.style.zIndex = '';
  el.style.pointerEvents = '';
  el.style.opacity = '';
  el.style.boxShadow = '';
  el.style.cursor = '';
  el.style.width = '';
  el.style.top = '';
  el.style.left = '';

  const nav = $('folderNav');
  if (!nav || !placeholder || !placeholder.parentElement) {
    st.parent.insertBefore(el, st.nextSibling);
    return;
  }
  // 放回占位符位置，收集顺序，静默持久化
  nav.insertBefore(el, placeholder);
  nav.removeChild(placeholder);
  const ids = [...nav.querySelectorAll(':scope > .folder-nav-item:not(.preset):not(.folder-nav-create)')]
    .map((n) => n.dataset.folderId);
  api('/api/folders/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).then((res) => {
    if (res.ok === false) {
      uiAlert(res.error || '排序失败');
      refreshBanks();
      return;
    }
    if (res && Array.isArray(res.folders)) foldersCache = res.folders;
  });
}

let shareBankTarget = null;
let notifCache = [];

function updateNotifBadge(n) {
  const bell = $('notifBellBtn');
  const badge = $('notifBadge');
  if (!bell || !badge) return;
  const count = Number(n) || 0;
  bell.hidden = false;
  if (count > 0) {
    badge.hidden = false;
    badge.textContent = count > 99 ? '99+' : String(count);
  } else {
    badge.hidden = true;
  }
}

async function openShareBankModal(bank) {
  shareBankTarget = bank;
  const title = $('bankShareTitle');
  if (title) title.textContent = `分享「${bank.name}」`;
  const list = $('bankShareUserList');
  list.innerHTML = '<p class="hint">加载账号…</p>';
  $('bankShareModal').hidden = false;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(true);
  const res = await api('/api/share/targets');
  if (res.ok === false) {
    list.innerHTML = `<p class="hint">${escapeHtml(res.error || '加载失败')}</p>`;
    return;
  }
  const users = res.users || [];
  if (!users.length) {
    list.innerHTML = '<p class="hint">暂无其他账号可分享。可用 add_user.py 开号后再试。</p>';
    return;
  }
  list.innerHTML = users.map((u) => (
    `<label class="share-user-row">` +
    `<input type="checkbox" name="shareUser" value="${escapeHtml(u)}">` +
    `<span>${escapeHtml(u)}</span>` +
    `</label>`
  )).join('');
}

function closeShareBankModal() {
  $('bankShareModal').hidden = true;
  shareBankTarget = null;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(false);
}

async function submitShareBank() {
  if (!shareBankTarget) return;
  const checked = [...document.querySelectorAll('#bankShareUserList input[name="shareUser"]:checked')]
    .map((el) => el.value);
  if (!checked.length) {
    await uiAlert('请至少选择一个账号');
    return;
  }
  const res = await api('/api/banks/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_id: shareBankTarget.id, to_users: checked }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '分享失败');
    return;
  }
  const okN = (res.shared || []).length;
  const failN = (res.failed || []).length;
  let msg = `已分享给 ${okN} 人`;
  if (failN) {
    msg += `；${failN} 人失败：` + (res.failed || []).map((f) => `${f.user}（${f.error}）`).join('、');
  }
  closeShareBankModal();
  await uiAlert(msg);
}

async function openNotifModal() {
  const list = $('notifList');
  list.innerHTML = '<p class="hint">加载中…</p>';
  $('notifModal').hidden = false;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(true);
  const res = await api('/api/notifications');
  if (res.ok === false) {
    list.innerHTML = `<p class="hint">${escapeHtml(res.error || '加载失败')}</p>`;
    return;
  }
  updateNotifBadge(res.unread || 0);
  const notes = res.notifications || [];
  notifCache = notes;
  if (!notes.length) {
    list.innerHTML = '<p class="hint">暂无通知</p>';
    return;
  }
  list.innerHTML = notes.map((n) => {
    const kind = n.type === 'release' ? 'release' : 'share';
    const tag = kind === 'release' ? '更新' : '分享';
    return (
      `<button type="button" class="notif-item${n.read ? '' : ' is-unread'}" ` +
      `data-nid="${escapeHtml(n.id)}" data-kind="${kind}" ` +
      `data-bank="${escapeHtml(n.bank_id || '')}" data-version="${escapeHtml(n.version || '')}">` +
      `<div class="notif-top"><span class="notif-tag notif-tag-${kind}">${tag}</span>` +
      `<span class="notif-meta">${escapeHtml(n.created_at || '')}</span></div>` +
      `<div class="notif-msg">${escapeHtml(n.message || '')}</div>` +
      `</button>`
    );
  }).join('');
}

function closeNotifModal() {
  $('notifModal').hidden = true;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(false);
}

function closeReleaseModal() {
  const m = $('releaseModal');
  if (m) m.hidden = true;
  if (typeof setModalScrollLock === 'function' && $('notifModal') && !$('notifModal').hidden) {
    /* keep lock while inbox still open */
  } else if (typeof setModalScrollLock === 'function') {
    setModalScrollLock(false);
  }
}

async function openReleaseDetail(noteOrVersion) {
  let release = null;
  if (noteOrVersion && typeof noteOrVersion === 'object') {
    release = {
      version: noteOrVersion.version,
      title: noteOrVersion.title,
      summary: noteOrVersion.summary,
      bullets: noteOrVersion.bullets || [],
      date: noteOrVersion.created_at || noteOrVersion.date,
    };
    if (!(release.bullets && release.bullets.length) && release.version) {
      const res = await api('/api/releases/' + encodeURIComponent(release.version));
      if (res && res.ok !== false && res.release) release = res.release;
    }
  } else if (noteOrVersion) {
    const res = await api('/api/releases/' + encodeURIComponent(noteOrVersion));
    if (res.ok === false) {
      await uiAlert(res.error || '加载失败');
      return;
    }
    release = res.release;
  }
  if (!release) {
    await uiAlert('没有该版本说明');
    return;
  }
  const title = $('releaseModalTitle');
  const summary = $('releaseModalSummary');
  const bullets = $('releaseModalBullets');
  const dateEl = $('releaseModalDate');
  if (title) title.textContent = release.title || (`V${release.version}`);
  if (summary) {
    summary.textContent = release.summary || '';
    summary.hidden = !release.summary;
  }
  if (bullets) {
    const lines = release.bullets || [];
    bullets.innerHTML = lines.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  }
  if (dateEl) {
    const d = release.date || release.created_at || '';
    dateEl.textContent = d ? `发布：${d}` : '';
    dateEl.hidden = !d;
  }
  $('releaseModal').hidden = false;
  if (typeof setModalScrollLock === 'function') setModalScrollLock(true);
}

async function onNotifItemClick(btn) {
  const nid = btn.getAttribute('data-nid');
  const kind = btn.getAttribute('data-kind') || 'share';
  if (!nid) return;

  if (btn.classList.contains('is-unread')) {
    const res = await api('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [nid] }),
    });
    if (res && res.ok !== false) {
      btn.classList.remove('is-unread');
      updateNotifBadge(res.unread || 0);
    }
  }

  if (kind === 'release') {
    const version = btn.getAttribute('data-version') || '';
    const note = notifCache.find((n) => String(n.id) === String(nid));
    await openReleaseDetail(note || version);
  }
}

async function markAllNotificationsRead() {
  const res = await api('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  if (res.ok === false) {
    await uiAlert(res.error || '操作失败');
    return;
  }
  updateNotifBadge(res.unread || 0);
  document.querySelectorAll('#notifList .notif-item.is-unread').forEach((el) => {
    el.classList.remove('is-unread');
  });
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

function openMoveBankModal(bank) { /* 已废弃：移动题库统一走拖拽（左栏文件夹目标），弹窗移除 */ }

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
  // 仅手机抽屉：切库后收起；桌面/平板侧栏由用户手动开关
  if (isMobilePortrait()) setBankSidebarOpen(false);
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
  if (sub) {
    if (mode === 'sa') {
      sub.textContent = '简答';
      sub.hidden = false;
    } else {
      sub.textContent = '';
      sub.hidden = true;
    }
  }

  if ($('stats')) $('stats').hidden = mode !== 'kill';
  if ($('saStats')) $('saStats').hidden = mode !== 'sa';
  if ($('saControls')) $('saControls').hidden = mode !== 'sa';
  if ($('killControls')) $('killControls').hidden = mode !== 'kill';
  if ($('killSlot')) $('killSlot').hidden = mode !== 'kill';
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
  if (!fill) return;
  const total = s && s.total > 0 ? s.total : 0;
  const killed = s && s.killed > 0 ? s.killed : 0;
  const pct = total > 0 ? (killed / total) * 100 : 0;
  fill.style.width = total > 0 ? pct.toFixed(1) + '%' : '0%';

  const key = `${currentBankId || ''}:${(s && s.run_index) || 1}`;
  if (killBarSyncKey !== key) {
    killBarSyncKey = key;
    killBarFiredTiers = new Set();
    KILL_BAR_TIERS.forEach((t) => {
      if (pct + 1e-6 >= t) killBarFiredTiers.add(t);
    });
    killBarPrevPct = pct;
    return;
  }

  // 重置进度等：进度回退，重新对齐已达档（不播彩蛋）
  if (pct + 1e-6 < killBarPrevPct - 0.05) {
    killBarFiredTiers = new Set();
    KILL_BAR_TIERS.forEach((t) => {
      if (pct + 1e-6 >= t) killBarFiredTiers.add(t);
    });
    killBarPrevPct = pct;
    return;
  }

  const crossed = [];
  for (const t of KILL_BAR_TIERS) {
    if (killBarPrevPct + 1e-6 < t && pct + 1e-6 >= t && !killBarFiredTiers.has(t)) {
      crossed.push(t);
    }
  }
  killBarPrevPct = pct;
  if (!crossed.length) return;

  const tier = crossed[crossed.length - 1];
  crossed.forEach((t) => killBarFiredTiers.add(t));
  if (tier === 100) {
    // 100% 走独立过场，不在条上播普通短句彩蛋
    pendingKillCheer = { tier: 100, promise: null };
    return;
  }
  if (window.LykieFx && typeof LykieFx.killTierCheer === 'function') {
    pendingKillCheer = { tier, promise: LykieFx.killTierCheer(tier) };
  }
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
  if (!on) document.body.classList.remove('settle-arriving');
  const stage = $('studyStage');
  if (stage) stage.hidden = !!on;
  if (!on && studyMode === 'kill') {
    if ($('killSlot')) $('killSlot').hidden = false;
    if ($('progress')) $('progress').hidden = false;
  }
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

async function showSettle(runIndex, opts) {
  const arrive = !!(opts && opts.arrive);
  current = null;
  submitted = false;
  setSettleView(true);
  setStudyCardVisible(false);
  if ($('studyHost') && studyMode === 'kill') $('studyHost').hidden = true;
  if ($('killBtn')) $('killBtn').hidden = true;
  if ($('killSlot')) $('killSlot').hidden = true;
  hideAllBtns();
  const empty = $('emptyState');
  empty.hidden = false;
  document.body.classList.toggle('settle-arriving', arrive);
  const hasData = !!(opts && opts.data);
  if (!hasData) empty.innerHTML = '<p class="settle-loading">结算生成中…</p>';
  try {
    const q = runIndex != null ? `?run=${runIndex}` : '';
    const data = hasData ? opts.data : await api('/api/settle' + q);
    settleCache = data;
    settleRunIndex = data.run_index;
    empty.innerHTML = renderSettleHtml(data);
    const root = empty.querySelector('.settle');
    if (root && arrive) {
      root.classList.add('settle-arrive');
      const clearArrive = () => {
        document.body.classList.remove('settle-arriving');
        root.classList.remove('settle-arrive');
        root.removeEventListener('animationend', clearArrive);
      };
      root.addEventListener('animationend', clearArrive);
      window.setTimeout(clearArrive, 1300);
    } else {
      document.body.classList.remove('settle-arriving');
    }
    bindSettleUi(empty, data);
  } catch (e) {
    console.error(e);
    document.body.classList.remove('settle-arriving');
    empty.innerHTML =
      '<p>全部斩完</p><p class="hint">结算加载失败，仍可点「重置进度」再来一轮</p>';
  }
}

/** 斩满 100%：清题卡 → 条上移 → 远去将近结束时再播结算 */
async function runKillHundredOutro() {
  current = null;
  submitted = false;
  hideAllBtns();
  setStudyCardVisible(false);
  if ($('studyHost')) $('studyHost').hidden = true;
  if ($('progress')) $('progress').hidden = true;
  if ($('killControls')) $('killControls').hidden = true;

  const settlePromise = api('/api/settle')
    .then((data) => ({ ok: true, data }))
    .catch((e) => ({ ok: false, error: e }));

  if (window.LykieFx && typeof LykieFx.playKillHundredTransition === 'function') {
    await LykieFx.playKillHundredTransition({
      prepare: () => settlePromise,
      onSettleStart: (packed) => {
        if (packed && packed.ok) {
          showSettle(packed.data.run_index, { arrive: true, data: packed.data });
        } else {
          if (packed && packed.error) console.error(packed.error);
          showSettle(null, { arrive: true });
        }
      },
    });
    return;
  }

  const packed = await settlePromise;
  if (packed.ok) await showSettle(packed.data.run_index, { arrive: true, data: packed.data });
  else await showSettle(null, { arrive: true });
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
  if ($('killSlot') && studyMode === 'kill') $('killSlot').hidden = false;
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
  const runIndex = current.run_index != null ? current.run_index : 1;
  if (runAc > 0) {
    const rate = Math.round((runCc / runAc) * 100);
    meta.textContent = `本轮已答 ${runAc} 次 · 正确率 ${rate}%`;
    meta.hidden = false;
  } else if (runIndex >= 2) {
    meta.textContent = '本轮尚未作答 · 答对一次即可斩（答错需再对才能斩）';
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
  if (pendingKillCheer && pendingKillCheer.tier === 100) {
    pendingKillCheer = null;
    await runKillHundredOutro();
    return;
  }
  if (pendingKillCheer && pendingKillCheer.promise) {
    // 非 100% 不挡下一题；彩蛋自行淡出
  }
  pendingKillCheer = null;
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
// folderCreateBtn 已删除：新建文件夹入口在左栏底部（folder-nav-create）
if ($('bankShareModalClose')) $('bankShareModalClose').onclick = () => closeShareBankModal();
if ($('bankShareCancel')) $('bankShareCancel').onclick = () => closeShareBankModal();
if ($('bankShareSubmit')) $('bankShareSubmit').onclick = () => submitShareBank();
if ($('bankShareModal')) {
  $('bankShareModal').addEventListener('click', (e) => {
    if (e.target === $('bankShareModal')) closeShareBankModal();
  });
}
if ($('notifBellBtn')) $('notifBellBtn').onclick = () => openNotifModal();
if ($('notifModalClose')) $('notifModalClose').onclick = () => closeNotifModal();
if ($('notifMarkAllBtn')) $('notifMarkAllBtn').onclick = () => markAllNotificationsRead();
if ($('notifModal')) {
  $('notifModal').addEventListener('click', (e) => {
    if (e.target === $('notifModal')) closeNotifModal();
  });
}
if ($('releaseModalClose')) $('releaseModalClose').onclick = () => closeReleaseModal();
if ($('releaseModal')) {
  $('releaseModal').addEventListener('click', (e) => {
    if (e.target === $('releaseModal')) closeReleaseModal();
  });
}

// ==================== 管理员建号（仅 LiZF 有入口） ====================
function openAdminAccModal() {
  const modal = $('adminAccModal');
  if (!modal) return;
  ['adminAccName', 'adminAccPwd', 'adminAccPwd2'].forEach(id => { $(id).value = ''; });
  const err = $('adminAccErr');
  err.hidden = true;
  err.textContent = '';
  modal.hidden = false;
  $('adminAccName').focus();
}

function closeAdminAccModal() {
  const modal = $('adminAccModal');
  if (!modal) return;
  modal.hidden = true;
  ['adminAccName', 'adminAccPwd', 'adminAccPwd2'].forEach(id => { $(id).value = ''; });
  const err = $('adminAccErr');
  err.hidden = true;
  err.textContent = '';
}

function showAdminAccErr(msg) {
  const err = $('adminAccErr');
  if (!err) return;
  err.textContent = msg;
  err.hidden = false;
}

async function submitAdminAcc() {
  const name = $('adminAccName').value.trim();
  const pwd = $('adminAccPwd').value;
  const pwd2 = $('adminAccPwd2').value;
  if (!name) { showAdminAccErr('请填用户名'); return; }
  if (!pwd) { showAdminAccErr('请填密码'); return; }
  if (pwd !== pwd2) { showAdminAccErr('两次密码不一致'); return; }
  const submitBtn = $('adminAccSubmit');
  submitBtn.disabled = true;
  try {
    const data = await api('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: pwd }),
    });
    if (!data.ok) {
      showAdminAccErr(data.error || '创建失败');
      return;
    }
    closeAdminAccModal();
    await uiAlert('已创建账号：' + data.created);
  } catch (e) {
    showAdminAccErr('网络异常，请重试');
  } finally {
    submitBtn.disabled = false;
  }
}

if ($('adminAccBtn')) $('adminAccBtn').onclick = () => openAdminAccModal();
if ($('adminAccClose')) $('adminAccClose').onclick = () => closeAdminAccModal();
if ($('adminAccCancel')) $('adminAccCancel').onclick = () => closeAdminAccModal();
if ($('adminAccSubmit')) $('adminAccSubmit').onclick = () => submitAdminAcc();
if ($('adminAccModal')) {
  $('adminAccModal').addEventListener('click', (e) => {
    if (e.target === $('adminAccModal')) closeAdminAccModal();
  });
  ['adminAccName', 'adminAccPwd', 'adminAccPwd2'].forEach(id => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAdminAcc();
    });
  });
}
if ($('notifList')) {
  $('notifList').addEventListener('click', (e) => {
    const btn = e.target.closest('.notif-item[data-nid]');
    if (btn) onNotifItemClick(btn);
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
      const logBtn = document.createElement('button');
      logBtn.type = 'button';
      logBtn.className = 'lykie-fb-btn';
      logBtn.title = '记给作者（带现场，不进模型）';
      logBtn.textContent = '记';
      logBtn.onclick = (e) => {
        e.stopPropagation();
        openLykieAuthorLog(div);
      };
      actions.appendChild(logBtn);
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

async function wipeLykieMemory() {
  if (window.StoryRunner && window.StoryRunner.isActive()) {
    await uiAlert('开场播放中不能清空记忆');
    return;
  }
  if (!await uiConfirm(
    '将清空本账号 Lykie 记住的事实、对话、对此人的印象（过节）和名字。口吻、监督、作者日志是全站共用的角色塑造，不会清掉。感情层钉钉保留。继续？',
    { title: '清空记忆', okText: '清空', danger: true }
  )) {
    return;
  }
  clearChatBatchTimer();
  chatBatchQueue = [];
  chatBatchStartedAt = 0;
  showChatBatchWaiting(false);
  clearPendingQuestionCard();
  try {
    const res = await fetchAuth('/api/lykie/memory_clear', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '清空失败');
      return;
    }
    restorePanelLog(data.panel_log || []);
    stopOpeningNudge();
    await refreshLykieState();
  } catch (e) {
    await uiAlert('网络错误');
  }
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
  clearPendingQuestionCard();
  try {
    const res = await fetchAuth('/api/lykie/chat_reset_opening', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '清空失败');
      return;
    }
    restorePanelLog(data.panel_log || []);
    appendLykieBubble('system', '已清空到开场结束，可重新测自由聊');
    stopOpeningNudge();
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

let authorLogTargetEl = null;
let authorLogCandidates = [];
let authorLogStart = 0;
let authorLogEnd = 0;
let authorLogPick = null;

function authorLogTalkRows() {
  const RESET = /清空到开场|记忆已清空|—— 开场结束 ——/;
  const rows = [];
  let sessionFrom = 0;
  serializePanelLog().forEach((m, i) => {
    const text = (m.text || '').trim();
    if (RESET.test(text)) sessionFrom = rows.length;
    if (m.role !== 'user' && m.role !== 'assistant') return;
    if (!text) return;
    if (text.startsWith('已记下现场') || text.startsWith('已记住')) return;
    rows.push({ role: m.role, text });
  });
  return { rows, sessionFrom };
}

function setAuthorLogRange(start, end) {
  const n = authorLogCandidates.length;
  if (!n) {
    authorLogStart = 0;
    authorLogEnd = -1;
    paintAuthorLogRange();
    return;
  }
  if (start >= n) {
    authorLogStart = n;
    authorLogEnd = n - 1;
    paintAuthorLogRange();
    return;
  }
  authorLogStart = Math.max(0, Math.min(start, n - 1));
  authorLogEnd = Math.max(0, Math.min(end, n - 1));
  if (authorLogEnd < authorLogStart) {
    const t = authorLogStart;
    authorLogStart = authorLogEnd;
    authorLogEnd = t;
  }
  paintAuthorLogRange();
}

function paintAuthorLogRange() {
  const host = $('lykieAuthorLogRange');
  const hint = $('lykieAuthorLogRangeHint');
  if (!host) return;
  host.innerHTML = authorLogCandidates.map((m, i) => {
    const who = m.role === 'user' ? '你' : '她';
    const cls = [
      'lykie-log-row',
      (i >= authorLogStart && i <= authorLogEnd) ? 'is-in' : '',
      i === authorLogStart ? 'is-start' : '',
      i === authorLogEnd ? 'is-end' : '',
    ].filter(Boolean).join(' ');
    const preview = escapeHtml(m.text.length > 72 ? m.text.slice(0, 72) + '…' : m.text);
    return `<button type="button" class="${cls}" data-i="${i}"><span class="lykie-log-who">${who}</span>${preview}</button>`;
  }).join('');
  host.querySelectorAll('.lykie-log-row').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.getAttribute('data-i'));
      if (authorLogPick == null) {
        authorLogPick = i;
        setAuthorLogRange(i, i);
        if (hint) hint.textContent = '再点一句作为结尾';
        return;
      }
      setAuthorLogRange(authorLogPick, i);
      authorLogPick = null;
      if (hint) hint.textContent = `已选 ${authorLogEnd - authorLogStart + 1} 句`;
    };
  });
  if (hint && authorLogPick == null) {
    const count = authorLogEnd >= authorLogStart ? authorLogEnd - authorLogStart + 1 : 0;
    hint.textContent = authorLogCandidates.length
      ? (count ? `已选 ${count} 句（可点两句改范围）` : '未选对话（点两句圈范围，或点本次全部）')
      : '没有可圈的对话';
  }
}

function openLykieAuthorLog(assistantEl) {
  authorLogTargetEl = assistantEl;
  authorLogPick = null;
  const packed = authorLogTalkRows();
  authorLogCandidates = packed.rows;
  setAuthorLogRange(packed.sessionFrom, Math.max(0, authorLogCandidates.length - 1));
  const modal = $('lykieAuthorLogModal');
  if (!modal) return;
  const note = $('lykieAuthorLogNote');
  if (note) note.value = '';
  modal.hidden = false;
  if (note) note.focus();
}

function closeLykieAuthorLog() {
  const modal = $('lykieAuthorLogModal');
  if (modal) modal.hidden = true;
  authorLogTargetEl = null;
  authorLogPick = null;
}

function selectedAuthorLogScene() {
  if (!authorLogCandidates.length || authorLogEnd < authorLogStart) return [];
  return authorLogCandidates.slice(authorLogStart, authorLogEnd + 1);
}

async function submitLykieAuthorLog() {
  const target = authorLogTargetEl;
  const note = ($('lykieAuthorLogNote') && $('lykieAuthorLogNote').value || '').trim();
  const btn = $('lykieAuthorLogSubmit');
  if (btn) btn.disabled = true;
  try {
    const res = await fetchAuth('/api/lykie/author_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note,
        user_said: target ? findPrevUserText(target) : '',
        focus_text: target ? collectBurstText(target) : '',
        scene: selectedAuthorLogScene(),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '记下失败');
      return;
    }
    closeLykieAuthorLog();
    appendLykieBubble('system', '已记下现场（作者日志，不进模型）');
    await refreshLykieState();
  } catch (e) {
    await uiAlert('网络错误');
  } finally {
    if (btn) btn.disabled = false;
  }
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
    clearPendingQuestionCard();

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

const BANK_SIDEBAR_KEY = 'lykieBankSidebarOpen';

function isBankSidebarOpen() {
  if (isMobilePortrait()) {
    return document.body.classList.contains('bank-drawer-open');
  }
  return !document.body.classList.contains('bank-sidebar-collapsed');
}

/** 桌面：收起/展开侧栏；手机：抽屉开合。桌面偏好写入 localStorage。 */
function setBankSidebarOpen(open) {
  const next = !!open;
  if (isMobilePortrait()) {
    const was = document.body.classList.contains('bank-drawer-open');
    document.body.classList.toggle('bank-drawer-open', next);
    document.body.classList.remove('bank-sidebar-collapsed');
    if (next && !was && window.LykieSfx) LykieSfx.onUiOpen();
    return;
  }
  const wasOpen = !document.body.classList.contains('bank-sidebar-collapsed');
  document.body.classList.toggle('bank-sidebar-collapsed', !next);
  document.body.classList.remove('bank-drawer-open');
  try {
    localStorage.setItem(BANK_SIDEBAR_KEY, next ? '1' : '0');
  } catch (e) { /* ignore */ }
  if (next && !wasOpen && window.LykieSfx) LykieSfx.onUiOpen();
}

/** @deprecated 兼容旧调用名 */
function setBankDrawerOpen(open) {
  setBankSidebarOpen(open);
}

/** 开场剧情等用户主动打开 Lykie 再播，避免一进站就盖住刷题。 */
function setLykiePanelOpen(open) {
  const panel = $('lykiePanel');
  if (!panel) return;
  const next = !!open;
  const wasOpen = !panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed', !next);
  try {
    localStorage.setItem('lykiePanelOpen', next ? '1' : '0');
  } catch (e) { /* ignore */ }
  if (next && !wasOpen && window.LykieSfx) LykieSfx.onUiOpen();
  // 旧「期末错接」开场已产品断开，不再自动播 fragment_01
}

async function refreshLykieState() {
  const status = $('lykieStatus');
  try {
    const data = await api('/api/lykie/state');
    lykieConfigured = !!data.configured;
    lastPanelLog = Array.isArray(data.panel_log) ? data.panel_log : lastPanelLog;
    syncLykieStageSelect(data);
    applyOpeningFromState(data, { restartTimer: false });
    if (!status) return data;
    if (lykieConfigured) {
      const bits = (data.profile && data.profile.bits) || [];
      const archive = data.profile && data.profile.loaded
        ? (`档案${data.profile.strict ? '(严)' : ''} ${bits.length ? bits.join('·') : '已接入'}`)
        : '档案缺失';
      const layer = data.relationship_label || '认识但不熟悉';
      let extraLayer = '';
      if (data.opening && data.opening.active) {
        const beat = data.opening.beat || '';
        const beatLabel = ({
          awaiting: '等回',
          nudged: '已催',
          stalled: '不再催',
          realized: '已察觉',
        })[beat] || beat;
        extraLayer = ` · 开场1·${beatLabel}`;
        const by = data.opening.realized_by && data.opening.realized_by.label;
        if (beat === 'realized' && by) extraLayer += '·' + by;
      }
      status.textContent =
        `已连接 · ${data.model || 'model'} · ${archive} · 层·${layer}${extraLayer} · 日常 ${data.fact_count || 0} · 口吻 ${data.style_note_count || 0}（共用） · 监督 ${data.correction_count || 0}（共用） · 日志 ${data.author_log_count || 0}（共用） · 印象 ${Number(data.portrait_offense_count) ? (data.portrait_unapologized ? '有过节·未道歉' : (data.portrait_warned ? '有过节·已警告' : '有过节')) : '无'}`;
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

function syncLykieStageSelect(data) {
  const sel = $('lykieStageSelect');
  if (!sel) return;
  const list = data && data.relationship_stages;
  if (Array.isArray(list) && list.length) {
    const cur = sel.value;
    sel.innerHTML = list.map((it) => (
      `<option value="${escapeHtml(it.id)}">${escapeHtml(it.label)}</option>`
    )).join('');
    sel.value = cur;
  }
  const stage = (data && (data.relationship_stage || (data.flags && data.flags.relationship_stage))) || 'acquainted';
  if ([...sel.options].some((o) => o.value === stage)) sel.value = stage;
}

let pinningStage = false;
async function onLykieStageChange() {
  const sel = $('lykieStageSelect');
  if (!sel || pinningStage) return;
  const stage = sel.value;
  pinningStage = true;
  try {
    const res = await fetchAuth('/api/lykie/relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '切层失败');
      await refreshLykieState();
      return;
    }
    appendLykieBubble('system', `（作者）已钉在${data.label || stage}`);
    applyOpeningFromState(data);
    await refreshLykieState();
  } catch (e) {
    await uiAlert('切层失败');
    await refreshLykieState();
  } finally {
    pinningStage = false;
  }
}

let openingNudgeTimer = null;
let openingNudgeBusy = false;
let openingWatch = null;

function stopOpeningNudge() {
  if (openingNudgeTimer) {
    clearTimeout(openingNudgeTimer);
    openingNudgeTimer = null;
  }
}

function applyOpeningFromState(data, opts) {
  const opening = (data && data.opening) || null;
  openingWatch = opening;
  if (!opening || !opening.active || !opening.waiting) {
    stopOpeningNudge();
    return;
  }
  if (opts && opts.restartTimer === false) {
    if (!openingNudgeTimer) scheduleOpeningNudge(opening);
    return;
  }
  scheduleOpeningNudge(opening);
}

function scheduleOpeningNudge(opening) {
  stopOpeningNudge();
  if (!opening || !opening.waiting) return;
  const ms = Math.max(8, Number(opening.nudge_sec) || 45) * 1000;
  openingNudgeTimer = setTimeout(() => maybeOpeningNudge(), ms);
}

function onOpeningComposeChanged() {
  if (!openingWatch || !openingWatch.waiting) return;
  if (lykieInputHasText()) {
    stopOpeningNudge();
    return;
  }
  scheduleOpeningNudge(openingWatch);
}

async function maybeOpeningNudge() {
  if (!openingWatch || !openingWatch.waiting) return;
  if (lykieInputHasText() || chatBatchQueue.length || lykieBusy) {
    openingNudgeTimer = setTimeout(() => maybeOpeningNudge(), 3000);
    return;
  }
  await fireOpeningNudge();
}

async function fireOpeningNudge() {
  if (openingNudgeBusy) return;
  openingNudgeBusy = true;
  stopOpeningNudge();
  try {
    const res = await fetchAuth('/api/lykie/opening/nudge', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) return;
    const bubbles = Array.isArray(data.bubbles) ? data.bubbles : [];
    for (const b of bubbles) {
      const text = (b && (b.text || b.content)) || '';
      if (text) appendLykieBubble('assistant', text, { noFeedback: true });
    }
    if (data.stopped) {
      appendLykieBubble('system', '（作者）她不再催了。关系停在开局。你再主动找她，她会起疑。');
    }
    await persistPanelLog();
    applyOpeningFromState(data);
    await refreshLykieState();
  } catch (e) {
    /* ignore */
  } finally {
    openingNudgeBusy = false;
  }
}

async function startOpeningNodeTest() {
  if (window.StoryRunner && window.StoryRunner.isActive()) {
    await uiAlert('旧开场播放中，先停掉再测节点');
    return;
  }
  if (!await uiConfirm(
    '测开场节点 1：清空本面板对话，钉在开局，由她发出定稿第一句。口吻/监督不清。继续？',
    { title: '测开场', okText: '开始' }
  )) {
    return;
  }
  clearChatBatchTimer();
  chatBatchQueue = [];
  showChatBatchWaiting(false);
  clearPendingQuestionCard();
  stopOpeningNudge();
  try {
    const res = await fetchAuth('/api/lykie/opening/start', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      await uiAlert(data.error || '无法开始开场');
      return;
    }
    setLykiePanelOpen(true);
    restorePanelLog(data.panel_log || []);
    syncLykieStageSelect(data);
    applyOpeningFromState(data);
    await refreshLykieState();
  } catch (e) {
    await uiAlert('网络错误');
  }
}

function getLastLykieReply() {
  const box = $('lykieMessages');
  if (!box) return '';
  const bubbles = box.querySelectorAll('.lykie-bubble.assistant:not(.pending)');
  if (!bubbles.length) return '';
  return bubbleText(bubbles[bubbles.length - 1]);
}

function formatQuestionStemMd(card) {
  if (!card) return '';
  const stem = String(card.stem || '').trim();
  if (!stem) return '';
  const lines = ['（题）', stem];
  const opts = Array.isArray(card.options) ? card.options : [];
  opts.forEach((o, i) => {
    const t = String(o || '').trim();
    if (!t) return;
    if (/^[A-Ha-h][.．、)]/.test(t)) lines.push(t);
    else lines.push(String.fromCharCode(65 + i) + '. ' + t);
  });
  return lines.join('\n');
}

function sanitizeQuestionCard(card) {
  if (!card) return null;
  const stem = String(card.stem || '').trim();
  const id = String(card.id || '').trim();
  if (!stem && !id) return null;
  const options = Array.isArray(card.options)
    ? card.options.map((x) => String(x || '')).filter(Boolean)
    : [];
  return { id, type: String(card.type || ''), stem, options };
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
    };
  }
  if (!current) return null;
  return {
    id: current.id,
    type: current.type,
    stem: current.stem,
    options: current.options || [],
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

function appendThinkDebug(think) {
  if (!think || typeof think !== 'object') return;
  const box = $('lykieMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'lykie-think-debug';
  const action = think.action || 'thin';
  const why = String(think.why || '').trim();
  const lookup = Array.isArray(think.lookup) ? think.lookup : [];
  let lookLine = '查：无';
  if (lookup.length) {
    lookLine = '查：' + lookup.map((it) => {
      const title = it.title || it.need || '';
      const empty = it.empty ? '空' : '有';
      return `${title}(${empty})`;
    }).join(' · ');
  }
  const extra = [];
  if (think.saw_question) extra.push('看见题');
  if (think.willing) extra.push('肯讲');
  else if (think.why_not_teach) extra.push(String(think.why_not_teach));
  if (think.busy) extra.push('忙闲 ' + think.busy);
  if (think.taught_today != null && think.taught_today !== '') extra.push('今日已教 ' + think.taught_today);
  if (think.begging) extra.push('恳求');
  if (think.realized_not_ai) {
    extra.push('察觉非AI：' + (think.opening_reason_label || think.opening_cue || '本轮'));
  } else if (think.opening_reason_label || think.opening_cue) {
    extra.push('开场线索 ' + (think.opening_reason_label || think.opening_cue));
  }
  div.textContent = `想：${action}`
    + (why ? `\n${why}` : '')
    + `\n${lookLine}`
    + (extra.length ? `\n${extra.join(' · ')}` : '');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
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
let pendingQuestionCard = null;
let pendingCardQueued = false;

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
  if (!msg && !pendingQuestionCard) return;
  setLykiePanelOpen(true);
  ensurePendingCardQueued();
  if (!msg) return;
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
  onOpeningComposeChanged();
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
  if (!chatBatchQueue.length && !pendingQuestionCard) {
    showChatBatchWaiting(false);
    return;
  }
  if (lykieInputHasText()) return;
  if (lykieBusy) {
    chatBatchTimer = setTimeout(() => flushChatBatch(), 400);
    return;
  }
  ensurePendingCardQueued();
  showChatBatchWaiting(false);
  const batch = chatBatchQueue.splice(0, chatBatchQueue.length);
  const card = pendingQuestionCard;
  pendingQuestionCard = null;
  pendingCardQueued = false;
  renderPendingQuestionChip();
  if (!batch.length) return;
  await sendLykie('chat', batch, card);
}

async function sendLykie(mode, messageOrBatch, questionCard) {
  if (lykieBusy) return;

  let batch = [];
  if (Array.isArray(messageOrBatch)) {
    batch = messageOrBatch.map((s) => String(s || '').trim()).filter(Boolean);
  } else {
    const t = String(messageOrBatch || '').trim();
    if (t) batch = [t];
  }

  if ((mode === 'chat') && !batch.length) return;

  setLykiePanelOpen(true);
  lykieBusy = true;
  const sendBtn = $('lykieSendBtn');
  const askBtn = $('askLykieBtn');
  const saAskBtn = $('saAskLykieBtn');
  if (sendBtn) sendBtn.disabled = true;
  if (askBtn) askBtn.disabled = true;
  if (saAskBtn) saAskBtn.disabled = true;

  // chat 连发已在 queue 时画出用户气泡
  if (mode !== 'chat') {
    lastUserUtterance = batch[0] || '';
    appendLykieBubble('user', lastUserUtterance);
  }

  const pending = appendLykieBubble('assistant', '……', { noFeedback: true, skipPersist: true, noPing: true });
  if (pending) pending.classList.add('pending');

  try {
    const body = {
      mode,
      messages: batch,
      message: batch[0] || '',
      question_card: mode === 'chat' ? (sanitizeQuestionCard(questionCard) || null) : null,
      last_reply: null,
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
      if (spoken && !data.silent) {
        await appendLykieReplyBurst(spoken);
      } else if (data.silent || !spoken) {
        appendLykieSilenceBubble();
      }
      appendThinkDebug(data.think);
      appendProfileNotes(data.profile_notes);
      applyOpeningFromState(data);
      if (data.opening_just_realized) {
        const by = data.opening && data.opening.realized_by && data.opening.realized_by.label;
        appendLykieBubble(
          'system',
          '（作者）她察觉对方不太像 AI'
            + (by ? '：' + by : '')
            + '。关系仍停在开局。',
        );
      }
      if (data.relationship_dropped) {
        syncLykieStageSelect(data);
        appendLykieBubble(
          'system',
          `（作者）直攻，落到${data.relationship_label || data.relationship_dropped}`
        );
        await refreshLykieState();
      } else if ((data.facts_added && data.facts_added.length) ||
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
    const storyOn = !!(window.StoryRunner && window.StoryRunner.isActive());
    if (askBtn) askBtn.disabled = storyOn;
    if (saAskBtn) saAskBtn.disabled = storyOn;
    const input = $('lykieInput');
    if (input && mode === 'chat') {
      input.focus();
    }
    // 她回的时候用户又连发了 → 接着冲下一轮
    if (chatBatchQueue.length) scheduleChatBatchFlush();
  }
}

function onLykieSend() {
  const input = $('lykieInput');
  const text = input ? input.value.trim() : '';
  if (window.StoryRunner && window.StoryRunner.isActive()) {
    if (!text) return;
    window.StoryRunner.handleSend(text);
    return;
  }
  if (!text && !pendingQuestionCard) return;
  if (text) {
    queueChatMessage(text);
    return;
  }
  setLykiePanelOpen(true);
  ensurePendingCardQueued();
  scheduleChatBatchFlush();
}

function matchingUserBubbleForMd(md) {
  const box = $('lykieMessages');
  if (!box) return null;
  const users = [...box.querySelectorAll('.lykie-bubble.user')];
  for (let i = users.length - 1; i >= 0; i--) {
    if (bubbleText(users[i]).trim() === md) return users[i];
  }
  return null;
}

function renderPendingQuestionChip() {
  const el = $('lykiePendingCard');
  const preview = $('lykiePendingPreview');
  if (!el) return;
  if (!pendingQuestionCard) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const stem = String(pendingQuestionCard.stem || '').replace(/\s+/g, ' ').trim();
  if (preview) preview.textContent = stem.length > 48 ? stem.slice(0, 48) + '…' : stem;
}

function unqueuePendingCard() {
  if (!pendingCardQueued || !pendingQuestionCard) {
    pendingCardQueued = false;
    return;
  }
  const md = formatQuestionStemMd(pendingQuestionCard);
  const idx = chatBatchQueue.indexOf(md);
  if (idx >= 0) chatBatchQueue.splice(idx, 1);
  const el = matchingUserBubbleForMd(md);
  if (el) el.remove();
  pendingCardQueued = false;
}

function clearPendingQuestionCard() {
  unqueuePendingCard();
  pendingQuestionCard = null;
  renderPendingQuestionChip();
  if (!chatBatchQueue.length) {
    showChatBatchWaiting(false);
    clearChatBatchTimer();
  }
}

function ensurePendingCardQueued() {
  if (!pendingQuestionCard || pendingCardQueued) return;
  const md = formatQuestionStemMd(pendingQuestionCard);
  if (!md) return;
  lastUserUtterance = md;
  const box = $('lykieMessages');
  let inserted = false;
  if (box && chatBatchQueue.length) {
    const firstQueued = chatBatchQueue[0];
    const users = [...box.querySelectorAll('.lykie-bubble.user')];
    const anchor = [...users].reverse().find((el) => bubbleText(el).trim() === firstQueued);
    if (anchor) {
      const div = document.createElement('div');
      div.className = 'lykie-bubble user';
      div.textContent = md;
      box.insertBefore(div, anchor);
      inserted = true;
    }
  }
  if (!inserted) appendLykieBubble('user', md);
  else schedulePersistPanel();
  chatBatchQueue.unshift(md);
  pendingCardQueued = true;
  showChatBatchWaiting(true);
}

function hangCurrentQuestion() {
  if (window.StoryRunner && window.StoryRunner.isActive()) return;
  const payload = sanitizeQuestionCard(buildQuestionPayload());
  if (!payload || !String(payload.stem || '').trim()) {
    appendLykieBubble('system', '现在没有题目可放进对话');
    setLykiePanelOpen(true);
    return;
  }
  unqueuePendingCard();
  pendingQuestionCard = payload;
  pendingCardQueued = false;
  renderPendingQuestionChip();
  setLykiePanelOpen(true);
  if (chatBatchQueue.length) {
    ensurePendingCardQueued();
    scheduleChatBatchFlush();
  }
}

function onAskLykie() {
  hangCurrentQuestion();
}

if ($('lykieSendBtn')) $('lykieSendBtn').onclick = onLykieSend;
if ($('askLykieBtn')) $('askLykieBtn').onclick = onAskLykie;
if ($('saAskLykieBtn')) $('saAskLykieBtn').onclick = onAskLykie;
if ($('lykiePendingCardClear')) $('lykiePendingCardClear').onclick = () => {
  clearPendingQuestionCard();
};
if ($('lykieOpeningTestBtn')) $('lykieOpeningTestBtn').onclick = startOpeningNodeTest;
if ($('lykieClearChatBtn')) $('lykieClearChatBtn').onclick = clearChatToOpeningEnd;
if ($('lykieWipeMemoryBtn')) $('lykieWipeMemoryBtn').onclick = wipeLykieMemory;
if ($('lykieStageSelect')) $('lykieStageSelect').addEventListener('change', onLykieStageChange);
if ($('lykieAuthorLogToolBtn')) {
  $('lykieAuthorLogToolBtn').onclick = () => openLykieAuthorLog(null);
}
if ($('lykieAuthorLogCancel')) $('lykieAuthorLogCancel').onclick = closeLykieAuthorLog;
if ($('lykieAuthorLogSubmit')) $('lykieAuthorLogSubmit').onclick = submitLykieAuthorLog;
if ($('lykieAuthorLogAllBtn')) {
  $('lykieAuthorLogAllBtn').onclick = () => {
    authorLogPick = null;
    const packed = authorLogTalkRows();
    authorLogCandidates = packed.rows;
    setAuthorLogRange(packed.sessionFrom, Math.max(0, authorLogCandidates.length - 1));
  };
}
if ($('lykieAuthorLogModal')) {
  $('lykieAuthorLogModal').addEventListener('click', (e) => {
    if (e.target === $('lykieAuthorLogModal')) closeLykieAuthorLog();
  });
}
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
    setBankSidebarOpen(!isBankSidebarOpen());
  };
}
if ($('bankDrawerCloseBtn')) {
  $('bankDrawerCloseBtn').onclick = () => setBankSidebarOpen(false);
}
if ($('bankDrawerBackdrop')) {
  $('bankDrawerBackdrop').onclick = () => setBankSidebarOpen(false);
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

  // 桌面题库侧栏：记住收起/展开（默认展开）
  if (!isMobilePortrait()) {
    let sidebarOpen = true;
  try {
      const v = localStorage.getItem(BANK_SIDEBAR_KEY);
      if (v === '0') sidebarOpen = false;
      if (v === '1') sidebarOpen = true;
  } catch (e) { /* ignore */ }
    setBankSidebarOpen(sidebarOpen);
  }

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
    // 导入归属：刚导入的题库在当前用户文件夹上下文中不可见 → 移入该文件夹（未分类/归档上下文不动）
    const cur = String(currentFolderId);
    if (cur !== 'uncategorized' && cur !== 'archive') {
      const b = (lastBanksPayload || []).find((x) => String(x.id) === String(bankParam));
      if (b && !b.archived && String(b.folder_id || '') !== cur) {
        const res = await api('/api/banks/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: bankParam, folder_id: cur }),
        });
        if (res.ok !== false) {
          if (Array.isArray(res.banks)) lastBanksPayload = res.banks;
          if (Array.isArray(res.folders)) foldersCache = res.folders;
          renderBankList(lastBanksPayload);
          renderFolderNav();
        }
      }
    }
    try {
      params.delete('bank');
      const qs = params.toString();
      window.history.replaceState({}, '', qs ? `/?${qs}` : '/');
    } catch (_) { /* ignore */ }
  } else {
    const s = await refreshStatus();
    await syncStudyMode(s);
  }

  // 主界面多视图直链：/?read=<id> 服务端注入 RD_BOOT——阅读宿主就位（内容由 reading.js 自举渲染）
  if (window.RD_BOOT && window.RD_BOOT.text && window.RD_BOOT.text.id) {
    document.body.classList.add('mode-reading');
    const rv = $('readView');
    if (rv) rv.hidden = false;
    const a = $('assetsLink');
    if (a) a.href = '/assets?back=' + encodeURIComponent(`/?read=${window.RD_BOOT.text.id}`);
  }

  const replay = $('lykieReplayStoryBtn');
  if (replay) replay.hidden = true;
  const log = (state && state.panel_log) || lastPanelLog || [];
  if (log.length) {
    restorePanelLog(log);
  } else if ($('lykieMessages') && !$('lykieMessages').children.length) {
    appendLykieBubble('system', '嗨，我是 Lykie。刷题累了可以找我聊聊；卡住了就把题放到对话里。');
  }
  applyOpeningFromState(state);
})();
