/* 新手演示编排器：走真实 UI 交互，自动演示一遍
 * 答对 → 答错 →（答错题回来后）答对 → 斩 → 斩完全部题出结算画面。
 * 所有动作都通过 DOM click 触发 script.js 的真实处理链，不绕过任何逻辑。
 */
(function () {
  'use strict';

  let running = false;
  let aborted = false;
  let banner = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitUntil(fn, timeout, interval) {
    const t = timeout || 15000;
    const iv = interval || 150;
    const start = Date.now();
    while (Date.now() - start < t) {
      if (aborted) return false;
      if (fn()) return true;
      await sleep(iv);
    }
    return false;
  }

  const inSettleView = () => document.body.classList.contains('settle-view');

  // 等一张可作答的新卡；settle 视图出现则返回 'settle'，超时返回 null
  async function waitCardOrSettle(timeout) {
    const ok = await waitUntil(() => {
      if (inSettleView()) return true;
      const opts = document.querySelectorAll('#options .opt');
      return opts.length > 0 && !opts[0].disabled
        && window.LykieDemo && !LykieDemo.submitted();
    }, timeout || 20000);
    if (!ok) return null;
    return inSettleView() ? 'settle' : 'card';
  }

  function optButton(letter) {
    return document.querySelector('#options .opt[data-value="' + letter + '"]');
  }

  function clickCorrect() {
    const q = window.LykieDemo.current();
    const btn = optButton(String(q.answer || '').charAt(0));
    if (btn) btn.click();
    return !!btn;
  }

  function clickWrong() {
    const q = window.LykieDemo.current();
    const answer = String(q.answer || '');
    const all = [...document.querySelectorAll('#options .opt')].map((b) => b.dataset.value);
    const wrong = all.find((v) => !answer.includes(v));
    const btn = wrong && optButton(wrong);
    if (btn) btn.click();
    return !!btn;
  }

  // 判定完成：选项全部禁用
  function waitJudged() {
    return waitUntil(() => {
      const opts = document.querySelectorAll('#options .opt');
      return opts.length > 0 && opts[0].disabled;
    }, 8000);
  }

  function waitNextBtn() {
    return waitUntil(() => {
      const b = document.getElementById('nextBtn');
      return b && !b.hidden;
    }, 8000);
  }

  function waitKillable() {
    return waitUntil(() => {
      const b = document.getElementById('killBtn');
      return b && !b.hidden && !b.disabled;
    }, 8000);
  }

  // ---------- 演示横幅 + 防误点遮罩 ----------

  function setBanner(text) {
    if (banner) banner.querySelector('.demo-tour-text').textContent = text;
  }

  function buildUi() {
    const mask = document.createElement('div');
    mask.className = 'demo-tour-mask';
    document.body.appendChild(mask);
    banner = document.createElement('div');
    banner.className = 'demo-tour-banner';
    banner.innerHTML =
      '<span class="demo-tour-tag">新手演示</span>' +
      '<span class="demo-tour-text">准备中…</span>' +
      '<button type="button" class="btn ghost demo-tour-skip">跳过演示</button>';
    document.body.appendChild(banner);
    banner.querySelector('.demo-tour-skip').addEventListener('click', () => {
      abort('已跳过演示——剩下的交给你，随时开始背题！');
    });
  }

  function removeUi() {
    document.querySelectorAll('.demo-tour-mask').forEach((m) => m.remove());
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function abort(msg) {
    aborted = true;
    removeUi();
    markTourDone();
    if (msg && typeof uiAlert === 'function') uiAlert(msg, { title: '新手演示' });
  }

  function finish() {
    removeUi();
    markTourDone();
    if (typeof uiAlert === 'function') {
      uiAlert(
        '演示完毕！这就是完整的一轮：答对、答错自动复习、斩题、结算。\n现在轮到你了——点结算里的按钮开始你的第一轮吧。',
        { title: '新手演示' },
      );
    }
  }

  function markTourDone() {
    try {
      fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ tour_done: true }),
      }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  // ---------- 主流程 ----------

  async function runDemo() {
    if (running) return;
    if (!window.LykieDemo) return;
    running = true;
    aborted = false;
    buildUi();
    let didCorrect = false;
    let didWrong = false;
    try {
      while (!aborted) {
        const what = await waitCardOrSettle();
        if (!what) { abort('演示等待超时，已中断。当前进度已保留，你可以继续自己作答。'); return; }
        if (what === 'settle') { finish(); return; }

        const q = window.LykieDemo.current();
        if (!didCorrect) {
          setBanner('第 1 步 · 答对：演示替你点正确选项');
          if (!clickCorrect()) { abort('演示中断：找不到选项按钮。'); return; }
          didCorrect = true;
          await waitJudged();
          setBanner('答对了——正确选项绿色高亮，连击徽章 +1，下方显示解析');
          if (!await waitNextBtn()) return;
          await sleep(2400);
          document.getElementById('nextBtn').click();
          await sleep(500);
          continue;
        }
        if (!didWrong) {
          setBanner('第 2 步 · 答错：这次故意点错');
          if (!clickWrong()) { abort('演示中断：找不到选项按钮。'); return; }
          didWrong = true;
          await waitJudged();
          setBanner('答错了——红色高亮。没关系：它会自动多安排复习，答对后照样能斩');
          if (!await waitNextBtn()) return;
          await sleep(2800);
          document.getElementById('nextBtn').click();
          await sleep(500);
          continue;
        }
        // 常规：答对 → 斩（答错过重遇的题会先出现在这里）
        setBanner(q && q.phase === 'wrong'
          ? '刚才答错的题回来了：先答对，然后就能斩'
          : '第 3 步 · 斩：答对后点「斩」，这题从此不再出现');
        if (!clickCorrect()) { abort('演示中断：找不到选项按钮。'); return; }
        if (!await waitJudged()) return;
        await sleep(1000);
        if (!await waitKillable()) { abort('演示中断：斩按钮未解锁。'); return; }
        document.getElementById('killBtn').click();
        setBanner('斩！——被斩的题不再出现，连击与结算都会记录。全部斩完后出结算画面');
        await sleep(2400);
      }
    } finally {
      running = false;
    }
  }

  window.startNewbieDemo = runDemo;
})();
