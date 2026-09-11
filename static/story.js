
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

/**
 * 开场剧情 runner：同一 Lykie 面板播放 StoryGraph。
 * 选项 = 芯片填入输入框，可覆写后发送；大意匹配选项推进。
 */
(function () {
  const OUT = 'out';
  const TIMEOUT = 'timeout';

  let storyMode = false;
  let storyGraph = null;
  let storyBusy = false;
  let storyAbort = null;
  let choiceResolver = null;
  let choiceTimer = null;
  let waitSkipResolver = null;
  let currentOptions = [];
  let playerName = '';
  let storyEnding = '';

  function $(id) {
    return document.getElementById(id);
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      }
    });
  }

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\p{P}]/gu, '');
  }

  function nextEdge(sourceId, handle) {
    const edges = storyGraph.edges || [];
    const h = handle || OUT;
    return (
      edges.find((e) => e.source === sourceId && (e.sourceHandle || OUT) === h) ||
      edges.find((e) => e.source === sourceId && !e.sourceHandle) ||
      null
    );
  }

  function nodeById(id) {
    return (storyGraph.nodes || []).find((n) => n.id === id);
  }

  function appendBubble(role, text) {
    if (typeof appendLykieBubble === 'function') {
      return appendLykieBubble(role, text);
    }
    return null;
  }

  function setChips(options) {
    currentOptions = options || [];
    const box = $('lykieChips');
    if (!box) return;
    box.innerHTML = '';
    if (!currentOptions.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    currentOptions.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lykie-chip';
      btn.textContent = opt.label;
      btn.onclick = () => {
        const input = $('lykieInput');
        if (!input) return;
        if (/输入姓名|玩家名字|玩家输入/.test(opt.label)) {
          // 「我是（输入姓名）」预填前缀；纯占位则清空待输入
          if (/^我是/.test(opt.label)) {
            input.value = '我是';
            input.placeholder = '补上你的名字…';
          } else {
            input.value = '';
            input.placeholder = '输入你的名字…';
          }
        } else {
          input.value = opt.label;
          input.placeholder = '可改提示后再发送…';
        }
        input.dataset.storyOptId = opt.id;
        input.focus();
        input.dispatchEvent(new Event('input'));
      };
      box.appendChild(btn);
    });
  }

  function clearChips() {
    setChips([]);
    const input = $('lykieInput');
    if (input) {
      delete input.dataset.storyOptId;
      input.placeholder = storyMode
        ? '点上方提示填入，可修改后发送…'
        : '跟她说点什么… 纠正可写：纠正：别分点，短句说';
    }
  }

  function setStoryUI(active) {
    storyMode = active;
    const panel = $('lykiePanel');
    if (panel) panel.classList.toggle('story-mode', active);
    const correct = $('lykieCorrectBtn');
    const ask = $('askLykieBtn');
    const skip = $('lykieSkipWaitBtn');
    const replay = $('lykieReplayStoryBtn');
    if (correct) correct.disabled = !!active;
    if (ask) ask.disabled = !!active;
    if (skip) skip.hidden = true;
    if (replay) replay.hidden = !!active;
    const status = $('lykieStatus');
    if (status && active) status.textContent = '开场剧情进行中…';
    clearChips();
  }

  function matchOption(text, options) {
    const raw = String(text || '').trim();
    if (!raw || !options || !options.length) return null;

    const input = $('lykieInput');
    const hinted = input && input.dataset.storyOptId;
    if (hinted && options.some((o) => o.id === hinted)) return hinted;

    const norm = normalize(raw);
    for (const opt of options) {
      const n = normalize(opt.label);
      if (!n) continue;
      if (norm === n || norm.includes(n) || n.includes(norm)) return opt.id;
    }
    if (/存储程序控制/.test(raw)) {
      const ans = options.find((o) => /存储程序控制/.test(o.label));
      if (ans) return ans.id;
    }

    // 姓名占位：仅单选项、或「我是xxx」、或点过该芯片（已在 hinted 处理）
    for (const opt of options) {
      if (!/输入姓名|玩家名字|玩家输入/.test(opt.label)) continue;
      if (options.length === 1) return opt.id;
      if (/^我是\s*\S+/u.test(raw)) return opt.id;
    }

    let best = null;
    let bestScore = 0;
    for (const opt of options) {
      const n = normalize(opt.label);
      if (n.length < 2) continue;
      let shared = 0;
      const set = new Set([...norm]);
      for (const ch of n) if (set.has(ch)) shared++;
      const score = shared / Math.max(n.length, norm.length);
      if (score > bestScore) {
        bestScore = score;
        best = opt.id;
      }
    }
    return bestScore >= 0.45 ? best : null;
  }

  function localExtractName(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/^(我叫|我是|叫我|名字(?:叫|是)|我的名字(?:叫|是))\s*/u, '');
    s = s.replace(/[的呢啊呀吧了喔哦哈呀嘞啦～~\s！!。.?？、，,]+$/u, '');
    s = s.replace(/^[「『"']|[」』"']$/u, '');
    if (/输入姓名|玩家名字|玩家输入/.test(s)) return '';
    if (s.length > 20) return '';
    s = s.replace(/^(我叫|我是)\s*/u, '').trim();
    return s.slice(0, 40);
  }

  function needsNameExtract(opt, raw) {
    const label = (opt && opt.label) || '';
    if (/输入姓名|玩家名字|玩家输入|我是（输入姓名）/.test(label)) return true;
    if (/^(我叫|我是|叫我)\s*\S+/u.test(String(raw || '').trim())) return true;
    return false;
  }

  async function resolvePlayerName(raw) {
    const fallback = localExtractName(raw);
    try {
      const res = await fetch('/api/lykie/extract_name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return fallback;
      }
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return fallback;
      const data = await res.json();
      const name = (data && data.name ? String(data.name) : '').trim();
      if (name) return name.slice(0, 40);
    } catch (e) {
      /* use fallback */
    }
    return fallback;
  }

  function applyPlaceholders(text) {
    let s = String(text || '');
    let name = (playerName || '').trim();
    // 防御：名字里误带「我叫」时再剥一层
    if (/^(我叫|我是)/.test(name)) name = localExtractName(name) || name;
    if (name) {
      s = s
        .replace(/（玩家名字）/g, name)
        .replace(/\(玩家名字\)/g, name)
        .replace(/\{player_name\}/gi, name)
        .replace(/\{playerName\}/g, name);
    }
    return s;
  }

  async function handleStorySend(text) {
    if (!choiceResolver) {
      appendBubble('system', '等等她说完…');
      return true;
    }
    const raw = String(text || '').trim();
    if (!raw) return true;

    const matched = matchOption(raw, currentOptions);
    if (!matched) {
      appendBubble(
        'system',
        '现在更像在回她这几句。点上方提示填入，改一改再发也可以。',
      );
      return true;
    }

    const opt = currentOptions.find((o) => o.id === matched);

    appendBubble('user', raw);
    const input = $('lykieInput');
    if (input) {
      input.value = '';
      delete input.dataset.storyOptId;
    }

    if (needsNameExtract(opt, raw)) {
      const pending = appendBubble('system', '（记下你的名字…）');
      const name = await resolvePlayerName(raw);
      if (pending && pending.remove) pending.remove();
      if (name) playerName = name;
    }

    const resolve = choiceResolver;
    choiceResolver = null;
    resolve(matched);
    return true;
  }

  async function finishStory(endLabel) {
    storyEnding = endLabel || '结束';
    clearChips();
    if (choiceTimer) {
      clearTimeout(choiceTimer);
      choiceTimer = null;
    }
    try {
      const res = await fetch('/api/story/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_id: 'fragment_01',
          player_name: playerName,
          ending: storyEnding,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
      }
    } catch (e) {
      /* ignore */
    }
    setStoryUI(false);
    appendBubble('system', '—— 开场结束 ——');
    if (/下线/.test(storyEnding)) {
      appendBubble(
        'system',
        '她先下线了。之后可以自由聊；需要可点「重温开场」。刷题照常。',
      );
    } else {
      appendBubble(
        'system',
        '你们打过招呼了。之后可以自由聊，或去刷题；卡住点「问问 Lykie」。',
      );
    }
    const replay = $('lykieReplayStoryBtn');
    if (replay) replay.hidden = false;
    if (typeof refreshLykieState === 'function') await refreshLykieState();
    if (typeof schedulePersistPanel === 'function') schedulePersistPanel();
    const input = $('lykieInput');
    if (input) {
      input.value = '';
      input.placeholder = '跟她说点什么…';
    }
  }

  async function playFrom(startId) {
    let cur = startId;
    while (cur && storyMode) {
      const node = nodeById(cur);
      if (!node) break;
      const type = node.type || 'lykie';
      const data = node.data || {};

      if (type === 'wait') {
        const ms = Number(data.delayMs) || 0;
        const note = data.note ? ` · ${data.note}` : '';
        appendBubble('system', `（等待中${note}）`);
        const skipBtn = $('lykieSkipWaitBtn');
        if (skipBtn) {
          skipBtn.hidden = false;
          skipBtn.disabled = false;
        }
        try {
          await Promise.race([
            sleep(ms, storyAbort.signal),
            new Promise((resolve) => {
              waitSkipResolver = resolve;
            }),
          ]);
        } catch (e) {
          if (e.name === 'AbortError') return;
          throw e;
        } finally {
          waitSkipResolver = null;
          if (skipBtn) skipBtn.hidden = true;
        }
        const edge = nextEdge(cur, OUT);
        cur = edge ? edge.target : '';
        continue;
      }

      if (type === 'end') {
        appendBubble('system', String(data.label || '结束'));
        await finishStory(String(data.label || '结束'));
        return;
      }

      if (type === 'choice') {
        const opts = data.options || [];
        const timeoutMs = Number(data.timeoutMs) || 0;
        setChips(opts);
        const input = $('lykieInput');
        if (input) {
          input.value = '';
          input.placeholder = '点上方提示填入，可修改后发送…';
          input.focus();
        }
        if (typeof setLykiePanelOpen === 'function') setLykiePanelOpen(true);

        const picked = await new Promise((resolve) => {
          choiceResolver = resolve;
          if (choiceTimer) clearTimeout(choiceTimer);
          choiceTimer = null;
          if (timeoutMs > 0) {
            choiceTimer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
          }
        });
        choiceResolver = null;
        if (choiceTimer) {
          clearTimeout(choiceTimer);
          choiceTimer = null;
        }
        clearChips();

        if (picked === TIMEOUT) {
          appendBubble('system', '（没有插上话）');
        }
        const edge = nextEdge(cur, picked);
        if (!edge) {
          appendBubble('system', '这条选项还没接上线，剧情暂停。');
          await finishStory('断线');
          return;
        }
        cur = edge.target;
        continue;
      }

      const delayMs = Number(data.delayMs) || 0;
      if (delayMs > 0) {
        try {
          await sleep(delayMs, storyAbort.signal);
        } catch (e) {
          if (e.name === 'AbortError') return;
          throw e;
        }
      }
      const text = applyPlaceholders(String(data.text || ''));
      if (type === 'system') appendBubble('system', text);
      else appendBubble('assistant', text);

      const edge = nextEdge(cur, OUT);
      cur = edge ? edge.target : '';
      if (!cur) {
        await finishStory('末尾');
        return;
      }
    }
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('未登录');
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const hint = res.status === 404
        ? '接口不存在：请关闭旧窗口后重新运行「启动背题助手.bat」'
        : `服务器返回了非 JSON（HTTP ${res.status}）`;
      throw new Error(hint);
    }
    const data = await res.json();
    if (!res.ok && data && data.error) {
      throw new Error(data.error);
    }
    return data;
  }

  async function startFragment01(force) {
    if (storyBusy) return false;
    storyBusy = true;
    if (storyAbort) storyAbort.abort();
    storyAbort = new AbortController();
    playerName = '';
    storyEnding = '';

    try {
      if (!force) {
        const st = await fetchJson('/api/lykie/state');
        if (st.flags && st.flags.fragment_01_done) {
          return false;
        }
      } else {
        await fetchJson('/api/story/reset', { method: 'POST' });
      }

      const res = await fetchJson('/api/story/fragment_01');
      if (!res.ok || !res.graph) {
        appendBubble('system', res.error || '加载开场失败');
        return false;
      }
      storyGraph = res.graph;
      const box = $('lykieMessages');
      if (box) box.innerHTML = '';
      setStoryUI(true);
      if (typeof setLykiePanelOpen === 'function') setLykiePanelOpen(true);
      appendBubble('system', '消息突然弹进来…');
      await playFrom(storyGraph.startNodeId || 'a_q');
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        appendBubble('system', '剧情播放出错：' + (e.message || e));
        setStoryUI(false);
      }
      return false;
    } finally {
      storyBusy = false;
    }
  }

  window.StoryRunner = {
    isActive: () => storyMode,
    startFragment01,
    handleSend: handleStorySend,
    skipWait: () => {
      if (waitSkipResolver) waitSkipResolver();
    },
  };

  const skip = $('lykieSkipWaitBtn');
  if (skip) skip.onclick = () => window.StoryRunner.skipWait();
  const replay = $('lykieReplayStoryBtn');
  if (replay) {
    replay.onclick = () => {
      if (await uiConfirm('重温开场剧情？当前面板消息会被清空。')) {
        startFragment01(true);
      }
    };
  }
})();
