/**
 * Lykie 音效 — 拇指琴（kalimba）质感程序合成（Web Audio）
 * - 每题答对：按连击爬音阶弹奏；3/5/10 加厚双音/琶音
 * - 答错：低沉短促「闷弹」
 * - 斩 / Lykie ping / UI
 * 替换采样：LykieSfx.setSamples({ correct: url, wrong: url, ... })
 */
(function (global) {
  const STORAGE_KEY = 'lykieSfxEnabled';
  const MILESTONES = [3, 5, 10];
  /** 相对媒体内容偏小声；统一抬高，约对齐「刷视频 30%」听感 */
  const MASTER_GAIN = 4.2;

  let ctx = null;
  let masterOut = null;
  let enabled = true;
  /** @type {Record<string, AudioBuffer|null>} */
  const sampleBuf = {};
  /** @type {Record<string, string>} */
  const sampleUrl = {};

  const CORRECT_SCALE = [
    261.63, // C4
    293.66, // D4
    329.63, // E4
    392.0,  // G4
    440.0,  // A4
    523.25, // C5
    587.33, // D5
    659.25, // E5
    783.99, // G5
    880.0,  // A5
  ];

  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === '0') enabled = false;
    if (v === '1') enabled = true;
  } catch (e) { /* ignore */ }

  // 清掉夸克适配时期留下的引擎偏好
  try {
    localStorage.removeItem('lykieSfxEngine');
  } catch (e) { /* ignore */ }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      masterOut = ctx.createGain();
      masterOut.gain.value = MASTER_GAIN;
      masterOut.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      masterOut = null;
      return null;
    }
    return ctx;
  }

  function outNode() {
    const c = ensureCtx();
    if (!c) return null;
    return masterOut || c.destination;
  }

  /** 播放前等 AudioContext resume（移动端手势策略） */
  function runWhenReady(fn) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const run = () => {
      try {
        fn(c);
      } catch (e) {
        console.warn('[LykieSfx] play fail', e);
      }
    };
    if (c.state === 'suspended') {
      c.resume().then(run).catch(() => {});
    } else {
      run();
    }
  }

  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(on) {
    const was = enabled;
    enabled = !!on;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch (e) { /* ignore */ }
    if (enabled) {
      unlock();
      if (!was) setTimeout(() => play('ui'), 0);
    }
    global.dispatchEvent(new CustomEvent('lykie-sfx-toggle', { detail: { enabled } }));
  }

  function toggle() {
    setEnabled(!enabled);
    return enabled;
  }

  function freqForStreak(streak) {
    const i = Math.max(0, Math.min(CORRECT_SCALE.length - 1, (streak | 0) - 1));
    return CORRECT_SCALE[i];
  }

  /**
   * 单根舌片：基频 + 轻微非谐泛音 + 极短拨片噪声
   */
  function pluck(freq, t0, opts) {
    const c = ctx;
    const dur = (opts && opts.dur) != null ? opts.dur : 0.55;
    const peak = (opts && opts.peak) != null ? opts.peak : 0.14;
    const dull = !!(opts && opts.dull);

    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + 0.004);
    master.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 0.08);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    master.connect(outNode());

    const o1 = c.createOscillator();
    const g1 = c.createGain();
    o1.type = dull ? 'triangle' : 'sine';
    o1.frequency.value = freq;
    g1.gain.value = dull ? 0.9 : 0.75;
    o1.connect(g1);
    g1.connect(master);
    o1.start(t0);
    o1.stop(t0 + dur + 0.02);

    if (!dull) {
      const o1b = c.createOscillator();
      const g1b = c.createGain();
      o1b.type = 'triangle';
      o1b.frequency.value = freq;
      g1b.gain.value = 0.22;
      o1b.connect(g1b);
      g1b.connect(master);
      o1b.start(t0);
      o1b.stop(t0 + dur + 0.02);
    }

    const partial = dull ? freq * 2.0 : freq * 2.76;
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o2.type = 'sine';
    o2.frequency.value = partial;
    g2.gain.value = dull ? 0.08 : 0.18;
    o2.connect(g2);
    g2.connect(master);
    o2.start(t0);
    o2.stop(t0 + dur * 0.7);

    if (!dull) {
      const o3 = c.createOscillator();
      const g3 = c.createGain();
      o3.type = 'sine';
      o3.frequency.value = freq * 4.1;
      g3.gain.value = 0.06;
      o3.connect(g3);
      g3.connect(master);
      o3.start(t0);
      o3.stop(t0 + dur * 0.35);
    }

    const nLen = Math.floor(c.sampleRate * 0.02);
    const noiseBuf = c.createBuffer(1, nLen, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const noise = c.createBufferSource();
    const ng = c.createGain();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(4000, freq * 3);
    bp.Q.value = 2.5;
    noise.buffer = noiseBuf;
    ng.gain.setValueAtTime(dull ? 0.04 : 0.07, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(master);
    noise.start(t0);
  }

  function dualPluck(lowHz, highHz, opts) {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.008;
    const peak = (opts && opts.peak) || 0.13;
    pluck(lowHz, t0, { dur: 0.6, peak: peak * 0.75 });
    pluck(highHz, t0 + 0.03, { dur: 0.55, peak: peak });
  }

  function arpeggioPluck(freqs, opts) {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.008;
    const step = (opts && opts.step) || 0.05;
    const peak = (opts && opts.peak) || 0.12;
    freqs.forEach((f, i) => {
      pluck(f, t0 + i * step, {
        dur: 0.45,
        peak: peak * (0.85 + 0.05 * i),
      });
    });
  }

  async function loadSample(key, url) {
    sampleUrl[key] = url;
    const c = ensureCtx();
    if (!c || !url) {
      sampleBuf[key] = null;
      return;
    }
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.arrayBuffer();
      sampleBuf[key] = await c.decodeAudioData(arr.slice(0));
    } catch (e) {
      sampleBuf[key] = null;
      console.warn('[LykieSfx] sample load fail', key, e);
    }
  }

  function setSamples(map) {
    return Promise.all(Object.keys(map || {}).map((k) => loadSample(k, map[k])));
  }

  function playBuffer(key, gainPeak) {
    const buf = sampleBuf[key];
    const c = ensureCtx();
    const dest = outNode();
    if (!buf || !c || !dest) return false;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    g.gain.value = gainPeak == null ? 0.9 : gainPeak;
    src.connect(g);
    g.connect(dest);
    src.start();
    return true;
  }

  function playCorrectSynth(streak) {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const n = Math.max(1, streak | 0);
    const f = freqForStreak(n);
    const t0 = c.currentTime + 0.008;

    if (n === 10) {
      arpeggioPluck([392.0, 493.88, 587.33, 783.99], { step: 0.048, peak: 0.13 });
      return;
    }
    if (n === 5) {
      dualPluck(392.0, f, { peak: 0.14 });
      return;
    }
    if (n === 3) {
      dualPluck(329.63, f, { peak: 0.13 });
      return;
    }
    pluck(f, t0, { dur: 0.5, peak: 0.12 + Math.min(0.04, n * 0.004) });
    pluck(f * 1.5, t0 + 0.025, { dur: 0.35, peak: 0.045 });
  }

  function playWrongSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.008;
    pluck(220.0, t0, { dur: 0.28, peak: 0.1, dull: true });
    pluck(196.0, t0 + 0.07, { dur: 0.32, peak: 0.08, dull: true });
  }

  function playKillSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    dualPluck(196.0, 392.0, { peak: 0.15 });
    setTimeout(() => {
      const c2 = ensureCtx();
      if (!c2) return;
      pluck(587.33, c2.currentTime + 0.01, { dur: 0.4, peak: 0.1 });
    }, 60);
  }

  function playPingSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    pluck(659.25, c.currentTime + 0.008, { dur: 0.35, peak: 0.08 });
  }

  function playUiSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    pluck(523.25, c.currentTime + 0.005, { dur: 0.22, peak: 0.05 });
  }

  function playSelectSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.004;
    pluck(659.25, t0, { dur: 0.18, peak: 0.055 });
  }

  function playDeselectSynth() {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.004;
    pluck(392.0, t0, { dur: 0.14, peak: 0.04, dull: true });
  }

  function playSynth(name, streak) {
    if (name === 'correct' || name === 'combo') playCorrectSynth(streak || 1);
    else if (name === 'wrong') playWrongSynth();
    else if (name === 'combo3') playCorrectSynth(3);
    else if (name === 'combo5') playCorrectSynth(5);
    else if (name === 'combo10') playCorrectSynth(10);
    else if (name === 'kill') playKillSynth();
    else if (name === 'ping') playPingSynth();
    else if (name === 'ui') playUiSynth();
    else if (name === 'select') playSelectSynth();
    else if (name === 'deselect') playDeselectSynth();
  }

  function play(name, streak) {
    runWhenReady(() => {
      const key = name === 'correct' ? 'correct' : name;
      if (name === 'correct' && playBuffer('correct')) return;
      if (playBuffer(key)) return;
      playSynth(name, streak);
    });
  }

  function isMilestone(n) {
    return MILESTONES.indexOf(n) !== -1;
  }

  function onCorrect(streak) {
    runWhenReady(() => {
      if (playBuffer('correct')) return;
      playCorrectSynth(streak);
    });
  }

  function onWrong() {
    play('wrong');
  }

  function onKill(streakAfter) {
    runWhenReady(() => {
      if (playBuffer('kill')) {
        if (isMilestone(streakAfter)) {
          setTimeout(() => runWhenReady(() => playCorrectSynth(streakAfter)), 90);
        }
        return;
      }
      playKillSynth();
      if (isMilestone(streakAfter)) {
        setTimeout(() => runWhenReady(() => playCorrectSynth(streakAfter)), 90);
      }
    });
  }

  function onLykieMessage(panelOpen) {
    if (panelOpen) return;
    play('ping');
  }

  function onUiOpen() {
    play('ui');
  }

  function onToggleSelect(checked) {
    play(checked ? 'select' : 'deselect');
  }

  function onBankSwitch() {
    runWhenReady((c) => {
      if (playBuffer('bank')) return;
      const t0 = c.currentTime + 0.005;
      pluck(523.25, t0, { dur: 0.16, peak: 0.045 });
      pluck(659.25, t0 + 0.055, { dur: 0.2, peak: 0.055 });
    });
  }

  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((ev) => {
    global.addEventListener(ev, unlock, { passive: true });
  });

  global.LykieSfx = {
    MILESTONES,
    unlock,
    runWhenReady,
    isEnabled,
    setEnabled,
    toggle,
    play,
    playSynth,
    setSamples,
    onCorrect,
    onWrong,
    onKill,
    onLykieMessage,
    onUiOpen,
    onToggleSelect,
    onBankSwitch,
    isMilestone,
    previewAll() {
      runWhenReady(() => {
        const was = enabled;
        enabled = true;
        const steps = [
          () => playCorrectSynth(1),
          () => playCorrectSynth(2),
          () => playCorrectSynth(3),
          () => playCorrectSynth(5),
          () => playCorrectSynth(10),
          () => playWrongSynth(),
          () => playKillSynth(),
          () => playPingSynth(),
          () => playUiSynth(),
        ];
        steps.forEach((fn, i) => setTimeout(() => runWhenReady(fn), i * 480));
        setTimeout(() => { enabled = was; }, steps.length * 480 + 200);
      });
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
