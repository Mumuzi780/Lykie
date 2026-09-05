let current = null;    // 当前题目
let submitted = false; // 是否已显示答案
let userChoice = null; // 用户作答（选择题=字母，判断=对/错，填空=文本）

let editSource = 'card';  // 编辑来源：'card' 背诵卡片 / 'list' 题库列表
let editBankId = null;    // 列表编辑时的题库 id
let editQuestionId = null;
let viewBankId = null;    // 当前查看的题库 id
let studyMode = 'kill';    // 'kill' | 'sa'
let currentBankId = null;

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

async function fetchAuth(path, opts) {
  const res = await fetch(path, opts);
  if (redirectIfLoggedOut(res)) {
    throw new Error('未登录');
  }
  return res;
}

async function api(path, opts) {
  const res = await fetchAuth(path, opts);
  return res.json();
}

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

// ==================== 题库列表 ====================
async function refreshBanks() {
  const data = await api('/api/banks');
  currentBankId = data.current_bank_id;
  const list = $('bankList');
  list.innerHTML = '';
  data.banks.forEach(b => {
    const li = document.createElement('li');
    li.className = 'bank-item'
      + (b.id === data.current_bank_id ? ' active' : '')
      + (b.is_sa ? ' bank-sa' : '');
    const progress = b.is_sa
      ? `简答 · ${b.total} 题`
      : `已斩 ${b.killed}/${b.total}`;
    li.innerHTML =
      `<div class="bank-name">${escapeHtml(b.name)}</div>` +
      `<div class="bank-meta">${escapeHtml(b.imported_at)}</div>` +
      `<div class="bank-progress">${progress}</div>` +
      `<div class="bank-actions">` +
        `<button class="mini-btn" data-act="view">查看</button>` +
        `<button class="mini-btn" data-act="rename">重命名</button>` +
        `<button class="mini-btn danger" data-act="delete">删除</button>` +
      `</div>`;
    li.onclick = () => selectBank(b.id);
    li.querySelector('[data-act="view"]').onclick = e => { e.stopPropagation(); openBankView(b.id); };
    li.querySelector('[data-act="rename"]').onclick = e => { e.stopPropagation(); renameBank(b); };
    li.querySelector('[data-act="delete"]').onclick = e => { e.stopPropagation(); deleteBank(b); };
    list.appendChild(li);
  });
  return data;
}

async function selectBank(id) {
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
  const name = prompt('请输入新的题库名称：', bank.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) { alert('名称不能为空'); return; }
  const res = await api('/api/rename_bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bank.id, name: trimmed }),
  });
  if (res.ok === false) { alert(res.error || '重命名失败'); return; }
  await refreshBanks();
  await refreshStatus();
}

async function deleteBank(bank) {
  if (!confirm(`确定删除题库「${bank.name}」吗？\n\n题库内所有题目和进度将永久丢失，无法恢复。`)) return;
  const res = await api('/api/delete_bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bank.id }),
  });
  if (res.ok === false) { alert(res.error || '删除失败'); return; }
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
  if (!confirm(`确定删除这道题吗？\n\n${q.stem}`)) return;
  const res = await api('/api/delete_question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_id: bankId, id: q.id }),
  });
  if (res.ok === false) { alert(res.error || '删除失败'); return; }
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

function showState(title, hint) {
  current = null;
  submitted = false;
  setStudyCardVisible(false);
  if ($('studyHost') && studyMode === 'kill') $('studyHost').hidden = true;
  $('killBtn').hidden = true;
  hideAllBtns();
  const empty = $('emptyState');
  empty.hidden = false;
  empty.innerHTML = `<p>${title}</p><p class="hint">${hint}</p>`;
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
  if (!current) {
    if (data.reason === 'empty') {
      showState('还没有题库', '点击左上角「导入」，上传 .docx 文件开始背题');
    } else if (data.reason === 'done') {
      showState('全部斩完', '题库里的题都已被斩，点击「重置进度」可重新开始');
    }
    return;
  }
  renderQuestion();
}

function renderQuestion() {
  $('emptyState').hidden = true;
  if ($('studyHost')) $('studyHost').hidden = false;
  setStudyCardVisible(true);
  const card = $('card');
  $('answerBox').hidden = true;
  hideAllBtns();
  $('killBtn').hidden = false;

  $('cardType').textContent = TYPE_MAP[current.type] || '';
  $('cardStem').textContent = current.stem;
  renderMeta();

  const optBox = $('options');
  optBox.innerHTML = '';
  const fillArea = $('fillArea');
  fillArea.hidden = true;
  const input = $('fillInput');
  input.value = '';
  input.disabled = false;

  if (current.type === 'choice') {
    current.options.forEach(opt => {
      const m = opt.match(/^([A-H])[.、．\s]*(.*)$/);
      const letter = m ? m[1] : opt;
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.textContent = opt;
      btn.dataset.value = letter;
      btn.onclick = () => chooseChoice(btn, letter);
      optBox.appendChild(btn);
    });
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
  }
}

function renderMeta() {
  const meta = $('cardMeta');
  if (current.answer_count > 0) {
    const rate = Math.round(current.correct_count / current.answer_count * 100);
    meta.textContent = `已答 ${current.answer_count} 次 · 正确率 ${rate}%`;
    meta.hidden = false;
  } else {
    meta.hidden = true;
  }
}

// ==================== 作答 ====================
function chooseChoice(btn, letter) {
  if (submitted) return;
  userChoice = letter;
  document.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  submitted = true;
  document.querySelectorAll('.opt').forEach(b => {
    const v = b.dataset.value;
    if (v === current.answer) b.classList.add('correct');
    else if (v === userChoice) b.classList.add('wrong');
    b.disabled = true;
  });
  showAnswer();
  apiAnswer(userChoice === current.answer).then(() => {
    $('nextBtn').hidden = false;
  });
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
  showAnswer();
  apiAnswer(userChoice === current.answer).then(() => {
    $('nextBtn').hidden = false;
  });
}

function confirmFill() {
  if (submitted) return;
  const val = $('fillInput').value.trim();
  if (!val) { alert('请先输入你的答案'); return; }
  userChoice = val;
  submitted = true;
  $('fillInput').disabled = true;
  $('confirmBtn').hidden = true;
  showAnswer();
  $('judgeBtns').hidden = false;
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
  current.answer_count = (current.answer_count || 0) + 1;
  if (correct) current.correct_count = (current.correct_count || 0) + 1;
  renderMeta();
  try {
    await api('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: current.id, correct }),
    });
    await refreshStatus();
  } catch (e) {
    console.error('提交作答失败', e);
  }
}

async function kill() {
  if (!current) return;
  if (!confirm('确定「斩」掉这道题吗？斩后将不再被抽到。')) return;
  await api('/api/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: current.id }),
  });
  await refreshBanks();
  await refreshStatus();
  loadNext();
}

// ==================== 编辑题目 ====================
function updateEditForm() {
  const t = $('editType').value;
  $('editOptionsArea').hidden = t !== 'choice';
  $('editAnswerChoice').hidden = t !== 'choice';
  $('editAnswerJudge').hidden = t !== 'judge';
  $('editAnswerFill').hidden = !(t === 'fill' || t === 'short_answer');
  const kwArea = $('editKeywordsArea');
  if (kwArea) kwArea.hidden = t !== 'short_answer';
}

function fillEditForm(q) {
  // q 为原始格式：{ type, stem, options: [内容], answer: 内容 }
  $('editType').value = q.type;
  $('editStem').value = q.stem;
  if (q.type === 'choice') {
    $('editOpt0').value = q.options[0] || '';
    $('editOpt1').value = q.options[1] || '';
    $('editOpt2').value = q.options[2] || '';
    $('editOpt3').value = q.options[3] || '';
    const idx = q.options.indexOf(q.answer);
    $('editAnswerChoice').value = idx >= 0 ? 'ABCD'[idx] : 'A';
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
    const idx = 'ABCDEFGH'.indexOf(c.answer);
    const answer = idx >= 0 ? options[idx] : c.answer_text;
    return { type: 'choice', stem: c.stem, options, answer, analysis: c.analysis || '', keywords: c.keywords || [] };
  }
  return { type: c.type, stem: c.stem, options: [], answer: c.answer, analysis: c.analysis || '', keywords: c.keywords || [] };
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
  const letters = 'ABCDEFGH';
  const opts = options.map((c, i) => `${letters[i]}.${c}`);
  const idx = options.indexOf(answer);
  const letter = idx >= 0 ? letters[idx] : letters[0];
  return { options: opts, answer: letter, answer_text: `${letter}.${answer}` };
}

async function saveEdit() {
  const type = $('editType').value;
  const stem = $('editStem').value.trim();
  if (!stem) { alert('题干不能为空'); return; }

  let options = [];
  let answer = '';
  if (type === 'choice') {
    options = [
      $('editOpt0').value.trim(),
      $('editOpt1').value.trim(),
      $('editOpt2').value.trim(),
      $('editOpt3').value.trim(),
    ].filter(x => x);
    if (!options.length) { alert('请至少填写一个选项'); return; }
    const letter = $('editAnswerChoice').value;
    const idx = 'ABCD'.indexOf(letter);
    answer = options[Math.min(idx, options.length - 1)] || options[0];
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
  if (res.ok === false) { alert(res.error || '保存失败'); return; }

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
    } else if (type === 'judge') {
      current.options = ['对', '错'];
      current.answer = answer;
      current.answer_text = answer;
    } else {
      current.options = [];
      current.answer = answer;
      current.answer_text = answer;
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

// ==================== 导入与重置 ====================
async function doImport(file) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetchAuth('/api/import', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) { alert(data.error || '导入失败'); return; }
    await refreshBanks();
    const s = await refreshStatus();
    await syncStudyMode(s);
  } catch (e) {
    alert('导入失败：' + e);
  }
}

async function resetProgress() {
  if (!confirm('确定重置当前题库的进度吗？所有题目将恢复为未掌握状态（含已斩题目）。')) return;
  await api('/api/reset', { method: 'POST' });
  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
}

// ==================== 粘贴导入 ====================
let pastePreviewed = false;

function openPasteModal() {
  $('pasteName').value = '';
  $('pasteText').value = '';
  $('pastePreview').hidden = true;
  $('pastePreview').innerHTML = '';
  $('pasteConfirmBtn').disabled = true;
  pastePreviewed = false;
  $('pasteModal').hidden = false;
}

async function previewPaste() {
  const text = $('pasteText').value;
  if (!text.trim()) { alert('请先粘贴题库文本'); return; }
  const res = await api('/api/import_text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, preview: true }),
  });
  if (res.ok === false) { alert(res.error || '解析失败'); return; }
  pastePreviewed = true;
  renderPastePreview(res);
  $('pasteConfirmBtn').disabled = false;
}

function renderPastePreview(res) {
  const box = $('pastePreview');
  box.hidden = false;
  const typeMap = { choice: '选择题', judge: '判断题', fill: '填空题', short_answer: '简答题' };
  let html = `<div class="paste-preview-head">共解析出 ${res.total} 题</div>`;
  res.questions.forEach((q, i) => {
    html +=
      `<div class="paste-item">` +
      `<div class="paste-item-head"><span class="q-type">${typeMap[q.type] || q.type}</span> 第 ${i + 1} 题</div>` +
      `<div class="paste-stem">${escapeHtml(q.stem)}</div>` +
      `<div class="paste-answer">答案：${escapeHtml(q.answer)}</div>` +
      `</div>`;
  });
  box.innerHTML = html;
}

async function confirmPaste() {
  const text = $('pasteText').value;
  if (!text.trim()) { alert('请先粘贴题库文本'); return; }
  if (!pastePreviewed) { alert('请先点击「预览解析」确认'); return; }
  const name = $('pasteName').value.trim() || '粘贴导入';
  const res = await api('/api/import_text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, name, preview: false }),
  });
  if (res.ok === false) { alert(res.error || '导入失败'); return; }
  $('pasteModal').hidden = true;
  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
}

// ==================== 事件绑定 ====================
$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => {
  if (e.target.files[0]) doImport(e.target.files[0]);
  e.target.value = '';
};
$('pasteBtn').onclick = openPasteModal;
$('pastePreviewBtn').onclick = previewPaste;
$('pasteConfirmBtn').onclick = confirmPaste;
$('pasteCancelBtn').onclick = () => { $('pasteModal').hidden = true; };
$('editBtn').onclick = openEditFromCard;
$('editCancelBtn').onclick = closeEdit;
$('editSaveBtn').onclick = saveEdit;
$('editType').onchange = updateEditForm;
$('bankModalClose').onclick = () => { $('bankModal').hidden = true; };
$('addQuestionBtn').onclick = () => openEditNew(viewBankId);
$('confirmBtn').onclick = confirmFill;
$('nextBtn').onclick = () => { $('nextBtn').hidden = true; loadNext(); };
$('rightBtn').onclick = async () => { $('judgeBtns').hidden = true; await apiAnswer(true); loadNext(); };
$('wrongBtn').onclick = async () => { $('judgeBtns').hidden = true; await apiAnswer(false); loadNext(); };
$('killBtn').onclick = kill;
$('resetBtn').onclick = resetProgress;

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
    alert('开场播放中不能清空');
    return;
  }
  if (!confirm('将清空自由聊记录，回到「开场刚结束」。监督案例与事实记忆会保留。继续？')) {
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
      alert(data.error || '清空失败');
      return;
    }
    restorePanelLog(data.panel_log || []);
    appendLykieBubble('system', '已清空到开场结束，可重新测自由聊');
    await refreshLykieState();
  } catch (e) {
    alert('网络错误');
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
    alert('请填写好范例，或留空并写点评（表示应先不回）');
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
      alert(data.error || '保存失败');
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
    alert('网络错误');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function isMobilePortrait() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function setBankDrawerOpen(open) {
  document.body.classList.toggle('bank-drawer-open', !!open);
}

function setLykiePanelOpen(open) {
  const panel = $('lykiePanel');
  if (!panel) return;
  if (open) setBankDrawerOpen(false);
  panel.classList.toggle('collapsed', !open);
  try {
    localStorage.setItem('lykiePanelOpen', open ? '1' : '0');
  } catch (e) { /* ignore */ }
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

  const pending = appendLykieBubble('assistant', '……', { noFeedback: true, skipPersist: true });
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

  let panelOpen = true;
  try {
    panelOpen = localStorage.getItem('lykiePanelOpen') !== '0';
  } catch (e) { /* ignore */ }
  if (isMobilePortrait()) panelOpen = false;
  setLykiePanelOpen(panelOpen);

  const state = await refreshLykieState();

  let startedStory = false;
  if (window.StoryRunner) {
    startedStory = await window.StoryRunner.startFragment01(false);
  }
  if (!startedStory) {
    const replay = $('lykieReplayStoryBtn');
    if (replay) replay.hidden = false;
    const log = (state && state.panel_log) || lastPanelLog || [];
    if (log.length) {
      restorePanelLog(log);
    } else if ($('lykieMessages') && !$('lykieMessages').children.length) {
      appendLykieBubble('system', '嗨，我是 Lykie。刷题累了可以找我聊聊；卡住了就点「问问 Lykie」。');
    }
  }

  await refreshBanks();
  const s = await refreshStatus();
  await syncStudyMode(s);
})();
