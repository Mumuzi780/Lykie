# -*- coding: utf-8 -*-
"""背题助手后端：多题库管理，间隔重复抽背，支持编辑题目、斩题、正确率统计。"""
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
from lykie import extract as lykie_extract
from lykie import llm as lykie_llm
from lykie import memory as lykie_memory
from lykie import profile as lykie_profile
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
app.jinja_env.auto_reload = True

LETTERS = "ABCDEFGH"


# ==================== 解析器 ====================
OPTION_RE = re.compile(r"^[^A-Ha-h0-9\u4e00-\u9fff]*([A-H])[.、．:：\s]+(.*)$")
ANSWER_RE = re.compile(r"^(?:参考答案|标准答案|答案)[:：\s]*(.*)$")
NUM_RE = re.compile(r"^(\d+)[.、．\s:：]*\s*(.*)$")
BULLET_RE = re.compile(r"[\u2022\u2023\u2043\u25cf\u25cb\u25e6\u25aa\u00b7\u2219\u2027]")

JUDGE_TRUE = {"对", "正确", "√", "t", "true", "是", "right", "yes"}
JUDGE_FALSE = {"错", "错误", "×", "f", "false", "否", "wrong", "no"}


def is_judge_answer(ans):
    a = ans.strip().lower()
    return a in JUDGE_TRUE or a in JUDGE_FALSE


def split_answer_analysis(full):
    """把 'C (解析内容)' 拆分成 (答案, 解析)。无括号解析时解析为空字符串。"""
    full = full.strip()
    m = re.match(r"^(.*?)\s*[（(](.*)[)）]\s*$", full)
    if m and m.group(1).strip():
        return m.group(1).strip(), m.group(2).strip()
    return full, ""


def normalize_choice_content(ans, options):
    """把选择题答案统一成选项内容文本，例如 'A' / 'A. 数据总线' -> '数据总线'。"""
    a = ans.strip()
    m = re.match(r"^([A-H])$", a.upper())
    if m:
        idx = ord(m.group(1)) - ord("A")
        if 0 <= idx < len(options):
            return options[idx]
        return a
    m2 = re.match(r"^[A-H][.、．\s]+(.*)$", a)
    if m2:
        return m2.group(1).strip()
    return a


def parse_lines(raw):
    """解析行列表（每行已是 strip 后的非空文本），返回题目列表。"""
    questions = []
    cur = None

    def push():
        nonlocal cur
        if cur and cur["stem"]:
            questions.append(cur)
        cur = None

    for line in raw:
        am = ANSWER_RE.match(line)
        if am:
            if cur:
                ans, ana = split_answer_analysis(am.group(1))
                cur["answer"] = ans
                cur["analysis"] = ana
            continue
        if cur:
            om = OPTION_RE.match(line)
            if om:
                cur["options"].append(om.group(2).strip())  # 存选项内容（不含字母）
                continue
        nm = NUM_RE.match(line)
        if nm:
            push()
            cur = {"num": nm.group(1), "stem": nm.group(2), "options": [], "answer": "", "analysis": ""}
            continue
        if cur:
            cur["stem"] = (cur["stem"] + line).strip()
    push()

    result = []
    for q in questions:
        if not q.get("answer", "").strip():
            continue  # 无答案的题（章节标题、格式错误行等），不添加
        if q["options"]:
            qtype = "choice"
        elif is_judge_answer(q["answer"]):
            qtype = "judge"
        else:
            qtype = "fill"

        if qtype == "choice":
            q["answer"] = normalize_choice_content(q["answer"], q["options"])
        elif qtype == "judge":
            q["answer"] = "对" if q["answer"].strip().lower() in JUDGE_TRUE else "错"

        q["id"] = str(len(result) + 1)
        q["type"] = qtype
        q["status"] = "active"      # active / killed
        q["phase"] = "new"          # new / right / wrong
        q["interval"] = 0
        q["countdown"] = 0
        q["streak"] = 0
        q["answer_count"] = 0       # 作答次数
        q["correct_count"] = 0      # 答对次数
        result.append(q)

    return result


def parse_docx(path):
    doc = Document(path)
    raw = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return parse_lines(raw)


def parse_text(text):
    # 从 Word 复制项目符号列表会带上 bullet 符号，还原成换行再切分
    text = BULLET_RE.sub("\n", text)
    raw = [line.strip() for line in text.splitlines() if line.strip()]
    return parse_lines(raw)


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
        for b in self.banks:
            for q in b.get("questions", []):
                ensure_question_defaults(q)
        if lykie_sa.ensure_bank_modes(self.banks):
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
                {"banks": self.banks, "current_bank_id": self.current_bank_id},
                f,
                ensure_ascii=False,
                indent=2,
            )

    def current_bank(self):
        return next((b for b in self.banks if b["id"] == self.current_bank_id), None)


def current_user():
    return session.get("username") or ""


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
        return redirect(url_for("index"))
    error = ""
    if request.method == "POST":
        username = request.form.get("username") or ""
        password = request.form.get("password") or ""
        if lykie_accounts.verify_user(username, password):
            session.clear()
            session.permanent = True
            session["username"] = lykie_accounts.normalize_username(username)
            return redirect(url_for("index"))
        if not lykie_accounts.has_users():
            error = "还没有账号。先在电脑运行：python add_user.py 用户名"
        else:
            error = "用户名或密码不对"
    return render_template("login.html", error=error, has_users=lykie_accounts.has_users())


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def find_question(bank, qid):
    return next((q for q in bank["questions"] if q["id"] == qid), None)


def render_question(q):
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
            return out
        if q["phase"] == "right":
            order = random.sample(contents, len(contents))  # 答对队列：打乱
        else:
            order = contents[:]                              # 新题 / 答错队列：原顺序
        out["options"] = [f"{LETTERS[i]}.{order[i]}" for i in range(len(order))]
        idx = order.index(q["answer"]) if q["answer"] in order else 0
        out["answer"] = LETTERS[idx]
        out["answer_text"] = f"{LETTERS[idx]}.{order[idx]}"
    elif q["type"] == "judge":
        out["options"] = ["对", "错"]
        out["answer"] = q["answer"]
        out["answer_text"] = q["answer"]
    else:  # fill
        out["options"] = []
        out["answer"] = q["answer"]
        out["answer_text"] = q["answer"]
    return out


# ==================== 路由 ====================
@app.route("/")
def index():
    return render_template("index.html", username=g.store.username)


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
    return jsonify({
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
        return jsonify({
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
    return jsonify(card)


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
        })
    return jsonify({"banks": result, "current_bank_id": g.store.current_bank_id})


@app.route("/api/status")
def api_status():
    b = g.store.current_bank()
    if not b:
        return jsonify({
            "total": 0, "killed": 0, "active": 0, "types": {}, "name": None,
            "is_sa": False, "mode": None,
        })
    qs = b["questions"]
    total = len(qs)
    killed = sum(1 for q in qs if q.get("status") == "killed")
    types = {}
    for q in qs:
        types[q["type"]] = types.get(q["type"], 0) + 1
    is_sa = lykie_sa.is_sa_bank(b)
    return jsonify({
        "total": total,
        "killed": killed,
        "active": total - killed,
        "types": types,
        "name": b.get("name"),
        "is_sa": is_sa,
        "mode": b.get("mode") or ("short_answer" if is_sa else "objective"),
    })


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

    fd, tmp = tempfile.mkstemp(suffix=".docx")
    os.close(fd)
    f.save(tmp)
    try:
        questions = parse_docx(tmp)
    except Exception as e:
        return jsonify({"ok": False, "error": f"解析失败：{e}"}), 400
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    if not questions:
        return jsonify({"ok": False, "error": "没有解析出题目，请检查文档格式"}), 400

    b = {
        "id": new_bank_id(),
        "name": os.path.splitext(filename)[0] or filename,
        "imported_at": now_str(),
        "questions": questions,
    }
    g.store.banks.append(b)
    g.store.current_bank_id = b["id"]
    g.store.save()
    return jsonify({"ok": True, "total": len(questions), "bank_id": b["id"]})


@app.route("/api/import_text", methods=["POST"])
def api_import_text():
    data = request.get_json(force=True)
    text = str(data.get("text", ""))
    name = str(data.get("name", "")).strip() or "粘贴导入"
    preview = bool(data.get("preview", False))

    if not text.strip():
        return jsonify({"ok": False, "error": "文本为空"}), 400

    try:
        questions = parse_text(text)
    except Exception as e:
        return jsonify({"ok": False, "error": f"解析失败：{e}"}), 400

    if not questions:
        return jsonify({"ok": False, "error": "没有解析出题目，请检查文本格式"}), 400

    if preview:
        preview_data = []
        for q in questions:
            preview_data.append({
                "type": q["type"],
                "stem": q["stem"],
                "options": q.get("options", []),
                "answer": q["answer"],
                "analysis": q.get("analysis", ""),
            })
        return jsonify({"ok": True, "preview": True, "total": len(questions), "questions": preview_data})

    b = {"id": new_bank_id(), "name": name, "imported_at": now_str(), "questions": questions}
    g.store.banks.append(b)
    g.store.current_bank_id = b["id"]
    g.store.save()
    return jsonify({"ok": True, "total": len(questions), "bank_id": b["id"]})


@app.route("/api/next")
def api_next():
    b = g.store.current_bank()
    if not b:
        return jsonify({"question": None, "reason": "empty"})
    active = [
        q for q in b["questions"]
        if q.get("status") != "killed" and q.get("type") != "short_answer"
    ]
    if not active:
        return jsonify({"question": None, "reason": "done"})

    due = [q for q in active if q["countdown"] == 0]
    chosen = random.choice(due) if due else min(active, key=lambda x: x["countdown"])

    # 抽走一题后，其余题目的间隔倒计时 -1（countdown 表示还需隔几道题）
    for q in active:
        if q is not chosen:
            q["countdown"] = max(0, q["countdown"] - 1)

    g.store.save()
    return jsonify({"question": render_question(chosen), "reason": "ok"})


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
    q["answer_count"] = q.get("answer_count", 0) + 1
    if correct:
        q["correct_count"] = q.get("correct_count", 0) + 1

    if correct:
        q["streak"] = q.get("streak", 0) + 1
        q["interval"] = 8 * (2 ** (q["streak"] - 1))  # 8, 16, 32, ...
        q["countdown"] = q["interval"]
        q["phase"] = "right"
    else:
        q["streak"] = 0
        q["interval"] = 5
        q["countdown"] = 5
        q["phase"] = "wrong"
    g.store.save()
    return jsonify({"ok": True})


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
    data = request.get_json(force=True)
    q = find_question(b, str(data.get("id", "")))
    if not q:
        return jsonify({"ok": False, "error": "题目不存在"}), 404
    q["status"] = "killed"
    g.store.save()
    return jsonify({"ok": True})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    b = g.store.current_bank()
    if not b:
        return jsonify({"ok": False, "error": "无当前题库"}), 404
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
        "fact_count": len(state.get("facts") or []),
        "style_note_count": len(state.get("style_notes") or []),
        "correction_count": len(state.get("corrections") or []),
        "flags": flags,
        "story_pending": not bool(flags.get("fragment_01_done")),
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


@app.route("/api/lykie/chat_reset_opening", methods=["POST"])
def api_lykie_chat_reset_opening():
    """清 chat_tail / 面板到开场结束；保留 facts、监督、flags。"""
    state = lykie_memory.load_state(g.store.lykie_path)
    if not (state.get("flags") or {}).get("fragment_01_done"):
        return jsonify({"ok": False, "error": "开场尚未完成，无法清到开场后"}), 400
    panel = lykie_memory.reset_chat_to_opening_end(state)
    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({"ok": True, "panel_log": panel})


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
    question = data.get("question")
    if question is not None and not isinstance(question, dict):
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

    if mode == "explain":
        if not question or not str(question.get("stem") or "").strip():
            return jsonify({"ok": False, "error": "当前没有可讲解的题目"}), 400
        if not message:
            message = "这题给我讲讲？"
            batch = [message]
    elif not batch:
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
                "style_notes_added": [],
            })

    if mode == "chat":
        prompt_user = lykie_llm.format_chat_user_batch(batch)
    else:
        prompt_user = message

    messages = lykie_llm.build_messages(
        state, prompt_user, mode=mode, question=question, last_reply=last_reply
    )

    try:
        reply = lykie_llm.chat_completion(messages)
    except Exception as e:
        return jsonify({"ok": False, "error": f"模型调用失败：{e}"}), 502

    profile_notes = []
    profile_fill = False
    strict = lykie_profile.is_profile_strict()
    if mode == "chat":
        meta = lykie_profile.parse_archive_meta(reply)
        reply = meta["reply"]
        profile_notes = lykie_profile.format_profile_notices(meta, strict)
        profile_fill = bool(meta.get("fill")) or any(
            n.get("kind") == "fill" for n in profile_notes
        )

    silent = False
    if mode == "chat" and lykie_llm.is_silence_reply(reply):
        silent = True
        reply = "[不回复]"
    elif not reply:
        if mode == "chat" and profile_fill:
            silent = True
            reply = "[不回复]"
        else:
            reply = "嗯.....那个...."

    if mode == "explain":
        for m in batch:
            lykie_memory.append_chat(state, "user", f"[问问Lykie] {m}")
        lykie_memory.append_chat(state, "assistant", reply)
    elif mode == "correct":
        for m in batch:
            lykie_memory.append_chat(state, "user", f"[纠正] {m}")
        lykie_memory.append_chat(state, "assistant", reply)
    else:
        for m in batch:
            lykie_memory.append_chat(state, "user", m)
        # 沉默也写入尾迹；档案请补全且没说话时不写 assistant，避免学成「先不回」
        if not (profile_fill and silent):
            lykie_memory.append_chat(state, "assistant", reply)

    facts_added = []
    style_notes_added = []
    joined_user = "\n".join(batch)

    if mode == "correct" or (mode == "chat" and lykie_extract.looks_like_correction(joined_user)):
        try:
            raw_notes = lykie_extract.extract_style_notes(
                joined_user, last_reply, lykie_llm.chat_completion
            )
            style_notes_added = lykie_memory.add_style_notes(state, raw_notes)
        except Exception:
            style_notes_added = []

    if mode == "chat" and not any(lykie_extract.is_explicit_correction(m) for m in batch):
        try:
            raw_facts = lykie_extract.extract_facts_from_utterance(
                joined_user, lykie_llm.chat_completion
            )
            facts_added = lykie_memory.add_facts(state, raw_facts)
        except Exception:
            facts_added = []

    if mode == "explain" and question and question.get("id"):
        unsure_marks = ("不会", "不确定", "那个", "星球", "一定是这样")
        if any(m in reply for m in unsure_marks):
            lykie_memory.mark_unknown_question(state, question.get("id"))

    if mode == "explain":
        state.setdefault("flags", {})["first_explain_done"] = True

    lykie_memory.save_state(g.store.lykie_path, state)
    return jsonify({
        "ok": True,
        "reply": "" if silent else reply,
        "silent": silent,
        "facts_added": facts_added,
        "style_notes_added": style_notes_added,
        "profile_fill": profile_fill,
        "profile_notes": profile_notes,
        "profile_strict": strict if mode == "chat" else False,
    })


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
