/**
 * Lykie 结算动效（与 LykieSfx 同步触发）
 * 连击徽章在 study-stage 右上，与左上天体对称
 */
(function (global) {
  const MILESTONES = [3, 5, 10];
  let badgeTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function reduced() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function cardEl() {
    if (document.body.classList.contains('mode-sa')) {
      return $('saCard') || $('card');
    }
    return $('card');
  }

  function clearFxClasses(el) {
    if (!el) return;
    el.classList.remove('fx-correct', 'fx-miss', 'fx-combo', 'fx-combo-10', 'fx-kill');
  }

  function bumpClass(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  }

  function badgeEls() {
    return {
      root: $('comboBadge'),
      num: $('comboBadgeNum'),
    };
  }

  function setComboBadge(n, animate) {
    const { root, num } = badgeEls();
    if (!root || !num) return;
    const v = Math.max(0, n | 0);
    num.textContent = '×' + v;
    root.classList.toggle('is-idle', v < 1);
    root.classList.toggle('is-live', v >= 1);
    root.setAttribute('aria-label', v < 1 ? '连击 0' : '连击 ' + v);

    if (!animate || v < 1 || reduced()) return;

    const milestone = MILESTONES.indexOf(v) !== -1;
    const popCls = v >= 10 ? 'combo-pop-big' : milestone ? 'combo-pop-mid' : 'combo-pop';
    root.classList.remove('combo-pop', 'combo-pop-mid', 'combo-pop-big');
    void root.offsetWidth;
    root.classList.add(popCls);
    const hold = v >= 10 ? 1150 : milestone ? 1000 : 850;
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      root.classList.remove('combo-pop', 'combo-pop-mid', 'combo-pop-big');
    }, hold);
  }

  function resetComboBadge() {
    setComboBadge(0, false);
  }

  function peekerReact(kind) {
    const head = document.querySelector('.lykie-peeker-head');
    if (!head || reduced()) return;
    const cls = kind === 'kill' ? 'fx-peeker-cheer' : 'fx-peeker-nod';
    head.classList.remove('fx-peeker-nod', 'fx-peeker-cheer');
    void head.offsetWidth;
    head.classList.add(cls);
    window.setTimeout(() => head.classList.remove(cls), kind === 'kill' ? 520 : 420);
  }

  function pulseKillBar() {
    const fill = $('killFill');
    const prog = $('progress');
    bumpClass(fill, 'fx-kill-pulse', 500);
    bumpClass(prog, 'fx-kill-pulse', 500);
  }

  function onCorrect(streak) {
    const card = cardEl();
    const n = streak | 0;
    if (n < 1) return;
    bumpClass(card, 'fx-correct', 380);
    setComboBadge(n, true);
    if (MILESTONES.indexOf(n) !== -1) {
      bumpClass(card, n >= 10 ? 'fx-combo-10' : 'fx-combo', 720);
      peekerReact('combo');
    }
  }

  function onWrong() {
    bumpClass(cardEl(), 'fx-miss', 420);
    resetComboBadge();
  }

  function revealDelay(kind, streak) {
    if (reduced()) return 0;
    if (kind === 'kill') return 420;
    if (kind === 'wrong') return 430;
    const n = streak | 0;
    if (n === 10) return 720;
    if (n === 3 || n === 5) return 640;
    return 520;
  }

  function afterReveal(kind, streak, fn) {
    const ms = revealDelay(kind, streak);
    if (!ms) {
      fn();
      return;
    }
    window.setTimeout(fn, ms);
  }

  function onKill(streakAfter) {
    const card = cardEl();
    const n = streakAfter | 0;
    clearFxClasses(card);
    bumpClass(card, 'fx-kill', 420);
    pulseKillBar();
    peekerReact('kill');
    if (n >= 1) setComboBadge(n, true);
    if (reduced()) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, Math.max(420, revealDelay('kill', n))));
  }

  global.LykieFx = {
    MILESTONES,
    onCorrect,
    onWrong,
    onKill,
    revealDelay,
    afterReveal,
    setComboBadge,
    resetComboBadge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
