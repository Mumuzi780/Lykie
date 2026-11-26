/* 学习时长：作答驱动计时。
   - 题库区：显示题目即开始（含思考），提交判分后暂停；题间过渡不计。
   - 英语作答区：做出作答动作才开始；活跃题所在大题（节）持续计时，
     滚动不切换；跨节作答切换活跃节；该题答完（对答案/看答案）即停，
     重新操作未答完的题继续计时。
   - 全局：30 秒无操作自动暂停；页面失去焦点自动暂停，回来自动恢复。
   页面配置：window.LykieStudyTimeConfig = { area: 'auto' | 'bank' | 'english' } */
(function () {
  'use strict';

  var CFG = window.LykieStudyTimeConfig || {};
  var AREA_FIXED = (CFG.area === 'bank' || CFG.area === 'english') ? CFG.area : null;
  var IDLE_MS = 30 * 1000;   // 30 秒无操作自动暂停
  var HEARTBEAT_MS = 30 * 1000;
  var TICK_MS = 1000;

  var AREA_LABEL = { bank: '题库', english: '英语' };
  var AREA_COLOR = { bank: 'var(--primary)', english: 'var(--answer-text)' };

  var pending = { bank: 0, english: 0 }; // 待上报秒数（按区）
  var pendingSections = {};              // 待上报秒数（按题块）：{ "<textId>::<key>": {seconds, label, kind, text_title} }
  var activeQ = null;                    // 进行中的题：{ area, secKey, textId, qId, label, kind, textTitle }
  var today = { bank: 0, english: 0 };   // 服务端今日累计（按区）
  var todaySections = {};                // 服务端今日累计（按题块）：secId -> {today, label, kind, text_title}
  var sessionSec = 0;                    // 本次打开页面的有效时长
  var sessionSections = {};              // 本次会话各题块秒数（侧栏节计时显示用）
  var lastActivity = Date.now();
  var paused = false;                    // 空闲/失焦暂停
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

  /** 英语作答区：做出作答动作。info: { qId, secKey, textId, label, kind, textTitle } */
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

  /** 英语作答区：该题答完（对答案/看答案锁定）。qId 缺省 = 清当前活跃题 */
  function answerDone(qId) {
    if (activeQ && activeQ.area === 'english' && (qId == null || activeQ.qId === String(qId))) {
      activeQ = null;
    }
  }

  /** 英语作答区：统一对答案（全部答完） */
  function answerDoneAll() {
    if (activeQ && activeQ.area === 'english') activeQ = null;
  }

  /** 视图切换（进/出阅读、换卷）：清活跃题 */
  function resetArea() { activeQ = null; }

  window.LykieStudyTime = {
    questionShown: questionShown,
    questionDone: questionDone,
    answerStarted: answerStarted,
    answerDone: answerDone,
    answerDoneAll: answerDoneAll,
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

  // ---------- 活动与暂停 ----------

  function onActivity() {
    lastActivity = Date.now();
    if (activeQ && paused && !document.hidden) paused = false; // 重新操作：继续计时
  }

  function isIdle() { return Date.now() - lastActivity > IDLE_MS; }

  function isPaused() {
    if (document.hidden) return true;
    if (!activeQ) return false; // 无进行中的题：不累计（badge 显示「待作答」）
    return isIdle();
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
      if (!activeQ) {
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

  /** 侧栏节选项处显示节计时：今日累计 + 本次会话；活跃节实时跳动并高亮 */
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
      var active = !!(activeQ && activeQ.area === 'english'
        && activeQ.textId === li.dataset.textId && activeQ.secKey === li.dataset.sec);
      li.classList.toggle('is-timing', active);
      var total = (todaySections[id] ? todaySections[id].today : 0) + (sessionSections[id] || 0);
      span.textContent = total > 0 ? fmt(total) : '';
      span.hidden = total <= 0;
    }
  }

  function tick() {
    var p = isPaused();
    if (p !== paused) { paused = p; }
    if (!p && activeQ) {
      pending[activeQ.area] += 1;
      sessionSec += 1;
      if (activeQ.secKey && activeQ.textId) {
        var id = secId(activeQ.textId, activeQ.secKey);
        var e = pendingSections[id] || {
          seconds: 0,
          label: activeQ.label || '',
          kind: activeQ.kind || '',
          text_title: activeQ.textTitle || '',
        };
        e.seconds += 1;
        pendingSections[id] = e;
        sessionSections[id] = (sessionSections[id] || 0) + 1;
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

  function heartbeat() {
    var payload = {};
    var has = false;
    if (pending.bank > 0) { payload.bank = pending.bank; has = true; }
    if (pending.english > 0) { payload.english = pending.english; has = true; }
    var secs = sectionsPayload();
    if (secs) { payload.sections = secs; has = true; }
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
    });
  }

  function flushBeacon() {
    var payload = {};
    if (pending.bank > 0) payload.bank = pending.bank;
    if (pending.english > 0) payload.english = pending.english;
    var secs = sectionsPayload();
    if (secs) payload.sections = secs;
    if (!payload.bank && !payload.english && !payload.sections) return;
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

  function renderSectionRows(j) {
    var host = $('studyStatsSections');
    if (!host) return;
    var list = j.sections || [];
    if (!list.length) {
      host.innerHTML = '<p class="study-stats-empty">还没有题块记录：在阅读作答区做题后，会自动按大题（选词填空、段落匹配…）统计用时。</p>';
      return;
    }
    var html = '<ul class="study-sec-list">';
    list.forEach(function (s) {
      var name = s.label || s.id;
      html += '<li class="study-sec-item">'
        + '<span class="study-sec-name" title="' + esc(s.text_title || '') + '">'
        + esc(name)
        + (s.text_title ? '<span class="study-sec-paper">' + esc(s.text_title) + '</span>' : '')
        + '</span>'
        + '<span class="study-sec-last">' + (s.last ? esc(s.last.slice(5)) : '') + '</span>'
        + '<span class="study-sec-time">' + fmt(s.total) + '</span>'
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
      .then(renderStats)
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
        paused = true;
        heartbeat();
      } else if (activeQ) {
        paused = false;
        lastActivity = Date.now();
      }
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
