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

  const KILL_TIER_MSGS = {
    25: '还不错',
    50: '一半入袋了',
    75: '最后一公里，别绊倒',
    100: '全部拿下，休息一下再出发',
  };
  const KILL_TIER_MS = { 25: 1800, 50: 2000, 75: 2200, 100: 2600 };

  let killCheerTimer = null;
  let killCheerResolve = null;

  function killTierCheer(tier) {
    const t = tier | 0;
    const msg = KILL_TIER_MSGS[t];
    const hold = KILL_TIER_MS[t] || 2000;
    const cheer = $('killCheer');
    const btn = $('killBtn');
    const bolts = $('killBolts');

    if (killCheerTimer) {
      clearTimeout(killCheerTimer);
      killCheerTimer = null;
    }
    if (killCheerResolve) {
      killCheerResolve();
      killCheerResolve = null;
    }

    const done = new Promise((resolve) => {
      killCheerResolve = resolve;
    });

    if (!msg || !cheer) {
      if (killCheerResolve) {
        killCheerResolve();
        killCheerResolve = null;
      }
      return Promise.resolve();
    }

    cheer.textContent = msg;
    cheer.hidden = false;
    cheer.classList.remove('is-in', 'is-out', 'tier-25', 'tier-50', 'tier-75', 'tier-100');
    void cheer.offsetWidth;
    cheer.classList.add('is-in', 'tier-' + t);

    if (btn) {
      btn.classList.remove('kill-zap-25', 'kill-zap-50', 'kill-zap-75', 'kill-zap-100', 'is-cheering');
      void btn.offsetWidth;
      btn.classList.add('is-cheering', 'kill-zap-' + t);
    }
    if (bolts && !reduced()) {
      bolts.classList.remove('zap-25', 'zap-50', 'zap-75', 'zap-100');
      void bolts.offsetWidth;
      bolts.classList.add('zap-' + t);
    }
    pulseKillBar();

    const fadeAt = Math.max(400, hold - 420);
    killCheerTimer = window.setTimeout(() => {
      cheer.classList.add('is-out');
      cheer.classList.remove('is-in');
      killCheerTimer = window.setTimeout(() => {
        cheer.hidden = true;
        cheer.classList.remove('is-out', 'tier-25', 'tier-50', 'tier-75', 'tier-100');
        if (btn) {
          btn.classList.remove(
            'is-cheering',
            'kill-zap-25',
            'kill-zap-50',
            'kill-zap-75',
            'kill-zap-100'
          );
        }
        if (bolts) bolts.classList.remove('zap-25', 'zap-50', 'zap-75', 'zap-100');
        if (killCheerResolve) {
          killCheerResolve();
          killCheerResolve = null;
        }
        killCheerTimer = null;
      }, 420);
    }, reduced() ? 600 : fadeAt);

    return done;
  }

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /**
   * 100% 过场：条上移竖直中心 → 持文案 → 独自透视远去；
   * 快消失时才回调 onSettleStart（错开注意力，减轻双动画卡顿）。
   * opts.prepare(): hold 阶段预加载
   * opts.onSettleStart(prepared): 条将近消失时触发
   */
  function playKillHundredTransition(opts) {
    opts = opts || {};
    const fx = $('killClearFx');
    const stage = $('killClearStage');
    const bar = $('killClearBar');
    const cheer = $('killClearCheer');
    const bolts = bar ? bar.querySelector('.kill-bolts') : null;
    const realSlot = $('killSlot');
    const realBtn = $('killBtn');
    const msg = KILL_TIER_MSGS[100];
    const moveMs = 520;
    const holdMs = 1000;
    const recedeMs = 980;
    // 结算只在条尾声启动，与远去少量交接即可
    const settleLeadMs = 240;

    if (!fx || !stage || !bar) return Promise.resolve();

    const anchor = (realBtn && !realBtn.hidden ? realBtn : realSlot) || realBtn;
    const rect = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect()
      : { left: 24, top: window.innerHeight - 80, width: Math.min(420, window.innerWidth - 48), height: 48 };

    if (realSlot) realSlot.classList.add('is-clearing-hide');
    document.body.classList.add('kill-clearing');

    cheer.textContent = msg || '';
    cheer.hidden = false;
    cheer.classList.add('is-in', 'tier-100');

    stage.style.transition = 'none';
    stage.style.left = Math.round(rect.left) + 'px';
    stage.style.width = Math.round(rect.width) + 'px';
    stage.style.top = Math.round(rect.top) + 'px';

    fx.hidden = false;
    fx.setAttribute('aria-hidden', 'false');
    bar.classList.remove('is-hold', 'is-recede');
    void bar.offsetWidth;

    if (bolts && !reduced()) {
      bolts.classList.remove('zap-25', 'zap-50', 'zap-75', 'zap-100');
      void bolts.offsetWidth;
      bolts.classList.add('zap-100');
    }

    function cleanup() {
      fx.hidden = true;
      fx.setAttribute('aria-hidden', 'true');
      bar.classList.remove('is-hold', 'is-recede');
      if (bolts) bolts.classList.remove('zap-25', 'zap-50', 'zap-75', 'zap-100');
      stage.style.transition = 'none';
      stage.style.left = '';
      stage.style.width = '';
      stage.style.top = '';
      document.body.classList.remove('kill-clearing');
      if (realSlot) realSlot.classList.remove('is-clearing-hide');
    }

    function fireSettle(prepared) {
      if (typeof opts.onSettleStart === 'function') {
        try { opts.onSettleStart(prepared); } catch (e) { console.error(e); }
      } else if (typeof opts.onCrossStart === 'function') {
        try { opts.onCrossStart(prepared); } catch (e) { console.error(e); }
      }
    }

    if (reduced()) {
      return Promise.resolve()
        .then(() => (typeof opts.prepare === 'function' ? opts.prepare() : null))
        .then((prepared) => {
          fireSettle(prepared);
          return waitMs(120);
        })
        .then(cleanup);
    }

    const targetTop = Math.max(
      12,
      Math.round((window.innerHeight - (rect.height || stage.offsetHeight || 52)) / 2)
    );

    return waitMs(20)
      .then(() => {
        stage.style.transition = 'top ' + moveMs + 'ms var(--motion-ease, cubic-bezier(0.22, 1, 0.36, 1))';
        stage.style.top = targetTop + 'px';
        return waitMs(moveMs);
      })
      .then(() => {
        bar.classList.add('is-hold');
        const prep = typeof opts.prepare === 'function' ? opts.prepare() : null;
        return Promise.all([waitMs(holdMs), Promise.resolve(prep)]);
      })
      .then((pair) => {
        const prepared = pair[1];
        bar.classList.remove('is-hold');
        void bar.offsetWidth;
        bar.classList.add('is-recede');
        // 条先独自远去，快没影时再播结算
        const soloMs = Math.max(0, recedeMs - settleLeadMs);
        return waitMs(soloMs).then(() => {
          fireSettle(prepared);
          return waitMs(settleLeadMs);
        });
      })
      .then(cleanup);
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
    killTierCheer,
    playKillHundredTransition,
    revealDelay,
    afterReveal,
    setComboBadge,
    resetComboBadge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
