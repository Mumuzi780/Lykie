/* 翻译专项练习：列表页 + 练习页（逐句作答/润色编辑）。
   数据与整卷共享（同 text_id 同 storage key），API 全部复用整卷翻译路由。 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var listView = $('listView');
  var practiceView = $('practiceView');
  var paperList = $('paperList');
  var listEmpty = $('listEmpty');
  var sentList = $('sentList');
  var workArea = $('workArea');
  var practiceTitle = $('practiceTitle');

  var papers = [];       // 列表数据
  var textId = '';       // 当前卷
  var sents = [];        // 中文句
  var trState = null;    // {answers, hints, evals, polish}
  var cur = 0;           // 当前句
  var hintStage = {};    // 词块展开态（纯前端）
  var view = 'sents';    // 'sents' | 'polish'

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('请求失败 ' + r.status));
        return j;
      });
    });
  }

  function get(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('请求失败 ' + r.status));
        return j;
      });
    });
  }

  // ---------- 列表页 ----------

  function renderList() {
    paperList.innerHTML = '';
    listEmpty.hidden = papers.length > 0;
    papers.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'paper-card';
      var done = p.written >= p.sents;
      card.innerHTML = '<div class="paper-card-main">'
        + '<div class="paper-card-title">' + escapeHtml(p.title || p.source || '未命名卷') + '</div>'
        + '<div class="paper-card-preview">' + escapeHtml(p.preview) + '</div></div>'
        + '<div class="paper-card-meta">'
        + '<span class="paper-card-progress' + (done ? ' is-done' : '') + '">' + p.written + '/' + p.sents + ' 句</span>'
        + (p.full_evaled ? '<span class="paper-card-badge is-done">已整段评价</span>' : '')
        + '</div>';
      card.addEventListener('click', function () { loadPractice(p.text_id); });
      paperList.appendChild(card);
    });
  }

  function loadList() {
    get('/api/translate/papers').then(function (j) {
      papers = j.papers || [];
      renderList();
    }).catch(function (e) { alert(e.message); });
  }

  // ---------- 练习页 ----------

  function joined() {
    return sents.map(function (_, i) { return (trState.answers[String(i)] || '').trim(); })
      .filter(function (a) { return a; }).join(' ');
  }

  function allWritten() {
    return sents.every(function (_, i) { return (trState.answers[String(i)] || '').trim(); });
  }

  function firstPending() {
    for (var i = 0; i < sents.length; i++) {
      if (!(trState.answers[String(i)] || '').trim()) return i;
    }
    return sents.length - 1;
  }

  function renderSentList() {
    sentList.innerHTML = '';
    sents.forEach(function (cn, i) {
      var written = (trState.answers[String(i)] || '').trim();
      var ev = (trState.evals || {})[String(i)];
      var fresh = written && ev && ev.answer === written && ev.comment;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'sent-item' + (i === cur && view === 'sents' ? ' is-cur' : '');
      item.innerHTML = '<span class="sent-idx">' + (i + 1) + '</span>'
        + '<span class="sent-cn">' + escapeHtml(cn.slice(0, 18)) + '</span>'
        + '<span class="sent-mark' + (fresh ? ' is-written' : '') + '">'
        + (fresh ? '评' : (written ? '写' : '')) + '</span>';
      item.addEventListener('click', function () {
        saveAnswer(false).then(function () { cur = i; view = 'sents'; render(); });
      });
      sentList.appendChild(item);
    });
    // 终态入口
    if (allWritten()) {
      var pol = document.createElement('button');
      pol.type = 'button';
      pol.className = 'sent-item sent-polish-item' + (view === 'polish' ? ' is-cur' : '');
      pol.innerHTML = '<span class="sent-idx">&Sigma;</span><span class="sent-cn">整段润色</span>';
      pol.addEventListener('click', function () {
        saveAnswer(false).then(function () { view = 'polish'; render(); });
      });
      sentList.appendChild(pol);
    }
  }

  function renderHintList(i) {
    var hints = (trState.hints || {})[String(i)] || null;
    if (!hints) return '';
    var ev = (trState.evals || {})[String(i)] || {};
    return hints.map(function (h, k) {
      var open = hintStage[i + ':' + k];
      var detail = '';
      if (open) {
        detail = '<div class="ta-hint-detail">'
          + (h.variants || []).map(function (v, vi) {
            var isRec = v === h.recommended;
            return '<div class="ta-hint-variant' + (isRec ? ' ta-hint-rec' : '') + '">'
              + escapeHtml(v) + (isRec ? '<span class="ta-hint-rec-tag">推荐</span>' : '')
              + '<button type="button" class="ta-hint-save" data-i="' + i + '" data-k="' + k
              + '" data-v="' + vi + '" title="存入资产库（词头+中文释义+例句）">存入库</button></div>';
          }).join('')
          + (h.note ? '<div class="ta-hint-note">' + escapeHtml(h.note) + '</div>' : '')
          + '</div>';
      }
      return '<div class="ta-hint-item">'
        + '<button type="button" class="ta-hint-row" data-i="' + i + '" data-k="' + k + '">'
        + escapeHtml(h.cn || '') + '</button>' + detail + '</div>';
    }).join('');
  }

  function renderEval(i) {
    var ev = (trState.evals || {})[String(i)];
    var curAns = (trState.answers[String(i)] || '').trim();
    if (!ev || !curAns || ev.answer !== curAns || !ev.comment) return '';
    return '<div class="ta-eval">'
      + '<div class="ta-eval-comment">' + escapeHtml(ev.comment) + '</div>'
      + (ev.reference ? '<div class="ta-eval-ref"><span class="ta-eval-ref-tag">参考</span><span>'
        + escapeHtml(ev.reference) + '</span></div>' : '')
      + '</div>';
  }

  function renderSents() {
    var i = cur;
    var curAns = (trState.answers[String(i)] || '').trim();
    var last = i === sents.length - 1;
    var html = '<p class="ta-head">第 ' + (i + 1) + '/' + sents.length + ' 句</p>';
    html += '<p class="ta-cn">' + escapeHtml(sents[i]) + '</p>';
    html += '<textarea class="ta-input" id="taInput" data-i="' + i
      + '" maxlength="2000" placeholder="写出这句的英文译文…">' + escapeHtml(curAns) + '</textarea>';
    html += renderEval(i);
    html += '<div class="ta-hints" id="taHints">' + renderHintList(i) + '</div>';
    html += '<div class="ta-actions">'
      + '<button type="button" class="btn ghost" id="btnHint">提示</button>'
      + '<button type="button" class="btn ghost" id="btnEval"' + (curAns ? '' : ' disabled') + '>AI 评价</button>'
      + (last && allWritten() ? '<button type="button" class="btn ghost" id="btnToPolish">去整段润色</button>' : '')
      + '</div>';
    workArea.innerHTML = html;
  }

  function renderPolish() {
    var polish = trState.polish;
    var nowJoined = sents.map(function (_, i) {
      return (trState.answers[String(i)] || '').trim();
    }).join(' ');
    var stale = polish && polish.base !== nowJoined;
    var text = polish ? polish.text : nowJoined;
    var fullEval = (trState.evals || {})['full'];
    var freshFull = fullEval && fullEval.answer === (stale ? nowJoined : (polish ? polish.text : nowJoined));

    var html = '<p class="ta-head">整段润色 · 把逐句的产出组装成连贯短文（加连词、统一术语、调语序）</p>';
    html += '<p class="polish-cn">' + escapeHtml(sents.join('')) + '</p>';
    html += '<div class="polish-area">'
      + '<textarea class="polish-input" id="polishInput" maxlength="6000">' + escapeHtml(text) + '</textarea>'
      + '</div>';
    if (stale) {
      html += '<div class="polish-stale">逐句译文在润色后改过，这份润色稿基于旧版本——改完上面内容重新保存即可。</div>';
    }
    if (freshFull && fullEval.comment) {
      html += '<div class="ta-eval polish-full-eval">'
        + '<div class="ta-eval-comment">' + escapeHtml(fullEval.comment) + '</div>'
        + (fullEval.reference ? '<div class="ta-eval-ref"><span class="ta-eval-ref-tag">整段参考</span><span>'
          + escapeHtml(fullEval.reference) + '</span></div>' : '')
        + '</div>';
    }
    html += '<div class="ta-actions">'
      + '<button type="button" class="btn ghost" id="btnSavePolish">保存润色稿</button>'
      + '<button type="button" class="btn ghost" id="btnEvalFull">整段 AI 评价</button>'
      + '</div>';
    workArea.innerHTML = html;
  }

  function render() {
    renderSentList();
    if (view === 'polish' && allWritten()) renderPolish();
    else { view = 'sents'; renderSents(); }
  }

  function saveAnswer(silent) {
    var el = $('taInput');
    if (!el || !trState) return Promise.resolve(true);
    var i = Number(el.dataset.i) || 0;
    var val = el.value.trim();
    return post('/api/reading/' + textId + '/translation/answer',
      { sent_idx: i, text: val }).then(function () {
      if (val) trState.answers[String(i)] = val;
      else delete trState.answers[String(i)];
      return true;
    }).catch(function (e) {
      if (!silent) alert(e.message);
      return false;
    });
  }

  function bindWorkArea() {
    workArea.addEventListener('click', function (ev) {
      var t = ev.target;

      if (t.closest('#btnHint')) {
        var host = $('taHints');
        if (host) host.innerHTML = '<span class="ta-hint-loading">生成中…（已生成过的不重复调用）</span>';
        post('/api/reading/' + textId + '/translation/hint', { sent_idx: cur })
          .then(function (j) {
            trState.hints = trState.hints || {};
            trState.hints[String(cur)] = j.hints || [];
            if (host) host.innerHTML = renderHintList(cur);
          })
          .catch(function (e) { if (host) host.innerHTML = ''; alert(e.message); });
        return;
      }

      var row = t.closest('.ta-hint-row');
      if (row) {
        var key = row.dataset.i + ':' + row.dataset.k;
        hintStage[key] = !hintStage[key];
        var host2 = $('taHints');
        if (host2) host2.innerHTML = renderHintList(cur);
        return;
      }

      var saveBtn = t.closest('.ta-hint-save');
      if (saveBtn && !saveBtn.disabled) {
        var i = Number(saveBtn.dataset.i) || 0;
        var k = Number(saveBtn.dataset.k) || 0;
        var vi = Number(saveBtn.dataset.v) || 0;
        var block = ((trState.hints || {})[String(i)] || [])[k];
        var word = block && (block.variants || [])[vi];
        if (!word) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '入库中…';
        var ev2 = (trState.evals || {})[String(i)] || {};
        var examples = ev2.reference ? (ev2.reference + '||' + sents[i]) : '';
        post('/api/assets/vocab', {
          word: word, pos: 'other', meaning: block.cn || '',
          examples: examples, source: '四级翻译',
        }).then(function () {
          saveBtn.textContent = '已入库';
        }).catch(function (e) {
          alert(e.message);
          saveBtn.disabled = false;
          saveBtn.textContent = '存入库';
        });
        return;
      }

      if (t.closest('#btnEval') && !t.disabled) {
        var btn = t.closest('#btnEval');
        saveAnswer(false).then(function (ok) {
          if (!ok) return;
          btn.disabled = true;
          btn.textContent = '评价中…';
          post('/api/reading/' + textId + '/translation/evaluate', { sent_idx: cur })
            .then(function (j) {
              trState.evals = trState.evals || {};
              trState.evals[String(cur)] = j.eval;
              render();
            })
            .catch(function (e) {
              alert(e.message);
              btn.disabled = false;
              btn.textContent = 'AI 评价';
            });
        });
        return;
      }

      if (t.closest('#btnToPolish')) {
        saveAnswer(false).then(function (ok) {
          if (ok) { view = 'polish'; render(); }
        });
        return;
      }

      if (t.closest('#btnSavePolish')) {
        var ta = $('polishInput');
        var val2 = ta ? ta.value.trim() : '';
        if (!val2) { alert('润色稿为空'); return; }
        var sp = t.closest('#btnSavePolish');
        sp.disabled = true;
        sp.textContent = '保存中…';
        post('/api/reading/' + textId + '/translation/polish', { text: val2 })
          .then(function () {
            trState.polish = { text: val2, base: sents.map(function (_, i2) {
              return (trState.answers[String(i2)] || '').trim();
            }).join(' ') };
            render();
          })
          .catch(function (e) {
            alert(e.message);
            sp.disabled = false;
            sp.textContent = '保存润色稿';
          });
        return;
      }

      if (t.closest('#btnEvalFull')) {
        var ef = t.closest('#btnEvalFull');
        // 润色稿未保存的编辑先落库（评价对象润色稿优先）
        var pi = $('polishInput');
        var pre = pi ? pi.value.trim() : '';
        var doEval = function () {
          ef.disabled = true;
          ef.textContent = '整段评价中…';
          post('/api/reading/' + textId + '/translation/evaluate', { full: true })
            .then(function (j) {
              trState.evals = trState.evals || {};
              trState.evals['full'] = j.eval;
              render();
            })
            .catch(function (e) {
              alert(e.message);
              ef.disabled = false;
              ef.textContent = '整段 AI 评价';
            });
        };
        if (pre && (!trState.polish || trState.polish.text !== pre)) {
          post('/api/reading/' + textId + '/translation/polish', { text: pre })
            .then(function () {
              trState.polish = { text: pre, base: sents.map(function (_, i3) {
                return (trState.answers[String(i3)] || '').trim();
              }).join(' ') };
              doEval();
            })
            .catch(function (e) { alert(e.message); });
        } else {
          doEval();
        }
        return;
      }
    });

    // 未写句解锁按钮（v41 教训：disabled 不能渲染时固化）
    workArea.addEventListener('input', function (ev) {
      if (!ev.target || ev.target.id !== 'taInput' || !trState) return;
      var has = ev.target.value.trim().length > 0;
      var eb = workArea.querySelector('#btnEval');
      if (eb) eb.disabled = !has;
    });

    // 失焦静默保存
    workArea.addEventListener('focusout', function (ev) {
      if (ev.target && ev.target.id === 'taInput' && trState) saveAnswer(true);
    });
  }

  // 列表卡片点击 → loadPractice（取句与状态走 view payload 一次拿全）
  function loadPractice(id) {
    textId = String(id);
    get('/api/reading/view/' + textId).then(function (j) {
      var secs = (j.sections || []).filter(function (s) { return s.kind === 'translation'; });
      if (!secs.length) { alert('这篇没有翻译题'); return; }
      sents = secs[0].sents || [];
      trState = j.translation || { answers: {}, hints: {}, evals: {}, polish: null };
      hintStage = {};
      practiceTitle.textContent = (j.text && j.text.title) || '翻译练习';
      cur = (function () {
        for (var i = 0; i < sents.length; i++) {
          if (!((trState.answers || {})[String(i)] || '').trim()) return i;
        }
        return sents.length - 1;
      })();
      view = 'sents';
      listView.hidden = true;
      practiceView.hidden = false;
      render();
    }).catch(function (e) { alert(e.message); });
  }

  $('btnList').addEventListener('click', function () {
    practiceView.hidden = true;
    listView.hidden = false;
    loadList();
  });

  // 列表卡片点击 → loadPractice
  paperList.addEventListener('click', function (ev) {
    var card = ev.target.closest('.paper-card');
    if (!card) return;
    var idx = Array.prototype.indexOf.call(paperList.children, card);
    if (idx >= 0 && papers[idx]) loadPractice(papers[idx].text_id);
  });

  bindWorkArea();
  loadList();
})();
