/* Atlas 作者工具（阶段二：分节总览 + 钻取条目） */
(function () {
  "use strict";

  var state = {
    tab: "entries",
    entries: [],
    sections: [],
    facts: [],
    proseStale: false,
    draftStatus: { total: 0, pending: 0 },
    currentSection: null,  // 钻取中的节名；null = 总览
    editing: null,         // 正在编辑的条目引用
    dirty: false,
  };

  var $ = function (id) { return document.getElementById(id); };

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok === false) { throw new Error(d && d.error || "请求失败"); }
        return d;
      });
  }

  function chip(cls, text) {
    return '<span class="atlas-chip ' + cls + '">' + text + "</span>";
  }

  var LAYER_LABEL = { core: "核", stable: "稳", current: "摆", floating: "未分组" };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- 分节总览 ----------
  function sectionFlags(name) {
    // 节级 flag = 节内条目全部带该标（与后端口径一致）
    var members = state.entries.filter(function (e) { return (e.section || "") === name; });
    return {
      secret: members.length > 0 && members.every(function (e) { return !!e.secret; }),
      undecided: members.length > 0 && members.every(function (e) { return !!e.undecided; }),
      verbatim: members.length > 0 && members.every(function (e) { return !!e.verbatim; }),
    };
  }

  function renderSections() {
    var box = $("sectionList");
    if (!state.sections.length) {
      box.innerHTML = '<div class="atlas-empty">还没有分节。点上方「从 self.txt 导入草稿」开始。</div>';
      return;
    }
    var sorted = state.sections.slice().sort(function (a, b) { return (a.weight || 0) - (b.weight || 0); });
    box.innerHTML = sorted.map(function (s) {
      var count = state.entries.filter(function (e) { return (e.section || "") === s.name; }).length;
      var flags = sectionFlags(s.name);
      var chips = [];
      if (flags.secret) chips.push(chip("secret", "🔒禁语"));
      if (flags.undecided) chips.push(chip("undecided", "未定"));
      if (flags.verbatim) chips.push(chip("verbatim", "逐字"));
      return '<div class="atlas-section-card" data-name="' + escapeHtml(s.name) + '">' +
        '<div class="atlas-section-name">' + escapeHtml(s.name) + "</div>" +
        '<div class="atlas-section-meta">' + count + " 条" + (chips.length ? " · " + chips.join("") : "") + "</div>" +
        '<label class="atlas-weight">权重 <input type="number" step="1" data-name="' + escapeHtml(s.name) + '" value="' + (s.weight || 0) + '"></label>' +
        "</div>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".atlas-section-card"), function (card) {
      card.addEventListener("click", function (ev) {
        if (ev.target.tagName === "INPUT") return;
        state.currentSection = card.getAttribute("data-name");
        renderEntryPane();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll(".atlas-weight input"), function (inp) {
      inp.addEventListener("change", function () {
        var s = null;
        for (var i = 0; i < state.sections.length; i++) {
          if (state.sections[i].name === inp.getAttribute("data-name")) { s = state.sections[i]; break; }
        }
        if (!s) return;
        s.weight = parseInt(inp.value, 10) || 0;
        state.dirty = true;
        renderSections();
      });
    });
  }

  // ---------- 钻取条目 ----------
  function isFieldEntry(text) {
    var t = (text || "").trim();
    return t.indexOf("\n") === -1 && t.length <= 40;
  }

  function renderEntryPane() {
    var inDrill = !!state.currentSection;
    $("sectionView").hidden = inDrill;
    $("entryView").hidden = !inDrill;
    if (!inDrill) { renderSections(); return; }
    $("entryViewTitle").textContent = "【" + state.currentSection + "】";
    var ul = $("entryList");
    var list = state.entries.filter(function (e) { return (e.section || "") === state.currentSection; });
    if (!list.length) {
      ul.innerHTML = '<li class="atlas-empty">本节还没有条目。点「＋ 新增条目」。</li>';
      return;
    }
    ul.innerHTML = list.map(function (e) {
      var chips = [];
      if (e.secret) chips.push(chip("secret", "🔒禁语"));
      if (e.undecided) chips.push(chip("undecided", "未定"));
      if (e.verbatim) chips.push(chip("verbatim", "逐字"));
      if (isFieldEntry(e.text)) chips.push(chip("", "字段"));
      if (e.source) chips.push(chip("", e.source));
      return '<li class="atlas-item" data-id="' + e.id + '">' +
        '<div class="atlas-item-text">' + escapeHtml(e.text) + "</div>" +
        '<div class="atlas-item-meta">' + chips.join("") + "</div></li>";
    }).join("");
    Array.prototype.forEach.call(ul.querySelectorAll(".atlas-item"), function (li) {
      li.addEventListener("click", function () { openEntryModal(li.getAttribute("data-id")); });
    });
  }

  function renderFacts() {
    var ul = $("factList");
    if (!state.facts.length) {
      ul.innerHTML = '<li class="atlas-empty">Lykie 还没记住任何关于他的事实。</li>';
      return;
    }
    ul.innerHTML = state.facts.map(function (f, i) {
      var chips = [chip(f.layer, LAYER_LABEL[f.layer] || f.layer)];
      if (f.added) chips.push(chip("", f.added));
      return '<li class="atlas-item" data-idx="' + i + '">' +
        '<div class="atlas-item-text">' + escapeHtml(f.text) + "</div>" +
        '<div class="atlas-item-meta">' + chips.join("") + "</div></li>";
    }).join("");
    Array.prototype.forEach.call(ul.querySelectorAll(".atlas-item"), function (li) {
      li.addEventListener("click", function () { openFactModal(parseInt(li.getAttribute("data-idx"), 10)); });
    });
  }

  function renderHeader() {
    $("proseStale").hidden = !state.proseStale;
    var ds = state.draftStatus || { total: 0, pending: 0 };
    $("draftStatus").textContent = "共 " + ds.total + " 条，未分组 " + ds.pending + " 条";
  }

  function renderAll() {
    renderEntryPane();
    renderFacts();
    renderHeader();
  }

  function loadState() {
    return api("/api/atlas/state").then(function (d) {
      state.entries = d.entries || [];
      state.sections = d.sections || [];
      state.facts = d.facts || [];
      state.proseStale = !!d.prose_stale;
      state.draftStatus = d.draft_status || { total: 0, pending: 0 };
      state.dirty = false;
      renderAll();
    });
  }

  // ---------- 条目编辑 ----------
  function fillSectionOptions(selected) {
    $("entrySection").innerHTML = state.sections.map(function (s) {
      return '<option value="' + escapeHtml(s.name) + '"' +
        (s.name === selected ? " selected" : "") + ">" + escapeHtml(s.name) + "</option>";
    }).join("");
  }

  function setTextControl(text) {
    var field = isFieldEntry(text);
    $("entryText").hidden = field;
    $("entryTextInput").hidden = !field;
    if (field) { $("entryTextInput").value = text; } else { $("entryText").value = text; }
  }

  function textControlValue() {
    return ($("entryText").hidden ? $("entryTextInput").value : $("entryText").value).trim();
  }

  function openEntryModal(id) {
    var e = null;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) { e = state.entries[i]; break; }
    }
    if (!e) return;
    state.editing = e;
    $("entryModalTitle").textContent = "编辑条目";
    setTextControl(e.text);
    fillSectionOptions(e.section || state.currentSection || "");
    $("entrySecret").checked = !!e.secret;
    $("entryUndecided").checked = !!e.undecided;
    $("entryVerbatim").checked = !!e.verbatim;
    $("entryDeleteBtn").hidden = false;
    $("entryModal").hidden = false;
  }

  function openEntryModalNew() {
    state.editing = null;
    $("entryModalTitle").textContent = "新增条目";
    setTextControl("");
    $("entryText").hidden = true;
    $("entryTextInput").hidden = false;
    fillSectionOptions(state.currentSection || (state.sections[0] && state.sections[0].name) || "");
    $("entrySecret").checked = false;
    $("entryUndecided").checked = false;
    $("entryVerbatim").checked = false;
    $("entryDeleteBtn").hidden = true;
    $("entryModal").hidden = false;
    $("entryTextInput").focus();
  }

  function closeEntryModal() {
    $("entryModal").hidden = true;
    state.editing = null;
  }

  function saveEntryModal() {
    var text = textControlValue();
    if (!text) { alert("条目内容不能为空"); return; }
    var patch = {
      text: text,
      section: $("entrySection").value,
      secret: $("entrySecret").checked,
      undecided: $("entryUndecided").checked,
      verbatim: $("entryVerbatim").checked,
    };
    if (state.editing) {
      Object.assign(state.editing, patch);
    } else {
      var e = Object.assign({ id: "e" + Date.now().toString(36), edges: [], source: "", layer: "floating" }, patch);
      state.entries.push(e);
    }
    state.dirty = true;
    closeEntryModal();
    renderEntryPane();
    renderHeader();
  }

  function deleteEditing() {
    if (!state.editing) return;
    if (!confirm("删除这条？")) return;
    state.entries = state.entries.filter(function (e) { return e.id !== state.editing.id; });
    state.dirty = true;
    closeEntryModal();
    renderEntryPane();
    renderHeader();
  }

  function saveEntries() {
    // 保存前按当前条目重算节级 flag，保持数据一致
    state.sections.forEach(function (s) {
      var f = sectionFlags(s.name);
      s.secret = f.secret;
      s.undecided = f.undecided;
      s.verbatim = f.verbatim;
    });
    return api("/api/atlas/entries/save", {
      method: "POST",
      body: JSON.stringify({ entries: state.entries, sections: state.sections }),
    }).then(function (d) {
      state.entries = d.entries || [];
      state.sections = d.sections || state.sections;
      state.proseStale = !!d.prose_stale;
      state.draftStatus = d.draft_status || state.draftStatus;
      state.dirty = false;
      renderAll();
    }).catch(function (err) { alert("保存失败：" + err.message); });
  }

  // ---------- 画像 facts ----------
  function openFactModal(idx) {
    var f = state.facts[idx];
    if (!f) return;
    var text = prompt("修改这条画像事实：", f.text);
    if (text === null) return;
    text = text.trim();
    if (!text) return;
    f.text = text;
    state.dirty = true;
    renderFacts();
  }

  function addFact() {
    var text = prompt("新画像事实（一句话）：");
    if (text === null) return;
    text = text.trim();
    if (!text) return;
    state.facts.push({ text: text, layer: "floating", added: "" });
    state.dirty = true;
    renderFacts();
  }

  function saveFacts() {
    return api("/api/atlas/facts/save", {
      method: "POST",
      body: JSON.stringify({ facts: state.facts }),
    }).then(function (d) {
      state.facts = d.facts || [];
      state.dirty = true;
      renderFacts();
    }).catch(function (err) { alert("保存失败：" + err.message); });
  }

  // ---------- 事件 ----------
  Array.prototype.forEach.call(document.querySelectorAll(".atlas-tab"), function (btn) {
    btn.addEventListener("click", function () {
      state.tab = btn.getAttribute("data-tab");
      Array.prototype.forEach.call(document.querySelectorAll(".atlas-tab"), function (b) {
        b.classList.toggle("active", b === btn);
      });
      $("pane-entries").hidden = state.tab !== "entries";
      $("pane-facts").hidden = state.tab !== "facts";
    });
  });

  $("backToSections").addEventListener("click", function () {
    state.currentSection = null;
    renderEntryPane();
  });

  $("importDraftBtn").addEventListener("click", function () {
    if (state.dirty && !confirm("有未保存的修改，导入前会先保存，继续？")) return;
    var p = state.dirty ? saveEntries() : Promise.resolve();
    p.then(function () {
      return api("/api/atlas/import_draft", { method: "POST", body: "{}" });
    }).then(function (d) {
      state.entries = d.entries || [];
      state.sections = d.sections || state.sections;
      state.dirty = false;
      state.draftStatus = d.draft_status || state.draftStatus;
      renderAll();
      alert("导入完成，新增 " + d.added + " 条草稿（未分组）。逐条改写并分层。");
    }).catch(function (err) { alert("导入失败：" + err.message); });
  });

  $("addEntryBtn").addEventListener("click", openEntryModalNew);
  $("addFactBtn").addEventListener("click", addFact);
  $("saveFactsBtn").addEventListener("click", saveFacts);
  $("saveEntriesBtn").addEventListener("click", function () { saveEntries(); });
  $("entryOkBtn").addEventListener("click", saveEntryModal);
  $("entryCancelBtn").addEventListener("click", closeEntryModal);
  $("entryDeleteBtn").addEventListener("click", deleteEditing);
  $("entryModal").addEventListener("click", function (ev) {
    if (ev.target === $("entryModal")) closeEntryModal();
  });

  window.addEventListener("beforeunload", function (ev) {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ""; }
  });

  loadState().catch(function (err) {
    $("sectionList").innerHTML = '<div class="atlas-empty">加载失败：' + escapeHtml(err.message) + "</div>";
  });
})();
