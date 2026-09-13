# -*- coding: utf-8 -*-
"""单题成题规则：题块 → 可入库题目。

流水线位置：
  噪声过滤（import_noise）→ 切块（样板 / legacy 题号）→ **本模块成题** → 预览入库

职责：
  - 标准答案行「答案：C」、解析行「解析：…」
  - 非标准答案 → needs_answer_confirm（不猜字母）
  - 从单题行列表抽出题干 / 选项 / 答案 / 解析

不负责多题怎么切开；切刀在 import_exemplar 或 legacy 题号逻辑。
"""
from __future__ import annotations

import re

OPTION_INLINE_RE = re.compile(r"^[^A-Ha-h0-9\u4e00-\u9fff]*([A-H])[.、．:：\s]+(.+)$")
OPTION_LETTER_RE = re.compile(r"^([A-H])[.、．:：]?\s*$", re.I)
# 排除「7.3 总线接口」类章节号，避免当成第 7 题
NUM_RE = re.compile(
    r"^(?!\d+\.\d+)"
    r"(\d+)(?:[.、．\s:：]+|(?=[\u4e00-\u9fffA-Za-z（(]))\s*(.*)$"
)
TYPE_TAG_RE = re.compile(
    r"^[（(]\s*(单选题|多选题|判断题|填空题|简答题|选择题)\s*[)）]"
)
ANSWER_LABELS = ("参考答案", "标准答案", "正确答案", "答案")
ANALYSIS_LABELS = ("答案解析", "题目解析", "解析", "分析")
STANDARD_ANSWER_RE = re.compile(r"^([A-Ha-h])[.、．。]?\s*$")

JUDGE_TRUE = {"对", "正确", "√", "t", "true", "是", "right", "yes"}
JUDGE_FALSE = {"错", "错误", "×", "f", "false", "否", "wrong", "no"}


def is_type_tag_line(line: str) -> bool:
    return bool(TYPE_TAG_RE.match(line or ""))


def is_judge_answer(ans: str) -> bool:
    a = (ans or "").strip().lower()
    return a in JUDGE_TRUE or a in JUDGE_FALSE


def label_candidates(preferred: str) -> list[str]:
    labels = [preferred] + [x for x in ANSWER_LABELS if x != preferred]
    return sorted(set(labels), key=len, reverse=True)


def detect_answer_label(lines: list[str]) -> str:
    for line in lines:
        for lab in sorted(ANSWER_LABELS, key=len, reverse=True):
            if re.search(rf"{re.escape(lab)}\s*[:：]", line or ""):
                return lab
    return "答案"


def match_answer_rest(line: str, preferred_label: str = "答案") -> str | None:
    """含「答案：」类标签（冒号必填）→ 返回 rest；否则 None。"""
    for lab in label_candidates(preferred_label):
        m = re.search(rf"{re.escape(lab)}\s*[:：]\s*(.*)$", line or "")
        if m:
            return (m.group(1) or "").strip()
    return None


def standard_letter(rest: str) -> str | None:
    m = STANDARD_ANSWER_RE.match((rest or "").strip())
    if not m:
        return None
    return m.group(1).upper()


def parse_answer_rest(rest: str) -> tuple[str, bool, str]:
    """标准短答案 → (字母, False, raw)；非标准 → ('', True, raw)。"""
    raw = (rest or "").strip()
    letter = standard_letter(raw)
    if letter:
        return letter, False, raw
    return "", True, raw


def answer_line_info(line: str, preferred_label: str = "答案") -> dict | None:
    """
    None = 非答案行；
    否则 {"standard": bool, "answer": str, "raw": str}。
    """
    rest = match_answer_rest(line, preferred_label)
    if rest is None:
        return None
    letter = standard_letter(rest)
    if letter:
        return {"standard": True, "answer": letter, "raw": rest}
    return {"standard": False, "answer": "", "raw": rest}


def analysis_line_text(line: str) -> str | None:
    """标准解析行正文；不从括号抽。"""
    s = (line or "").strip()
    for lab in sorted(ANALYSIS_LABELS, key=len, reverse=True):
        m = re.match(rf"^{re.escape(lab)}\s*[:：]\s*(.*)$", s)
        if m:
            return (m.group(1) or "").strip()
    return None


def normalize_choice_content(ans: str, options: list[str]) -> str:
    a = (ans or "").strip()
    m = re.match(r"^([A-H])$", a.upper())
    if m:
        idx = ord(m.group(1)) - ord("A")
        if 0 <= idx < len(options):
            return options[idx]
        return a
    m2 = re.match(r"^[A-H][.、．\s]+(.*)$", a, re.I)
    if m2:
        return m2.group(1).strip()
    return a


def normalize_choice_answer(ans: str, options: list[str]) -> str:
    raw = (ans or "").strip()
    if not raw or not options:
        return raw
    compact = re.sub(r"[\s,，、/;；+＋]+", "", raw.upper())
    compact = re.sub(r"^(?:参考答案|标准答案|正确答案|答案)", "", compact)
    if re.fullmatch(r"[A-H]{2,8}", compact):
        letters = []
        for c in compact:
            idx = ord(c) - ord("A")
            if 0 <= idx < len(options) and c not in letters:
                letters.append(c)
        letters.sort()
        if len(letters) >= 2:
            return "".join(letters)
        if len(letters) == 1:
            return options[ord(letters[0]) - ord("A")]
    return normalize_choice_content(raw, options)


def detect_option_style(lines: list[str]) -> str:
    stacked = 0
    inline = 0
    for i, line in enumerate(lines):
        if OPTION_INLINE_RE.match(line):
            inline += 1
        elif OPTION_LETTER_RE.match(line):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if nxt and not OPTION_LETTER_RE.match(nxt) and not OPTION_INLINE_RE.match(nxt):
                if answer_line_info(nxt, "答案") is None and analysis_line_text(nxt) is None:
                    stacked += 1
    if stacked >= inline and stacked > 0:
        return "stacked"
    return "inline"


def attach_question_defaults(q: dict, seq: int) -> dict:
    q = dict(q)
    q["id"] = str(seq)
    q.setdefault("status", "active")
    q.setdefault("phase", "new")
    q.setdefault("interval", 0)
    q.setdefault("countdown", 0)
    q.setdefault("streak", 0)
    q.setdefault("answer_count", 0)
    q.setdefault("correct_count", 0)
    return q


def shape_choice_block(
    block: list[str],
    *,
    option_style: str = "inline",
    answer_label: str = "答案",
    allow_multi: bool = False,
) -> dict | None:
    """单题块 → 选择题字典；凑不齐返回 None。"""
    if not block:
        return None

    lines = list(block)
    num = ""
    while lines and is_type_tag_line(lines[0]):
        lines = lines[1:]
    if not lines:
        return None

    nm = NUM_RE.match(lines[0])
    if nm:
        num = nm.group(1)
        stem_parts = [nm.group(2).strip()] if nm.group(2).strip() else []
        body = lines[1:]
    else:
        stem_parts = []
        body = lines

    options: list[str] = []
    answer = ""
    analysis = ""
    needs_confirm = False
    answer_line_raw = ""
    saw_answer_line = False
    phase = "stem"
    pending_letter = None

    for line in body:
        ana = analysis_line_text(line)
        if ana is not None:
            if pending_letter is not None:
                pending_letter = None
            analysis = ana if not analysis else (analysis + " " + ana).strip()
            continue

        found = answer_line_info(line, answer_label)
        if found is not None:
            if pending_letter is not None:
                pending_letter = None
            saw_answer_line = True
            answer_line_raw = found.get("raw") or ""
            if found.get("standard") and found.get("answer"):
                answer = found["answer"]
                needs_confirm = False
            else:
                answer = ""
                needs_confirm = True
            phase = "done"
            continue

        if option_style == "stacked":
            lm = OPTION_LETTER_RE.match(line)
            if lm:
                if pending_letter is not None:
                    options.append("")
                pending_letter = lm.group(1).upper()
                phase = "options"
                continue
            if pending_letter is not None:
                options.append(line.strip())
                pending_letter = None
                phase = "options"
                continue
            if phase == "stem":
                stem_parts.append(line)
            elif phase == "options" and options:
                options[-1] = (options[-1] + " " + line).strip()
            continue

        om = OPTION_INLINE_RE.match(line)
        if om:
            options.append(om.group(2).strip())
            phase = "options"
            continue
        if phase == "stem":
            stem_parts.append(line)
        elif phase == "options" and options:
            options[-1] = (options[-1] + " " + line).strip()

    if pending_letter is not None:
        return None

    options = [o for o in options if str(o).strip()]
    stem = " ".join(p for p in stem_parts if p).strip()
    if not stem or len(options) < 2 or not saw_answer_line:
        return None

    if answer:
        compact = re.sub(r"[\s,，、/;；+＋]+", "", str(answer).upper())
        if re.fullmatch(r"[A-H]{2,8}", compact) and len(set(compact)) >= 2:
            if not allow_multi:
                return None
        norm = normalize_choice_answer(answer, options)
    else:
        norm = ""

    out = {
        "num": num or "",
        "stem": stem,
        "options": options,
        "answer": norm,
        "analysis": analysis or "",
        "type": "choice",
    }
    if needs_confirm or not str(norm).strip():
        out["needs_answer_confirm"] = True
        out["answer"] = ""
        if answer_line_raw:
            out["answer_line_raw"] = answer_line_raw
    return out


def shape_non_choice_block(
    block: list[str],
    *,
    answer_label: str = "答案",
    expect_type: str | None = None,
) -> dict | None:
    """无选项题块 → 判断 / 填空。支持题号或无题号（微标后直接题干）。"""
    if not block:
        return None
    lines = [ln for ln in block if not is_type_tag_line(ln)]
    if not lines:
        return None

    num = ""
    nm = NUM_RE.match(lines[0])
    if nm:
        num = nm.group(1)
        stem_parts = [nm.group(2).strip()] if nm.group(2).strip() else []
        body = lines[1:]
    else:
        stem_parts = []
        body = lines

    answer = ""
    analysis = ""
    needs_confirm = False
    answer_line_raw = ""
    saw_answer = False

    for line in body:
        ana = analysis_line_text(line)
        if ana is not None:
            analysis = ana if not analysis else (analysis + " " + ana).strip()
            continue
        found = answer_line_info(line, answer_label)
        if found is not None:
            saw_answer = True
            answer_line_raw = found.get("raw") or ""
            if found.get("standard") and found.get("answer"):
                answer = found["answer"]
                needs_confirm = False
            else:
                raw = answer_line_raw
                if raw and is_judge_answer(raw):
                    answer = "对" if raw.strip().lower() in JUDGE_TRUE else "错"
                    needs_confirm = False
                elif raw and len(raw) <= 80 and "因为" not in raw:
                    # 去掉尾部括号废话后再认短填空
                    cleaned = re.sub(r"\s*[（(].*$", "", raw).strip()
                    if cleaned and len(cleaned) <= 40:
                        answer = cleaned
                        needs_confirm = False
                    else:
                        answer = ""
                        needs_confirm = True
                else:
                    answer = ""
                    needs_confirm = True
            continue
        if not saw_answer:
            stem_parts.append(line)

    stem = " ".join(p for p in stem_parts if p).strip()
    if not stem or not saw_answer:
        return None
    if needs_confirm and not answer:
        return None

    if is_judge_answer(answer):
        qtype = "judge"
        answer = "对" if answer.strip().lower() in JUDGE_TRUE else "错"
    else:
        qtype = "fill"

    if expect_type and qtype != expect_type:
        # 样板期望判断却收成填空（或反之）时仍接受内容，只校正类型倾向
        if expect_type in ("judge", "fill"):
            qtype = expect_type
            if expect_type == "judge" and not is_judge_answer(answer):
                return None

    return {
        "num": num,
        "stem": stem,
        "options": [],
        "answer": answer,
        "analysis": analysis or "",
        "type": qtype,
    }


def shape_short_answer_block(block: list[str], *, answer_label: str = "答案") -> dict | None:
    """简答题块：题干 + 答案行（可空 rest）+ 后续分点/正文。"""
    if not block:
        return None
    lines = [ln for ln in block if not is_type_tag_line(ln)]
    if not lines:
        return None

    num = ""
    nm = NUM_RE.match(lines[0])
    if nm:
        num = nm.group(1)
        stem_parts = [nm.group(2).strip()] if nm.group(2).strip() else []
        body = lines[1:]
    else:
        stem_parts = []
        body = lines

    answer_parts: list[str] = []
    analysis = ""
    saw_answer = False
    phase = "stem"

    for line in body:
        ana = analysis_line_text(line)
        if ana is not None and saw_answer:
            analysis = ana if not analysis else (analysis + " " + ana).strip()
            continue
        found = answer_line_info(line, answer_label)
        if found is not None and not saw_answer:
            saw_answer = True
            phase = "answer"
            raw = (found.get("raw") or "").strip()
            if raw:
                answer_parts.append(raw)
            continue
        if phase == "stem":
            stem_parts.append(line)
        elif phase == "answer":
            answer_parts.append(line.strip())

    stem = " ".join(p for p in stem_parts if p).strip()
    if not stem or not saw_answer:
        return None
    if not answer_parts:
        return None

    points = []
    for i, part in enumerate(answer_parts):
        text = part.strip()
        if not text:
            continue
        # 去掉行首 1. / （1） 等
        text = re.sub(r"^(?:\d+[.、．)]\s*|[（(]\d+[)）]\s*)", "", text).strip()
        if not text:
            continue
        points.append({
            "index": len(points) + 1,
            "text": text,
            "keywords": [],
            "is_preamble": False,
        })
    if not points:
        return None

    answer = "\n".join(f"{p['index']}. {p['text']}" for p in points)
    return {
        "num": num or "",
        "stem": stem,
        "options": [],
        "answer": answer,
        "analysis": analysis or "",
        "type": "short_answer",
        "points": points,
        "keywords": [],
    }


def shape_block(
    block: list[str],
    *,
    option_style: str | None = None,
    answer_label: str | None = None,
    choice_only: bool = False,
    expect_type: str | None = None,
) -> dict | None:
    """通用单题成题。"""
    label = answer_label or detect_answer_label(block)
    if expect_type == "short_answer":
        return shape_short_answer_block(block, answer_label=label)
    style = option_style or detect_option_style(block)
    if expect_type in (None, "choice"):
        q = shape_choice_block(block, option_style=style, answer_label=label)
        if q:
            return q
        if choice_only or expect_type == "choice":
            return None
    if expect_type in ("judge", "fill"):
        return shape_non_choice_block(
            block, answer_label=label, expect_type=expect_type
        )
    return shape_non_choice_block(block, answer_label=label)


def split_numbered_blocks(lines: list[str]) -> list[list[str]]:
    """legacy 切刀：按题号切开。"""
    starts = [i for i, ln in enumerate(lines) if NUM_RE.match(ln)]
    if not starts:
        return []
    return [
        lines[start : (starts[i + 1] if i + 1 < len(starts) else len(lines))]
        for i, start in enumerate(starts)
    ]


def shape_blocks(blocks: list[list[str]], **kwargs) -> tuple[list[dict], int]:
    """批量成题。返回 (questions, skipped)。"""
    questions: list[dict] = []
    skipped = 0
    for block in blocks:
        q = shape_block(block, **kwargs)
        if not q:
            skipped += 1
            continue
        # short_answer 已含 points；attach 会保留
        questions.append(attach_question_defaults(dict(q), len(questions) + 1))
    return questions, skipped
