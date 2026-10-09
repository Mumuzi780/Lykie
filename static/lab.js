const $ = (id) => document.getElementById(id);

async function labApi(path, opts) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(opts || {}),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('未登录');
  }
  const data = await res.json();
  if (!data.ok && data.error) {
    throw new Error(data.error);
  }
  return data;
}

let layers = [];
let chat = [];
let saveTimer = null;
let busy = false;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayers, 500);
}

async function saveLayers() {
  try {
    const data = await labApi('/api/lab/layers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layers }),
    });
    applyMeta(data);
  } catch (e) {
    /* ignore */
  }
}

function applyMeta(data) {
  if (Array.isArray(data.layers)) layers = data.layers;
  if (Array.isArray(data.chat)) chat = data.chat;
  const n = data.system_chars || 0;
  if ($('labChars')) $('labChars').textContent = n + ' 字';
  if ($('labPreviewChars')) $('labPreviewChars').textContent = n ? `（${n} 字）` : '';
  if ($('labPreview')) $('labPreview').textContent = data.system || '（空：所有层都关着）';
}

function renderLayers() {
  const box = $('labLayerList');
  if (!box) return;
  box.innerHTML = '';
  layers.forEach((layer, i) => {
    const card = document.createElement('article');
    card.className = 'lab-card' + (layer.enabled ? '' : ' is-off');
    card.innerHTML = `
      <div class="lab-card-row">
        <input type="checkbox" ${layer.enabled ? 'checked' : ''} data-act="on" title="写入本轮">
        <input type="text" value="${escapeAttr(layer.name)}" data-act="name" maxlength="40">
        <select data-act="kind">
          <option value="system"${layer.kind === 'system' ? ' selected' : ''}>写入系统</option>
          <option value="think"${layer.kind === 'think' ? ' selected' : ''}>思考步</option>
          <option value="clock"${layer.kind === 'clock' ? ' selected' : ''}>实时时间</option>
        </select>
      </div>
      <textarea data-act="text">${escapeHtml(layer.text || '')}</textarea>
      <div class="lab-card-meta">
        <span>${(layer.text || '').length} 字</span>
        <div class="lab-icon-btns">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''}>上移</button>
          <button type="button" data-act="down" ${i === layers.length - 1 ? 'disabled' : ''}>下移</button>
          <button type="button" data-act="del">删除</button>
        </div>
      </div>
    `;
    card.addEventListener('change', (e) => onLayerField(i, e.target));
    card.addEventListener('input', (e) => {
      if (e.target.getAttribute('data-act') === 'text' || e.target.getAttribute('data-act') === 'name') {
        onLayerField(i, e.target, false);
      }
    });
    card.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'up') moveLayer(i, -1);
      if (act === 'down') moveLayer(i, 1);
      if (act === 'del') delLayer(i);
    });
    box.appendChild(card);
  });
}

function onLayerField(i, el, doSave = true) {
  const layer = layers[i];
  if (!layer || !el) return;
  const act = el.getAttribute('data-act');
  if (act === 'on') layer.enabled = !!el.checked;
  if (act === 'name') layer.name = el.value;
  if (act === 'kind') layer.kind = el.value;
  if (act === 'text') {
    layer.text = el.value;
    const meta = el.parentElement && el.parentElement.querySelector('.lab-card-meta span');
    if (meta) meta.textContent = `${el.value.length} 字`;
  }
  const card = el.closest('.lab-card');
  if (card) card.classList.toggle('is-off', !layer.enabled);
  previewLocal();
  if (doSave) scheduleSave();
  else scheduleSave();
}

function previewLocal() {
  const parts = [];
  layers.forEach((layer) => {
    if (!layer.enabled || layer.kind === 'think') return;
    const body = layer.kind === 'clock' ? '（发送时填入真实时间）' : String(layer.text || '').trim();
    if (!body && layer.kind !== 'clock') return;
    parts.push(`【${layer.name || '层'}】\n${body}`);
  });
  const system = parts.join('\n\n');
  if ($('labChars')) $('labChars').textContent = system.length + ' 字';
  if ($('labPreviewChars')) $('labPreviewChars').textContent = system.length ? `（${system.length} 字）` : '';
  if ($('labPreview')) $('labPreview').textContent = system || '（空：所有层都关着）';
}

function moveLayer(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= layers.length) return;
  const tmp = layers[i];
  layers[i] = layers[j];
  layers[j] = tmp;
  renderLayers();
  previewLocal();
  scheduleSave();
}

function delLayer(i) {
  layers.splice(i, 1);
  renderLayers();
  previewLocal();
  scheduleSave();
}

function addLayer() {
  layers.push({
    id: 'n' + Date.now().toString(36),
    name: '自定义',
    kind: 'system',
    enabled: false,
    text: '',
  });
  renderLayers();
  scheduleSave();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function renderChat() {
  const box = $('labMessages');
  if (!box) return;
  box.innerHTML = '';
  if (!chat.length) {
    const el = document.createElement('div');
    el.className = 'lab-bubble system';
    el.textContent = '对话是空的。可先「由她先说第一句」，或自己开口。';
    box.appendChild(el);
    return;
  }
  chat.forEach((turn) => {
    const el = document.createElement('div');
    const silent = turn.role === 'assistant' && (turn.content === '[不回复]' || turn.silence);
    el.className = 'lab-bubble ' + turn.role + (silent ? ' silence' : '');
    el.textContent = silent ? '（先不回）' : (turn.content || turn.text || '');
    box.appendChild(el);
    if (turn.role === 'assistant' && turn.think) {
      appendThink(turn.think, box);
    }
  });
  box.scrollTop = box.scrollHeight;
}

function appendThink(think, box) {
  if (!think || typeof think !== 'object') return;
  box = box || $('labMessages');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'lab-bubble think';
  el.textContent = `想：${think.action || 'thin'}` + (think.why ? `\n${think.why}` : '');
  box.appendChild(el);
}

async function sendLab() {
  if (busy) return;
  const input = $('labInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  input.value = '';
  chat.push({ role: 'user', content: text });
  renderChat();
  busy = true;
  if ($('labSendBtn')) $('labSendBtn').disabled = true;
  try {
    await saveLayers();
    const data = await labApi('/api/lab/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    applyMeta(data);
    renderChat();
  } catch (e) {
    chat.pop();
    renderChat();
    const box = $('labMessages');
    if (box) {
      const el = document.createElement('div');
      el.className = 'lab-bubble system';
      el.textContent = e.message || '发送失败';
      box.appendChild(el);
    }
  } finally {
    busy = false;
    if ($('labSendBtn')) $('labSendBtn').disabled = false;
    if (input) input.focus();
  }
}

async function postAction(path) {
  const data = await labApi(path, { method: 'POST' });
  applyMeta(data);
  renderLayers();
  renderChat();
}

async function boot() {
  try {
    const data = await labApi('/api/lab/state');
    applyMeta(data);
    renderLayers();
    renderChat();
  } catch (e) {
    if ($('labMessages')) {
      $('labMessages').textContent = e.message || '无法读取试验台';
    }
  }
}

if ($('labAddLayerBtn')) $('labAddLayerBtn').onclick = addLayer;
if ($('labSendBtn')) $('labSendBtn').onclick = sendLab;
if ($('labSeedBtn')) $('labSeedBtn').onclick = () => postAction('/api/lab/seed');
if ($('labClearChatBtn')) $('labClearChatBtn').onclick = () => postAction('/api/lab/reset_chat');
if ($('labResetLayersBtn')) $('labResetLayersBtn').onclick = () => {
  if (window.confirm('恢复默认层（短核 + 开场情境开启，其余关闭）。对话保留。')) {
    postAction('/api/lab/reset_layers');
  }
};
if ($('labInput')) {
  $('labInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendLab();
    }
  });
}

boot();
