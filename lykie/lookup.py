# -*- coding: utf-8 -*-
"""按思考 need 摘材料：课表/题面/档案块。程序 if，不用 function calling。"""
from __future__ import annotations

import re
from datetime import datetime

from .profile import load_self_profile

_WEEKDAYS = "一二三四五六日"
_DAY_KEYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")

# 档案【课表】节次
PERIODS = (
    (1, 8, 0, 8, 50),
    (2, 9, 0, 9, 50),
    (3, 10, 10, 11, 0),
    (4, 11, 10, 12, 0),
    (5, 14, 0, 14, 50),
    (6, 15, 0, 15, 50),
    (7, 16, 10, 17, 0),
    (8, 17, 10, 18, 0),
)

_HEADER_RE = re.compile(r"^【([^】]+)】\s*$", re.MULTILINE)
_SLOT_RE = re.compile(r"(?:^|[；;])\s*(\d)(?:\s*[-–~至到]\s*(\d))?\s+([^；;]+)")
_PERIOD_LINE_RE = re.compile(
    r"节次[：:]\s*(.+?)(?:。|$)",
)

# 思考点的话题 → 档案标题关键词
_TOPIC_HINTS = (
    (("课表", "timetable", "课", "上课", "几点", "有没有课"), "课表"),
    (("开学", "校园卡", "军训", "新生"), "开学"),
    (("怕水", "害怕", "怕", "海", "游泳"), "害怕"),
    (("日程", "习惯", "在干嘛", "作业", "晚上"), "近期日程"),
    (("喜欢", "歌", "吃", "狗", "猫", "面"), "喜欢"),
    (("游戏", "泰拉", "王者", "娱乐"), "游戏"),
    (("家庭", "父母", "家里"), "家庭"),
    (("性情", "社恐", "分享"), "性情"),
    (("志向", "当ai", "当 ai", "专业", "学籍", "学校", "复读", "班长", "岁数", "钉死"), "已经钉死"),
    (("裂缝", "万事通", "人工"), "已经钉死"),
    (("基本", "介绍"), "已经钉死"),
)


def occupancy_flag(now=None, archive=None) -> str:
    """busy 在课；study 19–23；late 23 点后（含凌晨）；其余 free。不编行程。"""
    now = now or datetime.now()
    if _in_class(now, archive):
        return "busy"
    hour = now.hour
    if hour >= 23 or hour < 5:
        return "late"
    if 19 <= hour < 23:
        return "study"
    return "free"


def occupancy_label(flag: str) -> str:
    return {
        "busy": "在上课（程序按课表节次标的，不要另排一天）",
        "study": "晚上写作业时段（19–23，程序标的）",
        "late": "很晚了（23 点后，程序标的）",
        "free": "现在不在课上（程序标的）",
    }.get(flag or "", "时段未标")


def current_period_no(now=None):
    now = now or datetime.now()
    t = now.hour * 60 + now.minute
    for n, h1, m1, h2, m2 in PERIODS:
        if h1 * 60 + m1 <= t <= h2 * 60 + m2:
            return n
    return None


def split_profile_sections(raw=None) -> dict:
    text = (raw if raw is not None else load_self_profile()) or ""
    if not text.strip():
        return {}
    matches = list(_HEADER_RE.finditer(text))
    out = {}
    if not matches:
        out["（全文）"] = text.strip()
        return out
    pre = text[: matches[0].start()].strip()
    if pre:
        out["（开头）"] = pre
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[title] = text[start:end].strip()
    return out


def slice_profile(topics, raw=None) -> list:
    """按点名标题摘块。禁止全部。每项 {title, text, empty}。"""
    sections = split_profile_sections(raw)
    picked = []
    seen = set()
    for topic in topics or []:
        t = str(topic or "").strip()
        if not t or t in ("全部", "all", "整份", "全文"):
            continue
        title = _match_section_title(t, sections)
        if not title or title in seen:
            if not title:
                picked.append({"title": t, "text": "", "empty": True})
            continue
        seen.add(title)
        body = (sections.get(title) or "").strip()
        picked.append({"title": title, "text": body, "empty": not body})
        if len(picked) >= 3:
            break
    return picked


def timetable_slice(now=None, raw=None) -> dict:
    """课表里与今天/此刻相关的几行 + 现成时间块。"""
    from .llm import format_now_block

    now = now or datetime.now()
    sections = split_profile_sections(raw)
    table = ""
    for k, v in sections.items():
        if "课表" in k:
            table = v
            break
    day_key = _DAY_KEYS[now.weekday()] if now.weekday() < 7 else "周日"
    day_line = _day_line(table, day_key)
    period_line = ""
    m = _PERIOD_LINE_RE.search(table.replace("\n", " "))
    if m:
        period_line = "节次：" + m.group(1).strip()
    period_no = current_period_no(now)
    occ = occupancy_flag(now, raw)
    bits = [format_now_block(now), f"程序忙闲：{occ}（{occupancy_label(occ)}）"]
    if period_line:
        bits.append(period_line)
    if day_line:
        bits.append(f"今天（{day_key}）：{day_line}")
    elif table:
        bits.append(f"今天（{day_key}）课表行未找到。")
    if period_no:
        bits.append(f"此刻节次：第{period_no}节")
    else:
        bits.append("此刻不在档案所列的 1–8 节时间内。")
    empty = not bool(table.strip())
    return {"text": "\n".join(bits), "empty": empty, "day_line": day_line, "period_no": period_no}


def format_question_stem_md(card) -> str:
    """用户气泡 / chat_tail 用的题面，永不带解析。"""
    if not isinstance(card, dict):
        return ""
    stem = str(card.get("stem") or "").strip()
    if not stem:
        return ""
    lines = ["（题）", stem]
    opts = card.get("options") or []
    for i, o in enumerate(opts):
        t = str(o or "").strip()
        if not t:
            continue
        if re.match(r"^[A-Ha-h][.．、\)]", t):
            lines.append(t)
        else:
            lines.append(f"{chr(65 + i)}. {t}")
    return "\n".join(lines)


def parse_question_stem_md(text) -> dict | None:
    """从用户气泡的题面 Markdown 还原卡（无解析）。"""
    raw = str(text or "").strip()
    if not raw.startswith("（题）"):
        return None
    lines = [ln.strip() for ln in raw.replace("\r", "").split("\n") if ln.strip()]
    if len(lines) < 2:
        return None
    stem_parts = []
    opts = []
    for ln in lines[1:]:
        if re.match(r"^[A-Ha-h][.．、)]\s*", ln):
            opts.append(ln)
        elif opts:
            opts[-1] = opts[-1] + ln
        else:
            stem_parts.append(ln)
    stem = "\n".join(stem_parts).strip()
    if not stem:
        return None
    return sanitize_question_card({"id": "", "type": "", "stem": stem, "options": opts})


def sanitize_question_card(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    stem = str(raw.get("stem") or "").strip()
    qid = str(raw.get("id") or "").strip()
    if not stem and not qid:
        return None
    opts = raw.get("options") or []
    if not isinstance(opts, list):
        opts = []
    return {
        "id": qid,
        "type": str(raw.get("type") or "").strip(),
        "stem": stem,
        "options": [str(x) for x in opts if str(x or "").strip()],
    }


def find_bank_question(store, qid):
    if not qid or store is None:
        return None
    key = str(qid)
    for bank in getattr(store, "banks", None) or []:
        for q in bank.get("questions") or []:
            if str(q.get("id") or "") == key:
                return q
    return None


def find_bank_question_by_stem(store, stem):
    key = str(stem or "").strip()
    if not key or store is None:
        return None
    for bank in getattr(store, "banks", None) or []:
        for q in bank.get("questions") or []:
            if str(q.get("stem") or "").strip() == key:
                return q
    return None


def question_material(card, store=None, include_analysis=False) -> dict:
    """
    开口用题面。teach 才从题库另取解析。
    返回 {text, empty, has_analysis}。
    """
    card = sanitize_question_card(card)
    if not card:
        return {"text": "", "empty": True, "has_analysis": False}
    bank_q = None
    if store is not None:
        bank_q = find_bank_question(store, card.get("id"))
        if not bank_q:
            bank_q = find_bank_question_by_stem(store, card.get("stem"))
    stem = card.get("stem") or (bank_q.get("stem") if bank_q else "")
    opts = card.get("options") or []
    if not opts and bank_q:
        opts = bank_q.get("options") or []
    qtype = card.get("type") or ((bank_q or {}).get("type") or "")
    lines = [f"题型：{qtype}".rstrip("："), f"题干：{stem}"]
    if opts:
        lines.append("选项：")
        for o in opts:
            lines.append(f"  {o}")
    has_analysis = False
    if include_analysis and bank_q:
        ans = bank_q.get("answer") or bank_q.get("answer_text") or bank_q.get("reference_answer")
        analysis = str(bank_q.get("analysis") or "").strip()
        if ans:
            lines.append(f"参考答案：{ans}")
            has_analysis = True
        if analysis:
            lines.append(f"题库解析：{analysis}")
            has_analysis = True
        kws = bank_q.get("keywords") or []
        if kws:
            lines.append("关键词：" + "、".join(str(k) for k in kws if k))
    elif not include_analysis:
        lines.append("不要交付解析或标准答案。题面可以看见，当她把题发给你看，不要当讲解任务。")
    text = "\n".join(lines)
    return {"text": text, "empty": not bool(stem), "has_analysis": has_analysis}


def run_lookup(need, profile_topics, *, occupancy, question_card=None, store=None, action="thin", now=None):
    """
    按 need 取最多两样。返回 {items, speak_block, empty_topics}。
    items 供测试面板：[{need, empty, title, preview}]
    """
    now = now or datetime.now()
    wants = _normalize_need(need)
    items = []
    blocks = []
    empty_topics = []

    for kind in wants:
        if kind == "timetable":
            sliced = timetable_slice(now)
            empty = bool(sliced.get("empty"))
            items.append({
                "need": "timetable",
                "empty": empty,
                "title": "课表",
                "preview": (sliced.get("day_line") or "")[:80],
            })
            if empty:
                empty_topics.append("课表")
                blocks.append("【课表】档案里没有可用课表。不要现编她今天上什么。含糊或不答。")
            else:
                blocks.append("【课表与此刻】\n" + sliced["text"])
        elif kind == "question":
            teach = action == "teach" and question_card is not None
            mat = question_material(question_card, store=store, include_analysis=teach)
            empty = bool(mat.get("empty")) or question_card is None
            items.append({
                "need": "question",
                "empty": empty,
                "title": "题面",
                "preview": "有解析" if mat.get("has_analysis") else ("仅题面" if not empty else "无"),
            })
            if empty:
                empty_topics.append("题面")
                blocks.append("【题】本轮用户没有把题送进对话。你看不见当前刷题卡。不要假装在看题。")
            else:
                head = "【本轮题面】"
                if teach:
                    head += "（她肯讲：可参考答案；不会就支吾，不要硬念解析装会）"
                else:
                    head += "（不要交付解析）"
                blocks.append(head + "\n" + mat["text"])
        elif kind == "profile":
            picked = slice_profile(profile_topics)
            if not picked:
                items.append({
                    "need": "profile",
                    "empty": True,
                    "title": "档案",
                    "preview": "未点名或点了全部",
                })
                empty_topics.append("档案（未点名）")
                blocks.append("【档案】思考没点名具体块，或点了「全部」。开口不要用整份档案，私事含糊或不答。")
            else:
                for p in picked:
                    items.append({
                        "need": "profile",
                        "empty": p["empty"],
                        "title": p["title"],
                        "preview": (p["text"] or "")[:80],
                    })
                    if p["empty"]:
                        empty_topics.append(p["title"])
                        blocks.append(f"【档案·{p['title']}】没有这一块。不要现编。含糊或不答。")
                    else:
                        blocks.append(f"【档案·{p['title']}】\n{p['text']}")

    if occupancy:
        # 忙闲始终给开口一小句，即使 need=none（思考可在 why 里用，开口也要知道能不能说上课）
        pass

    speak_block = "\n\n".join(blocks).strip()
    return {
        "items": items,
        "speak_block": speak_block,
        "empty_topics": empty_topics,
        "occupancy": occupancy,
    }


def lookup_fill_notes(lookup_result, strict=True):
    """查空 → 面板请补全。不再靠开口 %%档案。"""
    if not strict:
        return []
    notes = []
    seen = set()
    for it in (lookup_result or {}).get("items") or []:
        if not it.get("empty"):
            continue
        if it.get("need") not in ("profile", "timetable"):
            continue
        title = str(it.get("title") or it.get("need") or "").strip()
        if not title or title in seen:
            continue
        seen.add(title)
        notes.append({
            "kind": "fill",
            "text": f"请补全 lykie/self.txt（补完再说一遍即可）\n· {title}",
        })
    return notes


def _normalize_need(need) -> list:
    if need is None:
        return []
    if isinstance(need, str):
        parts = re.split(r"[,，/|、\s]+", need)
    elif isinstance(need, (list, tuple)):
        parts = list(need)
    else:
        parts = [str(need)]
    allowed = ("timetable", "question", "profile")
    out = []
    for p in parts:
        k = str(p or "").strip().lower()
        if k in ("none", "无", "没有", ""):
            continue
        if k in ("all", "全部"):
            continue
        if k in allowed and k not in out:
            out.append(k)
        if len(out) >= 2:
            break
    return out


def _match_section_title(topic, sections) -> str | None:
    t = (topic or "").strip()
    if not t:
        return None
    tl = t.lower().replace(" ", "")
    for keys, hint in _TOPIC_HINTS:
        if any(k.replace(" ", "") in tl or tl in k.replace(" ", "") for k in keys):
            for title in sections:
                if hint in title:
                    return title
    for title in sections:
        if t in title or title in t:
            return title
    return None


def _day_line(table, day_key) -> str:
    for line in (table or "").splitlines():
        s = line.strip().lstrip("-").strip()
        if s.startswith(day_key):
            if "：" in s:
                return s.split("：", 1)[-1].strip()
            if ":" in s:
                return s.split(":", 1)[-1].strip()
            return s
    return ""


def _in_class(now, archive=None) -> bool:
    if now.weekday() >= 5:
        return False
    period = current_period_no(now)
    if not period:
        return False
    sections = split_profile_sections(archive)
    table = ""
    for k, v in sections.items():
        if "课表" in k:
            table = v
            break
    if not table:
        return False
    day_key = _DAY_KEYS[now.weekday()]
    day = _day_line(table, day_key)
    if not day:
        return False
    for m in _SLOT_RE.finditer("；" + day):
        a = int(m.group(1))
        b = int(m.group(2) or m.group(1))
        label = (m.group(3) or "").strip()
        if "无" in label[:4]:
            continue
        if a <= period <= b:
            return True
    return False
