/* 学习时长：作答驱动计时。
   - 题库区：显示题目即开始（含思考），提交判分后暂停；题间过渡不计。
   - 英语阅读区：按大题（节）计时，一次连续作答 = 一条记录。
     唯一的开始条件是「停留」：正文停在某一节超过 5 秒才开始计时（读文章、读题干、思考都算），
     作答、切 tab、打开题目卡等操作本身不触发计时。
     停在别的节超过 5 秒 → 切到那一节：离开当前节的那一刻就停表（等待的 5 秒不计入，5 秒内滚回来则继续），
     新的一节从 0:05 起算；点侧栏节条目切节 → 立即停止当前节，新的一节同样等停留 5 秒。
     双击侧栏节条目可手动开始/停止；手动停止后 10 分钟内这一节不会自动开始（双击可立即开始）。
     整节答完对答案即结束，答完的节不再计时；退出阅读 = 离开，回来算新的一次。
   - 暂停：页面不可见自动暂停。英语节 60 秒无操作先提醒（计时不停），
     3 分钟无操作才暂停，只认阅读区内的操作；题库区 30 秒无操作暂停。
   页面配置：window.LykieStudyTimeConfig = { area: 'auto' | 'bank' | 'english' } */
(function () {
  'use strict';

  var CFG = window.LykieStudyTimeConfig || {};
  var AREA_FIXED = (CFG.area === 'bank' || CFG.area === 'english') ? CFG.area : null;
  var IDLE_MS = 30 * 1000;          // 题库区：30 秒无操作自动暂停
  var REMIND_MS = 60 * 1000;        // 英语节：60 秒无操作提醒（计时不停）
  var SEC_IDLE_MS = 3 * 60 * 1000;  // 英语节：3 分钟无操作暂停
  var RESUME_TOAST_MS = 10 * 1000;  // 暂停超过 10 秒，恢复时提示暂停了多久
  var DWELL_MS = 5 * 1000;          // 英语节：正文在同一节连续停留 5 秒才开始计时
  var MIN_ATTEMPT_SEC = 15;         // 用时不足 15 秒的节不落记录（路过式滚动）
  var MANUAL_STOP_MS = 10 * 60 * 1000; // 手动停止后，这段时间内该节不自动开始计时
  var HEARTBEAT_MS = 30 * 1000;
  var TICK_MS = 1000;

  var AREA_LABEL = { bank: '题库', english: '英语' };
  var AREA_COLOR = { bank: 'var(--primary)', english: 'var(--answer-text)' };
  // 阅读区范围内的操作才算「在作答」：正文、题目球/卡片、以及挂在 body 下的 rd-* 浮层（查词卡、选题层、问 AI）
  var READ_AREA_SEL = '#readView, #rdQBall, #rdQCard, .rd-toolbar-only, [class^="rd-"], [class*=" rd-"]';

  var pending = { bank: 0, english: 0 }; // 待上报秒数（按区）
  var pendingSections = {};              // 待上报秒数（按题块）：{ "<textId>::<key>": {seconds, label, kind, text_title} }
  var pendingAttempts = [];              // 待上报的节作答记录
  var activeQ = null;                    // 进行中的题：{ area, secKey, textId, qId, label, kind, textTitle }
  var activeSec = null;                  // 进行中的节：{ secKey, textId, label, kind, name, unit, textTitle, fresh, total,
                                        //   snapshot, accMs, runStart, pausedMs, pauseStart, reported }
  var inViewSec = null;            // 正文当前停在的节：{ key, make, at }（at = 开始停留的时刻）
  var dwellTimer = null;           // 停留倒计时
  var dwellPending = false;        // 倒计时到点时页面不可见，等回到页面再起算
  var manualStop = null;           // 手动停止的节：{ key, at }（at = 停止时刻；10 分钟内不自动开始）
  var lastFinished = null;               // 最近结束的节记录：{ id, dur }（侧栏「本次」显示）
  var today = { bank: 0, english: 0 };   // 服务端今日累计（按区）
  var todaySections = {};                // 服务端今日累计（按题块）：secId -> {today, label, kind, text_title}
  var standards = {};                    // 题型 -> 考场参考时限（秒）
  var sessionSec = 0;                    // 本次打开页面的有效时长
  var sessionSections = {};              // 本次会话各题块秒数（侧栏节计时显示用）
  var lastActivity = Date.now();
  var paused = false;                    // 空闲/失焦暂停
  var reminded = false;                  // 本轮无操作已提醒过（有操作后重置）
  var timerId = null;
  var beatId = null;

  function $(id) { return document.getElementById(id); }

  function currentArea() {
    if (AREA_FIXED) return AREA_FIXED;
    return document.body.classList.contains('mode-reading') ? 'english' : 'bank';
  }

  function secId(textId, key) { return textId + '::' + key; }

  // ---------- 状态机 API（页面各处 hook） ----------

  /** 题库区：显示题目（开始处理本题，含思考时间） */
  function questionShown() {
    activeQ = { area: 'bank', secKey: null, textId: null, qId: null };
    paused = false;
    lastActivity = Date.now();
  }

  /** 题库区：提交判分/显示答案（本题结束） */
  function questionDone() {
    if (activeQ && activeQ.area === 'bank') activeQ = null;
  }

  /** 翻译页：做出作答动作。info: { qId, secKey, textId, label, kind, textTitle } */
  function answerStarted(info) {
    info = info || {};
    activeQ = {
      area: 'english',
      secKey: info.secKey || null,
      textId: info.textId || null,
      qId: info.qId == null ? null : String(info.qId),
      label: info.label || '',
      kind: info.kind || '',
      textTitle: info.textTitle || '',
    };
    paused = false;
    lastActivity = Date.now();
  }

  /** sinceMs：这条记录从何时算起（毫秒时间戳）；停留满 5 秒开始的，把停留的 5 秒也算进去 */
  function startSec(info, sinceMs) {
    var now = Date.now();
    activeSec = {
      secKey: String(info.secKey),
      textId: String(info.textId),
      label: info.label || '',
      kind: info.kind || '',
      name: info.name || info.label || '本节',
      unit: info.unit || '题',
      textTitle: info.textTitle || '',
      fresh: !!info.fresh,
      total: info.total == null ? 0 : (Number(info.total) || 0),
      snapshot: typeof info.snapshot === 'function' ? info.snapshot : null,
      frozen: false, // 已离开这一节、还在等 5 秒停留：停表但不结束记录，回来可继续
      accMs: Math.max(0, now - (sinceMs || now)), runStart: now, pausedMs: 0, pauseStart: 0, reported: 0,
    };
    paused = false;
    reminded = false;
    lastActivity = Date.now();
    render();
  }

  /** 英语阅读区：正文当前停在某一节（滚动联动、进入文章时调用）。make: () => info
   *  唯一的开始条件：在同一节上连续停留超过 DWELL_MS 才开始计时；换节则重新计停留时间。
   *  info: { secKey, textId, label, kind, name, unit, textTitle, fresh, total, snapshot } */
  function sectionInView(make) {
    var info = (typeof make === 'function' ? make() : make) || {};
    if (!info.secKey || !info.textId) return;
    var key = secId(info.textId, info.secKey);
    if (inViewSec && inViewSec.key === key) return; // 没换节：停留时间继续累计
    inViewSec = {
      key: key,
      make: typeof make === 'function' ? make : function () { return info; },
      at: Date.now(),
    };
    if (activeSec) {
      if (secId(activeSec.textId, activeSec.secKey) === key) resumeSec(); // 5 秒内又滚回来了：同一条记录继续
      else freezeSec(); // 离开当前节：立即停表，等待的 5 秒不计入；满 5 秒才换节
    }
    armDwell();
  }

  function freezeSec() {
    if (activeSec.runStart) { activeSec.accMs += Date.now() - activeSec.runStart; activeSec.runStart = null; }
    activeSec.frozen = true;
    setPaused(isPaused());
    render();
  }

  function resumeSec() {
    activeSec.frozen = false;
    activeSec.runStart = Date.now();
    lastActivity = Date.now();
    reminded = false;
    setPaused(isPaused());
    render();
  }

  function armDwell() {
    clearTimeout(dwellTimer);
    dwellTimer = null;
    dwellPending = false;
    if (!inViewSec) return;
    if (document.hidden) { dwellPending = true; return; }
    var fire = function () {
      dwellTimer = null;
      var v = inViewSec;
      if (!v) return;
      if (document.hidden) { dwellPending = true; return; }
      if (activeSec && secId(activeSec.textId, activeSec.secKey) === v.key) return; // 已在计时：继续
      var info = v.make();
      if (!info || !info.secKey) return;
      finalizeSec('leave'); // 停在别的节满 5 秒 = 换节：上一条记为离开
      if (info.finished) return; // 已答完的节不再计时（同一套卷一般不会答第二次）
      if (manualStop && manualStop.key === v.key && Date.now() - manualStop.at < MANUAL_STOP_MS) return; // 手动停止后 10 分钟内不自动开始
      startSec(info, v.at);
    };
    var remain = DWELL_MS - (Date.now() - inViewSec.at);
    if (remain > 0) dwellTimer = setTimeout(fire, remain); else fire();
  }

  function clearDwell() {
    clearTimeout(dwellTimer);
    dwellTimer = null;
    dwellPending = false;
    inViewSec = null;
  }

  /** 手动开关（双击侧栏节条目）：正在计时 → 立即停止（记为离开）；否则立即开始，不等停留 */
  function sectionToggle(make) {
    var info = (typeof make === 'function' ? make() : make) || {};
    if (!info.secKey || !info.textId) return;
    var key = secId(info.textId, info.secKey);
    var wasActive = !!activeSec && secId(activeSec.textId, activeSec.secKey) === key;
    var make2 = typeof make === 'function' ? make : function () { return info; };
    clearTimeout(dwellTimer);
    dwellTimer = null;
    dwellPending = false;
    finalizeSec('leave');
    // 视为已在这一节停留满：之后滚动联动仍停在这一节，不会重新触发停留倒计时
    inViewSec = { key: key, make: make2, at: Date.now() - DWELL_MS };
    if (wasActive) {
      manualStop = { key: key, at: Date.now() };
      toast('已停止计时。10 分钟内这一节不会自动开始计时，双击侧栏节条目可立即开始。', 8000);
    } else {
      if (manualStop && manualStop.key === key) manualStop = null;
      startSec(info, 0);
    }
  }

  /** 英语阅读区：立刻停止当前节（点侧栏节条目切节时调用）。keepId：目标节正是当前节则不停 */
  function sectionLeave(keepId) {
    if (activeSec && secId(activeSec.textId, activeSec.secKey) !== keepId) finalizeSec('leave');
  }

  /** 英语阅读区：该节答完。secKey 不是当前节则忽略 */
  function sectionDone(secKey) {
    if (activeSec && activeSec.secKey === String(secKey)) finalizeSec('done');
  }

  /** 视图切换（进/出阅读、换卷）：清活跃题并结束当前节记录。
   *  keepTextId：仍停留在同一篇文章时不结束（侧栏切节由 sectionLeave 处理） */
  function resetArea(keepTextId) {
    activeQ = null;
    if (activeSec && activeSec.textId === String(keepTextId || '')) return;
    clearDwell();
    finalizeSec('leave');
  }

  window.LykieStudyTime = {
    questionShown: questionShown,
    questionDone: questionDone,
    answerStarted: answerStarted,
    sectionInView: sectionInView,
    sectionToggle: sectionToggle,
    sectionLeave: sectionLeave,
    sectionDone: sectionDone,
    resetArea: resetArea,
  };

  // ---------- 格式化 ----------

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  function fmtMinutes(sec) {
    var m = Math.max(0, Math.floor(sec)) / 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      var rest = Math.round(m % 60);
      return h + 'h' + (rest ? rest + 'm' : '');
    }
    return (Math.round(m * 10) / 10) + 'm';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 轻提示（不阻塞：不用 alert，alert 会卡住脚本连计时一起停） ----------

  var toastEl = null;
  var toastTimer = null;
  var toastSticky = false; // true = 一直显示到有操作

  function toast(text, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'study-toast';
      toastEl.id = 'studyToast';
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastSticky = !ms;
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    toastSticky = false;
    if (toastEl) toastEl.hidden = true;
  }

  function remindText() {
    var t = '已经 1 分钟没有操作了。《' + activeSec.name + '》这一节用了 ' + fmt(secLiveMs() / 1000);
    var std = standards[activeSec.kind];
    return t + (std ? '，考场建议 ' + fmt(std) + ' 内完成，留意一下节奏。' : '，留意一下节奏。');
  }

  function doneText(s, dur, answered, total) {
    var t = '《' + s.name + '》完成，用时 ' + fmt(dur);
    if (answered != null && total) t += '（' + answered + '/' + total + ' ' + s.unit + '）';
    var std = standards[s.kind];
    if (std) t += dur <= std ? '，在建议的 ' + fmt(std) + ' 内。' : '，超过建议的 ' + fmt(std) + '。';
    return t;
  }

  // ---------- 节记录 ----------

  /** 本次记录的有效用时（毫秒，含正在进行的片段，不含暂停） */
  function secLiveMs() {
    return activeSec.accMs + (activeSec.runStart ? Date.now() - activeSec.runStart : 0);
  }

  function addSectionSeconds(s, add) {
    pending.english += add;
    sessionSec += add;
    var id = secId(s.textId, s.secKey);
    var e = pendingSections[id] || { seconds: 0, label: s.label || '', kind: s.kind || '', text_title: s.textTitle || '' };
    e.seconds += add;
    pendingSections[id] = e;
    sessionSections[id] = (sessionSections[id] || 0) + add;
  }

  /** 结束当前节记录：零头秒数进当日累计，够长的落一条「本次」记录并立即上报 */
  function finalizeSec(reason) {
    var s = activeSec;
    if (!s) return;
    var t = Date.now();
    if (s.runStart) { s.accMs += t - s.runStart; s.runStart = null; }
    if (s.pauseStart) { s.pausedMs += t - s.pauseStart; s.pauseStart = 0; }
    activeSec = null;
    var live = Math.floor(s.accMs / 1000);
    if (live > s.reported) addSectionSeconds(s, live - s.reported);
    var dur = Math.round(s.accMs / 1000);
    if (dur < MIN_ATTEMPT_SEC) { render(); heartbeat(); return; }
    var snap = s.snapshot ? (s.snapshot() || {}) : {};
    var answered = snap.answered == null ? null : snap.answered;
    var total = snap.total == null ? s.total : snap.total;
    var done = reason === 'done' || !!snap.done;
    lastFinished = { id: secId(s.textId, s.secKey), dur: dur };
    pendingAttempts.push({
      id: secId(s.textId, s.secKey),
      dur: dur,
      paused: Math.round(s.pausedMs / 1000),
      answered: answered,
      total: total,
      fresh: s.fresh,
      done: done,
      label: s.label || '',
      kind: s.kind || '',
      text_title: s.textTitle || '',
    });
    if (reason === 'done') toast(doneText(s, dur, answered, total), 10000);
    render();
    heartbeat();
  }

  // ---------- 活动与暂停 ----------

  function inReadingArea(ev) {
    var t = ev.target;
    if (!t || t === window || t === document || t === document.body || t === document.documentElement) {
      // 空白处的键盘/滚动：阅读态下视为在读
      return document.body.classList.contains('mode-reading');
    }
    if (t.nodeType !== 1) t = t.parentElement;
    return !!(t && t.closest && t.closest(READ_AREA_SEL));
  }

  function onActivity(ev) {
    if (activeSec && !inReadingArea(ev)) return; // 只认阅读区内的操作
    lastActivity = Date.now();
    reminded = false;
    if (toastSticky) hideToast();
    if ((activeQ || activeSec) && paused && !document.hidden) { setPaused(isPaused()); render(); } // 重新操作：继续计时
  }

  function isIdle() { return Date.now() - lastActivity > IDLE_MS; }

  function isPaused() {
    if (document.hidden) return true;
    if (activeSec) return activeSec.frozen || Date.now() - lastActivity > SEC_IDLE_MS;
    if (activeQ) return isIdle();
    return false; // 无进行中的题/节：不累计（badge 显示「待作答」）
  }

  /** 节计时按时间戳结算：暂停时截断当前片段，恢复时重新起算，不用每秒 +1（起停瞬间会丢零头） */
  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    if (!activeSec) return;
    var t = Date.now();
    if (p) {
      if (activeSec.runStart) { activeSec.accMs += t - activeSec.runStart; activeSec.runStart = null; }
      activeSec.pauseStart = t;
      if (!document.hidden && !activeSec.frozen) { // 离开当前节（等停留）时的暂停不提示
        toast('已暂停计时：超过 3 分钟没有操作。回来后在阅读区操作一下即可继续，暂停的时长不计入本次用时。', 0);
      }
    } else {
      var gap = activeSec.pauseStart ? t - activeSec.pauseStart : 0;
      activeSec.pausedMs += gap;
      activeSec.pauseStart = 0;
      if (activeSec.frozen) return; // 仍停在别的节：保持停表
      activeSec.runStart = t;
      if (gap >= RESUME_TOAST_MS) toast('已继续计时，刚才暂停了 ' + fmt(gap / 1000) + '。', 5000);
    }
  }

  // ---------- 渲染 ----------

  function render() {
    var area = currentArea();
    var wrap = $('studyTimerWrap');
    if (!wrap) return;
    var areaEl = $('studyTimerArea');
    var todayEl = $('studyTimerToday');
    var sessionEl = $('studyTimerSession');
    var pausedEl = $('studyTimerPaused');
    if (areaEl) areaEl.textContent = AREA_LABEL[area] || '';
    if (todayEl) todayEl.textContent = fmt(today[area]);
    if (sessionEl) sessionEl.textContent = fmt(sessionSec);
    wrap.classList.toggle('is-paused', paused);
    if (pausedEl) {
      if (!activeQ && !activeSec) {
        pausedEl.textContent = '待作答';
        pausedEl.hidden = false;
      } else if (paused) {
        pausedEl.textContent = '已暂停';
        pausedEl.hidden = false;
      } else {
        pausedEl.hidden = true;
      }
    }
    renderSidebarTimes();
  }

  /** 侧栏节选项处的节计时：进行中/刚结束的节显示「本次」用时，活跃节实时跳动并高亮；其余显示今日累计 */
  function renderSidebarTimes() {
    var items = document.querySelectorAll('#bankList .paper-item[data-text-id][data-sec]');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var id = secId(li.dataset.textId, li.dataset.sec);
      var span = li.querySelector('.paper-item-time');
      if (!span) {
        span = document.createElement('span');
        span.className = 'paper-item-time';
        li.appendChild(span);
      }
      var active = !!(activeSec && activeSec.textId === li.dataset.textId && activeSec.secKey === li.dataset.sec);
      var justFinished = !active && !!lastFinished && lastFinished.id === id;
      var total = (todaySections[id] ? todaySections[id].today : 0) + (sessionSections[id] || 0);
      var text = active ? '本次 ' + fmt(secLiveMs() / 1000)
        : justFinished ? '本次 ' + fmt(lastFinished.dur)
        : total > 0 ? fmt(total) : '';
      li.classList.toggle('is-timing', active && !paused);
      span.textContent = text;
      span.hidden = !text;
      span.title = (active || justFinished) ? '本次用时（今日累计 ' + fmt(total) + '）' : '今日累计';
    }
  }

  function tick() {
    var p = isPaused();
    setPaused(p);
    if (!p) {
      if (activeQ) {
        pending[activeQ.area] += 1;
        sessionSec += 1;
      }
      if (activeSec) {
        var live = Math.floor(secLiveMs() / 1000);
        if (live > activeSec.reported) {
          addSectionSeconds(activeSec, live - activeSec.reported);
          activeSec.reported = live;
        }
        if (!reminded && Date.now() - lastActivity > REMIND_MS) {
          reminded = true;
          toast(remindText(), 0);
        }
      }
    }
    render();
  }

  // ---------- 上报 ----------

  function sectionsPayload() {
    var ids = Object.keys(pendingSections);
    if (!ids.length) return null;
    var out = {};
    ids.forEach(function (id) { out[id] = pendingSections[id]; });
    pendingSections = {};
    return out;
  }

  function rollbackSections(payload) {
    if (!payload) return;
    Object.keys(payload).forEach(function (id) {
      var prev = pendingSections[id];
      pendingSections[id] = prev
        ? { seconds: prev.seconds + payload[id].seconds, label: payload[id].label, kind: payload[id].kind, text_title: payload[id].text_title }
        : payload[id];
    });
  }

  function attemptsPayload() {
    if (!pendingAttempts.length) return null;
    var out = pendingAttempts;
    pendingAttempts = [];
    return out;
  }

  function heartbeat() {
    var payload = {};
    var has = false;
    if (pending.bank > 0) { payload.bank = pending.bank; has = true; }
    if (pending.english > 0) { payload.english = pending.english; has = true; }
    var secs = sectionsPayload();
    if (secs) { payload.sections = secs; has = true; }
    var atts = attemptsPayload();
    if (atts) { payload.attempts = atts; has = true; }
    if (!has) return;
    pending.bank = 0;
    pending.english = 0;
    fetch('/api/study/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: true,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.today) {
        today.bank = j.today.bank || 0;
        today.english = j.today.english || 0;
        render();
      }
    }).catch(function () {
      pending.bank += payload.bank || 0;
      pending.english += payload.english || 0;
      rollbackSections(payload.sections);
      if (payload.attempts) pendingAttempts = payload.attempts.concat(pendingAttempts);
    });
  }

  function flushBeacon() {
    var payload = {};
    if (pending.bank > 0) payload.bank = pending.bank;
    if (pending.english > 0) payload.english = pending.english;
    var secs = sectionsPayload();
    if (secs) payload.sections = secs;
    var atts = attemptsPayload();
    if (atts) payload.attempts = atts;
    if (!payload.bank && !payload.english && !payload.sections && !payload.attempts) return;
    pending.bank = 0;
    pending.english = 0;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/study/heartbeat',
          new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        return;
      }
    } catch (e) { /* fallthrough */ }
    try {
      fetch('/api/study/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
        keepalive: true,
      });
    } catch (e) { /* ignore */ }
  }

  function loadToday() {
    fetch('/api/study/stats?days=1', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          if (j.today) {
            today.bank = j.today.bank || 0;
            today.english = j.today.english || 0;
          }
          standards = j.standards || {};
          todaySections = {};
          (j.sections || []).forEach(function (s) {
            todaySections[s.id] = { today: s.today || 0, label: s.label, kind: s.kind, text_title: s.text_title };
          });
        }
        var wrap = $('studyTimerWrap');
        if (wrap) wrap.hidden = false;
        render();
      })
      .catch(function () {
        var wrap = $('studyTimerWrap');
        if (wrap) wrap.hidden = false;
        render();
      });
  }

  // ---------- 统计面板（仅存在 #studyStatsModal 的页面） ----------

  var statsModal = null;
  var statsDays = 7;

  function renderStats(j) {
    var summary = $('studyStatsSummary');
    var bars = $('studyStatsBars');
    if (!summary || !bars || !j || !j.ok) return;
    var totals = j.totals || { bank: 0, english: 0, all: 0 };
    summary.innerHTML =
      '<div class="study-stats-summary-item">'
      + '<span class="study-stats-dot" style="background:' + AREA_COLOR.bank + '"></span>'
      + '题库区 <b>' + fmt(totals.bank) + '</b></div>'
      + '<div class="study-stats-summary-item">'
      + '<span class="study-stats-dot" style="background:' + AREA_COLOR.english + '"></span>'
      + '英语作答区 <b>' + fmt(totals.english) + '</b></div>'
      + '<div class="study-stats-summary-item is-total">'
      + '合计 <b>' + fmt(totals.all) + '</b></div>';

    var days = j.days || [];
    var maxDay = 0;
    days.forEach(function (d) {
      maxDay = Math.max(maxDay, (d.bank || 0) + (d.english || 0));
    });
    var html = '';
    days.forEach(function (d) {
      var total = (d.bank || 0) + (d.english || 0);
      var pct = maxDay > 0 ? Math.max(2, Math.round(total / maxDay * 100)) : 0;
      var bankPct = total > 0 ? Math.round((d.bank || 0) / total * 100) : 0;
      var title = esc(d.date) + ' 题库区 ' + fmt(d.bank || 0) + ' / 英语 ' + fmt(d.english || 0);
      html += '<div class="study-bar-row">'
        + '<span class="study-bar-date">' + esc(d.date.slice(5)) + '</span>'
        + '<div class="study-bar-track" title="' + title + '">'
        + '<div class="study-bar-fill" style="width:' + pct + '%">'
        + (d.bank ? '<span class="study-bar-seg is-bank" style="width:' + bankPct + '%"></span>' : '')
        + (d.english ? '<span class="study-bar-seg is-english" style="width:' + (100 - bankPct) + '%"></span>' : '')
        + '</div></div>'
        + '<span class="study-bar-value">' + (total > 0 ? fmtMinutes(total) : '') + '</span>'
        + '</div>';
    });
    bars.innerHTML = html;
    renderSectionRows(j);
  }

  /** 一条作答记录的小标签：只有「全新开始且答完」的记录才判达标/超时 */
  function attemptChip(a, standard) {
    var cls, tag;
    if (!a.done) { cls = 'is-inc'; tag = '未完成'; }
    else if (!a.fresh) { cls = 'is-cont'; tag = '续作'; }
    else if (standard && a.dur > standard) { cls = 'is-over'; tag = '超时'; }
    else { cls = 'is-ok'; tag = standard ? '达标' : '完成'; }
    var tip = (a.ts || '') + ' · 用时 ' + fmt(a.dur)
      + (a.paused ? '（暂停 ' + fmt(a.paused) + '，不计入）' : '')
      + (a.answered != null && a.total ? ' · ' + a.answered + '/' + a.total : '')
      + ' · ' + tag + (a.fresh ? '' : '（接着之前的作答，不参与达标判定）');
    return '<span class="study-att ' + cls + '" title="' + esc(tip) + '">'
      + esc(String(a.ts || '').slice(5, 10)) + ' ' + fmt(a.dur) + '<i>' + tag + '</i></span>';
  }

  function renderSectionRows(j) {
    var host = $('studyStatsSections');
    if (!host) return;
    var list = j.sections || [];
    if (!list.length) {
      host.innerHTML = '<p class="study-stats-empty">还没有题块记录：在阅读卷的某一节停留超过 5 秒即开始计时（读文章、思考都算），整节答完对答案后记下本次用时。</p>';
      return;
    }
    var html = '<ul class="study-sec-list">';
    list.forEach(function (s) {
      var name = s.label || s.id;
      var atts = s.attempts || [];
      var chips = atts.map(function (a) { return attemptChip(a, s.standard); }).join('');
      var sum = '';
      if (s.avg) {
        sum = '<span class="study-sec-avg">全新完成：平均 ' + fmt(s.avg) + ' · 最快 ' + fmt(s.best) + '</span>';
      }
      var std = s.standard
        ? '<div class="study-sec-std">建议 ' + fmt(s.standard) + ' 内完成</div>'
        : '';
      html += '<li class="study-sec-item">'
        + '<div class="study-sec-row">'
        + '<span class="study-sec-name" title="' + esc(s.text_title || '') + '">'
        + esc(name)
        + (s.text_title ? '<span class="study-sec-paper">' + esc(s.text_title) + '</span>' : '')
        + '</span>'
        + '<span class="study-sec-last">' + (s.last ? esc(s.last.slice(5)) : '') + '</span>'
        + '<span class="study-sec-time">' + fmt(s.total) + '</span>'
        + '</div>'
        + ((chips || std) ? '<div class="study-sec-attempts">' + chips + sum + std + '</div>' : '')
        + '</li>';
    });
    html += '</ul>';
    host.innerHTML = html;
  }

  function loadStats(days) {
    statsDays = days;
    var buttons = document.querySelectorAll('.study-stats-range .btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-active', parseInt(buttons[i].dataset.days, 10) === days);
    }
    fetch('/api/study/stats?days=' + days, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) standards = j.standards || standards;
        renderStats(j);
      })
      .catch(function () { /* 面板保持上次内容 */ });
  }

  function initStatsPanel() {
    statsModal = $('studyStatsModal');
    if (!statsModal) return;
    var closeBtn = $('studyStatsCloseBtn');
    if (closeBtn) closeBtn.onclick = function () { statsModal.hidden = true; };
    statsModal.addEventListener('click', function (e) {
      if (e.target === statsModal) statsModal.hidden = true;
    });
    var buttons = document.querySelectorAll('.study-stats-range .btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function () {
        loadStats(parseInt(this.dataset.days, 10));
      };
    }
    var timerBtn = $('studyTimerBtn');
    if (timerBtn) {
      timerBtn.onclick = function () {
        statsModal.hidden = false;
        loadStats(statsDays);
      };
    }
    var guideBtn = $('studyGuideBtn'); // 计时说明：复用新手引导的分步气泡
    if (guideBtn) {
      guideBtn.onclick = function () {
        if (!window.LykieOnboarding || !window.LykieOnboarding.startStudyTour()) return;
        statsModal.hidden = true;
      };
    }
    if (/[?&]stats=1(&|$)/.test(location.search)) {
      statsModal.hidden = false;
      loadStats(7);
      try {
        var url = new URL(location.href);
        url.searchParams.delete('stats');
        history.replaceState({}, '', url.pathname + url.search);
      } catch (e) { /* ignore */ }
    }
  }

  function init() {
    var wrap = $('studyTimerWrap');
    if (!wrap) return;
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'input'].forEach(function (ev) {
      window.addEventListener(ev, onActivity, { capture: true, passive: true });
    });
    initStatsPanel();
    loadToday();
    timerId = setInterval(tick, TICK_MS);
    beatId = setInterval(heartbeat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        setPaused(true);
        heartbeat();
      } else if (activeQ || activeSec) {
        lastActivity = Date.now();
        reminded = false;
        setPaused(isPaused());
        render();
      }
      if (dwellPending) armDwell();
    });
    window.addEventListener('pagehide', flushBeacon);
    window.addEventListener('beforeunload', flushBeacon);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
