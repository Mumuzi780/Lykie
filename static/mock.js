/* 模考 + 错题本（独立于斩题主路径） */
(function (global) {
  'use strict';

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

  const $ = (id) => document.getElementById(id);
  let mockTimer = null;
  let mockStartedTs = 0;
  let mockElapsedBase = 0;
  let collectionsCache = [];
  let wrongSetsCache = [];
  let practiceKind = null; // 'mock' | 'wrong'

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h) return h + ':' + String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return mm + ':' + String(s).padStart(2, '0');
  }

  async function api(url, opts) {
    if (typeof global.api === 'function') return global.api(url, opts);
    const res = await fetch(url, opts);
    return res.json();
  }

  function stopTimer() {
    if (mockTimer) {
      clearInterval(mockTimer);
      mockTimer = null;
    }
  }

  function startTimer(elapsedSec) {
    stopTimer();
    mockElapsedBase = elapsedSec || 0;
    mockStartedTs = Date.now();
    const tick = () => {
      const el = $('mockTimer');
      if (!el) return;
      const sec = mockElapsedBase + Math.floor((Date.now() - mockStartedTs) / 1000);
      el.textContent = fmtDuration(sec);
    };
    tick();
    mockTimer = setInterval(tick, 1000);
  }

  function setMockChrome(on) {
    document.body.classList.toggle('mode-mock', !!on);
    document.body.classList.toggle('mode-wrong', practiceKind === 'wrong' && !!on);
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = !(on && practiceKind === 'mock');
    if (on) {
      document.body.classList.remove('mode-kill', 'mode-sa');
      if ($('brandSub')) $('brandSub').textContent = practiceKind === 'wrong' ? '错题' : '模考';
      if ($('stats')) $('stats').hidden = false;
      if ($('saStats')) $('saStats').hidden = true;
      if ($('killControls')) $('killControls').hidden = false; // 复用确认按钮区
      if ($('saControls')) $('saControls').hidden = true;
      if ($('progress')) $('progress').hidden = false;
      if ($('resetBtn')) $('resetBtn').hidden = true;
      if ($('saResetBtn')) $('saResetBtn').hidden = true;
      if ($('killBtn')) $('killBtn').hidden = true;
      if ($('saStack')) $('saStack').hidden = true;
    }
  }

  function hideStudyCard() {
    if (typeof global.setStudyCardVisible === 'function') global.setStudyCardVisible(false);
    const host = $('studyHost');
    if (host) host.hidden = true;
  }

  /* ---------- 侧栏模考列表 ---------- */
  function appendCollections(listEl, collections) {
    collectionsCache = collections || [];
    if (!collectionsCache.length) return;
    const head = document.createElement('li');
    head.className = 'bank-section-label';
    head.textContent = '模考';
    listEl.appendChild(head);
    collectionsCache.forEach((c) => {
      const li = document.createElement('li');
      const isActive = currentCollectionId && String(c.id) === String(currentCollectionId);
      li.className = 'bank-item bank-mock' + (isActive ? ' active' : '');
      li.dataset.collectionId = String(c.id);
      li.innerHTML =
        `<div class="bank-name">${escapeHtml(c.name)}</div>` +
        `<div class="bank-meta">${escapeHtml(c.created_at || '')}</div>` +
        `<div class="bank-progress">模考 · ${c.total} 题` +
        (c.run_count ? ` · ${c.run_count} 场` : '') +
        `</div>` +
        `<div class="bank-actions">` +
        `<button class="mini-btn" data-act="start">开考</button>` +
        `<button class="mini-btn" data-act="rename">重命名</button>` +
        `<button class="mini-btn danger" data-act="delete">删除</button>` +
        `</div>`;
      li.querySelector('[data-act="start"]').onclick = (e) => {
        e.stopPropagation();
        openCollection(c.id);
      };
      li.querySelector('[data-act="rename"]').onclick = (e) => {
        e.stopPropagation();
        renameCollection(c);
      };
      li.querySelector('[data-act="delete"]').onclick = (e) => {
        e.stopPropagation();
        deleteCollection(c);
      };
      li.onclick = () => openCollection(c.id);
      listEl.appendChild(li);
    });
  }

  async function renameCollection(c) {
    const name = await uiPrompt('模考名称：', c.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      await uiAlert('名称不能为空');
      return;
    }
    await api('/api/collections/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, name: trimmed }),
    });
    if (typeof global.refreshBanks === 'function') await global.refreshBanks();
  }

  async function deleteCollection(c) {
    if (!await uiConfirm(`删除模考「${c.name}」？\n（不会删除章节题库；错题集仍保留）`, { title: '删除模考', okText: '删除', danger: true })) return;
    await api('/api/collections/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id }),
    });
    if (typeof global.refreshBanks === 'function') await global.refreshBanks();
  }

  /* ---------- 创建模考 ---------- */
  async function openCreateCollectionModal(banks) {
    const modal = $('collectionModal');
    const box = $('collectionBankChecks');
    if (!modal || !box) return;
    const objBanks = (banks || []).filter((b) => !b.is_sa && !b.archived);
    if (objBanks.length < 2) {
      await uiAlert('至少需要 2 个客观题章节库才能组成模考');
      return;
    }
    box.innerHTML = objBanks
      .map(
        (b) =>
          `<label class="collection-check">` +
          `<input type="checkbox" value="${escapeHtml(b.id)}" />` +
          `<span>${escapeHtml(b.name)}` +
          `<small>${b.killed}/${b.total} 已斩</small></span></label>`
      )
      .join('');
    if ($('collectionNameInput')) $('collectionNameInput').value = '';
    modal.hidden = false;
  }

  async function submitCreateCollection() {
    const box = $('collectionBankChecks');
    if (!box) return;
    const ids = [...box.querySelectorAll('input:checked')].map((el) => el.value);
    if (ids.length < 2) {
      await uiAlert('请至少勾选 2 个章节');
      return;
    }
    const name = ($('collectionNameInput') && $('collectionNameInput').value.trim()) || '';
    const res = await api('/api/collections/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_bank_ids: ids, name }),
    });
    if (!res.ok) {
      await uiAlert(res.error || '创建失败');
      return;
    }
    if (res.warnings && res.warnings.length) {
      await uiAlert('已创建模考。\n\n提示：\n' + res.warnings.join('\n'));
    }
    $('collectionModal').hidden = true;
    if (typeof global.refreshBanks === 'function') await global.refreshBanks();
  }

  let lastSettleLocal = null;
  let viewingSettle = false;
  let viewingLobby = false;
  let currentCollectionId = null;

  function getActiveCollectionId() {
    return currentCollectionId;
  }

  function setActiveCollection(id) {
    currentCollectionId = id != null && id !== '' ? String(id) : null;
    syncSidebarHighlight();
  }

  function syncSidebarHighlight() {
    const list = $('bankList');
    if (!list) return;
    list.querySelectorAll('.bank-item').forEach((li) => li.classList.remove('active'));
    if (currentCollectionId) {
      const el = list.querySelector(
        '.bank-item.bank-mock[data-collection-id="' +
          String(currentCollectionId).replace(/"/g, '\\"') +
          '"]'
      );
      if (el) el.classList.add('active');
      return;
    }
    const bankId = global.currentBankId;
    if (bankId == null || bankId === '') return;
    const bankEl = list.querySelector(
      '.bank-item[data-bank-id="' + String(bankId).replace(/"/g, '\\"') + '"]'
    );
    if (bankEl) bankEl.classList.add('active');
  }

  function isExamActive() {
    return (
      practiceKind === 'mock' &&
      !viewingSettle &&
      !viewingLobby &&
      document.body.classList.contains('mode-mock')
    );
  }

  function isOnSettle() {
    return viewingSettle;
  }

  let leaveDialogResolver = null;

  function confirmLeaveExam() {
    // 返回: 'stay' | 'pause' | 'abort'
    return new Promise((resolve) => {
      const modal = $('mockLeaveModal');
      if (!modal) {
        resolve('stay');
        return;
      }
      if (leaveDialogResolver) {
        leaveDialogResolver('stay');
        leaveDialogResolver = null;
      }
      leaveDialogResolver = resolve;
      modal.hidden = false;
      if (typeof global.setModalScrollLock === 'function') global.setModalScrollLock(true);
      else document.body.classList.add('modal-scroll-lock');
    });
  }

  function closeLeaveDialog(action) {
    const modal = $('mockLeaveModal');
    if (modal) modal.hidden = true;
    if (typeof global.setModalScrollLock === 'function') global.setModalScrollLock(false);
    else document.body.classList.remove('modal-scroll-lock');
    if (leaveDialogResolver) {
      const r = leaveDialogResolver;
      leaveDialogResolver = null;
      r(action || 'stay');
    }
  }

  function bindLeaveDialog() {
    const modal = $('mockLeaveModal');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';
    const stay = $('mockLeaveStayBtn');
    const pause = $('mockLeavePauseBtn');
    const abort = $('mockLeaveAbortBtn');
    if (stay) stay.onclick = () => closeLeaveDialog('stay');
    if (pause) pause.onclick = () => closeLeaveDialog('pause');
    if (abort) abort.onclick = () => closeLeaveDialog('abort');
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeLeaveDialog('stay');
    });
  }

  /** 切到普通题库前调用；false = 取消切换（留在考场或已进结算） */
  async function guardBankSwitch() {
    // 确认页 / 结算页：允许直接切题库
    if (viewingSettle || viewingLobby) return true;
    let st = null;
    try {
      st = await api('/api/mock/status');
    } catch (e) {
      try {
        const cur = await api('/api/mock/current');
        st = {
          active: !!(cur && cur.active),
          paused: !!(cur && cur.paused),
          collection_id: cur && cur.collection_id,
        };
      } catch (e2) {
        return true;
      }
    }
    if (!st || !st.active || st.paused) return true;
    // 仅在真正考场中才拦截
    if (!isExamActive()) return true;
    const action = await confirmLeaveExam();
    if (action === 'stay') return false;
    if (action === 'abort') {
      await abortExam();
      return false;
    }
    await pauseExam();
    return true;
  }

  /** 离开模考/结算壳，不清 lastSettleLocal（点回模考仍可看结算） */
  function exitMockChrome() {
    viewingSettle = false;
    viewingLobby = false;
    practiceKind = null;
    currentCollectionId = null;
    stopTimer();
    document.body.classList.remove('mode-mock', 'mode-wrong', 'settle-view');
    if (typeof global.setSettleView === 'function') global.setSettleView(false);
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = true;
    if ($('mockTimer')) $('mockTimer').hidden = true;
    syncSidebarHighlight();
  }

  async function pauseExam() {
    stopTimer();
    await api('/api/mock/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    practiceKind = null;
    viewingSettle = false;
    document.body.classList.remove('mode-mock');
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = true;
  }

  async function abortExam() {
    stopTimer();
    const res = await api('/api/mock/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    practiceKind = null;
    if (res && res.settle) {
      showMockSettle(res.settle);
      return res.settle;
    }
    document.body.classList.remove('mode-mock');
    return null;
  }

  /* ---------- 模考作答 ---------- */
  function findCollectionMeta(collectionId) {
    return (collectionsCache || []).find((c) => String(c.id) === String(collectionId)) || null;
  }

  async function showMockLobby(collectionId, state) {
    state = state || {};
    const col = findCollectionMeta(collectionId) || {};
    const name = col.name || state.collection_name || '模考';
    const total = col.total != null ? col.total : state.total;
    const runCount = col.run_count || 0;
    const hasActive = !!state.active;
    const hasSettle = !!state.settle;
    const paused = !!state.paused;

    practiceKind = 'mock';
    viewingSettle = false;
    viewingLobby = true;
    setActiveCollection(collectionId);
    setMockChrome(false);
    document.body.classList.add('mode-mock', 'settle-view');
    if (typeof global.setSettleView === 'function') global.setSettleView(true);
    hideStudyCard();
    stopTimer();
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = true;
    if (typeof global.setBankDrawerOpen === 'function') global.setBankDrawerOpen(false);

    const empty = $('emptyState');
    empty.hidden = false;
    const metaBits = [];
    if (total != null) metaBits.push(total + ' 题');
    if (runCount) metaBits.push('已考 ' + runCount + ' 场');
    empty.innerHTML =
      `<div class="settle mock-lobby">` +
      `<p class="mock-lobby-title">${escapeHtml(name)}</p>` +
      `<p class="mock-lobby-sub">${escapeHtml(metaBits.join(' · ') || '模考')}</p>` +
      `<ul class="mock-lobby-rules">` +
      `<li><strong>离开与计时</strong>开考后若切到其他题库，可选择暂时离开（计时暂停）或交卷。点回本模考可继续未完成的考试。</li>` +
      `<li><strong>错题集</strong>答错的题会进入本模考对应的错题本，可在顶栏「错题本」里练习或合成。</li>` +
      `<li><strong>作答说明</strong>题目来自所选各章节，顺序打乱；答后不展示解析，按考试节奏连续推进。</li>` +
      `</ul>` +
      `<div class="mock-lobby-actions">` +
      (hasActive
        ? `<button type="button" class="btn primary" id="mockLobbyContinueBtn">${paused ? '继续考试' : '回到考场'}</button>`
        : `<button type="button" class="btn primary" id="mockLobbyStartBtn">${hasSettle ? '再考一场' : '开始考试'}</button>`) +
      (hasSettle && !hasActive
        ? `<button type="button" class="btn ghost" id="mockLobbySettleBtn">查看上次结算</button>`
        : '') +
      `<button type="button" class="btn ghost" id="mockLobbyBackBtn">回题库</button>` +
      `</div></div>`;

    const startBtn = $('mockLobbyStartBtn');
    if (startBtn) {
      startBtn.onclick = async () => {
        await startMock(collectionId, !!hasSettle);
      };
    }
    const contBtn = $('mockLobbyContinueBtn');
    if (contBtn) {
      contBtn.onclick = async () => {
        try {
          if (paused) {
            const res = await api('/api/mock/resume', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            await applyMockState(res && res.active ? res : state.cur || res);
          } else {
            await applyMockState(state.cur);
          }
        } catch (e) {
          await uiAlert('无法回到考场，请刷新后重试');
        }
      };
    }
    const settleBtn = $('mockLobbySettleBtn');
    if (settleBtn) {
      settleBtn.onclick = () => showMockSettle(state.settle);
    }
    const backBtn = $('mockLobbyBackBtn');
    if (backBtn) {
      backBtn.onclick = async () => {
        exitMockChrome();
        if (typeof global.setBankDrawerOpen === 'function') global.setBankDrawerOpen(true);
        if (typeof global.refreshBanks === 'function') await global.refreshBanks();
        if (typeof global.syncStudyMode === 'function') {
          const st = await global.refreshStatus();
          await global.syncStudyMode(st);
        }
      };
    }
  }

  async function openCollection(collectionId) {
    try {
      const cur = await api('/api/mock/current');
      if (cur && cur.active && cur.question) {
        if (String(cur.collection_id) !== String(collectionId)) {
          await uiAlert('另有模考进行中，请先回到该模考继续或终止后再开新场。');
          return;
        }
        // 进行中：进确认页，由用户点「继续」再进考场
        showMockLobby(collectionId, {
          active: true,
          paused: !!cur.paused,
          total: cur.total,
          cur,
        });
        return;
      }

      const settle =
        (cur && cur.settle && String(cur.settle.collection_id) === String(collectionId) && cur.settle) ||
        (lastSettleLocal && String(lastSettleLocal.collection_id) === String(collectionId) && lastSettleLocal) ||
        null;

      showMockLobby(collectionId, {
        active: false,
        settle,
        collection_name: settle && settle.collection_name,
        total: settle && settle.total,
      });
    } catch (e) {
      console.error(e);
      await uiAlert('无法打开模考：' + (e && e.message ? e.message : '请刷新后重试'));
    }
  }

  async function startMock(collectionId, forceNew) {
    practiceKind = 'mock';
    viewingSettle = false;
    viewingLobby = false;
    setActiveCollection(collectionId);
    lastSettleLocal = forceNew ? null : lastSettleLocal;
    if (typeof global.rewardReset === 'function') global.rewardReset();
    if (typeof global.setSettleView === 'function') global.setSettleView(false);
    document.body.classList.remove('settle-view');
    const res = await api('/api/mock/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection_id: collectionId, force_new: !!forceNew }),
    });
    if (!res.ok && res.error) {
      await uiAlert(res.error);
      return;
    }
    if (typeof global.setBankDrawerOpen === 'function') global.setBankDrawerOpen(false);
    await applyMockState(res);
  }

  async function applyMockState(res) {
    if (!res) {
      await uiAlert('无法进入模考');
      return;
    }
    if (typeof global.setSettleView === 'function') global.setSettleView(false);
    document.body.classList.remove('settle-view');
    if (res.done && res.settle) {
      stopTimer();
      showMockSettle(res.settle);
      return;
    }
    if (!res.active || !res.question) {
      stopTimer();
      if (res.error) await uiAlert(res.error);
      else await uiAlert('模考没有可作答题目');
      return;
    }
    practiceKind = 'mock';
    viewingSettle = false;
    viewingLobby = false;
    if (res.collection_id) setActiveCollection(res.collection_id);
    setMockChrome(true);
    showStudyCard();
    startTimer(res.elapsed_sec || 0);
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = false;
    if ($('mockTimer')) $('mockTimer').hidden = false;
    if ($('stats')) {
      $('stats').textContent =
        `模考 · ${res.index}/${res.total}` +
        (res.run_index ? ` · 第 ${res.run_index} 场` : '');
    }
    if ($('progress')) {
      $('progress').textContent = `对 ${res.correct_count || 0} · 错 ${res.wrong_count || 0}`;
    }
    if (window.LykieFx) LykieFx.setComboBadge(res.streak || 0, false);
    renderMockQuestion(res.question, 'mock');
  }

  function showStudyCard() {
    if (typeof global.setSettleView === 'function') global.setSettleView(false);
    document.body.classList.remove('settle-view');
    const stage = $('studyStage');
    if (stage) stage.hidden = false;
    const host = $('studyHost');
    if (host) host.hidden = false;
    if ($('saStack')) $('saStack').hidden = true;
    if ($('saCard')) $('saCard').hidden = true;
    if ($('cardStack')) $('cardStack').hidden = false;
    if ($('card')) $('card').hidden = false;
    if ($('emptyState')) $('emptyState').hidden = true;
  }

  function renderMockQuestion(q, kind) {
    practiceKind = kind;
    global.current = q;
    global.submitted = false;
    global.userChoice = null;
    if ($('cardType')) {
      $('cardType').textContent =
        q.type === 'choice' ? (q.multi ? '多选题' : '选择题') : q.type === 'judge' ? '判断题' : '填空题';
    }
    if ($('cardStem')) $('cardStem').textContent = q.stem;
    if ($('cardMeta')) {
      $('cardMeta').textContent = q.bank_name ? `来自：${q.bank_name}` : '';
      $('cardMeta').hidden = !q.bank_name;
    }
    if ($('answerBox')) $('answerBox').hidden = true;
    if ($('askLykieBtn')) $('askLykieBtn').hidden = true;
    if ($('editBtn')) $('editBtn').hidden = true;
    if ($('killBtn')) $('killBtn').hidden = true;

    const opts = $('options');
    const fill = $('fillArea');
    opts.innerHTML = '';
    if (q.type === 'fill') {
      opts.hidden = true;
      fill.hidden = false;
      $('fillInput').value = '';
      $('fillInput').disabled = false;
      $('confirmBtn').hidden = false;
      $('confirmBtn').textContent = '确认答案';
      $('confirmBtn').onclick = () => submitMockFill();
      $('nextBtn').hidden = true;
      $('judgeBtns').hidden = true;
    } else {
      fill.hidden = true;
      opts.hidden = false;
      $('confirmBtn').hidden = true;
      $('nextBtn').hidden = true;
      $('judgeBtns').hidden = true;
      (q.options || []).forEach((text) => {
        const letter = text.includes('.') ? text.split('.')[0] : text;
        const btn = document.createElement('button');
        btn.className = 'opt';
        btn.textContent = text;
        btn.dataset.value = letter;
        if (q.multi) {
          btn.onclick = () => btn.classList.toggle('selected');
        } else {
          btn.onclick = () => submitMockChoice(letter, btn);
        }
        opts.appendChild(btn);
      });
      if (q.multi) {
        $('confirmBtn').hidden = false;
        $('confirmBtn').textContent = '提交多选';
        $('confirmBtn').onclick = () => submitMockMulti();
      }
    }
    if (typeof global.hideAllBtns === 'function' && q.type !== 'fill' && !q.multi) {
      /* keep footer clean */
    }
  }

  function gradeChoice(letterOrArr) {
    const q = global.current;
    if (!q) return false;
    if (q.multi) {
      const picked = (Array.isArray(letterOrArr) ? letterOrArr : [letterOrArr]).map((x) =>
        String(x).toUpperCase()
      );
      const ans = String(q.answer || '')
        .toUpperCase()
        .replace(/[^A-H]/g, '');
      const setA = new Set(ans.split(''));
      const setB = new Set(picked);
      if (setA.size !== setB.size) return false;
      for (const x of setA) if (!setB.has(x)) return false;
      return true;
    }
    return String(letterOrArr).toUpperCase() === String(q.answer || '').toUpperCase();
  }

  async function afterJudge(ok) {
    const q = global.current;
    document.querySelectorAll('.opt').forEach((b) => {
      b.disabled = true;
      if (q.type === 'choice' || q.type === 'judge') {
        const v = b.dataset.value;
        if (q.multi) {
          const ans = new Set(
            String(q.answer || '')
              .toUpperCase()
              .replace(/[^A-H]/g, '')
              .split('')
          );
          if (ans.has(String(v).toUpperCase())) b.classList.add('correct');
          else if (b.classList.contains('selected') && !ok) b.classList.add('wrong');
        } else {
          if (String(v).toUpperCase() === String(q.answer || '').toUpperCase()) b.classList.add('correct');
          else if (b.classList.contains('selected') || (!ok && b === document.activeElement)) {
            /* marked below */
          }
        }
      }
    });
    if (!ok && q.type !== 'fill') {
      document.querySelectorAll('.opt.selected').forEach((b) => b.classList.add('wrong'));
    }
    // 模考不展示黄色答案/解析区，只靠选项对错色；错题练习可看答案（仍不带解析）
    if ($('answerBox')) {
      if (practiceKind === 'mock') {
        $('answerBox').hidden = true;
        $('answerBox').innerHTML = '';
      } else {
        $('answerBox').hidden = false;
        $('answerBox').innerHTML =
          `<div class="${ok ? 'ok' : 'bad'}">${ok ? '正确' : '错误'}</div>` +
          `<div>答案：${escapeHtml(q.answer_text || q.answer || '')}</div>`;
      }
    }
    if (window.LykieSfx) {
      if (ok) LykieSfx.onCorrect && LykieSfx.onCorrect();
      else LykieSfx.onWrong && LykieSfx.onWrong();
    }
    await new Promise((r) => setTimeout(r, ok ? 450 : 700));
    if (practiceKind === 'wrong') await postWrongAnswer(ok);
    else await postMockAnswer(ok);
  }

  async function submitMockChoice(letter, btn) {
    if (global.submitted) return;
    global.submitted = true;
    document.querySelectorAll('.opt').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    const ok = gradeChoice(letter);
    await afterJudge(ok);
  }

  async function submitMockMulti() {
    if (global.submitted) return;
    const picked = [...document.querySelectorAll('.opt.selected')].map((b) => b.dataset.value);
    if (!picked.length) {
      await uiAlert('请先选择选项');
      return;
    }
    global.submitted = true;
    const ok = gradeChoice(picked);
    await afterJudge(ok);
  }

  async function submitMockFill() {
    if (global.submitted) return;
    const raw = ($('fillInput').value || '').trim();
    if (!raw) {
      await uiAlert('请输入答案');
      return;
    }
    global.submitted = true;
    $('fillInput').disabled = true;
    const ans = String(global.current.answer || '').trim();
    const ok = raw.toLowerCase() === ans.toLowerCase();
    await afterJudge(ok);
  }

  async function postMockAnswer(ok) {
    const res = await api('/api/mock/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct: !!ok }),
    });
    if (!res.ok && res.error) {
      await uiAlert(res.error);
      return;
    }
    if (window.LykieFx) LykieFx.setComboBadge(res.streak || 0, !!ok);
    if (res.done && res.settle) {
      stopTimer();
      showMockSettle(res.settle);
      return;
    }
    if (res.next) await applyMockState(res.next);
  }

  function showMockSettle(s) {
    practiceKind = 'mock';
    viewingSettle = true;
    viewingLobby = false;
    lastSettleLocal = s;
    if (s && s.collection_id) setActiveCollection(s.collection_id);
    setMockChrome(false);
    document.body.classList.add('mode-mock', 'settle-view');
    if (typeof global.setSettleView === 'function') global.setSettleView(true);
    hideStudyCard();
    stopTimer();
    if ($('mockTimerWrap')) $('mockTimerWrap').hidden = true;
    const empty = $('emptyState');
    empty.hidden = false;
    const wrongHtml = (s.wrong_cards || [])
      .map(
        (w, i) =>
          `<article class="mock-wrong-card">` +
          `<div class="mock-wrong-top">#${i + 1}` +
          (w.bank_name ? ` · ${escapeHtml(w.bank_name)}` : '') +
          `</div>` +
          `<div class="mock-wrong-stem">${escapeHtml(w.stem)}</div></article>`
      )
      .join('');
    empty.innerHTML =
      `<div class="settle mock-settle">` +
      `<p class="settle-title">模考结束</p>` +
      `<p class="settle-sub">${escapeHtml(s.collection_name || '')} · 第 ${s.run_index || 1} 场</p>` +
      `<div class="mock-settle-grid">` +
      `<div class="mock-settle-tile"><span class="lab">得分</span><span class="val">${s.score} 分</span></div>` +
      `<div class="mock-settle-tile"><span class="lab">用时</span><span class="val">${fmtDuration(s.duration_sec)}</span></div>` +
      `<div class="mock-settle-tile"><span class="lab">最高连击</span><span class="val">×${s.max_streak || 0}</span></div>` +
      `<div class="mock-settle-tile"><span class="lab">题量</span><span class="val">共 ${s.total} · 对 ${s.correct_count} · 错 ${s.wrong_count}</span></div>` +
      `</div>` +
      `<h4 class="settle-detail-h">本场错题</h4>` +
      (wrongHtml
        ? `<div class="mock-wrong-list">${wrongHtml}</div>`
        : `<p class="settle-muted">本场没有错题</p>`) +
      `<div class="mock-settle-actions">` +
      (s.wrong_set_id && s.wrong_count
        ? `<button type="button" class="btn primary" id="mockPracticeWrongBtn">练习本场错题</button>`
        : '') +
      `<button type="button" class="btn primary" id="mockRetryBtn">再考一场</button>` +
      `<button type="button" class="btn ghost" id="mockBackBanksBtn">回题库</button>` +
      `</div></div>`;
    const pb = $('mockPracticeWrongBtn');
    if (pb) pb.onclick = () => startWrongPractice(s.wrong_set_id);
    const rb = $('mockRetryBtn');
    if (rb) {
      rb.onclick = () => {
        showMockLobby(s.collection_id, {
          active: false,
          settle: s,
          collection_name: s.collection_name,
          total: s.total,
        });
      };
    }
    const bb = $('mockBackBanksBtn');
    if (bb) {
      bb.onclick = async () => {
        // 保留 lastSettleLocal / 服务端 last_mock_settle，点回模考可再看
        exitMockChrome();
        if (typeof global.setBankDrawerOpen === 'function') global.setBankDrawerOpen(true);
        if (typeof global.refreshBanks === 'function') await global.refreshBanks();
        if (typeof global.syncStudyMode === 'function') {
          const st = await global.refreshStatus();
          await global.syncStudyMode(st);
        }
      };
    }
  }

  /* ---------- 错题本 ---------- */
  function openWrongBookModal() {
    const modal = $('wrongBookModal');
    if (!modal) return;
    renderWrongBookList();
    modal.hidden = false;
  }

  async function renderWrongBookList() {
    const box = $('wrongBookList');
    if (!box) return;
    const list = wrongSetsCache || [];
    if (!list.length) {
      box.innerHTML = '<p class="settle-muted">还没有错题集。模考答错后会自动生成。</p>';
      return;
    }
    box.innerHTML = list
      .map(
        (w) =>
          `<label class="wrong-set-row">` +
          `<input type="checkbox" class="wrong-merge-ck" value="${escapeHtml(w.id)}" />` +
          `<div class="wrong-set-main">` +
          `<div class="wrong-set-name">${escapeHtml(w.name)}</div>` +
          `<div class="wrong-set-meta">${w.count} 题 · ${escapeHtml(w.kind === 'merged' ? '合成' : '模考')}</div>` +
          `</div>` +
          `<button type="button" class="btn ghost mini-btn" data-practice="${escapeHtml(w.id)}">练习</button>` +
          `<button type="button" class="btn ghost mini-btn danger" data-del="${escapeHtml(w.id)}">删除</button>` +
          `</label>`
      )
      .join('');
    box.querySelectorAll('[data-practice]').forEach((btn) => {
      btn.onclick = () => {
        $('wrongBookModal').hidden = true;
        startWrongPractice(btn.getAttribute('data-practice'));
      };
    });
    box.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!await uiConfirm('删除这个错题集？', { title: '删除错题集', okText: '删除', danger: true })) return;
        await api('/api/wrong_sets/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: btn.getAttribute('data-del') }),
        });
        await refreshWrongCache();
        renderWrongBookList();
      };
    });
  }

  async function refreshWrongCache() {
    const data = await api('/api/wrong_sets');
    wrongSetsCache = data.wrong_sets || [];
    return wrongSetsCache;
  }

  async function mergeSelectedWrongSets() {
    const ids = [...document.querySelectorAll('.wrong-merge-ck:checked')].map((el) => el.value);
    if (ids.length < 2) {
      await uiAlert('请至少勾选 2 个错题集');
      return;
    }
    const name = await uiPrompt('合成后的名称（可留空）：', '') || '';
    const res = await api('/api/wrong_sets/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, name }),
    });
    if (!res.ok) {
      await uiAlert(res.error || '合成失败');
      return;
    }
    wrongSetsCache = res.wrong_sets || [];
    renderWrongBookList();
  }

  async function startWrongPractice(wrongSetId) {
    practiceKind = 'wrong';
    if (typeof global.rewardReset === 'function') global.rewardReset();
    if (typeof global.setSettleView === 'function') global.setSettleView(false);
    document.body.classList.remove('settle-view');
    const res = await api('/api/wrong/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrong_set_id: wrongSetId }),
    });
    if (!res.ok && res.error) {
      await uiAlert(res.error);
      return;
    }
    await applyWrongState(res);
  }

  async function applyWrongState(res) {
    if (!res) return;
    if (res.done || !res.active) {
      stopTimer();
      setMockChrome(false);
      hideStudyCard();
      const empty = $('emptyState');
      empty.hidden = false;
      empty.innerHTML =
        `<div class="settle"><p class="settle-title">错题练完了</p>` +
        `<p class="hint">答对的已移出错题集</p>` +
        `<button type="button" class="btn primary" id="wrongDoneBack">回错题本</button></div>`;
      const b = $('wrongDoneBack');
      if (b) {
        b.onclick = async () => {
          await refreshWrongCache();
          openWrongBookModal();
        };
      }
      return;
    }
    setMockChrome(true);
    showStudyCard();
    stopTimer();
    if ($('stats')) $('stats').textContent = `错题练习 · ${res.index}/${res.total}`;
    if ($('progress')) $('progress').textContent = '答对即移出';
    if ($('mockTimer')) $('mockTimer').textContent = '';
    renderMockQuestion(res.question, 'wrong');
  }

  async function postWrongAnswer(ok) {
    const res = await api('/api/wrong/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct: !!ok }),
    });
    if (!res.ok && res.error) {
      await uiAlert(res.error);
      return;
    }
    if (res.wrong_sets) wrongSetsCache = res.wrong_sets;
    if (res.done) {
      await applyWrongState({ done: true, active: false });
      return;
    }
    if (res.next) await applyWrongState(res.next);
  }

  function bindUi() {
    bindLeaveDialog();
    const createBtn = $('collectionCreateBtn');
    if (createBtn) createBtn.onclick = async () => {
      const data = await api('/api/banks');
      openCreateCollectionModal(data.banks || []);
    };
    const closeCol = $('collectionModalClose');
    if (closeCol) closeCol.onclick = () => { $('collectionModal').hidden = true; };
    const closeCol2 = $('collectionModalClose2');
    if (closeCol2) closeCol2.onclick = () => { $('collectionModal').hidden = true; };
    const submitCol = $('collectionCreateSubmit');
    if (submitCol) submitCol.onclick = () => submitCreateCollection();
    const wb = $('wrongBookBtn');
    if (wb) wb.onclick = async () => {
      await refreshWrongCache();
      openWrongBookModal();
    };
    const wClose = $('wrongBookModalClose');
    if (wClose) wClose.onclick = () => { $('wrongBookModal').hidden = true; };
    const mergeBtn = $('wrongMergeBtn');
    if (mergeBtn) mergeBtn.onclick = () => mergeSelectedWrongSets();
  }

  function onBanksPayload(data) {
    if (data && data.collections) collectionsCache = data.collections;
    if (data && data.wrong_sets) wrongSetsCache = data.wrong_sets;
  }

  global.LykieMock = {
    appendCollections,
    onBanksPayload,
    openCreateCollectionModal,
    openWrongBookModal,
    refreshWrongCache,
    startMock,
    openCollection,
    guardBankSwitch,
    exitMockChrome,
    getActiveCollectionId,
    setActiveCollection,
    syncSidebarHighlight,
    isExamActive,
    isOnSettle,
    bindUi,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }
})(window);
