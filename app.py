# -*- coding: utf-8 -*-
"""背题助手后端：多题库管理，间隔重复抽背，支持编辑题目、斩题、正确率统计。"""
from __future__ import annotations

import os
import re
import json
import time
import random
import tempfile
import threading
import webbrowser
from datetime import datetime, timedelta
from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for

from docx import Document

from lykie import accounts as lykie_accounts
from lykie import atlas as lykie_atlas
from lykie import author_log as lykie_author_log
from lykie import converse as lykie_converse
from lykie import extract as lykie_extract
from lykie import folders as lykie_folders
from lykie import import_dom as lykie_import_dom
from lykie import import_exemplar as lykie_import_ex
from lykie import import_noise as lykie_import_noise
from lykie import import_platform as lykie_import_platform
from lykie import import_rules as lykie_import_rules
from lykie import import_scan as lykie_import_scan
from lykie import llm as lykie_llm
from lykie import lookup as lykie_lookup
from lykie import memory as lykie_memory
from lykie import opening as lykie_opening
from lykie import mock as lykie_mock
from lykie import profile as lykie_profile
from lykie import settle as lykie_settle
from lykie import share as lykie_share
from lykie import releases as lykie_releases
from lykie import assets as lykie_assets
from lykie import short_answer as lykie_sa
from lykie import typo as lykie_typo
from story import load_story, list_stories

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 上传上限 50MB
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or lykie_accounts.ensure_secret_key()
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# 避免每请求刷新 session cookie，减少手机浏览器「页面壳与 Cookie 不一致」
app.config["SESSION_REFRESH_EACH_REQUEST"] = False
app.jinja_env.auto_reload = True


class _ForceNoStoreMiddleware:
    """在 session 写完响应头之后仍强制禁缓存（after_request 会被后续逻辑盖掉）。"""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO") or ""
        if path.startswith("/static/"):
            return self.wsgi_app(environ, start_response)

        def _start_response(status, headers, exc_info=None):
            out = []
            for k, v in headers:
                if k.lower() in ("cache-control", "pragma", "expires"):
                    continue
                out.append((k, v))
            out.append(("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"))
            out.append(("Pragma", "no-cache"))
            out.append(("Expires", "0"))
            return start_response(status, out, exc_info)

        return self.wsgi_app(environ, _start_response)


app.wsgi_app = _ForceNoStoreMiddleware(app.wsgi_app)

LETTERS = "ABCDEFGH"


# ==================== 解析器 ====================
# 成题规则在 lykie.import_rules；此处保留刷题侧规范化与 legacy 题号切刀入口。
OPTION_RE = lykie_import_rules.OPTION_INLINE_RE
ANSWER_RE = re.compile(r"^(?:参考答案|标准答案|正确答案|答案)[:：]\s*(.*)$")
NUM_RE = lykie_import_rules.NUM_RE
BULLET_RE = re.compile(r"[\u2022\u2023\u2043\u25cf\u25cb\u25e6\u25aa\u00b7\u2219\u2027]")

JUDGE_TRUE = lykie_import_rules.JUDGE_TRUE
JUDGE_FALSE = lykie_import_rules.JUDGE_FALSE


def is_judge_answer(ans):
    return lykie_import_rules.is_judge_answer(ans)


def parse_answer_rest(rest):
    return lykie_import_rules.parse_answer_rest(rest)


def normalize_choice_content(ans, options):
    return lykie_import_rules.normalize_choice_content(ans, options)


def normalize_choice_answer(ans, options):
    return lykie_import_rules.normalize_choice_answer(ans, options)


def choice_correct_contents(q):
    """返回本题正确选项内容列表（单选 1 个，多选多个）。"""
    opts = q.get("options") or []
    ans = str(q.get("answer") or "").strip()
    if not opts or not ans:
        return []
    compact = re.sub(r"[\s,，、/;；+＋]+", "", ans.upper())
    if re.fullmatch(r"[A-H]{2,8}", compact):
        out = []
        for c in sorted(set(compact)):
            idx = ord(c) - ord("A")
            if 0 <= idx < len(opts):
                out.append(opts[idx])
        return out
    one = normalize_choice_content(ans, opts)
    return [one] if one else []


def is_multi_choice(q):
    return len(choice_correct_contents(q)) > 1


def parse_lines(raw):
    """legacy：题号切块 → 规则成题（与样板路径共用 import_rules）。"""
    blocks = lykie_import_rules.split_numbered_blocks(raw)
    questions, _skipped = lykie_import_rules.shape_blocks(blocks, choice_only=False)
    return questions


def parse_docx(path):
    doc = Document(path)
    raw = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return parse_lines(lykie_import_noise.filter_noise_lines(raw))


def docx_to_text(path) -> str:
    doc = Document(path)
    return "\n".join(p.text.strip() for p in doc.paragraphs if p.text.strip())


def parse_text(text):
    # 从 Word 复制项目符号列表会带上 bullet 符号，还原成换行再切分
    text = BULLET_RE.sub("\n", text)
    raw = [line.strip() for line in text.splitlines() if line.strip()]
    return parse_lines(lykie_import_noise.filter_noise_lines(raw))


def _preview_questions_payload(questions, **extra):
    preview_data = []
    for q in questions:
        item = {
            "type": q["type"],
            "stem": q["stem"],
            "options": q.get("options", []),
            "answer": q["answer"],
            "analysis": q.get("analysis", ""),
        }
        if q.get("needs_answer_confirm"):
            item["needs_answer_confirm"] = True
            if q.get("answer_line_raw"):
                item["answer_line_raw"] = q.get("answer_line_raw")
        preview_data.append(item)
    out = {
        "ok": True,
        "preview": True,
        "total": len(questions),
        "questions": preview_data,
    }
    out.update(extra)
    return out


def _apply_answer_picks(questions, answer_picks):
    """按预览下标写入用户点选的答案。返回仍待确认的题号（1-based）列表。"""
    picks = answer_picks if isinstance(answer_picks, dict) else {}
    pending = []
    for i, q in enumerate(questions):
        pick = picks.get(str(i))
        if pick is None:
            pick = picks.get(i)
        if pick is not None and str(pick).strip():
            raw = str(pick).strip()
            if q.get("type") == "choice" and q.get("options"):
                q["answer"] = normalize_choice_answer(raw, q.get("options") or [])
            else:
                q["answer"] = raw
            q.pop("needs_answer_confirm", None)
            q.pop("answer_line_raw", None)
        needs = bool(q.get("needs_answer_confirm")) or not str(q.get("answer") or "").strip()
        if needs:
            pending.append(i + 1)
        else:
            q.pop("needs_answer_confirm", None)
            q.pop("answer_line_raw", None)
    return pending


def _resolve_import_questions(text: str, exemplar: str = "", exemplars: dict | None = None):
    """有样板则按样板切；无样板走旧规则。返回 (questions|None, error, meta)。"""
    ex_map = {}
    if isinstance(exemplars, dict):
        for k in ("choice", "judge", "fill", "short_answer"):
            v = str(exemplars.get(k) or "").strip()
            if v:
                ex_map[k] = v
    single = (exemplar or "").strip()
    if single and "choice" not in ex_map:
        ex_map["choice"] = single

    if ex_map:
        return lykie_import_ex.parse_by_exemplars(text, ex_map)

    try:
        qs = parse_text(text)
    except Exception as e:
        return None, f"解析失败：{e}", {}
    if not qs:
        return None, "没有解析出题目，请检查文本格式", {}
    needs = sum(1 for q in qs if q.get("needs_answer_confirm"))
    detected = lykie_import_scan.scan_text(text)
    return qs, "", {
        "mode": "legacy",
        "needs_answer_confirm": needs,
        "detected_types": detected,
        "covered_types": [],
        "uncovered_types": lykie_import_scan.uncovered_kinds(detected, set()),
    }


def _resolve_dom_questions(questions: list[dict]):
    """DOM 通道题目对齐样板下游：客观题补默认字段，简答拆到 meta.sa_questions。

    返回 (objective_questions, meta)；meta 结构与 _resolve_import_questions
    产物对齐（detected_types / covered_types / sa_questions…），全部题型
    均已解析，故 uncovered_types 恒空。
    """
    obj: list[dict] = []
    sa: list[dict] = []
    for q in questions:
        (sa if q.get("type") == "short_answer" else obj).append(q)
    obj = [
        lykie_import_rules.attach_question_defaults(dict(q), i + 1)
        for i, q in enumerate(obj)
    ]
    sa_out = [
        lykie_import_rules.attach_question_defaults(dict(q), i + 1)
        for i, q in enumerate(sa)
    ]
    counts: dict[str, int] = {}
    for q in questions:
        k = str(q.get("type") or "")
        counts[k] = counts.get(k, 0) + 1
    detected = [
        {"kind": k, "label": lykie_import_scan.KIND_LABELS.get(k, k), "count": v}
        for k, v in counts.items()
    ]
    meta = {
        "detected_types": detected,
        "covered_types": sorted(counts.keys()),
        "uncovered_types": [],
        "skipped_blocks": 0,
        "needs_answer_confirm": 0,
        "mode": "dom",
        "pipeline": "xuexitong-html",
        "sa_questions": sa_out,
        "sa_total": len(sa_out),
    }
    return obj, meta


def _gate_uncovered_types(meta: dict, ack_skipped, import_sa: bool) -> str:
    """未覆盖题型未确认时返回错误文案，否则空串。"""
    uncovered = list(meta.get("uncovered_types") or [])
    if not uncovered:
        return ""
    ack = set()
    if isinstance(ack_skipped, (list, tuple, set)):
        ack = {str(x) for x in ack_skipped}
    elif isinstance(ack_skipped, str) and ack_skipped.strip():
        ack = {x.strip() for x in ack_skipped.split(",") if x.strip()}

    # 简答：勾选同时导入且已切出或已提供样板覆盖，则不算未确认
    if "short_answer" in uncovered and import_sa:
        if int(meta.get("sa_total") or 0) > 0 or "short_answer" in (meta.get("covered_types") or []):
            uncovered = [k for k in uncovered if k != "short_answer"]

    still = [k for k in uncovered if k not in ack]
    if not still:
        return ""
    labels = {
        "judge": "判断题",
        "fill": "填空题",
        "short_answer": "简答题",
    }
    names = "、".join(labels.get(k, k) for k in still)
    return (
        f"原文检测到{names}，但未提供对应样板且未确认跳过。"
        f"请补样板，或勾选「已知晓，本次不导入这些题」，"
        f"简答可勾选「同时另建简答库」。"
    )



# ==================== 持久化 ====================
def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def new_bank_id():
    return str(int(time.time() * 1000))


def ensure_question_defaults(q):
    q.setdefault("status", "active")
    q.setdefault("phase", "new")
    q.setdefault("interval", 0)
    q.setdefault("countdown", 0)
    q.setdefault("streak", 0)
    q.setdefault("answer_count", 0)
    q.setdefault("correct_count", 0)
    q.setdefault("analysis", "")


class UserData:
    """当前登录用户的题库 + Lykie 记忆路径。"""

    def __init__(self, username):
        self.username = username
        self.bank_path = lykie_accounts.bank_path(username)
        self.lykie_path = lykie_accounts.lykie_path(username)
        self.banks = []
        self.current_bank_id = None
        self.collections = []
        self.wrong_sets = []
        self.folders = []
        self.active_mock = None
        self.active_wrong = None
        self.last_mock_settle = None
        self._load_banks()

    def _load_banks(self):
        os.makedirs(os.path.dirname(self.bank_path), exist_ok=True)
        if not os.path.exists(self.bank_path):
            lykie_accounts.ensure_user_files(self.username)
        try:
            with open(self.bank_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = {"banks": [], "current_bank_id": None}
        if "banks" not in data:
            qs = data.get("questions", [])
            if qs:
                b = {
                    "id": new_bank_id(),
                    "name": "旧题库",
                    "imported_at": now_str(),
                    "questions": qs,
                }
                self.banks = [b]
                self.current_bank_id = b["id"]
        else:
            self.banks = data.get("banks") or []
            self.current_bank_id = data.get("current_bank_id")
        self.collections = data.get("collections") or []
        self.wrong_sets = data.get("wrong_sets") or []
        self.folders = data.get("folders") or []
        self.active_mock = data.get("active_mock")
        self.active_wrong = data.get("active_wrong")
        self.last_mock_settle = data.get("last_mock_settle")
        lykie_mock.ensure_extras(self)
        lykie_folders.ensure_folders(self)
        runs_touched = False
        for b in self.banks:
            for q in b.get("questions", []):
                ensure_question_defaults(q)
            if not lykie_sa.is_sa_bank(b):
                before = b.get("runs")
                lykie_settle.ensure_bank_runs(b)
                if before is None or before == []:
                    runs_touched = True
        if lykie_sa.ensure_bank_modes(self.banks):
            runs_touched = True
        if runs_touched:
            try:
                self.save()
            except OSError:
                pass
        if self.current_bank_id is None and self.banks:
            self.current_bank_id = self.banks[0]["id"]

    def save(self):
        os.makedirs(os.path.dirname(self.bank_path), exist_ok=True)
        with open(self.bank_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "banks": self.banks,
                    "current_bank_id": self.current_bank_id,
                    "collections": getattr(self, "collections", []) or [],
                    "wrong_sets": getattr(self, "wrong_sets", []) or [],
                    "folders": getattr(self, "folders", []) or [],
                    "active_mock": getattr(self, "active_mock", None),
                    "active_wrong": getattr(self, "active_wrong", None),
                    "last_mock_settle": getattr(self, "last_mock_settle", None),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

    def current_bank(self):
        return next((b for b in self.banks if b["id"] == self.current_bank_id), None)


def current_user():
    return session.get("username") or ""


def jsonify_user(payload):
    """JSON 响应附带当前用户名，供前端发现页面壳与会话不一致。"""
    data = dict(payload or {})
    data["username"] = g.store.username if getattr(g, "store", None) else current_user()
    return jsonify(data)


# ==================== 登录 ====================
@app.before_request
def require_login():
    if request.endpoint in ("login", "logout", "static"):
        return None
    username = current_user()
    if username and lykie_accounts.user_exists(username):
        g.store = UserData(username)
        return None
    session.pop("username", None)
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "未登录", "need_login": True}), 401
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user() and lykie_accounts.user_exists(current_user()):
        return redirect(url_for("index") + f"?_={int(time.time())}")
    error = ""
    if request.method == "POST":
        username = request.form.get("username") or ""
        password = request.form.get("password") or ""
        if lykie_accounts.verify_user(username, password):
            session.clear()
            session.permanent = True
            session["username"] = lykie_accounts.normalize_username(username)
            # 带时间戳，逼手机浏览器丢掉上一账号缓存的 HTML 壳
            return redirect(url_for("index") + f"?_={int(time.time())}")
        if not lykie_accounts.has_users():
            error = "还没有账号。先在电脑运行：python add_user.py 用户名"
        else:
            error = "用户名或密码不对"
    return render_template("login.html", error=error, has_users=lykie_accounts.has_users())


@app.route("/logout")
def logout():
    session.clear()
    resp = redirect(url_for("login") + f"?_={int(time.time())}")
    resp.headers["Clear-Site-Data"] = '"cache"'
    return resp


@app.route("/assets")
def assets_page():
    return render_template("assets.html", username=g.store.username)


@app.route("/api/assets/vocab", methods=["GET"])
def api_assets_vocab_list():
    q = request.args.get("q") or ""
    limit = request.args.get("limit") or 50
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 50
    items = lykie_assets.list_vocab(g.store.username, q=q, limit=lim)
    return jsonify_user({
        "ok": True,
        "items": items,
        "pos_options": list(lykie_assets.POS_OPTIONS),
    })


@app.route("/api/assets/vocab", methods=["POST"])
def api_assets_vocab_save():
    data = request.get_json(force=True) or {}
    entry, err, created = lykie_assets.record_vocab(
        g.store.username,
        word=data.get("word") or "",
        pos=data.get("pos") or "other",
        meaning=data.get("meaning") or "",
        examples=data.get("examples"),
        related=data.get("related"),
        senses=data.get("senses"),
        link_from=data.get("link_from"),
        link_example=data.get("link_example"),
        source=data.get("source"),
        phrases=data.get("phrases"),
    )
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify_user({
        "ok": True,
        "entry": entry,
        "created": created,
    })


@app.route("/api/assets/vocab/<entry_id>", methods=["GET"])
def api_assets_vocab_get(entry_id):
    entry = lykie_assets.get_vocab(g.store.username, entry_id)
    if not entry:
        return jsonify({"ok": False, "error": "未找到"}), 404
    return jsonify_user({"ok": True, "entry": entry})


@app.route("/api/assets/vocab/<entry_id>/delete", methods=["POST"])
def api_assets_vocab_delete(entry_id):
    ok = lykie_assets.delete_vocab(g.store.username, entry_id)
    if not ok:
        return jsonify({"ok": False, "error": "未找到"}), 404
    return jsonify_user({"ok": True})


def find_question(bank, qid):
    return next((q for q in bank["questions"] if q["id"] == qid), None)


def render_question(q, bank=None):
    """返回给前端的题目，选择题按 phase 决定是否打乱选项。"""
    out = {
        "id": q["id"], "type": q["type"], "stem": q["stem"],
        "answer_count": q.get("answer_count", 0),
        "correct_count": q.get("correct_count", 0),
        "analysis": q.get("analysis", ""),
    }
    if q["type"] == "choice":
        contents = q["options"]
        if not contents:
            out["options"] = []
            out["answer"] = ""
            out["answer_text"] = q.get("answer", "")
            out["multi"] = False
        else:
            correct_set = set(choice_correct_contents(q))
            multi = len(correct_set) > 1
            if q.get("phase") == "right":
                order = random.sample(contents, len(contents))  # 答对队列：打乱
            else:
                order = contents[:]                              # 新题 / 答错队列：原顺序
            out["options"] = [f"{LETTERS[i]}.{order[i]}" for i in range(len(order))]
            ans_letters = "".join(
                LETTERS[i] for i, c in enumerate(order) if c in correct_set
            )
            # 单选且旧数据用内容匹配失败时，兜底第一项
            if not ans_letters and not multi:
                idx = order.index(q["answer"]) if q["answer"] in order else 0
                ans_letters = LETTERS[idx]
                correct_set = {order[idx]}
            out["answer"] = ans_letters
            out["answer_text"] = "、".join(
                f"{LETTERS[i]}.{order[i]}" for i, c in enumerate(order) if c in correct_set
            ) or out["answer"]
            out["multi"] = multi
    elif q["type"] == "judge":
        out["options"] = ["对", "错"]
        out["answer"] = q["answer"]
        out["answer_text"] = q["answer"]
        out["multi"] = False
    else:  # fill
        out["options"] = []
        out["answer"] = q["answer"]
        out["answer_text"] = q["answer"]
        out["multi"] = False
    if bank is not None and q.get("type") != "short_answer":
        lykie_settle.attach_question_kill_info(bank, q, out)
    return out


# ==================== 路由 ====================
@app.route("/")
def index():
    return render_template("index.html", username=g.store.username)


@app.route("/import")
def import_page():
    return render_template("import.html", username=g.store.username)


@app.route("/sa")
def sa_page():
    """简答入口已并入主界面侧栏题库；旧链接重定向。"""
    bank = lykie_sa.find_short_bank(g.store)
    if bank and g.store.current_bank_id != bank["id"]:
        g.store.current_bank_id = bank["id"]
        g.store.save()
    return redirect(url_for("index"))


def _sa_questions():
    """使用当前简答库；若当前是客观库则回退到已标记的简答库。"""
    cur = g.store.current_bank()
    bank = cur if lykie_sa.is_sa_bank(cur) else lykie_sa.find_short_bank(g.store)
    if not bank:
        return None, []
    qs = [q for q in bank.get("questions") or [] if q.get("type") == "short_answer"]

    def sort_key(q):
        raw = str(q.get("num") or q.get("id") or "0")
        return int(raw) if raw.isdigit() else raw

    qs = sorted(qs, key=sort_key)
    return bank, qs


def _sa_build_card(q, item, qs=None):
    stage = item.get("stage") or "warmup"
    kws = lykie_sa.keywords_of(q)
    lane = "review" if lykie_sa.is_review_stage(stage) else (
        "review" if stage == "done" else "learning"
    )
    base = {
        "ok": True,
        "qid": str(q.get("id")),
        "stage": stage,
        "lane": lane,
        "stem": q.get("stem") or "",
        "keywords": kws,
        "keywords_count": len(kws),
        "points": lykie_sa.points_editor_payload(q),
        "cloze_unordered": lykie_sa.cloze_is_unordered(q),
        "srs_level": int(item.get("srs_level") or 0),
        "due_date": item.get("due_date"),
    }
    if stage == "done":
        base["kind"] = "done"
        base["message"] = "本题在复习池中（未到期）。"
        base["answer"] = q.get("answer") or ""
        return base
    if stage == "warmup":
        card = lykie_sa.build_warmup_card(q, item)
        if card is None:
            item["stage"] = "cloze"
            return _sa_build_card(q, item, qs)
        item["pending_warmup"] = {
            "correct_ids": card.pop("_correct_ids"),
            "chosen_point_indices": card.pop("_chosen_point_indices"),
        }
        base.update(card)
        return base
    if stage in ("cloze", "review_cloze"):
        if lykie_sa.uses_match_cloze(q):
            card = lykie_sa.build_match_card(q)
            item["pending_match"] = {"answer_map": card.pop("_answer_map")}
            item.pop("pending_cloze", None)
            base.update(card)
            if stage == "review_cloze":
                base["prompt"] = "复习·连线：" + (base.get("prompt") or "")
                base["review"] = True
            return base
        cloze = lykie_sa.build_cloze(q)
        item["pending_cloze"] = {
            "answers": cloze["answers"],
            "unordered_groups": cloze.get("unordered_groups") or [],
        }
        item.pop("pending_match", None)
        prompt = "填入挖去的关键词（须一次性全部填对；填不全会给提示并换题，下次继续挖空）"
        if cloze.get("unordered_groups"):
            prompt += "；并列要点可打乱顺序填写"
        if stage == "review_cloze":
            prompt = "复习·挖空：" + prompt
        base.update({
            "kind": "cloze",
            "prompt": prompt,
            "parts": cloze["parts"],
            "blank_count": len(cloze["answers"]),
            "unordered_groups": cloze.get("unordered_groups") or [],
            "review": stage == "review_cloze",
        })
        return base
    if stage == "half_cloze":
        half = lykie_sa.build_half_cloze_card(q, blank_side="left")
        item["pending_cloze"] = {
            "answers": half["answers"],
            "unordered_groups": [],
        }
        base.update({
            "kind": "half_cloze",
            "prompt": half["prompt"],
            "parts": half["parts"],
            "blank_count": half["blank_count"],
        })
        return base
    if stage == "stem_pick":
        card = lykie_sa.build_stem_pick_card(q, qs or [])
        item["pending_stem"] = {"correct_id": card.pop("_correct_id")}
        base.update(card)
        base["stem"] = card.get("stem_label") or "选出对应题干"
        return base
    # free_write / review_free
    is_review = stage == "review_free"
    base.update({
        "kind": "free_write",
        "review": is_review,
        "prompt": (
            "复习·无提示默写：写出本题要点。过关进入下次间隔；吃力可降级到挖空复习。"
            if is_review
            else "不看提示，写出本题要点。系统按关键词命中给出参考；是否进入下一阶段由你决定。"
        ),
        "reference_answer": q.get("answer") or "",
        "min_hits": min(3, len(lykie_sa.keywords_of(q))),
    })
    return base


@app.route("/api/sa/status")
def api_sa_status():
    bank, qs = _sa_questions()
    if not bank:
        return jsonify({"ok": False, "error": f"未找到题库「{lykie_sa.BANK_NAME}」，请先导入短题子集"})
    progress = lykie_sa.load_progress(g.store.username)
    counts = lykie_sa.count_progress(progress, qs)
    lykie_sa.save_progress(g.store.username, progress)
    pair = progress.get("active_pair") or []
    return jsonify_user({
        "ok": True,
        "bank_name": bank.get("name"),
        "total": len(qs),
        "stages": counts["stages"],
        "learning": counts["learning"],
        "review_due": counts["review_due"],
        "review_waiting": counts["review_waiting"],
        "review_active": counts["review_active"],
        "review_quota": int(progress.get("review_quota") or 0),
        "need_learn_gate": bool(progress.get("need_learn_gate")),
        "active_pair": pair,
        "cursor": progress.get("cursor", 0),
        "today": lykie_sa.today_str(),
    })


@app.route("/api/sa/next")
def api_sa_next():
    bank, qs = _sa_questions()
    if not bank or not qs:
        return jsonify({"ok": False, "empty": True, "error": f"未找到题库「{lykie_sa.BANK_NAME}」"})
    progress = lykie_sa.load_progress(g.store.username)
    for q in qs:
        lykie_sa.ensure_item(progress, str(q.get("id")), q)
    chosen = lykie_sa.select_next_question(progress, qs)
    if chosen is None:
        counts = lykie_sa.count_progress(progress, qs)
        lykie_sa.save_progress(g.store.username, progress)
        waiting = counts["review_waiting"]
        hint = (
            f"今日学习与到期复习都完成了。还有 {waiting} 题在间隔中，改天再来。"
            if waiting
            else "短题都练完了，且暂无等待复习的题。可重置进度再来一轮。"
        )
        return jsonify_user({
            "ok": True,
            "all_done": True,
            "total": len(qs),
            "review_waiting": waiting,
            "message": hint,
        })
    item = lykie_sa.ensure_item(progress, str(chosen.get("id")), chosen)
    card = _sa_build_card(chosen, item, qs)
    pair = progress.get("active_pair") or []
    card["pair"] = pair
    if card.get("review") or lykie_sa.is_review_stage(item.get("stage") or ""):
        card["pair_label"] = "复习车道（单题轻测）"
    else:
        card["pair_label"] = "当前组：" + " / ".join(pair) if pair else ""
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify_user(card)


@app.route("/api/sa/warmup_answer", methods=["POST"])
def api_sa_warmup_answer():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    selected = [str(x) for x in (data.get("selected") or [])]
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    pending = item.get("pending_warmup") or {}
    correct = set(pending.get("correct_ids") or [])
    chosen_idx = pending.get("chosen_point_indices") or pending.get("chosen_kw_indices") or []
    sel = set(selected)
    ok = sel == correct and len(correct) > 0
    if ok:
        lykie_sa.advance_after_warmup(item, chosen_idx, lykie_sa.points_of(q))
        item.pop("pending_warmup", None)
        lykie_sa.save_progress(g.store.username, progress)
        return jsonify({
            "ok": True,
            "correct": True,
            "stage": item.get("stage"),
            "message": "全部选对。" + ("已进入挖空阶段。" if item.get("stage") == "cloze" else "本轮热身完成。"),
        })
    missing = len(correct - sel)
    extra = len(sel - correct)
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify({
        "ok": True,
        "correct": False,
        "stage": item.get("stage"),
        "message": f"还没勾全正确项（漏 {missing}，多选 {extra}）。再试一次。",
    })


@app.route("/api/sa/match_answer", methods=["POST"])
def api_sa_match_answer():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    links = data.get("links") or []
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    if not lykie_sa.uses_match_cloze(q):
        return jsonify({"ok": False, "error": "本题不是连线题"}), 400
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    answer_map = (item.get("pending_match") or {}).get("answer_map") or {}
    graded = lykie_sa.grade_match(answer_map, links)
    cur_stage = item.get("stage") or "cloze"
    if graded["all_ok"]:
        if cur_stage == "review_cloze":
            lykie_sa.schedule_after_review_cloze_pass(item)
            lykie_sa.save_progress(g.store.username, progress)
            return jsonify({
                "ok": True,
                "correct": True,
                "stage": "done",
                "details": graded["details"],
                "message": f"复习连线过关。明天再轻测（间隔 1 天）。",
            })
        next_stage = "half_cloze" if lykie_sa.uses_half_cloze(q) else "stem_pick"
        item["stage"] = next_stage
        item.pop("pending_match", None)
        lykie_sa.save_progress(g.store.username, progress)
        return jsonify({
            "ok": True,
            "correct": True,
            "stage": next_stage,
            "details": graded["details"],
            "message": (
                "连线全部正确，进入「半边挖空」。"
                if next_stage == "half_cloze"
                else "连线全部正确，进入「答案选题干」。"
            ),
        })
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify({
        "ok": True,
        "correct": False,
        "stage": cur_stage,
        "details": graded["details"],
        "hint_pairs": graded["hint_pairs"],
        "go_next": True,
        "can_demote_learning": cur_stage == "review_cloze",
        "message": f"未一次全对（{graded['ok_count']}/{graded['need']}）。下方已给出正确搭配，可先看一遍再点「下一题」。本题下次仍练连线。",
    })


@app.route("/api/sa/question_detail")
def api_sa_question_detail():
    """编辑关键词用：拉完整分点与挖空设置。"""
    qid = str(request.args.get("qid") or "")
    bank, qs = _sa_questions()
    if not bank:
        return jsonify({"ok": False, "error": f"未找到题库「{lykie_sa.BANK_NAME}」"}), 404
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    return jsonify({
        "ok": True,
        "qid": qid,
        "stem": q.get("stem") or "",
        "answer": q.get("answer") or "",
        "keywords": lykie_sa.keywords_of(q),
        "points": lykie_sa.points_editor_payload(q),
        "cloze_unordered": lykie_sa.cloze_is_unordered(q),
    })


@app.route("/api/sa/cloze_answer", methods=["POST"])
def api_sa_cloze_answer():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    blanks = [str(x).strip() for x in (data.get("blanks") or [])]
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    # 始终按当前题配置重建标准答案/是否无序，避免旧 pending 残留「整组无序」
    if (item.get("stage") or "") == "half_cloze":
        live = lykie_sa.build_half_cloze_card(q, blank_side="left")
        answers = live.get("answers") or []
        unordered_groups = []
    else:
        live = lykie_sa.build_cloze(q)
        answers = live.get("answers") or []
        unordered_groups = live.get("unordered_groups") or []
    item["pending_cloze"] = {
        "answers": answers,
        "unordered_groups": unordered_groups,
    }
    if len(blanks) != len(answers):
        lykie_sa.save_progress(g.store.username, progress)
        return jsonify({"ok": False, "error": f"需要填 {len(answers)} 个空"}), 400
    graded = lykie_sa.grade_cloze(answers, blanks, unordered_groups)
    details = graded["details"]
    all_ok = graded["all_ok"]
    cur_stage = item.get("stage") or "cloze"
    if all_ok:
        if cur_stage == "review_cloze":
            lykie_sa.schedule_after_review_cloze_pass(item)
            lykie_sa.save_progress(g.store.username, progress)
            return jsonify({
                "ok": True,
                "correct": True,
                "stage": "done",
                "details": details,
                "message": "复习挖空过关。明天再轻测（间隔 1 天）。",
            })
        item["stage"] = "stem_pick"
        item.pop("pending_cloze", None)
        lykie_sa.save_progress(g.store.username, progress)
        msg = (
            "半边挖空一次全对，进入「答案选题干」。"
            if cur_stage == "half_cloze"
            else "一次性全部填对，进入「答案选题干」。"
        )
        return jsonify({
            "ok": True,
            "correct": True,
            "stage": "stem_pick",
            "details": details,
            "message": msg,
        })
    hints = graded.get("hints") or list(answers)
    lykie_sa.save_progress(g.store.username, progress)
    has_unordered = bool(unordered_groups)
    if cur_stage == "half_cloze":
        fail_msg = (
            "半边未一次填全。已把剩余答案放进提示，照着写一遍后点「下一题」；与组内其他题交替，下次仍练半边挖空。"
        )
    elif cur_stage == "review_cloze":
        fail_msg = (
            "复习挖空未一次填全。可先照提示写一遍再「下一题」；仍吃力可「退回学习重练」。"
        )
    elif has_unordered:
        fail_msg = (
            "未一次填全。已把剩余正确答案放进提示（并列空不要求顺序），可先照着写一遍，再点「下一题」。本题下次仍会挖空，直到一次性全对。"
        )
    else:
        fail_msg = (
            "未一次填全。每空须与左侧固定文字对应；已把正确答案放进对应空的提示，照着写后点「下一题」。本题下次仍会挖空。"
        )
    return jsonify({
        "ok": True,
        "correct": False,
        "stage": cur_stage,
        "details": details,
        "hints": hints,
        "go_next": True,
        "unordered": has_unordered,
        "can_demote_learning": cur_stage == "review_cloze",
        "message": fail_msg,
    })


@app.route("/api/sa/stem_answer", methods=["POST"])
def api_sa_stem_answer():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    selected = str(data.get("selected") or "")
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    correct_id = str((item.get("pending_stem") or {}).get("correct_id") or "")
    ok = selected == correct_id and bool(correct_id)
    if ok:
        item["stage"] = "free_write"
        item.pop("pending_stem", None)
        lykie_sa.save_progress(g.store.username, progress)
        return jsonify({
            "ok": True,
            "correct": True,
            "stage": "free_write",
            "message": "题干匹配正确，进入无提示默写。",
            "correct_stem": q.get("stem") or "",
        })
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify({
        "ok": True,
        "correct": False,
        "stage": "stem_pick",
        "go_next": True,
        "message": "题干选错了。正确答案已标出，看一眼后点「下一题」；本题下次仍练选题干。",
        "correct_stem": q.get("stem") or "",
        "correct_id": correct_id,
    })


@app.route("/api/sa/free_answer", methods=["POST"])
def api_sa_free_answer():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    text = str(data.get("text") or "")
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    kws = lykie_sa.keywords_of(q)
    hits = lykie_sa.hit_keywords(text, kws)
    missed = [k for k in kws if k not in hits]
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    item["free_last_hits"] = len(hits)
    lykie_sa.save_progress(g.store.username, progress)
    min_hits = min(3, len(kws))
    return jsonify({
        "ok": True,
        "hit_count": len(hits),
        "min_hits": min_hits,
        "hits": hits,
        "missed": missed,
        "can_finish": len(hits) >= min_hits,
        "reference_answer": q.get("answer") or "",
        "message": f"关键词命中 {len(hits)}/{len(kws)}。" + (
            f"已达完成门槛（≥{min_hits}），可选择再练或完成本题。"
            if len(hits) >= min_hits
            else f"未满 {min_hits} 个，建议对照答案再写一版。"
        ),
    })


@app.route("/api/sa/free_advance", methods=["POST"])
def api_sa_free_advance():
    data = request.json or {}
    qid = str(data.get("qid") or "")
    action = str(data.get("action") or "")
    _bank, qs = _sa_questions()
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    stage = item.get("stage") or "free_write"
    min_hits = min(3, len(lykie_sa.keywords_of(q)))

    if action == "next":
        if int(item.get("free_last_hits") or 0) < min_hits:
            return jsonify({"ok": False, "error": f"至少命中 {min_hits} 个关键词才能过关"}), 400
        if stage == "review_free":
            lykie_sa.schedule_after_review_pass(item)
            days = lykie_sa.REVIEW_INTERVALS_DAYS[int(item.get("srs_level") or 0)]
            msg = f"复习过关。下次约 {days} 天后到期（{item.get('due_date')}）。"
        else:
            lykie_sa.schedule_after_learning_done(item)
            msg = f"本题已完成，进入复习池。明天起可轻测（{item.get('due_date')}）。"
    elif action == "repeat":
        msg = "继续无提示默写本阶段。"
    elif action == "demote_cloze":
        if stage == "review_free":
            lykie_sa.demote_review_to_cloze(item)
            msg = "已降级到挖空复习。"
        elif stage == "free_write":
            item["stage"] = "cloze"
            item["lane"] = "learning"
            item.pop("pending_cloze", None)
            msg = "返回挖空阶段。"
        else:
            return jsonify({"ok": False, "error": "当前阶段不能降级到挖空"}), 400
    elif action == "demote_learning":
        lykie_sa.demote_review_to_learning(item)
        msg = "已退回学习车道（特色挖空），将重新走强化。"
    else:
        return jsonify({
            "ok": False,
            "error": "action 应为 next / repeat / demote_cloze / demote_learning",
        }), 400
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify({"ok": True, "stage": item.get("stage"), "message": msg, "due_date": item.get("due_date")})


@app.route("/api/sa/update_keywords", methods=["POST"])
def api_sa_update_keywords():
    """简答训练页：按分点改关键词（写入短题库）。"""
    data = request.get_json(force=True) or {}
    qid = str(data.get("qid") or "")
    bank, qs = _sa_questions()
    if not bank:
        return jsonify({"ok": False, "error": f"未找到题库「{lykie_sa.BANK_NAME}」"}), 404
    q = next((x for x in qs if str(x.get("id")) == qid), None)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404

    point_rows = data.get("points")
    if isinstance(point_rows, list) and point_rows:
        unordered = data.get("cloze_unordered")
        if unordered is None:
            unordered = None
        else:
            unordered = bool(unordered)
        lykie_sa.apply_point_keywords(q, point_rows, cloze_unordered=unordered)
    else:
        # 兼容旧：整表 keywords 字符串/列表
        raw = data.get("keywords")
        if isinstance(raw, str):
            kws = lykie_sa.parse_keywords_input(raw)
        elif isinstance(raw, list):
            kws = [str(x).strip() for x in raw if str(x).strip()]
        else:
            return jsonify({"ok": False, "error": "请提供分点关键词"}), 400
        if not kws:
            return jsonify({"ok": False, "error": "关键词不能为空"}), 400
        lykie_sa.apply_keywords_to_question(q, kws)
        if "cloze_unordered" in data:
            q["cloze_unordered"] = bool(data.get("cloze_unordered"))

    progress = lykie_sa.load_progress(g.store.username)
    item = lykie_sa.ensure_item(progress, qid, q)
    for key in ("pending_warmup", "pending_cloze", "pending_match", "pending_stem"):
        item.pop(key, None)
    lykie_sa.save_progress(g.store.username, progress)
    g.store.save()
    return jsonify({
        "ok": True,
        "qid": qid,
        "keywords": lykie_sa.keywords_of(q),
        "points": lykie_sa.points_editor_payload(q),
        "cloze_unordered": lykie_sa.cloze_is_unordered(q),
    })


@app.route("/api/sa/reset", methods=["POST"])
def api_sa_reset():
    progress = {
        "cursor": 0,
        "items": {},
        "active_pair": [],
        "pair_turn": 0,
        "updated_at": lykie_sa.now_str(),
    }
    lykie_sa.save_progress(g.store.username, progress)
    return jsonify({"ok": True})


@app.route("/api/banks")
def api_banks():
    lykie_folders.ensure_folders(g.store)
    result = []
    for b in g.store.banks:
        qs = b["questions"]
        is_sa = lykie_sa.is_sa_bank(b)
        result.append({
            "id": b["id"],
            "name": b.get("name", "未命名题库"),
            "imported_at": b.get("imported_at", ""),
            "total": len(qs),
            "killed": sum(1 for q in qs if q.get("status") == "killed"),
            "is_sa": is_sa,
            "mode": b.get("mode") or ("short_answer" if is_sa else "objective"),
            "folder_id": b.get("folder_id") or None,
            "shared_from": b.get("shared_from") or None,
        })
    return jsonify_user({
        "banks": result,
        "current_bank_id": g.store.current_bank_id,
        "folders": lykie_folders.list_folders(g.store),
        "collections": lykie_mock.list_collections(g.store),
        "wrong_sets": lykie_mock.list_wrong_sets(g.store),
        "notifications_unread": _notifications_unread(g.store.username),
    })


def _notifications_unread(username: str) -> int:
    lykie_releases.ensure_release_notification(username)
    return lykie_share.unread_count(username)


@app.route("/api/share/targets")
def api_share_targets():
    return jsonify_user({
        "ok": True,
        "users": lykie_share.list_share_targets(g.store.username),
    })


@app.route("/api/banks/share", methods=["POST"])
def api_banks_share():
    data = request.get_json(force=True) or {}
    bank_id = str(data.get("bank_id") or "")
    to_users = data.get("to_users") or data.get("users") or []
    if isinstance(to_users, str):
        to_users = [to_users]
    bank = next((b for b in g.store.banks if str(b.get("id")) == bank_id), None)
    if not bank:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    result, err = lykie_share.share_bank_to_users(g.store.username, bank, list(to_users))
    if err and not (result and result.get("ok")):
        return jsonify({"ok": False, "error": err, "result": result}), 400
    return jsonify_user({
        "ok": True,
        "shared": (result or {}).get("ok") or [],
        "failed": (result or {}).get("failed") or [],
    })


@app.route("/api/notifications")
def api_notifications():
    lykie_releases.ensure_release_notification(g.store.username)
    notes = lykie_share.list_notifications(g.store.username)
    return jsonify_user({
        "ok": True,
        "notifications": notes,
        "unread": sum(1 for n in notes if not n.get("read")),
        "site_version": lykie_releases.SITE_VERSION,
    })


@app.route("/api/releases/<version>")
def api_release_detail(version):
    meta = lykie_releases.get_release(version)
    if not meta:
        return jsonify({"ok": False, "error": "没有该版本说明"}), 404
    return jsonify_user({"ok": True, "release": meta})


@app.route("/api/notifications/read", methods=["POST"])
def api_notifications_read():
    data = request.get_json(force=True) or {}
    all_read = bool(data.get("all"))
    ids = data.get("ids") or []
    if isinstance(ids, str):
        ids = [ids]
    n = lykie_share.mark_notifications_read(
        g.store.username,
        ids=list(ids),
        all_read=all_read,
    )
    return jsonify_user({
        "ok": True,
        "marked": n,
        "unread": lykie_share.unread_count(g.store.username),
    })


@app.route("/api/folders/create", methods=["POST"])
def api_folders_create():
    data = request.get_json(force=True) or {}
    folder, err = lykie_folders.create_folder(g.store, data.get("name") or "")
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({
        "ok": True,
        "folder": {
            "id": folder["id"],
            "name": folder["name"],
            "created_at": folder.get("created_at") or "",
            "count": 0,
        },
        "folders": lykie_folders.list_folders(g.store),
    })


@app.route("/api/folders/rename", methods=["POST"])
def api_folders_rename():
    data = request.get_json(force=True) or {}
    ok, err = lykie_folders.rename_folder(
        g.store, str(data.get("id") or ""), data.get("name") or ""
    )
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "folders": lykie_folders.list_folders(g.store)})


@app.route("/api/folders/delete", methods=["POST"])
def api_folders_delete():
    data = request.get_json(force=True) or {}
    ok, err = lykie_folders.delete_folder(g.store, str(data.get("id") or ""))
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({
        "ok": True,
        "folders": lykie_folders.list_folders(g.store),
        "banks": [
            {
                "id": b["id"],
                "folder_id": b.get("folder_id") or None,
            }
            for b in g.store.banks
        ],
    })


@app.route("/api/folders/reorder", methods=["POST"])
def api_folders_reorder():
    data = request.get_json(force=True) or {}
    ids = data.get("ids")
    ok, err = lykie_folders.reorder_folders(g.store, ids if isinstance(ids, list) else [])
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "folders": lykie_folders.list_folders(g.store)})


@app.route("/api/banks/move", methods=["POST"])
def api_banks_move():
    data = request.get_json(force=True) or {}
    fid = data.get("folder_id")
    if fid is not None and fid != "":
        fid = str(fid)
    else:
        fid = None
    ok, err = lykie_folders.move_bank(g.store, str(data.get("id") or ""), fid)
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({
        "ok": True,
        "folders": lykie_folders.list_folders(g.store),
    })


def _render_mock_q(q):
    """模考/错题练习用：不附斩题信息，选项按原序。"""
    snap = dict(q)
    snap["phase"] = "new"
    return render_question(snap, bank=None)


@app.route("/api/collections", methods=["GET"])
def api_collections():
    return jsonify_user({"collections": lykie_mock.list_collections(g.store)})


@app.route("/api/collections/create", methods=["POST"])
def api_collections_create():
    data = request.get_json(force=True) or {}
    col, err, warnings = lykie_mock.create_collection(
        g.store, data.get("source_bank_ids") or [], data.get("name")
    )
    if err:
        return jsonify({"ok": False, "error": err, "warnings": warnings}), 400
    g.store.save()
    return jsonify_user({
        "ok": True,
        "collection": {
            "id": col["id"],
            "name": col.get("name"),
            "total": len(col.get("question_refs") or []),
            "source_bank_ids": col.get("source_bank_ids") or [],
        },
        "warnings": warnings,
        "collections": lykie_mock.list_collections(g.store),
        "wrong_sets": lykie_mock.list_wrong_sets(g.store),
    })


@app.route("/api/collections/rename", methods=["POST"])
def api_collections_rename():
    data = request.get_json(force=True) or {}
    ok, err = lykie_mock.rename_collection(g.store, str(data.get("id") or ""), data.get("name") or "")
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "collections": lykie_mock.list_collections(g.store)})


@app.route("/api/collections/delete", methods=["POST"])
def api_collections_delete():
    data = request.get_json(force=True) or {}
    ok, err = lykie_mock.delete_collection(g.store, str(data.get("id") or ""))
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "collections": lykie_mock.list_collections(g.store)})


@app.route("/api/mock/start", methods=["POST"])
def api_mock_start():
    data = request.get_json(force=True) or {}
    sess, err = lykie_mock.start_mock(
        g.store,
        str(data.get("collection_id") or ""),
        force_new=bool(data.get("force_new")),
    )
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return api_mock_current()


@app.route("/api/mock/status")
def api_mock_status():
    lykie_mock.ensure_extras(g.store)
    sess = g.store.active_mock
    last = g.store.last_mock_settle
    return jsonify_user({
        "ok": True,
        "active": bool(sess and not sess.get("finished")),
        "paused": bool(sess and sess.get("paused")),
        "collection_id": (sess or {}).get("collection_id") if sess else None,
        "elapsed_sec": lykie_mock.mock_elapsed_sec(sess) if sess else 0,
        "last_settle": last,
    })


@app.route("/api/mock/pause", methods=["POST"])
def api_mock_pause():
    sess, err = lykie_mock.pause_mock(g.store)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({
        "ok": True,
        "paused": True,
        "elapsed_sec": lykie_mock.mock_elapsed_sec(sess),
        "collection_id": sess.get("collection_id"),
    })


@app.route("/api/mock/resume", methods=["POST"])
def api_mock_resume():
    sess, err = lykie_mock.resume_mock(g.store)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return api_mock_current()


@app.route("/api/mock/abort", methods=["POST"])
def api_mock_abort():
    settle, err = lykie_mock.abort_mock(g.store)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "settle": settle})


@app.route("/api/mock/current")
def api_mock_current():
    sess, item, err = lykie_mock._mock_current_item(g.store)
    if err and err != "done":
        # 无进行中：若有结算缓存可返回
        last = getattr(g.store, "last_mock_settle", None)
        return jsonify_user({
            "ok": True,
            "active": False,
            "done": bool(last),
            "settle": last,
            "error": err if err != "没有进行中的模考" else None,
        })
    if err == "done" or (sess and int(sess.get("cursor") or 0) >= len(sess.get("order") or [])):
        settle, _ = lykie_mock.finish_mock(g.store)
        g.store.save()
        return jsonify_user({"ok": True, "done": True, "settle": settle, "active": False})
    if not sess or not item:
        return jsonify_user({"ok": True, "active": False})
    # 暂停中不自动 resume，避免切题库后后台把计时跑起来
    q = _render_mock_q(item["q"])
    q["source_bank_id"] = item["source_bank_id"]
    q["source_qid"] = item["source_qid"]
    q["bank_name"] = item.get("bank_name") or ""
    return jsonify_user({
        "ok": True,
        "active": True,
        "done": False,
        "paused": bool(sess.get("paused")),
        "question": q,
        "index": int(sess.get("cursor") or 0) + 1,
        "total": int(sess.get("total") or 0),
        "streak": int(sess.get("streak") or 0),
        "max_streak": int(sess.get("max_streak") or 0),
        "correct_count": int(sess.get("correct_count") or 0),
        "wrong_count": int(sess.get("wrong_count") or 0),
        "elapsed_sec": lykie_mock.mock_elapsed_sec(sess),
        "collection_id": sess.get("collection_id"),
        "run_index": int(sess.get("run_index") or 1),
    })


@app.route("/api/mock/answer", methods=["POST"])
def api_mock_answer():
    data = request.get_json(force=True) or {}
    # 答题时若处于暂停，先恢复计时
    if g.store.active_mock and g.store.active_mock.get("paused"):
        lykie_mock.resume_mock(g.store)
    payload, err = lykie_mock.answer_mock(g.store, bool(data.get("correct")))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    out = dict(payload or {})
    if not out.get("done"):
        cur = api_mock_current()
        body = cur.get_json()
        out["next"] = body
    return jsonify_user(out)


@app.route("/api/mock/finish", methods=["POST"])
def api_mock_finish():
    settle, err = lykie_mock.finish_mock(g.store)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "settle": settle})


@app.route("/api/wrong_sets")
def api_wrong_sets():
    return jsonify_user({"wrong_sets": lykie_mock.list_wrong_sets(g.store)})


@app.route("/api/wrong_sets/merge", methods=["POST"])
def api_wrong_sets_merge():
    data = request.get_json(force=True) or {}
    ws, err = lykie_mock.merge_wrong_sets(g.store, data.get("ids") or [], data.get("name"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "wrong_set": {"id": ws["id"], "name": ws["name"], "count": len(ws.get("items") or [])}, "wrong_sets": lykie_mock.list_wrong_sets(g.store)})


@app.route("/api/wrong_sets/rename", methods=["POST"])
def api_wrong_sets_rename():
    data = request.get_json(force=True) or {}
    ws = lykie_mock.find_wrong_set(g.store, str(data.get("id") or ""))
    if not ws:
        return jsonify({"ok": False, "error": "错题集不存在"}), 404
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "名称不能为空"}), 400
    ws["name"] = name
    g.store.save()
    return jsonify_user({"ok": True, "wrong_sets": lykie_mock.list_wrong_sets(g.store)})


@app.route("/api/wrong_sets/delete", methods=["POST"])
def api_wrong_sets_delete():
    data = request.get_json(force=True) or {}
    wid = str(data.get("id") or "")
    ensure = lykie_mock.find_wrong_set(g.store, wid)
    if not ensure:
        return jsonify({"ok": False, "error": "错题集不存在"}), 404
    g.store.wrong_sets = [w for w in g.store.wrong_sets if str(w.get("id")) != wid]
    if g.store.active_wrong and str(g.store.active_wrong.get("wrong_set_id")) == wid:
        g.store.active_wrong = None
    g.store.save()
    return jsonify_user({"ok": True, "wrong_sets": lykie_mock.list_wrong_sets(g.store)})


@app.route("/api/wrong/remove", methods=["POST"])
def api_wrong_remove():
    data = request.get_json(force=True) or {}
    ok, err = lykie_mock.remove_wrong_item(
        g.store,
        str(data.get("wrong_set_id") or ""),
        str(data.get("source_bank_id") or ""),
        str(data.get("source_qid") or ""),
    )
    if not ok:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return jsonify_user({"ok": True, "wrong_sets": lykie_mock.list_wrong_sets(g.store)})


@app.route("/api/wrong/start", methods=["POST"])
def api_wrong_start():
    data = request.get_json(force=True) or {}
    sess, err = lykie_mock.start_wrong_practice(g.store, str(data.get("wrong_set_id") or ""))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    return api_wrong_current()


@app.route("/api/wrong/current")
def api_wrong_current():
    sess, item, err = lykie_mock._wrong_current(g.store)
    if err == "done":
        g.store.active_wrong = None
        g.store.save()
        return jsonify_user({"ok": True, "done": True, "active": False})
    if err or not sess or not item:
        return jsonify_user({"ok": True, "active": False, "error": err or None})
    q = _render_mock_q(item["q"])
    q["source_bank_id"] = item["source_bank_id"]
    q["source_qid"] = item["source_qid"]
    remaining = len(sess.get("order") or []) - int(sess.get("cursor") or 0)
    return jsonify_user({
        "ok": True,
        "active": True,
        "done": False,
        "question": q,
        "index": int(sess.get("cursor") or 0) + 1,
        "total": len(sess.get("order") or []),
        "remaining": remaining,
        "wrong_set_id": sess.get("wrong_set_id"),
    })


@app.route("/api/wrong/answer", methods=["POST"])
def api_wrong_answer():
    data = request.get_json(force=True) or {}
    payload, err = lykie_mock.answer_wrong_practice(g.store, bool(data.get("correct")))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    g.store.save()
    out = dict(payload or {})
    if not out.get("done"):
        cur = api_wrong_current()
        out["next"] = cur.get_json()
    else:
        out["wrong_sets"] = lykie_mock.list_wrong_sets(g.store)
    return jsonify_user(out)


@app.route("/api/status")
def api_status():
    b = g.store.current_bank()
    if not b:
        return jsonify_user({
            "total": 0, "killed": 0, "active": 0, "types": {}, "name": None,
            "is_sa": False, "mode": None,
        })
    qs = b["questions"]
    # 客观题进度（斩完结算只看客观）
    obj = [q for q in qs if q.get("type") != "short_answer"]
    total = len(obj) if obj else len(qs)
    killed = sum(1 for q in (obj or qs) if q.get("status") == "killed")
    types = {}
    for q in qs:
        types[q["type"]] = types.get(q["type"], 0) + 1
    is_sa = lykie_sa.is_sa_bank(b)
    payload = {
        "total": total,
        "killed": killed,
        "active": total - killed,
        "types": types,
        "name": b.get("name"),
        "is_sa": is_sa,
        "mode": b.get("mode") or ("short_answer" if is_sa else "objective"),
    }
    if not is_sa:
        run = lykie_settle.ensure_bank_runs(b)
        payload["run_index"] = int((run or {}).get("index") or 1)
        payload["run_streak"] = int((run or {}).get("streak") or 0)
        payload["run_max_streak"] = int((run or {}).get("max_streak") or 0)
        payload["all_cleared"] = bool(obj) and killed == total and total > 0
    return jsonify_user(payload)


@app.route("/api/settle")
def api_settle():
    """斩完 / 周目结算墙数据。?run=N 查看指定周目。"""
    b = g.store.current_bank()
    if not b:
        return jsonify({"ok": False, "error": "无当前题库"}), 404
    if lykie_sa.is_sa_bank(b):
        return jsonify({"ok": False, "error": "简答库无斩题结算"}), 400
    run_arg = request.args.get("run")
    run_index = int(run_arg) if run_arg and str(run_arg).isdigit() else None
    data = lykie_settle.build_settle(b, run_index)
    return jsonify({"ok": True, **data})


@app.route("/api/select_bank", methods=["POST"])
def api_select_bank():
    data = request.get_json(force=True)
    bid = str(data.get("id", ""))
    if any(b["id"] == bid for b in g.store.banks):
        g.store.current_bank_id = bid
        g.store.save()
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "题库不存在"}), 404


@app.route("/api/import", methods=["POST"])
def api_import():
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "未收到文件"}), 400
    filename = f.filename or ""
    if not filename.lower().endswith(".docx"):
        return jsonify({
            "ok": False,
            "error": "只支持 .docx 格式。若是 .doc 文件，请用 Word 另存为 .docx 后再导入。",
        }), 400

    preview = str(request.form.get("preview") or "").lower() in ("1", "true", "yes")
    name = str(request.form.get("name") or "").strip()
    if not name:
        name = os.path.splitext(filename)[0] or filename
    exemplar = str(request.form.get("exemplar") or "")

    fd, tmp = tempfile.mkstemp(suffix=".docx")
    os.close(fd)
    f.save(tmp)
    try:
        if exemplar.strip():
            text = docx_to_text(tmp)
            text, platform = lykie_import_platform.normalize_if_known(text)
            questions, err, meta = _resolve_import_questions(text, exemplar)
            meta = dict(meta or {})
            meta["platform"] = platform
            if err:
                return jsonify({"ok": False, "error": err, "meta": meta}), 400
        else:
            questions = parse_docx(tmp)
            meta = {"mode": "legacy", "platform": None}
    except Exception as e:
        return jsonify({"ok": False, "error": f"解析失败：{e}"}), 400
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    if not questions:
        return jsonify({"ok": False, "error": "没有解析出题目，请检查文档格式"}), 400

    answer_picks = request.form.get("answer_picks")
    if answer_picks:
        try:
            answer_picks = json.loads(answer_picks)
        except Exception:
            answer_picks = {}
    else:
        answer_picks = {}

    if preview:
        return jsonify(_preview_questions_payload(
            questions,
            suggested_name=name,
            meta=meta,
        ))

    pending = _apply_answer_picks(questions, answer_picks)
    if pending:
        return jsonify({
            "ok": False,
            "error": f"还有 {len(pending)} 题答案待确认（第 {', '.join(map(str, pending[:8]))}"
                     + ("…" if len(pending) > 8 else "")
                     + " 题），请在预览里点选正确答案后再入库",
        }), 400

    b = {
        "id": new_bank_id(),
        "name": name,
        "imported_at": now_str(),
        "questions": questions,
        "folder_id": None,
    }
    g.store.banks.append(b)
    g.store.current_bank_id = b["id"]
    lykie_settle.ensure_bank_runs(b)
    g.store.save()
    return jsonify({"ok": True, "total": len(questions), "bank_id": b["id"]})


@app.route("/api/import/extract", methods=["POST"])
def api_import_extract():
    """仅抽出 docx 纯文本，供导入页进入样板步骤。"""
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "未收到文件"}), 400
    filename = f.filename or ""
    if not filename.lower().endswith(".docx"):
        return jsonify({"ok": False, "error": "只支持 .docx 格式"}), 400
    fd, tmp = tempfile.mkstemp(suffix=".docx")
    os.close(fd)
    f.save(tmp)
    try:
        text = docx_to_text(tmp)
    except Exception as e:
        return jsonify({"ok": False, "error": f"读取失败：{e}"}), 400
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    if not text.strip():
        return jsonify({"ok": False, "error": "文档里没有可用文本"}), 400
    suggested = os.path.splitext(filename)[0] or filename
    result = lykie_import_scan.scan_pools(text)
    return jsonify({
        "ok": True,
        "text": text,
        "suggested_name": suggested,
        "detected_types": result.get("detected_types") or [],
        "pools": result.get("pools") or {},
    })


@app.route("/api/import/scan", methods=["POST"])
def api_import_scan():
    """扫描原文题型，并按题型归并题块池（供独立扫描步挑样板）。"""
    data = request.get_json(force=True) or {}
    text = str(data.get("text") or "")
    text, platform = lykie_import_platform.normalize_if_known(text)
    if not text.strip():
        return jsonify({"ok": False, "error": "文本为空"}), 400
    result = lykie_import_scan.scan_pools(text)
    return jsonify({
        "ok": True,
        "detected_types": result.get("detected_types") or [],
        "pools": result.get("pools") or {},
        "platform": platform,
    })


@app.route("/api/import_text", methods=["POST"])
def api_import_text():
    data = request.get_json(force=True)
    text = str(data.get("text", ""))
    html = str(data.get("html") or "")
    # 学习通 HTML 通道：剪贴板带结构化 DOM 且解出题目 → 直接采用，
    # 跳过 normalize_if_known 与样板切块；零题 → 回落纯文本管道（可观测降级）
    dom_questions, dom_meta, dom_fallback = None, None, False
    if html and lykie_import_dom.looks_like_xuexitong_html(html):
        parsed, _dom_err = lykie_import_dom.parse_xuexitong_html(html)
        if parsed:
            dom_questions, dom_meta = _resolve_dom_questions(parsed)
        else:
            dom_fallback = True
    if dom_questions:
        platform = lykie_import_dom.PLATFORM_XUEXITONG_HTML
    else:
        text, platform = lykie_import_platform.normalize_if_known(text)
    name = str(data.get("name", "")).strip() or "粘贴导入"
    preview = bool(data.get("preview", False))
    exemplar = str(data.get("exemplar") or "")
    exemplars = data.get("exemplars") if isinstance(data.get("exemplars"), dict) else {}
    answer_picks = data.get("answer_picks") or {}
    ack_skipped = data.get("ack_skipped_types") or []
    import_sa = bool(data.get("import_sa", False))

    if not text.strip() and not dom_questions:
        return jsonify({"ok": False, "error": "文本为空"}), 400

    if dom_questions:
        questions, err, meta = dom_questions, "", dict(dom_meta)
    else:
        questions, err, meta = _resolve_import_questions(text, exemplar, exemplars)
    meta = dict(meta or {})
    meta["platform"] = "xuexitong-html-fallback" if dom_fallback else platform
    if err:
        return jsonify({"ok": False, "error": err, "meta": meta}), 400

    # 勾选另建简答但未提供样板且扫到简答
    detected_kinds = {d.get("kind") for d in (meta.get("detected_types") or [])}
    if import_sa and "short_answer" in detected_kinds:
        if "short_answer" not in (meta.get("covered_types") or []) and not (meta.get("sa_total") or 0):
            return jsonify({
                "ok": False,
                "error": "已勾选同时导入简答，请粘贴一道简答样板（题干 + 答案：…）。",
                "meta": meta,
            }), 400

    if preview:
        payload = _preview_questions_payload(questions, meta=meta)
        payload["sa_total"] = int(meta.get("sa_total") or 0)
        payload["sa_preview"] = [
            {
                "type": q.get("type"),
                "stem": q.get("stem"),
                "answer": q.get("answer"),
                "points": q.get("points") or [],
            }
            for q in (meta.get("sa_questions") or [])[:20]
        ]
        return jsonify(payload)

    gate_err = _gate_uncovered_types(meta, ack_skipped, import_sa)
    if gate_err:
        return jsonify({"ok": False, "error": gate_err, "meta": meta}), 400

    pending = _apply_answer_picks(questions, answer_picks)
    if pending:
        return jsonify({
            "ok": False,
            "error": f"还有 {len(pending)} 题答案待确认（第 {', '.join(map(str, pending[:8]))}"
                     + ("…" if len(pending) > 8 else "")
                     + " 题），请在预览里点选正确答案后再入库",
        }), 400

    sa_bank_id = None
    sa_questions = list(meta.get("sa_questions") or [])
    if import_sa and sa_questions:
        for q in sa_questions:
            ensure_question_defaults(q)
            q["type"] = "short_answer"
        obj_id = new_bank_id()
        sa_id = str(int(obj_id) + 1)
        sa_bank = {
            "id": sa_id,
            "name": f"{name}·简答",
            "imported_at": now_str(),
            "questions": sa_questions,
            "folder_id": None,
            "mode": "short_answer",
        }
        g.store.banks.append(sa_bank)
        sa_bank_id = sa_bank["id"]
    else:
        obj_id = new_bank_id()

    if not questions and not sa_bank_id:
        return jsonify({"ok": False, "error": "没有可入库的题目"}), 400

    bank_id = None
    if questions:
        for q in questions:
            ensure_question_defaults(q)
        b = {
            "id": obj_id,
            "name": name,
            "imported_at": now_str(),
            "questions": questions,
            "folder_id": None,
            "mode": "objective",
        }
        g.store.banks.append(b)
        g.store.current_bank_id = b["id"]
        lykie_settle.ensure_bank_runs(b)
        bank_id = b["id"]
    elif sa_bank_id:
        g.store.current_bank_id = sa_bank_id

    g.store.save()
    out = {
        "ok": True,
        "total": len(questions),
        "bank_id": bank_id,
        "sa_total": len(sa_questions) if sa_bank_id else 0,
        "sa_bank_id": sa_bank_id,
    }
    if meta.get("uncovered_types") and ack_skipped:
        out["skipped_types"] = list(meta.get("uncovered_types") or [])
    return jsonify(out)


@app.route("/api/next")
def api_next():
    b = g.store.current_bank()
    if not b:
        return jsonify({"question": None, "reason": "empty"})
    lykie_settle.ensure_bank_runs(b)
    active = [
        q for q in b["questions"]
        if q.get("status") != "killed" and q.get("type") != "short_answer"
    ]
    if not active:
        run = lykie_settle.current_run(b)
        if not run.get("cleared_at"):
            lykie_settle.mark_run_cleared(b, run)
            g.store.save()
        return jsonify({
            "question": None,
            "reason": "done",
            "run_index": int(run.get("index") or 1),
        })

    due = [q for q in active if q["countdown"] == 0]
    chosen = random.choice(due) if due else min(active, key=lambda x: x["countdown"])

    # 抽走一题后，其余题目的间隔倒计时 -1（countdown 表示还需隔几道题）
    for q in active:
        if q is not chosen:
            q["countdown"] = max(0, q["countdown"] - 1)

    g.store.save()
    return jsonify({"question": render_question(chosen, b), "reason": "ok"})


@app.route("/api/answer", methods=["POST"])
def api_answer():
    b = g.store.current_bank()
    if not b:
        return jsonify({"ok": False, "error": "无当前题库"}), 404
    data = request.get_json(force=True)
    q = find_question(b, str(data.get("id", "")))
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404

    correct = bool(data.get("correct", False))
    run = lykie_settle.record_answer(b, q, correct)
    st = lykie_settle.run_qstat(run, str(q["id"]))
    can, reason = lykie_settle.kill_gate(q, run)
    g.store.save()
    return jsonify({
        "ok": True,
        "run_streak": int(run.get("streak") or 0),
        "run_max_streak": int(run.get("max_streak") or 0),
        "run_answer_count": int(st.get("answer_count") or 0),
        "run_correct_count": int(st.get("correct_count") or 0),
        "can_kill": can,
        "kill_block_reason": reason,
        "phase": q.get("phase"),
    })


@app.route("/api/update_question", methods=["POST"])
def api_update_question():
    data = request.get_json(force=True)
    bid = str(data.get("bank_id") or g.store.current_bank_id)
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    q = find_question(b, str(data.get("id", "")))
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404

    if "stem" in data and data["stem"]:
        q["stem"] = data["stem"].strip()
    if "type" in data:
        q["type"] = data["type"]
    if "options" in data:
        q["options"] = [str(x).strip() for x in data["options"] if str(x).strip()]
    if "answer" in data:
        q["answer"] = data["answer"]
    if q.get("type") == "choice" and q.get("options"):
        q["answer"] = normalize_choice_answer(str(q.get("answer") or ""), q["options"])
    if "analysis" in data:
        q["analysis"] = str(data.get("analysis") or "").strip()
    if "keywords" in data:
        raw = data["keywords"]
        if isinstance(raw, str):
            kws = lykie_sa.parse_keywords_input(raw)
        else:
            kws = [str(x).strip() for x in (raw or []) if str(x).strip()]
        lykie_sa.apply_keywords_to_question(q, kws)
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/kill", methods=["POST"])
def api_kill():
    b = g.store.current_bank()
    if not b:
        return jsonify({"ok": False, "error": "无当前题库"}), 404
    data = request.get_json(force=True) or {}
    q = find_question(b, str(data.get("id", "")))
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    as_correct = bool(data.get("as_correct"))
    ok, reason, run = lykie_settle.apply_kill(b, q, as_correct=as_correct)
    if not ok:
        return jsonify({"ok": False, "error": reason}), 400
    g.store.save()
    return jsonify({
        "ok": True,
        "run_streak": int((run or {}).get("streak") or 0),
        "run_max_streak": int((run or {}).get("max_streak") or 0),
        "cleared": bool((run or {}).get("cleared_at")),
    })


@app.route("/api/reset", methods=["POST"])
def api_reset():
    b = g.store.current_bank()
    if not b:
        return jsonify({"ok": False, "error": "无当前题库"}), 404
    if not lykie_sa.is_sa_bank(b):
        lykie_settle.start_new_run_on_reset(b)
    else:
        for q in b["questions"]:
            q["status"] = "active"
            q["phase"] = "new"
            q["interval"] = 0
            q["countdown"] = 0
            q["streak"] = 0
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/bank_questions")
def api_bank_questions():
    bid = str(request.args.get("bank_id") or g.store.current_bank_id)
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    result = []
    for q in b["questions"]:
        result.append({
            "id": q["id"],
            "num": q.get("num", ""),
            "type": q["type"],
            "stem": q["stem"],
            "options": q.get("options", []),
            "answer": q["answer"],
            "analysis": q.get("analysis", ""),
            "keywords": q.get("keywords") or [],
            "status": q.get("status", "active"),
            "answer_count": q.get("answer_count", 0),
            "correct_count": q.get("correct_count", 0),
        })
    return jsonify({"bank_id": bid, "name": b.get("name"), "questions": result})


@app.route("/api/rename_bank", methods=["POST"])
def api_rename_bank():
    data = request.get_json(force=True)
    bid = str(data.get("id", ""))
    name = str(data.get("name", "")).strip()
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    if not name:
        return jsonify({"ok": False, "error": "名称不能为空"}), 400
    b["name"] = name
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/delete_question", methods=["POST"])
def api_delete_question():
    data = request.get_json(force=True)
    bid = str(data.get("bank_id") or g.store.current_bank_id)
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    qid = str(data.get("id", ""))
    q = find_question(b, qid)
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    b["questions"] = [x for x in b["questions"] if x["id"] != qid]
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/delete_bank", methods=["POST"])
def api_delete_bank():
    data = request.get_json(force=True)
    bid = str(data.get("id", ""))
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    g.store.banks.remove(b)
    if g.store.current_bank_id == bid:
        g.store.current_bank_id = g.store.banks[0]["id"] if g.store.banks else None
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/add_question", methods=["POST"])
def api_add_question():
    data = request.get_json(force=True)
    bid = str(data.get("bank_id") or g.store.current_bank_id)
    b = next((x for x in g.store.banks if x["id"] == bid), None)
    if not b:
        return jsonify({"ok": False, "error": "题库不存在"}), 404
    max_id = 0
    for q in b["questions"]:
        try:
            max_id = max(max_id, int(q["id"]))
        except (ValueError, TypeError):
            pass
    q = {
        "id": str(max_id + 1),
        "type": data.get("type", "fill"),
        "stem": str(data.get("stem", "")).strip(),
        "options": [str(x).strip() for x in data.get("options", []) if str(x).strip()],
        "answer": data.get("answer", ""),
        "analysis": str(data.get("analysis", "")).strip(),
        "status": "active",
        "phase": "new",
        "interval": 0,
        "countdown": 0,
        "streak": 0,
        "answer_count": 0,
        "correct_count": 0,
    }
    if q["type"] == "choice" and q["options"]:
        q["answer"] = normalize_choice_answer(str(q.get("answer") or ""), q["options"])
    if "keywords" in data:
        raw = data["keywords"]
        if isinstance(raw, str):
            kws = lykie_sa.parse_keywords_input(raw)
        else:
            kws = [str(x).strip() for x in (raw or []) if str(x).strip()]
        lykie_sa.apply_keywords_to_question(q, kws)
    b["questions"].append(q)
    g.store.save()
    return jsonify({"ok": True, "id": q["id"]})


# ==================== Lykie ====================
@app.route("/api/lykie/state")
def api_lykie_state():
    configured = lykie_llm.is_configured()
    state = lykie_memory.load_state(g.store.lykie_path)
    flags = state.get("flags") or {}
    prof = lykie_profile.profile_runtime_info()
    return jsonify({
        "configured": configured,
        "model": lykie_llm.get_config()["model"] if configured else None,
        "shaping_shared": True,
        "fact_count": len(state.get("facts") or []),
        "style_note_count": len(state.get("style_notes") or []),
        "correction_count": len(state.get("corrections") or []),
        "author_log_count": len(
            (lykie_author_log.load_log(g.store.username).get("items") or [])
        ),
        "portrait_offense_count": int(
            (state.get("portrait") or {}).get("offense_count") or 0
        ),
        "portrait_unapologized": bool(
            (state.get("portrait") or {}).get("unapologized")
        ),
        "portrait_warned": bool((state.get("portrait") or {}).get("warned")),
        "flags": flags,
        "relationship_stage": lykie_memory.get_relationship_stage(state),
        "relationship_label": lykie_memory.stage_label(
            lykie_memory.get_relationship_stage(state)
        ),
        "relationship_stages": [
            {"id": sid, "label": lykie_memory.STAGE_LABELS[sid]}
            for sid in lykie_memory.RELATIONSHIP_STAGES
        ],
        "story_pending": False,
        "opening": lykie_opening.public_state(state),
        "panel_log": state.get("panel_log") or [],
        "chat_tail_len": len(state.get("chat_tail") or []),
        "profile": prof,
    })


@app.route("/api/lykie/panel", methods=["POST"])
def api_lykie_panel():
    """保存右侧聊天面板记录（本地持久化，重启可还原）。"""
    data = request.get_json(force=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list):
        return jsonify({"ok": False, "error": "messages 须为数组"}), 400
    state = lykie_memory.load_state(g.store.lykie_path)
    log = lykie_memory.set_panel_log(state, messages)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({"ok": True, "count": len(log)})


@app.route("/api/lykie/opening/start", methods=["POST"])
def api_lykie_opening_start():
    """作者测开场节点 1：钉开局、清对话，由她发出定稿第一句。不自动对所有账号开。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    panel = lykie_opening.start_not_ai(state)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({
        "ok": True,
        "panel_log": panel,
        "opening": lykie_opening.public_state(state),
        "relationship_stage": lykie_memory.get_relationship_stage(state),
        "relationship_label": lykie_memory.stage_label(
            lykie_memory.get_relationship_stage(state)
        ),
        "flags": state.get("flags") or {},
    })


@app.route("/api/lykie/opening/nudge", methods=["POST"])
def api_lykie_opening_nudge():
    """开场节点 1：长时间不回则催一次；再等仍不回则停。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    result = lykie_opening.nudge(state)
    if result.get("ok"):
        lykie_memory.save_state(g.store.lykie_path, state)
    status = 200 if result.get("ok") else 400
    result["opening"] = lykie_opening.public_state(state)
    return jsonify(result), status


@app.route("/api/lykie/chat_reset_opening", methods=["POST"])
def api_lykie_chat_reset_opening():
    """清 chat_tail / 面板到开场结束；保留 facts、监督、flags。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    if not (state.get("flags") or {}).get("fragment_01_done"):
        return jsonify({"ok": False, "error": "开场尚未完成，无法清到开场后"}), 400
    panel = lykie_memory.reset_chat_to_opening_end(state)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({"ok": True, "panel_log": panel})


@app.route("/api/lykie/memory_clear", methods=["POST"])
def api_lykie_memory_clear():
    """清空本账号 facts / 对话 / 画像（过节）/ 名字。口吻、监督、作者日志全站共用，不清。保留感情层等 flags。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    panel = lykie_memory.wipe_user_memory(state)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({
        "ok": True,
        "panel_log": panel,
        "flags": state.get("flags") or {},
        "relationship_stage": lykie_memory.get_relationship_stage(state),
        "relationship_label": lykie_memory.stage_label(
            lykie_memory.get_relationship_stage(state)
        ),
        "opening": lykie_opening.public_state(state),
    })


@app.route("/api/lykie/author_log", methods=["POST"])
def api_lykie_author_log():
    """作者现场日志。不进模型、不清记忆。"""
    data = request.get_json(force=True) or {}
    note = str(data.get("note") or "").strip()
    state = lykie_memory.load_state(g.store.lykie_path)
    scene = data.get("scene")
    user_said = str(data.get("user_said") or "")
    focus_text = str(data.get("focus_text") or "")
    reviews = lykie_author_log.corrections_in_scope(
        state, scene, user_said, focus_text
    )
    item = lykie_author_log.add_entry(
        g.store.username,
        note=note,
        stage=lykie_memory.get_relationship_stage(state),
        stage_label=lykie_memory.stage_label(
            lykie_memory.get_relationship_stage(state)
        ),
        user_said=user_said,
        focus_text=focus_text,
        scene=scene,
        chat_tail=state.get("chat_tail") or [],
        reviews=reviews,
    )
    return jsonify({
        "ok": True,
        "id": item["id"],
        "count": len(lykie_author_log.load_log(g.store.username).get("items") or []),
    })


@app.route("/api/lykie/relationship", methods=["POST"])
def api_lykie_relationship():
    """作者钉感情层。不清 facts / 监督。"""
    data = request.get_json(force=True) or {}
    stage = str(data.get("stage") or "").strip()
    if stage not in lykie_memory.RELATIONSHIP_STAGES:
        return jsonify({"ok": False, "error": "未知感情层"}), 400
    state = lykie_memory.load_state(g.store.lykie_path)
    sid = lykie_memory.set_relationship_stage(state, stage)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({
        "ok": True,
        "stage": sid,
        "label": lykie_memory.stage_label(sid),
        "flags": state.get("flags") or {},
        "opening": lykie_opening.public_state(state),
        "relationship_stage": sid,
        "relationship_label": lykie_memory.stage_label(sid),
    })


# ==================== 档案 Atlas（作者工具） ====================

AUTHOR_USERNAME = "LiZF"


def _require_author():
    """作者门禁：固定作者账号（LiZF）。非作者 404。"""
    return g.store.username == AUTHOR_USERNAME


@app.route("/atlas")
def atlas_page():
    if not _require_author():
        return redirect(url_for("index"))
    return render_template("atlas.html", username=g.store.username)


@app.route("/api/atlas/state")
def api_atlas_state():
    if not _require_author():
        return jsonify({"ok": False, "error": "无权访问"}), 403
    data = lykie_atlas.load_entries()
    state = lykie_memory.load_state(g.store.lykie_path)
    facts = lykie_atlas.facts_as_objects(state)
    return jsonify_user({
        "ok": True,
        "entries": data["entries"],
        "sections": data["sections"],
        "prose_stale": data["prose_stale"],
        "prose_published_at": data["prose_published_at"],
        "prose": lykie_atlas.load_prose(),
        "draft_status": lykie_atlas.draft_status(data["entries"]),
        "facts": facts,
        "self_txt_mtime": None,
    })


@app.route("/api/atlas/import_draft", methods=["POST"])
def api_atlas_import_draft():
    """从 self.txt 按行导草稿（只读 self.txt；已导入过则追加去重）。"""
    if not _require_author():
        return jsonify({"ok": False, "error": "无权访问"}), 403
    data = lykie_atlas.load_entries()
    existing_src = {e.get("source") for e in data["entries"]}
    drafts = lykie_atlas.draft_from_self_txt()
    added = [d for d in drafts if d["source"] not in existing_src]
    if added:
        data["entries"] = list(data["entries"]) + added
        lykie_atlas.save_entries(data["entries"])
    data = lykie_atlas.load_entries()
    return jsonify_user({
        "ok": True,
        "added": len(added),
        "draft_status": lykie_atlas.draft_status(data["entries"]),
        "entries": data["entries"],
        "sections": data["sections"],
    })


@app.route("/api/atlas/entries/save", methods=["POST"])
def api_atlas_entries_save():
    if not _require_author():
        return jsonify({"ok": False, "error": "无权访问"}), 403
    data = request.get_json(force=True) or {}
    entries = data.get("entries")
    if not isinstance(entries, list):
        return jsonify({"ok": False, "error": "entries 必须是列表"}), 400
    sections = data.get("sections")
    if sections is not None and not isinstance(sections, list):
        return jsonify({"ok": False, "error": "sections 必须是列表"}), 400
    saved = lykie_atlas.save_entries(entries, sections=sections)
    return jsonify_user({
        "ok": True,
        "entries": saved["entries"],
        "sections": saved["sections"],
        "prose_stale": saved["prose_stale"],
        "draft_status": lykie_atlas.draft_status(saved["entries"]),
    })


@app.route("/api/atlas/render", methods=["POST"])
def api_atlas_render():
    """本地拼接散文草稿：不调模型、不落盘、不生效，只在编辑器展示。"""
    if not _require_author():
        return jsonify({"ok": False, "error": "无权访问"}), 403
    return jsonify_user({"ok": True, "draft": lykie_atlas.render_prose_draft()})


@app.route("/api/atlas/publish", methods=["POST"])
def api_atlas_publish():
    """作者审核后发布散文：原子写入 profile_prose.txt，清 stale。"""
    if not _require_author():
        return jsonify({"ok": False, "error": "无权访问"}), 403
    data = request.get_json(force=True) or {}
    prose = str(data.get("prose") or "").strip()
    if not prose:
        return jsonify({"ok": False, "error": "散文内容不能为空"}), 400
    lykie_atlas.save_prose(prose)
    meta = lykie_atlas.mark_prose_published()
    return jsonify_user({
        "ok": True,
        "prose_stale": meta["prose_stale"],
        "prose_published_at": meta["prose_published_at"],
        "prose": prose,
    })


@app.route("/api/lykie/feedback", methods=["POST"])
def api_lykie_feedback():
    """点踩/点赞：保存好范例短句 + 修改点评；点踩默认可回退重问。"""
    data = request.get_json(force=True) or {}
    vibe = str(data.get("vibe") or "down").strip().lower()
    if vibe not in ("down", "up"):
        vibe = "down"

    user_said = str(data.get("user_said") or "").strip()
    bad_reply = str(data.get("bad_reply") or data.get("reply") or "").strip()
    review = str(data.get("review") or "").strip()
    rollback = bool(data.get("rollback", vibe == "down"))
    raw_lines = data.get("good_lines")
    if isinstance(raw_lines, str):
        good_lines = [ln.strip() for ln in raw_lines.replace("\r", "").split("\n") if ln.strip()]
    elif isinstance(raw_lines, list):
        good_lines = [str(x).strip() for x in raw_lines if str(x).strip()]
    else:
        good_lines = []

    if vibe == "down" and not good_lines and not review:
        return jsonify({"ok": False, "error": "请填写好范例短句或修改点评"}), 400
    if vibe == "up" and not bad_reply and not good_lines:
        return jsonify({"ok": False, "error": "没有可点赞的回复"}), 400

    state = lykie_memory.load_state(g.store.lykie_path)
    item = lykie_memory.add_correction(
        state,
        user_said=user_said,
        bad_reply=bad_reply if vibe == "down" else ("" if good_lines else bad_reply),
        good_lines=good_lines,
        review=review or ("用户认可这种说法，同类情境可参考。" if vibe == "up" else ""),
        vibe=vibe,
    )
    if not item:
        return jsonify({"ok": False, "error": "无法保存"}), 400

    removed_users = []
    replaced = False
    if vibe == "down" and rollback:
        removed_users = lykie_memory.rollback_before_user_turn(state, user_said)
    elif vibe == "down" and item.get("good_lines"):
        # 兼容：不回退时仍用好范例替换尾迹
        replaced = lykie_memory.replace_last_assistant(
            state, "\n".join(item["good_lines"])
        )

    # 前端会同步 panel；若带了 messages 则一并写
    if isinstance(data.get("panel_messages"), list):
        lykie_memory.set_panel_log(state, data.get("panel_messages"))

    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({
        "ok": True,
        "correction": item,
        "replaced_tail": replaced,
        "rollback": bool(vibe == "down" and rollback),
        "removed_users": removed_users,
        "correction_count": len(state.get("corrections") or []),
        "style_note_count": len(state.get("style_notes") or []),
    })


@app.route("/api/stories")
def api_stories():
    return jsonify({"ok": True, "stories": list_stories(BASE_DIR)})


@app.route("/api/story/complete", methods=["POST"])
def api_story_complete():
    data = request.get_json(force=True) or {}
    story_id = str(data.get("story_id") or "fragment_01").strip()
    player_name = str(data.get("player_name") or "").strip()[:40]
    ending = str(data.get("ending") or "").strip()[:80]

    state = lykie_memory.load_state(g.store.lykie_path)
    flags = state.setdefault("flags", {})
    if story_id == "fragment_01":
        flags["fragment_01_done"] = True
    if player_name:
        flags["player_name"] = player_name
    if ending:
        flags["fragment_01_ending"] = ending
    if story_id == "fragment_01":
        lykie_memory.apply_fragment_01_memory(state, player_name, ending)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({"ok": True, "flags": flags})


@app.route("/api/story/reset", methods=["POST"])
def api_story_reset():
    """测试用：重开片段 01。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    flags = state.setdefault("flags", {})
    flags["fragment_01_done"] = False
    flags.pop("fragment_01_ending", None)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({"ok": True, "flags": flags})


@app.route("/api/story/<story_id>")
def api_story_get(story_id):
    if story_id in ("complete", "reset"):
        return jsonify({"ok": False, "error": "方法不允许"}), 405
    try:
        graph = load_story(BASE_DIR, story_id)
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "剧情不存在"}), 404
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "graph": graph})


@app.route("/api/lykie/extract_name", methods=["POST"])
def api_lykie_extract_name():
    """从用户自报文案中抽取名字（开场占位符用）。"""
    data = request.get_json(force=True) or {}
    text = str(data.get("text") or data.get("message") or "").strip()
    if not text:
        return jsonify({"ok": False, "error": "空文本", "name": ""}), 400

    name = ""
    if lykie_llm.is_configured():
        name = lykie_extract.extract_player_name(text, lykie_llm.chat_completion)
    if not name:
        name = lykie_extract.local_extract_name(text)
    return jsonify({"ok": True, "name": name, "via": "llm" if lykie_llm.is_configured() else "rules"})


@app.route("/api/lykie/chat", methods=["POST"])
def api_lykie_chat():
    if not lykie_llm.is_configured():
        return jsonify({
            "ok": False,
            "error": "未配置 LYKIE_API_KEY。请复制 .env.example 为 .env 并填入密钥后重启。",
        }), 400

    data = request.get_json(force=True) or {}
    mode = str(data.get("mode") or "chat").strip().lower()
    if mode not in ("chat", "explain", "correct"):
        mode = "chat"
    # 旧客户端「问问 Lykie」：当闲聊，题面改走 question_card，永不带解析
    question = data.get("question")
    if question is not None and not isinstance(question, dict):
        question = None
    question_card = lykie_lookup.sanitize_question_card(data.get("question_card"))
    if mode == "explain":
        mode = "chat"
        if not question_card and question:
            question_card = lykie_lookup.sanitize_question_card(question)
        question = None

    # 闲聊支持连发：messages[]；兼容单条 message
    batch = []
    raw_batch = data.get("messages")
    if isinstance(raw_batch, list):
        batch = [str(x).strip() for x in raw_batch if str(x).strip()]
    message = str(data.get("message") or "").strip()
    if not batch and message:
        batch = [message]
    message = batch[0] if batch else ""

    # 以「纠正：」开头时强制走纠正模式（取首句）
    if mode == "chat" and message and lykie_extract.is_explicit_correction(message):
        mode = "correct"
        message = lykie_extract.strip_correction_prefix(message)
        batch = [message]
        question_card = None

    if mode == "correct":
        question_card = None

    if question_card:
        stem_md = lykie_lookup.format_question_stem_md(question_card)
        if stem_md and stem_md not in batch:
            batch = [stem_md] + batch
        message = batch[0] if batch else ""

    if not batch:
        return jsonify({"ok": False, "error": "消息为空"}), 400

    state = lykie_memory.load_state(g.store.lykie_path)
    last_reply = lykie_memory.last_assistant_message(state)
    if mode == "correct" and data.get("last_reply"):
        last_reply = str(data.get("last_reply") or "").strip() or last_reply

    # 上一轮已经回过了，这一轮只是改错字 → 心里明白，不再回
    if mode == "chat":
        last_user = lykie_memory.last_user_message(state)
        if lykie_typo.is_typo_only_followup(batch, last_user):
            patched = lykie_typo.apply_fix_to_text(last_user, batch[-1])
            if patched and patched != last_user:
                lykie_memory.patch_last_user_message(state, patched)
            lykie_memory.save_state(g.store.lykie_path, state)
            return jsonify({
                "ok": True,
                "reply": "",
                "silent": True,
                "typo_fix": True,
                "facts_added": [],
            })

    if mode == "chat":
        prompt_user = lykie_llm.format_chat_user_batch(batch)
    else:
        prompt_user = message

    # ── 题目记忆 ──
    active_card = None
    just_realized = False
    if mode == "chat":
        if question_card:
            lykie_memory.remember_question(state, question_card)
        else:
            for m in batch:
                parsed = lykie_lookup.parse_question_stem_md(m)
                if parsed:
                    lykie_memory.remember_question(state, parsed)
            lykie_memory.ensure_question_memory_from_tail(state)
        remembered = lykie_memory.latest_question(state)
        followup = bool(question_card) or lykie_memory.looks_like_question_followup(
            batch, state
        )
        active_card = question_card or (remembered if followup else None)

    # ── 开场察觉检测（纯规则，不依赖 think JSON） ──
    if mode == "chat" and lykie_opening.is_active(state):
        result = lykie_opening.classify_not_ai({}, batch, state)
        already = bool(result.get("already"))
        if result.get("realized") and not already:
            lykie_opening.mark_realized(state, result)
            just_realized = True

    # ── 单次模型调用 ──
    try:
        result = lykie_converse.handle_message(
            state,
            prompt_user,
            mode=mode,
            question_card=active_card,
            last_reply=last_reply,
            batch=batch,
        )
        reply = result["reply"]
        silent = result["silent"]
    except Exception as e:
        return jsonify({"ok": False, "error": f"模型调用失败：{e}"}), 502

    # 剥掉模型可能残留的 %%档案 标注
    if mode == "chat":
        reply = lykie_profile.parse_archive_meta(reply).get("reply") or reply

    # ── 写入对话历史 ──
    if mode == "correct":
        for m in batch:
            lykie_memory.append_chat(state, "user", f"[纠正] {m}")
        lykie_memory.append_chat(state, "assistant", reply)
    else:
        for m in batch:
            lykie_memory.append_chat(state, "user", m)
        lykie_memory.append_chat(state, "assistant", reply)

    # ── 直攻降层 ──
    dropped_stage = None
    if mode == "chat" and silent and lykie_memory.is_direct_attack(batch):
        dropped_stage = lykie_memory.drop_relationship_stage(state)

    # ── 事实提取（简单记忆，非监督产物） ──
    facts_added = []
    joined_user = "\n".join(batch)
    if mode == "chat" and not any(lykie_extract.is_explicit_correction(m) for m in batch):
        try:
            raw_facts = lykie_extract.extract_facts_from_utterance(
                joined_user, lykie_llm.chat_completion
            )
            facts_added = lykie_memory.add_facts(state, raw_facts)
        except Exception:
            facts_added = []

    strict = lykie_profile.is_profile_strict()
    lykie_memory.save_state(g.store.lykie_path, state)
    payload = {
        "ok": True,
        "reply": "" if silent else reply,
        "silent": silent,
        "facts_added": facts_added,
        "profile_strict": strict if mode == "chat" else False,
        "relationship_stage": lykie_memory.get_relationship_stage(state),
        "relationship_label": lykie_memory.stage_label(
            lykie_memory.get_relationship_stage(state)
        ),
        "relationship_dropped": dropped_stage,
        "opening": lykie_opening.public_state(state),
        "opening_just_realized": just_realized,
    }
    return jsonify(payload)


@app.after_request
def add_no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    host = os.environ.get("LYKIE_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("LYKIE_PORT", "5000"))
    open_browser = os.environ.get("LYKIE_OPEN_BROWSER", "1").strip().lower() not in ("0", "false", "no")
    url = f"http://127.0.0.1:{port}/"
    if open_browser and host in ("127.0.0.1", "localhost"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"背题助手已启动：{url}")
    if not lykie_accounts.has_users():
        print("尚未创建账号，请先运行：python add_user.py 用户名")
    else:
        print("已有账号：请打开页面登录。" + " / ".join(lykie_accounts.list_usernames()))
    try:
        from waitress import serve
        print(f"Waitress 监听 {host}:{port}")
        serve(app, host=host, port=port, threads=2, ident="Lykie")
    except ImportError:
        app.run(host=host, port=port, debug=False)
