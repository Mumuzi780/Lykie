// ==================== 新手引导 ====================
// 欢迎弹窗 + 新手任务清单 + driver.js 分步气泡。
// 进度由服务端记录（data/users.json 的 onboarding 字段）：
//   任务勾选（claim/study/kill）由后端在领取/答题/斩题时标记；
//   弹窗/导览/清单的开闭状态由本文件 POST /api/onboarding 更新。
//
// ---------- 复用规则（要加引导先读这里） ----------
// 1. 一进页面就弹的引导只有一个：欢迎弹窗（onboardingModal）。它只讲「这个站是干什么的」，
//    不要把某个页面/功能才用得上的提示塞进欢迎弹窗或欢迎导览（buildSteps）。
// 2. 其他提示一律做成「场景引导」：等用户自己进入对应页面、或做了对应动作之后才提示。
//    新增一个场景只要两步：
//      a. 在下面 SCENE_GUIDES 注册一个 key → 气泡步骤（外加可选的 delay 毫秒）；
//      b. 在场景入口处（业务代码）调用一句 LykieOnboarding.scene('key')。
//    入口处只负责「喊一声」；播不播、播过没有、气泡长什么样，全部由本文件决定。
// 3. 每个场景每个账号只自动播一次，进度存服务端 onboarding.guide[key]；
//    老账号（guide 为空）一律不自动播。需要随时重看的，另加手动入口并传 { force: true }
//    （例如统计面板的「计时说明」），手动重看不改进度。
// 4. 文案只讲当前场景的规则，三五句说清；要高亮的元素不可见时自动退化为居中气泡。
(() => {
  'use strict';

  const TASK_KEYS = ['claim', 'study', 'kill'];
  const $ = (id) => document.getElementById(id);

  // 状态缺省视为“已引导完”，老账号 / 异常情况一律不打扰
  let state = readState();
  if (!state) {
    state = { welcome_done: true, tasks: { claim: true, study: true, kill: true }, tour_done: true, checklist_dismissed: true };
  }

  function readState() {
    try {
      const raw = document.body.dataset.onboarding;
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') return data;
      }
    } catch (e) { /* 忽略解析失败 */ }
    return null;
  }

  async function postOnboarding(patch) {
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(patch),
      });
    } catch (e) { /* 网络失败不阻断交互 */ }
  }

  async function refreshState() {
    try {
      const res = await fetch('/api/onboarding', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.onboarding) {
        state = data.onboarding;
        renderChecklist();
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 欢迎弹窗 ----------
  function initWelcome() {
    const modal = $('onboardingModal');
    if (!modal || state.welcome_done || window.RD_BOOT) return;
    modal.hidden = false;
    const close = () => {
      modal.hidden = true;
      state.welcome_done = true;
      postOnboarding({ welcome_done: true });
    };
    $('onboardingSkipBtn').addEventListener('click', () => {
      close();
      startWelcomeTour();
    });
    // 示例题库已预置，「直接开始背题」关闭弹窗即可作答
    $('onboardingMarketBtn').addEventListener('click', () => {
      close();
    });
    // 主按钮：自动演示一遍完整流程（答对→答错→斩→结算）
    $('onboardingDemoBtn').addEventListener('click', () => {
      close();
      if (typeof window.startNewbieDemo === 'function') {
        window.startNewbieDemo();
      }
    });
  }

  // ---------- 任务清单 ----------
  function taskDone(key) {
    return !!(state.tasks && state.tasks[key]);
  }

  function renderChecklist() {
    const card = $('onboardingCard');
    if (!card) return;
    const doneCount = TASK_KEYS.filter(taskDone).length;
    const allDone = doneCount === TASK_KEYS.length;

    // 收起且已全部完成 → 彻底隐藏，不再打扰
    if (state.checklist_dismissed && allDone) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    card.classList.toggle('is-collapsed', !!state.checklist_dismissed && !allDone);
    card.classList.toggle('is-complete', allDone);

    $('onboardingProgressText').textContent = allDone ? '完成' : `${doneCount}/${TASK_KEYS.length}`;
    $('onboardingProgressFill').style.width = `${(doneCount / TASK_KEYS.length) * 100}%`;

    TASK_KEYS.forEach((key) => {
      const li = card.querySelector(`li[data-task="${key}"]`);
      if (li) li.classList.toggle('done', taskDone(key));
    });
  }

  function initChecklist() {
    const card = $('onboardingCard');
    if (!card) return;

    renderChecklist();

    $('onboardingCollapseBtn').addEventListener('click', () => {
      state.checklist_dismissed = true;
      postOnboarding({ checklist_dismissed: true });
      renderChecklist();
    });

    // 折叠态点标题重新展开
    card.querySelector('.onboarding-card-head').addEventListener('click', (e) => {
      if (!card.classList.contains('is-collapsed')) return;
      if (e.target.closest('.onboarding-icon-btn')) return;
      state.checklist_dismissed = false;
      postOnboarding({ checklist_dismissed: false });
      renderChecklist();
    });

    // 「去领取」直达市场
    card.querySelector('.ob-action[data-action="market"]').addEventListener('click', () => {
      if (typeof openOfficialMarket === 'function') openOfficialMarket();
    });

    // 重看引导
    $('onboardingReplayBtn').addEventListener('click', () => {
      startWelcomeTour();
    });
  }

  // ---------- driver.js 分步气泡 ----------
  function visibleEl(preferred) {
    const el = typeof preferred === 'function'
      ? preferred()
      : (typeof preferred === 'string' ? document.querySelector(preferred) : preferred);
    if (el && !el.hidden && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return el;
    return null;
  }

  function buildSteps() {
    const steps = [];
    const marketBtn = visibleEl('#officialMarketBtn');
    if (marketBtn) {
      steps.push({
        element: marketBtn,
        popover: { title: '题库市场', description: '点侧栏「市场」领取共享题库副本，背题从这里开始。' },
      });
    }
    if (visibleEl(() => $('studyHost'))) {
      // 已有题库：分别讲抽背区和斩题
      steps.push({
        element: visibleEl(() => $('studyHost')),
        popover: { title: '抽背区', description: '这里每天抽题给你背；答错的题会自动多安排复习。' },
      });
      const killEl = visibleEl('#killBtn');
      if (killEl) {
        steps.push({
          element: killEl,
          popover: { title: '斩题', description: '背熟的题点「斩」，从此不再出现，越背越少。' },
        });
      }
    } else {
      // 空库：抽背区、斩题按钮都还没出现，把两个概念合并在空状态上讲
      const emptyEl = visibleEl('#emptyState');
      if (emptyEl) {
        steps.push({
          element: emptyEl,
          popover: {
            title: '这里就是抽背区',
            description: '领取题库后，这里每天抽题给你背；答错的题自动多安排复习，背熟的题点「斩」从此不再出现。',
          },
        });
      }
    }
    // 主题切换：按钮可见就高亮，不可见则退化为无元素定位的居中气泡
    const themeEl = visibleEl('#celestialBtn');
    steps.push({
      ...(themeEl ? { element: themeEl } : {}),
      popover: { title: '明暗主题', description: '页面左上角的太阳/月亮按钮可以切换白天、夜间模式，偏好会自动记住。' },
    });
    return steps;
  }

  // ---------- 场景引导：进入对应页面 / 做了对应动作之后才提示 ----------
  const SCENE_GUIDES = {
    // 题库区（抽背、斩题、简答、模考）：第一次提交答案后提示
    bankTimer: {
      delay: 1500, // 等判分动画播完再弹，不抢注意力
      steps: () => {
        const timerEl = visibleEl('#studyTimerWrap');
        return [
          {
            // 顶栏计时入口不可见时退化为居中气泡
            ...(timerEl ? { element: timerEl } : {}),
            popover: {
              title: '学习时长：自动记录',
              description: '不用手动开关，学多久记多久。这里显示今日和本次时长，点一下能看统计。',
            },
          },
          {
            popover: {
              title: '题库区：出题即计时',
              description: '题目一显示就开始计时，思考的时间也算；提交后暂停（刚才这一次就记下了）。30 秒没操作会自动暂停。',
            },
          },
        ];
      },
    },
    // 英语阅读区：进入阅读视图后提示
    englishTimer: {
      steps: () => {
        const secEl = visibleEl('#bankList .paper-item[data-sec]');
        const timerEl = visibleEl('#studyTimerWrap');
        const onSec = (popover) => ({ ...(secEl ? { element: secEl } : {}), popover });
        return [
          onSec({
            title: '英语阅读区：按节计时',
            description: '侧栏里每个节条目就是一道大题。正文在同一节停留超过 5 秒，这一节开始计时，读文章、读题、思考都算；条目旁会显示本次用时。',
          }),
          {
            popover: {
              title: '换节就换表',
              description: '滚到别的节停满 5 秒就换下一节，上一节停止（5 秒内滚回来接着算）；点侧栏节条目切节，上一节立即停止。整节答完对答案即结束，答完的节不再计时。',
            },
          },
          onSec({
            title: '手动开关与暂停',
            description: '双击侧栏的节条目可以手动开始或停止计时；手动停止后 10 分钟内这一节不会自动开始。1 分钟没操作会提醒，3 分钟没操作或切到别的窗口会暂停，暂停的时间不算。',
          }),
          {
            ...(timerEl ? { element: timerEl } : {}),
            popover: {
              title: '哪里看时长',
              description: '顶栏显示今日和本次时长，点一下可以看统计：每一节是达标、超时还是未完成。',
            },
          },
        ];
      },
    },
  };

  function sceneDone(key) {
    // 没有 guide 字段（老账号 / 状态缺失）= 一律不自动播
    return !state.guide || typeof state.guide !== 'object' || !SCENE_GUIDES[key] || !!state.guide[key];
  }

  function markScene(key) {
    state.guide = Object.assign({}, state.guide, { [key]: true });
    postOnboarding({ guide: state.guide }); // 服务端整体覆盖
  }

  /** 场景入口处调用：没看过才播（force = 重看，不改进度）。返回是否已安排播放 */
  function playScene(key, opts) {
    const guide = SCENE_GUIDES[key];
    if (!guide) return false;
    const force = !!(opts && opts.force);
    if (!force && sceneDone(key)) return false;
    const start = () => startTour(guide.steps(), () => { if (!force) markScene(key); });
    if (guide.delay && !force) {
      setTimeout(start, guide.delay);
      return true;
    }
    return start();
  }

  let activeDrv = null; // 同一时刻只跑一个导览

  /** steps: driver.js 步骤；onDestroyed: 关闭后的回调（省略 = 欢迎导览，记 tour_done） */
  function startTour(steps, onDestroyed) {
    // driver.js IIFE 构建导出为 window.driver.js.driver（模块对象上的工厂函数）
    const factory = (window.driver && typeof window.driver.js === 'object' && window.driver.js && typeof window.driver.js.driver === 'function')
      ? window.driver.js.driver
      : (typeof window.driver === 'function' ? window.driver : null);
    if (typeof factory !== 'function') return false;
    if (activeDrv) return false;
    if (!steps || !steps.length) return false;
    const drv = factory({
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: '下一步',
      prevBtnText: '上一步',
      doneBtnText: '完成',
      allowClose: true,
      onDestroyed: () => {
        activeDrv = null;
        if (onDestroyed) onDestroyed();
        else {
          state.tour_done = true;
          postOnboarding({ tour_done: true });
        }
      },
    });
    activeDrv = drv;
    drv.setSteps(steps);
    drv.drive();
    return true;
  }
  const startWelcomeTour = () => startTour(buildSteps());
  window.LykieOnboarding = {
    scene: playScene,
    // 统计面板「计时说明」：手动重看，题库区 + 英语阅读区的规则连着播
    startStudyTour: () => startTour([...SCENE_GUIDES.bankTimer.steps(), ...SCENE_GUIDES.englishTimer.steps()]),
  };

  // ---------- 事件：答题 / 斩题 / 领取后刷新勾选 ----------
  document.addEventListener('lykie:onboarding-activity', refreshState);

  // ---------- 站长测试入口：重置引导状态并刷新页面 ----------
  const replayOnboardingBtn = $('replayOnboardingBtn');
  if (replayOnboardingBtn) {
    replayOnboardingBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/onboarding/reset', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert((data && data.error) || '重置失败');
          return;
        }
      } catch (e) {
        alert('网络错误，重置失败');
        return;
      }
      location.reload();
    });
  }

  // ---------- 测试入口：一键变回刚注册的新手（清空题库与进度，不可恢复） ----------
  const newbieResetBtn = $('newbieResetBtn');
  if (newbieResetBtn) {
    newbieResetBtn.addEventListener('click', async () => {
      const confirmed = typeof uiConfirm === 'function'
        ? await uiConfirm(
            '确定变回刚注册的新手吗？\n\n将清空全部题库、文件夹与作答进度（含已斩题目），并重装一份全新的「示例 · 四题上手」。此操作不可恢复。',
            { title: '变回新手', okText: '清空并重置', danger: true },
          )
        : window.confirm('确定变回刚注册的新手吗？将清空全部题库与作答进度，不可恢复。');
      if (!confirmed) return;
      let res;
      try {
        res = await fetch('/api/onboarding/newbie', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (e) {
        alert('网络错误，重置失败');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert((data && data.error) || '重置失败');
        return;
      }
      location.reload();
    });
  }

  // ---------- 启动 ----------
  initWelcome();
  initChecklist();
})();
