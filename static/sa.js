window.SaTrain = (function () {
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('未登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

const $ = (id) => document.getElementById(id);

const STAGE_LABEL = {
  warmup: '热身多选',
  cloze: '挖空关键词',
  match: '连线匹配',
  half_cloze: '半边挖空',
  stem_pick: '答案选题干',
  free_write: '无提示默写',
  review_free: '复习·默写',
  review_cloze: '复习·挖空',
  done: '复习池',
};

let current = null;

async function refreshStats() {
  const s = await api('/api/sa/status');
  if (!s.ok) {
    $('saStats').textContent = s.error || '未就绪';
    return s;
  }
  const st = s.stages || {};
  const pair = s.active_pair || [];
  const pairTxt = pair.length ? ` · 本组 ${pair.join('+')}` : '';
  const learn = s.learning != null ? s.learning : ((st.warmup || 0) + (st.cloze || 0) + (st.half_cloze || 0) + (st.stem_pick || 0) + (st.free_write || 0));
  const due = s.review_due != null ? s.review_due : 0;
  const wait = s.review_waiting != null ? s.review_waiting : (st.done || 0);
  const activeR = s.review_active != null ? s.review_active : 0;
  const quota = s.review_quota != null ? s.review_quota : '';
  const gate = s.need_learn_gate ? ' · 先刷学习组' : (quota !== '' ? ` · 本批复习余${quota}` : '');
  $('saStats').textContent =
    `${s.bank_name} · ${s.total} 题${pairTxt} · 学习${learn} / 复习到期${due + activeR} / 间隔中${wait}${gate}`;
  return s;
}

function setFeedback(text, kind) {
  const el = $('saFeedback');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.remove('good', 'bad');
  if (kind) el.classList.add(kind);
}

function setControls(nodes) {
  const box = $('saControls');
  box.innerHTML = '';
  nodes.forEach((n) => box.appendChild(n));
}

function btn(label, className, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function showEmpty(title, hint) {
  const stack = $('saStack');
  if (stack) stack.hidden = false;
  $('saCard').hidden = true;
  $('saEmpty').hidden = false;
  $('saEmptyTitle').textContent = title;
  $('saEmptyHint').textContent = hint || '';
  setControls([]);
  setFeedback('');
  const kwBtn = $('saEditKwBtn');
  if (kwBtn) kwBtn.disabled = true;
  current = null;
}

function showCard() {
  const stack = $('saStack');
  if (stack) stack.hidden = false;
  $('saEmpty').hidden = true;
  $('saCard').hidden = false;
  const kwBtn = $('saEditKwBtn');
  if (kwBtn) kwBtn.disabled = !current || !current.qid;
}

function renderWarmup(card) {
  const body = $('saBody');
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'sa-options';
  (card.options || []).forEach((opt) => {
    const label = document.createElement('label');
    label.className = 'sa-opt';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opt.id;
    input.addEventListener('change', () => {
      label.classList.toggle('selected', input.checked);
    });
    const span = document.createElement('span');
    span.textContent = opt.text;
    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);
  });
  body.appendChild(wrap);
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.style.marginTop = '8px';
  meta.textContent = `热身第 ${card.round}/${card.total_rounds} 轮 · 本题要点余 ${card.remaining_points} 条待过眼`;
  body.appendChild(meta);

  setControls([
    btn('提交多选', 'primary', async () => {
      const selected = [...body.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
      const res = await api('/api/sa/warmup_answer', {
        method: 'POST',
        body: JSON.stringify({ qid: card.qid, selected }),
      });
      setFeedback(res.message, res.correct ? 'good' : 'bad');
      await refreshStats();
      if (res.correct) {
        setControls([btn('下一题', 'primary', () => loadNext())]);
      }
    }),
  ]);
}

function renderMatch(card) {
  const body = $('saBody');
  body.innerHTML = '';
  const state = {
    selectedLeft: null,
    // leftId -> {leftText, rightId, rightText}
    links: {},
  };

  const wrap = document.createElement('div');
  wrap.className = 'sa-match';
  const leftCol = document.createElement('div');
  leftCol.className = 'sa-match-col';
  const rightCol = document.createElement('div');
  rightCol.className = 'sa-match-col';
  const mid = document.createElement('div');
  mid.className = 'sa-match-links';
  mid.innerHTML = '<div class="card-meta">点左侧再点右侧完成连线；再点已连项可取消</div>';

  const leftBtns = {};
  const rightBtns = {};

  function refreshLinkView() {
    const list = document.createElement('div');
    list.className = 'sa-match-pair-list';
    Object.values(state.links).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'sa-match-pair';
      row.textContent = `${p.leftText} — ${p.rightText}`;
      row.title = '点击取消这对';
      row.addEventListener('click', () => {
        delete state.links[p.leftId];
        leftBtns[p.leftId].classList.remove('paired', 'selected');
        rightBtns[p.rightId].classList.remove('paired', 'selected');
        refreshLinkView();
      });
      list.appendChild(row);
    });
    mid.innerHTML = '';
    mid.appendChild(document.createElement('div')).className = 'card-meta';
    mid.firstChild.textContent = '点左侧再点右侧完成连线；点下方配对可取消';
    mid.appendChild(list);
  }

  function clearSelection() {
    Object.values(leftBtns).forEach((b) => b.classList.remove('selected'));
    Object.values(rightBtns).forEach((b) => b.classList.remove('selected'));
    state.selectedLeft = null;
  }

  (card.left || []).forEach((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sa-match-item';
    b.textContent = opt.text;
    leftBtns[opt.id] = b;
    b.addEventListener('click', () => {
      if (state.links[opt.id]) {
        const p = state.links[opt.id];
        delete state.links[opt.id];
        rightBtns[p.rightId].classList.remove('paired');
        b.classList.remove('paired');
        refreshLinkView();
        return;
      }
      clearSelection();
      state.selectedLeft = opt;
      b.classList.add('selected');
    });
    leftCol.appendChild(b);
  });

  (card.right || []).forEach((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sa-match-item';
    b.textContent = opt.text;
    rightBtns[opt.id] = b;
    b.addEventListener('click', () => {
      // 若右侧已占用，先拆掉
      const occupied = Object.values(state.links).find((p) => p.rightId === opt.id);
      if (occupied) {
        delete state.links[occupied.leftId];
        leftBtns[occupied.leftId].classList.remove('paired');
        b.classList.remove('paired');
        refreshLinkView();
      }
      if (!state.selectedLeft) {
        b.classList.add('selected');
        setTimeout(() => b.classList.remove('selected'), 200);
        return;
      }
      const left = state.selectedLeft;
      state.links[left.id] = {
        leftId: left.id,
        leftText: left.text,
        rightId: opt.id,
        rightText: opt.text,
      };
      leftBtns[left.id].classList.add('paired');
      b.classList.add('paired');
      clearSelection();
      refreshLinkView();
    });
    rightCol.appendChild(b);
  });

  wrap.appendChild(leftCol);
  wrap.appendChild(mid);
  wrap.appendChild(rightCol);
  body.appendChild(wrap);
  refreshLinkView();

  setControls([
    btn('提交连线', 'primary', async () => {
      const links = Object.values(state.links).map((p) => ({
        left_text: p.leftText,
        right_text: p.rightText,
      }));
      const res = await api('/api/sa/match_answer', {
        method: 'POST',
        body: JSON.stringify({ qid: card.qid, links }),
      });
      setFeedback(res.message, res.correct ? 'good' : 'bad');

      // 提交后标出对错：连错的左右方块标红，连对的保持绿
      Object.values(leftBtns).forEach((b) => b.classList.remove('bad', 'selected'));
      Object.values(rightBtns).forEach((b) => b.classList.remove('bad', 'selected'));
      const leftByText = {};
      const rightByText = {};
      Object.entries(leftBtns).forEach(([id, b]) => {
        leftByText[b.textContent] = b;
      });
      Object.entries(rightBtns).forEach(([id, b]) => {
        rightByText[b.textContent] = b;
      });
      const linkedLeft = new Set();
      const linkedRight = new Set();
      (res.details || []).forEach((d) => {
        linkedLeft.add(d.left);
        linkedRight.add(d.right);
        const lb = leftByText[d.left];
        const rb = rightByText[d.right];
        if (d.ok) {
          if (lb) {
            lb.classList.add('paired');
            lb.classList.remove('bad');
          }
          if (rb) {
            rb.classList.add('paired');
            rb.classList.remove('bad');
          }
        } else {
          if (lb) {
            lb.classList.remove('paired');
            lb.classList.add('bad');
          }
          if (rb) {
            rb.classList.remove('paired');
            rb.classList.add('bad');
          }
        }
      });
      // 未连上的也算错，标红
      Object.values(leftBtns).forEach((b) => {
        if (!linkedLeft.has(b.textContent)) {
          b.classList.remove('paired');
          b.classList.add('bad');
        }
      });
      Object.values(rightBtns).forEach((b) => {
        if (!linkedRight.has(b.textContent)) {
          b.classList.remove('paired');
          b.classList.add('bad');
        }
      });
      // 中间配对行同步标色
      mid.querySelectorAll('.sa-match-pair').forEach((row) => {
        const text = row.textContent || '';
        const hit = (res.details || []).find((d) => text === `${d.left} — ${d.right}`);
        row.classList.toggle('ok', !!(hit && hit.ok));
        row.classList.toggle('bad', !!(hit && !hit.ok));
      });

      if (!res.correct && Array.isArray(res.hint_pairs)) {
        const hintBox = document.createElement('div');
        hintBox.className = 'sa-match-hints';
        hintBox.innerHTML = '<div class="card-meta">正确搭配：</div>';
        res.hint_pairs.forEach((p) => {
          const row = document.createElement('div');
          row.className = 'sa-match-pair hint';
          row.textContent = `${p.left} — ${p.right}`;
          hintBox.appendChild(row);
        });
        body.appendChild(hintBox);
      }
      await refreshStats();
      if (res.correct) {
        setControls([btn('下一题', 'primary', () => loadNext())]);
      } else if (res.go_next) {
        setControls(reviewFailControls(card, res));
      }
    }),
  ]);
}

function reviewFailControls(card, res) {
  const nodes = [btn('下一题', 'primary', () => loadNext())];
  if (res.can_demote_learning || card.review || card.stage === 'review_cloze') {
    nodes.push(
      btn('退回学习重练', 'ghost', async () => {
        await api('/api/sa/free_advance', {
          method: 'POST',
          body: JSON.stringify({ qid: card.qid, action: 'demote_learning' }),
        });
        await refreshStats();
        loadNext();
      })
    );
  }
  return nodes;
}

function renderCloze(card) {
  const body = $('saBody');
  body.innerHTML = '';
  const inputs = [];
  (card.parts || []).forEach((line) => {
    const div = document.createElement('div');
    div.className = 'sa-cloze-line';
    if (line.prefix) div.appendChild(document.createTextNode(line.prefix));
    (line.segs || []).forEach((seg) => {
      if (seg.type === 'text') {
        div.appendChild(document.createTextNode(seg.text));
      } else {
        const input = document.createElement('input');
        input.className = 'sa-blank';
        input.dataset.blankIndex = String(seg.blank_index);
        input.autocomplete = 'off';
        inputs[seg.blank_index] = input;
        div.appendChild(input);
      }
    });
    body.appendChild(div);
  });

  setControls([
    btn('提交挖空', 'primary', async () => {
      const blanks = inputs.map((el) => (el ? el.value.trim() : ''));
      const res = await api('/api/sa/cloze_answer', {
        method: 'POST',
        body: JSON.stringify({ qid: card.qid, blanks }),
      });
      (res.details || []).forEach((d) => {
        const el = inputs[d.index];
        if (!el) return;
        el.classList.toggle('ok', !!d.ok);
        el.classList.toggle('bad', !d.ok);
      });
      // 未全对：正确答案作为 placeholder；错格清空以便看见提示（无序剩余答案）
      if (!res.correct && Array.isArray(res.hints)) {
        res.hints.forEach((hint, i) => {
          const el = inputs[i];
          if (!el) return;
          const detail = (res.details || [])[i];
          el.placeholder = hint || '';
          if (!detail || !detail.ok) {
            el.value = '';
          }
          el.classList.add('hinted');
        });
      }
      setFeedback(res.message, res.correct ? 'good' : 'bad');
      await refreshStats();
      if (res.correct) {
        setControls([btn('下一题', 'primary', () => loadNext())]);
      } else if (res.go_next) {
        setControls(reviewFailControls(card, res));
      }
    }),
  ]);
}

function renderStemPick(card) {
  const body = $('saBody');
  body.innerHTML = '';
  const ans = document.createElement('pre');
  ans.className = 'sa-answer-block';
  ans.textContent = card.answer_text || '';
  body.appendChild(ans);

  const wrap = document.createElement('div');
  wrap.className = 'sa-options';
  let selected = null;
  (card.options || []).forEach((opt) => {
    const label = document.createElement('label');
    label.className = 'sa-opt';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'stem_pick';
    input.value = opt.id;
    input.addEventListener('change', () => {
      selected = opt.id;
      wrap.querySelectorAll('.sa-opt').forEach((el) => el.classList.remove('selected'));
      label.classList.add('selected');
    });
    const span = document.createElement('span');
    span.textContent = opt.text;
    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);
  });
  body.appendChild(wrap);

  setControls([
    btn('提交题干', 'primary', async () => {
      if (!selected) {
        setFeedback('请先选择一个题干', 'bad');
        return;
      }
      const res = await api('/api/sa/stem_answer', {
        method: 'POST',
        body: JSON.stringify({ qid: card.qid, selected }),
      });
      setFeedback(res.message, res.correct ? 'good' : 'bad');
      wrap.querySelectorAll('.sa-opt').forEach((el) => {
        const input = el.querySelector('input');
        if (!input) return;
        if (res.correct_id && input.value === res.correct_id) {
          el.classList.add('stem-ok');
        }
        if (!res.correct && input.value === selected) {
          el.classList.add('stem-bad');
        }
      });
      await refreshStats();
      if (res.correct || res.go_next) {
        setControls([btn('下一题', 'primary', () => loadNext())]);
      }
    }),
  ]);
}

function renderFree(card) {
  const body = $('saBody');
  body.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'sa-free-input';
  ta.placeholder = '在此写出要点…';
  body.appendChild(ta);
  const isReview = !!card.review || card.stage === 'review_free';

  const afterJudge = (res) => {
    setFeedback(res.message, res.can_finish ? 'good' : 'bad');
    const chips = document.createElement('div');
    chips.className = 'sa-chip-row';
    (res.hits || []).forEach((k) => {
      const c = document.createElement('span');
      c.className = 'sa-chip';
      c.textContent = '命中 ' + k;
      chips.appendChild(c);
    });
    (res.missed || []).forEach((k) => {
      const c = document.createElement('span');
      c.className = 'sa-chip miss';
      c.textContent = '未命中 ' + k;
      chips.appendChild(c);
    });
    body.appendChild(chips);
    if (res.reference_answer) {
      const ref = document.createElement('div');
      ref.className = 'sa-feedback';
      ref.style.marginTop = '10px';
      ref.textContent = '参考答案：\n' + res.reference_answer;
      body.appendChild(ref);
    }
    const nodes = [btn('再写一版', 'ghost', () => renderFree(card))];
    if (isReview) {
      nodes.push(
        btn('先挖空复习', 'ghost', async () => {
          await api('/api/sa/free_advance', {
            method: 'POST',
            body: JSON.stringify({ qid: card.qid, action: 'demote_cloze' }),
          });
          await refreshStats();
          loadNext();
        })
      );
    } else {
      nodes.push(
        btn('重复本阶段', 'ghost', async () => {
          await api('/api/sa/free_advance', {
            method: 'POST',
            body: JSON.stringify({ qid: card.qid, action: 'repeat' }),
          });
          loadNext();
        })
      );
    }
    if (res.can_finish) {
      nodes.push(
        btn(isReview ? '复习过关' : '完成本题', 'primary', async () => {
          const r = await api('/api/sa/free_advance', {
            method: 'POST',
            body: JSON.stringify({ qid: card.qid, action: 'next' }),
          });
          setFeedback(r.message || '', 'good');
          await refreshStats();
          loadNext();
        })
      );
    }
    setControls(nodes);
  };

  setControls([
    btn('对照关键词', 'primary', async () => {
      const res = await api('/api/sa/free_answer', {
        method: 'POST',
        body: JSON.stringify({ qid: card.qid, text: ta.value }),
      });
      afterJudge(res);
      await refreshStats();
    }),
  ]);
}

function renderCard(card) {
  current = card;
  showCard();
  setFeedback('');
  $('saType').textContent = card.review || card.lane === 'review' ? '复习' : '简答题';
  const stageLabel =
    card.kind === 'match'
      ? (card.review ? '复习·连线' : STAGE_LABEL.match)
      : card.kind === 'half_cloze'
        ? STAGE_LABEL.half_cloze
      : card.kind === 'stem_pick'
        ? STAGE_LABEL.stem_pick
        : (STAGE_LABEL[card.stage] || card.stage);
  $('saStage').textContent = stageLabel;
  $('saStem').textContent = card.stem || '';
  $('saPrompt').textContent = card.prompt || card.message || '';
  if (card.kind === 'warmup') renderWarmup(card);
  else if (card.kind === 'match') renderMatch(card);
  else if (card.kind === 'cloze' || card.kind === 'half_cloze') renderCloze(card);
  else if (card.kind === 'stem_pick') renderStemPick(card);
  else if (card.kind === 'free_write') renderFree(card);
  else {
    $('saBody').innerHTML = '';
    if (card.answer) {
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.textContent = card.answer;
      $('saBody').appendChild(pre);
    }
    setControls([btn('下一题', 'primary', () => loadNext())]);
  }
}

async function loadNext() {
  try {
    const card = await api('/api/sa/next');
    if (card.empty) {
      showEmpty('还没有短简答题库', card.error || '请先导入「教资科二简答-短题」');
      return;
    }
    if (card.all_done) {
      showEmpty('今日暂无待练', card.message || '可以点「重置简答进度」再来一轮，或改天回来复习。');
      setControls([]);
      return;
    }
    renderCard(card);
  } catch (e) {
    showEmpty('加载失败', e.message || String(e));
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightKeywords(text, kws) {
  const raw = String(text || '');
  const sorted = [...(kws || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  const variantsOf = (kw) => {
    const set = new Set([kw]);
    if (kw.includes('与')) set.add(kw.replace(/与/g, '和'));
    if (kw.includes('和')) set.add(kw.replace(/和/g, '与'));
    return [...set].sort((a, b) => b.length - a.length);
  };
  const covered = new Array(raw.length).fill(false);
  const marks = []; // [start, end]
  for (const kw of sorted) {
    for (const v of variantsOf(kw)) {
      if (!v) continue;
      let from = 0;
      while (from < raw.length) {
        const i = raw.indexOf(v, from);
        if (i < 0) break;
        const j = i + v.length;
        let overlap = false;
        for (let k = i; k < j; k++) {
          if (covered[k]) { overlap = true; break; }
        }
        if (!overlap) {
          for (let k = i; k < j; k++) covered[k] = true;
          marks.push([i, j]);
        }
        from = i + 1;
      }
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  let html = '';
  let cursor = 0;
  for (const [a, b] of marks) {
    if (a > cursor) html += escapeHtml(raw.slice(cursor, a));
    html += `<mark class="sa-kw-mark">${escapeHtml(raw.slice(a, b))}</mark>`;
    cursor = b;
  }
  if (cursor < raw.length) html += escapeHtml(raw.slice(cursor));
  return html;
}

async function openKwModal() {
  if (!current || !current.qid) return;
  $('saKwStem').textContent = current.stem || '';
  const list = $('saKwList');
  list.innerHTML = '<p class="hint">加载分点中…</p>';
  $('saKwModal').hidden = false;

  let points = current.points || [];
  let unordered = !!current.cloze_unordered;
  try {
    const detail = await api('/api/sa/question_detail?qid=' + encodeURIComponent(current.qid));
    if (detail.ok) {
      points = detail.points || [];
      unordered = !!detail.cloze_unordered;
      current.points = points;
      current.cloze_unordered = unordered;
      current.keywords = detail.keywords || current.keywords;
      if (detail.stem) $('saKwStem').textContent = detail.stem;
    }
  } catch (e) {
    /* 退回卡片自带的 points */
  }

  list.innerHTML = '';
  if (!points.length) {
    list.innerHTML = '<p class="hint">本题没有分点结构，请先在题库补全要点。</p>';
  }
  points.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'sa-kw-row';
    row.dataset.index = String(p.index);
    const preview = document.createElement('div');
    preview.className = 'sa-kw-preview';
    const idx = p.index != null ? `${p.index}. ` : '';
    preview.innerHTML = `<span class="sa-kw-idx">${escapeHtml(idx)}</span>` +
      highlightKeywords(p.text || '', p.keywords || []);
    const label = document.createElement('label');
    label.textContent = '本点关键词（顿号分隔；可多个）';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sa-kw-input';
    input.value = (p.keywords || []).join('、');
    input.placeholder = '对应上面高亮的词';
    input.addEventListener('input', () => {
      const kws = input.value.split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean);
      preview.innerHTML = `<span class="sa-kw-idx">${escapeHtml(idx)}</span>` +
        highlightKeywords(p.text || '', kws);
    });
    row.appendChild(preview);
    row.appendChild(label);
    row.appendChild(input);
    list.appendChild(row);
  });
  $('saKwUnordered').checked = unordered;
  const first = list.querySelector('.sa-kw-input');
  if (first) first.focus();
}

function closeKwModal() {
  $('saKwModal').hidden = true;
}

async function saveKwModal() {
  if (!current || !current.qid) return;
  const rows = [...$('saKwList').querySelectorAll('.sa-kw-row')];
  const points = rows.map((row) => ({
    index: Number(row.dataset.index),
    keywords: row.querySelector('.sa-kw-input').value.trim(),
  }));
  if (!points.length) {
    alert('没有可保存的分点');
    return;
  }
  try {
    const res = await api('/api/sa/update_keywords', {
      method: 'POST',
      body: JSON.stringify({
        qid: current.qid,
        points,
        cloze_unordered: $('saKwUnordered').checked,
      }),
    });
    if (res.ok === false) {
      alert(res.error || '保存失败');
      return;
    }
    current.keywords = res.keywords || [];
    current.points = res.points || [];
    current.cloze_unordered = !!res.cloze_unordered;
    closeKwModal();
    await refreshStats();
    await loadNext();
  } catch (e) {
    alert(e.message || String(e));
  }
}

function bindUi() {
  const resetBtn = $('saResetBtn');
  if (resetBtn && !resetBtn.dataset.saBound) {
    resetBtn.dataset.saBound = '1';
    resetBtn.addEventListener('click', async () => {
      if (!confirm('确定重置全部简答训练进度？')) return;
      await api('/api/sa/reset', { method: 'POST', body: '{}' });
      await refreshStats();
      loadNext();
    });
  }
  const editBtn = $('saEditKwBtn');
  if (editBtn && !editBtn.dataset.saBound) {
    editBtn.dataset.saBound = '1';
    editBtn.addEventListener('click', openKwModal);
  }
  const cancelBtn = $('saKwCancelBtn');
  if (cancelBtn && !cancelBtn.dataset.saBound) {
    cancelBtn.dataset.saBound = '1';
    cancelBtn.addEventListener('click', closeKwModal);
  }
  const saveBtn = $('saKwSaveBtn');
  if (saveBtn && !saveBtn.dataset.saBound) {
    saveBtn.dataset.saBound = '1';
    saveBtn.addEventListener('click', saveKwModal);
  }
  const modal = $('saKwModal');
  if (modal && !modal.dataset.saBound) {
    modal.dataset.saBound = '1';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeKwModal();
    });
  }
}

async function boot() {
  bindUi();
  await refreshStats();
  await loadNext();
}

return { boot, bindUi, refreshStats, loadNext, getCurrent: () => current };
})();

if (document.documentElement.classList.contains('sa-standalone') || document.body.classList.contains('sa-app')) {
  window.SaTrain.boot();
}
