/* 对话标注收件箱（// 反馈）：列表 + 现场回放 + 状态流转。作者（LiZF）专属。 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var STATUS_LABEL = { pending: "待分析", adopted: "已采纳", ignored: "已忽略" };
  var VIBE_LABEL = { up: "好", down: "差" };
  var opened = {};   // 已拉取过详情的条目缓存

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok === false) { throw new Error(d && d.error || "请求失败"); }
        return d;
      });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clip(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function chip(cls, text) {
    return '<span class="anno-chip ' + cls + '">' + text + "</span>";
  }

  // ---------- 列表 ----------

  function renderList(items) {
    var box = $("annoList");
    var empty = $("annoEmpty");
    var stats = $("annoStats");
    var pending = items.filter(function (it) { return it.status === "pending"; }).length;
    if (stats) stats.textContent = "共 " + items.length + " 条 · 待分析 " + pending;
    if (!items.length) {
      box.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    box.innerHTML = items.map(function (it) {
      var meta = [
        "<span>" + escapeHtml(it.time || "") + "</span>",
        "<span>@" + escapeHtml(it.account || "") + "</span>",
        chip(it.vibe === "up" ? "up" : "down", VIBE_LABEL[it.vibe] || "差"),
        chip("st-" + (it.status || "pending"), STATUS_LABEL[it.status] || it.status),
      ].join(" ");
      var anchor = it.reply_preview
        ? '<div class="anno-anchor">锚定她的回复：' + escapeHtml(clip(it.reply_preview, 80)) + "</div>"
        : "";
      return '<li class="anno-item" data-id="' + escapeHtml(it.id) + '">' +
        '<button type="button" class="anno-row">' +
          '<div class="anno-meta">' + meta + "</div>" +
          '<div class="anno-text">' + escapeHtml(it.text || "（无描述）") + "</div>" +
          anchor +
        "</button>" +
        '<div class="anno-detail" hidden></div>' +
      "</li>";
    }).join("");
    box.querySelectorAll(".anno-item").forEach(function (li) {
      li.querySelector(".anno-row").onclick = function () { toggleDetail(li); };
    });
    // 待分析的自动展开最新一条，省一次点击
    if (items.length && items[0].status === "pending") {
      var first = box.querySelector('.anno-item[data-id="' + items[0].id + '"]');
      if (first) toggleDetail(first);
    }
  }

  function toggleDetail(li) {
    var detail = li.querySelector(".anno-detail");
    if (!detail) return;
    if (!detail.hidden) { detail.hidden = true; return; }
    detail.hidden = false;
    if (!detail.innerHTML) {
      detail.innerHTML = '<div class="anno-empty">加载中…</div>';
      loadDetail(li.getAttribute("data-id"), detail).catch(function (e) {
        detail.innerHTML = '<div class="anno-empty">' + escapeHtml(e.message) + "</div>";
      });
    }
  }

  // ---------- 详情回放 ----------

  function sysSegments(content) {
    // 按空行 + 【 切段：身份核 / 当前时间 / 人生档案 / 关系 / 开场 / 事实 / 题目 / 发送格式
    var parts = String(content || "").split(/\n\n(?=【)/);
    return parts.filter(function (p) { return p && p.trim(); }).map(function (p) {
      var m = p.match(/^【([^】\n]{1,24})】/);
      return { label: m ? "【" + m[1] + "】" : clip(p.trim().split(/\n/)[0], 16), body: p };
    });
  }

  function turnBubble(role, text, now) {
    var who = role === "user" ? "你" : role === "assistant" ? "她" : role;
    return '<div class="anno-turn' + (now ? " now" : "") + '"><span class="who">' +
      escapeHtml(who) + "：</span>" + escapeHtml(text) + "</div>";
  }

  function renderDetail(item, detail) {
    opened[item.id] = item;
    var turn = item.turn || {};
    var messages = Array.isArray(turn.messages) ? turn.messages : [];
    var sys = "";
    var history = [];
    var lastUser = "";
    messages.forEach(function (m, i) {
      var content = String((m && m.content) || "");
      if (!content) return;
      if (m.role === "system") {
        sysSegments(content).forEach(function (seg) {
          sys += '<details class="anno-sys-seg"><summary>' + escapeHtml(seg.label) +
            "</summary><pre>" + escapeHtml(seg.body) + "</pre></details>";
        });
      } else if (i === messages.length - 1 && m.role === "user") {
        // messages 的最后一条 = 本轮用户消息
        lastUser = content;
      } else {
        history.push({ role: m.role, content: content });
      }
    });

    var tools = Object.keys(STATUS_LABEL).map(function (st) {
      var on = (item.status || "pending") === st ? " on" : "";
      return '<button type="button" class="btn ghost st-btn' + on + '" data-st="' + st + '">' +
        STATUS_LABEL[st] + "</button>";
    }).join("");

    var metaBits = [];
    if (turn.time_label) metaBits.push(escapeHtml(turn.time_label));
    if (turn.stage) metaBits.push("层·" + escapeHtml(turn.stage));
    if (turn.mode && turn.mode !== "chat") metaBits.push("模式·" + escapeHtml(turn.mode));
    if (turn.model) metaBits.push(escapeHtml(turn.model));

    detail.innerHTML =
      '<div class="anno-detail-tools">' + tools + '<span class="hint">' + metaBits.join(" · ") + "</span></div>" +
      '<div class="anno-block"><div class="anno-block-head">本轮（触发这次标注的对话）</div>' +
        turnBubble("user", lastUser || "（无）", true) +
        turnBubble("assistant", turn.reply || "（无）", true) +
      "</div>" +
      '<div class="anno-block"><div class="anno-block-head">她当时看到的 system（点开看原文）</div>' +
        (sys || '<div class="anno-empty">（无）</div>') +
      "</div>" +
      '<div class="anno-block"><div class="anno-block-head">对话历史（本轮之前）</div>' +
        '<div class="anno-history">' +
        (history.length
          ? history.map(function (h) { return turnBubble(h.role, h.content); }).join("")
          : '<div class="anno-empty">（无）</div>') +
        "</div>" +
      "</div>";

    detail.querySelectorAll(".st-btn").forEach(function (btn) {
      btn.onclick = function () {
        setStatus(item.id, btn.getAttribute("data-st")).then(function (pub) {
          item.status = pub.status;
          renderDetail(item, detail);
          refreshRow(item);
        }).catch(function (e) {
          detail.insertAdjacentHTML("afterbegin",
            '<div class="anno-empty">' + escapeHtml(e.message) + "</div>");
        });
      };
    });
  }

  function refreshRow(item) {
    var li = document.querySelector('.anno-item[data-id="' + item.id + '"]');
    if (!li) return;
    var meta = li.querySelector(".anno-meta");
    if (!meta) return;
    var chips = meta.querySelectorAll(".anno-chip");
    if (chips && chips[1]) {
      chips[1].className = "anno-chip st-" + (item.status || "pending");
      chips[1].textContent = STATUS_LABEL[item.status] || item.status;
    }
  }

  function loadDetail(aid, detail) {
    var cached = opened[aid];
    if (cached) { renderDetail(cached, detail); return Promise.resolve(); }
    return api("/api/lykie/annotations/" + encodeURIComponent(aid)).then(function (d) {
      renderDetail(d.item, detail);
    });
  }

  function setStatus(aid, status) {
    return api("/api/lykie/annotations/" + encodeURIComponent(aid) + "/status", {
      method: "POST",
      body: JSON.stringify({ status: status }),
    }).then(function (d) { return d.item; });
  }

  // ---------- 启动 ----------

  api("/api/lykie/annotations")
    .then(function (d) { renderList(d.items || []); })
    .catch(function (e) {
      var box = $("annoList");
      if (box) box.innerHTML = "";
      var empty = $("annoEmpty");
      if (empty) {
        empty.hidden = false;
        empty.textContent = e.message || "加载失败";
      }
    });
})();
